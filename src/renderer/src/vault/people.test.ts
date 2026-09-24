import { describe, expect, it } from 'vitest'
import {
  linkedTo,
  listPeople,
  peopleMatching,
  personFilter,
  personFilterId,
  suggestedPeople
} from './people'
import type { VaultEntrySummary, VaultSnapshot } from '../../../main/vault/protocol'

const e = (
  uuid: string,
  type: string,
  extra: Partial<VaultEntrySummary> = {}
): VaultEntrySummary => ({
  uuid,
  groupUuid: 'root',
  title: '',
  username: '',
  url: '',
  protectedFields: [],
  tags: [],
  icon: 0,
  type,
  subtitle: '',
  hasPassword: false,
  hasOtp: false,
  attachmentCount: 0,
  inRecycleBin: false,
  modified: undefined,
  people: [],
  ...extra
})

const snapshot = {
  entries: [
    e('jane', 'personalDetails', { subtitle: 'Jane Doe' }),
    e('max', 'personalDetails', { title: 'Max', subtitle: 'Max Müller' }),
    e('gone', 'personalDetails', { subtitle: 'Old Person', inRecycleBin: true }),
    e('pass', 'passport', { subtitle: 'Jane  doe' }),
    e('card', 'creditCard', { subtitle: 'Jane Doe', people: ['max'] }),
    e('mail', 'login', { title: 'Mail', people: ['jane'] })
  ]
} as unknown as VaultSnapshot

describe('people', () => {
  it('lists Person entries outside the bin, by name', () => {
    expect(listPeople(snapshot).map((p) => p.uuid)).toEqual(['jane', 'max'])
  })

  it('finds what belongs to someone', () => {
    expect(linkedTo(snapshot, 'jane').map((x) => x.uuid)).toEqual(['mail'])
    expect(linkedTo(snapshot, 'max').map((x) => x.uuid)).toEqual(['card'])
  })

  it('suggests the person an identity document names, and only then', () => {
    const passport = snapshot.entries.find((x) => x.uuid === 'pass')!
    expect(suggestedPeople(passport, snapshot).map((p) => p.uuid)).toEqual(['jane'])
    // Already linked: nothing to suggest.
    expect(suggestedPeople({ ...passport, people: ['jane'] }, snapshot)).toEqual([])
    // A card's subtitle is its issuer, not a name.
    const card = snapshot.entries.find((x) => x.uuid === 'card')!
    expect(suggestedPeople(card, snapshot)).toEqual([])
  })

  it('matches @names by any word prefix, ignoring accents', () => {
    expect(peopleMatching(snapshot, 'mu').map((p) => p.uuid)).toEqual([])
    expect(peopleMatching(snapshot, 'ja').map((p) => p.uuid)).toEqual(['jane'])
    expect(peopleMatching(snapshot, 'do').map((p) => p.uuid)).toEqual(['jane'])
    expect(peopleMatching(snapshot, '').map((p) => p.uuid)).toEqual(['jane', 'max'])
  })

  it('round-trips person scopes', () => {
    expect(personFilter(personFilterId('abc'))).toBe('abc')
    expect(personFilter('type:passport')).toBeUndefined()
  })
})
