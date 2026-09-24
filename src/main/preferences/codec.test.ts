import { describe, expect, it } from 'vitest'
import { decodePreferences, encodePreferences, isSafeGlobalShortcut, sanitizeBrand } from './codec'

describe('preferences codec', () => {
  it('round-trips brand and the auto-type shortcut', () => {
    const prefs = {
      brand: { hue: 145, chroma: 0.18 },
      autotype: { shortcut: 'CommandOrControl+Alt+Shift+K' }
    }
    expect(decodePreferences(encodePreferences(prefs))).toEqual(prefs)
  })

  it('never imports whether auto-type is enabled', () => {
    expect(
      decodePreferences(JSON.stringify({ autotype: { enabled: true, shortcut: 'Ctrl+Alt+K' } }))
    ).toEqual({ autotype: { shortcut: 'Ctrl+Alt+K' } })
    expect(decodePreferences(JSON.stringify({ autotype: { enabled: true } }))).toEqual({})
  })

  it('drops shortcuts that would hijack common keys', () => {
    for (const bad of [
      'CommandOrControl+V',
      'Cmd+C',
      'Ctrl+Q',
      'Enter',
      'Shift+A',
      'Alt+Shift+K',
      'CommandOrControl+Tab',
      'Ctrl++',
      'Ctrl+K+L',
      'Ctrl+Ctrl+K'
    ]) {
      expect(isSafeGlobalShortcut(bad), bad).toBe(false)
      expect(decodePreferences(JSON.stringify({ autotype: { shortcut: bad } })), bad).toEqual({})
    }
    for (const good of [
      'CommandOrControl+Alt+Shift+K',
      'Ctrl+Alt+V',
      'Cmd+Shift+Space',
      'Super+K'
    ]) {
      expect(isSafeGlobalShortcut(good), good).toBe(true)
    }
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
