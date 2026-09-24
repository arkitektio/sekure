import { createElement } from 'react'
import {
  Banknote,
  BookUser,
  Braces,
  Car,
  CreditCard,
  IdCard,
  KeySquare,
  Landmark,
  SquareTerminal,
  StickyNote,
  Folder,
  FolderOpen,
  Globe,
  KeyRound,
  Mail,
  Monitor,
  Server,
  Shield,
  Terminal,
  Trash2,
  Wifi,
  type LucideIcon
} from 'lucide-react'

// A loose mapping of the KeePass standard icon set (0–68) to lucide.
const ICONS: Record<number, LucideIcon> = {
  0: KeyRound,
  1: Globe,
  3: Server,
  12: Wifi,
  19: Mail,
  23: Monitor,
  30: Terminal,
  37: Banknote,
  43: Trash2,
  48: Folder,
  49: FolderOpen,
  66: Banknote,
  68: Shield
}

export const entryIcon = (icon: number | undefined): LucideIcon =>
  (icon !== undefined && ICONS[icon]) || KeyRound

/** Render helpers: pick the icon and create the element in one step. */
export const renderEntryIcon = (icon: number | undefined, className?: string) =>
  createElement(entryIcon(icon), { className })

export const renderGroupIcon = (
  icon: number | undefined,
  recycleBin: boolean,
  className?: string
) => createElement(groupIcon(icon, recycleBin), { className })

export const groupIcon = (icon: number | undefined, recycleBin = false): LucideIcon =>
  recycleBin ? Trash2 : (icon !== undefined && icon !== 0 && icon !== 48 && ICONS[icon]) || Folder

const TYPE_ICONS: Record<string, LucideIcon> = {
  login: KeyRound,
  passport: BookUser,
  idCard: IdCard,
  driversLicense: Car,
  bankAccount: Landmark,
  creditCard: CreditCard,
  secureNote: StickyNote,
  wifi: Wifi,
  softwareLicense: KeySquare,
  sshKey: SquareTerminal,
  apiToken: Braces
}

export const typeIcon = (type: string): LucideIcon => TYPE_ICONS[type] ?? KeyRound

export const renderTypeIcon = (type: string, className?: string) =>
  createElement(typeIcon(type), { className })

/** Typed entries show their type's icon; plain logins keep their KeePass icon. */
export const renderSummaryIcon = (
  entry: { type: string; icon: number | undefined },
  className?: string
) =>
  entry.type === 'login'
    ? renderEntryIcon(entry.icon, className)
    : renderTypeIcon(entry.type, className)
