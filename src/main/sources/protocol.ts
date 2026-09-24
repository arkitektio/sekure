// Where a vault lives. Ids are opaque to the renderer except for the prefix:
// local files are `local:<absolute path>`. A new provider adds a kind and a source.

export type SourceKind = 'local'

export const LOCAL_PREFIX = 'local:'

export const isLocalId = (id: string) => id.startsWith(LOCAL_PREFIX)
export const localId = (path: string) => `${LOCAL_PREFIX}${path}`
export const localPath = (id: string) => id.slice(LOCAL_PREFIX.length)

export interface VaultRef {
  id: string
  kind: SourceKind
  name: string
  /** Human-readable location: the folder path. */
  location: string
  /** Local file inside a Google Drive for desktop folder. */
  syncedByDrive?: boolean
}

export interface RecentVault extends VaultRef {
  openedAt: string
}
