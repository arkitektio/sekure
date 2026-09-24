import { Cloud, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isLocalId } from '@/lib/vaults'

/** Cloud for Drive-API vaults, disk for local files (incl. Drive-for-desktop synced). */
export function SourceIcon({ id, className }: { id: string; className?: string }) {
  const Icon = isLocalId(id) ? HardDrive : Cloud
  return <Icon className={cn('size-3.5', className)} />
}
