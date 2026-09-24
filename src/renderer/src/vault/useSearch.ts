import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { SearchHit, SemanticStatus } from '../../../main/search/protocol'
import { getType, suggestNewEntries, type NewEntrySuggestion } from '../../../main/vault/entryTypes'
import type { VaultEntrySummary, VaultSnapshot } from '../../../main/vault/protocol'

export interface RankedHit extends SearchHit {
  rank: number
}

const DEBOUNCE_MS = 80

/** Live status of the local embedding model. */
export function useSemanticStatus(): SemanticStatus | undefined {
  const [status, setStatus] = useState<SemanticStatus>()
  useEffect(() => {
    let alive = true
    void api.search.status().then((s) => alive && setStatus(s))
    const off = api.search.onStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])
  return status
}

/**
 * Ranked search over the open vault, done in main (text + semantic). `undefined`
 * for an empty query, and until the first answer arrives; afterwards the previous
 * answer stays until the next one lands, so the list does not flicker.
 */
export function useSearch(
  query: string,
  snapshot: VaultSnapshot | null | undefined
): Map<string, RankedHit> | undefined {
  const [hits, setHits] = useState<{ query: string; map: Map<string, RankedHit> }>()
  const seq = useRef(0)
  const status = useSemanticStatus()
  // Re-query when the index gains vectors, so semantic hits appear once indexing is done.
  const statusKey = status?.state === 'ready' || status?.state === 'off' ? status.state : ''

  const q = query.trim()
  useEffect(() => {
    if (!q || !snapshot) return
    const id = ++seq.current
    const t = setTimeout(() => {
      api.search
        .query(q)
        .then((list) => {
          if (id !== seq.current) return
          setHits({ query: q, map: new Map(list.map((h, rank) => [h.uuid, { ...h, rank }])) })
        })
        .catch(() => {})
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q, snapshot, statusKey])

  return q && hits ? hits.map : undefined
}

const MAX_SUGGESTIONS = 4

/**
 * “Add …” suggestions for a query: recognised numbers and matching type names
 * right away, then types the local model finds by meaning. Nothing of the vault
 * is involved, only the query and the type registry.
 */
export function useNewEntrySuggestions(query: string): NewEntrySuggestion[] {
  const q = query.trim()
  const local = useMemo(() => (q ? suggestNewEntries(q) : []), [q])
  const [semantic, setSemantic] = useState<{ query: string; typeIds: string[] }>()
  // A recognised number already says what to create; meaning adds nothing there.
  const recognised = local.some((s) => s.via === 'id')

  useEffect(() => {
    if (!q || recognised) return
    let alive = true
    const t = setTimeout(() => {
      api.search
        .suggestTypes(q)
        .then((list) => alive && setSemantic({ query: q, typeIds: list.map((s) => s.typeId) }))
        .catch(() => {})
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q, recognised])

  return useMemo(() => {
    const out = [...local]
    if (!recognised && semantic?.query === q) {
      for (const typeId of semantic.typeIds) {
        if (!out.some((s) => s.typeId === typeId)) out.push({ typeId, via: 'semantic' })
      }
    }
    return out.slice(0, MAX_SUGGESTIONS)
  }, [q, local, recognised, semantic])
}

/** `Add tax ID` / `“12-3456789” · US EIN` for a suggestion row. */
export function describeSuggestion(s: NewEntrySuggestion): { title: string; detail?: string } {
  const label = getType(s.typeId)?.label ?? s.typeId
  const title = `Add ${s.typeId === 'login' ? 'login' : label}`
  if (s.via !== 'id' || !s.prefill) return { title }
  const value = Object.values(s.prefill)[0]
  return { title, detail: `“${value}” · ${s.detail}` }
}

/** Plain substring match, used until the first ranked answer arrives from main. */
export function matchesSearch(e: VaultEntrySummary, q: string): boolean {
  if (!q) return true
  const type = e.type === 'login' ? '' : (getType(e.type)?.label ?? '')
  const hay =
    `${e.title} ${e.username} ${e.url} ${e.subtitle} ${type} ${e.tags.join(' ')}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((part) => hay.includes(part))
}

/**
 * Order entries for a query: text matches by score, then semantic-only matches
 * (`related`). Without a query, alphabetical.
 */
export function rankEntries(
  entries: VaultEntrySummary[],
  query: string,
  hits: Map<string, RankedHit> | undefined
): { matches: VaultEntrySummary[]; related: VaultEntrySummary[] } {
  const byTitle = (a: VaultEntrySummary, b: VaultEntrySummary) => a.title.localeCompare(b.title)
  if (!query.trim()) return { matches: [...entries].sort(byTitle), related: [] }
  if (!hits)
    return { matches: entries.filter((e) => matchesSearch(e, query)).sort(byTitle), related: [] }
  const ranked = entries
    .filter((e) => hits.has(e.uuid))
    .sort((a, b) => hits.get(a.uuid)!.rank - hits.get(b.uuid)!.rank)
  return {
    matches: ranked.filter((e) => hits.get(e.uuid)!.match === 'text'),
    related: ranked.filter((e) => hits.get(e.uuid)!.match === 'semantic')
  }
}
