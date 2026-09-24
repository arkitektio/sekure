import { useEffect, useState } from 'react'
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Lock, LockOpen, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { groupForNew, useVault } from '@/stores/vault'
import { api, displayError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PasswordGenerator } from './PasswordGenerator'
import { renderTypeIcon } from './icons'
import { COUNTRY_CODES, countryName } from './typedValues'
import {
  ENTRY_TYPE_GROUPS,
  ENTRY_TYPES,
  getType,
  loginType,
  normalizeValue,
  suggestTitle,
  validateValue,
  type EntryType,
  type TypeField
} from '../../../main/vault/entryTypes'
import type { EntryInput } from '../../../main/vault/protocol'

const schema = z.object({
  type: z.string(),
  title: z.string().trim(),
  username: z.string(),
  password: z.string(),
  /** The existing password, not loaded into the form: kept unless changed. */
  passwordUntouched: z.boolean(),
  url: z.string(),
  tags: z.string(),
  notes: z.string(),
  /** Every non-standard field: the type's fields and any extra custom ones. */
  customFields: z.array(
    z.object({
      key: z.string().trim().min(1, 'Name required'),
      value: z.string(),
      protected: z.boolean(),
      /** Existing protected value the user has not touched: keep as-is. */
      untouched: z.boolean()
    })
  )
})
type FormValues = z.infer<typeof schema>
type Form = UseFormReturn<FormValues>
type StandardName = 'username' | 'password' | 'url'

const RESERVED = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes'])
const STANDARD_INPUT: Record<string, StandardName> = {
  UserName: 'username',
  Password: 'password',
  URL: 'url'
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

/** Make sure every custom field of `type` has a row, so typed inputs can bind to it. */
function withTypeRows(type: EntryType, rows: FormValues['customFields']) {
  const present = new Set(rows.map((r) => r.key))
  const missing = type.fields
    .filter((f) => !f.standard && !present.has(f.key))
    .map((f) => ({ key: f.key, value: '', protected: !!f.protected, untouched: false }))
  return [...rows, ...missing]
}

export function EntryForm({ uuid }: { uuid: string | 'new' }) {
  const isNew = uuid === 'new'
  const selectedGroup = useVault((s) => s.selectedGroup)
  const newEntryType = useVault((s) => s.newEntryType)
  const setEditing = useVault((s) => s.setEditing)
  const selectEntry = useVault((s) => s.selectEntry)
  const [loaded, setLoaded] = useState(isNew)

  const initialType = getType(newEntryType) ?? loginType()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: initialType.id,
      title: '',
      username: '',
      password: '',
      passwordUntouched: false,
      url: '',
      tags: '',
      notes: '',
      customFields: withTypeRows(initialType, [])
    }
  })
  const fields = useFieldArray({ control: form.control, name: 'customFields' })
  const type = getType(form.watch('type')) ?? loginType()

  useEffect(() => {
    if (isNew) return
    let alive = true
    void (async () => {
      const entry = await api.vault.entry(uuid)
      // The password stays in main until the user reveals or replaces it.
      // Protected Title/UserName/URL/Notes (rare: set in KeePass) are loaded
      // because the form edits them as plain inputs.
      const standard = async (field: 'Title' | 'UserName' | 'URL' | 'Notes', plain: string) =>
        entry.protectedFields.includes(field) ? api.vault.reveal(uuid, field) : plain
      const [title, username, url, notes] = await Promise.all([
        standard('Title', entry.title),
        standard('UserName', entry.username),
        standard('URL', entry.url),
        standard('Notes', entry.notes)
      ])
      if (!alive) return
      const entryType = getType(entry.type) ?? loginType()
      form.reset({
        type: entryType.id,
        title,
        username,
        password: '',
        passwordUntouched: entry.hasPassword,
        url,
        tags: entry.tags.join(', '),
        notes,
        customFields: withTypeRows(
          entryType,
          entry.customFields.map((f) => ({
            key: f.key,
            value: f.value ?? '',
            protected: f.protected,
            untouched: f.protected
          }))
        )
      })
      setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [uuid, isNew, form])

  const changeType = (id: string) => {
    const next = getType(id)
    if (!next) return
    form.setValue('type', id)
    const rows = form.getValues('customFields')
    for (const row of withTypeRows(next, rows).slice(rows.length)) fields.append(row)
  }

  const cancel = () => setEditing(undefined)

  const submit = form.handleSubmit(async (v) => {
    const t = getType(v.type) ?? loginType()
    const rows = v.customFields
    const keys = rows.map((f) => f.key)
    const clash = keys.find((k, i) => RESERVED.has(k) || keys.indexOf(k) !== i)
    if (clash) {
      form.setError('customFields', { message: `Field name “${clash}” is reserved or duplicated` })
      return
    }

    // Per-field checks from the type registry.
    let invalid = false
    for (const f of t.fields) {
      const std = STANDARD_INPUT[f.key]
      const i = keys.indexOf(f.key)
      const path = f.standard ? std : (`customFields.${i}.value` as const)
      const value = f.standard ? v[std] : (rows[i]?.value ?? '')
      const kept = f.standard ? f.key === 'Password' && v.passwordUntouched : rows[i]?.untouched
      const problem =
        f.required && !kept && !value.trim()
          ? `${f.label} is required`
          : validateValue(f.kind, value)
      if (problem) {
        form.setError(path, { message: problem })
        invalid = true
      }
    }
    if (!v.title && t.id === 'login') {
      form.setError('title', { message: 'Title is required' })
      invalid = true
    }
    if (invalid) return

    const typeKeys = new Set(t.fields.map((f) => f.key))
    const valueOf = (key: string) => {
      const std = STANDARD_INPUT[key]
      return std ? v[std] : (rows.find((r) => r.key === key)?.value ?? '')
    }
    const input: EntryInput = {
      type: t.id,
      title: v.title || suggestTitle(t, valueOf),
      username: v.username,
      password: v.passwordUntouched ? undefined : v.password,
      url: v.url.trim(),
      notes: v.notes,
      tags: v.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      customFields: rows
        // Empty, never-filled type fields are not worth a column in other KeePass apps.
        .filter((f) => !(typeKeys.has(f.key) && !f.untouched && !f.value.trim()))
        .map((f) => {
          const def = t.fields.find((d) => d.key === f.key)
          return {
            key: f.key,
            protected: f.protected || !!def?.protected,
            value: f.untouched ? undefined : def ? normalizeValue(def.kind, f.value) : f.value
          }
        })
    }
    try {
      if (isNew) {
        const { result } = await api.vault.createEntry(groupForNew(selectedGroup), input)
        selectEntry(result)
      } else {
        await api.vault.updateEntry(uuid, input)
        setEditing(undefined)
      }
    } catch (e) {
      toast.error(displayError(e))
    }
  })

  if (!loaded) return null
  const errors = form.formState.errors
  const rows = form.watch('customFields')
  const typeKeys = new Set(type.fields.map((f) => f.key))
  const titlePlaceholder =
    type.id === 'login'
      ? undefined
      : suggestTitle(type, (k) => {
          const std = STANDARD_INPUT[k]
          return std ? form.watch(std) : (rows.find((r) => r.key === k)?.value ?? '')
        })

  return (
    <form
      onSubmit={submit}
      className="flex h-full flex-col"
      onKeyDown={(e) => e.key === 'Escape' && cancel()}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto grid max-w-2xl gap-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              {renderTypeIcon(type.id, 'size-5')}
            </div>
            <h2 className="flex-1 text-lg font-semibold tracking-tight">
              {isNew ? `New ${type.label.toLowerCase()}` : `Edit ${type.label.toLowerCase()}`}
            </h2>
            {!isNew && (
              <select
                aria-label="Entry type"
                className={cn(selectClass, 'w-auto')}
                value={type.id}
                onChange={(e) => changeType(e.target.value)}
              >
                {ENTRY_TYPE_GROUPS.map((g) => (
                  <optgroup key={g.id} label={g.label}>
                    {ENTRY_TYPES.filter((t) => t.group === g.id).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              autoFocus
              placeholder={titlePlaceholder}
              {...form.register('title')}
              aria-invalid={!!errors.title}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {type.fields.map((f) => {
              const wide =
                f.kind === 'multiline' || f.standard === 'URL' || f.standard === 'Password'
              return (
                <div
                  key={f.key}
                  className={cn('grid content-start gap-2', wide && 'sm:col-span-2')}
                >
                  {f.standard ? (
                    <StandardInput
                      form={form}
                      field={f}
                      name={STANDARD_INPUT[f.key]}
                      isNew={isNew}
                      uuid={isNew ? undefined : uuid}
                    />
                  ) : (
                    <TypedInput
                      form={form}
                      field={f}
                      index={rows.findIndex((r) => r.key === f.key)}
                      uuid={isNew ? undefined : uuid}
                    />
                  )}
                </div>
              )
            })}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tags">Tags</Label>
            <Input id="tags" placeholder="work, banking" {...form.register('tags')} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">{type.id === 'secureNote' ? 'Note' : 'Notes'}</Label>
            <Textarea
              id="notes"
              rows={type.id === 'secureNote' ? 12 : 4}
              {...form.register('notes')}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>{type.id === 'login' ? 'Custom fields' : 'Extra fields'}</Label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() =>
                  fields.append({ key: '', value: '', protected: false, untouched: false })
                }
              >
                <Plus /> Add field
              </Button>
            </div>
            {fields.fields.map((f, i) => {
              if (typeKeys.has(rows[i]?.key ?? f.key)) return null
              const isProtected = rows[i]?.protected
              const untouched = rows[i]?.untouched
              return (
                <div key={f.id} className="flex gap-2">
                  <Input
                    placeholder="Name"
                    className="w-40"
                    {...form.register(`customFields.${i}.key`)}
                  />
                  <Input
                    placeholder={untouched ? '•••••••• (unchanged)' : 'Value'}
                    type={isProtected ? 'password' : 'text'}
                    className="flex-1"
                    {...form.register(`customFields.${i}.value`, {
                      onChange: () => form.setValue(`customFields.${i}.untouched`, false)
                    })}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => form.setValue(`customFields.${i}.protected`, !isProtected)}
                        // Changing protection rewrites the value, so it must be known first.
                        disabled={untouched}
                        aria-label="Toggle protection"
                      >
                        {isProtected ? <Lock /> : <LockOpen />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isProtected ? 'Protected (hidden, encrypted in memory)' : 'Plain field'}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => fields.remove(i)}
                    aria-label="Remove field"
                  >
                    <X />
                  </Button>
                </div>
              )
            })}
            {errors.customFields?.message && (
              <p className="text-xs text-destructive">{errors.customFields.message}</p>
            )}
          </div>

          {type.fields.some((f) => f.kind === 'country') && <CountryList />}

          {isNew && (
            <p className="text-xs text-muted-foreground">
              You can attach images and PDFs once the entry is created.
            </p>
          )}
        </div>
      </ScrollArea>
      <div className="flex justify-end gap-2 border-t px-6 py-3">
        <Button type="button" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {isNew ? 'Create' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

/** Username / Password / URL, with the type's label. */
function StandardInput({
  form,
  field,
  name,
  isNew,
  uuid
}: {
  form: Form
  field: TypeField
  name: StandardName
  isNew: boolean
  uuid: string | undefined
}) {
  const [show, setShow] = useState(isNew)
  const error = form.formState.errors[name]
  const id = `std-${name}`
  const untouched = form.watch('passwordUntouched')

  // The existing password is fetched only when the user asks to see it.
  const togglePassword = async () => {
    if (show) return setShow(false)
    if (untouched && uuid) {
      try {
        form.setValue('password', await api.vault.reveal(uuid, 'Password'))
        form.setValue('passwordUntouched', false)
      } catch (e) {
        toast.error(displayError(e))
        return
      }
    }
    setShow(true)
  }
  return (
    <>
      <Label htmlFor={id}>{field.label}</Label>
      {name === 'password' ? (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id={id}
              type={show ? 'text' : 'password'}
              autoComplete="off"
              className="pr-9 font-mono"
              placeholder={untouched ? '•••••••• (unchanged)' : undefined}
              aria-invalid={!!error}
              {...form.register('password', {
                onChange: () => form.setValue('passwordUntouched', false)
              })}
            />
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => void togglePassword()}
              aria-label={show ? `Hide ${field.label}` : `Show ${field.label}`}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <PasswordGenerator
            onUse={(pw) => {
              form.setValue('password', pw, { shouldDirty: true })
              form.setValue('passwordUntouched', false)
              setShow(true)
            }}
          />
        </div>
      ) : (
        <Input
          id={id}
          autoComplete="off"
          placeholder={field.placeholder}
          aria-invalid={!!error}
          {...form.register(name)}
        />
      )}
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </>
  )
}

/** One of the type's own fields, bound to its row in `customFields`. */
function TypedInput({
  form,
  field,
  index,
  uuid
}: {
  form: Form
  field: TypeField
  index: number
  uuid: string | undefined
}) {
  const [show, setShow] = useState(false)
  if (index < 0) return null
  const path = `customFields.${index}` as const
  const untouched = form.watch(`${path}.untouched`)
  const error = form.formState.errors.customFields?.[index]?.value
  const id = `field-${index}`
  const reg = form.register(`${path}.value`, {
    onChange: () => form.setValue(`${path}.untouched`, false)
  })
  const mono = ['iban', 'bic', 'cardNumber', 'expiry'].includes(field.kind)
  const placeholder = untouched ? '•••••••• (unchanged)' : field.placeholder

  // Protected values arrive masked; revealing loads them so they can be edited.
  const toggleSecret = async () => {
    if (show) return setShow(false)
    if (untouched && uuid) {
      try {
        form.setValue(`${path}.value`, await api.vault.reveal(uuid, field.key))
        form.setValue(`${path}.untouched`, false)
      } catch (e) {
        toast.error(displayError(e))
        return
      }
    }
    setShow(true)
  }

  let control: React.ReactNode
  if (field.kind === 'select') {
    control = (
      <select id={id} className={selectClass} {...reg}>
        <option value="">—</option>
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  } else if (field.kind === 'multiline') {
    const masked = field.protected && !show
    control = (
      <div className="relative">
        <Textarea
          id={id}
          rows={field.protected ? 5 : 3}
          placeholder={placeholder}
          className="font-mono text-xs"
          style={masked ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties) : undefined}
          aria-invalid={!!error}
          {...reg}
        />
        {field.protected && (
          <RevealButton shown={show} label={field.label} onClick={toggleSecret} top />
        )}
      </div>
    )
  } else {
    const secret = field.protected
    control = (
      <div className="relative">
        <Input
          id={id}
          type={field.kind === 'date' ? 'date' : secret && !show ? 'password' : 'text'}
          autoComplete="off"
          placeholder={placeholder}
          maxLength={field.kind === 'country' ? 3 : undefined}
          list={field.kind === 'country' ? 'sekure-countries' : undefined}
          className={cn((mono || secret) && 'font-mono', secret && 'pr-9')}
          aria-invalid={!!error}
          {...reg}
        />
        {secret && <RevealButton shown={show} label={field.label} onClick={toggleSecret} />}
      </div>
    )
  }

  return (
    <>
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="text-muted-foreground">*</span>}
      </Label>
      {control}
      {error && <p className="text-xs text-destructive">{error.message}</p>}
    </>
  )
}

function RevealButton({
  shown,
  label,
  onClick,
  top = false
}: {
  shown: boolean
  label: string
  onClick: () => void
  top?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'absolute right-2 rounded p-1 text-muted-foreground hover:text-foreground',
        top ? 'top-2' : 'top-1/2 -translate-y-1/2'
      )}
      onClick={onClick}
      aria-label={shown ? `Hide ${label}` : `Show ${label}`}
    >
      {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  )
}

let countryOptions: { code: string; name: string }[] | undefined
function CountryList() {
  countryOptions ??= COUNTRY_CODES.map((code) => ({ code, name: countryName(code) }))
  return (
    <datalist id="sekure-countries">
      {countryOptions.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </datalist>
  )
}
