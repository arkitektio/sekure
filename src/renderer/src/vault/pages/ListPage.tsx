import { useMemo } from 'react'
import { Check, ChevronDown, Paperclip, Timer, Users, UserX } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'
import { ALL_ENTRIES, typeFilter, useVault } from '@/stores/vault'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { VaultAvatar } from '@/components/VaultAvatar'
import { listPeople, personFilter, personName } from '../people'
import { entryTitle } from '@/lib/api'
import { renderSummaryIcon } from '../icons'
import { NewEntryButton } from '../NewEntryButton'
import { clickOptions } from '../tabs'
import { Crumb, PageHeader } from '../layout/PageHeader'
import { scopeLabel } from '../layout/labels'
import { getType, PERSON_TYPE } from '../../../../main/vault/entryTypes'
import type { VaultGroupNode } from '../../../../main/vault/protocol'

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

/** A group, a category or all entries, as a page in a tab. */
/** Narrow a list to one person's entries (or to entries linked to nobody). */
function PersonFilter({ scope, person }: { scope: string; person?: string }) {
  const snapshot = useVault((s) => s.snapshot)
  const replace = useVault((s) => s.replace)
  const people = listPeople(snapshot)
  if (!people.length) return null
  const current = people.find((p) => p.uuid === person)
  const set = (p: string | undefined) => replace({ kind: 'list', scope, person: p })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={person ? 'secondary' : 'ghost'} size="sm" aria-label="Filter by person">
          {current ? (
            <VaultAvatar
              name={personName(current)}
              current
              className="size-4 rounded-full text-[8px]"
            />
          ) : (
            <Users />
          )}
          {current ? personName(current) : person === 'none' ? 'Nobody' : 'Anyone'}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => set(undefined)}>
          <Users /> Anyone {!person && <Check className="ml-auto text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => set('none')}>
          <UserX /> Nobody linked {person === 'none' && <Check className="ml-auto text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {people.map((p) => (
          <DropdownMenuItem key={p.uuid} onSelect={() => set(p.uuid)}>
            <VaultAvatar name={personName(p)} className="size-5 rounded-full text-[9px]" />
            <span className="truncate">{personName(p)}</span>
            {person === p.uuid && <Check className="ml-auto text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ListPage({ scope, person }: { scope: string; person?: string }) {
  const snapshot = useVault((s) => s.snapshot)
  const select = useVault((s) => s.selectEntry)
  const scopedPerson = personFilter(scope)

  const entries = useMemo(() => {
    if (!snapshot) return []
    const type = typeFilter(scope)
    const owner = scopedPerson ?? person
    const groups =
      scope === ALL_ENTRIES || type || scopedPerson
        ? undefined
        : descendantIds(snapshot.root, scope)
    return (
      snapshot.entries
        // “All entries” leaves out the recycle bin; opening the bin shows it.
        .filter((e) => (groups ? groups.has(e.groupUuid) : !e.inRecycleBin))
        .filter((e) => !type || e.type === type)
        .filter((e) =>
          !owner
            ? true
            : owner === 'none'
              ? !(e.people ?? []).length && e.type !== PERSON_TYPE
              : (e.people ?? []).includes(owner)
        )
        .sort((a, b) => a.title.localeCompare(b.title))
    )
  }, [snapshot, scope, person, scopedPerson])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          <>
            {!scopedPerson && <PersonFilter scope={scope} person={person} />}
            <NewEntryButton />
          </>
        }
      >
        <h1 className="truncate font-semibold tracking-tight">{scopeLabel(snapshot, scope)}</h1>
        <span className="text-xs text-muted-foreground tabular-nums">{entries.length}</span>
        {scopedPerson && <Crumb onClick={() => select(scopedPerson)}>Profile</Crumb>}
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        {entries.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyTitle>No entries</EmptyTitle>
              <EmptyDescription>
                Create one with the + button, or press <Kbd>⌘N</Kbd>.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="mx-auto max-w-4xl p-2">
            {entries.map((e) => {
              const type = e.type === 'login' ? undefined : getType(e.type)
              return (
                <li key={e.uuid}>
                  <button
                    onClick={(ev) => select(e.uuid, clickOptions(ev))}
                    onAuxClick={(ev) => ev.button === 1 && select(e.uuid, clickOptions(ev))}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted/60"
                  >
                    <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      {renderSummaryIcon(e, 'size-4')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{entryTitle(e)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {e.username || e.url || e.subtitle || ' '}
                      </div>
                    </div>
                    {type && (
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {type.label}
                      </span>
                    )}
                    <div className="flex w-10 shrink-0 items-center justify-end gap-1 text-muted-foreground">
                      {e.hasOtp && <Timer className="size-3.5" />}
                      {e.attachmentCount > 0 && <Paperclip className="size-3.5" />}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
