import { join } from 'path'
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { APP_ORIGIN } from '../scheme'
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

export const secureWebPreferences: Electron.WebPreferences = {
  preload: join(__dirname, '../preload/index.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  // Chromium's built-in PDF viewer, used to preview PDF attachments.
  plugins: true,
  spellcheck: false
}

/** A password manager never opens pages inside itself. */
export function hardenWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = is.dev && process.env['ELECTRON_RENDERER_URL']
    if (allowed && url.startsWith(allowed)) return
    if (url.startsWith(APP_ORIGIN)) return
    event.preventDefault()
  })
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
    this.ipc.handleChannel('window:setTheme', (_e, _resolved: string, source: string) => {
      nativeTheme.themeSource = source === 'light' || source === 'dark' ? source : 'system'
    })
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
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
      ...chromeOptions,
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: secureWebPreferences
    })
    this.mainWindow = win

    win.on('ready-to-show', () => win.show())
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
