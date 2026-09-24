import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, FileKey2, Fingerprint, Loader2, Lock, X } from 'lucide-react'
import { SourceIcon } from '@/components/SourceIcon'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useVault } from '@/stores/vault'
import { api, displayError, errorCode } from '@/lib/api'
import type { VaultSnapshot } from '../../../main/vault/protocol'
import type { VaultRef } from '../../../main/sources/protocol'

export function Unlock() {
  const { fileId = '' } = useParams()
  const navigate = useNavigate()
  const setSnapshot = useVault((s) => s.setSnapshot)
  const reset = useVault((s) => s.reset)

  const [ref, setRef] = useState<VaultRef>()
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [keyFile, setKeyFile] = useState<{ name: string; bytes: Uint8Array }>()
  const [busy, setBusy] = useState<'password' | 'touchid'>()
  const [error, setError] = useState<string>()
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioEnabled, setBioEnabled] = useState(false)
  const [enableBio, setEnableBio] = useState(true)
  const autoPrompted = useRef(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const keyInputRef = useRef<HTMLInputElement>(null)

  const done = useCallback(
    (snapshot: VaultSnapshot) => {
      reset()
      setSnapshot(snapshot)
      navigate('/vault', { replace: true })
    },
    [navigate, reset, setSnapshot]
  )

  const unlockWithTouchId = useCallback(async () => {
    setBusy('touchid')
    setError(undefined)
    try {
      done(await api.biometric.unlock(fileId))
    } catch (e) {
      const msg = displayError(e)
      // User dismissed the system prompt — not an error worth shouting about.
      if (!/cancel/i.test(msg)) setError(msg)
      if (errorCode(e) === 'InvalidKey') setBioEnabled(false)
      passwordRef.current?.focus()
    } finally {
      setBusy(undefined)
    }
  }, [done, fileId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [described, available, enabled] = await Promise.all([
          api.sources.describe(fileId),
          api.biometric.available(),
          api.biometric.enabled(fileId)
        ])
        if (cancelled) return
        setRef(described)
        setBioAvailable(available)
        setBioEnabled(enabled)
        if (available && enabled && !autoPrompted.current) {
          autoPrompted.current = true
          void unlockWithTouchId()
        }
      } catch (e) {
        if (!cancelled) setError(displayError(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fileId, unlockWithTouchId])

  const unlockWithPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('password')
    setError(undefined)
    try {
      const wantBio = bioAvailable && !bioEnabled && enableBio
      const snapshot = await api.vault.open({
        fileId,
        password,
        keyFile: keyFile?.bytes,
        enableBiometric: wantBio
      })
      if (wantBio) {
        try {
          await api.biometric.enable(fileId)
          toast.success('Touch ID enabled for this vault')
        } catch (err) {
          if (!/cancel/i.test(displayError(err))) toast.error(displayError(err))
        }
      }
      setPassword('')
      done(snapshot)
    } catch (err) {
      setError(errorCode(err) === 'InvalidKey' ? 'Wrong password or key file.' : displayError(err))
      passwordRef.current?.select()
    } finally {
      setBusy(undefined)
    }
  }

  const pickKeyFile = async (file: File | undefined) => {
    if (!file) return
    setKeyFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
  }

  return (
    <div className="grid h-full place-items-center p-8">
      <form onSubmit={unlockWithPassword} className="flex w-full max-w-sm flex-col">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-6 self-start text-muted-foreground"
          onClick={() => navigate('/')}
        >
          <ArrowLeft /> All vaults
        </Button>

        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {ref?.name ?? <span className="text-muted-foreground">Loading…</span>}
          </h1>
          {ref && (
            <p
              className="mt-1 flex max-w-full items-center gap-1.5 truncate text-xs text-muted-foreground"
              title={ref.location}
            >
              <SourceIcon id={ref.id} className="size-3 shrink-0" />
              <span className="truncate">
                {ref.kind === 'local'
                  ? ref.syncedByDrive
                    ? 'Synced by Google Drive for desktop'
                    : ref.location
                  : 'Google Drive'}
              </span>
            </p>
          )}
          <p className="text-sm text-muted-foreground">Enter the master password to unlock</p>
        </div>

        {bioAvailable && bioEnabled && (
          <>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={unlockWithTouchId}
              disabled={!!busy}
              className="h-14 gap-3"
            >
              {busy === 'touchid' ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Fingerprint className="size-6 text-primary" />
              )}
              Unlock with Touch ID
            </Button>
            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground uppercase">
              <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <Label htmlFor="master" className="sr-only">
          Master password
        </Label>
        <div className="relative">
          <Input
            id="master"
            ref={passwordRef}
            type={show ? 'text' : 'password'}
            placeholder="Master password"
            autoFocus={!bioEnabled}
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            className="h-10 pr-10"
          />
          <button
            type="button"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between">
          {keyFile ? (
            <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              <FileKey2 className="size-3.5" /> {keyFile.name}
              <button
                type="button"
                onClick={() => setKeyFile(undefined)}
                aria-label="Remove key file"
              >
                <X className="size-3" />
              </button>
            </span>
          ) : (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="px-0 text-muted-foreground"
              onClick={() => keyInputRef.current?.click()}
            >
              <FileKey2 /> Use a key file
            </Button>
          )}
          <input
            ref={keyInputRef}
            type="file"
            className="hidden"
            onChange={(e) => void pickKeyFile(e.target.files?.[0])}
          />
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        {bioAvailable && !bioEnabled && (
          <label className="mt-4 flex items-center gap-2 text-sm">
            <Checkbox checked={enableBio} onCheckedChange={(v) => setEnableBio(v === true)} />
            Unlock with Touch ID next time
          </label>
        )}

        <Button
          type="submit"
          size="lg"
          className="mt-5"
          disabled={(!password && !keyFile) || !!busy}
        >
          {busy === 'password' && <Loader2 className="animate-spin" />}
          Unlock
        </Button>
      </form>
    </div>
  )
}
