import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { activePage, useVault } from '@/stores/vault'
import { HOME } from '@/vault/tabs'
import { usePalette } from '@/stores/palette'
import { api } from '@/lib/api'
import { VaultLayout } from '@/vault/layout/VaultLayout'
import { TabPage } from '@/vault/pages/TabPage'
import { useVaultActions } from '@/vault/useVaultActions'
import { LOCKED_STATE, unlockPath } from '@/lib/vaults'

const ACTIVITY_THROTTLE_MS = 15_000

/** A printable key typed while nothing editable has focus and no dialog is open. */
function startsSearch(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === ' ') return false
  const t = e.target as HTMLElement | null
  if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
    return false
  return !document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')
}

export function Vault() {
  const navigate = useNavigate()
  const snapshot = useVault((s) => s.snapshot)
  const setSnapshot = useVault((s) => s.setSnapshot)
  const reset = useVault((s) => s.reset)
  const startNew = useVault((s) => s.startNew)
  const { save, lock } = useVaultActions()

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
          const { snapshot: current, switchTarget } = useVault.getState()
          const target = switchTarget ?? (current ? unlockPath(current.fileId) : '/')
          reset()
          usePalette.getState().hide()
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
          // Switching to another vault offers Touch ID there; locking this one does not.
          const relock = current && target === unlockPath(current.fileId)
          navigate(target, { replace: true, state: relock ? LOCKED_STATE : undefined })
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

  // Keyboard shortcuts. Capture phase, so an input doesn't swallow ⌘W or Ctrl+Tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const vault = useVault.getState()
      const palette = usePalette.getState()
      if (startsSearch(e) && !palette.open) {
        // Typing anywhere starts a search with that character.
        e.preventDefault()
        palette.show(e.key)
        return
      }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        vault.cycleTabs(e.shiftKey ? -1 : 1)
        return
      }
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k' || key === 'f') {
        e.preventDefault()
        if (key === 'k') palette.toggle()
        else palette.show()
      } else if (key === 's') {
        e.preventDefault()
        if (vault.snapshot?.dirty) void save()
      } else if (key === 'l') {
        e.preventDefault()
        if (!vault.snapshot?.dirty) void lock()
        else toast.warning('Save your changes before locking (⌘S)')
      } else if (key === 'n') {
        e.preventDefault()
        startNew()
      } else if (key === 't') {
        e.preventDefault()
        vault.open(HOME, { newTab: true })
      } else if (key === 'w') {
        e.preventDefault()
        vault.closeTab(vault.activeTab)
      } else if (key === '[') {
        e.preventDefault()
        vault.back()
      } else if (key === ']') {
        e.preventDefault()
        vault.forward()
      } else if (key === 'c' && e.shiftKey) {
        const page = activePage(vault)
        if (page.kind !== 'entry') return
        e.preventDefault()
        void api.vault
          .copy(page.uuid, 'Password')
          .then(() =>
            toast.success('Password copied', { description: 'Clipboard clears in 30 seconds' })
          )
          .catch(() => toast.error('This entry has no password'))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save, lock, startNew])

  if (!snapshot) return null

  return (
    <VaultLayout>
      <TabPage />
    </VaultLayout>
  )
}
