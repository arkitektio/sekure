import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  Notification,
  systemPreferences
} from 'electron'
import log from 'electron-log'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { WindowManager } from './WindowManager'
import {
  createFloatingPopup,
  delay,
  exec,
  FOCUS_SETTLE_MS,
  isWayland,
  positionPopup,
  restoreClipboard,
  RESTORE_CLIPBOARD_MS,
  saveClipboard
} from './popup'
import { VaultModule } from './VaultModule'
import { createInjector, type Injector, type Target } from '../autotype/injector'
import {
  AUTOTYPE_OPENED_CHANNEL,
  DEFAULT_AUTOTYPE_SETTINGS,
  DEFAULT_AUTOTYPE_SHORTCUT,
  type AutoTypeOpened,
  type AutoTypeSettings,
  type AutoTypeStatus,
  type FillResult
} from '../autotype/protocol'

const POPUP_SIZE = { width: 560, height: 420 }

/**
 * Global auto-type: a system-wide shortcut opens a search popup over whatever
 * app has focus; picking an entry field pastes it there.
 *
 * The popup only sends `(uuid, field)`. The value is revealed here and goes
 * through the clipboard, which is restored right after the paste.
 */
export class AutoTypeModule implements AppModule {
  private settings = new Store<AutoTypeSettings>({
    name: 'autotype',
    defaults: DEFAULT_AUTOTYPE_SETTINGS
  })
  private injector: Injector = createInjector(process.platform, process.env, exec)
  private popup: BrowserWindow | undefined
  private target: Target = {}
  private registered: string | undefined
  /** Set while the popup shows a system prompt (Touch ID), which steals focus. */
  private keepOpen = false
  private changeListeners: (() => void)[] = []

  constructor(
    private ipc: IpcTransport,
    private windows: WindowManager,
    private vault: VaultModule
  ) {}

  setup() {
    // Installs that still have the first default follow the new one.
    if (this.settings.get('shortcut') === 'CommandOrControl+Shift+Space') {
      this.settings.set('shortcut', DEFAULT_AUTOTYPE_SHORTCUT)
    }

    const h = this.ipc.handleChannel.bind(this.ipc)
    h('autotype:fill', (_e, uuid: string, field: string) => this.fill(uuid, field))
    h('autotype:dismiss', () => this.dismiss())
    h('autotype:current', (): AutoTypeOpened => ({ targetName: this.target.name }))
    // While the settings dialog records a new combination, the current one must
    // reach the renderer instead of opening the popup.
    h('autotype:suspend', (_e, suspend: boolean) => {
      if (suspend) {
        if (this.registered) globalShortcut.unregister(this.registered)
        this.registered = undefined
      } else this.register()
    })
    h('autotype:keepOpen', (_e, keep: boolean) => {
      this.keepOpen = keep
    })
    h('autotype:getSettings', () => this.settings.store)
    h('autotype:setSettings', (_e, patch: Partial<AutoTypeSettings>) => {
      const status = this.update(patch)
      for (const cb of this.changeListeners) cb()
      return status
    })
    h('autotype:status', () => this.status())
    h('autotype:requestPermission', () => {
      if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true)
      return this.status()
    })

    if (!this.register()) {
      log.warn(`Auto-type shortcut ${this.settings.get('shortcut')} could not be registered`)
    }

    // A hidden popup must not keep the app alive once the main window is gone.
    this.windows.onMainClosed(() => {
      if (process.platform === 'darwin') return
      this.popup?.destroy()
      this.popup = undefined
    })
  }

  onBeforeQuit() {
    globalShortcut.unregisterAll()
    this.registered = undefined
  }

  // ------------------------------------------------------------ shortcut

  private register(): boolean {
    if (this.registered) globalShortcut.unregister(this.registered)
    this.registered = undefined
    const { enabled, shortcut } = this.settings.store
    if (!enabled) return true
    let ok = false
    try {
      ok = globalShortcut.register(shortcut, () => {
        log.info('Auto-type shortcut pressed')
        this.trigger().catch((e) => log.error('Auto-type popup failed', e))
      })
    } catch (e) {
      log.warn(`Auto-type shortcut ${shortcut} is not a valid accelerator`, e)
    }
    if (ok) this.registered = shortcut
    log.info(`Auto-type shortcut ${shortcut} ${ok ? 'registered' : 'NOT registered'}`)
    return ok
  }

  get currentSettings(): AutoTypeSettings {
    return this.settings.store
  }

  /** The user changed the settings here (not an import from a vault). */
  onSettingsChanged(cb: () => void) {
    this.changeListeners.push(cb)
  }

  /** Settings that came with a vault. A shortcut that can't be registered here is skipped. */
  applySynced(patch: Partial<AutoTypeSettings>) {
    try {
      this.update(patch)
    } catch (e) {
      log.warn('Auto-type settings from the vault not applied', e instanceof Error ? e.message : e)
    }
  }

  private update(patch: Partial<AutoTypeSettings>): AutoTypeStatus {
    const previous = this.settings.store
    this.settings.set({ ...previous, ...patch })
    if (!this.register()) {
      const shortcut = this.settings.get('shortcut')
      this.settings.set(previous)
      this.register()
      throw new Error(`${shortcut} is invalid or already used by another app`)
    }
    return this.status()
  }

  private status(): AutoTypeStatus {
    return {
      registered: !!this.registered,
      permission:
        process.platform === 'darwin'
          ? systemPreferences.isTrustedAccessibilityClient(false)
            ? 'granted'
            : 'denied'
          : 'n/a',
      platformNote: isWayland()
        ? 'On Wayland, global shortcuts depend on your compositor and pasting needs wtype.'
        : undefined
    }
  }

  // ------------------------------------------------------------ popup

  private ensurePopup(): BrowserWindow {
    if (this.popup && !this.popup.isDestroyed()) return this.popup
    this.popup = createFloatingPopup('/quick', POPUP_SIZE, () => this.keepOpen)
    return this.popup
  }

  private async trigger() {
    if (this.popup?.isVisible()) {
      this.dismiss()
      return
    }
    try {
      this.target = await this.injector.captureTarget()
    } catch (e) {
      log.warn('Auto-type: could not read the focused window', e instanceof Error ? e.message : e)
      this.target = {}
    }

    // Not the name: on X11 it is the window title, which can be private.
    log.info(`Auto-type target ${this.target.name ? 'found' : 'unknown'}`)
    const popup = this.ensurePopup()
    positionPopup(popup, POPUP_SIZE)

    // A popup still loading pulls this via `autotype:current` instead.
    if (!popup.webContents.isLoading()) {
      const opened: AutoTypeOpened = { targetName: this.target.name }
      this.ipc.sendTo(popup.webContents, AUTOTYPE_OPENED_CHANNEL, opened)
    }

    this.keepOpen = false
    if (process.platform === 'darwin') app.focus({ steal: true })
    popup.show()
    popup.focus()
  }

  /** Hide the popup and hand focus back to where the user was typing. */
  private dismiss() {
    this.keepOpen = false
    this.popup?.hide()
    // Otherwise macOS keeps Sekure active with no window in front.
    if (process.platform === 'darwin' && !this.windows.mainWindowVisible) app.hide()
  }

  // ------------------------------------------------------------ fill

  private async fill(uuid: string, field: string): Promise<FillResult> {
    const value = this.vault.revealForAutoType(uuid, field)
    this.dismiss()

    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      systemPreferences.isTrustedAccessibilityClient(true)
      return this.fallback(value)
    }

    const saved = saveClipboard()
    // A secret Sekure copied earlier is never put back: its 30 s clear may
    // fire during the paste, and a restored copy would then stay forever.
    const savedIsSecret = this.vault.ownsClipboard()
    clipboard.writeText(value)
    try {
      await delay(FOCUS_SETTLE_MS)
      await this.injector.paste(this.target)
    } catch (e) {
      // The error names the command only; the value never is on a command line.
      log.warn('Auto-type paste failed', e instanceof Error ? e.message : e)
      return this.fallback(value)
    }
    setTimeout(() => {
      if (clipboard.readText() !== value) return
      if (savedIsSecret) clipboard.clear()
      else restoreClipboard(saved)
    }, RESTORE_CLIPBOARD_MS)
    return { pasted: true }
  }

  /** Could not paste: leave the value on the clipboard (cleared after 30 s). */
  private fallback(value: string): FillResult {
    this.vault.copy(value)
    if (Notification.isSupported()) {
      const keys = process.platform === 'darwin' ? '⌘V' : 'Ctrl+V'
      new Notification({
        title: `Press ${keys} to paste`,
        body: 'Sekure could not paste automatically. The clipboard clears in 30 seconds.',
        silent: true
      }).show()
    }
    return { pasted: false }
  }
}
