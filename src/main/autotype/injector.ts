// Sends the platform's paste keystroke to the app that had focus before the
// auto-type popup opened. Pure: no electron, `exec` is injected so tests never
// send real keystrokes.
//
// The value itself is never passed here. It goes through the clipboard, so
// it can't leak via argv (`ps`) or logs.

export type Exec = (file: string, args: string[]) => Promise<string>

/** Whatever we need to hand focus back to the original window. */
export interface Target {
  /** macOS bundle id / X11 window id. */
  id?: string
  /** Shown in the popup and used to suggest entries. */
  name?: string
}

export interface Injector {
  captureTarget(): Promise<Target>
  /** ⌘V / Ctrl+V into the target. */
  paste(target: Target): Promise<void>
  /** ⌘C / Ctrl+C in the target: copies its selection (deidentify). */
  copy(target: Target): Promise<void>
}

/** Build an injector from one `press(target, key)` for the platform's paste/copy chord. */
const withKeys = (
  captureTarget: Injector['captureTarget'],
  press: (target: Target, key: 'v' | 'c') => Promise<void>
): Injector => ({
  captureTarget,
  paste: (target) => press(target, 'v'),
  copy: (target) => press(target, 'c')
})

export class UnsupportedError extends Error {}

const BUNDLE_ID = /^[\w.-]+$/
const X11_WINDOW = /^\d+$/

export const macInjector = (exec: Exec): Injector =>
  withKeys(
    // lsappinfo needs no permission, unlike asking System Events.
    async () => {
      const asn = (await exec('lsappinfo', ['front'])).trim()
      if (!asn) return {}
      const info = await exec('lsappinfo', ['info', '-only', 'bundleid', '-only', 'name', asn])
      const id = /"CFBundleIdentifier"="([^"]*)"/.exec(info)?.[1]
      const name = /"LSDisplayName"="([^"]*)"/.exec(info)?.[1]
      return { id: id && BUNDLE_ID.test(id) ? id : undefined, name }
    },
    async (target, key) => {
      const script: string[] = []
      if (target.id && BUNDLE_ID.test(target.id)) {
        script.push(`tell application id "${target.id}" to activate`, 'delay 0.15')
      }
      script.push(`tell application "System Events" to keystroke "${key}" using command down`)
      await exec(
        'osascript',
        script.flatMap((line) => ['-e', line])
      )
    }
  )

// Hiding the popup hands focus back to the window below it, so there is
// nothing to capture.
export const windowsInjector = (exec: Exec): Injector =>
  withKeys(
    async () => ({}),
    async (_target, key) => {
      await exec('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^${key}')`
      ])
    }
  )

export const x11Injector = (exec: Exec): Injector =>
  withKeys(
    async () => {
      const id = (await exec('xdotool', ['getactivewindow'])).trim()
      if (!X11_WINDOW.test(id)) return {}
      const name = (await exec('xdotool', ['getwindowname', id]).catch(() => '')).trim()
      return { id, name: name || undefined }
    },
    async (target, key) => {
      const args =
        target.id && X11_WINDOW.test(target.id) ? ['windowactivate', '--sync', target.id] : []
      await exec('xdotool', [...args, 'key', '--clearmodifiers', `ctrl+${key}`])
    }
  )

// Wayland lets no one read the focused window; wtype can type into it on
// compositors with the virtual-keyboard protocol (sway, Hyprland, …).
export const waylandInjector = (exec: Exec): Injector =>
  withKeys(
    async () => ({}),
    async (_target, key) => {
      try {
        await exec('wtype', ['-M', 'ctrl', key, '-m', 'ctrl'])
      } catch {
        throw new UnsupportedError('Install wtype to paste automatically on Wayland')
      }
    }
  )

export function createInjector(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  exec: Exec
): Injector {
  if (platform === 'darwin') return macInjector(exec)
  if (platform === 'win32') return windowsInjector(exec)
  if (env.XDG_SESSION_TYPE === 'wayland' || (env.WAYLAND_DISPLAY && !env.DISPLAY)) {
    return waylandInjector(exec)
  }
  return x11Injector(exec)
}
