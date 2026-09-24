import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { useActivePage, useVault } from '@/stores/vault'
import { entryTitle } from '@/lib/api'
import { EntryDetail } from '../EntryDetail'
import { EntryForm } from '../EntryForm'
import { activeTabOf, type Page } from '../tabs'
import { Crumb, PageHeader } from '../layout/PageHeader'
import { groupPath } from '../layout/labels'
import { CreatePage } from './CreatePage'
import { HomePage } from './HomePage'
import { ListPage } from './ListPage'
import { getType } from '../../../../main/vault/entryTypes'

/** Group path › entry title; each group opens its list. */
function EntryCrumbs({ uuid }: { uuid: string }) {
  const snapshot = useVault((s) => s.snapshot)
  const selectGroup = useVault((s) => s.selectGroup)
  const entry = snapshot?.entries.find((e) => e.uuid === uuid)
  if (!snapshot || !entry) return null
  return (
    <>
      {groupPath(snapshot.root, entry.groupUuid).map((g) => (
        <span key={g.uuid} className="flex min-w-0 items-center gap-1.5">
          <Crumb onClick={() => selectGroup(g.uuid)}>{g.name}</Crumb>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        </span>
      ))}
      <span className="truncate font-medium">{entryTitle(entry)}</span>
    </>
  )
}

function EntryPage({ uuid, editing }: { uuid: string; editing?: boolean }) {
  const exists = useVault((s) => !!s.snapshot?.entries.some((e) => e.uuid === uuid))
  const back = useVault((s) => s.back)
  if (!exists) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>This entry no longer exists</EmptyTitle>
          <EmptyDescription>It was deleted or merged away.</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" size="sm" onClick={back}>
          Go back
        </Button>
      </Empty>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <EntryCrumbs uuid={uuid} />
        {editing && <span className="text-xs text-muted-foreground">· editing</span>}
      </PageHeader>
      <div className="min-h-0 flex-1">
        {editing ? (
          <EntryForm key={`edit:${uuid}`} uuid={uuid} />
        ) : (
          <EntryDetail key={uuid} uuid={uuid} />
        )}
      </div>
    </div>
  )
}

function NewPage({ page }: { page: Extract<Page, { kind: 'new' }> }) {
  const back = useVault((s) => s.back)
  // Came through the wizard: step 1 is one Back away.
  const fromWizard = useVault((s) => {
    const t = activeTabOf(s)
    return t.history[t.index - 1]?.kind === 'create'
  })
  const label = getType(page.type)?.label ?? 'Entry'
  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        {fromWizard ? (
          <>
            <Crumb onClick={back}>New entry</Crumb>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{label}</span>
            <span className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="grid size-4 place-items-center rounded-full bg-muted text-[10px]">
                1
              </span>
              Type
              <ChevronRight className="size-3" />
              <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
                2
              </span>
              Details
            </span>
          </>
        ) : (
          <span className="truncate font-medium">New {label.toLowerCase()}</span>
        )}
      </PageHeader>
      <div className="min-h-0 flex-1">
        {/* Keyed by the whole page: a new suggestion restarts the form. */}
        <EntryForm key={JSON.stringify(page)} uuid="new" create={page} />
      </div>
    </div>
  )
}

/** Whatever the active tab shows. */
export function TabPage() {
  const page = useActivePage()
  switch (page.kind) {
    case 'home':
      return <HomePage />
    case 'create':
      return <CreatePage group={page.group} suggest={page.suggest} people={page.people} />
    case 'list':
      return <ListPage scope={page.scope} person={page.person} />
    case 'entry':
      return <EntryPage uuid={page.uuid} editing={page.editing} />
    case 'new':
      return <NewPage page={page} />
  }
}
