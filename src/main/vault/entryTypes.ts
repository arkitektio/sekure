// Sekure entry types: a semantic layer on top of plain KDBX entries.
//
// Shared between main and renderer at runtime, so no imports.
//
// On disk an entry of a type is an ordinary KeePass entry:
//   - its values are string fields with human-readable names (`Passport number`, `IBAN`),
//     so every KeePass app shows and edits them as custom fields;
//   - secret fields are protected (main enforces this from the registry);
//   - the type is recorded in the entry's CustomData as `sekure.type = passport@1`,
//     which KeePass 2 / KeePassXC keep but do not show.
// If the marker goes missing, `detectType` recognises the entry from its field names.

export type FieldKind =
  | 'text'
  | 'secret'
  | 'multiline'
  | 'date'
  | 'country'
  | 'iban'
  | 'bic'
  | 'cardNumber'
  | 'expiry'
  | 'select'

/** The KeePass standard fields a type may reuse, so other apps' shortcuts still work. */
export type StandardTypeField = 'UserName' | 'Password' | 'URL'

export interface TypeField {
  /** The KDBX field name. For `standard` fields this is the standard name. */
  key: string
  label: string
  kind: FieldKind
  /** Stored as a protected value. Main enforces this whatever the renderer sends. */
  protected?: boolean
  required?: boolean
  options?: string[]
  standard?: StandardTypeField
  placeholder?: string
}

export type EntryTypeGroup = 'login' | 'identity' | 'finance' | 'other'

export interface EntryType {
  id: string
  /** Bumped when the field layout changes incompatibly; written into the marker. */
  version: number
  label: string
  group: EntryTypeGroup
  /** KeePass standard icon, so other apps show something sensible. */
  kdbxIcon: number
  fields: TypeField[]
  /** Field names whose presence identifies the type when the marker is missing. */
  signature: string[]
  /** Non-protected field keys joined into the list subtitle. */
  subtitle: string[]
  /** How subtitle parts combine: a separator, or `first` for the first non-empty one. */
  subtitleJoin?: string
  /** Field keys joined into a suggested title, after the type label. */
  titleHint?: string[]
  /** A date field shown as an expiry badge. */
  expiryField?: string
}

export const TYPE_MARKER_KEY = 'sekure.type'
export const LOGIN_TYPE = 'login'

const names: TypeField[] = [
  { key: 'Given names', label: 'Given names', kind: 'text', required: true },
  { key: 'Surname', label: 'Surname', kind: 'text', required: true }
]

export const ENTRY_TYPES: EntryType[] = [
  {
    id: LOGIN_TYPE,
    version: 1,
    label: 'Login',
    group: 'login',
    kdbxIcon: 0,
    fields: [
      { key: 'UserName', label: 'Username', kind: 'text', standard: 'UserName' },
      { key: 'Password', label: 'Password', kind: 'secret', standard: 'Password', protected: true },
      { key: 'URL', label: 'Website', kind: 'text', standard: 'URL', placeholder: 'https://' }
    ],
    signature: [],
    subtitle: ['UserName', 'URL'],
    subtitleJoin: 'first'
  },
  {
    id: 'passport',
    version: 1,
    label: 'Passport',
    group: 'identity',
    kdbxIcon: 9,
    fields: [
      ...names,
      { key: 'Passport number', label: 'Passport number', kind: 'text', required: true },
      { key: 'Nationality', label: 'Nationality', kind: 'country' },
      { key: 'Date of birth', label: 'Date of birth', kind: 'date' },
      { key: 'Place of birth', label: 'Place of birth', kind: 'text' },
      { key: 'Sex', label: 'Sex', kind: 'select', options: ['F', 'M', 'X'] },
      { key: 'Issuing country', label: 'Issuing country', kind: 'country' },
      { key: 'Issuing authority', label: 'Issuing authority', kind: 'text' },
      { key: 'Date of issue', label: 'Date of issue', kind: 'date' },
      { key: 'Date of expiry', label: 'Date of expiry', kind: 'date' }
    ],
    signature: ['Passport number'],
    subtitle: ['Given names', 'Surname'],
    subtitleJoin: ' ',
    titleHint: ['Given names', 'Surname'],
    expiryField: 'Date of expiry'
  },
  {
    id: 'idCard',
    version: 1,
    label: 'ID card',
    group: 'identity',
    kdbxIcon: 9,
    fields: [
      ...names,
      { key: 'ID number', label: 'ID number', kind: 'text', required: true },
      { key: 'Nationality', label: 'Nationality', kind: 'country' },
      { key: 'Date of birth', label: 'Date of birth', kind: 'date' },
      { key: 'Address', label: 'Address', kind: 'multiline' },
      { key: 'Issuing authority', label: 'Issuing authority', kind: 'text' },
      { key: 'Date of issue', label: 'Date of issue', kind: 'date' },
      { key: 'Date of expiry', label: 'Date of expiry', kind: 'date' }
    ],
    signature: ['ID number'],
    subtitle: ['Given names', 'Surname'],
    subtitleJoin: ' ',
    titleHint: ['Given names', 'Surname'],
    expiryField: 'Date of expiry'
  },
  {
    id: 'driversLicense',
    version: 1,
    label: "Driver's license",
    group: 'identity',
    kdbxIcon: 9,
    fields: [
      ...names,
      { key: 'License number', label: 'License number', kind: 'text', required: true },
      { key: 'License classes', label: 'Classes', kind: 'text', placeholder: 'B, BE' },
      { key: 'Date of birth', label: 'Date of birth', kind: 'date' },
      { key: 'Issuing country', label: 'Issuing country', kind: 'country' },
      { key: 'Issuing authority', label: 'Issuing authority', kind: 'text' },
      { key: 'Date of issue', label: 'Date of issue', kind: 'date' },
      { key: 'Date of expiry', label: 'Date of expiry', kind: 'date' }
    ],
    signature: ['License number'],
    subtitle: ['Given names', 'Surname'],
    subtitleJoin: ' ',
    titleHint: ['Given names', 'Surname'],
    expiryField: 'Date of expiry'
  },
  {
    id: 'bankAccount',
    version: 1,
    label: 'Bank account',
    group: 'finance',
    kdbxIcon: 37,
    fields: [
      { key: 'Account holder', label: 'Account holder', kind: 'text' },
      { key: 'Bank name', label: 'Bank', kind: 'text' },
      { key: 'IBAN', label: 'IBAN', kind: 'iban', required: true },
      { key: 'BIC', label: 'BIC / SWIFT', kind: 'bic' },
      { key: 'UserName', label: 'Online banking login', kind: 'text', standard: 'UserName' },
      {
        key: 'Password',
        label: 'Online banking password',
        kind: 'secret',
        standard: 'Password',
        protected: true
      },
      {
        key: 'URL',
        label: 'Online banking',
        kind: 'text',
        standard: 'URL',
        placeholder: 'https://'
      }
    ],
    signature: ['IBAN'],
    subtitle: ['Bank name', 'IBAN'],
    titleHint: ['Bank name']
  },
  {
    id: 'creditCard',
    version: 1,
    label: 'Credit card',
    group: 'finance',
    kdbxIcon: 66,
    fields: [
      { key: 'Cardholder', label: 'Cardholder', kind: 'text' },
      {
        key: 'Card number',
        label: 'Card number',
        kind: 'cardNumber',
        protected: true,
        required: true
      },
      { key: 'Expiry', label: 'Expiry', kind: 'expiry', placeholder: 'MM/YY' },
      { key: 'CVV', label: 'Security code', kind: 'secret', protected: true },
      { key: 'PIN', label: 'PIN', kind: 'secret', protected: true },
      { key: 'Card issuer', label: 'Issuer', kind: 'text' }
    ],
    signature: ['Card number'],
    subtitle: ['Card issuer', 'Expiry'],
    titleHint: ['Card issuer']
  },
  {
    id: 'secureNote',
    version: 1,
    label: 'Secure note',
    group: 'other',
    kdbxIcon: 44,
    fields: [],
    signature: [],
    subtitle: []
  },
  {
    id: 'wifi',
    version: 1,
    label: 'Wi-Fi network',
    group: 'other',
    kdbxIcon: 12,
    fields: [
      { key: 'SSID', label: 'Network name', kind: 'text', required: true },
      { key: 'Password', label: 'Password', kind: 'secret', standard: 'Password', protected: true },
      {
        key: 'Security',
        label: 'Security',
        kind: 'select',
        options: ['WPA3', 'WPA2', 'WPA', 'WEP', 'None']
      },
      { key: 'Hidden network', label: 'Hidden network', kind: 'select', options: ['No', 'Yes'] }
    ],
    signature: ['SSID'],
    subtitle: ['SSID'],
    titleHint: ['SSID']
  },
  {
    id: 'softwareLicense',
    version: 1,
    label: 'Software license',
    group: 'other',
    kdbxIcon: 67,
    fields: [
      { key: 'Product', label: 'Product', kind: 'text' },
      { key: 'Version', label: 'Version', kind: 'text' },
      {
        key: 'License key',
        label: 'License key',
        kind: 'multiline',
        protected: true,
        required: true
      },
      { key: 'Licensed to', label: 'Licensed to', kind: 'text' },
      { key: 'UserName', label: 'Registered email', kind: 'text', standard: 'UserName' },
      { key: 'Order number', label: 'Order number', kind: 'text' },
      { key: 'Purchase date', label: 'Purchase date', kind: 'date' },
      { key: 'URL', label: 'Download page', kind: 'text', standard: 'URL', placeholder: 'https://' }
    ],
    signature: ['License key'],
    subtitle: ['Product', 'Version'],
    titleHint: ['Product']
  },
  {
    id: 'sshKey',
    version: 1,
    label: 'SSH key',
    group: 'other',
    kdbxIcon: 29,
    fields: [
      {
        key: 'Private key',
        label: 'Private key',
        kind: 'multiline',
        protected: true,
        required: true
      },
      { key: 'Public key', label: 'Public key', kind: 'multiline' },
      {
        key: 'Password',
        label: 'Passphrase',
        kind: 'secret',
        standard: 'Password',
        protected: true
      },
      { key: 'Fingerprint', label: 'Fingerprint', kind: 'text' },
      { key: 'UserName', label: 'User', kind: 'text', standard: 'UserName' },
      { key: 'Host', label: 'Host', kind: 'text' }
    ],
    signature: ['Private key'],
    subtitle: ['Host'],
    titleHint: ['Host']
  },
  {
    id: 'apiToken',
    version: 1,
    label: 'API token',
    group: 'other',
    kdbxIcon: 58,
    fields: [
      { key: 'API token', label: 'Token', kind: 'secret', protected: true, required: true },
      { key: 'UserName', label: 'Client / key ID', kind: 'text', standard: 'UserName' },
      { key: 'URL', label: 'Endpoint', kind: 'text', standard: 'URL', placeholder: 'https://' },
      { key: 'Scopes', label: 'Scopes', kind: 'text' },
      { key: 'Token expiry', label: 'Expires', kind: 'date' }
    ],
    signature: ['API token'],
    subtitle: ['Scopes'],
    titleHint: [],
    expiryField: 'Token expiry'
  }
]

export const ENTRY_TYPE_GROUPS: { id: EntryTypeGroup; label: string }[] = [
  { id: 'login', label: 'Logins' },
  { id: 'identity', label: 'Identity' },
  { id: 'finance', label: 'Finance' },
  { id: 'other', label: 'Other' }
]

const BY_ID = new Map(ENTRY_TYPES.map((t) => [t.id, t]))

export const getType = (id: string | undefined): EntryType | undefined =>
  id === undefined ? undefined : BY_ID.get(id)

export const loginType = (): EntryType => BY_ID.get(LOGIN_TYPE)!

/** `passport@1` → `{ id: 'passport', version: 1 }`. Unknown or malformed → undefined. */
export function parseMarker(
  marker: string | undefined
): { id: string; version: number } | undefined {
  const m = marker?.match(/^([A-Za-z][\w-]*)@(\d+)$/)
  if (!m) return undefined
  return { id: m[1], version: Number(m[2]) }
}

export const formatMarker = (t: EntryType): string => `${t.id}@${t.version}`

/** Recognise a type from an entry's field names. The most specific signature wins. */
export function detectType(fieldKeys: Iterable<string>): EntryType | undefined {
  const keys = new Set(fieldKeys)
  let best: EntryType | undefined
  for (const t of ENTRY_TYPES) {
    if (!t.signature.length || !t.signature.every((k) => keys.has(k))) continue
    if (!best || t.signature.length > best.signature.length) best = t
  }
  return best
}

/** The list subtitle from an entry's (non-protected) values. */
export function subtitleFor(t: EntryType, value: (key: string) => string): string {
  const parts = t.subtitle.map(value).filter(Boolean)
  if (t.subtitleJoin === 'first') return parts[0] ?? ''
  return parts.join(t.subtitleJoin ?? ' · ')
}

/** Suggested title for an untitled entry, e.g. `Passport – Jane Doe`. */
export function suggestTitle(t: EntryType, value: (key: string) => string): string {
  const hint = (t.titleHint ?? []).map(value).filter(Boolean).join(' ')
  return hint ? `${t.label} – ${hint}` : t.label
}

/** Field keys a type stores outside the standard KeePass fields. */
export const customKeys = (t: EntryType): string[] =>
  t.fields.filter((f) => !f.standard).map((f) => f.key)

// ---------------------------------------------------------------- values

const group4 = (s: string) => s.replace(/(.{4})(?=.)/g, '$1 ')

/** Canonical, human-readable text for a value, as stored in the KDBX field. */
export function normalizeValue(kind: FieldKind, raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  switch (kind) {
    case 'iban':
      return group4(v.replace(/\s+/g, '').toUpperCase())
    case 'cardNumber':
      return group4(v.replace(/[\s-]+/g, ''))
    case 'bic':
    case 'country':
      return v.replace(/\s+/g, '').toUpperCase()
    case 'expiry': {
      const m = v.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
      return m ? `${m[1].padStart(2, '0')}/${m[2].slice(-2)}` : v
    }
    case 'multiline':
    case 'secret':
      return raw
    default:
      return v
  }
}

function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const n = ch >= 'A' ? ch.charCodeAt(0) - 55 : Number(ch)
    rem = Number(`${rem}${n}`) % 97
  }
  return rem === 1
}

function luhnValid(number: string): boolean {
  const s = number.replace(/[\s-]+/g, '')
  if (!/^\d{12,19}$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** A user-facing problem with a value, or undefined when it is fine (empty is fine). */
export function validateValue(kind: FieldKind, raw: string): string | undefined {
  const v = raw.trim()
  if (!v) return undefined
  switch (kind) {
    case 'iban':
      return ibanValid(v) ? undefined : 'Not a valid IBAN'
    case 'bic':
      return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v.replace(/\s+/g, '').toUpperCase())
        ? undefined
        : 'Not a valid BIC'
    case 'cardNumber':
      return luhnValid(v) ? undefined : 'Not a valid card number'
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Use YYYY-MM-DD'
      const d = new Date(`${v}T00:00:00Z`)
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v
        ? 'Not a valid date'
        : undefined
    }
    case 'expiry':
      return /^(0[1-9]|1[0-2])\/\d{2}$/.test(normalizeValue('expiry', v)) ? undefined : 'Use MM/YY'
    case 'country':
      return /^[A-Za-z]{2,3}$/.test(v) ? undefined : 'Use a 2- or 3-letter country code'
    default:
      return undefined
  }
}
