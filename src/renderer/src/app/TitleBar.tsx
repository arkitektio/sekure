import { Minus, ShieldCheck, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AccountMenu } from '@/components/AccountMenu'
import { SettingsButton } from '@/components/SettingsDialog'
import { VaultTitle } from '@/vault/VaultTitle'
import { usePlatform } from '@/hooks/usePlatform'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Must match `trafficLightPosition` in WindowManager (x:12, y:14). */
export const TITLE_BAR_HEIGHT = 44

export function TitleBar() {
  const platform = usePlatform()
  const isMac = platform === 'darwin'

  return (
    <header
      className={cn(
        'app-drag flex shrink-0 items-center gap-2 border-b bg-sidebar pr-2',
        isMac ? 'pl-20' : 'pl-3'
      )}
      style={{ height: TITLE_BAR_HEIGHT }}
      onDoubleClick={() => !isMac && api.windowControls.toggleMaximize()}
    >
      <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <ShieldCheck className="size-4.5 text-primary" />
        Sekure
      </div>
      <div className="flex min-w-0 flex-1 justify-center">
        <VaultTitle />
      </div>
      <div className="app-no-drag flex items-center gap-1">
        <SettingsButton />
        <ThemeToggle />
        <AccountMenu />
      </div>
      {platform && !isMac && (
        <div className="app-no-drag ml-1 flex items-center">
          <Button variant="ghost" size="icon-sm" onClick={() => api.windowControls.minimize()}>
            <Minus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => api.windowControls.toggleMaximize()}
          >
            <Square className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:bg-destructive hover:text-white"
            onClick={() => api.windowControls.close()}
          >
            <X />
          </Button>
        </div>
      )}
    </header>
  )
}
