import { useState } from 'react'
import { ChevronRight, FolderPlus, Layers, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { PromptDialog } from '@/components/PromptDialog'
import { ALL_ENTRIES, typeFilterId, useVault } from '@/stores/vault'
import { api, displayError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { renderGroupIcon, renderTypeIcon } from './icons'
import { ENTRY_TYPES } from '../../../main/vault/entryTypes'
import type { VaultGroupNode } from '../../../main/vault/protocol'

type Prompt =
  { kind: 'create'; parent: string | undefined } | { kind: 'rename'; group: VaultGroupNode }

export function GroupTree() {
  const snapshot = useVault((s) => s.snapshot)
  const selected = useVault((s) => s.selectedGroup)
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
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-xs font-medium text-muted-foreground uppercase">Groups</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => actions.create(undefined)}
          aria-label="New group"
        >
          <FolderPlus />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        <button
          onClick={() => select(ALL_ENTRIES)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
            selected === ALL_ENTRIES
              ? 'bg-sidebar-accent font-medium'
              : 'hover:bg-sidebar-accent/60'
          )}
        >
          <Layers className="size-4 text-primary" />
          <span className="flex-1 text-left">All entries</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {snapshot.entries.filter((e) => !e.inRecycleBin).length}
          </span>
        </button>
        <GroupNode node={snapshot.root} depth={0} actions={actions} isRoot />
        <Categories />
      </ScrollArea>

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
  const selected = useVault((s) => s.selectedGroup)
  const select = useVault((s) => s.selectGroup)
  const [open, setOpen] = useState(true)
  const hasChildren = node.groups.length > 0

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 text-sm',
          selected === node.uuid ? 'bg-sidebar-accent font-medium' : 'hover:bg-sidebar-accent/60'
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
          onClick={() => select(node.uuid)}
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

/** Smart lists per entry type, shown once the vault has anything besides logins. */
function Categories() {
  const snapshot = useVault((s) => s.snapshot)
  const selected = useVault((s) => s.selectedGroup)
  const select = useVault((s) => s.selectGroup)
  if (!snapshot) return null

  const counts = new Map<string, number>()
  for (const e of snapshot.entries) {
    if (!e.inRecycleBin) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  }
  if (![...counts.keys()].some((t) => t !== 'login')) return null

  return (
    <>
      <div className="px-1 pt-4 pb-1 text-xs font-medium text-muted-foreground uppercase">
        Categories
      </div>
      {ENTRY_TYPES.filter((t) => counts.has(t.id)).map((t) => {
        const id = typeFilterId(t.id)
        return (
          <button
            key={t.id}
            onClick={() => select(id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
              selected === id ? 'bg-sidebar-accent font-medium' : 'hover:bg-sidebar-accent/60'
            )}
          >
            {renderTypeIcon(t.id, 'size-4 text-primary')}
            <span className="flex-1 text-left">{t.label}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{counts.get(t.id)}</span>
          </button>
        )
      })}
    </>
  )
}
