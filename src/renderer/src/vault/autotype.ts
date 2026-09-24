import type { VaultEntrySummary } from '../../../main/vault/protocol'

const hostLabel = (url: string): string | undefined => {
  try {
    const host = new URL(/^\w+:\/\//.test(url) ? url : `https://${url}`).hostname
    // "accounts.github.com" → "github"
    const parts = host.replace(/^www\./, '').split('.')
    return parts.length > 1 ? parts[parts.length - 2] : parts[0]
  } catch {
    return undefined
  }
}

/**
 * Entries that probably belong to the window the user was typing in: its title
 * (browser tab title on Linux, app name on macOS) mentions the entry title or
 * the URL's site name.
 */
export function suggestEntries(
  entries: VaultEntrySummary[],
  targetName: string | undefined
): VaultEntrySummary[] {
  const target = targetName?.toLowerCase().trim()
  if (!target) return []
  return entries.filter((e) => {
    const title = e.title.toLowerCase().trim()
    const site = e.url ? hostLabel(e.url)?.toLowerCase() : undefined
    return (
      (title.length >= 3 && target.includes(title)) ||
      (!!site && site.length >= 3 && target.includes(site))
    )
  })
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Return'
}

/**
 * A keydown → Electron accelerator (`CommandOrControl+Alt+Shift+K`).
 * Returns undefined until a non-modifier key is pressed with at least one
 * modifier: a global shortcut without one would swallow normal typing.
 */
export function acceleratorFromEvent(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  isMac: boolean
): string | undefined {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return undefined
  const mods: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl')
  if (isMac && e.ctrlKey) mods.push('Control')
  if (!isMac && e.metaKey) mods.push('Super')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (!mods.length || (mods.length === 1 && mods[0] === 'Shift')) return undefined

  // `code` survives Alt/Option turning "a" into "å" on macOS.
  let key: string
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (/^F\d{1,2}$/.test(e.key)) key = e.key
  else if (KEY_NAMES[e.key]) key = KEY_NAMES[e.key]
  else if (e.key.length === 1) key = e.key.toUpperCase()
  else return undefined
  return [...mods, key].join('+')
}

/** `CommandOrControl+Alt+Shift+K` → `⌘⌥⇧K` / `Ctrl+Alt+Shift+K`. */
export function formatAccelerator(accel: string, isMac: boolean): string {
  const parts = accel.split('+')
  if (!isMac) return parts.map((p) => (p === 'CommandOrControl' ? 'Ctrl' : p)).join('+')
  const symbols: Record<string, string> = {
    CommandOrControl: '⌘',
    Command: '⌘',
    Control: '⌃',
    Alt: '⌥',
    Shift: '⇧'
  }
  return parts.map((p) => symbols[p] ?? p).join('')
}
