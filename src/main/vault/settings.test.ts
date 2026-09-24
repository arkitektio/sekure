import { describe, expect, it } from 'vitest'
import { applySettingsPatch, DEFAULT_VAULT_SETTINGS } from './settings'
import { exportDefaultPath } from './exportPath'

describe('applySettingsPatch', () => {
  it('applies valid values', () => {
    expect(
      applySettingsPatch(DEFAULT_VAULT_SETTINGS, { autoLockMinutes: 5, lockOnSleep: false })
    ).toEqual({ autoLockMinutes: 5, lockOnSleep: false })
    expect(applySettingsPatch(DEFAULT_VAULT_SETTINGS, { autoLockMinutes: 0 }).autoLockMinutes).toBe(
      0
    )
  })

  it('drops wrongly typed values and unknown keys', () => {
    const next = applySettingsPatch(DEFAULT_VAULT_SETTINGS, {
      autoLockMinutes: '1',
      lockOnSleep: 'no',
      __proto__: { polluted: true },
      extra: 1
    })
    expect(next).toEqual(DEFAULT_VAULT_SETTINGS)
    for (const autoLockMinutes of [-1, 2.5, 100_000, Number.NaN]) {
      expect(applySettingsPatch(DEFAULT_VAULT_SETTINGS, { autoLockMinutes })).toEqual(
        DEFAULT_VAULT_SETTINGS
      )
    }
    expect(applySettingsPatch(DEFAULT_VAULT_SETTINGS, null)).toEqual(DEFAULT_VAULT_SETTINGS)
  })
})

describe('exportDefaultPath', () => {
  it('keeps a plain name in Downloads', () => {
    expect(exportDefaultPath('/Users/me/Downloads', 'passport.pdf')).toBe(
      '/Users/me/Downloads/passport.pdf'
    )
  })

  it('never lets a vault-supplied name leave Downloads', () => {
    for (const name of [
      '../../Library/LaunchAgents/x.plist',
      '/etc/passwd',
      '..\\..\\AppData\\evil.lnk',
      '..',
      ''
    ]) {
      const path = exportDefaultPath('/Users/me/Downloads', name)
      expect(path.startsWith('/Users/me/Downloads/'), name).toBe(true)
      expect(path.slice('/Users/me/Downloads/'.length), name).not.toMatch(/[/\\]|^\.\.?$/)
    }
  })
})
