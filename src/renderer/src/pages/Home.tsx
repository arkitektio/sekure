import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/stores/auth'
import { api } from '@/lib/api'
import { isLocalId, unlockPath } from '@/lib/vaults'

/**
 * Where the app starts: an open vault → the last vault we can reach (local
 * files work without Google) → the picker when connected → Connect.
 */
export function Home() {
  const status = useAuth((s) => s.status)
  const [target, setTarget] = useState<string>()

  useEffect(() => {
    if (!status) return
    let alive = true
    void (async () => {
      const state = await api.vault.state()
      if (state.open) return alive && setTarget('/vault')
      const recent = await api.sources.recent()
      const last = recent.find((r) => status.connected || isLocalId(r.id))
      if (!alive) return
      setTarget(last ? unlockPath(last.id) : status.connected ? '/files' : '/connect')
    })()
    return () => {
      alive = false
    }
  }, [status])

  if (!target) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  return <Navigate to={target} replace />
}
