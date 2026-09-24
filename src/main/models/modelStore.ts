import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { modelBytes, type ModelSpec } from './spec'

export type FetchFn = (url: string) => Promise<Response>

const VERIFIED = '.verified'

export const modelUrl = (spec: ModelSpec, path: string) =>
  `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${path}`

/** Where a model lives under `root` (e.g. `userData/models`). */
export const modelDir = (root: string, spec: ModelSpec) => join(root, spec.id, spec.revision)

/** Whether `dir` holds the complete, verified model. */
export async function hasModel(dir: string, spec: ModelSpec): Promise<boolean> {
  try {
    return (await readFile(join(dir, VERIFIED), 'utf8')).trim() === spec.revision
  } catch {
    return false
  }
}

/**
 * Download the pinned model into `dir`, checking every file against its sha256.
 * A mismatch deletes the file and throws. Already-verified models are left alone.
 */
export async function ensureModel(
  dir: string,
  spec: ModelSpec,
  fetchFn: FetchFn,
  onProgress: (fraction: number) => void = () => {}
): Promise<void> {
  if (await hasModel(dir, spec)) return
  const total = modelBytes(spec)
  let done = 0

  for (const file of spec.files) {
    const target = join(dir, file.path)
    await mkdir(dirname(target), { recursive: true })
    if (await matches(target, file.sha256)) {
      done += file.size
      onProgress(done / total)
      continue
    }

    const res = await fetchFn(modelUrl(spec, file.path))
    if (!res.ok || !res.body) throw new Error(`Download of ${file.path} failed (${res.status})`)
    const part = `${target}.part`
    const hash = createHash('sha256')
    const out = createWriteStream(part)
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done: end, value } = await reader.read()
        if (end) break
        hash.update(value)
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        done += value.byteLength
        onProgress(Math.min(done / total, 1))
      }
      await new Promise<void>((resolve, reject) =>
        out.end((e?: Error | null) => (e ? reject(e) : resolve()))
      )
    } catch (e) {
      out.destroy()
      await rm(part, { force: true })
      throw e
    }
    if (hash.digest('hex') !== file.sha256) {
      await rm(part, { force: true })
      throw new Error(`${file.path} failed its integrity check`)
    }
    await rename(part, target)
  }
  await writeFile(join(dir, VERIFIED), spec.revision)
}

/** Streamed, so a half-gigabyte model is never read into memory at once. */
async function matches(path: string, sha256: string): Promise<boolean> {
  try {
    await stat(path)
  } catch {
    return false
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex') === sha256
}

/**
 * Throws unless `data` is exactly the pinned file `path` of `spec`. Used on the bytes
 * a model is loaded from, so what runs is what was pinned, even for a bundled model.
 */
export function assertPinned(spec: ModelSpec, path: string, data: string | Uint8Array): void {
  const file = spec.files.find((f) => f.path === path)
  if (!file) throw new Error(`${path} is not part of ${spec.id}`)
  if (createHash('sha256').update(data).digest('hex') !== file.sha256)
    throw new Error(`${path} failed its integrity check`)
}

export async function removeModel(dir: string) {
  await rm(dir, { recursive: true, force: true })
}
