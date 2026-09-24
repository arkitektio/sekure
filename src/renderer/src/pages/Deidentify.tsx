import { useCallback, useEffect, useRef, useState } from 'react'
import { EyeOff, Loader2, Lock, ShieldCheck, Sparkles, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, displayError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { QuickUnlock } from '@/vault/QuickUnlock'
import type {
  DeidentifyAction,
  DeidentifyView,
  ReviewSegment,
  SpanKind
} from '../../../main/deidentify/protocol'

type Mark = { segment: number; start: number; end: number }
type SpanSegment = Extract<ReviewSegment, { type: 'span' }>

const KIND_STYLE: Partial<Record<SpanKind, string>> & { default: string } = {
  CREDENTIAL: 'bg-destructive/15 text-destructive ring-destructive/40',
  SECRET: 'bg-destructive/15 text-destructive ring-destructive/40',
  PERSON: 'bg-amber-500/15 text-amber-800 ring-amber-500/40 dark:text-amber-300',
  ORG: 'bg-amber-500/15 text-amber-800 ring-amber-500/40 dark:text-amber-300',
  ADDRESS: 'bg-amber-500/15 text-amber-800 ring-amber-500/40 dark:text-amber-300',
  EMAIL: 'bg-sky-500/15 text-sky-800 ring-sky-500/40 dark:text-sky-300',
  PHONE: 'bg-sky-500/15 text-sky-800 ring-sky-500/40 dark:text-sky-300',
  IP: 'bg-sky-500/15 text-sky-800 ring-sky-500/40 dark:text-sky-300',
  IBAN: 'bg-violet-500/15 text-violet-800 ring-violet-500/40 dark:text-violet-300',
  CARD: 'bg-violet-500/15 text-violet-800 ring-violet-500/40 dark:text-violet-300',
  ACCOUNT: 'bg-violet-500/15 text-violet-800 ring-violet-500/40 dark:text-violet-300',
  ID: 'bg-violet-500/15 text-violet-800 ring-violet-500/40 dark:text-violet-300',
  default: 'bg-primary/10 text-primary ring-primary/30'
}

function Chip({
  segment,
  enabled,
  reidentify,
  onToggle
}: {
  segment: SpanSegment
  enabled: boolean
  reidentify: boolean
  onToggle: () => void
}) {
  const style = KIND_STYLE[segment.kind] ?? KIND_STYLE.default
  if (segment.locked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn('mx-0.5 inline-flex items-center gap-1 rounded px-1.5 ring-1', style)}
            data-kind={segment.kind}
          >
            <Lock className="size-3" />
            <span className="text-[10px] font-semibold tracking-wide">CREDENTIAL</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>Matches {segment.label} in your vault. Always removed.</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={enabled}
          data-kind={segment.kind}
          className={cn(
            'mx-0.5 inline-flex items-baseline gap-1 rounded px-1 ring-1 transition-colors',
            enabled
              ? style
              : 'bg-transparent text-foreground ring-dashed ring-border line-through decoration-muted-foreground/50'
          )}
        >
          <span className="text-[10px] font-semibold tracking-wide">
            {reidentify ? '↺' : segment.kind}
          </span>
          <span>{segment.text}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {reidentify
          ? `Restore “${segment.label}”`
          : `${segment.label} · ${segment.source === 'model' ? 'model' : 'pattern'} · click to ${enabled ? 'keep' : 'replace'}`}
      </TooltipContent>
    </Tooltip>
  )
}

/** Plain text, with the user's manual marks highlighted. */
function TextSegment({ text, index, marks }: { text: string; index: number; marks: Mark[] }) {
  const mine = marks.filter((m) => m.segment === index).sort((a, b) => a.start - b.start)
  const parts: React.ReactNode[] = []
  let at = 0
  mine.forEach((m, i) => {
    parts.push(text.slice(at, m.start))
    parts.push(
      <mark key={i} className="rounded bg-primary/20 px-0.5 text-foreground ring-1 ring-primary/40">
        {text.slice(m.start, m.end)}
      </mark>
    )
    at = m.end
  })
  parts.push(text.slice(at))
  return <span data-segment={index}>{parts}</span>
}

/**
 * The deidentify popup (route `#/deidentify`): review what main detected in the
 * selection, toggle spans, and paste the result back in place of the selection.
 */
export function Deidentify() {
  const [view, setView] = useState<DeidentifyView>()
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [marks, setMarks] = useState<Mark[]>([])
  const [pendingMark, setPendingMark] = useState<Mark>()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [openedAt, setOpenedAt] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<number>(undefined)

  const receive = useCallback((v: DeidentifyView | undefined) => {
    if (!v) return
    // A new capture resets the review; a model update of the same one keeps it.
    if (sessionRef.current !== v.sessionId) {
      sessionRef.current = v.sessionId
      setDisabled(new Set())
      setMarks([])
      setPendingMark(undefined)
      setDraft('')
      setError(undefined)
      setOpenedAt(Date.now())
    }
    setView(v)
  }, [])

  useEffect(() => {
    void api.deidentify.current().then(receive)
    return api.deidentify.onView(receive)
  }, [receive])

  const segments = view?.segments ?? []
  const spans = segments.filter((s): s is SpanSegment => s.type === 'span')
  const reidentify = view?.mode === 'reidentify'
  const active = spans.filter((s) => s.locked || !disabled.has(s.id)).length + marks.length

  const apply = useCallback(
    async (action: DeidentifyAction) => {
      if (!view || view.empty || view.needsUnlock || busy) return
      setBusy(true)
      setError(undefined)
      try {
        await api.deidentify.apply(
          {
            enabled: spans.filter((s) => !s.locked && !disabled.has(s.id)).map((s) => s.id),
            manual: marks
          },
          action
        )
      } catch (e) {
        setError(displayError(e))
      } finally {
        setBusy(false)
      }
    },
    [view, busy, spans, disabled, marks]
  )

  // Selecting plain text in the preview offers to redact it too.
  const onMouseUp = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount || reidentify) return setPendingMark(undefined)
    const range = sel.getRangeAt(0)
    const host = (n: Node | null) =>
      (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-segment]')
    const el = host(range.startContainer)
    if (!el || el !== host(range.endContainer)) return setPendingMark(undefined)
    const before = document.createRange()
    before.setStart(el, 0)
    before.setEnd(range.startContainer, range.startOffset)
    const start = before.toString().length
    const text = range.toString()
    const trimmedStart = start + (text.length - text.trimStart().length)
    const end = trimmedStart + text.trim().length
    if (end <= trimmedStart) return setPendingMark(undefined)
    setPendingMark({ segment: Number(el.dataset.segment), start: trimmedStart, end })
  }

  const addMark = () => {
    if (!pendingMark) return
    setMarks((m) => [
      ...m.filter(
        (x) =>
          x.segment !== pendingMark.segment ||
          x.end <= pendingMark.start ||
          x.start >= pendingMark.end
      ),
      pendingMark
    ])
    setPendingMark(undefined)
    window.getSelection()?.removeAllRanges()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      void api.deidentify.dismiss()
    } else if (e.key === 'Enter' && !e.shiftKey && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
      void apply('paste')
    } else if (
      (e.metaKey || e.ctrlKey) &&
      e.key.toLowerCase() === 'c' &&
      !(e.target instanceof HTMLTextAreaElement) &&
      !window.getSelection()?.toString()
    ) {
      e.preventDefault()
      void apply('copy')
    } else if (e.key.toLowerCase() === 'r' && pendingMark && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      addMark()
    }
  }

  useEffect(() => {
    if (view && !view.empty && !view.needsUnlock) bodyRef.current?.focus()
  }, [view])

  if (!view) return <div className="h-screen bg-popover" />

  const model = view.model
  return (
    <div
      className="flex h-screen flex-col overflow-hidden border bg-popover text-popover-foreground outline-none"
      onKeyDown={onKeyDown}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        {reidentify ? (
          <Undo2 className="size-4 text-primary" />
        ) : (
          <EyeOff className="size-4 text-primary" />
        )}
        <span className="font-medium">{reidentify ? 'Restore originals' : 'Deidentify'}</span>
        {view.targetName && (
          <span className="truncate text-muted-foreground">from {view.targetName}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!view.empty && !view.needsUnlock && (view.restorable > 0 || reidentify) && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void api.deidentify.setMode(reidentify ? 'deidentify' : 'reidentify')}
            >
              {reidentify ? 'Deidentify instead' : `Restore ${view.restorable} placeholders`}
            </Button>
          )}
        </div>
      </header>

      {view.needsUnlock ? (
        <div className="min-h-0 flex-1">
          <p className="flex items-center gap-2 px-4 pt-3 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            Unlock your vault so the text can be checked against your credentials.
          </p>
          <QuickUnlock
            openedAt={openedAt}
            keepOpen={api.deidentify.keepOpen}
            onUnlocked={() => {
              // Main re-runs detection on unlock and sends a new view.
            }}
          />
        </div>
      ) : view.empty ? (
        <form
          className="flex min-h-0 flex-1 flex-col gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft.trim()) void api.deidentify.submitText(draft)
          }}
        >
          <p className="text-sm text-muted-foreground">
            No selected text could be read. Paste the text to check here.
          </p>
          <Textarea
            autoFocus
            className="min-h-0 flex-1 resize-none font-mono text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                if (draft.trim()) void api.deidentify.submitText(draft)
              }
            }}
          />
          <Button type="submit" size="sm" className="self-end" disabled={!draft.trim()}>
            Check text <Kbd>⌘↵</Kbd>
          </Button>
        </form>
      ) : (
        <div
          ref={bodyRef}
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm leading-7 whitespace-pre-wrap outline-none"
          onMouseUp={onMouseUp}
          data-selectable
        >
          {segments.map((s, i) =>
            s.type === 'text' ? (
              <TextSegment key={i} text={s.text} index={i} marks={marks} />
            ) : (
              <Chip
                key={s.id}
                segment={s}
                reidentify={reidentify}
                enabled={!disabled.has(s.id)}
                onToggle={() =>
                  setDisabled((d) => {
                    const next = new Set(d)
                    if (next.has(s.id)) next.delete(s.id)
                    else next.add(s.id)
                    return next
                  })
                }
              />
            )
          )}
        </div>
      )}

      {pendingMark && (
        <div className="flex items-center justify-between border-t bg-muted/40 px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Replace the selected text as well?</span>
          <Button size="xs" onClick={addMark}>
            Also redact <Kbd>R</Kbd>
          </Button>
        </div>
      )}

      <footer className="flex items-center gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
        {error ? (
          <span className="truncate text-destructive">{error}</span>
        ) : view.empty || view.needsUnlock ? (
          <span>
            <Kbd>esc</Kbd> close
          </span>
        ) : (
          <>
            <span className="tabular-nums">
              {reidentify ? `${active} to restore` : `${active} to replace`}
            </span>
            {!reidentify && <ModelState model={model} />}
            <span className="ml-auto flex items-center gap-3">
              {busy && <Loader2 className="size-3 animate-spin" />}
              <span>
                <Kbd>↵</Kbd> {reidentify ? 'restore' : 'replace'} selection
              </span>
              <span>
                <Kbd>⌘C</Kbd> copy
              </span>
              <span>
                <Kbd>esc</Kbd> cancel
              </span>
            </span>
          </>
        )}
      </footer>
    </div>
  )
}

function ModelState({ model }: { model: DeidentifyView['model'] }) {
  if (model.state === 'off') {
    return <span>Names & addresses: model off (Settings)</span>
  }
  if (model.state === 'running' || model.state === 'loading') {
    return (
      <span className="flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" /> Looking for names and addresses…
      </span>
    )
  }
  if (model.state === 'error') return <span className="text-destructive">{model.message}</span>
  if (model.state === 'downloading') {
    return <span>Model downloading… {Math.round((model.progress ?? 0) * 100)}%</span>
  }
  return (
    <span className="flex items-center gap-1">
      <Sparkles className="size-3 text-primary" /> Checked by the local PII model
    </span>
  )
}
