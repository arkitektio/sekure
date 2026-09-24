import { validateValue } from '../vault/entryTypes'
import type { SpanKind } from './protocol'
import type { Span } from './span'

interface Rule {
  kind: SpanKind
  label: string
  /** Needs the `d` flag when `group` is set. */
  pattern: RegExp
  /** Capture group to mark instead of the whole match. */
  group?: number
  accept?: (match: string) => boolean
}

const digits = (s: string) => s.replace(/\D/g, '')

function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

const charClasses = (s: string) =>
  [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length

/** Looks like a generated secret: long, varied and not a plain word, hash or UUID. */
export function looksLikeSecret(token: string): boolean {
  if (token.length < 20) return false
  if (/^[0-9a-f-]+$/i.test(token)) return false // hex hashes, UUIDs
  const classes = charClasses(token.replace(/[-_]/g, ''))
  return classes >= 3 && entropy(token) > 3.5
}

const ipv4Ok = (ip: string) => ip.split('.').every((o) => Number(o) <= 255 && !/^0\d/.test(o))

const RULES: Rule[] = [
  // ---- secrets in well-known formats
  {
    kind: 'SECRET',
    label: 'private key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
  },
  { kind: 'SECRET', label: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    kind: 'SECRET',
    label: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g
  },
  { kind: 'SECRET', label: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'SECRET', label: 'API key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'SECRET', label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    kind: 'SECRET',
    label: 'JSON web token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
  },
  {
    kind: 'SECRET',
    label: 'password in URL',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:([^\s/@]+)@/dgi,
    group: 1
  },
  {
    kind: 'SECRET',
    label: 'token in URL',
    pattern:
      /[?&](?:access_token|token|api_?key|key|secret|password|sig|signature|auth|code)=([^&\s#]{6,})/dgi,
    group: 1
  },
  {
    kind: 'SECRET',
    label: 'password',
    pattern:
      /\b(?:password|passwort|passwd|pwd|pass|secret|token|api[_-]?key|kennwort)\b\s*(?:is|ist|[:=])\s*["']?([^\s"',;]{4,})/dgi,
    group: 1
  },
  // ---- contact and network
  {
    kind: 'EMAIL',
    label: 'email',
    pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu
  },
  {
    kind: 'IP',
    label: 'IP address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    accept: ipv4Ok
  },
  {
    kind: 'IP',
    label: 'IP address',
    pattern: /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi,
    accept: (s) => /[a-f]/i.test(s) || s.split(':').length >= 5
  },
  // ---- money
  {
    kind: 'IBAN',
    label: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g
    // shrunk to the longest valid prefix in `detectRules`
  },
  {
    kind: 'CARD',
    label: 'card number',
    pattern: /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g,
    accept: (s) => validateValue('cardNumber', s) === undefined && !/^(\d)\1+$/.test(digits(s))
  },
  {
    kind: 'PHONE',
    label: 'phone number',
    pattern:
      /(?<![\w+])(?:\+|00)[1-9]\d{0,2}[\s./-]?(?:\(\d{1,5}\)[\s./-]?)?\d[\d\s./-]{5,16}\d(?!\d)/g,
    accept: (s) => digits(s).length >= 8 && digits(s).length <= 15
  },
  {
    kind: 'PHONE',
    label: 'phone number',
    pattern: /(?<![\w.+])\(?0\d{2,5}\)?[\s/-]?\d{3,}(?:[\s-]\d{2,})*(?!\w|\.\d)/g,
    accept: (s) => digits(s).length >= 7 && digits(s).length <= 13
  }
]

/** Shrink an IBAN candidate (which may swallow a following word) to its valid prefix. */
function validIbanPrefix(candidate: string): string | undefined {
  const parts = candidate.split(' ')
  for (let n = parts.length; n >= 1; n--) {
    const s = parts.slice(0, n).join(' ')
    if (s.replace(/ /g, '').length >= 15 && validateValue('iban', s) === undefined) return s
  }
  return undefined
}

/** Structured PII and secrets found by pattern. Spans may overlap; `mergeSpans` resolves. */
export function detectRules(text: string): Span[] {
  const spans: Span[] = []
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.pattern)) {
      let start = m.index
      let value = m[0]
      if (rule.group !== undefined) {
        const idx = m.indices?.[rule.group]
        if (!idx) continue
        start = idx[0]
        value = m[rule.group]
      }
      if (rule.kind === 'IBAN') {
        const valid = validIbanPrefix(value)
        if (!valid) continue
        value = valid
      }
      if (rule.accept && !rule.accept(value)) continue
      spans.push({
        start,
        end: start + value.length,
        kind: rule.kind,
        label: rule.label,
        source: 'rule'
      })
    }
  }

  // Anything else that looks generated (tokens, keys, passwords) — outside what we already have.
  for (const m of text.matchAll(/[A-Za-z0-9+/_=!@#$%^&*.-]{20,}/g)) {
    const token = m[0].replace(/[.,;:!]+$/, '')
    if (!looksLikeSecret(token)) continue
    const start = m.index
    if (spans.some((s) => s.start < start + token.length && start < s.end)) continue
    spans.push({
      start,
      end: start + token.length,
      kind: 'SECRET',
      label: 'secret-looking token',
      source: 'rule'
    })
  }
  return spans
}
