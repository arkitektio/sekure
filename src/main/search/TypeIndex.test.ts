import { describe, expect, it, vi } from 'vitest'
import { TypeIndex } from './TypeIndex'
import { ENTRY_TYPES } from '../vault/entryTypes'

const unit = (v: number[]) => {
  const n = Math.hypot(...v)
  return Float32Array.from(v.map((x) => x / n))
}

/** Fake model: passages mentioning a concept point that way; everything else is neutral. */
const CONCEPTS: [string, number[]][] = [
  ['krankenkasse', [1, 0, 0]],
  ['seed phrase', [0, 1, 0]]
]
const fake = () => ({
  embed: vi.fn(async (texts: string[]) =>
    texts.map((t) =>
      unit(CONCEPTS.find(([k]) => t.toLowerCase().includes(k))?.[1] ?? [0.1, 0.1, 1])
    )
  )
})

describe('TypeIndex', () => {
  it('embeds every type once, from registry text only', async () => {
    const embedder = fake()
    const index = new TypeIndex()
    await index.setEmbedder(embedder)
    expect(embedder.embed).toHaveBeenCalledTimes(1)
    expect(embedder.embed.mock.calls[0][0]).toHaveLength(ENTRY_TYPES.length)
    expect(embedder.embed.mock.calls[0][0][0]).toContain('Login')
    expect(index.ready).toBe(true)
  })

  it('suggests only types that stand out', async () => {
    const index = new TypeIndex()
    await index.setEmbedder(fake())
    expect(index.suggest(unit([1, 0, 0])).map((s) => s.typeId)).toEqual(['healthInsurance'])
    expect(index.suggest(unit([0, 1, 0])).map((s) => s.typeId)).toEqual(['cryptoWallet'])
    // A query like every other type: nothing stands out.
    expect(index.suggest(unit([0.1, 0.1, 1]))).toEqual([])
  })

  it('forgets the vectors with the model', async () => {
    const index = new TypeIndex()
    await index.setEmbedder(fake())
    await index.setEmbedder(undefined)
    expect(index.ready).toBe(false)
    expect(index.suggest(unit([1, 0, 0]))).toEqual([])
  })
})
