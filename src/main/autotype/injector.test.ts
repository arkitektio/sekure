import { describe, expect, it, vi } from 'vitest'
import { createInjector, UnsupportedError, type Exec } from './injector'

const fakeExec = (outputs: Record<string, string> = {}) =>
  vi.fn<Exec>(async (file, args) => outputs[[file, ...args].join(' ')] ?? '')

describe('macOS', () => {
  it('captures the frontmost app with lsappinfo', async () => {
    const exec = fakeExec({
      'lsappinfo front': 'ASN:0x0-0x1234:\n',
      'lsappinfo info -only bundleid -only name ASN:0x0-0x1234:':
        '"CFBundleIdentifier"="com.apple.TextEdit"\n"LSDisplayName"="TextEdit"\n'
    })
    const target = await createInjector('darwin', {}, exec).captureTarget()
    expect(target).toEqual({ id: 'com.apple.TextEdit', name: 'TextEdit' })
  })

  it('re-activates the target, then presses ⌘V', async () => {
    const exec = fakeExec()
    await createInjector('darwin', {}, exec).paste({ id: 'com.apple.TextEdit' })
    expect(exec).toHaveBeenCalledWith('osascript', [
      '-e',
      'tell application id "com.apple.TextEdit" to activate',
      '-e',
      'delay 0.15',
      '-e',
      'tell application "System Events" to keystroke "v" using command down'
    ])
  })

  it('drops a bundle id that could break out of the AppleScript string', async () => {
    const exec = fakeExec()
    await createInjector('darwin', {}, exec).paste({ id: 'x" to quit --' })
    expect(exec.mock.calls[0][1]).toEqual([
      '-e',
      'tell application "System Events" to keystroke "v" using command down'
    ])
  })
})

describe('copy (deidentify)', () => {
  it('presses the copy chord on every platform', async () => {
    const mac = fakeExec()
    await createInjector('darwin', {}, mac).copy({ id: 'com.apple.TextEdit' })
    expect(mac.mock.calls[0][1].at(-1)).toBe(
      'tell application "System Events" to keystroke "c" using command down'
    )

    const win = fakeExec()
    await createInjector('win32', {}, win).copy({})
    expect(win.mock.calls[0][1].at(-1)).toContain("SendWait('^c')")

    const x11 = fakeExec()
    await createInjector('linux', { DISPLAY: ':0' }, x11).copy({ id: '42' })
    expect(x11).toHaveBeenLastCalledWith('xdotool', [
      'windowactivate',
      '--sync',
      '42',
      'key',
      '--clearmodifiers',
      'ctrl+c'
    ])

    const wayland = fakeExec()
    await createInjector('linux', { XDG_SESSION_TYPE: 'wayland' }, wayland).copy({})
    expect(wayland).toHaveBeenCalledWith('wtype', ['-M', 'ctrl', 'c', '-m', 'ctrl'])
  })
})

describe('Windows', () => {
  it('sends Ctrl+V through SendKeys', async () => {
    const exec = fakeExec()
    await createInjector('win32', {}, exec).paste({})
    const [file, args] = exec.mock.calls[0]
    expect(file).toBe('powershell.exe')
    expect(args.at(-1)).toContain("SendWait('^v')")
  })
})

describe('Linux', () => {
  it('uses xdotool on X11 and refocuses the captured window', async () => {
    const exec = fakeExec({
      'xdotool getactivewindow': '41943047\n',
      'xdotool getwindowname 41943047': 'GitHub — Mozilla Firefox\n'
    })
    const injector = createInjector('linux', { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, exec)
    const target = await injector.captureTarget()
    expect(target).toEqual({ id: '41943047', name: 'GitHub — Mozilla Firefox' })
    await injector.paste(target)
    expect(exec).toHaveBeenLastCalledWith('xdotool', [
      'windowactivate',
      '--sync',
      '41943047',
      'key',
      '--clearmodifiers',
      'ctrl+v'
    ])
  })

  it('uses wtype on Wayland and reports when it is missing', async () => {
    const exec = vi.fn<Exec>(async () => {
      throw new Error('ENOENT')
    })
    const injector = createInjector('linux', { XDG_SESSION_TYPE: 'wayland' }, exec)
    await expect(injector.paste({})).rejects.toBeInstanceOf(UnsupportedError)
    expect(exec).toHaveBeenCalledWith('wtype', ['-M', 'ctrl', 'v', '-m', 'ctrl'])
  })
})
