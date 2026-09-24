import { create } from 'zustand'
import type { AuthStatus } from '../../../main/google/protocol'
import { api } from '@/lib/api'

interface AuthStore {
  status: AuthStatus | undefined
  loading: boolean
  refresh: () => Promise<void>
  set: (status: AuthStatus) => void
}

export const useAuth = create<AuthStore>((set) => ({
  status: undefined,
  loading: true,
  refresh: async () => {
    const status = await api.auth.status()
    set({ status, loading: false })
  },
  set: (status) => set({ status, loading: false })
}))
