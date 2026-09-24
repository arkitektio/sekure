import { useEffect, useState } from 'react'
import { ChevronDown, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { api, displayError } from '@/lib/api'
import type { VaultSettings } from '../../../main/vault/settings'

const AUTO_LOCK_CHOICES = [1, 2, 5, 10, 15, 30, 60, 0]

const minutesLabel = (m: number) =>
  m === 0 ? 'Never' : m < 60 ? `After ${m} min` : `After ${m / 60} h`

/** Auto-lock after inactivity and on sleep. A device setting, not stored in the vault. */
export function LockSettings() {
  const [settings, setSettings] = useState<VaultSettings>()

  useEffect(() => {
    void api.vault.getSettings().then(setSettings)
  }, [])

  const update = async (patch: Partial<VaultSettings>) => {
    try {
      setSettings(await api.vault.setSettings(patch))
    } catch (e) {
      toast.error(displayError(e))
    }
  }

  if (!settings) return null
  const choices = AUTO_LOCK_CHOICES.includes(settings.autoLockMinutes)
    ? AUTO_LOCK_CHOICES
    : [...AUTO_LOCK_CHOICES, settings.autoLockMinutes]

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Lock className="size-3.5 text-primary" /> Auto-lock
        </h3>
        <p className="text-xs text-muted-foreground">
          An unlocked vault stays open while you use it. Once locked, it stays locked until you
          unlock it again.
        </p>
      </div>
      <div className="flex items-center justify-between text-sm">
        Lock when inactive
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {minutesLabel(settings.autoLockMinutes)}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={String(settings.autoLockMinutes)}
              onValueChange={(v) => void update({ autoLockMinutes: Number(v) })}
            >
              {choices.map((m) => (
                <DropdownMenuRadioItem key={m} value={String(m)}>
                  {minutesLabel(m)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <label className="flex items-center justify-between text-sm">
        Lock when the computer sleeps or locks
        <Switch
          checked={settings.lockOnSleep}
          onCheckedChange={(lockOnSleep) => void update({ lockOnSleep })}
        />
      </label>
    </section>
  )
}
