import { describe, expect, it } from 'vitest'
import {
  activeTabOf,
  back,
  closeOthers,
  closeTab,
  cycle,
  focusTab,
  forward,
  initialTabs,
  MAX_TABS,
  open,
  pageOf,
  prune,
  replace,
  type Page,
  type TabsState
} from './tabs'

const entry = (uuid: string): Page => ({ kind: 'entry', uuid })
const current = (s: TabsState) => pageOf(activeTabOf(s))

describe('tabs', () => {
  it('navigates the active tab and keeps its history', () => {
    let s = initialTabs()
    s = open(s, entry('a'))
    s = open(s, entry('b'))
    expect(s.tabs).toHaveLength(1)
    expect(current(s)).toEqual(entry('b'))
    s = back(s)
    expect(current(s)).toEqual(entry('a'))
    s = forward(s)
    expect(current(s)).toEqual(entry('b'))
    // Navigating after going back drops the forward history, like a browser.
    s = open(back(s), entry('c'))
    expect(activeTabOf(s).history).toEqual([{ kind: 'home' }, entry('a'), entry('c')])
    expect(forward(s)).toBe(s)
  })

  it('does not stack the same page twice', () => {
    const s = open(initialTabs(), entry('a'))
    expect(open(s, entry('a'))).toBe(s)
  })

  it('opens new tabs next to the active one, focused or in the background', () => {
    let s = initialTabs()
    const first = s.activeTab
    s = open(s, entry('a'), { newTab: true, background: true })
    expect(s.activeTab).toBe(first)
    expect(s.tabs).toHaveLength(2)
    s = open(s, entry('b'), { newTab: true })
    expect(current(s)).toEqual(entry('b'))
    expect(s.tabs.map((t) => pageOf(t))).toEqual([{ kind: 'home' }, entry('b'), entry('a')])
  })

  it('replaces a page without a history step', () => {
    let s = open(initialTabs(), { kind: 'new', type: 'login' })
    s = replace(s, entry('created'))
    expect(activeTabOf(s).history).toEqual([{ kind: 'home' }, entry('created')])
  })

  it('focuses a neighbour when the active tab closes, and never leaves none', () => {
    let s = initialTabs()
    s = open(s, entry('a'), { newTab: true })
    s = open(s, entry('b'), { newTab: true })
    const [t0, t1, t2] = s.tabs.map((t) => t.id)
    s = closeTab(focusTab(s, t1), t1)
    expect(s.activeTab).toBe(t2)
    s = closeTab(s, t2)
    expect(s.activeTab).toBe(t0)
    s = closeTab(s, t0)
    expect(s.tabs).toHaveLength(1)
    expect(current(s)).toEqual({ kind: 'home' })
  })

  it('closes the others and cycles', () => {
    let s = initialTabs()
    s = open(s, entry('a'), { newTab: true })
    s = open(s, entry('b'), { newTab: true })
    expect(current(cycle(s, 1))).toEqual({ kind: 'home' })
    expect(current(cycle(s, -1))).toEqual(entry('a'))
    const kept = closeOthers(s, s.activeTab)
    expect(kept.tabs).toHaveLength(1)
    expect(current(kept)).toEqual(entry('b'))
  })

  it(`keeps at most ${MAX_TABS} tabs, dropping the least recently used`, () => {
    let s = initialTabs()
    const oldest = s.activeTab
    s = { ...s, tabs: s.tabs.map((t) => ({ ...t, lastActiveAt: 0 })) }
    for (let i = 0; i < MAX_TABS; i++) s = open(s, entry(String(i)), { newTab: true }, 1000 + i)
    expect(s.tabs).toHaveLength(MAX_TABS)
    expect(s.tabs.some((t) => t.id === oldest)).toBe(false)
  })

  it('prunes entries that no longer exist', () => {
    let s = initialTabs()
    s = open(s, entry('gone'))
    s = open(s, entry('kept'))
    s = open(s, entry('gone2'), { newTab: true })
    const pruned = prune(s, (uuid) => uuid === 'kept')
    const [first, second] = pruned.tabs
    expect(first.history).toEqual([{ kind: 'home' }, entry('kept')])
    expect(pageOf(first)).toEqual(entry('kept'))
    expect(second.history).toEqual([{ kind: 'home' }])
    expect(prune(pruned, () => true)).toBe(pruned)
  })
})
