import type { Brand, SyncedPreferences } from './protocol'

// Pure: decodes whatever another device (or a hand-edited file) left in the
// vault, keeping only well-formed fields.

const MAX_SHORTCUT_LENGTH = 64

const PRIMARY_MODIFIERS = new Set([
  'command',
  'cmd',
  'control',
  'ctrl',
  'commandorcontrol',
  'cmdorctrl',
  'super',
  'meta'
])
const OTHER_MODIFIERS = new Set(['alt', 'option', 'altgr', 'shift'])
/** Keys whose single-modifier combos every app relies on (copy, paste, quit…). */
const RESERVED_KEYS = new Set([
  'a',
  'c',
  'f',
  'n',
  'p',
  'q',
  's',
  't',
  'v',
  'w',
  'x',
  'y',
  'z',
  'tab',
  'enter',
  'return',
  'space',
  'backspace',
  'delete',
  'escape',
  'esc'
])

/**
 * Whether an accelerator that arrived from a vault file is safe to register
 * as a global shortcut. A shared or tampered vault must not be able to take
 * over ⌘V / Enter in every app. Needs Cmd/Ctrl (Shift/Alt alone type
 * characters) plus one key, and no reserved single-modifier combo.
 */
export function isSafeGlobalShortcut(accelerator: string): boolean {
  const parts = accelerator.split('+').map((p) => p.trim().toLowerCase())
  if (parts.some((p) => !p)) return false
  const mods = parts.filter((p) => PRIMARY_MODIFIERS.has(p) || OTHER_MODIFIERS.has(p))
  const keys = parts.filter((p) => !PRIMARY_MODIFIERS.has(p) && !OTHER_MODIFIERS.has(p))
  if (keys.length !== 1 || new Set(mods).size !== mods.length) return false
  if (!mods.some((m) => PRIMARY_MODIFIERS.has(m))) return false
  if (mods.length === 1 && RESERVED_KEYS.has(keys[0])) return false
  return true
}

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

  // `autotype.enabled` is deliberately not imported: whether this device
  // types into other apps is the device owner's decision, not the vault's.
  if (typeof obj.autotype === 'object' && obj.autotype !== null) {
    const { shortcut } = obj.autotype as Record<string, unknown>
    if (
      typeof shortcut === 'string' &&
      shortcut.length <= MAX_SHORTCUT_LENGTH &&
      isSafeGlobalShortcut(shortcut)
    ) {
      out.autotype = { shortcut }
    }
  }
  return out
}
