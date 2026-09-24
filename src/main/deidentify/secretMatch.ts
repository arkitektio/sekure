/** A vault secret to look for. Only ever built and used inside main. */
export interface KnownSecret {
  value: string
  entry: string
  field: string
  /** Base32 OTP seeds are case-insensitive. */
  ignoreCase?: boolean
}

export interface SecretHit {
  start: number
  end: number
  entry: string
  field: string
}

const MIN_LENGTH = 4
const MIN_DIGITS = 3
const MIN_COMPACT = 8
const MIN_LINE = 20
const SEPARATORS = /[\s-]/

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function allIndexes(hay: string, needle: string): number[] {
  const out: number[] = []
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) out.push(i)
  return out
}

/**
 * Where vault secrets occur in `text`. Matches, per secret:
 * - the exact value (4+ characters);
 * - numeric secrets such as PINs and CVVs (3+ digits) only as a whole number;
 * - the value with spaces and dashes ignored (card numbers, IBANs typed differently);
 * - each long line of a multi-line secret (a pasted part of a private key).
 * Returns positions and names only, never values.
 */
export function findSecretSpans(text: string, secrets: KnownSecret[]): SecretHit[] {
  const hits: SecretHit[] = []
  const add = (start: number, end: number, s: KnownSecret) =>
    hits.push({ start, end, entry: s.entry, field: s.field })

  // Text with separators removed, and where each kept character came from.
  const compactMap: number[] = []
  let compact = ''
  for (let i = 0; i < text.length; i++) {
    if (SEPARATORS.test(text[i])) continue
    compact += text[i]
    compactMap.push(i)
  }
  const lower = text.toLowerCase()

  for (const s of secrets) {
    const value = s.value.trim()
    if (!value) continue

    if (/^\d+$/.test(value)) {
      if (value.length < MIN_DIGITS) continue
      for (const m of text.matchAll(new RegExp(`(?<!\\d)${escape(value)}(?!\\d)`, 'g'))) {
        add(m.index, m.index + value.length, s)
      }
      continue
    }
    if (value.length < MIN_LENGTH) continue

    const hay = s.ignoreCase ? lower : text
    const needle = s.ignoreCase ? value.toLowerCase() : value
    for (const i of allIndexes(hay, needle)) add(i, i + value.length, s)

    const compactValue = value.replace(/[\s-]/g, '')
    if (compactValue !== value && compactValue.length >= MIN_COMPACT) {
      for (const i of allIndexes(compact, compactValue)) {
        add(compactMap[i], compactMap[i + compactValue.length - 1] + 1, s)
      }
    }

    if (value.includes('\n')) {
      for (const line of value.split(/\r?\n/)) {
        const l = line.trim()
        if (l.length < MIN_LINE) continue
        for (const i of allIndexes(text, l)) add(i, i + l.length, s)
      }
    }
  }
  return hits
}
