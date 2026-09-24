import { useCallback, useEffect, useRef, useState } from 'react'
import { Fingerprint, Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, displayError, errorCode } from '@/lib/api'
import type { RecentVault } from '../../../main/sources/protocol'
import type { VaultSnapshot } from '../../../main/vault/protocol'

/**
 * Compact unlock for the auto-type popup: the most recently opened vault,
 * Touch ID when set up, otherwise the master password. Key-file vaults are
 * unlocked in the main window.
 */
export function QuickUnlock({
  openedAt,
  onUnlocked
}: {
  /** Changes every time the popup opens, to re-offer Touch ID. */
  openedAt: number
  onUnlocked: (snapshot: VaultSnapshot) => void
}) {
  const [vault, setVault] = useState<RecentVault | null>()
  const [bio, setBio] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'password' | 'touchid'>()
  const [error, setError] = useState<string>()
  const passwordRef = useRef<HTMLInputElement>(null)

  const touchId = useCallback(
    async (fileId: string) => {
      setBusy('touchid')
      setError(undefined)
      // The system prompt takes focus; don't let that close the popup.
      await api.autotype.keepOpen(true)
      try {
        onUnlocked(await api.biometric.unlock(fileId))
      } catch (e) {
        const msg = displayError(e)
        if (!/cancel/i.test(msg)) setError(msg)
        if (errorCode(e) === 'InvalidKey') setBio(false)
        passwordRef.current?.focus()
      } finally {
        await api.autotype.keepOpen(false)
        setBusy(undefined)
      }
    },
    [onUnlocked]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [recent] = await api.sources.recent()
      if (cancelled) return
      setVault(recent ?? null)
      setError(undefined)
      if (!recent) return
      const [available, enabled] = await Promise.all([
        api.biometric.available(),
        api.biometric.enabled(recent.id)
      ])
      if (cancelled) return
      setBio(available && enabled)
      if (available && enabled) void touchId(recent.id)
      else passwordRef.current?.focus()
    })()
    return () => {
      cancelled = true
    }
  }, [openedAt, touchId])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!vault) return
    setBusy('password')
    setError(undefined)
    try {
      const snapshot = await api.vault.open({ fileId: vault.id, password })
      setPassword('')
      onUnlocked(snapshot)
    } catch (err) {
      setError(errorCode(err) === 'InvalidKey' ? 'Wrong password.' : displayError(err))
      passwordRef.current?.select()
    } finally {
      setBusy(undefined)
    }
  }

  if (vault === undefined) return null
  if (vault === null) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        Open a vault in Sekure first.
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col justify-center gap-3 px-10">
      <div className="mb-2 flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Lock className="size-4.5" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{vault.name}</p>
          <p className="text-xs text-muted-foreground">Unlock to auto-type</p>
        </div>
      </div>
      {bio && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void touchId(vault.id)}
          disabled={!!busy}
        >
          {busy === 'touchid' ? <Loader2 className="animate-spin" /> : <Fingerprint />}
          Unlock with Touch ID
        </Button>
      )}
      <Input
        ref={passwordRef}
        type="password"
        placeholder="Master password"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={!!error}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!password || !!busy}>
        {busy === 'password' && <Loader2 className="animate-spin" />}
        Unlock
      </Button>
    </form>
  )
}
