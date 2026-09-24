import { stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { extname, join, normalize, sep } from 'path'
import { Readable } from 'stream'
import { app, Menu, protocol, session } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import log from 'electron-log'
import { AppManager } from './modules/AppManager'
import { IpcTransport } from './modules/IpcTransport'
import { WindowManager } from './modules/WindowManager'
import { AppUpdater } from './modules/AppUpdater'
import { GoogleAuthModule } from './modules/GoogleAuthModule'
import { DriveModule } from './modules/DriveModule'
import { SourcesModule } from './modules/SourcesModule'
import { isLocalId } from './sources/protocol'
import { VaultModule } from './modules/VaultModule'
import { BiometricModule } from './modules/BiometricModule'
import { AutoTypeModule } from './modules/AutoTypeModule'
import { SearchModule } from './modules/SearchModule'
import { DeidentifyModule } from './modules/DeidentifyModule'
import { PreferencesModule } from './modules/PreferencesModule'
import { APP_SCHEME, CONTENT_SECURITY_POLICY } from './scheme'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
}

// Must run before 'ready'.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

// A release must not run with a debugger attached: --inspect or a remote
// debugging port would let any local process drive main (and read the
// safeStorage secrets) under Sekure's signature. The fuses in
// electron-builder.yml already ignore --inspect; this also covers Chromium's
// switches.
if (
  app.isPackaged &&
  process.argv.some((a) => /^--(inspect|remote-debugging-port|remote-debugging-pipe)/.test(a))
) {
  app.exit(1)
}

// Isolated profile for e2e runs / side-by-side dev instances. Must run before
// any electron-store is constructed (they read userData on creation). Never in
// a release: it would also split the single-instance lock.
if (!app.isPackaged && process.env.SEKURE_USER_DATA) {
  app.setPath('userData', process.env.SEKURE_USER_DATA)
}

log.initialize()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('io.jhnnsrs.sekure')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Deny every permission (clipboard-read, notifications, media, HID…).
    // Copying goes through main, so the renderer needs none of them.
    const ses = session.defaultSession
    ses.setPermissionRequestHandler((_wc, permission, cb) =>
      cb(permission === 'clipboard-sanitized-write')
    )
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
    ses.setDevicePermissionHandler(() => false)

    // Any webContents we did not create ourselves still gets the window
    // guards (no new windows, no navigation away, no <webview>).
    app.on('web-contents-created', (_, contents) => {
      contents.on('will-attach-webview', (event) => event.preventDefault())
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    })

    // No default menu in a release (it has "Toggle Developer Tools"). macOS
    // keeps a minimal one for Quit, Edit shortcuts and window handling.
    if (app.isPackaged) {
      Menu.setApplicationMenu(
        process.platform === 'darwin'
          ? Menu.buildFromTemplate([
              { role: 'appMenu' },
              { role: 'editMenu' },
              { role: 'windowMenu' }
            ])
          : null
      )
    }

    // Serve the built renderer from out/renderer, confined to that folder.
    const rendererRoot = normalize(join(__dirname, '../renderer'))
    protocol.handle(APP_SCHEME, async (request) => {
      const url = new URL(request.url)
      if (url.host !== 'bundle') return new Response('Not Found', { status: 404 })
      let pathname: string
      try {
        pathname = decodeURIComponent(url.pathname)
      } catch {
        return new Response('Bad Request', { status: 400 })
      }
      if (pathname === '/' || pathname === '') pathname = '/index.html'
      const filePath = normalize(join(rendererRoot, pathname))
      if (!filePath.startsWith(rendererRoot + sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      try {
        const s = await stat(filePath)
        if (!s.isFile()) return new Response('Not Found', { status: 404 })
        return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
          headers: {
            'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
            'Content-Length': String(s.size),
            'Content-Security-Policy': CONTENT_SECURITY_POLICY,
            'X-Content-Type-Options': 'nosniff'
          }
        })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    })

    const ipc = new IpcTransport()
    const windows = new WindowManager(ipc)
    const auth = new GoogleAuthModule(ipc)
    const drive = new DriveModule(ipc, auth)
    const sources = new SourcesModule(ipc, drive, auth)
    const vault = new VaultModule(ipc, windows, sources)

    auth.onStatusChange((status) => {
      windows.broadcast('auth:changed', status)
      // Disconnecting Drive closes a vault that came from it (local ones stay).
      const open = vault.openFileId
      if (!status.connected && open && !isLocalId(open)) vault.lock('manual')
    })

    const manager = new AppManager()
    manager.register(auth)
    manager.register(drive)
    manager.register(sources)
    manager.register(vault)
    manager.register(new BiometricModule(ipc, vault))
    manager.register(new SearchModule(ipc, windows, vault))
    const autotype = new AutoTypeModule(ipc, windows, vault)
    manager.register(autotype)
    manager.register(new DeidentifyModule(ipc, windows, vault, autotype))
    manager.register(new PreferencesModule(ipc, windows, vault, autotype))
    if (app.isPackaged) manager.register(new AppUpdater(ipc, windows))
    manager.register(windows)
    await manager.setup()
  })
}
