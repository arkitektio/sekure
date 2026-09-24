export const api = window.api

/**
 * Errors thrown in main arrive as
 * "Error invoking remote method 'vault:open': Error: InvalidKey: Wrong password".
 * Strip the transport prefix; keep the `Code: message` part parseable.
 */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function errorCode(e: unknown): string | undefined {
  return /^(InvalidKey|NotFound|Corrupt|Unknown): /.exec(errorMessage(e))?.[1]
}

/** Message without the `Code: ` prefix, for display. */
export function displayError(e: unknown): string {
  return errorMessage(e).replace(/^(InvalidKey|NotFound|Corrupt|Unknown): /, '')
}

/** An entry's title for lists; a protected title is fetched only on demand. */
export function entryTitle(e: { title: string; protectedFields?: string[] }): string {
  if (e.title) return e.title
  return e.protectedFields?.includes('Title') ? '•••••• (protected title)' : '(untitled)'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
