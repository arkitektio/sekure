import { useNavigate } from 'react-router-dom'
import { Cloud, FolderOpen, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/stores/auth'
import { useVault } from '@/stores/vault'
import { api, displayError } from '@/lib/api'

export function AccountMenu() {
  const status = useAuth((s) => s.status)
  const dirty = useVault((s) => s.snapshot?.dirty)
  const navigate = useNavigate()
  const account = status?.account
  if (!status) return null
  if (!status.connected) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Vaults">
            <FolderOpen />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => navigate('/files')}>
            <FolderOpen /> Open another vault
          </DropdownMenuItem>
          {status.configured && (
            <DropdownMenuItem onSelect={() => navigate('/files')}>
              <Cloud /> Connect Google Drive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const initials = (account?.name ?? account?.email ?? '?').slice(0, 1).toUpperCase()

  const logout = async () => {
    if (dirty) {
      toast.error('Save or discard your changes before disconnecting')
      return
    }
    try {
      await api.auth.logout()
      navigate('/')
    } catch (e) {
      toast.error(displayError(e))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Account">
          <Avatar className="size-6">
            {account?.picture && <AvatarImage src={account.picture} referrerPolicy="no-referrer" />}
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{account?.name ?? 'Google Drive'}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {account?.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/files')}>
          <FolderOpen /> Open another vault
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={logout}>
          <LogOut /> Disconnect Google Drive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
