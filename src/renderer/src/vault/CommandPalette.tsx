import { useMemo, useState } from 'react'
import { Copy, KeyRound, Lock, Plus, Save, User } from 'lucide-react'
import { toast } from 'sonner'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'
import { useVault } from '@/stores/vault'
import { api, displayError } from '@/lib/api'
import { renderSummaryIcon } from './icons'
import { useVaultActions } from './useVaultActions'
import { rankEntries, useSearch } from './useSearch'
import type { VaultEntrySummary } from '../../../main/vault/protocol'

export function CommandPalette({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const snapshot = useVault((s) => s.snapshot)
  const selectEntry = useVault((s) => s.selectEntry)
  const startNew = useVault((s) => s.startNew)
  const { save, lock } = useVaultActions()

  const [query, setQuery] = useState('')
  // Start fresh next time: the query is cleared whenever the palette closes.
  const changeOpen = (o: boolean) => {
    if (!o) setQuery('')
    onOpenChange(o)
  }
  const hits = useSearch(query, snapshot)
  // Ranking happens in main (text + semantic), so cmdk must not filter on its own.
  const { matches, related } = useMemo(
    () =>
      rankEntries(
        (snapshot?.entries ?? []).filter((e) => !e.inRecycleBin),
        query,
        hits
      ),
    [snapshot, query, hits]
  )
  const showCommand = (label: string) =>
    !query.trim() || label.toLowerCase().includes(query.trim().toLowerCase())

  const run = (fn: () => unknown) => {
    changeOpen(false)
    void Promise.resolve(fn()).catch((e) => toast.error(displayError(e)))
  }

  const copy = (uuid: string, field: string, label: string) =>
    run(async () => {
      await api.vault.copy(uuid, field)
      toast.success(`${label} copied`, { description: 'Clipboard clears in 30 seconds' })
    })

  const entryItem = (e: VaultEntrySummary) => (
    <CommandItem key={e.uuid} value={e.uuid} onSelect={() => run(() => selectEntry(e.uuid))}>
      {renderSummaryIcon(e)}
      <span className="truncate">{e.title || '(untitled)'}</span>
      <span className="truncate text-xs text-muted-foreground">{e.subtitle}</span>
      <div className="ml-auto flex gap-1">
        {e.username && (
          <button
            className="rounded p-1 hover:bg-background"
            onClick={(ev) => {
              ev.stopPropagation()
              copy(e.uuid, 'UserName', 'Username')
            }}
            aria-label="Copy username"
          >
            <User className="size-3.5" />
          </button>
        )}
        {e.hasPassword && (
          <button
            className="rounded p-1 hover:bg-background"
            onClick={(ev) => {
              ev.stopPropagation()
              copy(e.uuid, 'Password', 'Password')
            }}
            aria-label="Copy password"
          >
            <KeyRound className="size-3.5" />
          </button>
        )}
      </div>
    </CommandItem>
  )

  return (
    <CommandDialog open={open} onOpenChange={changeOpen} title="Search vault">
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search entries or run a command…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {matches.length > 0 && (
            <CommandGroup heading="Entries">{matches.map(entryItem)}</CommandGroup>
          )}
          {related.length > 0 && (
            <CommandGroup heading="Related">{related.map(entryItem)}</CommandGroup>
          )}
          <CommandGroup heading="Commands">
            {showCommand('New entry') && (
              <CommandItem value="cmd:new" onSelect={() => run(() => startNew('login'))}>
                <Plus /> New entry <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
            )}
            {showCommand('Save to Google Drive') && (
              <CommandItem value="cmd:save" disabled={!snapshot?.dirty} onSelect={() => run(save)}>
                <Save /> Save to Google Drive <CommandShortcut>⌘S</CommandShortcut>
              </CommandItem>
            )}
            {showCommand('Lock vault') && (
              <CommandItem value="cmd:lock" onSelect={() => run(lock)}>
                <Lock /> Lock vault <CommandShortcut>⌘L</CommandShortcut>
              </CommandItem>
            )}
            {!query.trim() && (
              <CommandItem value="cmd:tip" disabled>
                <Copy /> Tip: ⌘⇧C copies the selected entry’s password
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
