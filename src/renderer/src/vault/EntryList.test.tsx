// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntrySummary, VaultSnapshot } from '../../../main/vault/protocol'

const api = {
  search: {
    query: vi.fn(),
    status: vi.fn(async () => ({ state: 'ready', downloadBytes: 0 })),
    onStatus: vi.fn(() => () => {})
  }
}
vi.stubGlobal('api', api)

const { EntryList } = await import('./EntryList')
const { useVault } = await import('@/stores/vault')

const entry = (uuid: string, title: string, type = 'login'): VaultEntrySummary => ({
  uuid,
  groupUuid: 'root',
  title,
  username: '',
  url: '',
  tags: [],
  icon: 0,
  type,
  subtitle: '',
  hasPassword: false,
  hasOtp: false,
  attachmentCount: 0,
  inRecycleBin: false,
  modified: undefined
})

const snapshot: VaultSnapshot = {
  fileId: 'f',
  fileName: 'v.kdbx',
  dbName: 'V',
  root: { uuid: 'root', name: 'Root', icon: 0, isRecycleBin: false, groups: [], entryCount: 3 },
  entries: [
    entry('a', 'Amazon'),
    entry('p', 'Jane Doe', 'passport'),
    entry('t', 'Travel insurance')
  ],
  dirty: false
}

describe('EntryList search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useVault.setState({ snapshot, search: '', selectedGroup: '__all__' })
  })

  it('lists text matches by score, then semantic ones under “Related”', async () => {
    api.search.query.mockResolvedValue([
      { uuid: 't', score: 1.2, match: 'text' },
      { uuid: 'p', score: 0.84, match: 'semantic' }
    ])
    const user = userEvent.setup()
    render(<EntryList />)
    await user.type(screen.getByPlaceholderText('Search'), 'travel')

    await waitFor(() => expect(screen.getByLabelText('Related entries')).toBeTruthy())
    expect(api.search.query).toHaveBeenLastCalledWith('travel')
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items.map((li) => li.textContent?.trim())).toEqual([
      'Travel insurance',
      'Related',
      'Jane Doe'
    ])
  })

  it('shows everything alphabetically without a query', () => {
    render(<EntryList />)
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items.map((li) => li.textContent?.trim())).toEqual([
      'Amazon',
      'Jane Doe',
      'Travel insurance'
    ])
    expect(api.search.query).not.toHaveBeenCalled()
  })
})
