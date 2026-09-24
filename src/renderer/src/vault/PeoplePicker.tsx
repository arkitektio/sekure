import { useState, type ReactNode } from 'react'
import { Check, Plus, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { VaultAvatar } from '@/components/VaultAvatar'
import { useVault } from '@/stores/vault'
import { api, displayError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { clickOptions } from './tabs'
import { listPeople, personFilterId, personName, suggestedPeople } from './people'
import { PERSON_TYPE } from '../../../main/vault/entryTypes'
import type { VaultEntrySummary } from '../../../main/vault/protocol'

/** A searchable list of people to tick, plus "New person…". */
export function PeoplePicker({
  value,
  onChange,
  exclude,
  children
}: {
  value: string[]
  onChange: (people: string[]) => void
  /** Never offered (an entry can't belong to itself). */
  exclude?: string
  children: ReactNode
}) {
  const snapshot = useVault((s) => s.snapshot)
  const open = useVault((s) => s.open)
  const [query, setQuery] = useState('')
  const people = listPeople(snapshot).filter(
    (p) => p.uuid !== exclude && personName(p).toLowerCase().includes(query.trim().toLowerCase())
  )
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <Popover onOpenChange={(o) => !o && setQuery('')}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-0 p-1">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a person…"
          aria-label="Find a person"
          className="mb-1 h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
        />
        <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="People">
          {people.map((p) => {
            const on = value.includes(p.uuid)
            return (
              <button
                key={p.uuid}
                role="option"
                aria-selected={on}
                onClick={() => toggle(p.uuid)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <VaultAvatar name={personName(p)} current={on} className="size-6 rounded-full" />
                <span className="min-w-0 flex-1 truncate">{personName(p)}</span>
                {on && <Check className="size-4 text-primary" />}
              </button>
            )
          })}
          {!people.length && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {query ? 'Nobody by that name.' : 'No people yet.'}
            </p>
          )}
        </div>
        <button
          onClick={() => open({ kind: 'new', type: PERSON_TYPE }, { newTab: true })}
          className="mt-1 flex w-full items-center gap-2 rounded-md border-t px-2 py-1.5 pt-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <UserPlus className="size-4" /> New person…
        </button>
      </PopoverContent>
    </Popover>
  )
}

/** A person as a chip; opens their page, ⌘-click in a new tab. */
function PersonChip({ person, onRemove }: { person: VaultEntrySummary; onRemove?: () => void }) {
  const selectGroup = useVault((s) => s.selectGroup)
  const name = personName(person)
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-0.5 text-xs">
      <button
        className="inline-flex items-center gap-1.5 rounded-full pr-1 hover:text-primary"
        onClick={(e) => selectGroup(personFilterId(person.uuid), clickOptions(e))}
        onAuxClick={(e) =>
          e.button === 1 && selectGroup(personFilterId(person.uuid), clickOptions(e))
        }
      >
        <VaultAvatar name={name} current className="size-5 rounded-full text-[9px]" />
        {name}
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Unlink ${name}`}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

/** Controlled chips + picker, for the entry form. */
export function PeopleField({
  value,
  onChange,
  exclude
}: {
  value: string[]
  onChange: (people: string[]) => void
  exclude?: string
}) {
  const snapshot = useVault((s) => s.snapshot)
  const byId = new Map(listPeople(snapshot).map((p) => [p.uuid, p]))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const p = byId.get(id)
        return p ? (
          <PersonChip
            key={id}
            person={p}
            onRemove={() => onChange(value.filter((v) => v !== id))}
          />
        ) : null
      })}
      <PeoplePicker value={value} onChange={onChange} exclude={exclude}>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground"
        >
          <Plus className="size-3" /> {value.length ? 'Add' : 'Link a person'}
        </button>
      </PeoplePicker>
    </div>
  )
}

/**
 * "Belongs to" on an entry page: linked people, the picker, and a one-click
 * suggestion when a document's name matches someone.
 */
export function EntryPeople({ uuid }: { uuid: string }) {
  const snapshot = useVault((s) => s.snapshot)
  const entry = snapshot?.entries.find((e) => e.uuid === uuid)
  if (!entry || entry.type === PERSON_TYPE) return null
  const people = entry.people ?? []
  const byId = new Map(listPeople(snapshot).map((p) => [p.uuid, p]))
  const suggestions = suggestedPeople(entry, snapshot)

  // `Promise.resolve().then`: a synchronous failure (e.g. a preload from before this
  // feature, in a dev session that was not restarted) still ends up in a toast.
  const save = (next: string[]) =>
    void Promise.resolve()
      .then(() => api.vault.setPeople(uuid, next))
      .catch((e) => toast.error(`Could not link: ${displayError(e)}`))

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Belongs to">
      <span className="text-xs text-muted-foreground">Belongs to</span>
      {people.map((id) => {
        const p = byId.get(id)
        return p ? (
          <PersonChip key={id} person={p} onRemove={() => save(people.filter((v) => v !== id))} />
        ) : null
      })}
      {suggestions.map((p) => (
        <span
          key={p.uuid}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-dashed border-primary/40 bg-primary/5 py-0.5 pr-1 pl-2 text-xs'
          )}
        >
          {personName(p)}?
          <button
            onClick={() => save([...people, p.uuid])}
            className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground"
          >
            Link
          </button>
        </span>
      ))}
      <PeoplePicker value={people} onChange={save} exclude={uuid}>
        <button
          className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed px-2 text-xs text-muted-foreground hover:border-solid hover:text-foreground"
          aria-label="Link a person"
        >
          <Plus className="size-3" /> {people.length ? '' : 'Person'}
        </button>
      </PeoplePicker>
    </div>
  )
}
