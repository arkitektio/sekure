import type { SearchDocument } from './document'

/** Lowercase and strip accents, so `Führerschein` matches `fuhrerschein`. */
export const fold = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

export const tokenize = (s: string): string[] => fold(s).match(/[\p{L}\p{N}]+/gu) ?? []

/** Optimal string alignment distance, bailing out once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1)
      }
      cur[j] = v
      rowMin = Math.min(rowMin, v)
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

const typoBudget = (token: string) => (token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0)

interface IndexedField {
  weight: number
  text: string
  tokens: string[]
}

/** A document pre-processed for lexical matching. */
export interface LexicalDoc {
  uuid: string
  title: string
  fields: IndexedField[]
}

const WEIGHTS: [keyof SearchDocument, number][] = [
  ['title', 1],
  ['type', 0.8],
  ['typeKeywords', 0.6],
  ['tags', 0.8],
  ['host', 0.7],
  ['people', 0.7],
  ['username', 0.6],
  ['url', 0.6],
  ['group', 0.5],
  ['subtitle', 0.5],
  ['fieldNames', 0.5],
  ['notes', 0.3]
]

export function lexicalDoc(d: SearchDocument): LexicalDoc {
  const fields: IndexedField[] = []
  for (const [key, weight] of WEIGHTS) {
    const raw = d[key]
    const text = fold(Array.isArray(raw) ? raw.join(' ') : String(raw ?? ''))
    if (text) fields.push({ weight, text, tokens: tokenize(text) })
  }
  return { uuid: d.uuid, title: fold(d.title).trim(), fields }
}

/** How well one query token matches one field, 0–1. */
function tokenMatch(q: string, field: IndexedField): number {
  let best = 0
  const budget = typoBudget(q)
  for (const t of field.tokens) {
    if (t === q) return 1
    if (t.startsWith(q)) best = Math.max(best, 0.8)
    else if (budget && best < 0.5) {
      // Compare against the whole token and against its prefix (typo while still typing).
      const d = Math.min(
        editDistance(q, t, budget),
        t.length > q.length ? editDistance(q, t.slice(0, q.length), budget) : budget + 1
      )
      if (d <= budget) best = Math.max(best, 0.5)
    }
  }
  if (best < 0.6 && field.text.includes(q)) best = 0.6
  return best
}

/**
 * 0 when some query word matches nothing (every word must match, as before), else
 * the mean over query words of their best weighted match, with a bonus for an
 * exact title.
 */
export function lexicalScore(doc: LexicalDoc, query: string): number {
  const tokens = tokenize(query)
  if (!tokens.length) return 0
  let total = 0
  for (const q of tokens) {
    let best = 0
    for (const f of doc.fields) best = Math.max(best, tokenMatch(q, f) * f.weight)
    if (best === 0) return 0
    total += best
  }
  const score = total / tokens.length
  return doc.title === fold(query).trim() ? score + 0.5 : score
}
