import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, displayError } from '@/lib/api'
import { isLocalId } from '../../../main/sources/protocol'

export { isLocalId }

/** Local ids carry a path (slashes), so they must be encoded into the route. */
export const unlockPath = (id: string) => `/unlock/${encodeURIComponent(id)}`

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
