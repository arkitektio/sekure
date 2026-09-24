import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  Fingerprint,
  FolderOpen,
  HardDrive,
  Loader2,
  Paperclip,
  Plus,
  ShieldCheck,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SourceIcon } from '@/components/SourceIcon'
import { VaultAvatar } from '@/components/VaultAvatar'
import { SekureLogo } from '@/components/SekureLogo'
import { api } from '@/lib/api'
import { unlockPath, useOpenLocalVault } from '@/lib/vaults'
import { cn } from '@/lib/utils'
import type { RecentVault } from '../../../main/sources/protocol'

const FEATURES = [
  { icon: HardDrive, text: 'Your .kdbx stays a plain file, wherever you keep it' },
  { icon: ShieldCheck, text: 'Decrypted only in memory, on this machine' },
  { icon: Fingerprint, text: 'Unlock with Touch ID after the first time' },
  { icon: Paperclip, text: 'Attach images and PDFs to any entry' }
]

/** The folder a vault is in, or a hint that a sync client keeps it. */
const shortLocation = (r: RecentVault) =>
  r.syncedByDrive
    ? 'Drive for desktop'
    : (r.location.split(/[\\/]/).filter(Boolean).pop() ?? r.location)

/**
 * The start screen, like orkestrator's welcome: the vaults this computer has
 * opened as a row of cards to pick from, or, the first time, the way in.
 */
export function Home() {
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
  if (open === undefined || !recent) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <Welcome>
      {recent.length ? (
        <ReturningWelcome
          recent={recent}
          onForget={(id) => setRecent((rs) => rs?.filter((r) => r.id !== id))}
        />
      ) : (
        <FirstRunWelcome />
      )}
    </Welcome>
  )
}

/** The logo, the body, and the details nobody needs on the way in. */
function Welcome({ children }: { children: React.ReactNode }) {
  const [more, setMore] = useState(false)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-radial-[at_100%_100%] from-primary/8 to-background px-4 py-8">
      <div className="flex w-full max-w-xl flex-col items-center gap-6">
        <SekureLogo className="size-24" />

        {children}

        <div className="flex w-full flex-col items-center">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setMore((m) => !m)}>
            <ChevronDown className={cn('transition-transform', more && 'rotate-180')} />
            About Sekure
          </Button>
          {more && (
            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              {FEATURES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-primary" />
                  {text}
                </li>
              ))}
            </ul>
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
  const openLocal = useOpenLocalVault()
  const first = useRef<HTMLButtonElement>(null)
  // The last vault is focused, so Enter goes straight to its unlock screen.
  useEffect(() => first.current?.focus(), [])

  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Choose a vault to unlock, or open another.</p>
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
                  <SourceIcon className="size-3 text-muted-foreground" />
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
        <Button
          variant="outline"
          onClick={() => void openLocal()}
          className="flex h-auto w-32 flex-col items-center justify-start gap-2 rounded-3xl border-dashed px-3 py-4 text-muted-foreground"
        >
          <span className="grid size-12 place-items-center rounded-full border border-dashed">
            <Plus className="size-5" />
          </span>
          <span className="w-full truncate text-sm font-normal">Open vault</span>
        </Button>
      </div>
    </>
  )
}

/** Nothing opened yet: open a vault file. */
function FirstRunWelcome() {
  const openLocal = useOpenLocalVault()
  return (
    <>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Let’s get you started</h1>
        <p className="text-sm text-muted-foreground">
          Open a KeePass vault (.kdbx) from this computer. It is decrypted only in memory, on this
          machine, and saved back to the same file.
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
        <p className="text-center text-xs text-muted-foreground">
          A vault in a synced folder (Google Drive for desktop, Dropbox, iCloud) works like any
          other file.
        </p>
      </div>
    </>
  )
}
