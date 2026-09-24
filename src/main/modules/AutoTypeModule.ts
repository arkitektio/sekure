import { execFile } from 'child_process'
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  nativeTheme,
  Notification,
  screen,
  systemPreferences
} from 'electron'
import log from 'electron-log'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { hardenWindow, loadRoute, secureWebPreferences, WindowManager } from './WindowManager'
import { VaultModule } from './VaultModule'
import { createInjector, type Exec, type Injector, type Target } from '../autotype/injector'
import {
  AUTOTYPE_OPENED_CHANNEL,
  DEFAULT_AUTOTYPE_SETTINGS,
  DEFAULT_AUTOTYPE_SHORTCUT,
  type AutoTypeOpened,
  type AutoTypeSettings,
  type AutoTypeStatus,
  type FillResult
} from '../autotype/protocol'

const POPUP_WIDTH = 560
const POPUP_HEIGHT = 420
/** How long the pasted value stays on the clipboard before the old content is back. */
const RESTORE_CLIPBOARD_MS = 400
/** Let the popup hide and focus settle before the keystroke. */
const FOCUS_SETTLE_MS = 80

const exec: Exec = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 5000, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout))
    )
  )

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

type SavedClipboard = Parameters<typeof clipboard.write>[0]

function saveClipboard(): SavedClipboard {
  const saved: SavedClipboard = {}
  const text = clipboard.readText()
  const html = clipboard.readHTML()
  const rtf = clipboard.readRTF()
  const image = clipboard.readImage()
  if (text) saved.text = text
  if (html) saved.html = html
  if (rtf) saved.rtf = rtf
  if (!image.isEmpty()) saved.image = image
  return saved
}

function restoreClipboard(saved: SavedClipboard) {
  if (Object.keys(saved).length) clipboard.write(saved)
  else clipboard.clear()
}

const isWayland = () =>
  process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' ||
    (!!process.env.WAYLAND_DISPLAY && !process.env.DISPLAY))

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
    const win = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // An NSPanel floats over full-screen apps without switching Spaces.
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
      webPreferences: secureWebPreferences
    })
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.on('blur', () => {
      if (!this.keepOpen) win.hide()
    })
    hardenWindow(win)
    loadRoute(win, '/quick')
    this.popup = win
    return win
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

    log.info('Auto-type target', this.target.name ?? '(unknown)')
    const popup = this.ensurePopup()
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    popup.setBounds({
      x: Math.round(workArea.x + (workArea.width - POPUP_WIDTH) / 2),
      y: Math.round(workArea.y + workArea.height * 0.2),
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT
    })

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
      if (clipboard.readText() === value) restoreClipboard(saved)
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
