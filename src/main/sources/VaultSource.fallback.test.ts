import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

// A sync provider that refuses rename-over (EXDEV / EPERM), and one that fails
// for another reason. Only the first may fall back to an in-place write.
const renameError = vi.hoisted(() => ({ code: 'EXDEV' }))
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    rename: vi.fn(async () => {
      throw Object.assign(new Error('rename refused'), renameError)
    })
  }
})

const { LocalSource } = await import('./VaultSource')

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const setup = () => {
  const d = mkdtempSync(join(tmpdir(), 'sekure-fallback-'))
  dirs.push(d)
  const path = join(d, 'vault.kdbx')
  writeFileSync(path, 'v1')
  return { d, path }
}
const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('LocalSource rename fallback', () => {
  it('writes in place after a backup when the provider refuses the rename', async () => {
    renameError.code = 'EXDEV'
    const { d, path } = setup()
    await new LocalSource(path).write(buf('v2'))
    expect(readFileSync(path, 'utf8')).toBe('v2')
    expect(readFileSync(join(d, '.vault.kdbx.bak'), 'utf8')).toBe('v1')
    expect(readdirSync(d).sort()).toEqual(['.vault.kdbx.bak', 'vault.kdbx'])
  })

  it('does not touch the original for any other rename error', async () => {
    renameError.code = 'EIO'
    const { d, path } = setup()
    await expect(new LocalSource(path).write(buf('v2'))).rejects.toThrow('rename refused')
    expect(readFileSync(path, 'utf8')).toBe('v1')
    expect(readdirSync(d)).toEqual(['vault.kdbx'])
  })
})
