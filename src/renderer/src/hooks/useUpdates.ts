import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, displayError } from '@/lib/api'
import { useVault } from '@/stores/vault'
import type { UpdateState } from '../../../main/updater/protocol'

/** Live auto-update state from main (undefined until the first answer). */
export function useUpdateState(): UpdateState | undefined {
  const [state, setState] = useState<UpdateState>()
  useEffect(() => {
    let alive = true
    void api.updater
      .state()
      .then((s) => alive && setState(s))
      .catch(() => {})
    const off = api.updater.onState(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

/**
 * Restart into the downloaded update. Unsaved vault edits are saved first; if
 * that fails, nothing restarts and the user keeps their changes.
 */
export async function restartToUpdate(): Promise<void> {
  try {
    if (useVault.getState().snapshot?.dirty) {
      await api.vault.save()
      toast.success('Saved')
    }
    await api.updater.install()
  } catch (e) {
    toast.error(`Could not restart: ${displayError(e)}`)
  }
}
