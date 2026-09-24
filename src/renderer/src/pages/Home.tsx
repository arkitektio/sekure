import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  Cloud,
  Fingerprint,
  FolderOpen,
  HardDrive,
  Loader2,
  Paperclip,
  Plus,
  ShieldCheck,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SourceIcon } from '@/components/SourceIcon'
import { VaultAvatar } from '@/components/VaultAvatar'
import { SekureLogo } from '@/components/SekureLogo'
import { useAuth } from '@/stores/auth'
import { api, displayError } from '@/lib/api'
import { isLocalId, unlockPath, useOpenLocalVault } from '@/lib/vaults'
import { cn } from '@/lib/utils'
import type { RecentVault } from '../../../main/sources/protocol'

const FEATURES = [
  { icon: HardDrive, text: 'Your .kdbx stays in your Google Drive, or on disk' },
  { icon: ShieldCheck, text: 'Decrypted only in memory, on this machine' },
  { icon: Fingerprint, text: 'Unlock with Touch ID after the first time' },
  { icon: Paperclip, text: 'Attach images and PDFs to any entry' }
]

const shortLocation = (r: RecentVault) =>
  r.kind === 'drive'
    ? 'Google Drive'
    : r.syncedByDrive
      ? 'Drive for desktop'
      : (r.location.split(/[\\/]/).filter(Boolean).pop() ?? r.location)

/** Connect Google Drive (browser sign-in), then browse it. */
function useConnectDrive() {
  const setStatus = useAuth((s) => s.set)
  const navigate = useNavigate()
  const [waiting, setWaiting] = useState(false)
  const connect = async () => {
    setWaiting(true)
    try {
      setStatus(await api.auth.login())
      navigate('/files')
    } catch (e) {
      const msg = displayError(e)
      if (!msg.includes('cancelled')) toast.error(msg)
    } finally {
      setWaiting(false)
    }
  }
  return { connect, waiting }
}

/**
 * The start screen, like orkestrator's welcome: the vaults this computer has
 * opened as a row of cards to pick from, or, the first time, the way in.
 */
export function Home() {
  const status = useAuth((s) => s.status)
  const [open, setOpen] = useState<boolean>()
  const [recent, setRecent] = useState<RecentVault[]>()

  useEffect(() => {
    let alive = true
    void Promise.all([api.vault.state(), api.sources.recent()]).then(([state, r]) => {
      if (!alive) return
      setOpen(state.open)
      setRecent(r)
    })
    return () => {
      alive = false
    }
  }, [])

  if (open) return <Navigate to="/vault" replace />
  if (open === undefined || !recent || !status) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  // Drive vaults need a connection; without one only local files can be opened.
  const usable = recent.filter((r) => status.connected || isLocalId(r.id))

  return (
    <Welcome>
      {usable.length ? (
        <ReturningWelcome
          recent={usable}
          onForget={(id) => setRecent((rs) => rs?.filter((r) => r.id !== id))}
        />
      ) : (
        <FirstRunWelcome />
      )}
    </Welcome>
  )
}

/** The logo, the body, and the options nobody needs on the way in. */
function Welcome({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status)
  const navigate = useNavigate()
  const [more, setMore] = useState(false)
  const { connect, waiting } = useConnectDrive()

  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-radial-[at_100%_100%] from-primary/8 to-background px-4 py-8">
      <div className="flex w-full max-w-xl flex-col items-center gap-6">
        <SekureLogo className="size-24" />

        {children}

        <div className="flex w-full flex-col items-center">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setMore((m) => !m)}>
            <ChevronDown className={cn('transition-transform', more && 'rotate-180')} />
            More options
          </Button>
          {more && (
            <div className="mt-3 flex flex-col items-center gap-2">
              {status?.connected ? (
                <Button variant="ghost" size="sm" onClick={() => navigate('/files')}>
                  <Cloud /> Browse Google Drive
                </Button>
              ) : status?.configured ? (
                <Button variant="ghost" size="sm" onClick={() => void connect()} disabled={waiting}>
                  {waiting ? <Loader2 className="animate-spin" /> : <Cloud />}
                  {waiting ? 'Waiting for your browser…' : 'Connect Google Drive'}
                </Button>
              ) : (
                <p className="max-w-sm text-center text-xs text-muted-foreground">
                  This build has no Google OAuth client, so only local files can be opened.
                </p>
              )}
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                {FEATURES.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2">
                    <Icon className="size-3.5 shrink-0 text-primary" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Vaults this computer has opened, left to right (most recent first), plus one more. */
function ReturningWelcome({
  recent,
  onForget
}: {
  recent: RecentVault[]
  onForget: (id: string) => void
}) {
  const navigate = useNavigate()
  const first = useRef<HTMLButtonElement>(null)
  // The last vault is focused, so Enter goes straight to its unlock screen.
  useEffect(() => first.current?.focus(), [])

  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Choose a vault to unlock, or add another.</p>
      </div>
      <div className="flex w-full flex-wrap items-start justify-center gap-3">
        {recent.map((r, i) => (
          <div key={r.id} className="group relative">
            <Button
              ref={i === 0 ? first : undefined}
              variant="outline"
              title={`${r.name} · ${r.location}`}
              onClick={() => navigate(unlockPath(r.id))}
              className={cn(
                'flex h-auto w-32 flex-col items-center justify-start gap-2 rounded-3xl px-3 py-4',
                i === 0 && 'ring-2 ring-primary/60'
              )}
            >
              <div className="relative">
                <VaultAvatar
                  name={r.name}
                  current={i === 0}
                  className="size-12 rounded-full text-sm"
                />
                <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-background p-0.5">
                  <SourceIcon id={r.id} className="size-3 text-muted-foreground" />
                </span>
              </div>
              <div className="w-full min-w-0">
                <div className="truncate text-sm">{r.name.replace(/\.kdbx$/i, '')}</div>
                <div className="truncate text-[10px] font-normal text-muted-foreground">
                  {shortLocation(r)}
                </div>
              </div>
            </Button>
            <button
              className="absolute top-1.5 right-1.5 hidden rounded-full p-1 text-muted-foreground group-hover:block hover:bg-muted hover:text-foreground"
              onClick={async () => {
                await api.sources.forget(r.id)
                onForget(r.id)
              }}
              aria-label={`Remove ${r.name} from this list`}
              title="Remove from this list (the file stays)"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <AddVaultCard />
      </div>
    </>
  )
}

/** The "+" card: a vault file on this computer, or one in Google Drive. */
function AddVaultCard() {
  const status = useAuth((s) => s.status)
  const navigate = useNavigate()
  const openLocal = useOpenLocalVault()
  const { connect, waiting } = useConnectDrive()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="flex h-auto w-32 flex-col items-center justify-start gap-2 rounded-3xl border-dashed px-3 py-4 text-muted-foreground"
        >
          <span className="grid size-12 place-items-center rounded-full border border-dashed">
            {waiting ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
          </span>
          <span className="w-full truncate text-sm font-normal">Add vault</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuItem onSelect={() => void openLocal()}>
          <FolderOpen /> Open a vault file…
        </DropdownMenuItem>
        {status?.connected ? (
          <DropdownMenuItem onSelect={() => navigate('/files')}>
            <Cloud /> From Google Drive…
          </DropdownMenuItem>
        ) : (
          status?.configured && (
            <DropdownMenuItem onSelect={() => void connect()}>
              <Cloud /> Connect Google Drive…
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Nothing opened yet: open a file, or connect Google Drive. */
function FirstRunWelcome() {
  const status = useAuth((s) => s.status)
  const openLocal = useOpenLocalVault()
  const { connect, waiting } = useConnectDrive()
  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Let’s get you started</h1>
        <p className="text-sm text-muted-foreground">
          Open a KeePass vault (.kdbx) from this computer or from Google Drive. It is decrypted only
          in memory, on this machine.
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col items-center gap-2">
        <Button
          size="lg"
          className="h-auto w-full rounded-3xl py-3"
          onClick={() => void openLocal()}
        >
          <FolderOpen /> Open a vault file
        </Button>
        {status?.configured &&
          (waiting ? (
            <div className="flex w-full flex-col gap-1">
              <Button
                size="lg"
                variant="outline"
                className="h-auto w-full rounded-3xl py-3"
                disabled
              >
                <Loader2 className="animate-spin" /> Waiting for your browser…
              </Button>
              <Button variant="ghost" size="sm" onClick={() => api.auth.cancel()}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="lg"
              variant="outline"
              className="h-auto w-full rounded-3xl py-3"
              onClick={() => void connect()}
            >
              <Cloud /> Connect Google Drive
            </Button>
          ))}
        <p className="text-center text-xs text-muted-foreground">
          Files synced by Google Drive for desktop open as files, no sign-in needed.
        </p>
      </div>
    </>
  )
}
