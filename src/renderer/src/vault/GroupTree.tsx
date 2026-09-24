import { useState } from 'react'
import { ChevronRight, FolderPlus, Layers, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { PromptDialog } from '@/components/PromptDialog'
import { ALL_ENTRIES, activePage, useVault } from '@/stores/vault'
import { api, displayError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { renderGroupIcon } from './icons'
import { clickOptions } from './tabs'
import type { VaultGroupNode } from '../../../main/vault/protocol'

type Prompt =
  { kind: 'create'; parent: string | undefined } | { kind: 'rename'; group: VaultGroupNode }

/** The list the active tab shows, if it shows one. */
const useActiveScope = () =>
  useVault((s) => {
    const page = activePage(s)
    return page.kind === 'list' ? page.scope : undefined
  })

/** The vault's groups as a tree, with create / rename / delete. Lives on the Home page. */
export function GroupTree() {
  const snapshot = useVault((s) => s.snapshot)
  const selected = useActiveScope()
  const select = useVault((s) => s.selectGroup)
  const [prompt, setPrompt] = useState<Prompt>()
  if (!snapshot) return null

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast.error(displayError(e))
    }
  }

  const actions = {
    create: (parent: string | undefined) => setPrompt({ kind: 'create', parent }),
    rename: (group: VaultGroupNode) => setPrompt({ kind: 'rename', group }),
    remove: (group: VaultGroupNode) =>
      run(async () => {
        await api.vault.deleteGroup(group.uuid)
        if (selected === group.uuid) select(ALL_ENTRIES)
      })
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between pb-1">
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Groups
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => actions.create(undefined)}
          aria-label="New group"
        >
          <FolderPlus />
        </Button>
      </div>
      <div className="pb-3">
        <button
          onClick={(e) => select(ALL_ENTRIES, clickOptions(e))}
          onAuxClick={(e) => e.button === 1 && select(ALL_ENTRIES, clickOptions(e))}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
            selected === ALL_ENTRIES ? 'bg-muted font-medium' : 'hover:bg-muted/60'
          )}
        >
          <Layers className="size-4 text-primary" />
          <span className="flex-1 text-left">All entries</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {snapshot.entries.filter((e) => !e.inRecycleBin).length}
          </span>
        </button>
        <GroupNode node={snapshot.root} depth={0} actions={actions} isRoot />
      </div>

      <PromptDialog
        open={!!prompt}
        onOpenChange={(o) => !o && setPrompt(undefined)}
        title={prompt?.kind === 'rename' ? 'Rename group' : 'New group'}
        label="Name"
        initialValue={prompt?.kind === 'rename' ? prompt.group.name : ''}
        confirmLabel={prompt?.kind === 'rename' ? 'Rename' : 'Create'}
        onConfirm={(name) =>
          run(async () => {
            if (!prompt) return
            if (prompt.kind === 'rename') await api.vault.renameGroup(prompt.group.uuid, name)
            else select((await api.vault.createGroup(prompt.parent, name)).result)
          })
        }
      />
    </div>
  )
}

function GroupNode({
  node,
  depth,
  actions,
  isRoot = false
}: {
  node: VaultGroupNode
  depth: number
  actions: {
    create: (parent: string) => void
    rename: (g: VaultGroupNode) => void
    remove: (g: VaultGroupNode) => void
  }
  isRoot?: boolean
}) {
  const selected = useActiveScope()
  const select = useVault((s) => s.selectGroup)
  const [open, setOpen] = useState(true)
  const hasChildren = node.groups.length > 0

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 text-sm',
          selected === node.uuid
            ? 'bg-background/70 font-medium shadow-xs ring-1 ring-border/40'
            : 'hover:bg-background/40'
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          className={cn('p-1 text-muted-foreground', !hasChildren && 'invisible')}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <button
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5"
          onClick={(e) => select(node.uuid, clickOptions(e))}
          onAuxClick={(e) => e.button === 1 && select(node.uuid, clickOptions(e))}
        >
          {renderGroupIcon(
            node.icon,
            node.isRecycleBin,
            cn('size-4 shrink-0', node.isRecycleBin ? 'text-muted-foreground' : 'text-primary')
          )}
          <span className="truncate">{node.name || 'Root'}</span>
        </button>
        {node.entryCount > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums group-hover:hidden">
            {node.entryCount}
          </span>
        )}
        {!node.isRecycleBin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="hidden group-hover:inline-flex aria-expanded:inline-flex"
                aria-label="Group actions"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => actions.create(node.uuid)}>
                <FolderPlus /> New subgroup
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.rename(node)}>
                <Pencil /> Rename
              </DropdownMenuItem>
              {!isRoot && (
                <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(node)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open &&
        node.groups.map((g) => (
          <GroupNode key={g.uuid} node={g} depth={depth + 1} actions={actions} />
        ))}
    </div>
  )
}
