import { randomBytes } from 'crypto'
import { readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { DriveClient } from '../drive/DriveClient'
import type { DriveFile } from '../drive/protocol'
import { localId, type VaultRef } from './protocol'

/**
 * A place a .kdbx can be read from and written back to. `revision` is an
 * opaque token that changes whenever the stored bytes change; VaultModule uses
 * it to detect "someone else saved since I opened" and merge instead of
 * overwriting.
 */
export interface VaultSource {
  describe(): Promise<VaultRef>
  read(): Promise<{ bytes: ArrayBuffer; revision: string }>
  revision(): Promise<string>
  /** Persist and return the new revision. */
  write(bytes: ArrayBuffer): Promise<string>
}

/** Drive bumps `headRevisionId` on every content change; fall back to mtime. */
export const driveRevision = (f: DriveFile) => f.headRevisionId ?? f.modifiedTime

export class DriveSource implements VaultSource {
  constructor(
    private client: DriveClient,
    private fileId: string
  ) {}

  async describe(): Promise<VaultRef> {
    const meta = await this.client.metadata(this.fileId)
    return { id: this.fileId, kind: 'drive', name: meta.name, location: 'Google Drive' }
  }

  async read() {
    // Revision first: if the file changes between the two calls we err on the
    // side of an unnecessary merge rather than a lost update.
    const revision = await this.revision()
    const bytes = await this.client.download(this.fileId)
    return { bytes, revision }
  }

  async revision() {
    return driveRevision(await this.client.metadata(this.fileId))
  }

  async write(bytes: ArrayBuffer) {
    return driveRevision(await this.client.upload(this.fileId, bytes))
  }
}

/**
 * Folders that Google Drive for desktop syncs. Files in here are uploaded by
 * the Drive client itself, so a local vault there is still "on Drive".
 */
export function isDriveSyncedPath(path: string): boolean {
  return (
    /\/Library\/CloudStorage\/GoogleDrive-[^/]+\//.test(path) || // macOS (File Provider)
    /\/Google Drive\//.test(path) || // legacy Backup & Sync / mirrored folders
    /^[A-Z]:\\My Drive\\/i.test(path) // Windows virtual drive
  )
}

export class LocalSource implements VaultSource {
  constructor(private path: string) {}

  async describe(): Promise<VaultRef> {
    await stat(this.path) // throws ENOENT with a clear message if it moved
    return {
      id: localId(this.path),
      kind: 'local',
      name: basename(this.path),
      location: dirname(this.path),
      syncedByDrive: isDriveSyncedPath(this.path)
    }
  }

  async read() {
    // For Drive-for-desktop "streamed" files this blocks until the File
    // Provider has downloaded the content, which is exactly what we want.
    const revision = await this.revision()
    const buf = await readFile(this.path)
    return {
      bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      revision
    }
  }

  async revision() {
    const s = await stat(this.path)
    return `${s.mtimeMs}:${s.size}`
  }

  /**
   * Write to a temp file next to the vault and rename it over the original,
   * so a crash mid-write never leaves a truncated database. Some sync
   * providers refuse the rename; fall back to writing in place.
   */
  async write(bytes: ArrayBuffer) {
    const data = new Uint8Array(bytes)
    const tmp = join(
      dirname(this.path),
      `.${basename(this.path)}.${randomBytes(4).toString('hex')}.tmp`
    )
    try {
      await writeFile(tmp, data)
      await rename(tmp, this.path)
    } catch {
      await unlink(tmp).catch(() => undefined)
      await writeFile(this.path, data)
    }
    return this.revision()
  }
}
