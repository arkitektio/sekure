import { describe, expect, it } from 'vitest'
import { editDistance, lexicalDoc, lexicalScore } from './lexical'
import type { SearchDocument } from './document'

const doc = (d: Partial<SearchDocument>): SearchDocument => ({
  uuid: d.title ?? 'x',
  title: '',
  type: '',
  tags: [],
  group: '',
  host: '',
  url: '',
  username: '',
  subtitle: '',
  fieldNames: [],
  notes: '',
  inRecycleBin: false,
  ...d
})

const score = (d: Partial<SearchDocument>, q: string) => lexicalScore(lexicalDoc(doc(d)), q)

describe('lexicalScore', () => {
  it('ranks exact, prefix and substring matches', () => {
    expect(score({ title: 'Gmail' }, 'gmail')).toBeGreaterThan(score({ title: 'Gmail' }, 'gma'))
    expect(score({ title: 'Gmail' }, 'gma')).toBeGreaterThan(score({ title: 'Gmail' }, 'mail'))
    expect(score({ title: 'Gmail' }, 'mail')).toBeGreaterThan(0)
  })

  it('tolerates typos', () => {
    expect(score({ title: 'Gmail' }, 'gmial')).toBeGreaterThan(0)
    expect(score({ title: 'Sparkasse' }, 'sparkase')).toBeGreaterThan(0)
    expect(score({ title: 'Sparkasse' }, 'sap')).toBe(0) // too short for a typo
    expect(score({ title: 'Sparkasse' }, 'spra')).toBeGreaterThan(0) // typo while typing
    expect(score({ title: 'Gmail' }, 'yahoo')).toBe(0)
  })

  it('folds case and accents', () => {
    expect(score({ title: 'Führerschein' }, 'fuhrerschein')).toBeGreaterThan(1)
    expect(score({ title: 'fuhrerschein' }, 'FÜHRER')).toBeGreaterThan(0)
  })

  it('weights fields: a title hit beats a notes hit', () => {
    expect(score({ title: 'Bank' }, 'bank')).toBeGreaterThan(score({ notes: 'my bank' }, 'bank'))
  })

  it('requires every word to match something', () => {
    const d = { title: 'GitHub', username: 'octo' }
    expect(score(d, 'github octo')).toBeGreaterThan(0)
    expect(score(d, 'github nope')).toBe(0)
  })

  it('searches type labels, tags, hosts and field names', () => {
    expect(score({ title: 'Jane', type: 'Passport' }, 'passport')).toBeGreaterThan(0)
    expect(score({ title: 'x', tags: ['work'] }, 'work')).toBeGreaterThan(0)
    expect(score({ title: 'x', host: 'github' }, 'github')).toBeGreaterThan(0)
    expect(score({ title: 'x', fieldNames: ['Recovery codes'] }, 'recovery')).toBeGreaterThan(0)
    expect(score({ title: 'x', url: 'https://mail.google.com' }, 'mail.google')).toBeGreaterThan(0)
  })
})

describe('editDistance', () => {
  it('counts transpositions as one edit', () => {
    expect(editDistance('gmial', 'gmail', 2)).toBe(1)
    expect(editDistance('kitten', 'sitting', 5)).toBe(3)
    expect(editDistance('abc', 'xyzabc', 1)).toBe(2)
  })
})
