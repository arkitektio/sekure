import { describe, expect, it, vi } from 'vitest'
import { SearchIndex, type Embedder } from './SearchIndex'
import type { SearchDocument } from './document'

const doc = (uuid: string, title: string, extra: Partial<SearchDocument> = {}): SearchDocument => ({
  uuid,
  title,
  type: '',
  tags: [],
  group: '',
  host: '',
  url: '',
  username: '',
  subtitle: '',
  fieldNames: [],
  notes: '',
  inRecycleBin: false,
  ...extra
})

/** Fake model: a text's vector is picked by the first concept word it contains. */
const CONCEPTS: Record<string, number[]> = {
  travel: [1, 0, 0],
  passport: [1, 0, 0],
  money: [0, 1, 0],
  bank: [0, 1, 0],
  mail: [0, 0, 1]
}
function fakeEmbedder() {
  const embed = vi.fn(async (texts: string[], _kind: 'query' | 'passage') =>
    texts.map((t) => {
      const key = Object.keys(CONCEPTS).find((k) => t.toLowerCase().includes(k))
      const v = key ? CONCEPTS[key] : [0.5, 0.5, 0.5]
      const n = Math.hypot(...v)
      return Float32Array.from(v.map((x) => x / n))
    })
  )
  return { embed } satisfies Embedder
}

const vault = [
  doc('p', 'Jane Doe', { type: 'Passport' }),
  doc('b', 'Sparkasse', { type: 'Bank account' }),
  doc('g', 'Gmail'),
  doc('h', 'Hotmail'),
  doc('x', 'Something else'),
  doc('y', 'Another thing')
]

describe('SearchIndex', () => {
  it('searches lexically without an embedder', async () => {
    const index = new SearchIndex()
    await index.setDocuments(vault)
    const hits = await index.search('gmail')
    expect(hits.map((h) => h.uuid)).toEqual(['g'])
    expect(hits[0].match).toBe('text')
    expect(await index.search('travel')).toEqual([])
  })

  it('adds semantic hits after the lexical ones', async () => {
    const index = new SearchIndex()
    await index.setDocuments(vault)
    await index.setEmbedder(fakeEmbedder())

    const travel = await index.search('travel')
    expect(travel).toEqual([{ uuid: 'p', score: expect.any(Number), match: 'semantic' }])

    const mail = await index.search('mail')
    // Both are substring matches; nothing semantic-only left to add.
    expect(mail.map((h) => h.uuid).sort()).toEqual(['g', 'h'])
    expect(mail.every((h) => h.match === 'text')).toBe(true)
  })

  it('embeds only new or changed documents', async () => {
    const embedder = fakeEmbedder()
    const index = new SearchIndex()
    await index.setDocuments(vault)
    await index.setEmbedder(embedder)
    const passages = () =>
      embedder.embed.mock.calls.filter((c) => c[1] === 'passage').flatMap((c) => c[0]).length
    expect(passages()).toBe(vault.length)

    await index.setDocuments([
      ...vault.slice(1),
      doc('p', 'Jane Doe (renewed)', { type: 'Passport' })
    ])
    expect(passages()).toBe(vault.length + 1)
  })

  it('forgets vectors on clear and cancels indexing in flight', async () => {
    const index = new SearchIndex()
    await index.setEmbedder(fakeEmbedder())
    const pending = index.setDocuments(vault)
    index.clear()
    await pending
    expect(index.indexedCount).toBe(0)
    expect(await index.search('gmail')).toEqual([])
  })

  it('reports indexing progress', async () => {
    const progress = vi.fn()
    const index = new SearchIndex(progress)
    await index.setDocuments(vault)
    await index.setEmbedder(fakeEmbedder())
    expect(progress).toHaveBeenLastCalledWith(vault.length, vault.length)
  })
})
