import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Lock, Save } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { SettingsButton } from '@/components/SettingsDialog'
import { UpdateReady } from '@/components/UpdateReady'
import { usePlatform } from '@/hooks/usePlatform'
import { useWindowState } from '@/hooks/useChrome'
import { useVault } from '@/stores/vault'
import { cn } from '@/lib/utils'
import { SearchPill } from '../SearchPalette'
import { useVaultActions } from '../useVaultActions'
import { activeTabOf } from '../tabs'
import { RailResizer } from './RailResizer'
import { RailTiles } from './RailTiles'
import { RailTabs } from './RailTabs'
import { VaultSwitcher } from './VaultSwitcher'

/** Room for the macOS traffic lights (`trafficLightPosition` x:12 in WindowManager). */
const TRAFFIC_LIGHT_GUTTER = 72

function RailButton({
  label,
  shortcut,
  onClick,
  disabled,
  children
}: {
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className="app-no-drag grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/** Row 1 of the rail: traffic lights, back/forward for the active tab, save and lock. */
function RailChrome() {
  const isMac = usePlatform() === 'darwin'
  const { fullscreen } = useWindowState()
  const dirty = useVault((s) => !!s.snapshot?.dirty)
  const canBack = useVault((s) => activeTabOf(s).index > 0)
  const canForward = useVault((s) => {
    const t = activeTabOf(s)
    return t.index < t.history.length - 1
  })
  const back = useVault((s) => s.back)
  const forward = useVault((s) => s.forward)
  const { save, lock } = useVaultActions()

  return (
    <div className="flex h-7 items-center gap-0.5">
      <div style={{ width: isMac && !fullscreen ? TRAFFIC_LIGHT_GUTTER : 0 }} />
      <RailButton label="Back" shortcut="⌘[" onClick={back} disabled={!canBack}>
        <ArrowLeft />
      </RailButton>
      <RailButton label="Forward" shortcut="⌘]" onClick={forward} disabled={!canForward}>
        <ArrowRight />
      </RailButton>
      <div className="flex-1" />
      <RailButton label="Save" shortcut="⌘S" onClick={() => void save()} disabled={!dirty}>
        <Save className={cn(dirty && 'text-primary')} />
      </RailButton>
      <RailButton label="Lock" shortcut="⌘L" onClick={() => void lock()}>
        <Lock />
      </RailButton>
    </div>
  )
}

/**
 * The open vault, laid out like orkestrator: a (glass) rail with search, open
 * tabs, groups and the vault switcher, and the active tab in an inset card.
 */
export function VaultLayout({ children }: { children: ReactNode }) {
  return (
    <div className="rail-glass-surface flex h-full bg-sidebar text-foreground">
      <aside className="app-drag relative flex w-(--rail-width,256px) shrink-0 flex-col">
        <div className="flex shrink-0 flex-col gap-2 px-2 pt-2 pb-2">
          <RailChrome />
          <SearchPill />
        </div>
        <RailTiles />
        <nav className="min-h-0 flex-1 overflow-y-auto px-2">
          <RailTabs />
        </nav>
        <div className="shrink-0 px-2 pt-1">
          <UpdateReady />
        </div>
        <div className="flex shrink-0 items-center gap-1 px-2 pt-1 pb-2">
          <VaultSwitcher />
          <div className="app-no-drag flex items-center">
            <SettingsButton />
          </div>
        </div>
        <RailResizer />
      </aside>
      <main className="relative isolate m-2 ml-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm [clip-path:inset(0_round_var(--radius-xl))]">
        {children}
      </main>
    </div>
  )
}
