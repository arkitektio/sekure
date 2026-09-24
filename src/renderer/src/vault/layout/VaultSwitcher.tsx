import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Cloud, FolderOpen, Lock } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SourceIcon } from '@/components/SourceIcon'
import { VaultAvatar } from '@/components/VaultAvatar'
import { useAuth } from '@/stores/auth'
import { useVault } from '@/stores/vault'
import { api, displayError } from '@/lib/api'
import { isLocalId, unlockPath } from '@/lib/vaults'
import { useVaultActions } from '../useVaultActions'
import type { RecentVault } from '../../../../main/sources/protocol'

/**
 * The rail footer, like orkestrator's organization switcher: the open vault, and
 * the others you used recently. Switching locks this vault (saving first) and
 * opens the other one's unlock screen.
 */
export function VaultSwitcher() {
  const snapshot = useVault((s) => s.snapshot)
  const connected = useAuth((s) => s.status?.connected)
  const { lock } = useVaultActions()
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<RecentVault[]>([])

  useEffect(() => {
    if (!open) return
    let alive = true
    void api.sources
      .recent()
      .then((r) => alive && setRecent(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open])

  if (!snapshot) return null
  const current = recent.find((r) => r.id === snapshot.fileId)
  const location =
    current?.location ?? (isLocalId(snapshot.fileId) ? 'On this computer' : 'Google Drive')
  const others = recent.filter((r) => r.id !== snapshot.fileId && (connected || isLocalId(r.id)))

  const openLocal = async () => {
    try {
      const ref = await api.sources.pickLocal()
      if (ref && ref.id !== snapshot.fileId) await lock(unlockPath(ref.id))
    } catch (e) {
      toast.error(displayError(e))
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="app-no-drag flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-background/60 aria-expanded:bg-background/60"
          aria-label="Switch vault"
        >
          <VaultAvatar name={snapshot.dbName || snapshot.fileName} current />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">
              {snapshot.dbName || snapshot.fileName}
            </span>
            <span className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
              <SourceIcon id={snapshot.fileId} className="size-2.5 shrink-0" />
              <span className="truncate">{location}</span>
              {snapshot.dirty && (
                <span className="text-amber-600 dark:text-amber-400">· unsaved</span>
              )}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Switch vault
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="gap-2">
          <VaultAvatar name={snapshot.dbName || snapshot.fileName} current />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{snapshot.dbName || snapshot.fileName}</span>
            <span className="block truncate text-xs text-muted-foreground">{location}</span>
          </span>
          <Check className="text-primary" />
        </DropdownMenuItem>
        {others.map((r) => (
          <DropdownMenuItem
            key={r.id}
            className="gap-2"
            onSelect={() => void lock(unlockPath(r.id))}
          >
            <VaultAvatar name={r.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{r.name.replace(/\.kdbx$/i, '')}</span>
              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <SourceIcon id={r.id} className="size-3 shrink-0" />
                <span className="truncate">{r.location}</span>
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void openLocal()}>
          <FolderOpen /> Open a vault file…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void lock('/files')}>
          <Cloud /> {connected ? 'Browse Google Drive…' : 'Connect Google Drive…'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void lock()}>
          <Lock /> Lock
          <DropdownMenuShortcut>⌘L</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
