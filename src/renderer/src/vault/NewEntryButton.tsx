import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { useVault } from '@/stores/vault'

/** The “+” button: opens the new-entry wizard, which asks what to save. */
export function NewEntryButton() {
  const startNew = useVault((s) => s.startNew)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" onClick={() => startNew()} aria-label="New entry">
          <Plus /> New
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        New entry <Kbd>⌘N</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
