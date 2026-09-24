// Browser-style tabs over the open vault. Pure transitions, so they are easy to test;
// the store in `stores/vault.ts` applies them. Tabs hold ids only (entry uuids,
// group scopes), never titles or values: labels come from the snapshot.

/** What a tab shows. */
export type Page =
  /** The vault's start page: categories, groups, recently changed entries. */
  | { kind: 'home' }
  /**
   * A list of entries: `__all__`, a group uuid, `type:<id>` or `person:<uuid>`,
   * optionally narrowed to one person's entries (`person`, or `none` for unlinked).
   */
  | { kind: 'list'; scope: string; person?: string }
  | { kind: 'entry'; uuid: string; editing?: boolean }
  /** Step 1 of the new-entry wizard: pick a type. `suggest` comes first (the category browsed). */
  | { kind: 'create'; group?: string; suggest?: string; people?: string[] }
  /** Step 2: the form for one type. */
  | {
      kind: 'new'
      type: string
      group?: string
      prefill?: Record<string, string>
      /** Person entries to link the new entry to. */
      people?: string[]
    }

export interface Tab {
  id: string
  history: Page[]
  index: number
  lastActiveAt: number
}

export interface TabsState {
  tabs: Tab[]
  activeTab: string
}

export const MAX_TABS = 12

export interface OpenOptions {
  /** Open in a new tab instead of navigating the active one. */
  newTab?: boolean
  /** With `newTab`: leave the current tab focused (⌘-click). */
  background?: boolean
}

let counter = 0
const newId = () => `tab-${Date.now().toString(36)}-${(counter++).toString(36)}`

export const pageOf = (tab: Tab): Page => tab.history[tab.index]

export const activeTabOf = (s: TabsState): Tab =>
  s.tabs.find((t) => t.id === s.activeTab) ?? s.tabs[0]

export const HOME: Page = { kind: 'home' }

export function initialTabs(page: Page = HOME): TabsState {
  const tab = { id: newId(), history: [page], index: 0, lastActiveAt: Date.now() }
  return { tabs: [tab], activeTab: tab.id }
}

const samePage = (a: Page, b: Page) => JSON.stringify(a) === JSON.stringify(b)

/** Drop least-recently-used inactive tabs beyond the limit. */
function cap(s: TabsState): TabsState {
  if (s.tabs.length <= MAX_TABS) return s
  const evict = s.tabs
    .filter((t) => t.id !== s.activeTab)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .slice(0, s.tabs.length - MAX_TABS)
    .map((t) => t.id)
  return { ...s, tabs: s.tabs.filter((t) => !evict.includes(t.id)) }
}

const updateActive = (s: TabsState, fn: (t: Tab) => Tab): TabsState => {
  const active = activeTabOf(s)
  return { ...s, tabs: s.tabs.map((t) => (t.id === active.id ? fn(t) : t)) }
}

export function open(s: TabsState, page: Page, opts: OpenOptions = {}, now = Date.now()) {
  if (opts.newTab) {
    const tab: Tab = { id: newId(), history: [page], index: 0, lastActiveAt: now }
    const at = s.tabs.findIndex((t) => t.id === s.activeTab)
    const tabs = [...s.tabs.slice(0, at + 1), tab, ...s.tabs.slice(at + 1)]
    return cap({ tabs, activeTab: opts.background ? s.activeTab : tab.id })
  }
  if (samePage(pageOf(activeTabOf(s)), page)) return s
  return updateActive(s, (t) => {
    const history = [...t.history.slice(0, t.index + 1), page]
    return { ...t, history, index: history.length - 1, lastActiveAt: now }
  })
}

/** Swap the current page without a history step (edit mode, created entry). */
export const replace = (s: TabsState, page: Page): TabsState =>
  updateActive(s, (t) => ({
    ...t,
    history: t.history.map((p, i) => (i === t.index ? page : p))
  }))

export const canGoBack = (s: TabsState) => activeTabOf(s).index > 0
export const canGoForward = (s: TabsState) => {
  const t = activeTabOf(s)
  return t.index < t.history.length - 1
}

export const back = (s: TabsState): TabsState =>
  canGoBack(s) ? updateActive(s, (t) => ({ ...t, index: t.index - 1 })) : s

export const forward = (s: TabsState): TabsState =>
  canGoForward(s) ? updateActive(s, (t) => ({ ...t, index: t.index + 1 })) : s

export function focusTab(s: TabsState, id: string, now = Date.now()): TabsState {
  if (!s.tabs.some((t) => t.id === id)) return s
  return {
    activeTab: id,
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: now } : t))
  }
}

/** Close a tab; the last one is replaced by a fresh Home tab. */
export function closeTab(s: TabsState, id: string): TabsState {
  const at = s.tabs.findIndex((t) => t.id === id)
  if (at < 0) return s
  const tabs = s.tabs.filter((t) => t.id !== id)
  if (!tabs.length) return initialTabs()
  if (s.activeTab !== id) return { ...s, tabs }
  // Like a browser: focus the neighbour to the right, else the left one.
  return { tabs, activeTab: tabs[Math.min(at, tabs.length - 1)].id }
}

export const closeOthers = (s: TabsState, id: string): TabsState => {
  const keep = s.tabs.find((t) => t.id === id)
  return keep ? { tabs: [keep], activeTab: id } : s
}

/** Ctrl+Tab / Ctrl+Shift+Tab. */
export function cycle(s: TabsState, step: 1 | -1): TabsState {
  const at = s.tabs.findIndex((t) => t.id === s.activeTab)
  const next = s.tabs[(at + step + s.tabs.length) % s.tabs.length]
  return focusTab(s, next.id)
}

/**
 * Drop pages whose entry no longer exists (deleted, merged away); a tab left with
 * nothing goes back to Home.
 */
export function prune(s: TabsState, exists: (uuid: string) => boolean): TabsState {
  let changed = false
  const tabs = s.tabs.map((t) => {
    const keep = t.history.map((p) => p.kind !== 'entry' || exists(p.uuid))
    if (keep.every(Boolean)) return t
    changed = true
    const history = t.history.filter((_, i) => keep[i])
    const before = keep.slice(0, t.index + 1).filter(Boolean).length
    if (!history.length) return { ...t, history: [HOME], index: 0 }
    return { ...t, history, index: Math.max(0, Math.min(before - 1, history.length - 1)) }
  })
  return changed ? { ...s, tabs } : s
}

/** ⌘/Ctrl-click and middle-click open in a background tab, like a browser. */
export const clickOptions = (e: {
  metaKey: boolean
  ctrlKey: boolean
  button: number
}): OpenOptions | undefined =>
  e.metaKey || e.ctrlKey || e.button === 1 ? { newTab: true, background: true } : undefined
