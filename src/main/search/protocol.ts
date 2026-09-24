// Shared between main, preload and renderer. No imports: the sandboxed preload
// gets the constants below inlined by the bundler.

export interface SearchHit {
  uuid: string
  score: number
  /** `text`: the words match. `semantic`: only the meaning does (local embedding model). */
  match: 'text' | 'semantic'
}

export type SemanticState = 'off' | 'downloading' | 'loading' | 'indexing' | 'ready' | 'error'

export interface SemanticStatus {
  state: SemanticState
  /** 0–1 while downloading or indexing. */
  progress?: number
  message?: string
  /** Download size of the model, for the opt-in prompt. */
  downloadBytes: number
}

export const SEARCH_STATUS_CHANNEL = 'search:status-changed'

/** The embedding model, pinned to a revision; every file is checked against its sha256. */
export const MODEL = {
  id: 'multilingual-e5-small',
  repo: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  files: [
    {
      path: 'tokenizer_config.json',
      size: 443,
      sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b'
    },
    {
      path: 'tokenizer.json',
      size: 17082730,
      sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'
    },
    {
      path: 'onnx/model_quantized.onnx',
      size: 118308185,
      sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'
    }
  ]
} as const

export const MODEL_BYTES = MODEL.files.reduce((n, f) => n + f.size, 0)
