import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Small fake files stand in for the model so the test stays fast.
const files = vi.hoisted(() => ({
  'tokenizer_config.json': '{"a":1}',
  'tokenizer.json': '{"tok":true}',
  'onnx/model_quantized.onnx': 'onnx-bytes'
}))

vi.mock('./protocol', async (orig) => {
  const { createHash } = await import('crypto')
  const actual = await orig<typeof import('./protocol')>()
  return {
    ...actual,
    MODEL: {
      ...actual.MODEL,
      files: Object.entries(files).map(([path, body]) => ({
        path,
        size: body.length,
        sha256: createHash('sha256').update(body).digest('hex')
      }))
    }
  }
})

const { ensureModel, hasModel, modelUrl } = await import('./modelStore')

const serve = (overrides: Record<string, string> = {}) =>
  vi.fn(async (url: string) => {
    const path = Object.keys(files).find((p) => url === modelUrl(p))
    if (!path) return new Response('nope', { status: 404 })
    return new Response(overrides[path] ?? files[path as keyof typeof files])
  })

describe('ensureModel', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sekure-model-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('downloads, verifies and marks the model', async () => {
    const fetchFn = serve()
    const progress = vi.fn()
    await ensureModel(dir, fetchFn, progress)
    expect(await hasModel(dir)).toBe(true)
    expect(await readFile(join(dir, 'onnx/model_quantized.onnx'), 'utf8')).toBe('onnx-bytes')
    expect(progress).toHaveBeenLastCalledWith(1)
    expect(fetchFn).toHaveBeenCalledTimes(3)

    await ensureModel(dir, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(3) // nothing re-downloaded
  })

  it('rejects a tampered file and leaves nothing behind', async () => {
    await expect(ensureModel(dir, serve({ 'tokenizer.json': '{"evil":1}' }))).rejects.toThrow(
      /integrity/
    )
    expect(await hasModel(dir)).toBe(false)
    expect((await readdir(dir)).filter((f) => f.startsWith('tokenizer.json'))).toEqual([])
  })

  it('surfaces HTTP errors', async () => {
    const fetchFn = vi.fn(async () => new Response('gone', { status: 500 }))
    await expect(ensureModel(dir, fetchFn)).rejects.toThrow(/500/)
  })

  it('keeps files that already verify', async () => {
    const first = serve({ 'onnx/model_quantized.onnx': 'broken' })
    await expect(ensureModel(dir, first)).rejects.toThrow()
    const second = serve()
    await ensureModel(dir, second)
    // Both tokenizer files were already fine; only the model was fetched again.
    expect(second.mock.calls.map((c) => c[0])).toEqual([modelUrl('onnx/model_quantized.onnx')])
  })
})
