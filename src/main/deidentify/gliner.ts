import { readFile } from 'fs/promises'
import { join } from 'path'
import { Tokenizer } from '@huggingface/tokenizers'
import * as ort from 'onnxruntime-web'
import type { SpanKind } from './protocol'
import type { Span } from './span'

/** Labels asked of the model, and the placeholder kind each becomes. */
export const GLINER_LABELS: Record<string, SpanKind> = {
  person: 'PERSON',
  organization: 'ORG',
  address: 'ADDRESS',
  email: 'EMAIL',
  'phone number': 'PHONE',
  'date of birth': 'DATE',
  'passport number': 'ID',
  'identity card number': 'ID',
  'social security number': 'ID',
  'tax identification number': 'ID',
  'bank account number': 'ACCOUNT',
  iban: 'IBAN',
  'credit card number': 'CARD',
  username: 'USERNAME',
  'ip address': 'IP',
  'license plate number': 'ID',
  'health insurance number': 'ID',
  'medical condition': 'HEALTH'
}

export const DEFAULT_THRESHOLD = 0.5
const WINDOW_WORDS = 200
const OVERLAP_WORDS = 30

export interface GlinerOptions {
  modelDir: string
  wasmPaths?: string
}

interface Word {
  text: string
  start: number
  end: number
}

/** GLiNER's whitespace splitter, Unicode-aware, keeping emails and dotted tokens whole. */
export function splitWords(text: string): Word[] {
  const words: Word[] = []
  for (const m of text.matchAll(/[\p{L}\p{N}_]+(?:[-_.@'][\p{L}\p{N}_]+)*|\S/gu)) {
    words.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return words
}

export interface Gliner {
  predict(text: string, threshold?: number): Promise<Span[]>
}

/**
 * GLiNER span NER (markerV0) on onnxruntime-web. The prompt lists the labels
 * (`<<ENT>> person <<ENT>> email … <<SEP>>`) followed by the words; the model
 * scores every span of up to `max_width` words against every label.
 */
export async function loadGliner({ modelDir, wasmPaths }: GlinerOptions): Promise<Gliner> {
  ort.env.wasm.numThreads = 1
  if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths

  const [configJson, tokenizerJson, tokenizerConfig, model] = await Promise.all([
    readFile(join(modelDir, 'gliner_config.json'), 'utf8'),
    readFile(join(modelDir, 'tokenizer.json'), 'utf8'),
    readFile(join(modelDir, 'tokenizer_config.json'), 'utf8'),
    readFile(join(modelDir, 'onnx', 'model_fp16.onnx'))
  ])
  const config = JSON.parse(configJson) as {
    max_width: number
    ent_token: string
    sep_token: string
  }
  const tokenizer = new Tokenizer(JSON.parse(tokenizerJson), JSON.parse(tokenizerConfig))
  const session = await ort.InferenceSession.create(model)
  const encode = (w: string) => tokenizer.encode(w, { add_special_tokens: false }).ids
  const clsId = tokenizer.encode('', { add_special_tokens: true }).ids[0]
  const sepId = tokenizer.encode('', { add_special_tokens: true }).ids.at(-1)!

  const labels = Object.keys(GLINER_LABELS)
  const prompt: number[] = []
  for (const label of labels) prompt.push(...encode(config.ent_token), ...encode(label))
  prompt.push(...encode(config.sep_token))
  const maxWidth = config.max_width

  const big = (a: number[]) => BigInt64Array.from(a, (x) => BigInt(x))

  async function window(words: Word[], threshold: number) {
    const ids = [clsId, ...prompt]
    const wordsMask = ids.map(() => 0)
    words.forEach((w, i) =>
      encode(w.text).forEach((id, k) => {
        ids.push(id)
        wordsMask.push(k === 0 ? i + 1 : 0)
      })
    )
    ids.push(sepId)
    wordsMask.push(0)
    const n = words.length
    const spanIdx: number[] = []
    const spanMask: number[] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < maxWidth; j++) {
        spanIdx.push(i, Math.min(i + j, n - 1))
        spanMask.push(i + j < n ? 1 : 0)
      }
    }
    const out = await session.run({
      input_ids: new ort.Tensor('int64', big(ids), [1, ids.length]),
      attention_mask: new ort.Tensor('int64', big(ids.map(() => 1)), [1, ids.length]),
      words_mask: new ort.Tensor('int64', big(wordsMask), [1, ids.length]),
      text_lengths: new ort.Tensor('int64', big([n]), [1, 1]),
      span_idx: new ort.Tensor('int64', big(spanIdx), [1, n * maxWidth, 2]),
      span_mask: new ort.Tensor('bool', Uint8Array.from(spanMask), [1, n * maxWidth])
    })
    const logits = out.logits
    const [, rows, widths, classes] = logits.dims
    const data = logits.data as Float32Array
    const found: { i: number; e: number; label: string; score: number }[] = []
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < widths && i + j < n; j++) {
        for (let c = 0; c < classes; c++) {
          const score = 1 / (1 + Math.exp(-data[(i * widths + j) * classes + c]))
          if (score >= threshold) found.push({ i, e: i + j, label: labels[c], score })
        }
      }
    }
    return found
  }

  return {
    async predict(text, threshold = DEFAULT_THRESHOLD) {
      const words = splitWords(text)
      const candidates: Span[] = []
      for (let at = 0; at < words.length; at += WINDOW_WORDS - OVERLAP_WORDS) {
        const slice = words.slice(at, at + WINDOW_WORDS)
        for (const f of await window(slice, threshold)) {
          candidates.push({
            start: slice[f.i].start,
            end: slice[f.e].end,
            kind: GLINER_LABELS[f.label],
            label: f.label,
            source: 'model',
            score: f.score
          })
        }
        if (at + WINDOW_WORDS >= words.length) break
      }
      // Flat NER: best-scoring spans first, no overlaps.
      candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      const kept: Span[] = []
      for (const c of candidates) {
        if (!kept.some((k) => c.start < k.end && k.start < c.end)) kept.push(c)
      }
      return kept.sort((a, b) => a.start - b.start)
    }
  }
}
