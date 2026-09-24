// Shared between main, preload and renderer. Type-only on the renderer side:
// nothing in here may import electron or kdbxweb.

/** Standard KeePass field names. Everything else is a custom field. */
export const STANDARD_FIELDS = ['Title', 'UserName', 'Password', 'URL', 'Notes'] as const
export type StandardField = (typeof STANDARD_FIELDS)[number]

export interface VaultEntrySummary {
  uuid: string
  groupUuid: string
  title: string
  username: string
  url: string
  /**
   * Standard fields (Title, UserName, URL, Notes) stored protected. Their value
   * above is '' and must be fetched with `vault:reveal`, like the password.
   */
  protectedFields: StandardField[]
  tags: string[]
  icon: number | undefined
  /** Sekure entry type id (see `entryTypes.ts`); `login` for plain KeePass entries. */
  type: string
  /** Secondary line for lists, built only from non-protected fields. */
  subtitle: string
  hasPassword: boolean
  hasOtp: boolean
  attachmentCount: number
  /** Lives in the recycle bin: hidden from “All entries” and search. */
  inRecycleBin: boolean
  modified: string | undefined
  /** Uuids of the Person entries this entry belongs to (ids only). */
  people: string[]
}

export interface VaultCustomField {
  key: string
  /** Plaintext for unprotected fields; `null` when protected (reveal on demand). */
  value: string | null
  protected: boolean
}

export type AttachmentKind = 'image' | 'pdf' | 'other'

export interface VaultAttachment {
  name: string
  size: number
  mime: string
  kind: AttachmentKind
}

/** Largest file we accept as an attachment. KDBX stores binaries base64 in memory. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

export interface VaultEntryDetail extends VaultEntrySummary {
  notes: string
  attachments: VaultAttachment[]
  created: string | undefined
  expires: string | undefined
  customFields: VaultCustomField[]
  historyCount: number
  /** The type was recognised from field names, not read from the marker. */
  typeDetected: boolean
}

export interface VaultGroupNode {
  uuid: string
  name: string
  icon: number | undefined
  isRecycleBin: boolean
  groups: VaultGroupNode[]
  entryCount: number
}

export interface VaultSnapshot {
  fileId: string
  fileName: string
  dbName: string
  root: VaultGroupNode
  entries: VaultEntrySummary[]
  dirty: boolean
}

export interface VaultState {
  open: boolean
  fileId?: string
  fileName?: string
  dirty?: boolean
}

export interface EntryInput {
  /** For protected standard fields, `undefined` keeps the current value. */
  title?: string
  username?: string
  /** `undefined` keeps the existing password untouched. */
  password?: string
  url?: string
  notes?: string
  tags: string[]
  /** Sekure entry type id. `undefined` leaves the entry's type as it is. */
  type?: string
  /** Custom fields to set. `value: undefined` on a protected field keeps its current value. */
  customFields?: { key: string; value?: string; protected: boolean }[]
  /** Person entry uuids to link. `undefined` keeps the current links. */
  people?: string[]
}

export interface OpenRequest {
  fileId: string
  password: string
  /** Raw key-file bytes, if the database uses one. */
  keyFile?: Uint8Array
  /**
   * Keep these credentials in main for a following `biometric:enable`, so the
   * renderer never sends the password twice.
   */
  enableBiometric?: boolean
}

export interface SaveResult {
  merged: boolean
}

export interface PasswordOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  /** Drop look-alike characters (Il1O0). */
  unambiguous: boolean
}

export interface TotpCode {
  code: string
  /** Seconds until the code rolls over. */
  remaining: number
  period: number
}

export type VaultEvent =
  | { type: 'opened'; snapshot: VaultSnapshot }
  | {
      type: 'locked'
      reason: 'manual' | 'idle' | 'system'
      /**
       * An automatic lock could not save the open edits. `recovered`: they were
       * written to an encrypted recovery copy in the app data folder.
       */
      unsaved?: 'recovered' | 'lost'
    }
  | { type: 'changed'; snapshot: VaultSnapshot }
  | { type: 'clipboard-cleared' }

export const VAULT_EVENT_CHANNEL = 'vault:event'
