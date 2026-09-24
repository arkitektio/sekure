import { describe, expect, it } from 'vitest'
import {
  detectType,
  ENTRY_TYPES,
  formatMarker,
  getType,
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
