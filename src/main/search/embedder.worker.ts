// Worker thread that owns the embedding model, so indexing never blocks main.
import { parentPort, workerData } from 'worker_threads'
import { loadE5, type E5Options } from './e5'
import type { WorkerRequest, WorkerResponse } from './WorkerEmbedder'

const port = parentPort!
const post = (msg: WorkerResponse, transfer: ArrayBuffer[] = []) => port.postMessage(msg, transfer)

const model = loadE5(workerData as E5Options)
model.then(
  () => post({ type: 'ready' }),
  (e) => post({ type: 'failed', error: String(e) })
)

port.on('message', async (req: WorkerRequest) => {
  try {
    const vectors = await (await model).embed(req.texts, req.kind)
    post(
      { type: 'result', id: req.id, vectors },
      vectors.map((v) => v.buffer as ArrayBuffer)
    )
  } catch (e) {
    post({ type: 'error', id: req.id, error: String(e) })
  }
})
