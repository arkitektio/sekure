import type { ReactNode } from 'react'
import { House, Layers, Plus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { ALL_ENTRIES, activePage, useVault } from '@/stores/vault'
import { cn } from '@/lib/utils'
import { clickOptions, HOME, type OpenOptions } from '../tabs'
import { listPeople, personFilterId, personName } from '../people'
import { vaultInitials } from '@/components/VaultAvatar'

/** People get tiles too (family members at a glance); more are on Home. */
const MAX_PERSON_TILES = 6

function Tile({
  label,
  shortcut,
  active,
  onOpen,
  children
}: {
  label: string
  shortcut?: string
  active?: boolean
  onOpen: (opts: OpenOptions | undefined) => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onClick={(e) => onOpen(clickOptions(e))}
          onAuxClick={(e) => e.button === 1 && onOpen(clickOptions(e))}
          className={cn(
            'grid h-9 w-full place-items-center rounded-lg ring-1 transition-colors [&_svg]:size-4',
            active
              ? 'bg-background/80 text-foreground shadow-none ring-primary/35'
              : 'bg-background/25 text-muted-foreground shadow-[inset_0_1px_2px_rgb(0_0_0/0.10)] ring-border/30 hover:bg-background/55 hover:text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The rail's tile row, like orkestrator's module grid: where a tab can go.
 * Categories and groups live on Home, not in the rail.
 */
export function RailTiles() {
  const page = useVault(activePage)
  const open = useVault((s) => s.open)
  const startNew = useVault((s) => s.startNew)
  const snapshot = useVault((s) => s.snapshot)
  const people = listPeople(snapshot)
  return (
    <div className="app-no-drag grid grid-cols-[repeat(auto-fit,minmax(2.25rem,1fr))] gap-1 px-2 pb-3">
      <Tile label="Home" active={page.kind === 'home'} onOpen={(o) => open(HOME, o)}>
        <House />
      </Tile>
      <Tile
        label="All entries"
        active={page.kind === 'list' && page.scope === ALL_ENTRIES}
        onOpen={(o) => open({ kind: 'list', scope: ALL_ENTRIES }, o)}
      >
        <Layers />
      </Tile>
      <Tile
        label="New entry"
        shortcut="⌘N"
        active={page.kind === 'new' || page.kind === 'create'}
        onOpen={() => startNew()}
      >
        <Plus />
      </Tile>
      {people.slice(0, MAX_PERSON_TILES).map((p) => {
        const name = personName(p)
        const scope = personFilterId(p.uuid)
        return (
          <Tile
            key={p.uuid}
            label={name}
            active={page.kind === 'list' && page.scope === scope}
            onOpen={(o) => open({ kind: 'list', scope }, o)}
          >
            <span className="text-[11px] font-semibold">{vaultInitials(name)}</span>
          </Tile>
        )
      })}
    </div>
  )
}
