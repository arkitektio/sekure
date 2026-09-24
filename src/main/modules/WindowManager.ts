import { join } from 'path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { APP_ORIGIN } from '../scheme'
import { externalUrl } from '../lib/urls'
import { isAppUrl } from '../lib/appOrigin'
import { WINDOW_STATE_CHANNEL, type WindowState } from '../window/protocol'
import icon from '../../../build/icon.png?asset'

/**
 * Per-platform frame, as in orkestrator: the renderer draws the title bar.
 * macOS keeps its traffic lights, inset into the sidebar's top gap.
 */
const chromeOptions: Electron.BrowserWindowConstructorOptions =
  process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 14 } }
    : process.platform === 'win32'
      ? { titleBarStyle: 'hidden' }
      : { frame: false }

/** Glass (macOS vibrancy, Windows acrylic) needs a see-through window background. */
const canGlass = process.platform === 'darwin' || process.platform === 'win32'
const TRANSPARENT = '#00000000'
/** Opaque window background without glass; matches `--sidebar`, which Electron can't parse. */
const solidBackground = () => (nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f9fafa')

const glassOptions = (on: boolean): Electron.BrowserWindowConstructorOptions =>
  !on || !canGlass
    ? { backgroundColor: solidBackground() }
    : process.platform === 'darwin'
      ? { vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: TRANSPARENT }
      : { backgroundMaterial: 'acrylic', backgroundColor: TRANSPARENT }

function applyGlass(win: BrowserWindow, on: boolean) {
  const glass = on && canGlass
  if (process.platform === 'darwin') win.setVibrancy(glass ? 'sidebar' : null)
  if (process.platform === 'win32') win.setBackgroundMaterial(glass ? 'acrylic' : 'none')
  win.setBackgroundColor(glass ? TRANSPARENT : solidBackground())
}

export const secureWebPreferences: Electron.WebPreferences = {
  preload: join(__dirname, '../preload/index.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  // Chromium's built-in PDF viewer, used to preview PDF attachments.
  plugins: true,
  spellcheck: false,
  // The default menu's "Toggle Developer Tools" would otherwise work in a release.
  devTools: !app.isPackaged
}

/** A password manager never opens pages inside itself. */
export function hardenWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    const safe = externalUrl(url)
    if (safe && /^https?:\/\//i.test(url)) void shell.openExternal(safe)
    return { action: 'deny' }
  })
  const guard = (event: Electron.Event, url: string) => {
    if (!isAppUrl(url)) event.preventDefault()
  }
  win.webContents.on('will-navigate', guard)
  win.webContents.on('will-redirect', guard)
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

/** Load the renderer at a hash route (`/quick` → `#/quick`). */
export function loadRoute(win: BrowserWindow, route = '') {
  const hash = route ? `#${route}` : ''
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash}`)
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html${hash}`)
  }
}

export class WindowManager implements AppModule {
  private mainWindow: BrowserWindow | null = null
  private mainClosedListeners: (() => void)[] = []
  /** Device-only chrome preference: the glass sidebar (default on). */
  private chrome = new Store<{ glass: boolean }>({ name: 'window', defaults: { glass: true } })

  constructor(private ipc: IpcTransport) {}

  setup() {
    this.ipc.handleChannel('window:minimize', (e) =>
      BrowserWindow.fromWebContents(e.sender)?.minimize()
    )
    this.ipc.handleChannel('window:toggleMaximize', (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    })
    this.ipc.handleChannel('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
    this.ipc.handleChannel('window:platform', () => process.platform)
    this.ipc.handleChannel('window:getGlass', () => canGlass && this.chrome.get('glass'))
    this.ipc.handleChannel('window:setGlass', (_e, on: unknown) => {
      if (typeof on !== 'boolean') throw new Error('Expected a boolean')
      this.chrome.set('glass', on)
      if (this.mainWindow) applyGlass(this.mainWindow, on)
      return canGlass && on
    })
    this.ipc.handleChannel('window:state', (e): WindowState => ({
      fullscreen: !!BrowserWindow.fromWebContents(e.sender)?.isFullScreen()
    }))
    // Entry URLs: validated here, never window.open from the renderer.
    this.ipc.handleChannel('shell:openUrl', async (_e, raw: unknown) => {
      const url = typeof raw === 'string' ? externalUrl(raw) : undefined
      if (!url) throw new Error('Only http and https links can be opened')
      await shell.openExternal(url)
    })
    this.ipc.handleChannel('window:setTheme', (_e, _resolved: string, source: string) => {
      nativeTheme.themeSource = source === 'light' || source === 'dark' ? source : 'system'
      if (this.mainWindow && !(canGlass && this.chrome.get('glass')))
        this.mainWindow.setBackgroundColor(solidBackground())
    })
    // Packaged builds take the icon from the bundle; in dev the Dock would show Electron's.
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon)
    this.createMainWindow()
  }

  onActivate() {
    // Not getAllWindows(): the hidden auto-type popup counts as a window.
    if (!this.mainWindow) this.createMainWindow()
  }

  /** Called when the main window closes (the popup must not keep the app alive). */
  onMainClosed(cb: () => void) {
    this.mainClosedListeners.push(cb)
  }

  onSecondInstance() {
    if (!this.mainWindow) return
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.focus()
  }

  get mainWindowVisible(): boolean {
    return !!this.mainWindow && this.mainWindow.isVisible() && !this.mainWindow.isMinimized()
  }

  getAllWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows()
  }

  broadcast(channel: string, ...args: unknown[]) {
    for (const win of this.getAllWindows()) {
      if (win.isDestroyed()) continue
      this.ipc.sendTo(win.webContents, channel, ...args)
    }
  }

  createMainWindow() {
    const win = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 760,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      ...glassOptions(this.chrome.get('glass')),
      ...chromeOptions,
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: secureWebPreferences
    })
    this.mainWindow = win

    win.on('ready-to-show', () => win.show())
    const sendState = () =>
      this.ipc.sendTo(win.webContents, WINDOW_STATE_CHANNEL, {
        fullscreen: win.isFullScreen()
      } satisfies WindowState)
    win.on('enter-full-screen', sendState)
    win.on('leave-full-screen', sendState)
    win.on('closed', () => {
      if (this.mainWindow !== win) return
      this.mainWindow = null
      for (const cb of this.mainClosedListeners) cb()
    })

    hardenWindow(win)
    loadRoute(win)
    return win
  }
}
