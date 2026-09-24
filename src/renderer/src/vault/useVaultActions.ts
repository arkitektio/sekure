import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useVault } from '@/stores/vault'
import { api, displayError } from '@/lib/api'
import { LOCKED_STATE, unlockPath } from '@/lib/vaults'

export function useVaultActions() {
  const navigate = useNavigate()
  const snapshot = useVault((s) => s.snapshot)

  const save = useCallback(async () => {
    const id = toast.loading('Saving…')
    try {
      const res = await api.vault.save()
      toast.success(res.merged ? 'Saved — merged with changes made elsewhere' : 'Saved', { id })
      return true
    } catch (e) {
      toast.error(`Save failed: ${displayError(e)}`, { id })
      return false
    }
  }, [])

  /** Lock, then go to `to` (another vault's unlock screen, the file picker), else back to unlock. */
  const lock = useCallback(
    async (to?: string) => {
      const fileId = snapshot?.fileId
      const lockNow = async () => {
        const target = to ?? (fileId ? unlockPath(fileId) : '/')
        // The 'locked' event handler reads this before it resets the store.
        useVault.getState().setSwitchTarget(target)
        await api.vault.lock()
        // The 'locked' event resets the store; route explicitly for snappiness.
        const relock = !!fileId && target === unlockPath(fileId)
        navigate(target, { replace: true, state: relock ? LOCKED_STATE : undefined })
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
    },
    [navigate, save, snapshot?.fileId, snapshot?.dirty]
  )

  return { save, lock }
}
