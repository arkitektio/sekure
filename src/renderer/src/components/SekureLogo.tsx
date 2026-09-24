import { cn } from '@/lib/utils'

// The "Keyhole S" (masters in build/logo.svg and build/logo-mark.svg). Inline, so it
// needs no asset and follows the live brand colour.
const S_PATH = 'M 635.6 350.9 A 128 128 0 1 0 512 512 A 144 144 0 1 1 372.9 693.3'
const KEYHOLE = 'M 501 654 L 494 714 L 530 714 L 523 654 Z'

function Glyph() {
  return (
    <>
      <path d={S_PATH} fill="none" stroke="currentColor" strokeWidth={100} />
      <g fill="currentColor">
        <circle cx={512} cy={640} r={31} />
        <path d={KEYHOLE} />
      </g>
    </>
  )
}

/** The app mark on its tile, flat in the brand colour. */
export function SekureLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="Sekure"
      className={cn('size-24 text-white', className)}
    >
      <rect width={1024} height={1024} rx={82} className="fill-primary" />
      <Glyph />
    </svg>
  )
}

/** The glyph alone, in `currentColor`. */
export function SekureMark({ className }: { className?: string }) {
  return (
    <svg viewBox="310 196 404 664" aria-hidden className={cn('h-5 w-auto', className)}>
      <Glyph />
    </svg>
  )
}
