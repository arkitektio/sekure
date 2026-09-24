import { cn } from '@/lib/utils'

export const vaultInitials = (name: string) =>
  name
    .replace(/\.kdbx$/i, '')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

/** A vault's initials, like orkestrator's organization avatar. */
export function VaultAvatar({
  name,
  current,
  className
}: {
  name: string
  current?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-md text-[10px] font-semibold',
        current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        className
      )}
    >
      {vaultInitials(name)}
    </span>
  )
}
