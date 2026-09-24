import { useMemo } from 'react'
import { Layers, Trash2, UserPlus } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { typeFilterId, ALL_ENTRIES, useVault } from '@/stores/vault'
import { usePalette } from '@/stores/palette'
import { entryTitle, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'
import { GroupTree } from '../GroupTree'
import { NewEntryButton } from '../NewEntryButton'
import { renderSummaryIcon, renderTypeIcon } from '../icons'
import { clickOptions } from '../tabs'
import { PageHeader } from '../layout/PageHeader'
import { ENTRY_TYPES, PERSON_TYPE } from '../../../../main/vault/entryTypes'
import { VaultAvatar } from '@/components/VaultAvatar'
import { linkedTo, listPeople, personFilterId, personName } from '../people'

const RECENT = 6

function Tile({
  icon,
  label,
  count,
  onOpen,
  muted
}: {
  icon: React.ReactNode
  label: string
  count: number
  onOpen: (opts: ReturnType<typeof clickOptions>) => void
  muted?: boolean
}) {
  return (
    <button
      onClick={(e) => onOpen(clickOptions(e))}
      onAuxClick={(e) => e.button === 1 && onOpen(clickOptions(e))}
      className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-lg',
          muted ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
    </button>
  )
}

/** Everyone in the vault, as cards; each opens what belongs to them. */
function PeopleSection() {
  const snapshot = useVault((s) => s.snapshot)
  const selectGroup = useVault((s) => s.selectGroup)
  const startNew = useVault((s) => s.startNew)
  const people = listPeople(snapshot)
  return (
    <section aria-label="People">
      <h2 className="mb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        People
      </h2>
      <div className="flex flex-wrap gap-2">
        {people.map((p) => {
          const name = personName(p)
          const open = (o: ReturnType<typeof clickOptions>) =>
            selectGroup(personFilterId(p.uuid), o)
          return (
            <button
              key={p.uuid}
              onClick={(e) => open(clickOptions(e))}
              onAuxClick={(e) => e.button === 1 && open(clickOptions(e))}
              title={name}
              className="flex w-28 flex-col items-center gap-2 rounded-3xl border bg-card px-3 py-3 transition-colors hover:bg-muted/60"
            >
              <VaultAvatar name={name} current className="size-11 rounded-full text-sm" />
              <span className="w-full min-w-0">
                <span className="block truncate text-sm">{name}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {linkedTo(snapshot, p.uuid).length} items
                </span>
              </span>
            </button>
          )
        })}
        <button
          onClick={() => startNew(PERSON_TYPE)}
          className="flex w-28 flex-col items-center gap-2 rounded-3xl border border-dashed px-3 py-3 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <span className="grid size-11 place-items-center rounded-full border border-dashed">
            <UserPlus className="size-4.5" />
          </span>
          <span className="text-sm">Add person</span>
        </button>
      </div>
    </section>
  )
}

/**
 * The vault's start page (each new tab opens here): categories, groups and the
 * entries changed last. Everything opens in this tab, or with ⌘ in a new one.
 */
export function HomePage() {
  const snapshot = useVault((s) => s.snapshot)
  const selectGroup = useVault((s) => s.selectGroup)
  const selectEntry = useVault((s) => s.selectEntry)
  const showPalette = usePalette((s) => s.show)

  const { live, counts, bin, recent } = useMemo(() => {
    const entries = snapshot?.entries ?? []
    const live = entries.filter((e) => !e.inRecycleBin)
    const counts = new Map<string, number>()
    for (const e of live) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
    const recent = [...live]
      .filter((e) => e.modified)
      .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
      .slice(0, RECENT)
    return { live, counts, bin: entries.length - live.length, recent }
  }, [snapshot])
  if (!snapshot) return null
  const binGroup = snapshot.root.groups.find((g) => g.isRecycleBin)

  return (
    <div className="flex h-full flex-col">
      <PageHeader actions={<NewEntryButton />}>
        <h1 className="truncate font-semibold tracking-tight">{snapshot.dbName || 'Home'}</h1>
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
          <button
            onClick={() => showPalette()}
            className="flex h-11 items-center gap-3 rounded-xl border bg-muted/40 px-4 text-sm text-muted-foreground hover:bg-muted/70"
          >
            Search {live.length} entries, or type to add something…
            <kbd className="ml-auto rounded bg-background px-1.5 text-xs">⌘K</kbd>
          </button>

          <PeopleSection />

          <section>
            <h2 className="mb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Browse
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
              <Tile
                icon={<Layers className="size-4" />}
                label="All entries"
                count={live.length}
                onOpen={(o) => selectGroup(ALL_ENTRIES, o)}
              />
              {ENTRY_TYPES.filter((t) => counts.has(t.id)).map((t) => (
                <Tile
                  key={t.id}
                  icon={renderTypeIcon(t.id, 'size-4')}
                  label={t.id === 'login' ? 'Logins' : t.label}
                  count={counts.get(t.id)!}
                  onOpen={(o) => selectGroup(typeFilterId(t.id), o)}
                />
              ))}
              {binGroup && bin > 0 && (
                <Tile
                  icon={<Trash2 className="size-4" />}
                  label="Recycle bin"
                  count={bin}
                  muted
                  onOpen={(o) => selectGroup(binGroup.uuid, o)}
                />
              )}
            </div>
          </section>

          <div className="grid gap-8 md:grid-cols-2">
            <section>
              <GroupTree />
            </section>
            {recent.length > 0 && (
              <section>
                <h2 className="pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                  Recently changed
                </h2>
                <ul>
                  {recent.map((e) => (
                    <li key={e.uuid}>
                      <button
                        onClick={(ev) => selectEntry(e.uuid, clickOptions(ev))}
                        onAuxClick={(ev) =>
                          ev.button === 1 && selectEntry(e.uuid, clickOptions(ev))
                        }
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                      >
                        <span className="text-muted-foreground">
                          {renderSummaryIcon(e, 'size-4')}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{entryTitle(e)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(e.modified!)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
