import { createElement } from 'react'
import {
  BadgeCheck,
  Banknote,
  Bitcoin,
  BookUser,
  Braces,
  Building2,
  Car,
  CarFront,
  Contact,
  CreditCard,
  Database,
  Gift,
  HandCoins,
  HeartPulse,
  House,
  IdCard,
  KeySquare,
  Landmark,
  Laptop,
  LifeBuoy,
  LockKeyhole,
  MonitorSmartphone,
  Plane,
  ReceiptText,
  Router,
  ScrollText,
  ShieldUser,
  Smartphone,
  SquareTerminal,
  Stamp,
  Stethoscope,
  StickyNote,
  Ticket,
  TrendingUp,
  Umbrella,
  Wallet,
  Zap,
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
import type { EntryTypeGroup } from '../../../main/vault/entryTypes'

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

export const TYPE_ICONS: Record<string, LucideIcon> = {
  login: KeyRound,
  passport: BookUser,
  idCard: IdCard,
  driversLicense: Car,
  residencePermit: BadgeCheck,
  birthCertificate: ScrollText,
  personalDetails: Contact,
  taxId: ReceiptText,
  socialSecurity: ShieldUser,
  vatId: Building2,
  bankAccount: Landmark,
  creditCard: CreditCard,
  investmentAccount: TrendingUp,
  cryptoWallet: Bitcoin,
  loan: HandCoins,
  giftCard: Gift,
  healthInsurance: HeartPulse,
  insurancePolicy: Umbrella,
  medicalInfo: Stethoscope,
  visa: Stamp,
  loyaltyProgram: Plane,
  membership: Ticket,
  vehicle: CarFront,
  phone: Smartphone,
  alarmCode: LockKeyhole,
  utilityAccount: Zap,
  device: Laptop,
  emailAccount: Mail,
  server: Server,
  database: Database,
  router: Router,
  wifi: Wifi,
  sshKey: SquareTerminal,
  apiToken: Braces,
  recoveryCodes: LifeBuoy,
  softwareLicense: KeySquare,
  secureNote: StickyNote
}

export const GROUP_ICONS: Record<EntryTypeGroup, LucideIcon> = {
  login: KeyRound,
  identity: IdCard,
  government: ReceiptText,
  finance: Wallet,
  health: HeartPulse,
  travel: Plane,
  home: House,
  tech: MonitorSmartphone,
  other: StickyNote
}

export const renderGroupTypeIcon = (group: EntryTypeGroup, className?: string) =>
  createElement(GROUP_ICONS[group], { className })

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
