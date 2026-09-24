// What search sees of an entry. Built in main from non-secret data only.

export interface SearchDocument {
  uuid: string
  title: string
  /** Entry type label (`Passport`), empty for plain logins. */
  type: string
  /** The type's registry keywords (`reisepass`, `steuer`): synonyms, never vault data. */
  typeKeywords?: string[]
  tags: string[]
  /** Group path from the root, e.g. `Finance / Cards`. */
  group: string
  /** Site name from the URL (`github` for `https://accounts.github.com/…`). */
  host: string
  url: string
  username: string
  subtitle: string
  /** Names of custom fields, never their values. */
  fieldNames: string[]
  /** Start of the (unprotected) notes. */
  notes: string
  /** Names of the people the entry belongs to (non-secret, like titles). */
  people?: string[]
  inRecycleBin: boolean
}

export const NOTES_LIMIT = 300

export function hostLabel(url: string): string {
  if (!url) return ''
  try {
    const host = new URL(/^\w+:\/\//.test(url) ? url : `https://${url}`).hostname
    const parts = host.replace(/^www\./, '').split('.')
    return parts.length > 1 ? parts[parts.length - 2] : parts[0]
  } catch {
    return ''
  }
}

/** The text the embedding model reads for an entry. */
export function passageText(d: SearchDocument): string {
  return [
    d.title,
    d.type,
    (d.typeKeywords ?? []).join(', '),
    d.subtitle,
    d.host,
    d.username,
    d.group,
    (d.people ?? []).join(', '),
    d.tags.join(', '),
    d.fieldNames.join(', '),
    d.notes
  ]
    .filter(Boolean)
    .join(' · ')
}
