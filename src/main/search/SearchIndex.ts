import { lexicalDoc, lexicalScore, tokenize, type LexicalDoc } from './lexical'
import { passageText, type SearchDocument } from './document'
import type { SearchHit } from './protocol'

export interface Embedder {
  /** Unit-length vectors, one per text. */
  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>
}

/**
 * Semantic hits must stand out from the rest of the vault: e5 similarities are
 * compressed (roughly 0.78–0.88), so an absolute cut-off does not work. A hit
 * must be close to the best one and clearly above the vault's median.
 */
export const SEMANTIC = {
  /** Within this much of the best similarity. */
  nearBest: 0.02,
  /** At least this much above the median similarity. */
  aboveMedian: 0.015,
  /** Small vaults have no meaningful median: fall back to an absolute floor. */
  minDocsForMedian: 5,
  absoluteFloor: 0.84,
  maxHits: 8,
  minQueryLength: 3
}

const BATCH = 16
const QUERY_CACHE = 50

interface Indexed {
  doc: SearchDocument
  lex: LexicalDoc
  text: string
}

export const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * Search over the open vault: lexical scoring always, plus embedding similarity
 * once an embedder is attached. Vectors live only in memory.
 */
export class SearchIndex {
  private docs = new Map<string, Indexed>()
  private vectors = new Map<string, { text: string; vec: Float32Array }>()
  private queryCache = new Map<string, Promise<Float32Array>>()
  private embedder: Embedder | undefined
  private generation = 0
  private indexing: Promise<void> | undefined

  constructor(private onProgress: (done: number, total: number) => void = () => {}) {}

  get indexedCount(): number {
    return this.vectors.size
  }

  get pendingCount(): number {
    let n = 0
    for (const [uuid, d] of this.docs) if (this.vectors.get(uuid)?.text !== d.text) n++
    return n
  }

  setDocuments(docs: SearchDocument[]): Promise<void> {
    const next = new Map<string, Indexed>()
    for (const doc of docs)
      next.set(doc.uuid, { doc, lex: lexicalDoc(doc), text: passageText(doc) })
    this.docs = next
    for (const uuid of [...this.vectors.keys()]) if (!next.has(uuid)) this.vectors.delete(uuid)
    return this.reindex()
  }

  setEmbedder(embedder: Embedder | undefined): Promise<void> {
    this.embedder = embedder
    this.generation++
    this.vectors.clear()
    this.queryCache.clear()
    return this.reindex()
  }

  /** Forget everything (vault locked). Cancels indexing in flight. */
  clear() {
    this.generation++
    this.docs.clear()
    this.vectors.clear()
    this.queryCache.clear()
  }

  /** Resolves once every current document has a vector (or immediately without an embedder). */
  whenIndexed(): Promise<void> {
    return this.indexing ?? Promise.resolve()
  }

  private reindex(): Promise<void> {
    if (!this.embedder) return Promise.resolve()
    if (!this.indexing) {
      this.indexing = this.indexPending().finally(() => (this.indexing = undefined))
    }
    return this.indexing
  }

  private async indexPending() {
    const gen = this.generation
    // Loop: documents may change while a batch is being embedded.
    for (;;) {
      const embedder = this.embedder
      const todo = [...this.docs.values()].filter(
        (d) => this.vectors.get(d.doc.uuid)?.text !== d.text
      )
      if (!embedder || !todo.length) return
      const total = todo.length
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH)
        const vecs = await embedder.embed(
          batch.map((d) => d.text),
          'passage'
        )
        if (gen !== this.generation) return
        batch.forEach((d, j) => this.vectors.set(d.doc.uuid, { text: d.text, vec: vecs[j] }))
        this.onProgress(Math.min(i + BATCH, total), total)
      }
    }
  }

  async search(query: string): Promise<SearchHit[]> {
    const q = query.trim()
    if (!q) return []
    const hits: SearchHit[] = []
    const lexical = new Set<string>()
    for (const { lex } of this.docs.values()) {
      const score = lexicalScore(lex, q)
      if (score > 0) {
        hits.push({ uuid: lex.uuid, score, match: 'text' })
        lexical.add(lex.uuid)
      }
    }
    hits.sort((a, b) => b.score - a.score)

    const semantic = await this.semantic(q)
    for (const hit of semantic) if (!lexical.has(hit.uuid)) hits.push(hit)
    return hits
  }

  /**
   * The query's embedding, cached (and shared while in flight), so vault search and
   * type suggestions for the same keystroke embed it once. Undefined without a model
   * or for queries too short to mean anything.
   */
  async queryVector(query: string): Promise<Float32Array | undefined> {
    const q = query.trim()
    const embedder = this.embedder
    if (!embedder || q.length < SEMANTIC.minQueryLength || !tokenize(q).length) return undefined
    const gen = this.generation
    let pending = this.queryCache.get(q)
    if (!pending) {
      pending = embedder.embed([q], 'query').then(([v]) => v)
      this.queryCache.set(q, pending)
      pending.catch(() => this.queryCache.get(q) === pending && this.queryCache.delete(q))
      if (this.queryCache.size > QUERY_CACHE) {
        this.queryCache.delete(this.queryCache.keys().next().value!)
      }
    }
    const qv = await pending
    return gen === this.generation ? qv : undefined
  }

  private async semantic(q: string): Promise<SearchHit[]> {
    if (!this.vectors.size) return []
    const qv = await this.queryVector(q)
    if (!qv) return []

    const sims: { uuid: string; sim: number }[] = []
    for (const [uuid, { vec }] of this.vectors) {
      if (this.docs.has(uuid)) sims.push({ uuid, sim: dot(qv, vec) })
    }
    if (!sims.length) return []
    sims.sort((a, b) => b.sim - a.sim)
    const best = sims[0].sim
    const floor =
      sims.length >= SEMANTIC.minDocsForMedian
        ? sims[Math.floor(sims.length / 2)].sim + SEMANTIC.aboveMedian
        : SEMANTIC.absoluteFloor
    return sims
      .filter((s) => s.sim >= floor && s.sim >= best - SEMANTIC.nearBest)
      .slice(0, SEMANTIC.maxHits)
      .map((s) => ({ uuid: s.uuid, score: s.sim, match: 'semantic' as const }))
  }
}
