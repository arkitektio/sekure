import { useEffect, useState } from 'react'
import {
  Download,
  Eye,
  File as FileIcon,
  FileText,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { PromptDialog } from '@/components/PromptDialog'
import { api, displayError, formatBytes } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { VaultAttachment } from '../../../main/vault/protocol'

/**
 * Decrypted attachment bytes as a blob: URL, revoked when the component using
 * it unmounts so plaintext does not linger in the renderer.
 */
function useAttachmentUrl(entryUuid: string, name: string, enabled: boolean) {
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!enabled) return
    let revoked = false
    let objectUrl: string | undefined
    api.vault
      .readAttachment(entryUuid, name)
      .then(({ bytes, mime }) => {
        if (revoked) return
        objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
        setUrl(objectUrl)
      })
      .catch((e) => !revoked && setError(displayError(e)))
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(undefined)
    }
  }, [entryUuid, name, enabled])
  return { url, error }
}

export async function attachFiles(entryUuid: string, files: File[]) {
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { result } = await api.vault.addAttachment(entryUuid, file.name, bytes)
      toast.success(`Attached ${result}`)
    } catch (e) {
      toast.error(`${file.name}: ${displayError(e)}`)
    }
  }
}

export function Attachments({
  entryUuid,
  attachments
}: {
  entryUuid: string
  attachments: VaultAttachment[]
}) {
  const [preview, setPreview] = useState<VaultAttachment>()
  const [renaming, setRenaming] = useState<VaultAttachment>()
  const [adding, setAdding] = useState(false)

  const add = async () => {
    setAdding(true)
    try {
      const added = await api.vault.pickAttachments(entryUuid)
      if (added.length) toast.success(`Attached ${added.join(', ')}`)
    } catch (e) {
      toast.error(displayError(e))
    } finally {
      setAdding(false)
    }
  }

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (e) {
      toast.error(displayError(e))
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
          <Paperclip className="size-3" /> Attachments
        </h3>
        <Button variant="ghost" size="xs" onClick={add} disabled={adding}>
          {adding ? <Loader2 className="animate-spin" /> : <Plus />} Add
        </Button>
      </div>

      {attachments.length === 0 ? (
        <button
          onClick={add}
          className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground transition-colors hover:bg-muted/40"
        >
          <Paperclip className="size-4" />
          Drop images or PDFs here, paste an image, or click to browse
        </button>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
          {attachments.map((a) => (
            <AttachmentCard
              key={a.name}
              entryUuid={entryUuid}
              attachment={a}
              onPreview={() => setPreview(a)}
              onRename={() => setRenaming(a)}
              onExport={() => run(() => api.vault.exportAttachment(entryUuid, a.name))}
              onRemove={() => run(() => api.vault.removeAttachment(entryUuid, a.name))}
            />
          ))}
        </div>
      )}

      <PreviewDialog
        entryUuid={entryUuid}
        attachment={preview}
        onOpenChange={(o) => !o && setPreview(undefined)}
      />
      <PromptDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(undefined)}
        title="Rename attachment"
        label="File name"
        initialValue={renaming?.name}
        confirmLabel="Rename"
        onConfirm={(to) => run(() => api.vault.renameAttachment(entryUuid, renaming!.name, to))}
      />
    </section>
  )
}

function AttachmentCard({
  entryUuid,
  attachment,
  onPreview,
  onRename,
  onExport,
  onRemove
}: {
  entryUuid: string
  attachment: VaultAttachment
  onPreview: () => void
  onRename: () => void
  onExport: () => void
  onRemove: () => void
}) {
  const isImage = attachment.kind === 'image'
  const { url } = useAttachmentUrl(entryUuid, attachment.name, isImage)
  const canPreview = attachment.kind !== 'other'
  const Icon = attachment.kind === 'pdf' ? FileText : FileIcon

  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card">
      <button
        className={cn(
          'grid aspect-[4/3] w-full place-items-center bg-muted/50',
          canPreview ? 'cursor-zoom-in' : 'cursor-default'
        )}
        onClick={canPreview ? onPreview : onExport}
        title={canPreview ? 'Preview' : 'Save as…'}
      >
        {isImage && url ? (
          <img
            src={url}
            alt={attachment.name}
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          <Icon
            className={cn(
              'size-8',
              attachment.kind === 'pdf' ? 'text-red-500/80' : 'text-muted-foreground'
            )}
          />
        )}
      </button>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium" title={attachment.name}>
            {attachment.name}
          </div>
          <div className="text-[11px] text-muted-foreground">{formatBytes(attachment.size)}</div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Attachment actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canPreview && (
              <DropdownMenuItem onSelect={onPreview}>
                <Eye /> Preview
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onExport}>
              <Download /> Save as…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2 /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function PreviewDialog({
  entryUuid,
  attachment,
  onOpenChange
}: {
  entryUuid: string
  attachment: VaultAttachment | undefined
  onOpenChange: (open: boolean) => void
}) {
  const { url, error } = useAttachmentUrl(entryUuid, attachment?.name ?? '', !!attachment)

  return (
    <Dialog open={!!attachment} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{attachment?.name}</DialogTitle>
          <DialogDescription>
            {attachment && formatBytes(attachment.size)} · decrypted in memory only
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg bg-muted/40">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !url ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : attachment?.kind === 'pdf' ? (
            <iframe src={url} title={attachment.name} className="size-full border-0" />
          ) : (
            <img
              src={url}
              alt={attachment?.name}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>
        {attachment && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void api.vault.exportAttachment(entryUuid, attachment.name)}
            >
              <Download /> Save as…
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
