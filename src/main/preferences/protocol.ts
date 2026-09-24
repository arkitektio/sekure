// Shared between main, preload and renderer. Type-only imports: the sandboxed
// preload gets the constants below inlined by the bundler.
import type { AutoTypeSettings } from '../autotype/protocol'

/** The two master theme controls (`--brand-hue` / `--brand-chroma` in index.css). */
export interface Brand {
  /** OKLCH hue in degrees, 0–360. */
  hue: number
  /** OKLCH chroma, 0–0.4. */
  chroma: number
}

export interface Preferences {
  /** `null`: the stylesheet's own light/dark defaults. */
  brand: Brand | null
  autotype: AutoTypeSettings
  /** Name of the open vault these preferences are also stored in. */
  vault?: string
}

/** What travels inside a vault. Missing fields leave the local value alone. */
export interface SyncedPreferences {
  brand?: Brand | null
  autotype?: Partial<AutoTypeSettings>
}

/** Key in the database's Meta/CustomData (KeePassXC keeps its own settings there too). */
export const VAULT_PREFERENCES_KEY = 'sekure.preferences'

export const PREFERENCES_CHANGED_CHANNEL = 'preferences:changed'
