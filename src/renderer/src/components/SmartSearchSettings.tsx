import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { api, displayError } from '@/lib/api'
import { useSemanticStatus } from '@/vault/useSearch'

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

/** Opt-in for the local embedding model behind “Related” search results. */
export function SmartSearchSettings() {
  const status = useSemanticStatus()
  const [busy, setBusy] = useState(false)
  if (!status) return null

  const on = status.state !== 'off'
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

  const progress = status.progress !== undefined ? ` ${Math.round(status.progress * 100)}%` : ''
  const label: Record<typeof status.state, string> = {
    off: `Downloads a ${megabytes(status.downloadBytes)} language model once. Search then runs entirely on this device.`,
    downloading: `Downloading the model…${progress}`,
    loading: 'Loading the model…',
    indexing: `Reading your vault…${progress}`,
    ready: 'Finds entries by meaning in many languages: “travel document” finds your passport.',
    error: status.message ?? 'Smart search is not available.'
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-3.5 text-primary" /> Smart search
        </h3>
        <p className="text-xs text-muted-foreground">
          On this device only. Entry titles, types and field names are read by a local model;
          protected values never are, and nothing leaves your computer.
        </p>
      </div>
      <label className="flex items-center justify-between text-sm">
        Find related entries
        <Switch
          checked={on}
          disabled={busy || status.state === 'downloading'}
          onCheckedChange={(checked) =>
            void run(() =>
              checked ? api.search.enableSemantic() : api.search.disableSemantic(false)
            )
          }
        />
      </label>
      {(status.state === 'downloading' || status.state === 'indexing') && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}
      <p
        className={
          status.state === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
        }
      >
        {label[status.state]}
      </p>
      {(status.state === 'ready' || status.state === 'error') && (
        <Button
          variant="link"
          size="xs"
          className="self-start px-0 text-muted-foreground"
          disabled={busy}
          onClick={() => void run(() => api.search.disableSemantic(true))}
        >
          Turn off and delete the model
        </Button>
      )}
    </section>
  )
}
