// Shared bits of the one-shot 127.0.0.1 servers (OAuth callback, Drive
// picker). No electron: tested in node.

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )

/** Headers for every page a loopback server returns. */
export const LOOPBACK_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  Connection: 'close'
}

/** A static status page: no scripts, fixed styles, escaped text. */
export function statusPage(ok: boolean, title: string, message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Sekure</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0b0b0c;color:#eee}
div{text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#999;margin:0}</style></head>
<body><div><h1${ok ? '' : ' style="color:#f88"'}>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`
}

/** CSP for `statusPage`: nothing but its inline style. */
export const STATUS_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'"
