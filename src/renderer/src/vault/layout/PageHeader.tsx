import type { ReactNode } from 'react'
import { WindowControls } from '@/app/WindowControls'
import { usePlatform } from '@/hooks/usePlatform'
import { api } from '@/lib/api'

/**
 * The top of the content card: drags the window like a title bar, holds the page's
 * breadcrumbs and actions, and the window controls on Windows/Linux.
 */
export function PageHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const isMac = usePlatform() === 'darwin'
  return (
    <header
      className="app-drag flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4"
      onDoubleClick={(e) => {
        if (!isMac && e.target === e.currentTarget) void api.windowControls.toggleMaximize()
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">{children}</div>
      {actions && <div className="app-no-drag flex shrink-0 items-center gap-1">{actions}</div>}
      <WindowControls />
    </header>
  )
}

/** A clickable breadcrumb inside a `PageHeader`. */
export function Crumb({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="app-no-drag min-w-0 truncate rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  )
}
