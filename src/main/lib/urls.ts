// Pure URL checks for everything main hands to the OS. Tested in node.

/**
 * An entry's URL as something safe to give `shell.openExternal`: http(s)
 * only, no embedded credentials. A bare host (`example.com/login`) gets
 * `https://`. Returns undefined for anything else (javascript:, file:, smb:,
 * custom schemes).
 */
export function externalUrl(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  const url = URL.parse(hasScheme ? trimmed : `https://${trimmed}`)
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return undefined
  if (url.username || url.password || !url.hostname) return undefined
  return url.toString()
}

/**
 * Exact scheme + host + port match (a prefix check would let
 * `app://bundle.evil` through). Compares parts rather than `.origin`, which
 * Node reports as "null" for custom schemes such as `app://`.
 */
export function hasOrigin(url: string, origin: string): boolean {
  const a = URL.parse(url)
  const b = URL.parse(origin)
  return !!a && !!b && !!a.host && a.protocol === b.protocol && a.host === b.host
}
