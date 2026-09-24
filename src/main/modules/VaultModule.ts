import { createHash } from 'crypto'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { app, BrowserWindow, clipboard, dialog, powerMonitor } from 'electron'
import log from 'electron-log'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { WindowManager } from './WindowManager'
import { SourcesModule } from './SourcesModule'
import { RevisionConflict, type VaultSource } from '../sources/VaultSource'
import { loadKdbx, makeCredentials, VaultError, VaultSession } from '../vault/VaultSession'
import { generatePassword } from '../vault/generator'
import { parseOtp, totp } from '../vault/totp'
import { exportDefaultPath } from '../vault/exportPath'
import { applySettingsPatch, DEFAULT_VAULT_SETTINGS, type VaultSettings } from '../vault/settings'
import {
  MAX_ATTACHMENT_BYTES,
  VAULT_EVENT_CHANNEL,
  type EntryInput,
  type OpenRequest,
  type PasswordOptions,
  type SaveResult,
  type VaultEvent,
  type VaultSnapshot,
  type VaultState
} from '../vault/protocol'
import { OTP_FIELD } from '../autotype/protocol'

const CLIPBOARD_CLEAR_MS = 30_000
/** Failed auto-saves before an idle lock gives up and locks anyway (with a recovery copy). */
const MAX_IDLE_SAVE_ATTEMPTS = 3
/** Revision moved again between merge and write: merge again, at most this often. */
const MAX_SAVE_ROUNDS = 3

/**
 * Errors crossing IPC lose their class; encode the code into the message.
 * Only the message crosses: Electron logs a handler's error with all its
 * properties, and some carry the input they failed on (Node's ERR_INVALID_URL
 * keeps an otpauth URI, seed included, on `.input`).
 */
const ipcError = (e: unknown): never => {
  if (e instanceof VaultError) throw new Error(`${e.code}: ${e.message}`)
  throw new Error(e instanceof Error ? e.message : 'The operation failed')
}

export class VaultModule implements AppModule {
  private session: VaultSession | undefined
  private openedListeners: (() => void)[] = []
  private eventListeners: ((event: VaultEvent) => void)[] = []
  /** Where the open vault came from, and the revision we last read/wrote. */
  private source: { source: VaultSource; revision: string } | undefined
  private idleTimer: NodeJS.Timeout | undefined
  private clipboardTimer: NodeJS.Timeout | undefined
  private clipboardValue: string | undefined
  /** In-flight save; saves are serialized (manual save vs. auto-lock). */
  private saving: Promise<SaveResult> | undefined
  private idleSaveFailures = 0
  /**
   * Credentials of the last open, held only when the renderer asked to enable
   * Touch ID with it, so it never has to send the password a second time.
   */
  private pendingBiometric: { fileId: string; password: string; keyFile?: Uint8Array } | undefined
  private settings = new Store<VaultSettings>({
    name: 'settings',
    defaults: DEFAULT_VAULT_SETTINGS
  })

  constructor(
    private ipc: IpcTransport,
    private windows: WindowManager,
    private sources: SourcesModule
  ) {}

  setup() {
    const h = this.ipc.handleChannel.bind(this.ipc)

    h('vault:state', () => this.state())
    h('vault:open', async (_e, req: OpenRequest) => {
      try {
        const snapshot = await this.open(req.fileId, req.password, req.keyFile)
        if (req.enableBiometric) {
          this.pendingBiometric = {
            fileId: req.fileId,
            password: req.password,
            keyFile: req.keyFile
          }
        }
        return snapshot
      } catch (e) {
        return ipcError(e)
      }
    })
    h('vault:snapshot', () => this.requireSession().snapshot())
    h('vault:entry', (_e, uuid: string) =>
      this.withActivity(() => this.requireSession().entryDetail(uuid))
    )
    h('vault:reveal', (_e, uuid: string, field: string) =>
      this.withActivity(() => this.requireSession().reveal(uuid, field))
    )
    h('vault:copy', (_e, uuid: string, field: string) =>
      this.withActivity(() => this.copy(this.requireSession().reveal(uuid, field)))
    )
    // Polled every second by the UI, so it must NOT count as activity —
    // otherwise an entry with a TOTP on screen would keep the vault unlocked.
    h('vault:otp', (_e, uuid: string) => {
      try {
        const source = this.requireSession().otpSource(uuid)
        return source ? totp(parseOtp(source)) : null
      } catch (e) {
        return ipcError(e)
      }
    })
    h('vault:copyOtp', (_e, uuid: string) =>
      this.withActivity(() => {
        const source = this.requireSession().otpSource(uuid)
        if (source) this.copy(totp(parseOtp(source)).code)
      })
    )

    h('vault:createEntry', (_e, groupUuid: string | undefined, input: EntryInput) =>
      this.mutate((s) => s.createEntry(groupUuid, input))
    )
    h('vault:updateEntry', (_e, uuid: string, input: EntryInput) =>
      this.mutate((s) => s.updateEntry(uuid, input))
    )
    h('vault:setPeople', (_e, uuid: unknown, people: unknown) => {
      if (typeof uuid !== 'string' || !Array.isArray(people)) throw new Error('Invalid request')
      return this.mutate((s) => s.setPeople(uuid, people as string[]))
    })
    h('vault:deleteEntry', (_e, uuid: string) => this.mutate((s) => s.deleteEntry(uuid)))
    h('vault:moveEntry', (_e, uuid: string, groupUuid: string) =>
      this.mutate((s) => s.moveEntry(uuid, groupUuid))
    )
    h('vault:createGroup', (_e, parent: string | undefined, name: string) =>
      this.mutate((s) => s.createGroup(parent, name))
    )
    h('vault:renameGroup', (_e, uuid: string, name: string) =>
      this.mutate((s) => s.renameGroup(uuid, name))
    )
    h('vault:deleteGroup', (_e, uuid: string) => this.mutate((s) => s.deleteGroup(uuid)))

    // ---- attachments
    h('vault:pickAttachments', (e, uuid: string) =>
      this.pickAttachments(BrowserWindow.fromWebContents(e.sender), uuid).catch(ipcError)
    )
    h('vault:addAttachment', (_e, uuid: string, name: string, bytes: Uint8Array) =>
      this.mutateAsync((s) => s.addAttachment(uuid, basename(name), bytes)).catch(ipcError)
    )
    h('vault:readAttachment', (_e, uuid: string, name: string) =>
      this.withActivity(() => this.requireSession().readAttachment(uuid, name))
    )
    h('vault:exportAttachment', (e, uuid: string, name: string) =>
      this.exportAttachment(BrowserWindow.fromWebContents(e.sender), uuid, name).catch(ipcError)
    )
    h('vault:renameAttachment', (_e, uuid: string, from: string, to: string) =>
      this.mutate((s) => s.renameAttachment(uuid, from, basename(to)))
    )
    h('vault:removeAttachment', (_e, uuid: string, name: string) =>
      this.mutate((s) => s.removeAttachment(uuid, name))
    )

    h('vault:save', () => this.save().catch(ipcError))
    h('vault:lock', () => this.lock('manual'))
    h('vault:generatePassword', (_e, opts?: Partial<PasswordOptions>) => generatePassword(opts))
    h('vault:activity', () => this.resetIdle())
    h('vault:getSettings', () => this.settings.store)
    h('vault:setSettings', (_e, patch: unknown) => {
      this.settings.set(applySettingsPatch(this.settings.store, patch))
      this.resetIdle()
      return this.settings.store
    })

    const onSystemLock = () => {
      if (this.session && this.settings.get('lockOnSleep')) void this.autoLock('system')
    }
    powerMonitor.on('lock-screen', onSystemLock)
    powerMonitor.on('suspend', onSystemLock)
  }

  onBeforeQuit() {
    this.clearClipboard()
  }

  // ------------------------------------------------------------ public (Biometric)

  get isOpen(): boolean {
    return !!this.session
  }

  get openFileName(): string | undefined {
    return this.session?.fileName
  }

  get openFileId(): string | undefined {
    return this.session?.fileId
  }

  /** Read from disk and decrypt. Used by IPC and by Touch ID unlock. */
  async open(fileId: string, password: string, keyFile?: Uint8Array): Promise<VaultSnapshot> {
    if (this.session?.dirty) {
      throw new VaultError('Unknown', 'Save or discard changes to the open vault first')
    }
    const source = this.sources.resolve(fileId)
    const ref = await source.describe()
    const { bytes, revision } = await source.read()
    const session = await VaultSession.open(
      bytes,
      makeCredentials(password, keyFile),
      fileId,
      ref.name
    )
    this.session = session
    this.source = { source, revision }
    this.sources.remember(ref)
    this.resetIdle()
    const snapshot = session.snapshot()
    // Other windows (main ↔ auto-type popup) follow an unlock done in one of them.
    this.emit({ type: 'opened', snapshot })
    for (const cb of this.openedListeners) cb()
    return snapshot
  }

  onOpened(cb: () => void) {
    this.openedListeners.push(cb)
  }

  /** Every event the renderer gets too (opened, changed, locked…). */
  onEvent(cb: (event: VaultEvent) => void) {
    this.eventListeners.push(cb)
  }

  /** Where the open vault's secrets occur in `text` (names and positions only). */
  findSecrets(text: string) {
    if (!this.session) throw new VaultError('Unknown', 'Vault is locked')
    return this.session.findSecrets(text)
  }

  /** Non-secret search documents for the open vault (see `VaultSession.searchDocuments`). */
  searchDocuments() {
    return this.session?.searchDocuments() ?? []
  }

  /** A Meta/CustomData value of the open vault (app settings stored in the file). */
  readCustomData(key: string): string | undefined {
    return this.session?.getCustomData(key)
  }

  /** Store a Meta/CustomData value; the vault turns dirty and saves with the next save. */
  writeCustomData(key: string, value: string) {
    if (!this.session || this.session.getCustomData(key) === value) return
    this.mutate((s) => s.setCustomData(key, value))
  }

  /**
   * The credentials the renderer asked to remember at the last `vault:open`,
   * for Touch ID. Handed out once, and only while that vault is still open.
   */
  takeBiometricCredentials(fileId: string): { password: string; keyFile?: Uint8Array } | undefined {
    const pending = this.pendingBiometric
    this.pendingBiometric = undefined
    if (!pending || pending.fileId !== fileId || this.openFileId !== fileId) return undefined
    return { password: pending.password, keyFile: pending.keyFile }
  }

  /** Plaintext of one field (or the current TOTP code) for auto-type. Counts as activity. */
  revealForAutoType(uuid: string, field: string): string {
    return this.withActivity(() => {
      const session = this.requireSession()
      if (field !== OTP_FIELD) return session.reveal(uuid, field)
      const source = session.otpSource(uuid)
      if (!source) throw new VaultError('NotFound', 'This entry has no one-time code')
      return totp(parseOtp(source)).code
    })
  }

  // ------------------------------------------------------------ internals

  private state(): VaultState {
    if (!this.session) return { open: false }
    return {
      open: true,
      fileId: this.session.fileId,
      fileName: this.session.fileName,
      dirty: this.session.dirty
    }
  }

  private requireSession(): VaultSession {
    if (!this.session) throw new Error('Vault is locked')
    return this.session
  }

  private withActivity<T>(fn: () => T): T {
    try {
      const out = fn()
      this.resetIdle()
      return out
    } catch (e) {
      return ipcError(e)
    }
  }

  private mutate<T>(fn: (s: VaultSession) => T): { result: T; snapshot: VaultSnapshot } {
    return this.withActivity(() => {
      const s = this.requireSession()
      const result = fn(s)
      const snapshot = s.snapshot()
      this.emit({ type: 'changed', snapshot })
      return { result, snapshot }
    })
  }

  private async mutateAsync<T>(
    fn: (s: VaultSession) => Promise<T>
  ): Promise<{ result: T; snapshot: VaultSnapshot }> {
    const s = this.requireSession()
    const result = await fn(s)
    const snapshot = s.snapshot()
    this.emit({ type: 'changed', snapshot })
    this.resetIdle()
    return { result, snapshot }
  }

  /** Native file picker; files are read in main and never touch the renderer. */
  private async pickAttachments(win: BrowserWindow | null, uuid: string): Promise<string[]> {
    this.requireSession()
    const opts: Electron.OpenDialogOptions = {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images & PDFs', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'pdf'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return []
    const added: string[] = []
    for (const path of res.filePaths) {
      if ((await stat(path)).size > MAX_ATTACHMENT_BYTES) {
        throw new VaultError('Unknown', `${basename(path)} is larger than 50 MB`)
      }
      const bytes = new Uint8Array(await readFile(path))
      const { result } = await this.mutateAsync((s) => s.addAttachment(uuid, basename(path), bytes))
      added.push(result)
    }
    return added
  }

  private async exportAttachment(
    win: BrowserWindow | null,
    uuid: string,
    name: string
  ): Promise<boolean> {
    const { bytes } = this.requireSession().readAttachment(uuid, name)
    // The name comes from the vault file: never let it steer the dialog's folder.
    const opts: Electron.SaveDialogOptions = {
      title: 'Save attachment',
      defaultPath: exportDefaultPath(app.getPath('downloads'), name)
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return false
    await writeFile(res.filePath, bytes)
    this.resetIdle()
    return true
  }

  /**
   * Save with optimistic concurrency: if the stored copy moved on since we
   * read it (another device, Drive for desktop syncing a newer version onto
   * disk, KeePassXC…), load it, merge it into ours with KeePass's merge rules,
   * and write the result.
   */
  private save(): Promise<SaveResult> {
    // One save at a time: a manual save racing an auto-lock would otherwise
    // interleave two merges and two writes.
    const run = (this.saving ?? Promise.resolve()).catch(() => undefined).then(() => this.saveNow())
    const tracked = run.finally(() => {
      if (this.saving === tracked) this.saving = undefined
    })
    this.saving = tracked
    return tracked
  }

  private async saveNow(): Promise<SaveResult> {
    const session = this.requireSession()
    const opened = this.source!
    let merged = false

    for (let round = 0; ; round++) {
      if ((await opened.source.revision()) !== opened.revision) {
        log.info('Stored vault changed since open, merging')
        const { bytes: remoteBytes, revision } = await opened.source.read()
        const remote = await loadKdbx(remoteBytes, session.credentials)
        session.merge(remote)
        opened.revision = revision
        merged = true
      }

      const savedRevision = session.revision
      const bytes = await session.save()
      // The KDF above can take seconds; if someone else saved meanwhile, merge
      // their copy in rather than overwrite it.
      try {
        opened.revision = await opened.source.write(bytes, opened.revision)
      } catch (e) {
        if (e instanceof RevisionConflict && round < MAX_SAVE_ROUNDS) continue
        throw e
      }
      // Edits made while the write was in flight are not in `bytes`: stay dirty.
      session.markSaved(savedRevision)
      break
    }
    this.emit({ type: 'changed', snapshot: session.snapshot() })
    this.resetIdle()
    return { merged }
  }

  private async autoLock(reason: 'idle' | 'system') {
    const session = this.session
    if (!session) return
    if (session.dirty) {
      // Never throw away edits on an automatic lock.
      try {
        await this.save()
        this.idleSaveFailures = 0
      } catch (e) {
        log.error('Auto-save before lock failed', e instanceof Error ? e.message : e)
        // An idle lock retries a few times (network blip); sleep/screen lock
        // and repeated failures lock anyway, keeping an encrypted copy.
        if (reason === 'idle' && ++this.idleSaveFailures < MAX_IDLE_SAVE_ATTEMPTS) {
          this.resetIdle()
          return
        }
        if (this.session !== session) return
        const recovered = await this.writeRecoveryCopy(session)
        this.idleSaveFailures = 0
        this.lock(reason, recovered ? 'recovered' : 'lost')
        return
      }
    }
    if (this.session === session) this.lock(reason)
  }

  /**
   * Unsaved edits the auto-lock could not write back: store them next to the
   * app data, encrypted with the vault's own key, so locking never waits on the
   * network and never silently drops them.
   */
  private async writeRecoveryCopy(session: VaultSession): Promise<string | undefined> {
    try {
      const dir = join(app.getPath('userData'), 'recovery')
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const id = createHash('sha256').update(session.fileId).digest('hex').slice(0, 16)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const path = join(dir, `${id}-${stamp}.kdbx`)
      await writeFile(path, new Uint8Array(await session.save()), { mode: 0o600 })
      log.warn('Unsaved changes written to a recovery copy')
      return path
    } catch (e) {
      log.error('Could not write a recovery copy', e instanceof Error ? e.message : e)
      return undefined
    }
  }

  lock(reason: 'manual' | 'idle' | 'system', unsaved?: 'recovered' | 'lost') {
    if (!this.session) return
    this.session = undefined
    this.source = undefined
    this.pendingBiometric = undefined
    clearTimeout(this.idleTimer)
    this.clearClipboard()
    this.emit({ type: 'locked', reason, unsaved })
  }

  private resetIdle() {
    clearTimeout(this.idleTimer)
    const minutes = this.settings.get('autoLockMinutes')
    if (!this.session || !minutes) return
    this.idleTimer = setTimeout(() => void this.autoLock('idle'), minutes * 60_000)
  }

  /** Put a value on the clipboard and clear it after 30 s. */
  copy(value: string) {
    clipboard.writeText(value)
    this.clipboardValue = value
    clearTimeout(this.clipboardTimer)
    this.clipboardTimer = setTimeout(() => this.clearClipboard(), CLIPBOARD_CLEAR_MS)
  }

  /** The clipboard currently holds a value Sekure copied (and will clear). */
  ownsClipboard(): boolean {
    return this.clipboardValue !== undefined && clipboard.readText() === this.clipboardValue
  }

  /** Only clears if the clipboard still holds what we put there. */
  private clearClipboard() {
    clearTimeout(this.clipboardTimer)
    if (this.clipboardValue !== undefined && clipboard.readText() === this.clipboardValue) {
      clipboard.clear()
      this.emit({ type: 'clipboard-cleared' })
    }
    this.clipboardValue = undefined
  }

  private emit(event: VaultEvent) {
    this.windows.broadcast(VAULT_EVENT_CHANNEL, event)
    for (const cb of this.eventListeners) cb(event)
  }
}
