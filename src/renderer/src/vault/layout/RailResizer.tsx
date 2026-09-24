import { useEffect, useRef } from 'react'

const KEY = 'sekure:rail-width:v1'
export const RAIL_MIN = 200
export const RAIL_MAX = 380
export const RAIL_DEFAULT = 256

const clamp = (w: number) => Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN, w)))

function stored(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v > 0 ? clamp(v) : RAIL_DEFAULT
  } catch {
    return RAIL_DEFAULT
  }
}

const setWidth = (w: number) =>
  document.documentElement.style.setProperty('--rail-width', `${clamp(w)}px`)

/** Drag handle on the rail's right edge; the width is a UI preference kept in localStorage. */
export function RailResizer() {
  const dragging = useRef(false)
  useEffect(() => setWidth(stored()), [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="app-no-drag group absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize"
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => dragging.current && setWidth(e.clientX)}
      onPointerUp={(e) => {
        dragging.current = false
        try {
          localStorage.setItem(KEY, String(clamp(e.clientX)))
        } catch {
          // Width just won't be remembered.
        }
      }}
      onDoubleClick={() => {
        setWidth(RAIL_DEFAULT)
        try {
          localStorage.removeItem(KEY)
        } catch {
          // ignore
        }
      }}
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-border" />
    </div>
  )
}
