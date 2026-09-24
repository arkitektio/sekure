import { ArrowDownToLine } from 'lucide-react'
import { useUpdateState, restartToUpdate } from '@/hooks/useUpdates'
import { cn } from '@/lib/utils'

/**
 * "Sekure 1.4.0 is ready · Restart": shown once an update has downloaded. Ignoring
 * it is fine, it installs on the next quit anyway.
 */
export function UpdateReady({ className }: { className?: string }) {
  const state = useUpdateState()
  if (state?.phase !== 'ready') return null
  return (
    <button
      onClick={() => void restartToUpdate()}
      title={`Restart to install Sekure ${state.version}. Unsaved changes are saved first.`}
      className={cn(
        'app-no-drag flex w-full items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-primary/15',
        className
      )}
    >
      <ArrowDownToLine className="size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate">Sekure {state.version} is ready</span>
      <span className="shrink-0 font-medium text-primary">Restart</span>
    </button>
  )
}
