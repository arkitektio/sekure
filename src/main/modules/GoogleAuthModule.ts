import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { shell } from 'electron'
import log from 'electron-log'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { SecretStore } from '../lib/secrets'
import {
  buildAuthUrl,
  createPkce,
  createState,
  exchangeCode,
  fetchAccount,
  parseCallback,
  refreshAccessToken,
  revokeToken,
  type OAuthClient,
  type TokenSet
} from '../google/oauth'
import type { AuthStatus, GoogleAccount } from '../google/protocol'

const REFRESH_TOKEN_KEY = 'google.refreshToken'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const callbackPage = (ok: boolean, message: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Sekure</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0b0b0c;color:#eee}
div{text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#999;margin:0}</style></head>
<body><div><h1>${ok ? 'Connected to Sekure' : 'Could not connect'}</h1><p>${message}</p></div></body></html>`

export class GoogleAuthModule implements AppModule {
  private secrets = new SecretStore()
  private store = new Store<{ account?: GoogleAccount }>({ name: 'google' })
  private tokens: TokenSet | undefined
  private refreshing: Promise<TokenSet> | undefined
  private pendingLogin: { server: Server; cancel: () => void } | undefined
  private listeners = new Set<(status: AuthStatus) => void>()

  constructor(private ipc: IpcTransport) {}

  private get client(): OAuthClient | undefined {
    const clientId = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID
    const clientSecret = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) return undefined
    return { clientId, clientSecret }
  }

  setup() {
    this.ipc.handleChannel('auth:status', () => this.status())
    this.ipc.handleChannel('auth:login', () => this.login())
    this.ipc.handleChannel('auth:cancel', () => this.pendingLogin?.cancel())
    this.ipc.handleChannel('auth:logout', () => this.logout())
  }

  onBeforeQuit() {
    this.pendingLogin?.cancel()
  }

  onStatusChange(cb: (status: AuthStatus) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  status(): AuthStatus {
    const connected = this.secrets.has(REFRESH_TOKEN_KEY)
    return {
      configured: !!this.client,
      connected,
      account: connected ? this.store.get('account') : undefined
    }
  }

  /** A valid access token, refreshing (once, shared) when it has expired. */
  async getAccessToken(): Promise<string> {
    if (this.tokens && this.tokens.expiresAt > Date.now()) return this.tokens.accessToken
    if (!this.refreshing) {
      this.refreshing = this.refresh().finally(() => (this.refreshing = undefined))
    }
    return (await this.refreshing).accessToken
  }

  private async refresh(): Promise<TokenSet> {
    const client = this.client
    const refreshToken = this.secrets.get(REFRESH_TOKEN_KEY)
    if (!client || !refreshToken) throw new Error('Not connected to Google Drive')
    try {
      this.tokens = await refreshAccessToken(client, refreshToken)
      return this.tokens
    } catch (e) {
      if ((e as { oauthError?: string }).oauthError === 'invalid_grant') {
        // Revoked in the Google account, or expired (testing-mode apps get
        // 7-day refresh tokens). Drop it so the UI goes back to Connect.
        log.warn('Google refresh token rejected, disconnecting')
        this.clear()
      }
      throw e
    }
  }

  private async login(): Promise<AuthStatus> {
    const client = this.client
    if (!client) {
      throw new Error('No Google OAuth client configured. See README → Google Cloud setup.')
    }
    this.pendingLogin?.cancel()

    const { verifier, challenge } = createPkce()
    const state = createState()

    const code = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let redirectUri = ''
      const server = createServer((req, res) => {
        if (!req.url?.startsWith('/callback')) {
          res.writeHead(404).end()
          return
        }
        const result = parseCallback(req.url, state)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        if ('code' in result) {
          res.end(callbackPage(true, 'You can close this tab and return to the app.'))
          finish()
          resolve({ code: result.code, redirectUri })
        } else {
          res.end(callbackPage(false, `Google returned: ${result.error}`))
          finish()
          reject(new Error(`Google sign-in failed: ${result.error}`))
        }
      })
      const timer = setTimeout(() => {
        finish()
        reject(new Error('Google sign-in timed out'))
      }, LOGIN_TIMEOUT_MS)
      const finish = () => {
        clearTimeout(timer)
        server.close()
        this.pendingLogin = undefined
      }
      this.pendingLogin = {
        server,
        cancel: () => {
          finish()
          reject(new Error('Google sign-in cancelled'))
        }
      }
      // Loopback on an ephemeral port — Google allows any port for Desktop clients.
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo
        redirectUri = `http://127.0.0.1:${port}/callback`
        void shell.openExternal(
          buildAuthUrl({ clientId: client.clientId, redirectUri, challenge, state })
        )
      })
      server.on('error', (err) => {
        finish()
        reject(err)
      })
    })

    const tokens = await exchangeCode(client, code.code, verifier, code.redirectUri)
    if (!tokens.refreshToken) throw new Error('Google did not return a refresh token')
    this.secrets.set(REFRESH_TOKEN_KEY, tokens.refreshToken)
    this.tokens = tokens
    try {
      this.store.set('account', await fetchAccount(tokens.accessToken))
    } catch (e) {
      log.warn('Could not fetch Google account info', e)
    }
    const status = this.status()
    this.emit(status)
    return status
  }

  private async logout(): Promise<AuthStatus> {
    const refreshToken = this.secrets.get(REFRESH_TOKEN_KEY)
    if (refreshToken) await revokeToken(refreshToken)
    this.clear()
    return this.status()
  }

  private clear() {
    this.secrets.delete(REFRESH_TOKEN_KEY)
    this.store.delete('account')
    this.tokens = undefined
    this.emit(this.status())
  }

  private emit(status: AuthStatus) {
    for (const cb of this.listeners) cb(status)
  }
}
