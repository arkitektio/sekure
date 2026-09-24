import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { MODEL } from './protocol'

export type FetchFn = (url: string) => Promise<Response>

const VERIFIED = '.verified'

export const modelUrl = (path: string) =>
  `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${path}`

/** Whether `dir` holds the complete, verified model. */
export async function hasModel(dir: string): Promise<boolean> {
  try {
    return (await readFile(join(dir, VERIFIED), 'utf8')).trim() === MODEL.revision
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
  fetchFn: FetchFn,
  onProgress: (fraction: number) => void = () => {}
): Promise<void> {
  if (await hasModel(dir)) return
  const total = MODEL.files.reduce((n, f) => n + f.size, 0)
  let done = 0

  for (const file of MODEL.files) {
    const target = join(dir, file.path)
    await mkdir(dirname(target), { recursive: true })
    if (await matches(target, file.sha256)) {
      done += file.size
      onProgress(done / total)
      continue
    }

    const res = await fetchFn(modelUrl(file.path))
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
  await writeFile(join(dir, VERIFIED), MODEL.revision)
}

async function matches(path: string, sha256: string): Promise<boolean> {
  try {
    await stat(path)
  } catch {
    return false
  }
  const hash = createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
  return hash === sha256
}

export async function removeModel(dir: string) {
  await rm(dir, { recursive: true, force: true })
}
