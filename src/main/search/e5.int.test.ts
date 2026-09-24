// Runs the real model. Opt-in: SEKURE_MODEL_DIR=<folder with the MODEL files> pnpm test
import { beforeAll, describe, expect, it } from 'vitest'
import { loadE5 } from './e5'
import { MODEL } from './protocol'
import { SearchIndex, type Embedder } from './SearchIndex'
import { TypeIndex } from './TypeIndex'
import type { SearchDocument } from './document'

const dir = process.env.SEKURE_MODEL_DIR

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

const vault: SearchDocument[] = [
  doc('passport', 'Jane Doe', { type: 'Passport', fieldNames: ['Passport number', 'Nationality'] }),
  doc('license', 'Führerschein', { type: "Driver's license", fieldNames: ['License number'] }),
  doc('bank', 'Sparkasse', { type: 'Bank account', fieldNames: ['IBAN', 'BIC'] }),
  doc('gmail', 'Gmail', { host: 'google', username: 'jane@example.com' }),
  doc('wifi', 'Home', { type: 'Wi-Fi network', fieldNames: ['SSID'] }),
  doc('github', 'GitHub', { host: 'github', username: 'octo' }),
  doc('netflix', 'Netflix', { host: 'netflix' }),
  doc('aws', 'AWS', { type: 'API token', fieldNames: ['Scopes'] }),
  doc('amazon', 'Amazon', { host: 'amazon' }),
  doc('steam', 'Steam', { host: 'steampowered' })
]

describe.skipIf(!dir)('multilingual-e5-small', () => {
  let embedder: Embedder
  const index = new SearchIndex()
  beforeAll(async () => {
    // With `spec`, as the app loads it: every file must match its sha256 pin.
    embedder = await loadE5({ modelDir: dir!, spec: MODEL })
    await index.setDocuments(vault)
    await index.setEmbedder(embedder)
  }, 60_000)

  it('produces unit vectors', async () => {
    const [v] = await embedder.embed(['hello'], 'query')
    expect(v.length).toBe(384)
    expect(Math.hypot(...v)).toBeCloseTo(1, 4)
  })

  it.each([
    ['travel document', 'passport'],
    ['money', 'bank'],
    ['internet at home', 'wifi'],
    ['source code', 'github'],
    ['movies', 'netflix'],
    ['driving licence', 'license']
  ])('"%s" finds %s', async (query, expected) => {
    const hits = await index.search(query)
    const semantic = hits.filter((h) => h.match === 'semantic').map((h) => h.uuid)
    expect(semantic[0]).toBe(expected)
    expect(semantic.length).toBeLessThanOrEqual(3)
  })

  it('bridges languages', async () => {
    // German query, English type label: both identity documents may come up.
    const hits = await index.search('Reisepass')
    expect(hits.slice(0, 2).map((h) => h.uuid)).toContain('passport')
  })

  it('leaves exact matches to the lexical scorer', async () => {
    const hits = await index.search('github')
    expect(hits[0]).toMatchObject({ uuid: 'github', match: 'text' })
  })

  describe('type suggestions', () => {
    const types = new TypeIndex()
    beforeAll(() => types.setEmbedder(embedder), 60_000)

    const suggest = async (q: string) => {
      const qv = await index.queryVector(q)
      return qv ? types.suggest(qv).map((s) => s.typeId) : []
    }

    it.each([
      ['Krankenkasse', 'healthInsurance'],
      ['car insurance', 'insurancePolicy'],
      ['bitcoin seed', 'cryptoWallet'],
      ['Steuernummer', 'taxId'],
      ['gym', 'membership'],
      ['garage door', 'alarmCode'],
      ['Hausarzt', 'medicalInfo'],
      ['frequent flyer miles', 'loyaltyProgram'],
      ['license plate of my car', 'vehicle'],
      ['backup codes for github', 'recoveryCodes'],
      ['fritzbox admin', 'router'],
      ['postgres prod', 'database']
    ])('"%s" suggests %s', async (query, expected) => {
      const got = await suggest(query)
      expect(got).toContain(expected)
    })

    it.each(['amazon', 'steam', 'work'])('stays quiet for "%s"', async (query) => {
      expect(await suggest(query)).toEqual([])
    })
  })
})
