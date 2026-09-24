import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  net,
  Notification,
  systemPreferences
} from 'electron'
import log from 'electron-log'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { WindowManager } from './WindowManager'
import { VaultModule } from './VaultModule'
import { AutoTypeModule } from './AutoTypeModule'
import { modelsRoot, ortWasmPaths } from './modelPaths'
import {
  createFloatingPopup,
  delay,
  exec,
  FOCUS_SETTLE_MS,
  positionPopup,
  restoreClipboard,
  RESTORE_CLIPBOARD_MS,
  saveClipboard
} from './popup'
import { createInjector, type Injector, type Target } from '../autotype/injector'
import { WorkerClient } from '../models/WorkerClient'
import { ensureModel, hasModel, modelDir, removeModel } from '../models/modelStore'
import { modelBytes } from '../models/spec'
import { join } from 'path'
import { detectRules } from '../deidentify/rules'
import { PlaceholderMap } from '../deidentify/placeholders'
import { DeidentifySession, placeholderSpans } from '../deidentify/session'
import type { Span } from '../deidentify/span'
import type { PredictRequest } from '../deidentify/gliner.worker'
import createGlinerWorker from '../deidentify/gliner.worker?nodeWorker'
import {
  DEFAULT_DEIDENTIFY_SETTINGS,
  DEIDENTIFY_STATUS_CHANNEL,
  DEIDENTIFY_VIEW_CHANNEL,
  GLINER_MODEL,
  type DeidentifyAction,
  type DeidentifyDecision,
  type DeidentifyMode,
  type DeidentifyResult,
  type DeidentifySettings,
  type DeidentifyStatus,
  type DeidentifyView
} from '../deidentify/protocol'

const POPUP_SIZE = { width: 640, height: 480 }
/** How long ⌘C gets to fill the clipboard. */
const COPY_TIMEOUT_MS = 500
/** Placeholder mappings are forgotten after this long unused. */
const MAPPING_TTL_MS = 30 * 60_000
/** The PII model is unloaded after this long idle. */
const MODEL_IDLE_MS = 5 * 60_000

type ModelInfo = DeidentifyView['model']

/**
 * Deidentify selected text in any app: a global shortcut copies the selection,
 * detection runs here (vault-credential check, rules, the local PII model), a
 * review popup shows the spans, and Enter pastes the text with placeholders.
 *
 * The captured text and the placeholder mapping live only in this module's
 * memory. Vault credentials are found here and reach the popup only as locked,
 * text-less segments; they are never kept for re-identification.
 */
export class DeidentifyModule implements AppModule {
  private settings = new Store<DeidentifySettings>({
    name: 'deidentify',
    defaults: DEFAULT_DEIDENTIFY_SETTINGS
  })
  private injector: Injector = createInjector(process.platform, process.env, exec)
  private popup: BrowserWindow | undefined
  private keepOpen = false
  private target: Target = {}
  private registered: string | undefined
  private map = new PlaceholderMap()
  private session: DeidentifySession | undefined
  private sessionIds = 0
  private view: DeidentifyView | undefined
  private model: WorkerClient<Omit<PredictRequest, 'id'>, Span[]> | undefined
  private modelIdle: NodeJS.Timeout | undefined
  private modelInfo: ModelInfo = { state: 'off' }
  private expiry: NodeJS.Timeout | undefined

  constructor(
    private ipc: IpcTransport,
    private windows: WindowManager,
    private vault: VaultModule,
    private autotype: AutoTypeModule
  ) {}

  private get modelDir() {
    return modelDir(modelsRoot(), GLINER_MODEL)
  }

  async setup() {
    const h = this.ipc.handleChannel.bind(this.ipc)
    h('deidentify:current', () => this.view)
    h('deidentify:submitText', (_e, text: string) => this.start(String(text ?? '')))
    h('deidentify:setMode', (_e, mode: DeidentifyMode) => this.setMode(mode))
    h('deidentify:apply', (_e, decision: DeidentifyDecision, action: DeidentifyAction) =>
      this.apply(decision, action)
    )
    h('deidentify:dismiss', () => this.dismiss())
    h('deidentify:keepOpen', (_e, keep: boolean) => {
      this.keepOpen = keep
    })
    h('deidentify:forget', () => this.forget())
    h('deidentify:getSettings', () => this.settings.store)
    h('deidentify:setSettings', (_e, patch: Partial<DeidentifySettings>) => this.update(patch))
    h('deidentify:status', () => this.status())
    h('deidentify:enableModel', () => this.enableModel())
    h('deidentify:disableModel', (_e, removeFiles: boolean) => this.disableModel(removeFiles))
    h('deidentify:suspend', (_e, suspend: boolean) => {
      if (suspend) {
        if (this.registered) globalShortcut.unregister(this.registered)
        this.registered = undefined
      } else this.register()
    })

    this.vault.onEvent((event) => {
      if (event.type === 'opened' && this.session && this.view?.needsUnlock) void this.detect()
      if (event.type === 'locked') {
        // The mapping holds the user's personal data: gone with the vault.
        this.forget()
        void this.stopModel()
      }
    })
    this.windows.onMainClosed(() => {
      if (process.platform === 'darwin') return
      this.popup?.destroy()
      this.popup = undefined
    })

    if (this.settings.get('model')) {
      this.modelInfo = (await hasModel(this.modelDir, GLINER_MODEL))
        ? { state: 'ready' }
        : { state: 'error', message: 'The PII model is missing. Turn it on again to download it.' }
    }
    if (!this.register()) {
      log.warn(`Deidentify shortcut ${this.settings.get('shortcut')} could not be registered`)
    }
  }

  async onBeforeQuit() {
    if (this.registered) globalShortcut.unregister(this.registered)
    this.forget()
    await this.stopModel()
  }

  // ------------------------------------------------------------ settings

  private register(): boolean {
    if (this.registered) globalShortcut.unregister(this.registered)
    this.registered = undefined
    const { enabled, shortcut } = this.settings.store
    if (!enabled) return true
    if (shortcut === this.autotype.currentSettings.shortcut) return false
    let ok = false
    try {
      ok = globalShortcut.register(shortcut, () => {
        this.trigger().catch((e) =>
          log.error('Deidentify failed', e instanceof Error ? e.message : e)
        )
      })
    } catch (e) {
      log.warn(`Deidentify shortcut ${shortcut} is not a valid accelerator`, e)
    }
    if (ok) this.registered = shortcut
    return ok
  }

  private update(patch: Partial<DeidentifySettings>): DeidentifyStatus {
    const previous = this.settings.store
    this.settings.set({ ...previous, ...patch })
    if (!this.register()) {
      const shortcut = this.settings.get('shortcut')
      this.settings.set(previous)
      this.register()
      throw new Error(`${shortcut} is invalid or already used (by auto-type or another app)`)
    }
    return this.status()
  }

  private status(): DeidentifyStatus {
    return {
      registered: !!this.registered,
      model: this.modelInfo,
      modelBytes: modelBytes(GLINER_MODEL),
      mappings: this.map.size
    }
  }

  private emitStatus() {
    this.windows.broadcast(DEIDENTIFY_STATUS_CHANNEL, this.status())
  }

  private forget() {
    this.map.clear()
    clearTimeout(this.expiry)
    this.emitStatus()
  }

  /** Forget mappings once they sit unused for `MAPPING_TTL_MS`. */
  private scheduleExpiry() {
    clearTimeout(this.expiry)
    if (!this.map.size) return
    this.expiry = setTimeout(() => {
      if (Date.now() - this.map.lastUsed >= MAPPING_TTL_MS) this.forget()
      else this.scheduleExpiry()
    }, MAPPING_TTL_MS)
    this.expiry.unref?.()
  }

  // ------------------------------------------------------------ capture

  private async trigger() {
    if (this.popup?.isVisible()) {
      this.dismiss()
      return
    }
    try {
      this.target = await this.injector.captureTarget()
    } catch {
      this.target = {}
    }
    const text = await this.grabSelection()
    log.info(`Deidentify: captured ${text.length} characters`)

    const popup = this.ensurePopup()
    positionPopup(popup, POPUP_SIZE)
    await this.start(text)
    this.keepOpen = false
    if (process.platform === 'darwin') app.focus({ steal: true })
    popup.show()
    popup.focus()
  }

  /** Copy the target's selection via the clipboard, then put the clipboard back. */
  private async grabSelection(): Promise<string> {
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      return '' // cannot press ⌘C; the popup asks for the text instead
    }
    const saved = saveClipboard()
    clipboard.clear()
    let text = ''
    try {
      await this.injector.copy(this.target)
      const until = Date.now() + COPY_TIMEOUT_MS
      while (!(text = clipboard.readText()) && Date.now() < until) await delay(25)
    } catch (e) {
      log.warn('Deidentify: copy failed', e instanceof Error ? e.message : e)
    } finally {
      restoreClipboard(saved)
    }
    return text
  }

  private ensurePopup(): BrowserWindow {
    if (this.popup && !this.popup.isDestroyed()) return this.popup
    this.popup = createFloatingPopup('/deidentify', POPUP_SIZE, () => this.keepOpen)
    return this.popup
  }

  private dismiss() {
    this.keepOpen = false
    this.popup?.hide()
    this.session = undefined
    this.view = undefined
    if (process.platform === 'darwin' && !this.windows.mainWindowVisible) app.hide()
  }

  // ------------------------------------------------------------ detection

  private async start(text: string, mode?: DeidentifyMode) {
    const id = ++this.sessionIds
    const resolved: DeidentifyMode =
      mode ?? (this.map.find(text).length ? 'reidentify' : 'deidentify')
    this.session = text.trim() ? new DeidentifySession(id, text, resolved, []) : undefined
    await this.detect()
  }

  private async setMode(mode: DeidentifyMode) {
    if (this.session) await this.start(this.session.raw, mode)
  }

  private async detect() {
    const session = this.session
    if (!session) return this.publish(undefined, { needsUnlock: false })

    // The hard check needs the vault's secrets: nothing is shown until it is unlocked.
    if (!this.vault.isOpen) return this.publish(session, { needsUnlock: true })

    const credentials: Span[] = this.vault.findSecrets(session.raw).map((hit) => ({
      start: hit.start,
      end: hit.end,
      kind: 'CREDENTIAL',
      label: `${hit.entry} / ${hit.field}`,
      source: 'vault'
    }))

    if (session.mode === 'reidentify') {
      // Credentials stay masked here too, even inside an answer being restored.
      session.setSpans([...credentials, ...placeholderSpans(session.raw, this.map)])
      return this.publish(session, { needsUnlock: false })
    }

    const rules = detectRules(session.raw)
    session.setSpans([...credentials, ...rules])
    this.publish(session, { needsUnlock: false })

    const model = await this.startModel()
    if (!model || this.session !== session) return
    this.setModelInfo({ state: 'running' })
    try {
      const found = await model.call({ text: session.raw })
      if (this.session !== session) return
      session.setSpans([...credentials, ...rules, ...found])
      this.setModelInfo({ state: 'ready' })
      this.publish(session, { needsUnlock: false })
    } catch (e) {
      log.error('PII model failed', e instanceof Error ? e.message : e)
      this.setModelInfo({ state: 'error', message: 'The PII model failed on this text.' })
      this.publish(session, { needsUnlock: false })
    } finally {
      this.touchModel()
    }
  }

  private publish(session: DeidentifySession | undefined, opts: { needsUnlock: boolean }) {
    this.view = {
      sessionId: session?.id ?? this.sessionIds,
      mode: session?.mode ?? 'deidentify',
      targetName: this.target.name,
      empty: !session,
      needsUnlock: opts.needsUnlock,
      // Nothing is shown before the credential check has run.
      segments: session && !opts.needsUnlock ? session.segments() : [],
      restorable: session ? this.map.find(session.raw).length : 0,
      model: this.modelInfo
    }
    if (this.popup && !this.popup.isDestroyed()) {
      this.ipc.sendTo(this.popup.webContents, DEIDENTIFY_VIEW_CHANNEL, this.view)
    }
  }

  // ------------------------------------------------------------ output

  private async apply(
    decision: DeidentifyDecision,
    action: DeidentifyAction
  ): Promise<DeidentifyResult> {
    const session = this.session
    if (!session) throw new Error('Nothing to deidentify')
    if (!this.vault.isOpen) {
      throw new Error('Unlock the vault first so credentials can be checked')
    }
    const { text, replaced } = session.apply(decision, this.map)
    this.scheduleExpiry()
    this.emitStatus()
    this.dismiss()
    log.info(`Deidentify: ${session.mode} replaced ${replaced} spans`)

    if (action === 'copy') {
      clipboard.writeText(text)
      return { pasted: false, replaced }
    }
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      systemPreferences.isTrustedAccessibilityClient(true)
      return this.fallback(text, replaced)
    }
    const saved = saveClipboard()
    clipboard.writeText(text)
    try {
      await delay(FOCUS_SETTLE_MS)
      await this.injector.paste(this.target)
    } catch (e) {
      log.warn('Deidentify paste failed', e instanceof Error ? e.message : e)
      return this.fallback(text, replaced)
    }
    setTimeout(() => {
      if (clipboard.readText() === text) restoreClipboard(saved)
    }, RESTORE_CLIPBOARD_MS)
    return { pasted: true, replaced }
  }

  /** Could not paste: the result stays on the clipboard for the user to paste. */
  private fallback(text: string, replaced: number): DeidentifyResult {
    clipboard.writeText(text)
    if (Notification.isSupported()) {
      const keys = process.platform === 'darwin' ? '⌘V' : 'Ctrl+V'
      new Notification({
        title: `Press ${keys} to paste`,
        body: 'Sekure could not paste automatically. The result is on the clipboard.',
        silent: true
      }).show()
    }
    return { pasted: false, replaced }
  }

  // ------------------------------------------------------------ model

  private setModelInfo(info: ModelInfo) {
    this.modelInfo = info
    this.emitStatus()
  }

  private async enableModel() {
    try {
      this.setModelInfo({ state: 'downloading', progress: 0 })
      await ensureModel(
        this.modelDir,
        GLINER_MODEL,
        (url) => net.fetch(url),
        (progress) => this.setModelInfo({ state: 'downloading', progress })
      )
      this.settings.set('model', true)
      this.setModelInfo({ state: 'ready' })
    } catch (e) {
      log.error('PII model download failed', e)
      this.setModelInfo({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  private async disableModel(removeFiles: boolean) {
    this.settings.set('model', false)
    await this.stopModel()
    if (removeFiles) await removeModel(join(modelsRoot(), GLINER_MODEL.id))
    this.setModelInfo({ state: 'off' })
  }

  /** The loaded model, starting it if enabled; undefined when off or broken. */
  private async startModel() {
    if (!this.settings.get('model')) return undefined
    if (!this.model) {
      if (!(await hasModel(this.modelDir, GLINER_MODEL))) return undefined
      this.setModelInfo({ state: 'loading' })
      this.model = new WorkerClient(
        createGlinerWorker({ workerData: { modelDir: this.modelDir, wasmPaths: ortWasmPaths() } })
      )
    }
    const model = this.model
    try {
      await model.ready
    } catch (e) {
      if (this.model !== model) return undefined
      log.error('Loading the PII model failed', e)
      this.model = undefined
      this.setModelInfo({ state: 'error', message: 'The PII model could not be loaded.' })
      return undefined
    }
    this.touchModel()
    return this.model === model ? model : undefined
  }

  private touchModel() {
    clearTimeout(this.modelIdle)
    this.modelIdle = setTimeout(() => void this.stopModel(), MODEL_IDLE_MS)
    this.modelIdle.unref?.()
  }

  private async stopModel() {
    clearTimeout(this.modelIdle)
    const model = this.model
    this.model = undefined
    if (model) await model.terminate()
    if (this.settings.get('model') && this.modelInfo.state !== 'error') {
      this.setModelInfo({ state: 'ready' })
    }
  }
}
