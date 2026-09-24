import type { Brand, SyncedPreferences } from './protocol'

// Pure: decodes whatever another device (or a hand-edited file) left in the
// vault, keeping only well-formed fields.

const MAX_SHORTCUT_LENGTH = 64

export function sanitizeBrand(value: unknown): Brand | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object') return undefined
  const { hue, chroma } = value as Record<string, unknown>
  if (typeof hue !== 'number' || typeof chroma !== 'number') return undefined
  if (!Number.isFinite(hue) || !Number.isFinite(chroma)) return undefined
  return {
    hue: ((hue % 360) + 360) % 360,
    chroma: Math.min(0.4, Math.max(0, chroma))
  }
}

export function encodePreferences(prefs: SyncedPreferences): string {
  return JSON.stringify({ v: 1, ...prefs })
}

export function decodePreferences(raw: string | undefined): SyncedPreferences | undefined {
  if (!raw) return undefined
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const obj = data as Record<string, unknown>
  const out: SyncedPreferences = {}

  if ('brand' in obj) {
    const brand = sanitizeBrand(obj.brand)
    if (brand !== undefined) out.brand = brand
  }

  if (typeof obj.autotype === 'object' && obj.autotype !== null) {
    const { enabled, shortcut } = obj.autotype as Record<string, unknown>
    const autotype: SyncedPreferences['autotype'] = {}
    if (typeof enabled === 'boolean') autotype.enabled = enabled
    if (typeof shortcut === 'string' && shortcut && shortcut.length <= MAX_SHORTCUT_LENGTH) {
      autotype.shortcut = shortcut
    }
    if (Object.keys(autotype).length) out.autotype = autotype
  }
  return out
}
