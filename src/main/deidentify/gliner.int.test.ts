// Runs the real model. Opt-in: SEKURE_GLINER_DIR=<folder with the GLINER_MODEL files> pnpm test
import { beforeAll, describe, expect, it } from 'vitest'
import { loadGliner, splitWords, type Gliner } from './gliner'

const dir = process.env.SEKURE_GLINER_DIR

describe('splitWords', () => {
  it('keeps emails, dotted tokens and umlauts together', () => {
    expect(splitWords('Hauptstraße 5, jane.doe@x.com!').map((w) => w.text)).toEqual([
      'Hauptstraße',
      '5',
      ',',
      'jane.doe@x.com',
      '!'
    ])
  })
})

describe.skipIf(!dir)('GLiNER multi-PII', () => {
  let model: Gliner
  beforeAll(async () => {
    model = await loadGliner({ modelDir: dir! })
  }, 120_000)

  const found = async (text: string) =>
    (await model.predict(text)).map((s) => [s.kind, text.slice(s.start, s.end)])

  it('finds PII in English', async () => {
    const text =
      "Hi, I'm Jane Doe from Acme GmbH, reach me at +49 170 1234567. I live at Hauptstraße 5, 10115 Berlin."
    const spans = await found(text)
    expect(spans).toContainEqual(['PERSON', 'Jane Doe'])
    expect(spans).toContainEqual(['ORG', 'Acme GmbH'])
    expect(spans).toContainEqual(['PHONE', '+49 170 1234567'])
    expect(spans).toContainEqual(['ADDRESS', 'Hauptstraße 5, 10115 Berlin'])
  }, 30_000)

  it('finds PII in German', async () => {
    const text =
      'Sehr geehrter Herr Müller, bitte überweisen Sie an Klaus Schmidt, Sparkasse Köln. Meine Passnummer ist C01X00T47.'
    const spans = await found(text)
    expect(spans).toContainEqual(['PERSON', 'Klaus Schmidt'])
    expect(spans).toContainEqual(['ORG', 'Sparkasse Köln'])
    expect(spans).toContainEqual(['ID', 'C01X00T47'])
  }, 30_000)

  it('handles text longer than one window', async () => {
    const filler = 'Nothing to see here. '.repeat(60)
    const text = `${filler}Contact Jane Doe tomorrow. ${filler}`
    expect(await found(text)).toContainEqual(['PERSON', 'Jane Doe'])
  }, 60_000)

  it('leaves plain text alone', async () => {
    expect(await found('The build passed and the release notes are ready.')).toEqual([])
  }, 30_000)
})
