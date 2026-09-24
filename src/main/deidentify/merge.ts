import type { SpanSource } from './protocol'
import type { Span } from './span'

const PRIORITY: Record<SpanSource, number> = { vault: 3, manual: 2, rule: 2, model: 1 }

const TRIM = /^[\s.,;:!?'"()[\]{}<>-]+|[\s.,;:!?'"()[\]{}<>-]+$/g

/** Cut `span` so it no longer overlaps `taken`; keep the larger remaining piece, trimmed. */
function subtract(span: Span, taken: Span[], text: string): Span | undefined {
  if (!taken.some((t) => t.start < span.end && span.start < t.end)) return span
  let pieces: [number, number][] = [[span.start, span.end]]
  for (const t of taken) {
    pieces = pieces.flatMap(([a, b]) => {
      if (t.end <= a || t.start >= b) return [[a, b] as [number, number]]
      const out: [number, number][] = []
      if (t.start > a) out.push([a, t.start])
      if (t.end < b) out.push([t.end, b])
      return out
    })
  }
  let best: [number, number] | undefined
  for (const [a, b] of pieces) {
    const raw = text.slice(a, b)
    const lead = raw.length - raw.replace(/^[\s.,;:!?'"()[\]{}<>-]+/, '').length
    const trimmed = raw.replace(TRIM, '')
    if (trimmed.length < 2) continue
    const piece: [number, number] = [a + lead, a + lead + trimmed.length]
    if (!best || piece[1] - piece[0] > best[1] - best[0]) best = piece
  }
  return best && { ...span, start: best[0], end: best[1] }
}

/**
 * Non-overlapping spans, in text order. On overlap the stronger source wins
 * (vault credential > rule/manual > model), then the longer span; a weaker span
 * keeps whatever part of it is left over.
 */
export function mergeSpans(text: string, spans: Span[]): Span[] {
  const ordered = [...spans].sort(
    (a, b) =>
      PRIORITY[b.source] - PRIORITY[a.source] ||
      b.end - b.start - (a.end - a.start) ||
      (b.score ?? 0) - (a.score ?? 0)
  )
  const taken: Span[] = []
  for (const span of ordered) {
    if (span.end <= span.start) continue
    const rest = subtract(span, taken, text)
    if (rest) taken.push(rest)
  }
  return taken.sort((a, b) => a.start - b.start)
}
