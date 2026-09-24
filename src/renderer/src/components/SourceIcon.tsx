import { HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Where a vault lives: a file on this computer (the only source kind today). */
export function SourceIcon({ className }: { id?: string; className?: string }) {
  return <HardDrive className={cn('size-3.5', className)} />
}
