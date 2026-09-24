import { randomInt } from 'crypto'
import type { PasswordOptions } from './protocol'

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/~'
const AMBIGUOUS = /[Il1O0]/g

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 24,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  unambiguous: true
}

export const MIN_PASSWORD_LENGTH = 4
export const MAX_PASSWORD_LENGTH = 1024

/**
 * CSPRNG password with at least one character from every enabled class.
 * `randomInt` is uniform (no modulo bias). Options come from the renderer, so
 * missing ones take the defaults and the length must be a sane integer.
 */
export function generatePassword(partial: Partial<PasswordOptions> = {}): string {
  const opts = { ...DEFAULT_PASSWORD_OPTIONS, ...partial }
  if (
    !Number.isInteger(opts.length) ||
    opts.length < MIN_PASSWORD_LENGTH ||
    opts.length > MAX_PASSWORD_LENGTH
  ) {
    throw new Error(
      `Password length must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH}`
    )
  }
  const classes = [
    opts.lower && LOWER,
    opts.upper && UPPER,
    opts.digits && DIGITS,
    opts.symbols && SYMBOLS
  ]
    .filter((c): c is string => !!c)
    .map((c) => (opts.unambiguous ? c.replace(AMBIGUOUS, '') : c))

  if (classes.length === 0) throw new Error('Select at least one character class')
  const length = Math.max(opts.length, classes.length)
  const all = classes.join('')

  const chars = classes.map((c) => c[randomInt(c.length)])
  while (chars.length < length) chars.push(all[randomInt(all.length)])

  // Fisher–Yates so the guaranteed characters are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
