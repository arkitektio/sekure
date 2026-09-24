import type { DriveFile } from './protocol'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FILE_FIELDS = 'id,name,modifiedTime,headRevisionId,size,owners(displayName)'

export class DriveError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

interface RawFile {
  id: string
  name: string
  modifiedTime: string
  headRevisionId?: string
  size?: string
  owners?: { displayName?: string }[]
}

const toFile = (f: RawFile): DriveFile => ({
  id: f.id,
  name: f.name,
  modifiedTime: f.modifiedTime,
  headRevisionId: f.headRevisionId,
  size: f.size,
  owner: f.owners?.[0]?.displayName
})

/**
 * Minimal Drive v3 REST client. `getToken` is called per request so the auth
 * module can refresh transparently; nothing here stores credentials.
 */
/** Metadata calls; uploads and downloads of a vault get longer. */
const REQUEST_TIMEOUT_MS = 30_000
const TRANSFER_TIMEOUT_MS = 5 * 60_000

export class DriveClient {
  /** `force` skips the cached access token (it was rejected with a 401). */
  constructor(private getToken: (force?: boolean) => Promise<string>) {}

  private async request(
    url: string,
    init: RequestInit = {},
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<Response> {
    const send = async (force: boolean) =>
      fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await this.getToken(force)}` },
        signal: AbortSignal.timeout(timeoutMs)
      })
    let res = await send(false)
    // Revoked or rotated mid-life: refresh once and retry.
    if (res.status === 401) res = await send(true)
    if (!res.ok) {
      let message = `Drive request failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        if (body.error?.message) message = body.error.message
      } catch {
        /* non-JSON error body */
      }
      throw new DriveError(res.status, message)
    }
    return res
  }

  /** All non-trashed `.kdbx` files the account can see, newest first. */
  async listVaults(search?: string): Promise<DriveFile[]> {
    const clauses = ["name contains '.kdbx'", 'trashed = false']
    if (search?.trim()) {
      clauses.push(`name contains '${search.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
    }
    const files: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const url = new URL(`${API}/files`)
      url.searchParams.set('q', clauses.join(' and '))
      url.searchParams.set('fields', `nextPageToken,files(${FILE_FIELDS})`)
      url.searchParams.set('orderBy', 'modifiedTime desc')
      url.searchParams.set('pageSize', '100')
      url.searchParams.set('supportsAllDrives', 'true')
      url.searchParams.set('includeItemsFromAllDrives', 'true')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const res = await this.request(url.toString())
      const json = (await res.json()) as { files: RawFile[]; nextPageToken?: string }
      // `contains` matches anywhere in the name; keep real .kdbx files only.
      files.push(...json.files.filter((f) => f.name.toLowerCase().endsWith('.kdbx')).map(toFile))
      pageToken = json.nextPageToken
    } while (pageToken && files.length < 500)
    return files
  }

  async metadata(fileId: string): Promise<DriveFile> {
    const url = new URL(`${API}/files/${encodeURIComponent(fileId)}`)
    url.searchParams.set('fields', FILE_FIELDS)
    url.searchParams.set('supportsAllDrives', 'true')
    const res = await this.request(url.toString())
    return toFile((await res.json()) as RawFile)
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    const url = new URL(`${API}/files/${encodeURIComponent(fileId)}`)
    url.searchParams.set('alt', 'media')
    url.searchParams.set('supportsAllDrives', 'true')
    const res = await this.request(url.toString(), {}, TRANSFER_TIMEOUT_MS)
    return res.arrayBuffer()
  }

  async upload(fileId: string, bytes: ArrayBuffer): Promise<DriveFile> {
    const url = new URL(`${UPLOAD}/files/${encodeURIComponent(fileId)}`)
    url.searchParams.set('uploadType', 'media')
    url.searchParams.set('fields', FILE_FIELDS)
    url.searchParams.set('supportsAllDrives', 'true')
    const res = await this.request(
      url.toString(),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes
      },
      TRANSFER_TIMEOUT_MS
    )
    return toFile((await res.json()) as RawFile)
  }
}
