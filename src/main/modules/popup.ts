import { execFile } from 'child_process'
import { BrowserWindow, clipboard, nativeTheme, screen } from 'electron'
import type { Exec } from '../autotype/injector'
import { hardenWindow, loadRoute, secureWebPreferences } from './WindowManager'

/** How long a value we pasted stays on the clipboard before the old content is back. */
export const RESTORE_CLIPBOARD_MS = 400
/** Let a popup hide and focus settle before sending a keystroke. */
export const FOCUS_SETTLE_MS = 80

export const exec: Exec = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 5000, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout))
    )
  )

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type SavedClipboard = Parameters<typeof clipboard.write>[0]

export function saveClipboard(): SavedClipboard {
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

export function restoreClipboard(saved: SavedClipboard) {
  if (Object.keys(saved).length) clipboard.write(saved)
  else clipboard.clear()
}

export const isWayland = () =>
  process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' ||
    (!!process.env.WAYLAND_DISPLAY && !process.env.DISPLAY))

/**
 * A frameless window floating over whatever app has focus (and over full-screen
 * apps on macOS), hidden on blur unless `keepOpen()` says otherwise.
 */
export function createFloatingPopup(
  route: string,
  size: { width: number; height: number },
  keepOpen: () => boolean
): BrowserWindow {
  const win = new BrowserWindow({
    ...size,
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
    if (!keepOpen()) win.hide()
  })
  hardenWindow(win)
  loadRoute(win, route)
  return win
}

/** Center horizontally, a fifth down, on the display under the cursor. */
export function positionPopup(win: BrowserWindow, size: { width: number; height: number }) {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + workArea.height * 0.2),
    ...size
  })
}
