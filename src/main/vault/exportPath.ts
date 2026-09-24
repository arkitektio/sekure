import { basename, join } from 'path'

/**
 * Default path for the "Save attachment" dialog: Downloads plus the
 * attachment's name reduced to a plain file name. The name comes from the vault
 * file, so it must never point the dialog at another folder.
 */
export function exportDefaultPath(downloads: string, name: string): string {
  // eslint-disable-next-line no-control-regex -- strip control characters too
  const safe = basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f/\\:*?"<>|]/g, '_')
  return join(downloads, safe && safe !== '.' && safe !== '..' ? safe : 'attachment')
}
