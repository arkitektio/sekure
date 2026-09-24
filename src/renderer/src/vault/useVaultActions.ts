import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useVault } from '@/stores/vault'
import { api, displayError } from '@/lib/api'
import { isLocalId, unlockPath } from '@/lib/vaults'

export function useVaultActions() {
  const navigate = useNavigate()
  const snapshot = useVault((s) => s.snapshot)

  const local = !!snapshot && isLocalId(snapshot.fileId)

  const save = useCallback(async () => {
    const id = toast.loading(local ? 'Saving…' : 'Saving to Google Drive…')
    try {
      const res = await api.vault.save()
      toast.success(
        res.merged
          ? 'Saved — merged with changes made elsewhere'
          : local
            ? 'Saved'
            : 'Saved to Google Drive',
        { id }
      )
      return true
    } catch (e) {
      toast.error(`Save failed: ${displayError(e)}`, { id })
      return false
    }
  }, [local])

  const lock = useCallback(async () => {
    const fileId = snapshot?.fileId
    await api.vault.lock()
    // The 'locked' event resets the store; route explicitly for snappiness.
    navigate(fileId ? unlockPath(fileId) : '/files', { replace: true })
  }, [navigate, snapshot?.fileId])

  return { save, lock }
}
