import { useMemo, useState } from 'react'
import { ChevronRight, Search, Sparkles } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useVault } from '@/stores/vault'
import { cn } from '@/lib/utils'
import { renderGroupTypeIcon, renderTypeIcon } from '../icons'
import { describeSuggestion, useNewEntrySuggestions } from '../useSearch'
import { PageHeader } from '../layout/PageHeader'
import {
  ENTRY_TYPE_GROUPS,
  ENTRY_TYPES,
  getType,
  type EntryType
} from '../../../../main/vault/entryTypes'

/** What most people save most often, offered before the full catalogue. */
const COMMON = ['login', 'creditCard', 'bankAccount', 'passport', 'wifi', 'secureNote']

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Every query word appears in the type's label, description or keywords. */
function matchesType(t: EntryType, query: string): boolean {
  const hay = fold([t.label, t.description, ...(t.keywords ?? [])].join(' '))
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

function TypeCard({
  type,
  onPick,
  detail,
  highlight,
  semantic
}: {
  type: EntryType
  onPick: () => void
  detail?: string
  highlight?: boolean
  semantic?: boolean
}) {
  return (
    <button
      onClick={onPick}
      className={cn(
        'group flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        highlight && 'border-primary/40 bg-primary/5'
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        {renderTypeIcon(type.id, 'size-4.5')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {type.label}
          {semantic && <Sparkles className="size-3 text-primary" />}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {detail ?? type.description}
        </span>
      </span>
      <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}

/**
 * Step 1 of the new-entry wizard: say what you want to save, or pick it from the
 * catalogue. The query uses the same matching as search: recognised numbers
 * (prefilled), type names and keywords, and the local model's sense of meaning.
 */
export function CreatePage({
  group,
  suggest,
  people
}: {
  group?: string
  suggest?: string
  people?: string[]
}) {
  const open = useVault((s) => s.open)
  const [query, setQuery] = useState('')
  const suggestions = useNewEntrySuggestions(query)
  const q = query.trim()

  // Opened (not replaced): Back from the form returns here, like a wizard.
  const pick = (type: string, prefill?: Record<string, string>) =>
    open({ kind: 'new', type, group, prefill, people })

  const catalogue = useMemo(
    () =>
      ENTRY_TYPE_GROUPS.map((g) => ({
        group: g,
        types: ENTRY_TYPES.filter((t) => t.group === g.id && (!q || matchesType(t, q)))
      })).filter((g) => g.types.length),
    [q]
  )
  const first = suggestions[0]?.typeId ?? catalogue[0]?.types[0]?.id

  const common = [...new Set([suggest, ...COMMON].filter((id): id is string => !!id))]
    .map((id) => getType(id))
    .filter((t): t is EntryType => !!t)

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <span className="truncate font-medium">New entry</span>
        <span className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
            1
          </span>
          Choose a type
          <ChevronRight className="size-3" />
          <span className="grid size-4 place-items-center rounded-full bg-muted text-[10px]">
            2
          </span>
          Details
        </span>
      </PageHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
          <div>
            <h1 className="mb-3 text-2xl font-semibold tracking-tight">
              What do you want to save?
            </h1>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !first) return
                  e.preventDefault()
                  const s = suggestions[0]
                  if (s) pick(s.typeId, s.prefill)
                  else pick(first)
                }}
                placeholder="Try “passport”, “wifi at home”, “Krankenkasse”, or paste a number…"
                aria-label="What do you want to save?"
                className="h-12 w-full rounded-xl border border-input bg-background pr-4 pl-11 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>

          {q && suggestions.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Best match
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {suggestions.map((s, i) => {
                  const type = getType(s.typeId)
                  if (!type) return null
                  return (
                    <TypeCard
                      key={s.typeId}
                      type={type}
                      highlight={i === 0}
                      semantic={s.via === 'semantic'}
                      detail={describeSuggestion(s).detail}
                      onPick={() => pick(s.typeId, s.prefill)}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {!q && (
            <section>
              <h2 className="mb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {suggest ? 'Suggested' : 'Common'}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {common.map((t) => (
                  <TypeCard
                    key={t.id}
                    type={t}
                    highlight={t.id === suggest}
                    onPick={() => pick(t.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {catalogue.map(({ group: g, types }) => (
            <section key={g.id}>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                {renderGroupTypeIcon(g.id, 'size-3.5')} {g.label}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {types.map((t) => (
                  <TypeCard key={t.id} type={t} onPick={() => pick(t.id)} />
                ))}
              </div>
            </section>
          ))}

          {q && !suggestions.length && !catalogue.length && (
            <p className="text-sm text-muted-foreground">
              Nothing fits “{q}”. A{' '}
              <button
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => pick('secureNote')}
              >
                secure note
              </button>{' '}
              holds anything.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
