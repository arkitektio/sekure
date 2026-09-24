import { createHash } from 'crypto'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertPinned, ensureModel, hasModel, modelUrl } from './modelStore'
import type { ModelSpec } from './spec'

// Small fake files stand in for a model so the test stays fast.
const files = {
  'tokenizer_config.json': '{"a":1}',
  'tokenizer.json': '{"tok":true}',
  'onnx/model_quantized.onnx': 'onnx-bytes'
}

const spec: ModelSpec = {
  id: 'test-model',
  repo: 'org/test-model',
  revision: 'abc123',
  files: Object.entries(files).map(([path, body]) => ({
    path,
    size: body.length,
    sha256: createHash('sha256').update(body).digest('hex')
  }))
}
const urlOf = (path: string) => modelUrl(spec, path)

const serve = (overrides: Record<string, string> = {}) =>
  vi.fn(async (url: string) => {
    const path = Object.keys(files).find((p) => url === urlOf(p))
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
    await ensureModel(dir, spec, fetchFn, progress)
    expect(await hasModel(dir, spec)).toBe(true)
    expect(await readFile(join(dir, 'onnx/model_quantized.onnx'), 'utf8')).toBe('onnx-bytes')
    expect(progress).toHaveBeenLastCalledWith(1)
    expect(fetchFn).toHaveBeenCalledTimes(3)

    await ensureModel(dir, spec, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(3) // nothing re-downloaded
  })

  it('rejects a tampered file and leaves nothing behind', async () => {
    await expect(ensureModel(dir, spec, serve({ 'tokenizer.json': '{"evil":1}' }))).rejects.toThrow(
      /integrity/
    )
    expect(await hasModel(dir, spec)).toBe(false)
    expect((await readdir(dir)).filter((f) => f.startsWith('tokenizer.json'))).toEqual([])
  })

  it('surfaces HTTP errors', async () => {
    const fetchFn = vi.fn(async () => new Response('gone', { status: 500 }))
    await expect(ensureModel(dir, spec, fetchFn)).rejects.toThrow(/500/)
  })

  it('keeps files that already verify', async () => {
    const first = serve({ 'onnx/model_quantized.onnx': 'broken' })
    await expect(ensureModel(dir, spec, first)).rejects.toThrow()
    const second = serve()
    await ensureModel(dir, spec, second)
    // Both tokenizer files were already fine; only the model was fetched again.
    expect(second.mock.calls.map((c) => c[0])).toEqual([urlOf('onnx/model_quantized.onnx')])
  })
})

describe('assertPinned', () => {
  it('accepts the pinned bytes, as text or binary', () => {
    expect(() => assertPinned(spec, 'tokenizer.json', files['tokenizer.json'])).not.toThrow()
    const bytes = new TextEncoder().encode(files['onnx/model_quantized.onnx'])
    expect(() => assertPinned(spec, 'onnx/model_quantized.onnx', bytes)).not.toThrow()
  })

  it('rejects changed or unknown files', () => {
    expect(() => assertPinned(spec, 'tokenizer.json', '{"tok":false}')).toThrow(/integrity/)
    expect(() => assertPinned(spec, 'evil.onnx', 'x')).toThrow(/not part of/)
  })
})
