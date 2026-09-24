import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as kdbxweb from 'kdbxweb'
import { afterAll, describe, expect, it } from 'vitest'
import { isDriveSyncedPath, LocalSource, RevisionConflict } from './VaultSource'
import { isLocalId, localId, localPath } from './protocol'
import { loadKdbx, makeCredentials, VaultSession } from '../vault/VaultSession'

const dirs: string[] = []
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), 'sekure-src-'))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('local ids', () => {
  it('round-trips paths', () => {
    const id = localId('/Users/me/My Vault.kdbx')
    expect(isLocalId(id)).toBe(true)
    expect(isLocalId('1AbCdriveFileId')).toBe(false)
    expect(localPath(id)).toBe('/Users/me/My Vault.kdbx')
  })
})

describe('isDriveSyncedPath', () => {
  it('recognises Google Drive for desktop folders', () => {
    expect(
      isDriveSyncedPath('/Users/me/Library/CloudStorage/GoogleDrive-me@gmail.com/My Drive/a.kdbx')
    ).toBe(true)
    expect(isDriveSyncedPath('G:\\My Drive\\a.kdbx')).toBe(true)
    expect(isDriveSyncedPath('/Users/me/Documents/a.kdbx')).toBe(false)
    expect(isDriveSyncedPath('/Users/me/Library/CloudStorage/Dropbox/a.kdbx')).toBe(false)
  })
})

describe('LocalSource', () => {
  it('describes, reads and writes atomically without leaving temp files', async () => {
    const d = dir()
    const path = join(d, 'vault.kdbx')
    writeFileSync(path, 'v1')
    const src = new LocalSource(path)

    expect(await src.describe()).toMatchObject({
      id: localId(path),
      kind: 'local',
      name: 'vault.kdbx',
      location: d,
      syncedByDrive: false
    })
    const { bytes, revision } = await src.read()
    expect(new TextDecoder().decode(bytes)).toBe('v1')

    const next = await src.write(buf('version-two'))
    expect(next).not.toBe(revision)
    expect(readFileSync(path, 'utf8')).toBe('version-two')
    expect(readdirSync(d)).toEqual(['vault.kdbx'])
  })

  it('keeps the file mode (a 0600 vault stays private)', async () => {
    const path = join(dir(), 'vault.kdbx')
    writeFileSync(path, 'v1', { mode: 0o600 })
    chmodSync(path, 0o600)
    await new LocalSource(path).write(buf('v2'))
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('leaves the original untouched when the temp copy cannot be written', async () => {
    const d = dir()
    const path = join(d, 'vault.kdbx')
    writeFileSync(path, 'precious')
    chmodSync(d, 0o555) // like a full disk: nothing new can be created here
    try {
      await expect(new LocalSource(path).write(buf('new'))).rejects.toThrow()
    } finally {
      chmodSync(d, 0o755)
    }
    expect(readFileSync(path, 'utf8')).toBe('precious')
    expect(readdirSync(d)).toEqual(['vault.kdbx'])
  })

  it('refuses to write over a copy that changed since the expected revision', async () => {
    const path = join(dir(), 'vault.kdbx')
    writeFileSync(path, 'v1')
    const src = new LocalSource(path)
    const expected = await src.revision()
    writeFileSync(path, 'someone else, longer')
    await expect(src.write(buf('mine'), expected)).rejects.toBeInstanceOf(RevisionConflict)
    expect(readFileSync(path, 'utf8')).toBe('someone else, longer')
  })

  it('writes through a symlink instead of replacing it', async () => {
    const d = dir()
    const target = join(d, 'real.kdbx')
    const link = join(d, 'link.kdbx')
    writeFileSync(target, 'v1')
    symlinkSync(target, link)
    await new LocalSource(link).write(buf('v2'))
    expect(readFileSync(target, 'utf8')).toBe('v2')
    expect(readFileSync(link, 'utf8')).toBe('v2')
  })

  it('reports a new revision when something else rewrites the file', async () => {
    const path = join(dir(), 'vault.kdbx')
    writeFileSync(path, 'v1')
    const src = new LocalSource(path)
    const before = await src.revision()
    writeFileSync(path, 'synced from another machine')
    expect(await src.revision()).not.toBe(before)
  })

  it('fails clearly when the file is gone', async () => {
    await expect(new LocalSource(join(dir(), 'missing.kdbx')).describe()).rejects.toThrow(/ENOENT/)
  })

  it('supports the save-with-merge flow against a file changed on disk', async () => {
    const path = join(dir(), 'vault.kdbx')
    const creds = () => makeCredentials('pw')
    const db = kdbxweb.Kdbx.create(creds(), 'Local')
    db.createEntry(db.getDefaultGroup()).fields.set('Title', 'Original')
    writeFileSync(path, Buffer.from(await db.save()))

    // We open it…
    const src = new LocalSource(path)
    const opened = await src.read()
    const session = await VaultSession.open(opened.bytes, creds(), localId(path), 'vault.kdbx')
    session.createEntry(undefined, { title: 'Mine', username: '', url: '', notes: '', tags: [] })

    // …meanwhile Drive for desktop syncs down an edit from another device.
    const other = await loadKdbx(opened.bytes, creds())
    other.createEntry(other.getDefaultGroup()).fields.set('Title', 'Theirs')
    writeFileSync(path, Buffer.from(await other.save()))

    // What VaultModule.save does:
    expect(await src.revision()).not.toBe(opened.revision)
    session.merge(await loadKdbx((await src.read()).bytes, session.credentials))
    await src.write(await session.save())

    const final = await VaultSession.open((await src.read()).bytes, creds(), 'x', 'x')
    expect(
      final
        .snapshot()
        .entries.map((e) => e.title)
        .sort()
    ).toEqual(['Mine', 'Original', 'Theirs'])
  })
})
