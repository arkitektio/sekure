import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useGlass } from '@/hooks/useChrome'
import { WelcomeLayout } from './WelcomeLayout'

/**
 * The main window. The open vault draws its own chrome (the rail, like
 * orkestrator); every other screen sits in the welcome layout's inset card.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const inVault = useLocation().pathname === '/vault'
  useEffect(() => {
    void useGlass.getState().load()
  }, [])

  if (inVault) return <div className="h-full">{children}</div>
  return <WelcomeLayout>{children}</WelcomeLayout>
}
