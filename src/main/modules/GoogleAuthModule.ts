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
  DRIVE_SCOPE,
  exchangeCode,
  fetchAccount,
  parseCallback,
  refreshAccessToken,
  revokeToken,
  type OAuthClient,
  type TokenSet
} from '../google/oauth'
import type { AuthStatus, GoogleAccount } from '../google/protocol'
import { LOOPBACK_HEADERS, STATUS_PAGE_CSP, statusPage } from '../google/loopback'

const REFRESH_TOKEN_KEY = 'google.refreshToken'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const callbackPage = (ok: boolean, message: string) =>
  statusPage(ok, ok ? 'Connected to Sekure' : 'Could not connect', message)

export class GoogleAuthModule implements AppModule {
  private secrets = new SecretStore()
  private store = new Store<{ account?: GoogleAccount; scope?: string; scopeChanged?: boolean }>({
    name: 'google'
  })
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
    this.migrateScope()
    this.ipc.handleChannel('auth:status', () => this.status())
    this.ipc.handleChannel('auth:login', () => this.login())
    this.ipc.handleChannel('auth:cancel', () => this.pendingLogin?.cancel())
    this.ipc.handleChannel('auth:logout', () => this.logout())
  }

  /**
   * Grants from before the switch to `drive.file` cover the whole Drive.
   * Revoke them so the next connect asks only for what Sekure needs.
   */
  private migrateScope() {
    const refreshToken = this.secrets.get(REFRESH_TOKEN_KEY)
    if (!refreshToken || this.store.get('scope') === DRIVE_SCOPE) return
    log.info('Revoking an old full-Drive Google grant')
    void revokeToken(refreshToken)
    this.secrets.delete(REFRESH_TOKEN_KEY)
    this.store.delete('account')
    this.store.set('scopeChanged', true)
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
      account: connected ? this.store.get('account') : undefined,
      scopeChanged: this.store.get('scopeChanged') || undefined
    }
  }

  /**
   * A valid access token, refreshing (once, shared) when it has expired, or
   * when `force` says the API just rejected the cached one.
   */
  async getAccessToken(force = false): Promise<string> {
    if (force) this.tokens = undefined
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
        if (req.method !== 'GET' || !req.url?.startsWith('/callback')) {
          res.writeHead(404, LOOPBACK_HEADERS).end()
          return
        }
        const result = parseCallback(req.url, state)
        const headers = {
          ...LOOPBACK_HEADERS,
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': STATUS_PAGE_CSP
        }
        if ('error' in result && result.error === 'state_mismatch') {
          // Not our redirect (a stale tab, or another local process probing
          // the port): refuse it but keep waiting for the real one.
          res.writeHead(400, headers).end(callbackPage(false, 'This sign-in link is not valid.'))
          return
        }
        res.writeHead(200, headers)
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
    if (!tokens.scope?.split(' ').includes(DRIVE_SCOPE)) {
      void revokeToken(tokens.refreshToken)
      throw new Error('Google Drive access was not granted. Connect again and allow it.')
    }
    this.secrets.set(REFRESH_TOKEN_KEY, tokens.refreshToken)
    this.store.set('scope', DRIVE_SCOPE)
    this.store.delete('scopeChanged')
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

  private async logout(): Promise<AuthStatus & { revoked: boolean }> {
    const refreshToken = this.secrets.get(REFRESH_TOKEN_KEY)
    const revoked = refreshToken ? await revokeToken(refreshToken) : true
    if (!revoked) log.warn('Google did not confirm revoking the refresh token')
    this.clear()
    return { ...this.status(), revoked }
  }

  private clear() {
    this.secrets.delete(REFRESH_TOKEN_KEY)
    this.store.delete('account')
    this.store.delete('scope')
    this.tokens = undefined
    this.emit(this.status())
  }

  private emit(status: AuthStatus) {
    for (const cb of this.listeners) cb(status)
  }
}
