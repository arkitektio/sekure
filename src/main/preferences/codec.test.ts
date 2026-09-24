import { describe, expect, it } from 'vitest'
import { decodePreferences, encodePreferences, sanitizeBrand } from './codec'

describe('preferences codec', () => {
  it('round-trips brand and auto-type settings', () => {
    const prefs = {
      brand: { hue: 145, chroma: 0.18 },
      autotype: { enabled: true, shortcut: 'CommandOrControl+Alt+Shift+K' }
    }
    expect(decodePreferences(encodePreferences(prefs))).toEqual(prefs)
  })

  it('keeps an explicit reset (brand: null) apart from "no opinion"', () => {
    expect(decodePreferences('{"brand":null}')).toEqual({ brand: null })
    expect(decodePreferences('{"v":1}')).toEqual({})
  })

  it('drops malformed fields instead of failing', () => {
    expect(
      decodePreferences(
        JSON.stringify({
          brand: { hue: 'red' },
          autotype: { enabled: 'yes', shortcut: 'x'.repeat(100) }
        })
      )
    ).toEqual({})
    expect(decodePreferences('not json')).toBeUndefined()
    expect(decodePreferences(undefined)).toBeUndefined()
  })

  it('wraps the hue and clamps the chroma', () => {
    expect(sanitizeBrand({ hue: -30, chroma: 2 })).toEqual({ hue: 330, chroma: 0.4 })
    expect(sanitizeBrand({ hue: Number.NaN, chroma: 0.1 })).toBeUndefined()
  })
})
