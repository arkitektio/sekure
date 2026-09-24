import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, displayError } from '@/lib/api'
import { isLocalId } from '../../../main/sources/protocol'

export { isLocalId }

/** Local ids carry a path (slashes), so they must be encoded into the route. */
export const unlockPath = (id: string) => `/unlock/${encodeURIComponent(id)}`

/** Route state for the unlock screen. `locked`: we got here because the vault locked. */
export interface UnlockState {
  locked?: boolean
}

/** Back on the unlock screen after a lock: it stays locked until the user unlocks it. */
export const LOCKED_STATE: UnlockState = { locked: true }

/** Native "open .kdbx" dialog → unlock screen for the picked file. */
export function useOpenLocalVault() {
  const navigate = useNavigate()
  return useCallback(async () => {
    try {
      const ref = await api.sources.pickLocal()
      if (ref) navigate(unlockPath(ref.id))
    } catch (e) {
      toast.error(displayError(e))
    }
  }, [navigate])
}
