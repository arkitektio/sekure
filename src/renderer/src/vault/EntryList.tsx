import { useMemo } from 'react'
import { Paperclip, Search, Sparkles, Timer } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ALL_ENTRIES, typeFilter, useVault } from '@/stores/vault'
import { cn } from '@/lib/utils'
import { entryTitle } from '@/lib/api'
import { renderSummaryIcon } from './icons'
import { NewEntryMenu } from './NewEntryMenu'
import { rankEntries, useSearch } from './useSearch'
import type { VaultEntrySummary, VaultGroupNode } from '../../../main/vault/protocol'

function descendantIds(root: VaultGroupNode, uuid: string): Set<string> | undefined {
  if (root.uuid === uuid) {
    const ids = new Set<string>()
    const walk = (g: VaultGroupNode) => {
      ids.add(g.uuid)
      g.groups.forEach(walk)
    }
    walk(root)
    return ids
  }
  for (const g of root.groups) {
    const found = descendantIds(g, uuid)
    if (found) return found
  }
  return undefined
}

export function EntryList() {
  const snapshot = useVault((s) => s.snapshot)
  const group = useVault((s) => s.selectedGroup)
  const selected = useVault((s) => s.selectedEntry)
  const select = useVault((s) => s.selectEntry)
  const search = useVault((s) => s.search)
  const setSearch = useVault((s) => s.setSearch)

  const hits = useSearch(search, snapshot)

  const { matches: entries, related } = useMemo(() => {
    if (!snapshot) return { matches: [], related: [] }
    const type = typeFilter(group)
    const scope = group === ALL_ENTRIES || type ? undefined : descendantIds(snapshot.root, group)
    const inScope = snapshot.entries
      // “All entries” leaves out the recycle bin; selecting the bin shows it.
      .filter((e) => (scope ? scope.has(e.groupUuid) : !e.inRecycleBin))
      .filter((e) => !type || e.type === type)
    return rankEntries(inScope, search, hits)
  }, [snapshot, group, search, hits])

  const row = (e: VaultEntrySummary) => (
    <li key={e.uuid}>
      <button
        onClick={() => select(e.uuid)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left',
          selected === e.uuid ? 'bg-primary/10' : 'hover:bg-muted/60'
        )}
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          {renderSummaryIcon(e, 'size-4')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{entryTitle(e)}</div>
          <div className="truncate text-xs text-muted-foreground">{e.username || e.url || ' '}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {e.hasOtp && <Timer className="size-3.5" />}
          {e.attachmentCount > 0 && <Paperclip className="size-3.5" />}
        </div>
      </button>
    </li>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search"
            className="h-8 pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-search-input
          />
        </div>
        <NewEntryMenu />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {entries.length === 0 && related.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyTitle>{search ? 'No matches' : 'No entries'}</EmptyTitle>
              <EmptyDescription>
                {search ? 'Try a different search.' : 'Create one with the + button.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="p-1.5">
            {entries.map(row)}
            {related.length > 0 && (
              <li
                className="flex items-center gap-1.5 px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground"
                aria-label="Related entries"
              >
                <Sparkles className="size-3 text-primary" /> Related
              </li>
            )}
            {related.map(row)}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
