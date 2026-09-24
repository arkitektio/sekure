import type { Worker } from 'worker_threads'
import type { Embedder } from './SearchIndex'

export interface WorkerRequest {
  id: number
  texts: string[]
  kind: 'query' | 'passage'
}

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'failed'; error: string }
  | { type: 'result'; id: number; vectors: Float32Array[] }
  | { type: 'error'; id: number; error: string }

/** An `Embedder` backed by `embedder.worker.ts`. */
export class WorkerEmbedder implements Embedder {
  readonly ready: Promise<void>
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }
  >()

  constructor(private worker: Worker) {
    this.ready = new Promise((resolve, reject) => {
      worker.on('message', (msg: WorkerResponse) => {
        if (msg.type === 'ready') resolve()
        else if (msg.type === 'failed') reject(new Error(msg.error))
        else {
          const p = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.type === 'result') p?.resolve(msg.vectors)
          else p?.reject(new Error(msg.error))
        }
      })
      worker.on('error', (e) => {
        reject(e)
        this.failAll(e)
      })
      worker.on('exit', () => this.failAll(new Error('Embedding worker stopped')))
    })
  }

  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, texts, kind } satisfies WorkerRequest)
    })
  }

  async terminate() {
    await this.worker.terminate()
  }

  private failAll(e: Error) {
    for (const p of this.pending.values()) p.reject(e)
    this.pending.clear()
  }
}
