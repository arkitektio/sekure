import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { api, displayError } from '@/lib/api'
import { applyBrand, BRAND_PRESETS, currentBrand, markLocalBrandEdit } from '@/lib/brand'
import { cn } from '@/lib/utils'
import type { Brand } from '../../../main/preferences/protocol'

/** Main (and the vault) get the value once the slider rests, not on every frame. */
const COMMIT_DELAY_MS = 250

const HUE_GRADIENT = `linear-gradient(to right, ${Array.from(
  { length: 13 },
  (_, i) => `oklch(65% 0.2 ${i * 30})`
).join(', ')})`

/** The `--brand-hue` / `--brand-chroma` controls, as in orkestrator's ThemeCustomizer. */
export function BrandCustomizer({ brand }: { brand: Brand | null }) {
  const [value, setValue] = useState<Brand>(() => brand ?? currentBrand())
  const [custom, setCustom] = useState(brand !== null)
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(commitTimer.current), [])

  const commit = (next: Brand | null) => {
    clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      api.preferences.setBrand(next).catch((e) => toast.error(displayError(e)))
    }, COMMIT_DELAY_MS)
  }

  const change = (next: Brand, animate = false) => {
    markLocalBrandEdit()
    setValue(next)
    setCustom(true)
    applyBrand(next, { animate })
    commit(next)
  }

  const reset = () => {
    markLocalBrandEdit()
    applyBrand(null, { animate: true })
    setCustom(false)
    // The stylesheet default differs between light and dark; read it once applied.
    requestAnimationFrame(() => setValue(currentBrand()))
    commit(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-sm">
          <Label>Hue</Label>
          <span className="text-muted-foreground tabular-nums">{Math.round(value.hue)}°</span>
        </div>
        <div className="h-2 rounded-full" style={{ background: HUE_GRADIENT }} />
        <Slider
          min={0}
          max={360}
          step={1}
          value={[((value.hue % 360) + 360) % 360]}
          onValueChange={([hue]) => change({ ...value, hue })}
          aria-label="Brand hue"
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-sm">
          <Label>Intensity</Label>
          <span className="text-muted-foreground tabular-nums">{value.chroma.toFixed(2)}</span>
        </div>
        <Slider
          min={0}
          max={0.3}
          step={0.005}
          value={[value.chroma]}
          onValueChange={([chroma]) => change({ ...value, chroma })}
          aria-label="Brand intensity"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {BRAND_PRESETS.map((p) => {
          const active =
            custom && Math.round(value.hue) === p.hue && Math.abs(value.chroma - p.chroma) < 0.001
          return (
            <button
              key={p.name}
              type="button"
              title={p.name}
              aria-label={`Use ${p.name}`}
              onClick={() => change({ hue: p.hue, chroma: p.chroma }, true)}
              className={cn(
                'size-6 rounded-full border border-black/10 transition-shadow hover:ring-2 hover:ring-ring hover:ring-offset-2 hover:ring-offset-background',
                active && 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
              )}
              style={{ backgroundColor: `oklch(60% ${p.chroma} ${p.hue})` }}
            />
          )
        })}
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto text-muted-foreground"
          disabled={!custom}
          onClick={reset}
        >
          <RotateCcw /> Default
        </Button>
      </div>
    </div>
  )
}
