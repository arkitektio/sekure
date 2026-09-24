import { readFile } from 'fs/promises'
import { join } from 'path'
import { Tokenizer } from '@huggingface/tokenizers'
import * as ort from 'onnxruntime-web'
import type { Embedder } from './SearchIndex'
import { assertPinned } from '../models/modelStore'
import type { ModelSpec } from '../models/spec'

const MAX_TOKENS = 128

export interface E5Options {
  /** Folder holding the model files (see `MODEL` in protocol.ts). */
  modelDir: string
  /** Folder (or URL) with ORT's `ort-wasm-simd-threaded.{mjs,wasm}`; default: next to the package. */
  wasmPaths?: string
  /** When given, every file must match its sha256 pin before the model runs. */
  spec?: ModelSpec
}

/**
 * multilingual-e5-small via onnxruntime-web (WASM, so nothing native to ship):
 * tokenize with the model's prefixes, run, mean-pool over the attention mask,
 * L2-normalise.
 */
export async function loadE5({ modelDir, wasmPaths, spec }: E5Options): Promise<Embedder> {
  ort.env.wasm.numThreads = 1
  if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths

  const [tokenizerJson, configJson, model] = await Promise.all([
    readFile(join(modelDir, 'tokenizer.json'), 'utf8'),
    readFile(join(modelDir, 'tokenizer_config.json'), 'utf8'),
    readFile(join(modelDir, 'onnx', 'model_quantized.onnx'))
  ])
  if (spec) {
    assertPinned(spec, 'tokenizer.json', tokenizerJson)
    assertPinned(spec, 'tokenizer_config.json', configJson)
    assertPinned(spec, 'onnx/model_quantized.onnx', model)
  }
  const tokenizer = new Tokenizer(JSON.parse(tokenizerJson), JSON.parse(configJson))
  const session = await ort.InferenceSession.create(model)
  const wantsTypeIds = session.inputNames.includes('token_type_ids')
  const output = session.outputNames[0]

  return {
    async embed(texts, kind) {
      if (!texts.length) return []
      const prefix = kind === 'query' ? 'query: ' : 'passage: '
      const encoded = texts.map((t) => tokenizer.encode(prefix + t))
      const len = Math.min(MAX_TOKENS, Math.max(...encoded.map((e) => e.ids.length)))
      const n = texts.length
      const ids = new BigInt64Array(n * len)
      const mask = new BigInt64Array(n * len)
      encoded.forEach((e, i) => {
        const count = Math.min(len, e.ids.length)
        for (let j = 0; j < count; j++) {
          ids[i * len + j] = BigInt(e.ids[j])
          mask[i * len + j] = 1n
        }
        // Truncated: keep the closing special token so the model sees a proper end.
        if (e.ids.length > len) ids[i * len + len - 1] = BigInt(e.ids[e.ids.length - 1])
      })
      const feeds: Record<string, ort.Tensor> = {
        input_ids: new ort.Tensor('int64', ids, [n, len]),
        attention_mask: new ort.Tensor('int64', mask, [n, len])
      }
      if (wantsTypeIds)
        feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(n * len), [n, len])

      const result = await session.run(feeds)
      const hidden = result[output]
      const dim = hidden.dims[2]
      const data = hidden.data as Float32Array
      return encoded.map((_, i) => {
        const v = new Float32Array(dim)
        let count = 0
        for (let j = 0; j < len; j++) {
          if (!mask[i * len + j]) continue
          count++
          const base = (i * len + j) * dim
          for (let h = 0; h < dim; h++) v[h] += data[base + h]
        }
        let norm = 0
        for (let h = 0; h < dim; h++) {
          v[h] /= count
          norm += v[h] * v[h]
        }
        norm = Math.sqrt(norm) || 1
        for (let h = 0; h < dim; h++) v[h] /= norm
        return v
      })
    }
  }
}
