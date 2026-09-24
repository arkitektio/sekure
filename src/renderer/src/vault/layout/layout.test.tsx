// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntrySummary, VaultSnapshot } from '../../../../main/vault/protocol'

const api = {
  search: {
    query: vi.fn(),
    suggestTypes: vi.fn(async () => [] as { typeId: string; score: number }[]),
    status: vi.fn(async () => ({ state: 'ready' })),
    onStatus: vi.fn(() => () => {})
  },
  sources: {
    recent: vi.fn(async () => [
      { id: 'local:/v/work.kdbx', kind: 'local', name: 'work.kdbx', location: '/v', openedAt: '' },
      { id: 'drive-1', kind: 'drive', name: 'Family.kdbx', location: 'Google Drive', openedAt: '' }
    ]),
    pickLocal: vi.fn()
  },
  vault: {
    lock: vi.fn(async () => {}),
    save: vi.fn(),
    copy: vi.fn(),
    setPeople: vi.fn(async () => {})
  },
  windowControls: { platform: vi.fn(async () => 'darwin') }
}
vi.stubGlobal('api', api)
// jsdom does not lay out, so it has no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn()

const { SearchPill } = await import('../SearchPalette')
const { ListPage } = await import('../pages/ListPage')
const { VaultSwitcher } = await import('./VaultSwitcher')
const { HomePage } = await import('../pages/HomePage')
const { RailTiles } = await import('./RailTiles')
const { CreatePage } = await import('../pages/CreatePage')
const { EntryPeople } = await import('../PeoplePicker')
const { useVault, activePage } = await import('@/stores/vault')
const { usePalette } = await import('@/stores/palette')
const { useAuth } = await import('@/stores/auth')
const { TooltipProvider } = await import('@/components/ui/tooltip')

const entry = (
  uuid: string,
  title: string,
  type = 'login',
  groupUuid = 'root'
): VaultEntrySummary => ({
  uuid,
  groupUuid,
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
  modified: undefined,
  people: []
})

const snapshot: VaultSnapshot = {
  fileId: 'local:/v/personal.kdbx',
  fileName: 'personal.kdbx',
  dbName: 'Personal',
  root: {
    uuid: 'root',
    name: 'Root',
    icon: 0,
    isRecycleBin: false,
    entryCount: 3,
    groups: [
      { uuid: 'work', name: 'Work', icon: 48, isRecycleBin: false, groups: [], entryCount: 1 }
    ]
  },
  entries: [
    { ...entry('a', 'Amazon'), people: ['jane'] },
    { ...entry('p', 'Jane Doe', 'passport'), subtitle: 'Jane Doe' },
    entry('t', 'Travel insurance', 'login', 'work'),
    { ...entry('jane', '', 'personalDetails'), subtitle: 'Jane Doe' }
  ],
  dirty: false
}

const inRouter = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  useVault.getState().reset()
  useVault.getState().setSnapshot(snapshot)
  usePalette.getState().hide()
})

describe('search palette', () => {
  it('ranks matches, then related ones, and opens a result in the current tab', async () => {
    api.search.query.mockResolvedValue([
      { uuid: 't', score: 1.2, match: 'text' },
      { uuid: 'p', score: 0.84, match: 'semantic' }
    ])
    const user = userEvent.setup()
    inRouter(<SearchPill />)
    await user.click(screen.getByRole('button', { name: 'Search vault' }))
    await user.type(screen.getByPlaceholderText(/Search entries/), 'travel')

    const related = await screen.findByText('Related')
    expect(related).toBeTruthy()
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options[0]).toContain('Travel insurance')
    expect(options[1]).toContain('Jane Doe')

    await user.click(screen.getAllByRole('option')[0])
    expect(activePage(useVault.getState())).toEqual({ kind: 'entry', uuid: 't' })
    expect(useVault.getState().tabs).toHaveLength(1)
    expect(usePalette.getState().open).toBe(false)
  })

  it('opens a result in a new tab with ⌘Enter', async () => {
    api.search.query.mockResolvedValue([{ uuid: 'a', score: 1, match: 'text' }])
    const user = userEvent.setup()
    inRouter(<SearchPill />)
    usePalette.getState().show('ama')
    await screen.findByText('Amazon')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    const state = useVault.getState()
    expect(state.tabs).toHaveLength(2)
    expect(activePage(state)).toEqual({ kind: 'entry', uuid: 'a' })
  })

  it('offers to add a recognised tax ID, prefilled', async () => {
    api.search.query.mockResolvedValue([])
    const user = userEvent.setup()
    inRouter(<SearchPill />)
    usePalette.getState().show('12-3456789')
    const add = await screen.findByRole('option', { name: /Add Tax ID/ })
    expect(add).toHaveTextContent('US EIN')
    // A recognised number needs no semantic guess.
    expect(api.search.suggestTypes).not.toHaveBeenCalled()
    await user.click(add)
    expect(activePage(useVault.getState())).toEqual({
      kind: 'new',
      type: 'taxId',
      group: undefined,
      prefill: { 'Tax ID number': '12-3456789', 'ID kind': 'EIN', Country: 'US' }
    })
  })

  it('adds types the local model finds by meaning', async () => {
    api.search.query.mockResolvedValue([])
    api.search.suggestTypes.mockResolvedValue([{ typeId: 'healthInsurance', score: 0.85 }])
    inRouter(<SearchPill />)
    usePalette.getState().show('my doctor card')
    expect(await screen.findByRole('option', { name: /Add Health insurance/ })).toBeTruthy()
    expect(api.search.suggestTypes).toHaveBeenLastCalledWith('my doctor card')
  })
})

describe('list page', () => {
  it('shows a group, and opens entries in this tab or, with ⌘, in the background', async () => {
    const user = userEvent.setup()
    inRouter(<ListPage scope="work" />)
    expect(screen.getByRole('heading', { name: 'Work' })).toBeTruthy()
    const list = within(screen.getByRole('list'))
    expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Travel insurance')
    ])

    await user.keyboard('{Meta>}')
    await user.click(list.getByText('Travel insurance'))
    await user.keyboard('{/Meta}')
    let state = useVault.getState()
    expect(state.tabs).toHaveLength(2)
    expect(activePage(state)).toEqual({ kind: 'home' })

    await user.click(list.getByText('Travel insurance'))
    state = useVault.getState()
    expect(activePage(state)).toEqual({ kind: 'entry', uuid: 't' })
  })

  it('filters a category by entry type', () => {
    inRouter(<ListPage scope="type:passport" />)
    expect(screen.getByRole('heading', { name: 'Passport' })).toBeTruthy()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('vault switcher', () => {
  it('lists recent vaults and switches by locking, then opening the other', async () => {
    useAuth.setState({ status: { connected: true } } as never)
    const user = userEvent.setup()
    inRouter(<VaultSwitcher />)
    await user.click(screen.getByRole('button', { name: 'Switch vault' }))
    const family = await screen.findByRole('menuitem', { name: /Family/ })
    expect(screen.getByRole('menuitem', { name: /work/ })).toBeTruthy()

    let target: string | undefined
    api.vault.lock.mockImplementation(async () => {
      target = useVault.getState().switchTarget
    })
    await user.click(family)
    await waitFor(() => expect(api.vault.lock).toHaveBeenCalled())
    expect(target).toBe('/unlock/drive-1')
  })
})

describe('home and rail tiles', () => {
  it('browses categories and groups from Home, not from the rail', async () => {
    const user = userEvent.setup()
    inRouter(<HomePage />)
    // Categories in use, with counts; groups as a tree.
    await user.click(screen.getByRole('button', { name: /Passport\s*1/ }))
    expect(activePage(useVault.getState())).toEqual({ kind: 'list', scope: 'type:passport' })
    useVault.getState().back()
    await user.click(screen.getByRole('button', { name: 'Work' }))
    expect(activePage(useVault.getState())).toEqual({ kind: 'list', scope: 'work' })
  })

  it('goes Home or to all entries from the tiles', async () => {
    const user = userEvent.setup()
    inRouter(<RailTiles />)
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: 'All entries' }))
    expect(activePage(useVault.getState())).toEqual({ kind: 'list', scope: '__all__' })
    await user.click(screen.getByRole('button', { name: 'New entry' }))
    expect(activePage(useVault.getState())).toEqual({ kind: 'create' })
  })
})

describe('new-entry wizard', () => {
  it('asks what to save and fills the form from a recognised number', async () => {
    api.search.query.mockResolvedValue([])
    const user = userEvent.setup()
    useVault.getState().startNew()
    expect(activePage(useVault.getState())).toMatchObject({ kind: 'create' })
    inRouter(<CreatePage group="work" />)

    await user.type(
      screen.getByRole('textbox', { name: 'What do you want to save?' }),
      '12-3456789'
    )
    expect(await screen.findByText('Best match')).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(activePage(useVault.getState())).toEqual({
      kind: 'new',
      type: 'taxId',
      group: 'work',
      prefill: { 'Tax ID number': '12-3456789', 'ID kind': 'EIN', Country: 'US' }
    })
    // A wizard: Back returns to step 1.
    useVault.getState().back()
    expect(activePage(useVault.getState())).toMatchObject({ kind: 'create' })
  })

  it('narrows the catalogue by name, description and keywords', async () => {
    api.search.query.mockResolvedValue([])
    const user = userEvent.setup()
    inRouter(<CreatePage />)
    expect(screen.getAllByRole('button', { name: /Wi-Fi network/ })).not.toHaveLength(0)
    await user.type(screen.getByRole('textbox', { name: 'What do you want to save?' }), 'seed')
    expect(await screen.findAllByRole('button', { name: /Crypto wallet/ })).not.toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: /Wi-Fi network/ })).toHaveLength(0)
  })

  it('offers the browsed category first', () => {
    useVault.getState().selectGroup('type:passport')
    useVault.getState().startNew()
    expect(activePage(useVault.getState())).toEqual({
      kind: 'create',
      group: undefined,
      suggest: 'passport'
    })
    inRouter(<CreatePage suggest="passport" />)
    expect(screen.getByText('Suggested')).toBeTruthy()
  })
})

describe('people', () => {
  it('suggests the person a passport names, and links in one click', async () => {
    const user = userEvent.setup()
    inRouter(<EntryPeople uuid="p" />)
    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect(api.vault.setPeople).toHaveBeenCalledWith('p', ['jane'])
  })

  it('links a person picked with the + button', async () => {
    const user = userEvent.setup()
    inRouter(<EntryPeople uuid="t" />)
    await user.click(screen.getByRole('button', { name: 'Link a person' }))
    await user.click(await screen.findByRole('option', { name: /Jane Doe/ }))
    expect(api.vault.setPeople).toHaveBeenCalledWith('t', ['jane'])
  })

  it('unlinks from the chip and opens the person from it', async () => {
    const user = userEvent.setup()
    inRouter(<EntryPeople uuid="a" />)
    await user.click(screen.getByRole('button', { name: 'Unlink Jane Doe' }))
    expect(api.vault.setPeople).toHaveBeenCalledWith('a', [])
    await user.click(screen.getByText('Jane Doe').closest('button')!)
    expect(activePage(useVault.getState())).toEqual({ kind: 'list', scope: 'person:jane' })
  })

  it('narrows any list to one person', async () => {
    const user = userEvent.setup()
    inRouter(<ListPage scope="__all__" />)
    await user.click(screen.getByRole('button', { name: 'Filter by person' }))
    await user.click(await screen.findByRole('menuitem', { name: /Jane Doe/ }))
    expect(activePage(useVault.getState())).toEqual({
      kind: 'list',
      scope: '__all__',
      person: 'jane'
    })
  })

  it("lists a person's entries, and new entries there are theirs", () => {
    useVault.getState().selectGroup('person:jane')
    inRouter(<ListPage scope="person:jane" />)
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeTruthy()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1)
    useVault.getState().startNew()
    expect(activePage(useVault.getState())).toMatchObject({ kind: 'create', people: ['jane'] })
  })

  it('shows people on Home and as rail tiles', async () => {
    const user = userEvent.setup()
    inRouter(
      <>
        <RailTiles />
        <HomePage />
      </>
    )
    expect(within(screen.getByLabelText('People')).getByText('1 items')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Jane Doe' }))
    expect(activePage(useVault.getState())).toEqual({ kind: 'list', scope: 'person:jane' })
    expect(screen.getByRole('button', { name: 'Jane Doe', current: 'page' })).toBeTruthy()
  })

  it('narrows search to a person with @', async () => {
    api.search.query.mockResolvedValue([])
    inRouter(<SearchPill />)
    usePalette.getState().show('@ja')
    expect(await screen.findByText('People')).toBeTruthy()
    expect(screen.getByText('Belonging to Jane Doe')).toBeTruthy()
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options.some((o) => o?.includes('Amazon'))).toBe(true)
    expect(options.some((o) => o?.includes('Travel insurance'))).toBe(false)
  })
})
