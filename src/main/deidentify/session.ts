import type { DeidentifyDecision, DeidentifyMode, ReviewSegment } from './protocol'
import type { PlaceholderMap } from './placeholders'
import type { Span } from './span'
import { mergeSpans } from './merge'

interface Piece {
  start: number
  end: number
  span?: Span & { id: string }
}

/**
 * One captured selection under review. Holds the raw text (which may contain a
 * vault credential), so it stays in main; `segments()` is what the popup sees.
 */
export class DeidentifySession {
  private pieces: Piece[] = []

  constructor(
    readonly id: number,
    readonly raw: string,
    readonly mode: DeidentifyMode,
    spans: Span[]
  ) {
    this.setSpans(spans)
  }

  setSpans(spans: Span[]) {
    const merged = mergeSpans(this.raw, spans)
    const pieces: Piece[] = []
    let at = 0
    for (const span of merged) {
      if (span.start > at) pieces.push({ start: at, end: span.start })
      // Stable across re-detection (the model finishing later), so toggles survive.
      const id = `${span.start}-${span.end}-${span.kind}`
      pieces.push({ start: span.start, end: span.end, span: { ...span, id } })
      at = span.end
    }
    if (at < this.raw.length) pieces.push({ start: at, end: this.raw.length })
    this.pieces = pieces
  }

  get spanCount() {
    return this.pieces.filter((p) => p.span).length
  }

  /** The review view. Vault credentials go out without their text. */
  segments(): ReviewSegment[] {
    return this.pieces.map((p): ReviewSegment => {
      if (!p.span) return { type: 'text', text: this.raw.slice(p.start, p.end) }
      const locked = p.span.source === 'vault'
      return {
        type: 'span',
        id: p.span.id,
        kind: p.span.kind,
        label: p.span.label,
        text: locked ? undefined : this.raw.slice(p.start, p.end),
        locked,
        enabled: true,
        source: p.span.source
      }
    })
  }

  /**
   * Build the output. Deidentify: enabled spans (and every vault credential) become
   * placeholders. Re-identify: enabled placeholder spans become their originals.
   */
  apply(decision: DeidentifyDecision, map: PlaceholderMap): { text: string; replaced: number } {
    const enabled = new Set(decision.enabled)
    // Manual marks are offsets into plain-text segments; split those pieces.
    const manual = new Map<number, { start: number; end: number }[]>()
    for (const m of decision.manual) {
      const piece = this.pieces[m.segment]
      if (!piece || piece.span || m.start < 0 || m.end <= m.start) continue
      const len = piece.end - piece.start
      if (m.end > len) continue
      manual.set(m.segment, [...(manual.get(m.segment) ?? []), { start: m.start, end: m.end }])
    }

    let out = ''
    let replaced = 0
    this.pieces.forEach((p, i) => {
      const text = this.raw.slice(p.start, p.end)
      if (!p.span) {
        const marks = (manual.get(i) ?? []).sort((a, b) => a.start - b.start)
        let at = 0
        for (const mark of marks) {
          if (mark.start < at) continue
          out += text.slice(at, mark.start)
          const original = text.slice(mark.start, mark.end)
          out += this.mode === 'deidentify' ? map.placeholderFor('OTHER', original) : original
          if (this.mode === 'deidentify') replaced++
          at = mark.end
        }
        out += text.slice(at)
        return
      }
      const on = p.span.source === 'vault' || enabled.has(p.span.id)
      if (!on) {
        out += text
      } else if (this.mode === 'deidentify') {
        out += map.placeholderFor(p.span.kind, text)
        replaced++
      } else if (p.span.source === 'vault') {
        out += map.placeholderFor('CREDENTIAL', text)
      } else {
        const original = map.original(text)
        out += original ?? text
        if (original !== undefined) replaced++
      }
    })
    return { text: out, replaced }
  }
}

/** Spans for re-identify mode: the known placeholders in `text`. */
export function placeholderSpans(text: string, map: PlaceholderMap): Span[] {
  return map.find(text).map((hit) => ({
    start: hit.start,
    end: hit.end,
    kind: hit.kind,
    label: hit.original,
    source: 'rule' as const
  }))
}
