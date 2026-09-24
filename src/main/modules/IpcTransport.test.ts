import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { on: vi.fn(), handle: vi.fn() } }))
vi.mock('electron-log', () => ({ default: { warn: vi.fn() } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { isTrustedSender } = await import('./IpcTransport')

const event = (url: string, top = true) => {
  const mainFrame = { url }
  return {
    sender: { mainFrame },
    senderFrame: top ? mainFrame : { url }
  } as unknown as Parameters<typeof isTrustedSender>[0]
}

describe('isTrustedSender', () => {
  it('accepts the top frame of the app bundle', () => {
    expect(isTrustedSender(event('app://bundle/index.html#/vault'))).toBe(true)
  })

  it('refuses subframes, other origins and look-alikes', () => {
    expect(isTrustedSender(event('app://bundle/index.html', false))).toBe(false)
    expect(isTrustedSender(event('https://evil.example/'))).toBe(false)
    expect(isTrustedSender(event('app://bundle.evil/index.html'))).toBe(false)
    expect(isTrustedSender(event('http://localhost:5173/'))).toBe(false)
    expect(
      isTrustedSender({ sender: { mainFrame: {} }, senderFrame: null } as unknown as Parameters<
        typeof isTrustedSender
      >[0])
    ).toBe(false)
  })
})
