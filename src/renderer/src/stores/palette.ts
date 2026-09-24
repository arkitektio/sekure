import { create } from 'zustand'

interface PaletteStore {
  open: boolean
  query: string
  /** Open, optionally with the first typed character already in the field. */
  show: (query?: string) => void
  hide: () => void
  toggle: () => void
  setQuery: (q: string) => void
}

/** The search palette that grows out of the rail's search pill. */
export const usePalette = create<PaletteStore>((set) => ({
  open: false,
  query: '',
  show: (query = '') => set({ open: true, query }),
  // Start fresh next time: the query is cleared whenever the palette closes.
  hide: () => set({ open: false, query: '' }),
  toggle: () => set((s) => (s.open ? { open: false, query: '' } : { open: true, query: '' })),
  setQuery: (query) => set({ query })
}))
