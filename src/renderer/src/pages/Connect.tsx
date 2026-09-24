import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { FolderOpen, HardDrive, Loader2, ShieldCheck, Fingerprint, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/stores/auth'
import { api, displayError } from '@/lib/api'
import { useOpenLocalVault } from '@/lib/vaults'

const FEATURES = [
  { icon: HardDrive, text: 'Your .kdbx stays in your Google Drive — or on disk' },
  { icon: ShieldCheck, text: 'Decrypted only in memory, on this machine' },
  { icon: Fingerprint, text: 'Unlock with Touch ID after the first time' },
  { icon: Paperclip, text: 'Attach images and PDFs to any entry' }
]

export function Connect() {
  const status = useAuth((s) => s.status)
  const setStatus = useAuth((s) => s.set)
  const navigate = useNavigate()
  const [waiting, setWaiting] = useState(false)
  const openLocal = useOpenLocalVault()

  if (status?.connected) return <Navigate to="/" replace />

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

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-6 grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
          <ShieldCheck className="size-8" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Sekure</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open and edit your KeePass vaults straight from Google Drive.
        </p>

        <ul className="mt-8 w-full space-y-3 text-left text-sm">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3">
              <Icon className="size-4 shrink-0 text-primary" />
              {text}
            </li>
          ))}
        </ul>

        {status && !status.configured ? (
          <p className="mt-8 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            This build has no Google OAuth client. Copy <code>.env.example</code> to{' '}
            <code>.env</code> and fill in your client ID (see README).
          </p>
        ) : waiting ? (
          <div className="mt-8 flex w-full flex-col gap-2">
            <Button size="lg" disabled>
              <Loader2 className="animate-spin" /> Waiting for your browser…
            </Button>
            <Button variant="ghost" size="sm" onClick={() => api.auth.cancel()}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="lg" className="mt-8 w-full" onClick={connect}>
            <HardDrive /> Connect Google Drive
          </Button>
        )}

        <div className="mt-6 flex w-full items-center gap-3 text-xs text-muted-foreground uppercase">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>
        <Button variant="outline" className="mt-6 w-full" onClick={() => void openLocal()}>
          <FolderOpen /> Open a local .kdbx file
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Works with files synced by Google Drive for desktop — no sign-in needed.
        </p>
      </div>
    </div>
  )
}
