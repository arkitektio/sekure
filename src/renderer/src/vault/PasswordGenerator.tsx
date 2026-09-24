import { useCallback, useState } from 'react'
import { RefreshCw, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import type { PasswordOptions } from '../../../main/vault/protocol'

const OPTION_LABELS: [keyof Omit<PasswordOptions, 'length'>, string][] = [
  ['upper', 'A–Z'],
  ['lower', 'a–z'],
  ['digits', '0–9'],
  ['symbols', '!@#'],
  ['unambiguous', 'No look-alikes']
]

export function PasswordGenerator({ onUse }: { onUse: (password: string) => void }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<PasswordOptions>({
    length: 24,
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
    unambiguous: true
  })
  const [value, setValue] = useState('')

  const generate = useCallback(async (next: PasswordOptions) => {
    if (!next.lower && !next.upper && !next.digits && !next.symbols) return setValue('')
    setValue(await api.vault.generatePassword(next))
  }, [])

  const update = (patch: Partial<PasswordOptions>) => {
    const next = { ...opts, ...patch }
    setOpts(next)
    void generate(next)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void generate(opts)
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Generate password">
          <Wand2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex items-center gap-2">
          <code className="min-h-9 flex-1 rounded-md bg-muted px-2 py-2 font-mono text-sm break-all">
            {value}
          </code>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => void generate(opts)}>
            <RefreshCw />
          </Button>
        </div>
        <div className="mt-4 grid gap-2">
          <div className="flex items-center justify-between text-sm">
            <Label>Length</Label>
            <span className="tabular-nums">{opts.length}</span>
          </div>
          <Slider
            min={8}
            max={64}
            value={[opts.length]}
            onValueChange={([length]) => update({ length })}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {OPTION_LABELS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <Switch checked={opts[key]} onCheckedChange={(v) => update({ [key]: v })} />
              {label}
            </label>
          ))}
        </div>
        <Button
          type="button"
          className="mt-4 w-full"
          disabled={!value}
          onClick={() => {
            onUse(value)
            setOpen(false)
          }}
        >
          Use password
        </Button>
      </PopoverContent>
    </Popover>
  )
}
