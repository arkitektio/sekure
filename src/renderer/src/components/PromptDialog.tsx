import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function PromptDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue = '',
  confirmLabel = 'OK',
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  initialValue?: string
  confirmLabel?: string
  onConfirm: (value: string) => void | Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <PromptForm
          title={title}
          label={label}
          initialValue={initialValue}
          confirmLabel={confirmLabel}
          onCancel={() => onOpenChange(false)}
          onConfirm={async (v) => {
            await onConfirm(v)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Mounted fresh each time the dialog opens, so it starts from `initialValue`. */
function PromptForm({
  title,
  label,
  initialValue,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) void onConfirm(value.trim())
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="prompt-value">{label}</Label>
        <Input
          id="prompt-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!value.trim()}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
