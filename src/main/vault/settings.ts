// Device-local vault settings (auto-lock). Pure so it can be tested in node.

export interface VaultSettings {
  /** 0 disables the idle lock. */
  autoLockMinutes: number
  lockOnSleep: boolean
}

export const DEFAULT_VAULT_SETTINGS: VaultSettings = { autoLockMinutes: 10, lockOnSleep: true }

export const MAX_AUTO_LOCK_MINUTES = 24 * 60

/**
 * Apply a renderer-supplied patch. Unknown keys and wrongly typed values are
 * dropped rather than merged into the store.
 */
export function applySettingsPatch(current: VaultSettings, patch: unknown): VaultSettings {
  const next = { ...current }
  if (!patch || typeof patch !== 'object') return next
  const p = patch as Record<string, unknown>
  const minutes = p.autoLockMinutes
  if (
    typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= MAX_AUTO_LOCK_MINUTES
  ) {
    next.autoLockMinutes = minutes
  }
  if (typeof p.lockOnSleep === 'boolean') next.lockOnSleep = p.lockOnSleep
  return next
}
