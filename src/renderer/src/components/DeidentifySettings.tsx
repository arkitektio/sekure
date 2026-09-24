import { useEffect, useState } from 'react'
import { EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import { usePlatform } from '@/hooks/usePlatform'
import { api, displayError } from '@/lib/api'
import { acceleratorFromEvent, formatAccelerator } from '@/vault/autotype'
import {
  DEFAULT_DEIDENTIFY_SHORTCUT,
  type DeidentifySettings as Settings,
  type DeidentifyStatus
} from '../../../main/deidentify/protocol'

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

/** Settings for deidentifying selected text (device-local, not synced to the vault). */
export function DeidentifySettings() {
  const isMac = usePlatform() === 'darwin'
  const [settings, setSettings] = useState<Settings>()
  const [status, setStatus] = useState<DeidentifyStatus>()
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.deidentify.getSettings().then(setSettings)
    void api.deidentify.status().then(setStatus)
    return api.deidentify.onStatus(setStatus)
  }, [])

  if (!settings || !status) return null

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(displayError(e))
    } finally {
      setBusy(false)
    }
  }

  const update = (patch: Partial<Settings>) =>
    run(async () => {
      setStatus(await api.deidentify.setSettings(patch))
      setSettings(await api.deidentify.getSettings())
    })

  const cancelRecording = () => {
    if (!recording) return
    setRecording(false)
    void api.deidentify.suspend(false)
  }

  const onRecordKey = (e: React.KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') return cancelRecording()
    const accel = acceleratorFromEvent(e.nativeEvent, isMac)
    if (!accel) return
    setRecording(false)
    void update({ shortcut: accel })
  }

  const model = status.model
  const modelOn = settings.model && model.state !== 'off'

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <EyeOff className="size-3.5 text-primary" /> Deidentify selected text
        </h3>
        <p className="text-xs text-muted-foreground">
          Select text in any app and press the shortcut. Personal data becomes placeholders like
          [PERSON_1], and anything matching a credential in your vault is always removed. Runs on
          this device only.
        </p>
      </div>
      <label className="flex items-center justify-between text-sm">
        Enable shortcut
        <Switch
          checked={settings.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => void update({ enabled })}
        />
      </label>
      <div className="flex items-center justify-between text-sm">
        Shortcut
        <Button
          variant="outline"
          size="sm"
          disabled={!settings.enabled}
          onClick={() => {
            setRecording(true)
            void api.deidentify.suspend(true)
          }}
          onKeyDown={recording ? onRecordKey : undefined}
          onBlur={cancelRecording}
        >
          {recording ? (
            'Press a key combination…'
          ) : (
            <Kbd>{formatAccelerator(settings.shortcut, isMac)}</Kbd>
          )}
        </Button>
      </div>
      {settings.enabled && settings.shortcut !== DEFAULT_DEIDENTIFY_SHORTCUT && (
        <Button
          variant="link"
          size="xs"
          className="-mt-3 self-end px-0"
          onClick={() => void update({ shortcut: DEFAULT_DEIDENTIFY_SHORTCUT })}
        >
          Reset to {formatAccelerator(DEFAULT_DEIDENTIFY_SHORTCUT, isMac)}
        </Button>
      )}
      {settings.enabled && !status.registered && (
        <p className="text-sm text-destructive">
          This shortcut is used by auto-type or another app. Pick a different one.
        </p>
      )}

      <label className="flex items-center justify-between text-sm">
        Detect names, addresses and IDs
        <Switch
          checked={modelOn}
          disabled={busy || model.state === 'downloading'}
          onCheckedChange={(on) =>
            void run(() => (on ? api.deidentify.enableModel() : api.deidentify.disableModel(false)))
          }
        />
      </label>
      {model.state === 'downloading' && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${Math.round((model.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}
      <p
        className={
          model.state === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
        }
      >
        {model.state === 'error'
          ? model.message
          : modelOn
            ? 'A local PII model (GLiNER, many languages) finds people, organizations, addresses and ID numbers.'
            : `Without it, emails, phone numbers, IBANs, cards, keys and vault credentials are still found. Downloads a ${megabytes(status.modelBytes)} model once.`}
      </p>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {status.mappings
            ? `${status.mappings} placeholders can be restored (forgotten on lock or after 30 minutes).`
            : 'No placeholders to restore.'}
        </span>
        <span className="flex gap-2">
          {status.mappings > 0 && (
            <Button
              variant="link"
              size="xs"
              className="px-0"
              onClick={() => void api.deidentify.forget()}
            >
              Forget now
            </Button>
          )}
          {modelOn && (
            <Button
              variant="link"
              size="xs"
              className="px-0 text-muted-foreground"
              disabled={busy}
              onClick={() => void run(() => api.deidentify.disableModel(true))}
            >
              Delete model
            </Button>
          )}
        </span>
      </div>
    </section>
  )
}
