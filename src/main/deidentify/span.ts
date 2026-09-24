import type { SpanKind, SpanSource } from './protocol'

/** A detected span in the raw text (main only: may cover a vault credential). */
export interface Span {
  start: number
  end: number
  kind: SpanKind
  /** What was detected, shown in the review (`email`, `Gmail / Password`). */
  label: string
  source: SpanSource
  score?: number
}

/** Kinds whose originals are never kept for re-identification. */
export const IRREVERSIBLE: ReadonlySet<SpanKind> = new Set(['CREDENTIAL', 'SECRET'])
