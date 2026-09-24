import { describe, expect, it } from 'vitest'
import {
  detectType,
  ENTRY_TYPE_GROUPS,
  ENTRY_TYPES,
  fieldFormat,
  formatMarker,
  getIdFormat,
  getType,
  ID_FORMATS,
  recognizeId,
  suggestNewEntries,
  normalizeValue,
  parseMarker,
  subtitleFor,
  suggestTitle,
  validateValue
} from './entryTypes'
import { STANDARD_FIELDS } from './protocol'

describe('entry type registry', () => {
  it('has unique type ids and unique field keys per type', () => {
    expect(new Set(ENTRY_TYPES.map((t) => t.id)).size).toBe(ENTRY_TYPES.length)
    for (const t of ENTRY_TYPES) {
      const keys = t.fields.map((f) => f.key)
      expect(new Set(keys).size, t.id).toBe(keys.length)
    }
  })

  it('never builds a subtitle from a protected field', () => {
    for (const t of ENTRY_TYPES) {
      for (const key of t.subtitle) {
        const field = t.fields.find((f) => f.key === key)
        expect(field, `${t.id}.${key}`).toBeDefined()
        expect(field!.protected, `${t.id}.${key}`).toBeFalsy()
      }
    }
  })

  it('only uses standard KeePass names for fields declared standard', () => {
    for (const t of ENTRY_TYPES) {
      for (const f of t.fields) {
        const isStandard = (STANDARD_FIELDS as readonly string[]).includes(f.key)
        expect(isStandard, `${t.id}.${f.key}`).toBe(!!f.standard)
        if (f.standard) expect(f.key).toBe(f.standard)
      }
    }
  })

  it('gives every group a type and every type a known group', () => {
    for (const g of ENTRY_TYPE_GROUPS)
      expect(
        ENTRY_TYPES.some((t) => t.group === g.id),
        g.id
      ).toBe(true)
    for (const t of ENTRY_TYPES) expect(ENTRY_TYPE_GROUPS.map((g) => g.id)).toContain(t.group)
  })

  it('describes every type in one short line for the wizard', () => {
    for (const t of ENTRY_TYPES) {
      expect(t.description.length, t.id).toBeGreaterThan(10)
      expect(t.description.length, t.id).toBeLessThan(90)
    }
  })

  it('has a distinct signature per type', () => {
    const sigs = ENTRY_TYPES.filter((t) => t.signature.length).map((t) =>
      [...t.signature].sort().join('|')
    )
    expect(new Set(sigs).size).toBe(sigs.length)
    // Each type is recognised as itself from its own field names.
    for (const t of ENTRY_TYPES.filter((t) => t.signature.length)) {
      expect(detectType(t.fields.map((f) => f.key))?.id, t.id).toBe(t.id)
    }
  })

  it('points formats at real fields', () => {
    for (const t of ENTRY_TYPES) {
      for (const f of t.fields) {
        for (const id of f.formats ?? []) expect(getIdFormat(id), `${t.id}.${f.key}`).toBeDefined()
      }
    }
    for (const f of ID_FORMATS) {
      const t = getType(f.typeId)
      expect(t, f.id).toBeDefined()
      expect(
        t!.fields.map((x) => x.key),
        f.id
      ).toContain(f.fieldKey)
      for (const key of Object.keys(f.extra ?? {}))
        expect(t!.fields.map((x) => x.key)).toContain(key)
    }
  })

  it('keeps signature fields among the type fields', () => {
    for (const t of ENTRY_TYPES) {
      for (const key of t.signature) expect(t.fields.map((f) => f.key)).toContain(key)
    }
  })
})

describe('markers', () => {
  it('round-trips', () => {
    const t = getType('passport')!
    expect(formatMarker(t)).toBe('passport@1')
    expect(parseMarker('passport@1')).toEqual({ id: 'passport', version: 1 })
  })

  it('rejects malformed markers', () => {
    expect(parseMarker(undefined)).toBeUndefined()
    expect(parseMarker('passport')).toBeUndefined()
    expect(parseMarker('@1')).toBeUndefined()
    expect(parseMarker('pass port@1')).toBeUndefined()
  })
})

describe('detectType', () => {
  it('recognises types from field names', () => {
    expect(detectType(['Title', 'IBAN', 'BIC'])?.id).toBe('bankAccount')
    expect(detectType(['Passport number', 'Surname'])?.id).toBe('passport')
    expect(detectType(['Card number'])?.id).toBe('creditCard')
  })

  it('leaves plain logins alone', () => {
    expect(detectType(['Title', 'UserName', 'Password', 'URL', 'Notes', 'otp'])).toBeUndefined()
  })
})

describe('values', () => {
  it('normalizes into readable canonical text', () => {
    expect(normalizeValue('iban', ' de89370400440532013000 ')).toBe('DE89 3704 0044 0532 0130 00')
    expect(normalizeValue('cardNumber', '4111-1111-1111-1111')).toBe('4111 1111 1111 1111')
    expect(normalizeValue('bic', 'cobade ffxxx')).toBe('COBADEFFXXX')
    expect(normalizeValue('expiry', '3/2029')).toBe('03/29')
    expect(normalizeValue('country', 'de')).toBe('DE')
    expect(normalizeValue('multiline', '  keep\n  as is ')).toBe('  keep\n  as is ')
  })

  it('validates IBAN, card numbers, BIC, dates and expiry', () => {
    expect(validateValue('iban', 'DE89 3704 0044 0532 0130 00')).toBeUndefined()
    expect(validateValue('iban', 'DE89 3704 0044 0532 0130 01')).toBe('Not a valid IBAN')
    expect(validateValue('cardNumber', '4111 1111 1111 1111')).toBeUndefined()
    expect(validateValue('cardNumber', '4111 1111 1111 1112')).toBe('Not a valid card number')
    expect(validateValue('bic', 'COBADEFFXXX')).toBeUndefined()
    expect(validateValue('bic', 'COBA')).toBe('Not a valid BIC')
    expect(validateValue('date', '2031-02-28')).toBeUndefined()
    expect(validateValue('date', '2031-02-30')).toBe('Not a valid date')
    expect(validateValue('date', '28.02.2031')).toBe('Use YYYY-MM-DD')
    expect(validateValue('expiry', '3/29')).toBeUndefined()
    expect(validateValue('expiry', '13/29')).toBe('Use MM/YY')
    expect(validateValue('iban', '')).toBeUndefined()
  })

  it('builds subtitles and title suggestions', () => {
    const values: Record<string, string> = { 'Given names': 'Jane', Surname: 'Doe' }
    const passport = getType('passport')!
    expect(subtitleFor(passport, (k) => values[k] ?? '')).toBe('Jane Doe')
    expect(suggestTitle(passport, (k) => values[k] ?? '')).toBe('Passport – Jane Doe')
    const login = getType('login')!
    expect(subtitleFor(login, (k) => ({ URL: 'https://x' })[k] ?? '')).toBe('https://x')
  })
})

describe('id formats', () => {
  const first = (q: string) => recognizeId(q)[0]?.format.id

  it('recognises checksummed national numbers', () => {
    expect(first('86095742719')).toBe('de-steuer-id')
    expect(first('RSSMRA85T10A562S')).toBe('it-codice-fiscale')
    expect(first('12345678Z')).toBe('es-nif')
    expect(first('X1234567L')).toBe('es-nif')
    expect(first('111222333')).toBe('nl-bsn')
    expect(first('756.9217.0769.85')).toBe('ch-ahv')
    expect(first('2 55 08 14 168 025 38')).toBe('fr-nir')
    expect(first('65 170839 J 00 3')).toBe('de-sv-nummer')
    expect(first('DE89 3704 0044 0532 0130 00')).toBe('iban')
    expect(first('4111 1111 1111 1111')).toBe('card')
  })

  it('rejects bad check digits', () => {
    expect(recognizeId('86095742718')).toEqual([])
    expect(recognizeId('RSSMRA85T10A562T')).toEqual([])
    expect(recognizeId('12345678A')).toEqual([])
    expect(recognizeId('756.9217.0769.86')).toEqual([])
    expect(first('65 170839 J 00 4')).toBeUndefined()
  })

  it('recognises pattern formats', () => {
    expect(first('12-3456789')).toBe('us-ein')
    expect(first('123-45-6789')).toBe('us-ssn')
    expect(first('000-45-6789')).toBeUndefined()
    expect(first('912-70-1234')).toBe('us-itin')
    expect(first('AB123456C')).toBe('uk-nino')
    expect(first('BG123456C')).toBeUndefined()
    expect(first('DE123456789')).toBe('eu-vat')
    expect(first('1M8GDM9AXKP042788')).toBe('vin')
    expect(recognizeId('490154203237518').map((r) => r.format.id)).toContain('imei')
    expect(first('jane@example.com')).toBe('email')
    expect(first('github.com')).toBe('web')
  })

  it('never suggests ambiguous formats but still names them for a field', () => {
    expect(recognizeId('1234567890').map((r) => r.format.id)).not.toContain('uk-utr')
    const taxField = getType('taxId')!.fields[0]
    expect(fieldFormat(taxField, '1234567890')?.id).toBe('uk-utr')
    expect(fieldFormat(taxField, '86 095 742 719')?.id).toBe('de-steuer-id')
    expect(fieldFormat(taxField, 'hello')).toBeUndefined()
  })
})

describe('suggestNewEntries', () => {
  it('prefills a recognised number with its country and kind', () => {
    expect(suggestNewEntries('12-3456789')[0]).toEqual({
      typeId: 'taxId',
      via: 'id',
      detail: 'US EIN',
      prefill: { 'Tax ID number': '12-3456789', 'ID kind': 'EIN', Country: 'US' }
    })
    expect(suggestNewEntries('de89370400440532013000')[0].prefill).toEqual({
      IBAN: 'DE89 3704 0044 0532 0130 00'
    })
    expect(suggestNewEntries('github.com')[0]).toMatchObject({
      typeId: 'login',
      prefill: { URL: 'https://github.com' }
    })
    expect(suggestNewEntries('FR12345678901')[0].prefill?.Country).toBe('FR')
  })

  it('matches type names and keywords in any language we list', () => {
    expect(suggestNewEntries('steuer')[0].typeId).toBe('taxId')
    expect(suggestNewEntries('Führerschein')[0].typeId).toBe('driversLicense')
    expect(suggestNewEntries('new passport')[0].typeId).toBe('passport')
    expect(suggestNewEntries('car insurance')[0].typeId).toBe('insurancePolicy')
    expect(suggestNewEntries('krankenkasse')[0].typeId).toBe('healthInsurance')
  })

  it('returns nothing for noise and caps the list', () => {
    expect(suggestNewEntries('zz')).toEqual([])
    expect(suggestNewEntries('   ')).toEqual([])
    expect(suggestNewEntries('account').length).toBeLessThanOrEqual(4)
  })
})
