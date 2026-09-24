import { useCallback, useEffect, useState } from 'react'
import { Settings, ShieldAlert, Vault } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { BrandCustomizer } from '@/components/BrandCustomizer'
import { SmartSearchSettings } from '@/components/SmartSearchSettings'
import { DeidentifySettings } from '@/components/DeidentifySettings'
import { LockSettings } from '@/components/LockSettings'
import { UpdateSettings } from '@/components/UpdateSettings'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePlatform } from '@/hooks/usePlatform'
import { useGlass } from '@/hooks/useChrome'
import { api, displayError } from '@/lib/api'
import { acceleratorFromEvent, formatAccelerator } from '@/vault/autotype'
import {
  DEFAULT_AUTOTYPE_SHORTCUT,
  type AutoTypeSettings,
  type AutoTypeStatus
} from '../../../main/autotype/protocol'
import type { Preferences } from '../../../main/preferences/protocol'

/** App settings: brand color and auto-type. Both are also stored in the open vault. */
/** See-through sidebar: macOS vibrancy / Windows acrylic. A device setting, not in the vault. */
function GlassSetting() {
  const platform = usePlatform()
  const glass = useGlass((s) => s.glass)
  const setGlass = useGlass((s) => s.setGlass)
  if (platform !== 'darwin' && platform !== 'win32') return null
  return (
    <label className="flex items-center justify-between text-sm">
      <span>
        Translucent sidebar
        <span className="block text-xs text-muted-foreground">
          Lets the desktop show through the sidebar.
        </span>
      </span>
      <Switch
        checked={glass}
        onCheckedChange={(on) => void setGlass(on).catch((e) => toast.error(displayError(e)))}
      />
    </label>
  )
}

export function SettingsButton() {
  const isMac = usePlatform() === 'darwin'
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<Preferences>()
  const [settings, setSettings] = useState<AutoTypeSettings>()
  const [status, setStatus] = useState<AutoTypeStatus>()
  const [recording, setRecording] = useState(false)

  const load = useCallback(async () => {
    const [p, st] = await Promise.all([api.preferences.get(), api.autotype.status()])
    setPrefs(p)
    setSettings(p.autotype)
    setStatus(st)
  }, [])

  useEffect(() => {
    if (!open) return
    // Accessibility is granted in System Settings; pick it up on return.
    window.addEventListener('focus', load)
    const off = api.preferences.onChange((p) => {
      setPrefs(p)
      setSettings(p.autotype)
    })
    return () => {
      window.removeEventListener('focus', load)
      off()
    }
  }, [open, load])

  const update = async (patch: Partial<AutoTypeSettings>) => {
    try {
      setStatus(await api.autotype.setSettings(patch))
      setSettings(await api.autotype.getSettings())
    } catch (e) {
      toast.error(displayError(e))
    }
  }

  // The active shortcut is paused while recording, so pressing it again (or
  // a combination close to it) reaches this window instead of the popup.
  const startRecording = () => {
    setRecording(true)
    void api.autotype.suspend(true)
  }

  const cancelRecording = () => {
    if (!recording) return
    setRecording(false)
    void api.autotype.suspend(false)
  }

  const onRecordKey = (e: React.KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      cancelRecording()
      return
    }
    const accel = acceleratorFromEvent(e.nativeEvent, isMac)
    if (!accel) return
    setRecording(false)
    // Registers the new shortcut, or restores the previous one if it's taken.
    void update({ shortcut: accel })
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setOpen(true)
              void load()
            }}
            aria-label="Settings"
          >
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) cancelRecording()
          setOpen(o)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              {prefs?.vault ? (
                <span className="flex items-start gap-1.5">
                  <Vault className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Also stored in <b className="font-medium">{prefs.vault}</b>. Save the vault and
                    your other devices pick them up when they open it.
                  </span>
                </span>
              ) : (
                'Stored on this device. Unlock a vault to store them in it too.'
              )}
            </DialogDescription>
          </DialogHeader>
          {prefs && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Appearance</h3>
              <BrandCustomizer brand={prefs.brand} />
              <GlassSetting />
            </section>
          )}
          <Separator />
          {settings && (
            <section className="flex flex-col gap-4">
              <div>
                <h3 className="text-sm font-medium">Auto-type</h3>
                <p className="text-xs text-muted-foreground">
                  Press the shortcut in any app to search your vault and type a field into the
                  focused input.
                </p>
              </div>
              <label className="flex items-center justify-between text-sm">
                Enable global shortcut
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(enabled) => void update({ enabled })}
                />
              </label>
              <div className="flex items-center justify-between text-sm">
                Shortcut
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!settings.enabled}
                  onClick={startRecording}
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
              {settings.enabled && (
                <p className="-mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  Click, then press the new combination. It needs at least ⌘/Ctrl or ⌥/Alt.
                  {settings.shortcut !== DEFAULT_AUTOTYPE_SHORTCUT && (
                    <Button
                      variant="link"
                      size="xs"
                      className="px-0"
                      onClick={() => void update({ shortcut: DEFAULT_AUTOTYPE_SHORTCUT })}
                    >
                      Reset to {formatAccelerator(DEFAULT_AUTOTYPE_SHORTCUT, isMac)}
                    </Button>
                  )}
                </p>
              )}
              {settings.enabled && status && !status.registered && (
                <p className="text-sm text-destructive">
                  This shortcut is used by another app. Pick a different one.
                </p>
              )}
              {status?.permission === 'denied' && (
                <div className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <div className="flex flex-col gap-2">
                    <p>
                      Sekure needs Accessibility access to paste into other apps. Until then, the
                      value is copied and you press ⌘V yourself.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start"
                      onClick={() => void api.autotype.requestPermission().then(setStatus)}
                    >
                      Grant access
                    </Button>
                  </div>
                </div>
              )}
              {status?.platformNote && (
                <p className="text-xs text-muted-foreground">{status.platformNote}</p>
              )}
            </section>
          )}
          <Separator />
          <LockSettings />
          <Separator />
          <SmartSearchSettings />
          <Separator />
          <DeidentifySettings />
          <Separator />
          <UpdateSettings />
        </DialogContent>
      </Dialog>
    </>
  )
}
