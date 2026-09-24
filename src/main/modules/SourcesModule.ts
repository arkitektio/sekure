import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { BrowserWindow, dialog } from 'electron'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { DriveModule } from './DriveModule'
import { GoogleAuthModule } from './GoogleAuthModule'
import { DriveSource, LocalSource, type VaultSource } from '../sources/VaultSource'
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

  constructor(
    private ipc: IpcTransport,
    private drive: DriveModule,
    auth: GoogleAuthModule
  ) {
    // Disconnecting Google forgets Drive vaults, never local ones.
    auth.onStatusChange((s) => {
      if (!s.connected) this.setRecent(this.recent().filter((r) => r.kind === 'local'))
    })
  }

  setup() {
    this.ipc.handleChannel('sources:describe', (_e, id: string) => this.resolve(id).describe())
    this.ipc.handleChannel('sources:recent', () => this.recent())
    this.ipc.handleChannel('sources:forget', (_e, id: string) =>
      this.setRecent(this.recent().filter((r) => r.id !== id))
    )
    this.ipc.handleChannel('sources:pickLocal', (e) =>
      this.pickLocal(BrowserWindow.fromWebContents(e.sender))
    )
  }

  resolve(id: string): VaultSource {
    return isLocalId(id) ? new LocalSource(localPath(id)) : new DriveSource(this.drive.client, id)
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
    // Entries written before sources existed have no `kind`: they were Drive files.
    return this.store
      .get('recent')
      .map((r) => ({ ...r, kind: r.kind ?? 'drive', location: r.location ?? 'Google Drive' }))
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
    return new LocalSource(res.filePaths[0]).describe()
  }
}
