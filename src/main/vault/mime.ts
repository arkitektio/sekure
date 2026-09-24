import type { AttachmentKind } from './protocol'

// Attachments in KDBX carry only a name, so the type is inferred from it.
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain'
}

export function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

export function kindForMime(mime: string): AttachmentKind {
  // SVG is excluded from inline preview: it can carry script.
  if (mime.startsWith('image/') && mime !== 'image/svg+xml' && mime !== 'image/heic') return 'image'
  if (mime === 'application/pdf') return 'pdf'
  return 'other'
}
