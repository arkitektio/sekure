import { ENTRY_TYPES, typePassage } from '../vault/entryTypes'
import { dot, type Embedder } from './SearchIndex'
import type { TypeSuggestion } from './protocol'

/**
 * Like `SEMANTIC`: e5 similarities are compressed, so a suggestion must stand out
 * from the median type and be close to the best one.
 */
export const TYPE_SEMANTIC = {
  nearBest: 0.015,
  // Tuned on the real model (e5.int.test.ts): real matches sit ≥ 0.04 above the median type.
  aboveMedian: 0.04,
  maxHits: 3
}

/**
 * Embeddings of the entry-type registry, for semantic “Add …” suggestions
 * (“Krankenkasse” → Health insurance). Built from registry text only, never vault
 * data, and dropped with the model.
 */
export class TypeIndex {
  private vectors: { typeId: string; vec: Float32Array }[] = []
  private generation = 0

  async setEmbedder(embedder: Embedder | undefined): Promise<void> {
    const gen = ++this.generation
    this.vectors = []
    if (!embedder) return
    const vecs = await embedder.embed(ENTRY_TYPES.map(typePassage), 'passage')
    if (gen === this.generation)
      this.vectors = ENTRY_TYPES.map((t, i) => ({ typeId: t.id, vec: vecs[i] }))
  }

  get ready(): boolean {
    return this.vectors.length > 0
  }

  suggest(queryVector: Float32Array): TypeSuggestion[] {
    if (!this.vectors.length) return []
    const sims = this.vectors
      .map(({ typeId, vec }) => ({ typeId, score: dot(queryVector, vec) }))
      .sort((a, b) => b.score - a.score)
    const best = sims[0].score
    const floor = sims[Math.floor(sims.length / 2)].score + TYPE_SEMANTIC.aboveMedian
    return sims
      .filter((s) => s.score >= floor && s.score >= best - TYPE_SEMANTIC.nearBest)
      .slice(0, TYPE_SEMANTIC.maxHits)
  }
}
