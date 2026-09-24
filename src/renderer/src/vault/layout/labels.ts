import { ALL_ENTRIES, typeFilter } from '@/stores/vault'
import { entryTitle } from '@/lib/api'
import { getType } from '../../../../main/vault/entryTypes'
import type { VaultGroupNode, VaultSnapshot } from '../../../../main/vault/protocol'
import type { Page } from '../tabs'
import { personFilter, personName } from '../people'

export function findGroup(root: VaultGroupNode, uuid: string): VaultGroupNode | undefined {
  if (root.uuid === uuid) return root
  for (const g of root.groups) {
    const found = findGroup(g, uuid)
    if (found) return found
  }
  return undefined
}

/** Group names from the root down to `uuid` (root itself left out). */
export function groupPath(root: VaultGroupNode, uuid: string): VaultGroupNode[] {
  if (root.uuid === uuid) return []
  for (const g of root.groups) {
    if (g.uuid === uuid) return [g]
    const below = groupPath(g, uuid)
    if (below.length) return [g, ...below]
  }
  return []
}

export function scopeLabel(snapshot: VaultSnapshot | undefined, scope: string): string {
  if (scope === ALL_ENTRIES) return 'All entries'
  const person = personFilter(scope)
  if (person) {
    const p = snapshot?.entries.find((e) => e.uuid === person)
    return p ? personName(p) : 'Person'
  }
  const type = typeFilter(scope)
  if (type) return getType(type)?.label ?? 'Entries'
  return (snapshot && findGroup(snapshot.root, scope)?.name) || 'Entries'
}

/** A tab's label, derived from the snapshot (tabs never store titles). */
export function pageLabel(snapshot: VaultSnapshot | undefined, page: Page): string {
  switch (page.kind) {
    case 'home':
      return 'Home'
    case 'create':
      return 'New entry'
    case 'list':
      return scopeLabel(snapshot, page.scope)
    case 'entry': {
      const e = snapshot?.entries.find((x) => x.uuid === page.uuid)
      return e ? entryTitle(e) : 'Entry'
    }
    case 'new':
      return `New ${(getType(page.type)?.label ?? 'entry').toLowerCase()}`
  }
}
