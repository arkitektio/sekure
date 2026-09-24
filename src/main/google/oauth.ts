import { createHash, randomBytes } from 'crypto'
import type { GoogleAccount } from './protocol'

// OAuth 2.0 for installed apps: loopback redirect + PKCE.
// https://developers.google.com/identity/protocols/oauth2/native-app

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
export const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'

export const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive']

export interface OAuthClient {
  clientId: string
  clientSecret: string
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** Epoch ms. */
  expiresAt: number
}

const base64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function createState(): string {
  return base64url(randomBytes(16))
}

export function buildAuthUrl(opts: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  loginHint?: string
}): string {
  const url = new URL(AUTH_ENDPOINT)
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('code_challenge', opts.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', opts.state)
  // offline + consent: always hand back a refresh token, even on re-connect.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  if (opts.loginHint) url.searchParams.set('login_hint', opts.loginHint)
  return url.toString()
}

export type CallbackResult = { code: string } | { error: string }

/** Validate the loopback callback's query. `state` mismatch is a hard error. */
export function parseCallback(requestUrl: string, expectedState: string): CallbackResult {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  if (state !== expectedState) return { error: 'state_mismatch' }
  if (error) return { error }
  if (!code) return { error: 'missing_code' }
  return { code }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  })
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!res.ok || !json.access_token) {
    const err = new Error(
      json.error_description ?? json.error ?? `Token request failed (${res.status})`
    )
    ;(err as Error & { oauthError?: string }).oauthError = json.error
    throw err
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Refresh a minute early so a request never races the expiry.
    expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000
  }
}

export function exchangeCode(
  client: OAuthClient,
  code: string,
  verifier: string,
  redirectUri: string
): Promise<TokenSet> {
  return tokenRequest({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  })
}

export function refreshAccessToken(client: OAuthClient, refreshToken: string): Promise<TokenSet> {
  return tokenRequest({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token })
  }).catch(() => undefined)
}

export async function fetchAccount(accessToken: string): Promise<GoogleAccount> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) throw new Error(`userinfo failed (${res.status})`)
  const json = (await res.json()) as { email: string; name?: string; picture?: string }
  return { email: json.email, name: json.name, picture: json.picture }
}
