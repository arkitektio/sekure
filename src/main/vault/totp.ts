import { createHmac } from 'crypto'
import type { TotpCode } from './protocol'

export interface TotpParams {
  secret: Uint8Array
  digits: number
  period: number
  algorithm: 'sha1' | 'sha256' | 'sha512'
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    if (idx === -1) throw new Error('Invalid base32 secret')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

/**
 * Accepts what KeePass clients store: an `otpauth://totp/...` URI (KeePassXC's
 * `otp` field) or a bare base32 seed (`TOTP Seed`, KeePass 2.47+).
 */
export function parseOtp(source: string): TotpParams {
  const trimmed = source.trim()
  if (trimmed.startsWith('otpauth://')) {
    // Node's ERR_INVALID_URL carries the whole input (seed included) on
    // `.input`; never let that error escape into a log.
    const url = URL.parse(trimmed)
    if (!url) throw new Error('Invalid one-time password URI')
    const secret = url.searchParams.get('secret')
    if (!secret) throw new Error('otpauth URI has no secret')
    const algo = (url.searchParams.get('algorithm') ?? 'SHA1').toLowerCase()
    const digits = Number(url.searchParams.get('digits') ?? 6)
    const period = Number(url.searchParams.get('period') ?? 30)
    if (!Number.isInteger(digits) || digits < 6 || digits > 10) {
      throw new Error('Unsupported one-time password length')
    }
    if (!Number.isInteger(period) || period < 1 || period > 86_400) {
      throw new Error('Unsupported one-time password period')
    }
    return {
      secret: base32Decode(secret),
      digits,
      period,
      algorithm: algo === 'sha256' || algo === 'sha512' ? algo : 'sha1'
    }
  }
  return { secret: base32Decode(trimmed), digits: 6, period: 30, algorithm: 'sha1' }
}

/** RFC 6238. */
export function totp(params: TotpParams, now = Date.now()): TotpCode {
  const seconds = Math.floor(now / 1000)
  const counter = Math.floor(seconds / params.period)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac(params.algorithm, params.secret).update(msg).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** params.digits
  return {
    code: bin.toString().padStart(params.digits, '0'),
    remaining: params.period - (seconds % params.period),
    period: params.period
  }
}
