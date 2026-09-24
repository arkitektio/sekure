import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Eye, EyeOff, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
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
import { ALL_ENTRIES, useVault } from '@/stores/vault'
import { api, displayError, entryTitle, formatDate } from '@/lib/api'
import { cn } from '@/lib/utils'
import { renderSummaryIcon } from './icons'
import { countryName, expiryStatus, flag, formatDay, type ExpiryStatus } from './typedValues'
import {
  getType,
  loginType,
  PERSON_TYPE,
  type EntryType,
  type TypeField
} from '../../../main/vault/entryTypes'
import { EntryPeople } from './PeoplePicker'
import { linkedTo, personFilterId } from './people'
import { clickOptions } from './tabs'
import { Attachments, attachFiles } from './Attachments'
import type { TotpCode, VaultEntryDetail } from '../../../main/vault/protocol'

/** Entry URLs open in the default browser; main validates the scheme. */
const openUrl = async (url: string) => {
  try {
    await api.shell.openUrl(url)
  } catch (e) {
    toast.error(displayError(e))
  }
}

const copyField = async (uuid: string, field: string, label: string) => {
  try {
    await api.vault.copy(uuid, field)
    toast.success(`${label} copied`, { description: 'Clipboard clears in 30 seconds' })
  } catch (e) {
    toast.error(displayError(e))
  }
}

function CopyButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" onClick={onClick} aria-label={`Copy ${label}`}>
          <Copy />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy {label.toLowerCase()}</TooltipContent>
    </Tooltip>
  )
}

function FieldRow({
  label,
  children,
  actions
}: {
  label: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="group grid grid-cols-[7rem_1fr_auto] items-center gap-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm" data-selectable>
        {children}
      </div>
      <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100">
        {actions}
      </div>
    </div>
  )
}

/** How long a revealed value stays on screen. */
const REVEAL_MS = 30_000

/**
 * A protected value: masked until revealed, fetched from main on demand, and
 * masked again after 30 s or when the window loses focus.
 */
function SecretRow({
  uuid,
  field,
  label,
  multiline
}: {
  uuid: string
  field: string
  label: string
  multiline?: boolean
}) {
  const [value, setValue] = useState<string>()

  useEffect(() => {
    if (value === undefined) return
    const hide = () => setValue(undefined)
    const t = setTimeout(hide, REVEAL_MS)
    window.addEventListener('blur', hide)
    return () => {
      clearTimeout(t)
      window.removeEventListener('blur', hide)
    }
  }, [value])

  const toggle = async () => {
    if (value !== undefined) return setValue(undefined)
    try {
      setValue(await api.vault.reveal(uuid, field))
    } catch (e) {
      toast.error(displayError(e))
    }
  }

  return (
    <FieldRow
      label={label}
      actions={
        <>
          <Button variant="ghost" size="icon-xs" onClick={toggle} aria-label="Reveal">
            {value !== undefined ? <EyeOff /> : <Eye />}
          </Button>
          <CopyButton label={label} onClick={() => void copyField(uuid, field, label)} />
        </>
      }
    >
      <span className={cn('font-mono break-all', multiline && 'text-xs whitespace-pre-wrap')}>
        {value ?? '••••••••••••'}
      </span>
    </FieldRow>
  )
}

function OtpRow({ uuid }: { uuid: string }) {
  const [code, setCode] = useState<TotpCode | null>()
  useEffect(() => {
    let alive = true
    const tick = () =>
      api.vault
        .otp(uuid)
        .then((c) => alive && setCode(c))
        .catch(() => alive && setCode(null))
    void tick()
    const t = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [uuid])
  if (code === null) return null

  return (
    <FieldRow
      label="One-time code"
      actions={
        <CopyButton
          label="Code"
          onClick={() =>
            void api.vault.copyOtp(uuid).then(() => toast.success('One-time code copied'))
          }
        />
      }
    >
      {code && (
        <span className="flex items-center gap-3">
          <span className="font-mono text-base tracking-widest tabular-nums">
            {code.code.slice(0, Math.ceil(code.code.length / 2))}{' '}
            {code.code.slice(Math.ceil(code.code.length / 2))}
          </span>
          <span
            className="relative size-4 rounded-full"
            style={{
              background: `conic-gradient(var(--primary) ${(code.remaining / code.period) * 360}deg, var(--muted) 0)`
            }}
            title={`${code.remaining}s`}
          />
        </span>
      )}
    </FieldRow>
  )
}

/** On a Person's page: what belongs to them, by type. */
function PersonItems({ person }: { person: string }) {
  const snapshot = useVault((s) => s.snapshot)
  const selectEntry = useVault((s) => s.selectEntry)
  const selectGroup = useVault((s) => s.selectGroup)
  const items = linkedTo(snapshot, person).sort(
    (a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title)
  )
  return (
    <section className="mt-6" aria-label="Items">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground uppercase">
          Items <span className="tabular-nums">{items.length}</span>
        </h3>
        <div className="flex gap-1">
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={(e) => selectGroup(personFilterId(person), clickOptions(e))}
            >
              Show all
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              // The wizard, with this person preset.
              useVault.getState().open({ kind: 'create', people: [person] })
            }}
          >
            <Plus /> Add
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Nothing linked yet. Link documents and logins from their page, or add one here.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((e) => (
            <li key={e.uuid}>
              <button
                onClick={(ev) => selectEntry(e.uuid, clickOptions(ev))}
                onAuxClick={(ev) => ev.button === 1 && selectEntry(e.uuid, clickOptions(ev))}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm first:rounded-t-xl last:rounded-b-xl hover:bg-muted/60"
              >
                <span className="text-muted-foreground">{renderSummaryIcon(e, 'size-4')}</span>
                <span className="min-w-0 flex-1 truncate">{entryTitle(e)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {getType(e.type)?.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function EntryDetail({ uuid }: { uuid: string }) {
  const snapshot = useVault((s) => s.snapshot)
  const setEditing = useVault((s) => s.setEditing)
  const [entry, setEntry] = useState<VaultEntryDetail>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Re-read on every snapshot change: edits, attachment changes, merges.
  useEffect(() => {
    let alive = true
    api.vault
      .entry(uuid)
      .then((e) => alive && setEntry(e))
      .catch(() => alive && setEntry(undefined))
    return () => {
      alive = false
    }
  }, [uuid, snapshot])

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea')) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      void attachFiles(
        uuid,
        files.map((f) =>
          f.name && f.name !== 'image.png'
            ? f
            : new File([f], `pasted-${stamp}.${f.type.split('/')[1] ?? 'png'}`, { type: f.type })
        )
      )
    },
    [uuid]
  )
  useEffect(() => {
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onPaste])

  if (!entry) return null
  const type = getType(entry.type) ?? loginType()

  const remove = async () => {
    try {
      await api.vault.deleteEntry(uuid)
      // Back to where the entry was opened from (usually its list).
      const { tabs, activeTab, back, replace } = useVault.getState()
      const tab = tabs.find((t) => t.id === activeTab)
      if (tab && tab.index > 0) back()
      else replace({ kind: 'list', scope: ALL_ENTRIES })
      toast.success('Moved to recycle bin')
    } catch (e) {
      toast.error(displayError(e))
    }
  }

  return (
    <div
      className="relative h-full"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void attachFiles(uuid, Array.from(e.dataTransfer.files))
      }}
    >
      <ScrollArea className="h-full">
        <div className="mx-auto max-w-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              {renderSummaryIcon(entry, 'size-6')}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-semibold tracking-tight" data-selectable>
                {entryTitle(entry)}
              </h2>
              {type.id !== 'login' && (
                <div className="text-xs text-muted-foreground">{type.label}</div>
              )}
              {entry.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {entry.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(uuid)}>
              <Pencil /> Edit
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete entry"
            >
              <Trash2 />
            </Button>
          </div>
          <EntryPeople uuid={uuid} />

          {/* Keyed by modification time: a merge or edit re-masks revealed values. */}
          {type.id === 'login' ? (
            <LoginRows key={entry.modified} entry={entry} />
          ) : (
            <TypedView key={entry.modified} entry={entry} type={type} />
          )}

          {entry.typeDetected && (
            <p className="mt-3 text-xs text-muted-foreground">
              Recognised as {type.label.toLowerCase()} from its fields. Saving an edit records the
              type in the file.
            </p>
          )}

          {entry.protectedFields.includes('Notes') && (
            <div className="mt-6 rounded-xl border bg-card px-4">
              <SecretRow
                uuid={uuid}
                field="Notes"
                label={type.id === 'secureNote' ? 'Note' : 'Notes'}
                multiline
              />
            </div>
          )}
          {entry.notes && (
            <section className="mt-6">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground uppercase">
                {type.id === 'secureNote' ? 'Note' : 'Notes'}
              </h3>
              <p
                className="rounded-xl border bg-card p-4 text-sm whitespace-pre-wrap"
                data-selectable
              >
                {entry.notes}
              </p>
            </section>
          )}

          {type.id === PERSON_TYPE && <PersonItems person={uuid} />}

          <div className="mt-6">
            <Attachments entryUuid={uuid} attachments={entry.attachments} />
          </div>

          <Separator className="my-6" />
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-xs text-muted-foreground">
            <dt>Modified</dt>
            <dd>{formatDate(entry.modified)}</dd>
            <dt>Created</dt>
            <dd>{formatDate(entry.created)}</dd>
            {entry.expires && (
              <>
                <dt>Expires</dt>
                <dd>{formatDate(entry.expires)}</dd>
              </>
            )}
            <dt>History</dt>
            <dd>{entry.historyCount} previous versions</dd>
          </dl>
        </div>
      </ScrollArea>

      <div
        className={cn(
          'pointer-events-none absolute inset-3 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm transition-opacity',
          dragging ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div className="flex flex-col items-center gap-2 text-primary">
          <Upload className="size-8" />
          <span className="font-medium">Drop to attach to “{entryTitle(entry)}”</span>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{entryTitle(entry)}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The entry moves to the recycle bin. The change reaches Google Drive when you save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const OTP_KEYS = new Set(['otp', 'TOTP Seed'])
const NO_KEYS = new Set<string>()

/** Custom fields as plain rows: protected ones masked until revealed. */
function CustomFieldRows({ entry, skip }: { entry: VaultEntryDetail; skip: Set<string> }) {
  return (
    <>
      {entry.customFields
        .filter((f) => !OTP_KEYS.has(f.key) && !skip.has(f.key))
        .map((f) =>
          f.protected ? (
            <SecretRow key={f.key} uuid={entry.uuid} field={f.key} label={f.key} />
          ) : (
            <FieldRow
              key={f.key}
              label={f.key}
              actions={
                <CopyButton
                  label={f.key}
                  onClick={() => void copyField(entry.uuid, f.key, f.key)}
                />
              }
            >
              <span className="break-all">{f.value}</span>
            </FieldRow>
          )
        )}
    </>
  )
}

function LoginRows({ entry }: { entry: VaultEntryDetail }) {
  const isProtected = (k: string) => entry.protectedFields.includes(k as 'UserName')
  return (
    <div className="mt-6 divide-y rounded-xl border bg-card px-4">
      {isProtected('UserName') ? (
        <SecretRow uuid={entry.uuid} field="UserName" label="Username" />
      ) : (
        <FieldRow
          label="Username"
          actions={
            entry.username && (
              <CopyButton
                label="Username"
                onClick={() => void copyField(entry.uuid, 'UserName', 'Username')}
              />
            )
          }
        >
          {entry.username || <span className="text-muted-foreground">—</span>}
        </FieldRow>
      )}
      {entry.hasPassword && <SecretRow uuid={entry.uuid} field="Password" label="Password" />}
      {entry.hasOtp && <OtpRow uuid={entry.uuid} />}
      {isProtected('URL') && <SecretRow uuid={entry.uuid} field="URL" label="Website" />}
      {entry.url && (
        <FieldRow
          label="Website"
          actions={
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void openUrl(entry.url)}
                aria-label="Open website"
              >
                <ExternalLink />
              </Button>
              <CopyButton label="URL" onClick={() => void copyField(entry.uuid, 'URL', 'URL')} />
            </>
          }
        >
          <span className="truncate text-primary">{entry.url}</span>
        </FieldRow>
      )}
      <CustomFieldRows entry={entry} skip={NO_KEYS} />
    </div>
  )
}

/** The value of a type field as far as the renderer can see it (protected → undefined). */
function plainValue(entry: VaultEntryDetail, f: TypeField): string | undefined {
  if (f.standard && entry.protectedFields.includes(f.standard as 'UserName')) return undefined
  if (f.standard === 'UserName') return entry.username
  if (f.standard === 'URL') return entry.url
  const custom = entry.customFields.find((c) => c.key === f.key)
  return custom?.protected ? undefined : (custom?.value ?? '')
}

function hasValue(entry: VaultEntryDetail, f: TypeField): boolean {
  if (f.standard === 'Password') return entry.hasPassword
  if (f.standard && entry.protectedFields.includes(f.standard as 'UserName')) return true
  const custom = entry.customFields.find((c) => c.key === f.key)
  if (custom?.protected) return true
  return !!plainValue(entry, f)
}

function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  return (
    <Badge
      variant={status.tone === 'expired' ? 'destructive' : 'secondary'}
      className={cn(status.tone === 'soon' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400')}
    >
      {status.label}
    </Badge>
  )
}

function FieldValue({ field, value }: { field: TypeField; value: string }) {
  switch (field.kind) {
    case 'date':
      return <span>{formatDay(value)}</span>
    case 'country':
      return (
        <span>
          {flag(value)} {countryName(value)}{' '}
          <span className="text-xs text-muted-foreground">{value}</span>
        </span>
      )
    case 'iban':
    case 'bic':
    case 'expiry':
      return <span className="font-mono tracking-wide">{value}</span>
    case 'multiline':
      return <span className="font-mono text-xs break-all whitespace-pre-wrap">{value}</span>
    default:
      if (field.formats) return <span className="font-mono tracking-wide">{value}</span>
      return field.standard === 'URL' ? (
        <span className="truncate text-primary">{value}</span>
      ) : (
        <span className="break-all">{value}</span>
      )
  }
}

/** A Sekure-typed entry: a summary card for the type, then its fields in type order. */
function TypedView({ entry, type }: { entry: VaultEntryDetail; type: EntryType }) {
  const value = (key: string) => {
    const f = type.fields.find((d) => d.key === key)
    return f ? (plainValue(entry, f) ?? '') : ''
  }
  const expiryValue = type.expiryField ? value(type.expiryField) : ''
  const expiry = expiryValue ? expiryStatus(expiryValue) : undefined
  const shown = type.fields.filter((f) => hasValue(entry, f))

  return (
    <>
      {type.group === 'identity' && <IdentityCard type={type} value={value} expiry={expiry} />}
      {type.id === 'creditCard' && <PaymentCard value={value} />}

      <div className="mt-6 divide-y rounded-xl border bg-card px-4">
        {shown.map((f) => {
          if (plainValue(entry, f) === undefined || f.standard === 'Password') {
            return <SecretRow key={f.key} uuid={entry.uuid} field={f.key} label={f.label} />
          }
          const v = plainValue(entry, f) ?? ''
          return (
            <FieldRow
              key={f.key}
              label={f.label}
              actions={
                <>
                  {f.standard === 'URL' && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void openUrl(v)}
                      aria-label="Open website"
                    >
                      <ExternalLink />
                    </Button>
                  )}
                  <CopyButton
                    label={f.label}
                    onClick={() => void copyField(entry.uuid, f.key, f.label)}
                  />
                </>
              }
            >
              <span className="flex items-center gap-2">
                <FieldValue field={f} value={v} />
                {f.key === type.expiryField && expiry && expiry.tone !== 'ok' && (
                  <ExpiryBadge status={expiry} />
                )}
              </span>
            </FieldRow>
          )
        })}
        {entry.hasOtp && <OtpRow uuid={entry.uuid} />}
        <CustomFieldRows entry={entry} skip={new Set(type.fields.map((f) => f.key))} />
      </div>
      {shown.length === 0 && type.fields.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">No details yet. Edit to fill them in.</p>
      )}
    </>
  )
}

function IdentityCard({
  type,
  value,
  expiry
}: {
  type: EntryType
  value: (key: string) => string
  expiry: ExpiryStatus | undefined
}) {
  const numberKey = type.signature[0]
  const country = value('Issuing country') || value('Nationality')
  const name = [value('Given names'), value('Surname')].filter(Boolean).join(' ')
  return (
    <div className="mt-6 overflow-hidden rounded-xl border bg-gradient-to-br from-primary/10 via-card to-card">
      <div className="flex items-center justify-between border-b border-primary/10 px-4 py-2 text-xs font-medium tracking-wider text-primary uppercase">
        <span>{type.label}</span>
        {country && (
          <span className="normal-case">
            {flag(country)} {countryName(country)}
          </span>
        )}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold" data-selectable>
            {name || '—'}
          </div>
          <div className="font-mono text-sm tracking-widest text-muted-foreground" data-selectable>
            {value(numberKey) || '—'}
          </div>
        </div>
        <div className="grid content-start justify-items-end gap-1 text-xs text-muted-foreground">
          {value('Date of birth') && <span>Born {formatDay(value('Date of birth'))}</span>}
          {type.expiryField && value(type.expiryField) && (
            <span>Valid until {formatDay(value(type.expiryField))}</span>
          )}
          {expiry && <ExpiryBadge status={expiry} />}
        </div>
      </div>
    </div>
  )
}

function PaymentCard({ value }: { value: (key: string) => string }) {
  const expiry = value('Expiry')
  const status = expiry ? expiryStatus(expiry) : undefined
  return (
    <div className="mt-6 aspect-[1.586] w-full max-w-sm rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-950 p-5 text-zinc-50 shadow-lg">
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <span className="text-sm font-semibold tracking-wide">
            {value('Card issuer') || 'Card'}
          </span>
          {status && status.tone !== 'ok' && <ExpiryBadge status={status} />}
        </div>
        <div className="font-mono text-lg tracking-[0.2em] text-zinc-300">•••• •••• •••• ••••</div>
        <div className="flex items-end justify-between text-xs">
          <div>
            <div className="text-[10px] text-zinc-400 uppercase">Cardholder</div>
            <div className="font-medium tracking-wide uppercase">{value('Cardholder') || '—'}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-zinc-400 uppercase">Expires</div>
            <div className="font-mono">{expiry || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
