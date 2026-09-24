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
    const lockNow = async () => {
      await api.vault.lock()
      // The 'locked' event resets the store; route explicitly for snappiness.
      navigate(fileId ? unlockPath(fileId) : '/files', { replace: true })
    }
    // Locking drops the in-memory vault: save unsaved edits first, and only
    // throw them away if the user says so.
    if (snapshot?.dirty && !(await save())) {
      toast.warning('Your changes are not saved', {
        description: 'Locking now discards them.',
        action: { label: 'Lock anyway', onClick: () => void lockNow() },
        duration: 10_000
      })
      return
    }
    await lockNow()
  }, [navigate, save, snapshot?.fileId, snapshot?.dirty])

  return { save, lock }
}
