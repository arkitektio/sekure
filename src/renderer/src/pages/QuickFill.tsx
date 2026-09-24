import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, AtSign, Clock, KeyRound, Link, TextCursorInput } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { api, displayError } from '@/lib/api'
import { renderEntryIcon } from '@/vault/icons'
import { QuickUnlock } from '@/vault/QuickUnlock'
import { suggestEntries } from '@/vault/autotype'
import { rankEntries, useSearch } from '@/vault/useSearch'
import { OTP_FIELD, type AutoTypeOpened } from '../../../main/autotype/protocol'
import type {
  VaultEntryDetail,
  VaultEntrySummary,
  VaultSnapshot
} from '../../../main/vault/protocol'

interface FieldOption {
  field: string
  label: string
  icon: React.ReactNode
  hint?: string
}

function fieldOptions(entry: VaultEntryDetail): FieldOption[] {
  const out: FieldOption[] = []
  if (entry.hasPassword) out.push({ field: 'Password', label: 'Password', icon: <KeyRound /> })
  if (entry.username) {
    out.push({ field: 'UserName', label: 'Username', icon: <AtSign />, hint: entry.username })
  }
  if (entry.hasOtp) out.push({ field: OTP_FIELD, label: 'One-time code', icon: <Clock /> })
  if (entry.url) out.push({ field: 'URL', label: 'URL', icon: <Link />, hint: entry.url })
  for (const f of entry.customFields) {
    out.push({
      field: f.key,
      label: f.key,
      icon: <TextCursorInput />,
      hint: f.protected ? undefined : (f.value ?? undefined)
    })
  }
  return out
}

/**
 * The auto-type popup (its own frameless window, route `#/quick`): search an
 * entry, pick a field, and main pastes it into the app that had focus.
 */
export function QuickFill() {
  const [openedAt, setOpenedAt] = useState(0)
  const [targetName, setTargetName] = useState<string>()
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>()
  const [entry, setEntry] = useState<VaultEntryDetail>()
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const state = await api.vault.state()
    setSnapshot(state.open ? await api.vault.snapshot() : null)
  }, [])

  const onOpened = useCallback(
    (e: AutoTypeOpened) => {
      setTargetName(e.targetName)
      setEntry(undefined)
      setQuery('')
      setError(undefined)
      setOpenedAt(Date.now())
      void refresh()
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [refresh]
  )

  // The first open can fire before this listener exists, so also pull it.
  useEffect(() => {
    void api.autotype.current().then(onOpened)
    return api.autotype.onOpened(onOpened)
  }, [onOpened])

  useEffect(
    () =>
      api.vault.onEvent((e) => {
        if (e.type === 'changed' || e.type === 'opened') setSnapshot(e.snapshot)
        if (e.type === 'locked') {
          setSnapshot(null)
          setEntry(undefined)
        }
      }),
    []
  )

  const entries = useMemo(
    () =>
      (snapshot?.entries ?? [])
        .filter((e) => !e.inRecycleBin)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [snapshot]
  )
  const suggested = useMemo(() => suggestEntries(entries, targetName), [entries, targetName])
  // Entry search is ranked in main (text + semantic); the field picker keeps cmdk's filter.
  const hits = useSearch(entry ? '' : query, snapshot)
  const ranked = useMemo(
    () => rankEntries(entries, entry ? '' : query, hits),
    [entries, entry, query, hits]
  )
  const searching = !entry && !!query.trim()

  const pickEntry = async (summary: VaultEntrySummary) => {
    setError(undefined)
    try {
      setEntry(await api.vault.entry(summary.uuid))
      setQuery('')
      inputRef.current?.focus()
    } catch (e) {
      setError(displayError(e))
    }
  }

  const fill = async (field: string) => {
    if (!entry) return
    setError(undefined)
    try {
      await api.autotype.fill(entry.uuid, field)
    } catch (e) {
      setError(displayError(e))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (entry) {
        setEntry(undefined)
        setQuery('')
      } else void api.autotype.dismiss()
    } else if (e.key === 'Backspace' && entry && !query) {
      setEntry(undefined)
    }
  }

  const entryItem = (e: VaultEntrySummary, group: string) => (
    <CommandItem
      key={`${group}:${e.uuid}`}
      value={`${group}:${e.uuid}`}
      onSelect={() => void pickEntry(e)}
    >
      {renderEntryIcon(e.icon)}
      <span className="truncate">{e.title || '(untitled)'}</span>
      <span className="truncate text-xs text-muted-foreground">{e.username}</span>
    </CommandItem>
  )

  return (
    <div className="h-screen overflow-hidden border bg-popover text-popover-foreground">
      {snapshot === null ? (
        <QuickUnlock openedAt={openedAt} onUnlocked={setSnapshot} />
      ) : (
        <Command
          key={entry?.uuid ?? 'entries'}
          className="rounded-none!"
          onKeyDown={onKeyDown}
          shouldFilter={!!entry}
        >
          {entry && (
            <div className="flex items-center gap-2 px-3 pt-2 text-sm">
              <button
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => setEntry(undefined)}
                aria-label="Back to entries"
              >
                <ArrowLeft className="size-4" />
              </button>
              {renderEntryIcon(entry.icon)}
              <span className="truncate font-medium">{entry.title || '(untitled)'}</span>
            </div>
          )}
          <CommandInput
            ref={inputRef}
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={entry ? 'Choose a field to type…' : 'Search entries to auto-type…'}
          />
          <CommandList className="max-h-none flex-1">
            <CommandEmpty>No results.</CommandEmpty>
            {entry ? (
              <CommandGroup heading={targetName ? `Type into ${targetName}` : 'Type into'}>
                {fieldOptions(entry).map((f) => (
                  <CommandItem
                    key={f.field}
                    value={`${f.label} ${f.field}`}
                    onSelect={() => void fill(f.field)}
                  >
                    {f.icon}
                    <span>{f.label}</span>
                    {f.hint && (
                      <span className="truncate text-xs text-muted-foreground">{f.hint}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <>
                {!searching && suggested.length > 0 && (
                  <CommandGroup heading="Suggested">
                    {suggested.map((e) => entryItem(e, 'suggested'))}
                  </CommandGroup>
                )}
                {ranked.matches.length > 0 && (
                  <CommandGroup heading="Entries">
                    {ranked.matches.map((e) => entryItem(e, 'all'))}
                  </CommandGroup>
                )}
                {ranked.related.length > 0 && (
                  <CommandGroup heading="Related">
                    {ranked.related.map((e) => entryItem(e, 'related'))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
            {error ? (
              <span className="truncate text-destructive">{error}</span>
            ) : (
              <>
                <span>
                  <Kbd>↵</Kbd> {entry ? 'type' : 'choose'}
                </span>
                <span>
                  <Kbd>esc</Kbd> {entry ? 'back' : 'close'}
                </span>
              </>
            )}
          </div>
        </Command>
      )}
    </div>
  )
}
