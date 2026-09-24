import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { api, displayError } from '@/lib/api'
import { useSemanticStatus } from '@/vault/useSearch'

/** On/off for the built-in embedding model behind “Related” results and “Add …” hints. */
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
    off: 'Uses a language model built into Sekure. It runs entirely on this device.',
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
          disabled={busy}
          onCheckedChange={(checked) =>
            void run(() => (checked ? api.search.enableSemantic() : api.search.disableSemantic()))
          }
        />
      </label>
      {status.state === 'indexing' && (
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
    </section>
  )
}
