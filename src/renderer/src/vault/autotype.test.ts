import { describe, expect, it } from 'vitest'
import type { VaultEntrySummary } from '../../../main/vault/protocol'
import { acceleratorFromEvent, formatAccelerator, suggestEntries } from './autotype'

const entry = (title: string, url = ''): VaultEntrySummary => ({
  uuid: title,
  groupUuid: 'g',
  title,
  username: '',
  url,
  tags: [],
  icon: undefined,
  hasPassword: true,
  hasOtp: false,
  attachmentCount: 0,
  inRecycleBin: false,
  modified: undefined
})

describe('suggestEntries', () => {
  const entries = [
    entry('GitHub', 'https://github.com/login'),
    entry('Work mail', 'https://accounts.google.com'),
    entry('Slack')
  ]

  it('matches the window title against entry titles and site names', () => {
    expect(suggestEntries(entries, 'Sign in – Google Accounts — Mozilla Firefox')).toEqual([
      entries[1]
    ])
    expect(suggestEntries(entries, 'Slack').map((e) => e.title)).toEqual(['Slack'])
    expect(suggestEntries(entries, 'GitHub · Where software is built').length).toBe(1)
  })

  it('suggests nothing without a target', () => {
    expect(suggestEntries(entries, undefined)).toEqual([])
    expect(suggestEntries(entries, '  ')).toEqual([])
  })
})

describe('acceleratorFromEvent', () => {
  const ev = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) => ({
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  })

  it('maps ⌘ to CommandOrControl on macOS and Ctrl elsewhere', () => {
    expect(acceleratorFromEvent(ev(' ', 'Space', { metaKey: true, shiftKey: true }), true)).toBe(
      'CommandOrControl+Shift+Space'
    )
    expect(acceleratorFromEvent(ev('p', 'KeyP', { ctrlKey: true, altKey: true }), false)).toBe(
      'CommandOrControl+Alt+P'
    )
  })

  it('uses the physical key when Option changes the character', () => {
    expect(acceleratorFromEvent(ev('å', 'KeyA', { metaKey: true, altKey: true }), true)).toBe(
      'CommandOrControl+Alt+A'
    )
  })

  it('needs a real modifier and a non-modifier key', () => {
    expect(acceleratorFromEvent(ev('Shift', 'ShiftLeft', { shiftKey: true }), true)).toBeUndefined()
    expect(acceleratorFromEvent(ev('A', 'KeyA', { shiftKey: true }), true)).toBeUndefined()
    expect(acceleratorFromEvent(ev('a', 'KeyA'), true)).toBeUndefined()
  })
})

it('formats accelerators per platform', () => {
  expect(formatAccelerator('CommandOrControl+Alt+Shift+K', true)).toBe('⌘⌥⇧K')
  expect(formatAccelerator('CommandOrControl+Alt+Shift+K', false)).toBe('Ctrl+Alt+Shift+K')
})
