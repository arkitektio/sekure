import type { SpanKind } from './protocol'
import { IRREVERSIBLE } from './span'

const PLACEHOLDER = /\[([A-Z]+)_(\d+)\]/g

export interface PlaceholderHit {
  start: number
  end: number
  placeholder: string
  original: string
  kind: SpanKind
}

/**
 * Consistent placeholders: the same original of the same kind always becomes the
 * same `[PERSON_1]`, so a conversation stays readable and can be re-identified.
 * Credentials and secrets get a bare `[CREDENTIAL]` / `[SECRET]` and are never kept.
 * Lives in memory only.
 */
export class PlaceholderMap {
  private byOriginal = new Map<string, string>()
  private byPlaceholder = new Map<string, { original: string; kind: SpanKind }>()
  private counters = new Map<SpanKind, number>()
  lastUsed = 0

  get size() {
    return this.byPlaceholder.size
  }

  placeholderFor(kind: SpanKind, original: string, now = Date.now()): string {
    this.lastUsed = now
    if (IRREVERSIBLE.has(kind)) return `[${kind}]`
    const key = `${kind}\u0000${original}`
    let placeholder = this.byOriginal.get(key)
    if (!placeholder) {
      const n = (this.counters.get(kind) ?? 0) + 1
      this.counters.set(kind, n)
      placeholder = `[${kind}_${n}]`
      this.byOriginal.set(key, placeholder)
      this.byPlaceholder.set(placeholder, { original, kind })
    }
    return placeholder
  }

  /** Known placeholders in `text`, in order. */
  find(text: string): PlaceholderHit[] {
    const out: PlaceholderHit[] = []
    for (const m of text.matchAll(PLACEHOLDER)) {
      const hit = this.byPlaceholder.get(m[0])
      if (hit) out.push({ start: m.index, end: m.index + m[0].length, placeholder: m[0], ...hit })
    }
    return out
  }

  original(placeholder: string, now = Date.now()): string | undefined {
    const hit = this.byPlaceholder.get(placeholder)
    if (hit) this.lastUsed = now
    return hit?.original
  }

  clear() {
    this.byOriginal.clear()
    this.byPlaceholder.clear()
    this.counters.clear()
    this.lastUsed = 0
  }
}
