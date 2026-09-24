import { useEffect } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { BrandSync } from '@/providers/BrandSync'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppShell } from '@/app/AppShell'
import { Home } from '@/pages/Home'
import { Connect } from '@/pages/Connect'
import { FilePicker } from '@/pages/FilePicker'
import { Unlock } from '@/pages/Unlock'
import { Vault } from '@/pages/Vault'
import { Deidentify } from '@/pages/Deidentify'
import { QuickFill } from '@/pages/QuickFill'
import { useVault } from '@/stores/vault'
import { useAuth } from '@/stores/auth'
import { api } from '@/lib/api'

function AuthSync() {
  const refresh = useAuth((s) => s.refresh)
  const set = useAuth((s) => s.set)
  useEffect(() => {
    void refresh()
    return api.auth.onChange(set)
  }, [refresh, set])
  return null
}

/** Follow a vault unlocked in the auto-type popup (main window only). */
function VaultFollow() {
  const navigate = useNavigate()
  useEffect(
    () =>
      api.vault.onEvent((e) => {
        if (e.type !== 'opened' || document.hasFocus()) return
        const { snapshot, reset, setSnapshot } = useVault.getState()
        if (snapshot?.fileId === e.snapshot.fileId) return
        reset()
        setSnapshot(e.snapshot)
        navigate('/vault', { replace: true })
      }),
    [navigate]
  )
  return null
}

function MainLayout() {
  return (
    <AppShell>
      <VaultFollow />
      <Outlet />
    </AppShell>
  )
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <TooltipProvider delayDuration={400}>
        <BrandSync />
        <HashRouter>
          <AuthSync />
          <Routes>
            {/* The auto-type popup: its own frameless window, no title bar. */}
            <Route path="/quick" element={<QuickFill />} />
            {/* The deidentify review popup, also frameless. */}
            <Route path="/deidentify" element={<Deidentify />} />
            <Route element={<MainLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/connect" element={<Connect />} />
              <Route path="/files" element={<FilePicker />} />
              <Route path="/unlock/:fileId" element={<Unlock />} />
              <Route path="/vault" element={<Vault />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  )
}
