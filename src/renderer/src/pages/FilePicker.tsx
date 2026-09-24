import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clock,
  Cloud,
  FileLock2,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SourceIcon } from '@/components/SourceIcon'
import { useAuth } from '@/stores/auth'
import { api, displayError, formatBytes, formatDate } from '@/lib/api'
import { unlockPath, useOpenLocalVault } from '@/lib/vaults'
import type { DriveFile } from '../../../main/drive/protocol'
import type { RecentVault } from '../../../main/sources/protocol'

export function FilePicker() {
  const status = useAuth((s) => s.status)
  const setStatus = useAuth((s) => s.set)
  const navigate = useNavigate()
  const openLocal = useOpenLocalVault()
  const [recent, setRecent] = useState<RecentVault[]>([])
  const [files, setFiles] = useState<DriveFile[]>()
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [connecting, setConnecting] = useState(false)
  const connected = !!status?.connected

  useEffect(() => {
    let alive = true
    void api.sources.recent().then((r) => alive && setRecent(r))
    return () => {
      alive = false
    }
  }, [connected])

  useEffect(() => {
    if (!connected) return
    let alive = true
    api.drive
      .list()
      .then((list) => {
        if (!alive) return
        setFiles(list)
        setError(undefined)
      })
      .catch((e) => alive && setError(displayError(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [connected, reloads])

  const reload = () => {
    setLoading(true)
    setError(undefined)
    setReloads((n) => n + 1)
  }

  const connect = async () => {
    setConnecting(true)
    try {
      setStatus(await api.auth.login())
    } catch (e) {
      const msg = displayError(e)
      if (!msg.includes('cancelled')) toast.error(msg)
    } finally {
      setConnecting(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return files?.filter((f) => !q || f.name.toLowerCase().includes(q))
  }, [files, query])

  const open = (id: string) => navigate(unlockPath(id))

  // Sekure only sees Drive files it created or that were chosen in the Google
  // Picker (drive.file); picking a file is what grants access to it.
  const [picking, setPicking] = useState(false)
  const pickFromDrive = async () => {
    setPicking(true)
    try {
      const picked = await api.drive.pick()
      if (picked) open(picked.id)
    } catch (e) {
      const msg = displayError(e)
      if (!msg.includes('cancelled')) toast.error(msg)
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-6 pt-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Choose a vault</h1>
          <p className="text-sm text-muted-foreground">
            From Google Drive, or any .kdbx on this computer
          </p>
        </div>
        <Button variant="outline" onClick={() => void openLocal()}>
          <FolderOpen /> Open local file…
        </Button>
      </div>

      {recent.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
            <Clock className="size-3" /> Recent
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <Tooltip key={r.id}>
                <TooltipTrigger asChild>
                  <div className="group flex items-center rounded-full border bg-card pr-1 text-sm">
                    <button
                      className="flex items-center gap-2 py-1 pl-3"
                      onClick={() => open(r.id)}
                    >
                      <SourceIcon id={r.id} className="text-primary" />
                      {r.name}
                    </button>
                    <button
                      className="ml-1 rounded-full p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted"
                      onClick={async () => {
                        await api.sources.forget(r.id)
                        setRecent((rs) => rs.filter((x) => x.id !== r.id))
                      }}
                      aria-label={`Forget ${r.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {r.location}
                  {r.syncedByDrive ? ' · synced by Google Drive' : ''}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
          <Cloud className="size-3" /> Google Drive
        </div>
        {connected && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={reload}
            disabled={loading}
            aria-label="Refresh"
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
          </Button>
        )}
      </div>

      {!connected ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          {status?.scopeChanged && (
            <p className="mb-3 text-sm">
              Sekure now asks only for access to the vaults you choose. Reconnect Google Drive, then
              pick your vault once with “Choose from Google Drive”.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Connect Google Drive to browse and sync vaults directly — or, if you use{' '}
            <span className="font-medium text-foreground">Google Drive for desktop</span>, just open
            the synced file with <HardDrive className="inline size-3.5" /> Open local file.
          </p>
          <Button
            className="mt-4"
            onClick={connect}
            disabled={connecting || (status && !status.configured)}
          >
            {connecting ? <Loader2 className="animate-spin" /> : <Cloud />}
            {connecting ? 'Waiting for your browser…' : 'Connect Google Drive'}
          </Button>
          {status && !status.configured && (
            <p className="mt-2 text-xs text-muted-foreground">
              No Google OAuth client configured in this build.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Filter Drive vaults…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {picking ? (
              <Button variant="outline" onClick={() => void api.drive.cancelPick()}>
                <Loader2 className="animate-spin" /> Cancel
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void pickFromDrive()}>
                <Cloud /> Choose from Google Drive…
              </Button>
            )}
          </div>

          <ScrollArea className="mt-3 min-h-0 flex-1 pb-6">
            {error ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Could not list your Drive</EmptyTitle>
                  <EmptyDescription>{error}</EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={reload}>
                  Try again
                </Button>
              </Empty>
            ) : !filtered ? (
              <div className="grid h-40 place-items-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileLock2 />
                  </EmptyMedia>
                  <EmptyTitle>No vaults yet</EmptyTitle>
                  <EmptyDescription>
                    Sekure only sees the vaults you give it. Use “Choose from Google Drive” to pick
                    a KeePass database (e.g. one from KeePassXC).
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {filtered.map((f) => (
                  <li key={f.id}>
                    <button
                      onClick={() => open(f.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/60"
                    >
                      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <FileLock2 className="size-4.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{f.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          Modified {formatDate(f.modifiedTime)}
                          {f.owner ? ` · ${f.owner}` : ''}
                        </div>
                      </div>
                      {f.size && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatBytes(Number(f.size))}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  )
}
