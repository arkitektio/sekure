import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { api } from '@/lib/api'
import type { WindowState } from '../../../main/window/protocol'

interface GlassStore {
  glass: boolean
  /** Ask main to turn glass on/off; it answers whether the platform can do it. */
  setGlass: (on: boolean) => Promise<void>
  load: () => Promise<void>
}

const applyClass = (on: boolean) => document.documentElement.classList.toggle('rail-glass', on)

/** The see-through sidebar. Main owns the preference (it must know before the window exists). */
export const useGlass = create<GlassStore>((set) => ({
  glass: false,
  setGlass: async (on) => {
    const glass = await api.windowControls.setGlass(on)
    applyClass(glass)
    set({ glass })
  },
  load: async () => {
    const glass = await api.windowControls.getGlass()
    applyClass(glass)
    set({ glass })
  }
}))

/** Fullscreen state of this window (the traffic lights disappear in it). */
export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({ fullscreen: false })
  useEffect(() => {
    let alive = true
    void api.windowControls.state().then((s) => alive && setState(s))
    const off = api.windowControls.onState(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}
