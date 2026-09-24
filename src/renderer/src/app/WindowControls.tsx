import { Minus, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePlatform } from '@/hooks/usePlatform'
import { api } from '@/lib/api'

/** Minimise / maximise / close for Windows and Linux (macOS has its traffic lights). */
export function WindowControls() {
  const platform = usePlatform()
  if (!platform || platform === 'darwin') return null
  return (
    <div className="app-no-drag ml-1 flex items-center">
      <Button variant="ghost" size="icon-sm" onClick={() => api.windowControls.minimize()}>
        <Minus />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => api.windowControls.toggleMaximize()}>
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
  )
}
