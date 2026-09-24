// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  vault: { state: vi.fn(async () => ({ open: false })) },
  sources: { recent: vi.fn(), forget: vi.fn(), pickLocal: vi.fn() }
}
vi.stubGlobal('api', api)

const { Home } = await import('./Home')

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
      {
        id: 'local:/v/family.kdbx',
        kind: 'local',
        name: 'Family.kdbx',
        location: '/v',
        openedAt: ''
      }
    ])
    const user = userEvent.setup()
    show()
    expect(await screen.findByText('Welcome back')).toBeTruthy()
    const card = screen.getByText('Personal').closest('button')!
    expect(card).toHaveFocus()
    expect(screen.getByText('Family')).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('unlock screen')).toBeTruthy()
  })

  it('starts first-timers with opening a vault file', async () => {
    api.sources.recent.mockResolvedValue([])
    show()
    expect(await screen.findByText(/get you started/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Open a vault file/ })).toBeTruthy()
    expect(screen.queryByText(/Google Drive…|Connect Google/)).toBeNull()
  })
})
