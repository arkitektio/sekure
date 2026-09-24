import { Fragment } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useVault } from '@/stores/vault'
import { renderTypeIcon } from './icons'
import { ENTRY_TYPE_GROUPS, ENTRY_TYPES } from '../../../main/vault/entryTypes'

/** The “+” button: pick what kind of entry to create. */
export function NewEntryMenu() {
  const startNew = useVault((s) => s.startNew)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" aria-label="New entry">
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {ENTRY_TYPE_GROUPS.map((g, i) => (
          <Fragment key={g.id}>
            {i > 0 && <DropdownMenuSeparator />}
            {g.id !== 'login' && <DropdownMenuLabel>{g.label}</DropdownMenuLabel>}
            {ENTRY_TYPES.filter((t) => t.group === g.id).map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => startNew(t.id)}>
                {renderTypeIcon(t.id)} {t.label}
                {t.id === 'login' && <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>}
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
