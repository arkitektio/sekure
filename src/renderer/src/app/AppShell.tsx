import type { ReactNode } from 'react'
import { TitleBar } from './TitleBar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <TitleBar />
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  )
}
