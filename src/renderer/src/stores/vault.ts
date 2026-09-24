import { create } from 'zustand'
import type { VaultSnapshot } from '../../../main/vault/protocol'

/** Pseudo-group ids for the sidebar's smart lists. */
export const ALL_ENTRIES = '__all__'
/** `type:<id>` selects every entry of one Sekure entry type. */
const TYPE_PREFIX = 'type:'

export const typeFilterId = (type: string) => `${TYPE_PREFIX}${type}`

/** The entry type a pseudo-group filters on, if it is one. */
export const typeFilter = (group: string): string | undefined =>
  group.startsWith(TYPE_PREFIX) ? group.slice(TYPE_PREFIX.length) : undefined

/** The real group a new entry goes into for the current sidebar selection. */
export const groupForNew = (group: string): string | undefined =>
  group === ALL_ENTRIES || typeFilter(group) ? undefined : group

interface VaultStore {
  snapshot: VaultSnapshot | undefined
  selectedGroup: string
  selectedEntry: string | undefined
  search: string
  /** Entry currently in edit mode (or 'new'). */
  editing: string | 'new' | undefined
  /** Entry type for `editing === 'new'`. */
  newEntryType: string
  setSnapshot: (s: VaultSnapshot | undefined) => void
  selectGroup: (uuid: string) => void
  selectEntry: (uuid: string | undefined) => void
  setSearch: (q: string) => void
  setEditing: (e: string | 'new' | undefined) => void
  /** Deselect and open the form for a new entry, of `type` or the filtered type. */
  startNew: (type?: string) => void
  reset: () => void
}

export const useVault = create<VaultStore>((set) => ({
  snapshot: undefined,
  selectedGroup: ALL_ENTRIES,
  selectedEntry: undefined,
  search: '',
  editing: undefined,
  newEntryType: 'login',
  setSnapshot: (snapshot) =>
    set((s) => ({
      snapshot,
      // Drop a selection that no longer exists (deleted / merged away).
      selectedEntry:
        snapshot && s.selectedEntry && snapshot.entries.some((e) => e.uuid === s.selectedEntry)
          ? s.selectedEntry
          : undefined
    })),
  selectGroup: (selectedGroup) => set({ selectedGroup, editing: undefined }),
  selectEntry: (selectedEntry) => set({ selectedEntry, editing: undefined }),
  setSearch: (search) => set({ search }),
  setEditing: (editing) => set({ editing }),
  startNew: (type) =>
    set((s) => ({
      selectedEntry: undefined,
      editing: 'new',
      newEntryType: type ?? typeFilter(s.selectedGroup) ?? 'login'
    })),
  reset: () =>
    set({
      snapshot: undefined,
      selectedGroup: ALL_ENTRIES,
      selectedEntry: undefined,
      search: '',
      editing: undefined
    })
}))
