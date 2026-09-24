import { create } from 'zustand'
import type { VaultSnapshot } from '../../../main/vault/protocol'
import * as tabs from '@/vault/tabs'
import type { OpenOptions, Page, TabsState } from '@/vault/tabs'
import { personFilter } from '@/vault/people'
import { PERSON_TYPE } from '../../../main/vault/entryTypes'

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
  group === ALL_ENTRIES || typeFilter(group) || personFilter(group) ? undefined : group

interface VaultStore extends TabsState {
  snapshot: VaultSnapshot | undefined
  /** Route to go to once the vault is locked (the vault switcher), else its unlock screen. */
  switchTarget: string | undefined
  setSnapshot: (s: VaultSnapshot | undefined) => void
  setSwitchTarget: (route: string | undefined) => void

  /** Navigate the active tab, or open a new one. */
  open: (page: Page, opts?: OpenOptions) => void
  /** Swap the active tab's page without a history step (a created entry, leaving edit mode). */
  replace: (page: Page) => void
  back: () => void
  forward: () => void
  focusTab: (id: string) => void
  closeTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  cycleTabs: (step: 1 | -1) => void

  /** Show a group, category or all entries. */
  selectGroup: (scope: string, opts?: OpenOptions) => void
  selectEntry: (uuid: string, opts?: OpenOptions) => void
  /** The form for a new entry of `type`, or without one the wizard that asks for it. */
  startNew: (type?: string, prefill?: Record<string, string>) => void
  /** Edit an entry in place, or leave edit/new mode. */
  setEditing: (uuid: string | undefined) => void
  reset: () => void
}

export const useVault = create<VaultStore>((set, get) => {
  const apply = (fn: (s: TabsState) => TabsState) =>
    set((s) => fn({ tabs: s.tabs, activeTab: s.activeTab }))
  return {
    snapshot: undefined,
    switchTarget: undefined,
    ...tabs.initialTabs(),
    setSnapshot: (snapshot) =>
      set((s) => {
        if (!snapshot) return { snapshot }
        const ids = new Set(snapshot.entries.map((e) => e.uuid))
        const pruned = tabs.prune(s, (uuid) => ids.has(uuid))
        return { snapshot, tabs: pruned.tabs, activeTab: pruned.activeTab }
      }),
    setSwitchTarget: (switchTarget) => set({ switchTarget }),

    open: (page, opts) => apply((s) => tabs.open(s, page, opts)),
    replace: (page) => apply((s) => tabs.replace(s, page)),
    back: () => apply(tabs.back),
    forward: () => apply(tabs.forward),
    focusTab: (id) => apply((s) => tabs.focusTab(s, id)),
    closeTab: (id) => apply((s) => tabs.closeTab(s, id)),
    closeOtherTabs: (id) => apply((s) => tabs.closeOthers(s, id)),
    cycleTabs: (step) => apply((s) => tabs.cycle(s, step)),

    selectGroup: (scope, opts) => get().open({ kind: 'list', scope }, opts),
    selectEntry: (uuid, opts) => get().open({ kind: 'entry', uuid }, opts),
    startNew: (type, prefill) => {
      const scope = currentScope(get())
      const group = groupForNew(scope)
      // Started from someone's page, or a list narrowed to them: the entry is theirs.
      const person = currentPerson(get())
      const people = person && type !== PERSON_TYPE ? [person] : undefined
      if (type) get().open({ kind: 'new', type, group, prefill, people })
      else get().open({ kind: 'create', group, suggest: typeFilter(scope), people })
    },
    setEditing: (uuid) => {
      const page = activePage(get())
      if (uuid) apply((s) => tabs.replace(s, { kind: 'entry', uuid, editing: true }))
      else if (page.kind === 'entry')
        apply((s) => tabs.replace(s, { kind: 'entry', uuid: page.uuid }))
      else if (page.kind === 'new' || page.kind === 'create') apply(tabs.back)
    },
    reset: () => set({ snapshot: undefined, switchTarget: undefined, ...tabs.initialTabs() })
  }
})

export const activePage = (s: TabsState): Page => tabs.pageOf(tabs.activeTabOf(s))

/** The list the active tab browses: its latest list page, else all entries. */
export function currentScope(s: TabsState): string {
  const t = tabs.activeTabOf(s)
  for (let i = t.index; i >= 0; i--) {
    const p = t.history[i]
    if (p.kind === 'list') return p.scope
  }
  return ALL_ENTRIES
}

/** The person the active tab is about: a person list, a list narrowed to one, or their entry. */
export function currentPerson(s: TabsState): string | undefined {
  const page = activePage(s)
  if (page.kind === 'list') {
    const p = personFilter(page.scope) ?? page.person
    return p && p !== 'none' ? p : undefined
  }
  return undefined
}

export const useActivePage = () => useVault(activePage)
export const useCurrentScope = () => useVault(currentScope)
