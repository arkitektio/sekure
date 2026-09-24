import { useState } from 'react'
import { ArrowDownToLine, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api, displayError } from '@/lib/api'
import { restartToUpdate, useUpdateState } from '@/hooks/useUpdates'
import { cn } from '@/lib/utils'
import type { UpdateChannel, UpdateState } from '../../../main/updater/protocol'

const CHANNELS: { id: UpdateChannel; label: string; hint: string }[] = [
  { id: 'latest', label: 'Stable', hint: 'Released versions' },
  { id: 'next', label: 'Next', hint: 'Release candidates, a few days earlier' }
]

function statusText(s: UpdateState): string {
  switch (s.phase) {
    case 'disabled':
      return 'Updates are off in development builds.'
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading ${s.version ?? 'an update'}… ${Math.round((s.progress ?? 0) * 100)}%`
    case 'ready':
      return `Sekure ${s.version} is ready. Restart to install it, or it installs when you quit.`
    case 'upToDate':
      return 'Sekure is up to date.'
    case 'error':
      return `Could not check for updates: ${s.error ?? 'unknown error'}`
    default:
      return 'Sekure checks for updates on start and every few hours.'
  }
}

/** Version, update channel, a manual check, and restart when an update is ready. */
export function UpdateSettings() {
  const state = useUpdateState()
  const [busy, setBusy] = useState(false)
  if (!state) return null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(displayError(e))
    } finally {
      setBusy(false)
    }
  }
  const disabled = state.phase === 'disabled'

  return (
    <section className="flex flex-col gap-3" aria-label="Updates">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Updates</h3>
        <span className="text-xs text-muted-foreground tabular-nums">Sekure {state.current}</span>
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Update channel">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            role="radio"
            aria-checked={state.channel === c.id}
            disabled={busy}
            onClick={() => state.channel !== c.id && void run(() => api.updater.setChannel(c.id))}
            className={cn(
              'rounded-lg border px-3 py-2 text-left transition-colors',
              state.channel === c.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/60'
            )}
          >
            <span className="block text-sm font-medium">{c.label}</span>
            <span className="block text-xs text-muted-foreground">{c.hint}</span>
          </button>
        ))}
      </div>
      {state.phase === 'downloading' && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <p
          className={cn(
            'min-w-0 flex-1 text-xs',
            state.phase === 'error' ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {statusText(state)}
        </p>
        {state.phase === 'ready' ? (
          <Button size="sm" onClick={() => void restartToUpdate()}>
            <ArrowDownToLine /> Restart
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={
              disabled || busy || state.phase === 'checking' || state.phase === 'downloading'
            }
            onClick={() => void run(() => api.updater.check())}
          >
            {state.phase === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Check now
          </Button>
        )}
      </div>
    </section>
  )
}
