import { describe, expect, it } from 'vitest'
import { GROUP_ICONS, TYPE_ICONS } from './icons'
import { ENTRY_TYPE_GROUPS, ENTRY_TYPES } from '../../../main/vault/entryTypes'

describe('icons', () => {
  it('has an icon for every entry type and group', () => {
    for (const t of ENTRY_TYPES) expect(TYPE_ICONS[t.id], t.id).toBeDefined()
    for (const g of ENTRY_TYPE_GROUPS) expect(GROUP_ICONS[g.id], g.id).toBeDefined()
  })
})
