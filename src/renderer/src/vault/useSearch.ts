import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { SearchHit, SemanticStatus } from '../../../main/search/protocol'
import { getType } from '../../../main/vault/entryTypes'
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
