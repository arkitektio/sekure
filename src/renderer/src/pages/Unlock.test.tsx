// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  sources: { describe: vi.fn() },
  biometric: {
    available: vi.fn(),
    enabled: vi.fn(),
    unlock: vi.fn(),
    enable: vi.fn()
  },
  vault: { open: vi.fn() }
}
vi.stubGlobal('api', api)

const { Unlock } = await import('./Unlock')

const snapshot = {
  fileId: 'f1',
  fileName: 'Vault.kdbx',
  dbName: 'Vault',
  root: { uuid: 'r', name: 'Root', icon: 0, isRecycleBin: false, groups: [], entryCount: 0 },
  entries: [],
  dirty: false
}

function renderUnlock() {
  return render(
    <MemoryRouter initialEntries={['/unlock/f1']}>
      <Routes>
        <Route path="/unlock/:fileId" element={<Unlock />} />
        <Route path="/vault" element={<div>VAULT OPEN</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.sources.describe.mockResolvedValue({
    id: 'f1',
    kind: 'drive',
    name: 'Vault.kdbx',
    location: 'Google Drive'
  })
})

describe('Unlock', () => {
  it('shows a friendly error for a wrong password', async () => {
    api.biometric.available.mockResolvedValue(false)
    api.biometric.enabled.mockResolvedValue(false)
    api.vault.open.mockRejectedValue(
      new Error(
        "Error invoking remote method 'vault:open': Error: InvalidKey: Wrong password or key file"
      )
    )
    renderUnlock()
    await screen.findByText('Vault.kdbx')
    await userEvent.type(screen.getByPlaceholderText('Master password'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('Wrong password or key file.')).toBeInTheDocument()
    expect(screen.queryByText(/Touch ID/)).not.toBeInTheDocument()
  })

  it('auto-prompts Touch ID when enabled for this vault', async () => {
    api.biometric.available.mockResolvedValue(true)
    api.biometric.enabled.mockResolvedValue(true)
    api.biometric.unlock.mockResolvedValue(snapshot)
    renderUnlock()
    expect(await screen.findByText('VAULT OPEN')).toBeInTheDocument()
    expect(api.biometric.unlock).toHaveBeenCalledTimes(1)
    expect(api.biometric.unlock).toHaveBeenCalledWith('f1')
  })

  it('offers Touch ID enrolment after a password unlock', async () => {
    api.biometric.available.mockResolvedValue(true)
    api.biometric.enabled.mockResolvedValue(false)
    api.vault.open.mockResolvedValue(snapshot)
    api.biometric.enable.mockResolvedValue(undefined)
    renderUnlock()
    await screen.findByText('Unlock with Touch ID next time')
    await userEvent.type(screen.getByPlaceholderText('Master password'), 'hunter2')
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    // Main keeps the credentials from this open; the password is sent once.
    expect(api.vault.open).toHaveBeenCalledWith({
      fileId: 'f1',
      password: 'hunter2',
      keyFile: undefined,
      enableBiometric: true
    })
    await waitFor(() => expect(api.biometric.enable).toHaveBeenCalledWith('f1'))
    expect(await screen.findByText('VAULT OPEN')).toBeInTheDocument()
  })
})
