// Shared between main, preload and renderer. No imports: the sandboxed
// preload gets the constants below inlined by the bundler.

export interface AutoTypeSettings {
  enabled: boolean
  /** Electron accelerator, e.g. `CommandOrControl+Alt+Shift+K`. */
  shortcut: string
}

/**
 * Three modifiers so it doesn't collide with app shortcuts. ⌘⇧Space / Ctrl+Shift+Space
 * are taken by input-source switching and launchers on many systems.
 */
export const DEFAULT_AUTOTYPE_SHORTCUT = 'CommandOrControl+Alt+Shift+K'

export const DEFAULT_AUTOTYPE_SETTINGS: AutoTypeSettings = {
  enabled: true,
  shortcut: DEFAULT_AUTOTYPE_SHORTCUT
}

/** Pseudo field name for the entry's current TOTP code. */
export const OTP_FIELD = '__otp__'

export interface AutoTypeOpened {
  /** Name of the app (or window) that had focus, used to suggest entries. */
  targetName?: string
}

export interface AutoTypeStatus {
  registered: boolean
  /** macOS Accessibility, which pasting into other apps needs. */
  permission: 'granted' | 'denied' | 'n/a'
  platformNote?: string
}

export interface FillResult {
  /** false: the value is on the clipboard instead and the user must paste it. */
  pasted: boolean
}

export const AUTOTYPE_OPENED_CHANNEL = 'autotype:opened'
