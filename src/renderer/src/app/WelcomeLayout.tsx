import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { SettingsButton } from '@/components/SettingsDialog'
import { UpdateReady } from '@/components/UpdateReady'
import { usePlatform } from '@/hooks/usePlatform'
import { api } from '@/lib/api'
import { WindowControls } from './WindowControls'

/**
 * The window while no vault is open, as orkestrator's welcome layout: the rail
 * belongs to an open vault, so there is only a drag strip (room for the traffic
 * lights) over the same inset card the vault uses. Unlocking then reads as the
 * rail arriving, not as a different app.
 */
export function WelcomeLayout({ children }: { children: ReactNode }) {
  const isMac = usePlatform() === 'darwin'
  return (
    <div className="rail-glass-surface flex h-full flex-col bg-sidebar text-foreground">
      <div
        className="app-drag flex h-10 shrink-0 items-center gap-1 px-2"
        onDoubleClick={(e) => {
          if (!isMac && e.target === e.currentTarget) void api.windowControls.toggleMaximize()
        }}
      >
        <div className="flex-1" />
        <UpdateReady className="w-auto" />
        <div className="app-no-drag flex items-center">
          <SettingsButton />
          <ThemeToggle />
        </div>
        <WindowControls />
      </div>
      <main className="relative isolate mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm [clip-path:inset(0_round_var(--radius-xl))]">
        {children}
      </main>
    </div>
  )
}
