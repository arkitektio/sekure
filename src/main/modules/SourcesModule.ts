import { existsSync, readdirSync } from 'fs'
import { rm } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import Store from 'electron-store'
import log from 'electron-log'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { SecretStore } from '../lib/secrets'
import { LocalSource, type VaultSource } from '../sources/VaultSource'
import { isLocalId, localPath, type RecentVault, type VaultRef } from '../sources/protocol'

const MAX_RECENT = 8

/** Best guess at the Google Drive for desktop root, for the file dialog. */
function driveSyncFolder(): string | undefined {
  if (process.platform === 'darwin') {
    const base = join(homedir(), 'Library', 'CloudStorage')
    try {
      const dir = readdirSync(base).find((d) => d.startsWith('GoogleDrive-'))
      if (dir) {
        const myDrive = join(base, dir, 'My Drive')
        return existsSync(myDrive) ? myDrive : join(base, dir)
      }
    } catch {
      /* no CloudStorage folder */
    }
  }
  if (process.platform === 'win32' && existsSync('G:\\My Drive')) return 'G:\\My Drive'
  return undefined
}

/** Resolves vault ids to sources and keeps the recent-vaults list. */
export class SourcesModule implements AppModule {
  private store = new Store<{ recent: RecentVault[] }>({
    name: 'sources',
    defaults: { recent: [] }
  })
  /** Local paths the user chose in the file dialog this session. */
  private picked = new Set<string>()

  constructor(private ipc: IpcTransport) {}

  setup() {
    void this.forgetGoogle()
    this.ipc.handleChannel('sources:describe', (_e, id: string) => this.resolve(id).describe())
    this.ipc.handleChannel('sources:recent', () => this.recent())
    this.ipc.handleChannel('sources:forget', (_e, id: string) =>
      this.setRecent(this.recent().filter((r) => r.id !== id))
    )
    this.ipc.handleChannel('sources:pickLocal', (e) =>
      this.pickLocal(BrowserWindow.fromWebContents(e.sender))
    )
  }

  /**
   * Local ids come from the renderer, so they must name a file the user chose
   * in the file dialog (this session) or opened before (recent). Otherwise a
   * compromised renderer could probe or open any path on disk.
   */
  resolve(id: string): VaultSource {
    if (isLocalId(id)) {
      const path = localPath(id)
      const known = this.picked.has(path) || this.recent().some((r) => r.id === id)
      if (!isAbsolute(path) || !known) throw new Error('Choose this file with “Open local file”')
      return new LocalSource(path)
    }
    throw new Error('Unknown vault location')
  }

  remember(ref: VaultRef) {
    this.setRecent(
      [
        { ...ref, openedAt: new Date().toISOString() },
        ...this.recent().filter((r) => r.id !== ref.id)
      ].slice(0, MAX_RECENT)
    )
  }

  private recent(): RecentVault[] {
    // Only files on this computer; entries from the removed Google Drive support are dropped.
    return this.store.get('recent').filter((r) => r.kind === 'local' && isLocalId(r.id))
  }

  /**
   * Google Drive support was removed: drop what it left behind, the refresh token
   * (in the OS-encrypted secret store) and the account/avatar cache.
   */
  private async forgetGoogle() {
    try {
      new SecretStore().delete('google.refreshToken')
      await rm(join(app.getPath('userData'), 'google.json'), { force: true })
      const recent = this.store.get('recent')
      const local = recent.filter((r) => r.kind === 'local' && isLocalId(r.id))
      if (local.length !== recent.length) this.setRecent(local)
    } catch (e) {
      log.warn('Could not clear old Google Drive data', e)
    }
  }

  private setRecent(recent: RecentVault[]) {
    this.store.set('recent', recent)
  }

  private async pickLocal(win: BrowserWindow | null): Promise<VaultRef | null> {
    const opts: Electron.OpenDialogOptions = {
      title: 'Open KeePass database',
      defaultPath: driveSyncFolder() ?? homedir(),
      properties: ['openFile'],
      filters: [
        { name: 'KeePass database', extensions: ['kdbx'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    this.picked.add(res.filePaths[0])
    return new LocalSource(res.filePaths[0]).describe()
  }
}
