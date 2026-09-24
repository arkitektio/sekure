import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Search } from 'lucide-react'
import { toast } from 'sonner'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'
import { useVault } from '@/stores/vault'
import { api } from '@/lib/api'
import { GroupTree } from '@/vault/GroupTree'
import { EntryList } from '@/vault/EntryList'
import { EntryDetail } from '@/vault/EntryDetail'
import { EntryForm } from '@/vault/EntryForm'
import { CommandPalette } from '@/vault/CommandPalette'
import { useVaultActions } from '@/vault/useVaultActions'
import { unlockPath } from '@/lib/vaults'

const ACTIVITY_THROTTLE_MS = 15_000

export function Vault() {
  const navigate = useNavigate()
  const snapshot = useVault((s) => s.snapshot)
  const setSnapshot = useVault((s) => s.setSnapshot)
  const reset = useVault((s) => s.reset)
  const selectedEntry = useVault((s) => s.selectedEntry)
  const editing = useVault((s) => s.editing)
  const newEntryType = useVault((s) => s.newEntryType)
  const startNew = useVault((s) => s.startNew)
  const { save, lock } = useVaultActions()
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Rehydrate after a reload (the session lives in main, not here).
  useEffect(() => {
    if (snapshot) return
    void api.vault.state().then(async (state) => {
      if (!state.open) navigate('/', { replace: true })
      else setSnapshot(await api.vault.snapshot())
    })
  }, [snapshot, navigate, setSnapshot])

  // Main is the source of truth: follow its change / lock events.
  useEffect(
    () =>
      api.vault.onEvent((event) => {
        if (event.type === 'changed') setSnapshot(event.snapshot)
        if (event.type === 'locked') {
          const fileId = useVault.getState().snapshot?.fileId
          reset()
          if (event.unsaved === 'recovered') {
            toast.warning('Locked with unsaved changes', {
              description:
                'They could not be saved and were kept in an encrypted recovery copy in the Sekure data folder.',
              duration: Infinity
            })
          } else if (event.unsaved === 'lost') {
            toast.error('Locked — unsaved changes could not be saved', { duration: Infinity })
          } else if (event.reason !== 'manual') {
            toast.info(event.reason === 'idle' ? 'Locked after inactivity' : 'Locked with your Mac')
          }
          navigate(fileId ? unlockPath(fileId) : '/files', { replace: true })
        }
      }),
    [navigate, reset, setSnapshot]
  )

  // User input keeps the vault unlocked; throttled so we don't spam IPC.
  useEffect(() => {
    let last = 0
    const ping = () => {
      const now = Date.now()
      if (now - last < ACTIVITY_THROTTLE_MS) return
      last = now
      void api.vault.activity()
    }
    window.addEventListener('keydown', ping)
    window.addEventListener('pointerdown', ping)
    window.addEventListener('wheel', ping, { passive: true })
    return () => {
      window.removeEventListener('keydown', ping)
      window.removeEventListener('pointerdown', ping)
      window.removeEventListener('wheel', ping)
    }
  }, [])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (key === 's') {
        e.preventDefault()
        if (useVault.getState().snapshot?.dirty) void save()
      } else if (key === 'l') {
        e.preventDefault()
        if (!useVault.getState().snapshot?.dirty) void lock()
        else toast.warning('Save your changes before locking (⌘S)')
      } else if (key === 'n') {
        e.preventDefault()
        startNew()
      } else if (key === 'f') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
      } else if (key === 'c' && e.shiftKey) {
        const uuid = useVault.getState().selectedEntry
        if (!uuid) return
        e.preventDefault()
        void api.vault
          .copy(uuid, 'Password')
          .then(() =>
            toast.success('Password copied', { description: 'Clipboard clears in 30 seconds' })
          )
          .catch(() => toast.error('This entry has no password'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, lock, startNew])

  if (!snapshot) return null

  return (
    <>
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="220px" minSize="160px" maxSize="360px">
          <GroupTree />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="320px" minSize="240px" maxSize="520px">
          <EntryList />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize="320px">
          {editing ? (
            <EntryForm key={editing === 'new' ? `new:${newEntryType}` : editing} uuid={editing} />
          ) : selectedEntry ? (
            <EntryDetail key={selectedEntry} uuid={selectedEntry} />
          ) : (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRound />
                </EmptyMedia>
                <EmptyTitle>No entry selected</EmptyTitle>
                <EmptyDescription>
                  Pick an entry, or press <Kbd>⌘K</Kbd> to search.
                </EmptyDescription>
              </EmptyHeader>
              <button
                onClick={() => setPaletteOpen(true)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <Search className="size-4" /> Search vault
              </button>
            </Empty>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  )
}
