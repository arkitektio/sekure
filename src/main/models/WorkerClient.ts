import type { Worker } from 'worker_threads'

/** Messages a model worker sends back (see `serveModel` in workerHost.ts). */
export type WorkerResponse<T> =
  | { type: 'ready' }
  | { type: 'failed'; error: string }
  | { type: 'result'; id: number; value: T }
  | { type: 'error'; id: number; error: string }

/** Request/response over a worker thread that loads a model first. */
export class WorkerClient<Req extends object, Res> {
  readonly ready: Promise<void>
  private nextId = 1
  private pending = new Map<number, { resolve: (v: Res) => void; reject: (e: Error) => void }>()

  constructor(private worker: Worker) {
    this.ready = new Promise((resolve, reject) => {
      worker.on('message', (msg: WorkerResponse<Res>) => {
        if (msg.type === 'ready') resolve()
        else if (msg.type === 'failed') reject(new Error(msg.error))
        else {
          const p = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.type === 'result') p?.resolve(msg.value)
          else p?.reject(new Error(msg.error))
        }
      })
      worker.on('error', (e) => {
        reject(e)
        this.failAll(e)
      })
      worker.on('exit', () => {
        reject(new Error('Model worker stopped'))
        this.failAll(new Error('Model worker stopped'))
      })
    })
    // Callers that never await `ready` must not see an unhandled rejection.
    this.ready.catch(() => {})
  }

  call(req: Req): Promise<Res> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...req, id })
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
