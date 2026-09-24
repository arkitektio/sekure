import { House, Layers, Plus, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { ALL_ENTRIES, typeFilter, useVault } from '@/stores/vault'
import { cn } from '@/lib/utils'
import { renderGroupIcon, renderSummaryIcon, renderTypeIcon } from '../icons'
import { HOME, pageOf, type Page } from '../tabs'
import { findGroup, pageLabel } from './labels'
import { personFilter, personName } from '../people'
import { VaultAvatar } from '@/components/VaultAvatar'
import type { VaultSnapshot } from '../../../../main/vault/protocol'

function PageIcon({ snapshot, page }: { snapshot: VaultSnapshot | undefined; page: Page }) {
  const cls = 'size-3.5 shrink-0'
  if (page.kind === 'home') return <House className={cls} />
  if (page.kind === 'create') return <Plus className={cls} />
  if (page.kind === 'new') return renderTypeIcon(page.type, cls)
  if (page.kind === 'entry') {
    const e = snapshot?.entries.find((x) => x.uuid === page.uuid)
    return e ? renderSummaryIcon(e, cls) : <Layers className={cls} />
  }
  if (page.scope === ALL_ENTRIES) return <Layers className={cls} />
  const person = personFilter(page.scope)
  if (person) {
    const p = snapshot?.entries.find((e) => e.uuid === person)
    return (
      <VaultAvatar
        name={p ? personName(p) : '?'}
        current
        className="size-3.5 rounded-full text-[7px]"
      />
    )
  }
  const type = typeFilter(page.scope)
  if (type) return renderTypeIcon(type, cls)
  const g = snapshot && findGroup(snapshot.root, page.scope)
  return renderGroupIcon(g?.icon, !!g?.isRecycleBin, cls)
}

/** The open tabs, listed vertically in the rail like orkestrator's. */
export function RailTabs() {
  const snapshot = useVault((s) => s.snapshot)
  const tabs = useVault((s) => s.tabs)
  const activeTab = useVault((s) => s.activeTab)
  const focusTab = useVault((s) => s.focusTab)
  const closeTab = useVault((s) => s.closeTab)
  const open = useVault((s) => s.open)

  return (
    <div className="app-no-drag flex min-w-0 flex-col gap-0.5" aria-label="Open tabs">
      <div className="flex items-center justify-between px-2 pt-1 pb-1">
        <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
          Open
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground"
              onClick={() => open(HOME, { newTab: true })}
              aria-label="New tab"
            >
              <Plus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            New tab <Kbd>⌘T</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
      {tabs.map((t) => {
        const page = pageOf(t)
        const active = t.id === activeTab
        const label = pageLabel(snapshot, page)
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => focusTab(t.id)}
            onKeyDown={(e) => e.key === 'Enter' && focusTab(t.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
            className={cn(
              'group relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              active
                ? 'bg-background/70 text-foreground shadow-xs ring-1 ring-border/40 backdrop-blur-sm'
                : 'text-muted-foreground hover:bg-background/35'
            )}
          >
            <span className={cn(active ? 'text-primary' : 'text-muted-foreground')}>
              <PageIcon snapshot={snapshot} page={page} />
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                (page.kind === 'new' || page.kind === 'create') && 'italic'
              )}
            >
              {label}
            </span>
            <button
              className={cn(
                'grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
                active ? 'visible' : 'invisible group-hover:visible'
              )}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
              aria-label={`Close ${label}`}
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
