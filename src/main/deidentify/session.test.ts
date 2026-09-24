import { describe, expect, it } from 'vitest'
import { mergeSpans } from './merge'
import { PlaceholderMap } from './placeholders'
import { DeidentifySession, placeholderSpans } from './session'
import type { Span } from './span'

const span = (text: string, part: string, s: Partial<Span>): Span => {
  const start = text.indexOf(part)
  return { start, end: start + part.length, kind: 'OTHER', label: '', source: 'rule', ...s }
}

describe('mergeSpans', () => {
  const text = 'Jane Doe <jane@x.com> pw s3cret-Pass'
  it('lets stronger sources win and trims weaker overlapping spans', () => {
    const merged = mergeSpans(text, [
      span(text, 'Jane Doe <jane@x.com>', { kind: 'PERSON', source: 'model' }),
      span(text, 'jane@x.com', { kind: 'EMAIL', source: 'rule' }),
      span(text, 's3cret-Pass', { kind: 'CREDENTIAL', source: 'vault' }),
      span(text, 'pw s3cret', { kind: 'SECRET', source: 'rule' })
    ])
    expect(merged.map((s) => [s.kind, text.slice(s.start, s.end)])).toEqual([
      ['PERSON', 'Jane Doe'],
      ['EMAIL', 'jane@x.com'],
      ['SECRET', 'pw'],
      ['CREDENTIAL', 's3cret-Pass']
    ])
  })
})

describe('PlaceholderMap', () => {
  it('numbers consistently and never keeps credentials', () => {
    const map = new PlaceholderMap()
    expect(map.placeholderFor('PERSON', 'Jane')).toBe('[PERSON_1]')
    expect(map.placeholderFor('PERSON', 'Bob')).toBe('[PERSON_2]')
    expect(map.placeholderFor('PERSON', 'Jane')).toBe('[PERSON_1]')
    expect(map.placeholderFor('EMAIL', 'Jane')).toBe('[EMAIL_1]')
    expect(map.placeholderFor('CREDENTIAL', 'hunter2')).toBe('[CREDENTIAL]')
    expect(map.placeholderFor('SECRET', 'AKIA…')).toBe('[SECRET]')
    expect(map.size).toBe(3)
    expect(map.find('Hi [PERSON_2], [CREDENTIAL] [PERSON_9]').map((h) => h.original)).toEqual([
      'Bob'
    ])
  })
})

describe('DeidentifySession', () => {
  const raw = 'Jane (jane@x.com) uses hunter22 at Acme.'
  const spans: Span[] = [
    span(raw, 'Jane', { kind: 'PERSON', source: 'model', label: 'person' }),
    span(raw, 'jane@x.com', { kind: 'EMAIL', label: 'email' }),
    span(raw, 'hunter22', { kind: 'CREDENTIAL', source: 'vault', label: 'Gmail / Password' })
  ]

  it('never sends a vault credential to the review', () => {
    const session = new DeidentifySession(1, raw, 'deidentify', spans)
    const segments = session.segments()
    expect(JSON.stringify(segments)).not.toContain('hunter22')
    expect(segments.find((s) => s.type === 'span' && s.kind === 'CREDENTIAL')).toMatchObject({
      locked: true,
      label: 'Gmail / Password',
      text: undefined
    })
  })

  it('replaces enabled spans, always the credential, plus manual marks', () => {
    const map = new PlaceholderMap()
    const session = new DeidentifySession(1, raw, 'deidentify', spans)
    const segments = session.segments()
    const email = segments.find((s) => s.type === 'span' && s.kind === 'EMAIL')!
    const acme = segments.findIndex((s) => s.type === 'text' && s.text.includes('Acme'))
    const acmeText = (segments[acme] as { text: string }).text
    const out = session.apply(
      {
        // The person is unticked; the credential is replaced regardless.
        enabled: [email.type === 'span' ? email.id : ''],
        manual: [
          { segment: acme, start: acmeText.indexOf('Acme'), end: acmeText.indexOf('Acme') + 4 }
        ]
      },
      map
    )
    expect(out.text).toBe('Jane ([EMAIL_1]) uses [CREDENTIAL] at [OTHER_1].')
    expect(out.replaced).toBe(3)
  })

  it('round-trips through re-identify, except the credential', () => {
    const map = new PlaceholderMap()
    const first = new DeidentifySession(1, raw, 'deidentify', spans)
    const all = first.segments().flatMap((s) => (s.type === 'span' ? [s.id] : []))
    const { text } = first.apply({ enabled: all, manual: [] }, map)
    expect(text).toBe('[PERSON_1] ([EMAIL_1]) uses [CREDENTIAL] at Acme.')

    const answer = `Dear ${text.split(' ')[0]}, I wrote to [EMAIL_1]. Your hunter22 stays hidden.`
    const leaked = span(answer, 'hunter22', {
      kind: 'CREDENTIAL',
      source: 'vault',
      label: 'Gmail / Password'
    })
    const back = new DeidentifySession(2, answer, 'reidentify', [
      leaked,
      ...placeholderSpans(answer, map)
    ])
    expect(JSON.stringify(back.segments())).not.toContain('hunter22')
    const ids = back.segments().flatMap((s) => (s.type === 'span' ? [s.id] : []))
    expect(back.apply({ enabled: ids, manual: [] }, map).text).toBe(
      'Dear Jane, I wrote to jane@x.com. Your [CREDENTIAL] stays hidden.'
    )
  })
})
