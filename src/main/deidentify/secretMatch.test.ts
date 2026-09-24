import { describe, expect, it } from 'vitest'
import { findSecretSpans, type KnownSecret } from './secretMatch'

const secret = (value: string, extra: Partial<KnownSecret> = {}): KnownSecret => ({
  value,
  entry: 'E',
  field: 'F',
  ...extra
})
const found = (text: string, secrets: KnownSecret[]) =>
  findSecretSpans(text, secrets).map((h) => text.slice(h.start, h.end))

describe('findSecretSpans', () => {
  it('finds exact values', () => {
    expect(found('my pw is hunter22, ok', [secret('hunter22')])).toEqual(['hunter22'])
  })

  it('matches numeric secrets only as whole numbers', () => {
    const cvv = secret('737')
    expect(found('CVV 737.', [cvv])).toEqual(['737'])
    expect(found('order 97371', [cvv])).toEqual([])
    expect(found('pin 12', [secret('12')])).toEqual([]) // too short to match safely
  })

  it('ignores spaces and dashes for card numbers and IBANs', () => {
    const card = secret('4111 1111 1111 1111')
    expect(found('card: 4111-1111-1111-1111 exp', [card])).toEqual(['4111-1111-1111-1111'])
    expect(found('card 4111111111111111', [card])).toEqual(['4111111111111111'])
  })

  it('matches OTP seeds case-insensitively', () => {
    expect(
      found('seed jbswy3dpehpk3pxp', [secret('JBSWY3DPEHPK3PXP', { ignoreCase: true })])
    ).toEqual(['jbswy3dpehpk3pxp'])
  })

  it('finds lines of a multi-line secret', () => {
    const key = 'BEGIN\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU\nEND'
    expect(found('here: b3BlbnNzaC1rZXktdjEAAAAABG5vbmU', [secret(key)])).toEqual([
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmU'
    ])
  })

  it('reports names, never values', () => {
    const hits = findSecretSpans('x hunter22', [
      secret('hunter22', { entry: 'Gmail', field: 'Password' })
    ])
    expect(hits).toEqual([{ start: 2, end: 10, entry: 'Gmail', field: 'Password' }])
  })
})
