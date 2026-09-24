import { useMemo, useRef } from 'react'
import { Copy, KeyRound, Lock, Plus, Save, Search, Sparkles, User } from 'lucide-react'
import { Command as CommandPrimitive } from 'cmdk'
import { toast } from 'sonner'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useVault } from '@/stores/vault'
import { usePalette } from '@/stores/palette'
import { api, displayError, entryTitle } from '@/lib/api'
import { renderSummaryIcon, renderTypeIcon } from './icons'
import { useVaultActions } from './useVaultActions'
import { describeSuggestion, rankEntries, useNewEntrySuggestions, useSearch } from './useSearch'
import type { VaultEntrySummary } from '../../../main/vault/protocol'
import { VaultAvatar } from '@/components/VaultAvatar'
import { linkedTo, peopleMatching, personFilterId, personName } from './people'

/** Entries shown for an empty query (alphabetical); searching shows every match. */
const BROWSE_LIMIT = 30

/**
 * The rail's search pill, and the palette that grows out of it (orkestrator's
 * TitleSearchBar). Enter opens a result in the current tab, ⌘Enter in a new one.
 */
export function SearchPill() {
  const open = usePalette((s) => s.open)
  const toggle = usePalette((s) => s.toggle)
  return (
    <Popover
      open={open}
      onOpenChange={(o) => (o ? usePalette.getState().show() : usePalette.getState().hide())}
    >
      <PopoverAnchor asChild>
        <button
          onClick={toggle}
          data-search-pill
          className="app-no-drag group flex h-8 w-full items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-2.5 text-xs text-muted-foreground hover:bg-background aria-expanded:invisible"
          aria-expanded={open}
          aria-label="Search vault"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search vault…</span>
          <Kbd className="opacity-0 transition-opacity group-hover:opacity-100">⌘K</Kbd>
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        // Cover the pill, so the panel reads as the pill grown.
        sideOffset={-32}
        className="w-[min(92vw,max(28rem,34vw))] origin-top-left gap-0 overflow-hidden rounded-lg border border-border/50 bg-background/95 p-0 shadow-2xl backdrop-blur-md data-open:zoom-in-90"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          document.querySelector<HTMLInputElement>('[data-palette-input]')?.focus()
        }}
      >
        <SearchPalette />
      </PopoverContent>
    </Popover>
  )
}

function SearchPalette() {
  const snapshot = useVault((s) => s.snapshot)
  const selectEntry = useVault((s) => s.selectEntry)
  const startNew = useVault((s) => s.startNew)
  const selectGroup = useVault((s) => s.selectGroup)
  const query = usePalette((s) => s.query)
  const setQuery = usePalette((s) => s.setQuery)
  const hide = usePalette((s) => s.hide)
  const { save, lock } = useVaultActions()
  // cmdk's onSelect carries no event: remember whether ⌘/Ctrl was held with Enter.
  const newTab = useRef(false)

  // `@jane passport`: narrow to Jane's entries, then search the rest as usual.
  const at = query.match(/^@(\S*)\s*(.*)$/s)
  const personPrefix = at ? at[1] : undefined
  const text = at ? at[2] : query
  const people = useMemo(
    () => (personPrefix === undefined ? [] : peopleMatching(snapshot, personPrefix)),
    [snapshot, personPrefix]
  )
  const hits = useSearch(text, snapshot)
  const suggestions = useNewEntrySuggestions(at ? '' : query)
  // Ranking happens in main (text + semantic), so cmdk must not filter on its own.
  const { matches, related } = useMemo(() => {
    const ids = new Set(people.map((p) => p.uuid))
    const pool = (snapshot?.entries ?? []).filter(
      (e) =>
        !e.inRecycleBin &&
        (personPrefix === undefined || (e.people ?? []).some((id) => ids.has(id)))
    )
    return rankEntries(pool, text, hits)
  }, [snapshot, text, hits, people, personPrefix])
  const shown = text.trim() ? matches : matches.slice(0, BROWSE_LIMIT)
  const showCommand = (label: string) =>
    !query.trim() || label.toLowerCase().includes(query.trim().toLowerCase())

  const run = (fn: () => unknown) => {
    hide()
    void Promise.resolve(fn()).catch((e) => toast.error(displayError(e)))
  }
  const openEntry = (uuid: string) =>
    run(() => selectEntry(uuid, newTab.current ? { newTab: true } : undefined))

  const copy = (uuid: string, field: string, label: string) =>
    run(async () => {
      await api.vault.copy(uuid, field)
      toast.success(`${label} copied`, { description: 'Clipboard clears in 30 seconds' })
    })

  const entryItem = (e: VaultEntrySummary) => (
    <CommandItem key={e.uuid} value={e.uuid} onSelect={() => openEntry(e.uuid)}>
      {renderSummaryIcon(e)}
      <span className="truncate">{entryTitle(e)}</span>
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
    <Command
      shouldFilter={false}
      className="rounded-none! bg-transparent p-0"
      onKeyDown={(e) => {
        if (e.key === 'Enter') newTab.current = e.metaKey || e.ctrlKey
        if (e.key === 'Escape') {
          e.preventDefault()
          hide()
        }
      }}
    >
      {/* Mirrors the pill, so opening reads as the pill growing. */}
      <div className="flex h-8 items-center gap-2 border-b border-border/50 px-2.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <CommandPrimitive.Input
          data-palette-input
          value={query}
          onValueChange={setQuery}
          placeholder="Search entries, @person, add something, or run a command…"
          className="h-full flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
        />
        <Kbd>esc</Kbd>
      </div>
      <CommandList className="max-h-[min(60vh,28rem)] p-1">
        <CommandEmpty>No results.</CommandEmpty>
        {at && people.length > 0 && !text.trim() && (
          <CommandGroup heading="People">
            {people.map((p) => (
              <CommandItem
                key={p.uuid}
                value={`person:${p.uuid}`}
                onSelect={() =>
                  run(() =>
                    selectGroup(
                      personFilterId(p.uuid),
                      newTab.current ? { newTab: true } : undefined
                    )
                  )
                }
              >
                <VaultAvatar
                  name={personName(p)}
                  current
                  className="size-5 rounded-full text-[9px]"
                />
                <span className="truncate">{personName(p)}</span>
                <span className="text-xs text-muted-foreground">
                  {linkedTo(snapshot, p.uuid).length} items
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {shown.length > 0 && (
          <CommandGroup
            heading={
              at
                ? `Belonging to ${people.map(personName).join(', ') || 'nobody'}`
                : query.trim()
                  ? 'Entries'
                  : 'All entries'
            }
          >
            {shown.map(entryItem)}
          </CommandGroup>
        )}
        {related.length > 0 && (
          <CommandGroup heading="Related">{related.map(entryItem)}</CommandGroup>
        )}
        {suggestions.length > 0 && (
          <CommandGroup heading="Create">
            {suggestions.map((s) => {
              const { title, detail } = describeSuggestion(s)
              return (
                <CommandItem
                  key={s.typeId}
                  value={`add:${s.typeId}`}
                  onSelect={() => run(() => startNew(s.typeId, s.prefill))}
                >
                  {renderTypeIcon(s.typeId)}
                  <span className="truncate">{title}</span>
                  {detail && (
                    <span className="truncate text-xs text-muted-foreground">{detail}</span>
                  )}
                  {s.via === 'semantic' && <Sparkles className="ml-auto text-primary" />}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        <CommandGroup heading="Commands">
          {showCommand('New entry') && (
            <CommandItem value="cmd:new" onSelect={() => run(() => startNew())}>
              <Plus /> New entry <CommandShortcut>⌘N</CommandShortcut>
            </CommandItem>
          )}
          {showCommand('Save vault') && (
            <CommandItem value="cmd:save" disabled={!snapshot?.dirty} onSelect={() => run(save)}>
              <Save /> Save vault <CommandShortcut>⌘S</CommandShortcut>
            </CommandItem>
          )}
          {showCommand('Lock vault') && (
            <CommandItem value="cmd:lock" onSelect={() => run(() => lock())}>
              <Lock /> Lock vault <CommandShortcut>⌘L</CommandShortcut>
            </CommandItem>
          )}
          {!query.trim() && (
            <CommandItem value="cmd:tip" disabled>
              <Copy /> Tip: ⌘Enter opens in a new tab · ⌘⇧C copies the password
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
