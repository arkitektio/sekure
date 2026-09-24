import { dialog, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import Store from 'electron-store'
import { IpcTransport } from './IpcTransport'
import { WindowManager } from './WindowManager'
import { AppModule } from './AppModule'
import { UPDATE_STATE_CHANNEL, type UpdateChannel, type UpdateState } from '../updater/protocol'

// User-facing update channels. "next" surfaces prereleases; "latest" is stable.
// NOTE: the "next" channel rides electron-builder's standard `beta.yml` carrier
// file — `generateUpdatesFilesForAllChannels` only emits latest/beta/alpha and
// the GitHub publisher does not auto-detect channels, so there is no `rc.yml`.
// The visible identity ("Next" label, `-rc` version suffix) is intentionally
// decoupled from the internal carrier (`beta.yml`).

const STORE_KEY = 'updateChannel'
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/**
 * Auto-update through electron-updater (GitHub releases). Main owns one
 * `UpdateState` and broadcasts it; the rail shows "Update ready · Restart" and
 * Settings shows the version, channel and a manual check. Registered in every
 * build, but only packaged builds check (`enabled`); dev reports `disabled`.
 */
export class AppUpdater implements AppModule {
  private store = new Store()
  private state: UpdateState

  constructor(
    private ipcTransport: IpcTransport,
    private windowManager: WindowManager,
    private enabled: boolean
  ) {
    this.state = {
      phase: enabled ? 'idle' : 'disabled',
      current: app.getVersion(),
      channel: this.resolveChannel()
    }
  }

  setup() {
    const h = this.ipcTransport.handleChannel.bind(this.ipcTransport)
    h('updater:state', () => this.state)
    h('updater:check', () => this.check())
    // `setImmediate` so this call's IPC reply is flushed before the app
    // starts tearing itself down.
    h('updater:install', () => {
      if (this.state.phase !== 'ready') throw new Error('No update is ready to install')
      setImmediate(() => autoUpdater.quitAndInstall())
    })
    h('updater:setChannel', async (_e, channel: unknown) => {
      const next: UpdateChannel = channel === 'next' ? 'next' : 'latest'
      this.store.set(STORE_KEY, next)
      this.set({ channel: next })
      if (!this.enabled) return
      this.applyChannel(next, true)
      try {
        await this.check()
      } finally {
        autoUpdater.allowDowngrade = false
      }
    })

    if (!this.enabled) return

    log.transports.file.level = 'info'
    autoUpdater.logger = log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    this.applyChannel(this.state.channel)

    autoUpdater.on('checking-for-update', () => this.set({ phase: 'checking', error: undefined }))
    autoUpdater.on('update-available', (info) =>
      this.set({ phase: 'downloading', version: info.version, progress: 0 })
    )
    autoUpdater.on('update-not-available', () =>
      this.set({ phase: 'upToDate', version: undefined, progress: undefined })
    )
    autoUpdater.on('download-progress', (p) =>
      this.set({ phase: 'downloading', progress: p.percent / 100 })
    )
    autoUpdater.on('error', (err) => {
      log.warn('Update failed', err)
      // A download that was already complete stays installable.
      if (this.state.phase !== 'ready') this.set({ phase: 'error', error: String(err) })
    })
    autoUpdater.on('update-downloaded', async (info) => {
      this.set({ phase: 'ready', version: info.version, progress: 1 })
      // With a window, the rail shows it (no modal stealing focus); without one
      // (e.g. only the auto-type popup ran), fall back to the native prompt.
      if (this.windowManager.mainWindowVisible) return
      const r = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        message: `Sekure ${info.version} is ready`,
        detail: 'Restart to install it, or it installs the next time you quit.'
      })
      if (r.response === 0) autoUpdater.quitAndInstall()
    })

    setTimeout(() => void this.check(), 5000)
    setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  private async check() {
    // Nothing to do in dev, and a finished download needs no second look.
    if (!this.enabled || this.state.phase === 'ready') return
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      this.set({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    for (const win of this.windowManager.getAllWindows()) {
      if (win.isDestroyed()) continue
      this.ipcTransport.sendTo(win.webContents, UPDATE_STATE_CHANNEL, this.state)
    }
  }

  /**
   * The active channel: the stored choice if present, otherwise derived from
   * the running version — a prerelease build (e.g. `1.66.0-rc.1`) defaults to
   * "next" so it keeps receiving prereleases.
   */
  private resolveChannel(): UpdateChannel {
    const stored = this.store.get(STORE_KEY) as UpdateChannel | undefined
    if (stored === 'next' || stored === 'latest') return stored
    // A semver prerelease version carries a `-` suffix (e.g. `1.66.0-rc.1`).
    return app.getVersion().includes('-') ? 'next' : 'latest'
  }

  /**
   * Map the user-facing channel to electron-updater. "next" reads the standard
   * `beta.yml` carrier and allows prereleases; "latest" is stable-only.
   * `allowDowngrade` is only for the check right after a Next→Stable switch
   * (to move to a lower stable version). Left on, anyone who can edit a
   * release could roll clients back to an older, vulnerable build.
   */
  private applyChannel(channel: UpdateChannel, allowDowngrade = false) {
    if (channel === 'next') {
      autoUpdater.allowPrerelease = true
      autoUpdater.channel = 'beta'
    } else {
      autoUpdater.allowPrerelease = false
      autoUpdater.channel = 'latest'
    }
    // Set after `channel`: electron-updater's channel setter turns it on.
    autoUpdater.allowDowngrade = allowDowngrade
  }
}
