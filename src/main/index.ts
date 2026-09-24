import { stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { extname, join, normalize, sep } from 'path'
import { Readable } from 'stream'
import { app, protocol } from 'electron'
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
import { PreferencesModule } from './modules/PreferencesModule'
import { APP_SCHEME } from './scheme'

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

// Isolated profile for e2e runs / side-by-side dev instances. Must run before
// any electron-store is constructed (they read userData on creation).
if (process.env.SEKURE_USER_DATA) app.setPath('userData', process.env.SEKURE_USER_DATA)

log.initialize()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('io.jhnnsrs.sekure')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Serve the built renderer from out/renderer, confined to that folder.
    const rendererRoot = normalize(join(__dirname, '../renderer'))
    protocol.handle(APP_SCHEME, async (request) => {
      let pathname = decodeURIComponent(new URL(request.url).pathname)
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
            'Content-Length': String(s.size)
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
    manager.register(new PreferencesModule(ipc, windows, vault, autotype))
    if (app.isPackaged) manager.register(new AppUpdater(ipc, windows))
    manager.register(windows)
    await manager.setup()
  })
}
