import { randomBytes } from 'crypto'
import { copyFile, open, readFile, realpath, rename, stat, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
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
  /**
   * Persist and return the new revision. With `expected`, throws
   * `RevisionConflict` instead of writing if the stored copy moved on.
   */
  write(bytes: ArrayBuffer, expected?: string): Promise<string>
}

/** The stored copy changed between the last read and this write. */
export class RevisionConflict extends Error {
  constructor() {
    super('The vault was changed elsewhere while saving')
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

/** Errors some sync providers (and Windows, with the file open) give for rename-over. */
const RENAME_REFUSED = new Set(['EXDEV', 'EPERM', 'EBUSY', 'EACCES'])

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
   * Write to a temp file next to the vault (same permissions, fsynced) and
   * rename it over the original, so a crash or a full disk never leaves a
   * truncated database. If writing the temp file fails, the original is left
   * alone. Only when a sync provider refuses the rename do we write in place,
   * and then only after copying the original to `.<name>.bak`.
   */
  async write(bytes: ArrayBuffer, expected?: string) {
    if (expected !== undefined && (await this.revision()) !== expected) throw new RevisionConflict()
    const data = new Uint8Array(bytes)
    // Write through a symlinked vault to its target instead of replacing the link.
    const path = await realpath(this.path)
    const dir = dirname(path)
    const name = basename(path)
    const mode = (await stat(path)).mode & 0o777
    const tmp = join(dir, `.${name}.${randomBytes(4).toString('hex')}.tmp`)

    try {
      const fh = await open(tmp, 'wx', mode)
      try {
        await fh.writeFile(data)
        await fh.sync()
      } finally {
        await fh.close()
      }
    } catch (e) {
      await unlink(tmp).catch(() => undefined)
      throw e
    }

    try {
      await rename(tmp, path)
    } catch (e) {
      await unlink(tmp).catch(() => undefined)
      if (!RENAME_REFUSED.has((e as NodeJS.ErrnoException).code ?? '')) throw e
      await copyFile(path, join(dir, `.${name}.bak`))
      await writeFile(path, data)
    }
    return this.revision()
  }
}
