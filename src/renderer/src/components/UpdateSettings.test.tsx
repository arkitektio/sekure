// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../../../main/updater/protocol'

let push: ((s: UpdateState) => void) | undefined
const api = {
  updater: {
    state: vi.fn(),
    check: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    setChannel: vi.fn(async () => {}),
    onState: vi.fn((cb: (s: UpdateState) => void) => {
      push = cb
      return () => {}
    })
  },
  vault: { save: vi.fn(async () => ({ merged: false })) }
}
vi.stubGlobal('api', api)

const { UpdateReady } = await import('./UpdateReady')
const { UpdateSettings } = await import('./UpdateSettings')
const { useVault } = await import('@/stores/vault')

const state = (patch: Partial<UpdateState> = {}): UpdateState => ({
  phase: 'upToDate',
  current: '1.2.0',
  channel: 'latest',
  ...patch
})

beforeEach(() => {
  vi.clearAllMocks()
  useVault.getState().reset()
})

describe('update ready row', () => {
  it('appears once an update has downloaded', async () => {
    api.updater.state.mockResolvedValue(state({ phase: 'downloading', version: '1.3.0' }))
    render(<UpdateReady />)
    await waitFor(() => expect(api.updater.state).toHaveBeenCalled())
    expect(screen.queryByText(/is ready/)).toBeNull()
    act(() => push?.(state({ phase: 'ready', version: '1.3.0' })))
    expect(screen.getByText('Sekure 1.3.0 is ready')).toBeTruthy()
  })

  it('saves unsaved changes before restarting', async () => {
    api.updater.state.mockResolvedValue(state({ phase: 'ready', version: '1.3.0' }))
    useVault.setState({ snapshot: { dirty: true } as never })
    const user = userEvent.setup()
    render(<UpdateReady />)
    await user.click(await screen.findByRole('button', { name: /is ready/ }))
    expect(api.vault.save).toHaveBeenCalled()
    expect(api.updater.install).toHaveBeenCalled()
    expect(api.vault.save.mock.invocationCallOrder[0]).toBeLessThan(
      api.updater.install.mock.invocationCallOrder[0]
    )
  })

  it('does not restart when saving fails', async () => {
    api.updater.state.mockResolvedValue(state({ phase: 'ready', version: '1.3.0' }))
    api.vault.save.mockRejectedValueOnce(new Error('disk full'))
    useVault.setState({ snapshot: { dirty: true } as never })
    const user = userEvent.setup()
    render(<UpdateReady />)
    await user.click(await screen.findByRole('button', { name: /is ready/ }))
    expect(api.updater.install).not.toHaveBeenCalled()
  })
})

describe('update settings', () => {
  it('shows the version and switches the channel', async () => {
    api.updater.state.mockResolvedValue(state())
    const user = userEvent.setup()
    render(<UpdateSettings />)
    expect(await screen.findByText('Sekure 1.2.0')).toBeTruthy()
    expect(screen.getByText('Sekure is up to date.')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Stable/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: /Next/ }))
    expect(api.updater.setChannel).toHaveBeenCalledWith('next')
    await user.click(screen.getByRole('button', { name: /Check now/ }))
    expect(api.updater.check).toHaveBeenCalled()
  })

  it('says updates are off in development builds', async () => {
    api.updater.state.mockResolvedValue(state({ phase: 'disabled' }))
    render(<UpdateSettings />)
    expect(await screen.findByText(/off in development/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Check now/ })).toBeDisabled()
  })
})
