import { describe, expect, it, vi } from 'vitest'
import { DriveClient, DriveError } from './DriveClient'
import { driveRevision } from '../sources/VaultSource'

const file = (over = {}) => ({
  id: 'f1',
  name: 'Vault.kdbx',
  modifiedTime: '2026-01-01T00:00:00Z',
  headRevisionId: 'r1',
  ...over
})

describe('DriveClient', () => {
  it('lists only real .kdbx files and escapes the search term', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        files: [
          file(),
          file({ id: 'f2', name: 'notes.kdbx.txt' }),
          file({ id: 'f3', name: 'B.KDBX' })
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new DriveClient(async () => 'token')

    const files = await client.listVaults("bob's")
    expect(files.map((f) => f.id)).toEqual(['f1', 'f3'])

    const [url, init] = fetchMock.mock.calls[0]
    const q = new URL(url).searchParams.get('q')
    expect(q).toContain("name contains 'bob\\'s'")
    expect(q).toContain('trashed = false')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token')
    vi.unstubAllGlobals()
  })

  it('throws DriveError with Google’s message', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'File not found: x.' } }, { status: 404 })
    )
    const client = new DriveClient(async () => 'token')
    const err = await client.metadata('x').catch((e) => e)
    expect(err).toBeInstanceOf(DriveError)
    expect(err).toMatchObject({ status: 404, message: 'File not found: x.' })
    vi.unstubAllGlobals()
  })

  it('refreshes the token once and retries after a 401', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization
      return auth === 'Bearer fresh'
        ? Response.json(file())
        : Response.json({ error: { message: 'Invalid Credentials' } }, { status: 401 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const getToken = vi.fn(async (force?: boolean) => (force ? 'fresh' : 'stale'))
    const client = new DriveClient(getToken)
    expect((await client.metadata('f1')).id).toBe('f1')
    expect(getToken.mock.calls).toEqual([[false], [true]])
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    vi.unstubAllGlobals()
  })

  it('uploads with PATCH media upload', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(file({ headRevisionId: 'r2' }))
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new DriveClient(async () => 'token')
    const res = await client.upload('f1', new Uint8Array([1, 2, 3]).buffer)
    expect(res.headRevisionId).toBe('r2')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/upload/drive/v3/files/f1')
    expect(new URL(url).searchParams.get('uploadType')).toBe('media')
    expect(init?.method).toBe('PATCH')
    vi.unstubAllGlobals()
  })
})

describe('driveRevision', () => {
  it('prefers the head revision, falls back to modifiedTime', () => {
    expect(driveRevision(file())).toBe('r1')
    expect(driveRevision(file({ headRevisionId: undefined }))).toBe('2026-01-01T00:00:00Z')
  })
})
