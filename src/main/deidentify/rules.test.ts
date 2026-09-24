import { describe, expect, it } from 'vitest'
import { detectRules, looksLikeSecret } from './rules'

const found = (text: string) =>
  detectRules(text).map((s) => [s.kind, text.slice(s.start, s.end)] as const)

describe('detectRules', () => {
  it('finds emails, phones and IPs', () => {
    expect(found('Mail jane.doe@example.com today')).toContainEqual([
      'EMAIL',
      'jane.doe@example.com'
    ])
    expect(found('Call +49 170 1234567 now')).toContainEqual(['PHONE', '+49 170 1234567'])
    expect(found('Ruf an: 030 12345678.')).toContainEqual(['PHONE', '030 12345678'])
    expect(found('host 192.168.1.20 is down')).toContainEqual(['IP', '192.168.1.20'])
    expect(found('v6 2001:db8:85a3:0:0:8a2e:370:7334 up')).toContainEqual([
      'IP',
      '2001:db8:85a3:0:0:8a2e:370:7334'
    ])
  })

  it('validates IBANs and card numbers', () => {
    expect(found('IBAN DE89 3704 0044 0532 0130 00 BIC COBADEFFXXX')).toContainEqual([
      'IBAN',
      'DE89 3704 0044 0532 0130 00'
    ])
    expect(found('IBAN DE89370400440532013000.')).toContainEqual(['IBAN', 'DE89370400440532013000'])
    expect(found('IBAN DE89 3704 0044 0532 0130 01').map((f) => f[0])).not.toContain('IBAN')
    expect(found('card 4111 1111 1111 1111 exp')).toContainEqual(['CARD', '4111 1111 1111 1111'])
    expect(found('order 4111 1111 1111 1112').map((f) => f[0])).not.toContain('CARD')
  })

  it('finds secrets in well-known formats', () => {
    const aws = 'AKIAIOSFODNN7EXAMPLE'
    expect(found(`key ${aws}`)).toContainEqual(['SECRET', aws])
    const gh = 'ghp_' + 'a1B2c3D4'.repeat(5)
    expect(found(`token: ${gh}`)).toContainEqual(['SECRET', gh])
    expect(found('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123')).toContainEqual([
      'SECRET',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'
    ])
    expect(found('see https://bob:hunter22@db.example.com/x')).toContainEqual([
      'SECRET',
      'hunter22'
    ])
    expect(found('https://x.io/cb?code=Zx81kQ02ab&state=1')).toContainEqual([
      'SECRET',
      'Zx81kQ02ab'
    ])
    expect(found('my password is Tr0ub4dor&3 ok')).toContainEqual(['SECRET', 'Tr0ub4dor&3'])
    expect(found('Passwort: geheim123')).toContainEqual(['SECRET', 'geheim123'])
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'
    expect(found(`key:\n${pem}\n`)).toContainEqual(['SECRET', pem])
  })

  it('flags random-looking tokens but not hashes, UUIDs or words', () => {
    expect(looksLikeSecret('q8Zr2LmX9vPa4Kt7YwBn3Hc')).toBe(true)
    expect(looksLikeSecret('d41d8cd98f00b204e9800998ecf8427e')).toBe(false)
    expect(looksLikeSecret('123e4567-e89b-12d3-a456-426614174000')).toBe(false)
    expect(looksLikeSecret('internationalization')).toBe(false)
  })

  it('leaves ordinary text alone', () => {
    const text = 'Version 1.2.3 shipped on 12.03.2024 at 10:30. See chapter 12, page 345.'
    expect(found(text)).toEqual([])
  })
})
