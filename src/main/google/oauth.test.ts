import { createHash } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuthUrl,
  createPkce,
  exchangeCode,
  parseCallback,
  refreshAccessToken,
  SCOPES
} from './oauth'

const client = { clientId: 'cid', clientSecret: 'secret' }

afterEach(() => vi.unstubAllGlobals())

describe('PKCE', () => {
  it('derives an S256 challenge from the verifier', () => {
    const { verifier, challenge } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
  })
})

describe('buildAuthUrl', () => {
  it('requests offline Drive access with PKCE and state', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:5555/callback',
        challenge: 'chal',
        state: 'st'
      })
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid',
      redirect_uri: 'http://127.0.0.1:5555/callback',
      response_type: 'code',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      state: 'st',
      access_type: 'offline',
      prompt: 'consent'
    })
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(SCOPES)
  })
})

describe('parseCallback', () => {
  it('accepts a matching state', () => {
    expect(parseCallback('/callback?code=abc&state=st', 'st')).toEqual({ code: 'abc' })
  })
  it('rejects a forged state even when a code is present', () => {
    expect(parseCallback('/callback?code=abc&state=evil', 'st')).toEqual({
      error: 'state_mismatch'
    })
  })
  it('surfaces Google errors (e.g. user denied)', () => {
    expect(parseCallback('/callback?error=access_denied&state=st', 'st')).toEqual({
      error: 'access_denied'
    })
  })
})

describe('token requests', () => {
  it('exchanges the code with the verifier and computes expiry', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const before = Date.now()
    const tokens = await exchangeCode(client, 'code', 'verifier', 'http://127.0.0.1:1/callback')

    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3540_000)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = init.body as URLSearchParams
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code',
      code_verifier: 'verifier'
    })
  })

  it('tags invalid_grant so the app can disconnect', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json(
        { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
        { status: 400 }
      )
    )
    await expect(refreshAccessToken(client, 'rt')).rejects.toMatchObject({
      oauthError: 'invalid_grant',
      message: 'Token has been expired or revoked.'
    })
  })
})
