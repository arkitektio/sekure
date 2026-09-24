import { randomBytes } from 'crypto'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import type { PickedFile } from './protocol'
import { LOOPBACK_HEADERS, STATUS_PAGE_CSP, statusPage } from '../google/loopback'

// With the `drive.file` scope Sekure only sees files it created or that the
// user picked in the Google Picker. The Picker is a Google-hosted script, so it
// runs in the user's browser (never inside Electron, whose CSP stays closed),
// on a one-shot 127.0.0.1 page like the OAuth callback.

export interface PickerConfig {
  accessToken: string
  apiKey: string
  /** Google Cloud project number. */
  appId: string
}

const PICKER_TIMEOUT_MS = 5 * 60 * 1000
const MAX_BODY_BYTES = 4096

/** JSON safe to inline in a <script> (no `</script>`, no U+2028). */
const inlineJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

export function pickerPage(cfg: PickerConfig, state: string): string {
  const data = inlineJson({ ...cfg, state })
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Choose a vault – Sekure</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0b0b0c;color:#eee}p{color:#999}</style></head>
<body><p id="msg">Opening Google Drive…</p>
<script>
const cfg = ${data}
const msg = document.getElementById('msg')
function done(body) {
  fetch('/picked?state=' + encodeURIComponent(cfg.state), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).finally(() => {
    msg.textContent = body.id
      ? 'Vault selected. You can close this tab and return to Sekure.'
      : 'Cancelled. You can close this tab.'
  })
}
function onApiLoad() {
  gapi.load('picker', () => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMode(google.picker.DocsViewMode.LIST)
    new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(cfg.accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setTitle('Choose a KeePass vault')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED && data.docs && data.docs[0]) {
          done({ id: data.docs[0].id, name: data.docs[0].name })
        } else if (data.action === google.picker.Action.CANCEL) {
          done({ cancelled: true })
        }
      })
      .build()
      .setVisible(true)
  })
}
</script>
<script async defer src="https://apis.google.com/js/api.js" onload="onApiLoad()"></script>
</body></html>`
}

/** Validate what the picker page posts back. */
export function parsePicked(body: string): PickedFile | null | undefined {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!json || typeof json !== 'object') return undefined
  const { id, name, cancelled } = json as Record<string, unknown>
  if (cancelled === true) return null
  if (typeof id !== 'string' || !/^[\w-]{10,200}$/.test(id)) return undefined
  return { id, name: typeof name === 'string' ? name.slice(0, 500) : '' }
}

/**
 * Serve the picker once on 127.0.0.1, open it with `openUrl`, and resolve with
 * the chosen file (null when the user cancels). The page carries a short-lived
 * access token, so it is served exactly once and only at the random path.
 */
export function pickDriveFile(
  cfg: PickerConfig,
  openUrl: (url: string) => void | Promise<void>,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<PickedFile | null> {
  const state = randomBytes(16).toString('base64url')
  let served = false

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === `/pick/${state}` && !served) {
        served = true
        res.writeHead(200, {
          ...LOOPBACK_HEADERS,
          'Content-Type': 'text/html; charset=utf-8',
          'Referrer-Policy': 'no-referrer'
        })
        res.end(pickerPage(cfg, state))
        return
      }
      if (
        req.method === 'POST' &&
        url.pathname === '/picked' &&
        url.searchParams.get('state') === state
      ) {
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk: string) => {
          body += chunk
          if (body.length > MAX_BODY_BYTES) req.destroy()
        })
        req.on('end', () => {
          const picked = parsePicked(body)
          if (picked === undefined) {
            res.writeHead(400, LOOPBACK_HEADERS).end()
            return
          }
          res.writeHead(204, LOOPBACK_HEADERS).end()
          finish()
          resolve(picked)
        })
        return
      }
      res
        .writeHead(404, {
          ...LOOPBACK_HEADERS,
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': STATUS_PAGE_CSP
        })
        .end(statusPage(false, 'Link expired', 'Choose the vault again from Sekure.'))
    })

    const timer = setTimeout(() => {
      finish()
      reject(new Error('Choosing a file timed out'))
    }, opts.timeoutMs ?? PICKER_TIMEOUT_MS)
    const onAbort = () => {
      finish()
      reject(new Error('Choosing a file was cancelled'))
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const finish = () => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      server.close()
    }

    server.on('error', (err) => {
      finish()
      reject(err)
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      Promise.resolve(openUrl(`http://127.0.0.1:${port}/pick/${state}`)).catch((err) => {
        finish()
        reject(err)
      })
    })
  })
}
