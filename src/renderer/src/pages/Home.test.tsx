// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  vault: { state: vi.fn(async () => ({ open: false })) },
  sources: { recent: vi.fn(), forget: vi.fn(), pickLocal: vi.fn() },
  auth: { login: vi.fn(), cancel: vi.fn() }
}
vi.stubGlobal('api', api)

const { Home } = await import('./Home')
const { useAuth } = await import('@/stores/auth')

const show = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/unlock/:id" element={<div>unlock screen</div>} />
      </Routes>
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.setState({ status: { connected: false, configured: true } } as never)
})

describe('welcome screen', () => {
  it('offers the vaults used before as cards, the last one focused', async () => {
    api.sources.recent.mockResolvedValue([
      {
        id: 'local:/v/personal.kdbx',
        kind: 'local',
        name: 'Personal.kdbx',
        location: '/v',
        openedAt: ''
      },
      { id: 'drive-1', kind: 'drive', name: 'Family.kdbx', location: 'Google Drive', openedAt: '' }
    ])
    const user = userEvent.setup()
    show()
    expect(await screen.findByText('Welcome back')).toBeTruthy()
    const card = screen.getByText('Personal').closest('button')!
    expect(card).toHaveFocus()
    // Drive vaults need Google; without a connection only local files are offered.
    expect(screen.queryByText('Family')).toBeNull()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('unlock screen')).toBeTruthy()
  })

  it('starts first-timers with opening a file or connecting Drive', async () => {
    api.sources.recent.mockResolvedValue([])
    show()
    expect(await screen.findByText(/get you started/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Open a vault file/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Connect Google Drive/ })).toBeTruthy()
  })
})
