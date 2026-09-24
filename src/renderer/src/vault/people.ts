// People in the open vault: Person entries, and the entries linked to them.
// Pure, over the snapshot (which carries link ids, never names beyond titles/subtitles).

import { getType, namesPerson, PERSON_TYPE } from '../../../main/vault/entryTypes'
import type { VaultEntrySummary, VaultSnapshot } from '../../../main/vault/protocol'

/** `person:<uuid>` scopes a list to one person's entries. */
const PERSON_PREFIX = 'person:'
export const personFilterId = (uuid: string) => `${PERSON_PREFIX}${uuid}`
export const personFilter = (scope: string): string | undefined =>
  scope.startsWith(PERSON_PREFIX) ? scope.slice(PERSON_PREFIX.length) : undefined

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** A person's name: the title, else the name fields (the Person subtitle). */
export const personName = (p: VaultEntrySummary): string => p.title || p.subtitle || 'Unnamed'

/** Person entries outside the recycle bin, by name. */
export function listPeople(snapshot: VaultSnapshot | undefined): VaultEntrySummary[] {
  return (snapshot?.entries ?? [])
    .filter((e) => e.type === PERSON_TYPE && !e.inRecycleBin)
    .sort((a, b) => personName(a).localeCompare(personName(b)))
}

/** Entries linked to a person (not in the bin). */
export function linkedTo(snapshot: VaultSnapshot | undefined, person: string): VaultEntrySummary[] {
  return (snapshot?.entries ?? []).filter(
    (e) => !e.inRecycleBin && (e.people ?? []).includes(person)
  )
}

/**
 * People an entry probably belongs to: for identity-like types, whose name (the
 * subtitle, "Given Surname") matches a person's, and who aren't linked yet.
 */
export function suggestedPeople(
  entry: VaultEntrySummary,
  snapshot: VaultSnapshot | undefined
): VaultEntrySummary[] {
  const type = getType(entry.type)
  if (!type || entry.type === PERSON_TYPE || !namesPerson(type) || !entry.subtitle) return []
  const name = fold(entry.subtitle)
  return listPeople(snapshot).filter(
    (p) =>
      !(entry.people ?? []).includes(p.uuid) &&
      (fold(p.subtitle) === name || fold(p.title) === name)
  )
}

/** People whose name starts with (any word of) `prefix`, for `@jane` in search. */
export function peopleMatching(snapshot: VaultSnapshot | undefined, prefix: string) {
  const q = fold(prefix)
  return listPeople(snapshot).filter((p) =>
    fold(personName(p))
      .split(' ')
      .some((w) => w.startsWith(q))
  )
}
