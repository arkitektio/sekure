import { useState } from 'react'
import { Lock, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Kbd } from '@/components/ui/kbd'
import { SourceIcon } from '@/components/SourceIcon'
import { useVault } from '@/stores/vault'
import { useVaultActions } from './useVaultActions'

/** Centre of the title bar while a vault is open: name, unsaved state, save/lock. */
export function VaultTitle() {
  const snapshot = useVault((s) => s.snapshot)
  const { save, lock } = useVaultActions()
  const [confirmLock, setConfirmLock] = useState(false)
  if (!snapshot) return null

  const requestLock = () => (snapshot.dirty ? setConfirmLock(true) : void lock())

  return (
    <div className="flex min-w-0 items-center gap-2">
      <SourceIcon id={snapshot.fileId} className="shrink-0 text-muted-foreground" />
      <span className="truncate text-sm text-muted-foreground">{snapshot.dbName}</span>
      {snapshot.dirty && (
        <Badge variant="secondary" className="shrink-0">
          Unsaved
        </Badge>
      )}
      <div className="app-no-drag flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void save()}
              disabled={!snapshot.dirty}
              aria-label="Save"
            >
              <Save />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Save <Kbd>⌘S</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={requestLock} aria-label="Lock">
              <Lock />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Lock <Kbd>⌘L</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      <AlertDialog open={confirmLock} onOpenChange={setConfirmLock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save before locking?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Locking without saving discards them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void lock()}>
              Discard & lock
            </AlertDialogAction>
            <AlertDialogAction
              onClick={async () => {
                if (await save()) await lock()
              }}
            >
              Save & lock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
