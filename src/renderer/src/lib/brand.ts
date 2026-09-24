import type { Brand } from '../../../main/preferences/protocol'

/** Matches the `.brand-animating` transition in index.css. */
const TRANSITION_MS = 800
const CACHE_KEY = 'sekure-brand'

let releaseTimer: ReturnType<typeof setTimeout> | undefined
let lastLocalEdit = 0

export const BRAND_PRESETS: (Brand & { name: string })[] = [
  { name: 'Red', hue: 27, chroma: 0.22 },
  { name: 'Orange', hue: 45, chroma: 0.2 },
  { name: 'Amber', hue: 70, chroma: 0.2 },
  { name: 'Yellow', hue: 100, chroma: 0.18 },
  { name: 'Lime', hue: 130, chroma: 0.18 },
  { name: 'Green', hue: 145, chroma: 0.18 },
  { name: 'Emerald', hue: 160, chroma: 0.16 },
  { name: 'Teal', hue: 175, chroma: 0.15 },
  { name: 'Cyan', hue: 195, chroma: 0.15 },
  { name: 'Sky', hue: 225, chroma: 0.15 },
  { name: 'Blue', hue: 250, chroma: 0.2 },
  { name: 'Indigo', hue: 275, chroma: 0.2 },
  { name: 'Violet', hue: 290, chroma: 0.2 },
  { name: 'Purple', hue: 310, chroma: 0.2 },
  { name: 'Fuchsia', hue: 330, chroma: 0.2 },
  { name: 'Pink', hue: 345, chroma: 0.2 },
  { name: 'Rose', hue: 355, chroma: 0.2 }
]

/**
 * Take the hue the short way round: `--brand-hue` is interpolated as a plain
 * number, so 350 → 10 would sweep back through the whole circle. oklch() reads
 * the hue modulo 360, so the unwrapped value renders the same.
 */
export const unwrapHue = (from: number, to: number) =>
  from + (((((to - from) % 360) + 540) % 360) - 180)

/** What is on screen now: the inline brand, or the stylesheet's light/dark default. */
export function currentBrand(): Brand {
  const style = getComputedStyle(document.documentElement)
  return {
    hue: parseFloat(style.getPropertyValue('--brand-hue')) || 250,
    chroma: parseFloat(style.getPropertyValue('--brand-chroma')) || 0.16
  }
}

/** Write the master theme controls on <html>; `null` hands back to the stylesheet. */
export function applyBrand(brand: Brand | null, { animate = false } = {}) {
  const root = document.documentElement
  if (animate) {
    root.classList.add('brand-animating')
    clearTimeout(releaseTimer)
    releaseTimer = setTimeout(() => root.classList.remove('brand-animating'), TRANSITION_MS + 50)
  }
  if (brand) {
    const inline = parseFloat(root.style.getPropertyValue('--brand-hue'))
    const hue = animate && Number.isFinite(inline) ? unwrapHue(inline, brand.hue) : brand.hue
    root.style.setProperty('--brand-hue', String(hue))
    root.style.setProperty('--brand-chroma', String(brand.chroma))
  } else {
    root.style.removeProperty('--brand-hue')
    root.style.removeProperty('--brand-chroma')
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(brand))
  } catch {
    // Only a startup cache.
  }
}

/** Paint the last brand before the first IPC round-trip, so windows don't flash. */
export function restoreCachedBrand() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Brand | null
    if (cached && Number.isFinite(cached.hue) && Number.isFinite(cached.chroma)) applyBrand(cached)
  } catch {
    // Ignore a corrupt cache.
  }
}

/** The settings sliders are being dragged: echoes from main must not snap them back. */
export const markLocalBrandEdit = () => {
  lastLocalEdit = Date.now()
}
export const isEditingBrandLocally = () => Date.now() - lastLocalEdit < 600
