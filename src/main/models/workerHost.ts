import { parentPort } from 'worker_threads'
import type { WorkerResponse } from './WorkerClient'

/**
 * Worker side of `WorkerClient`: load the model once, then answer requests.
 * `transfer` picks ArrayBuffers to move instead of copy.
 */
export function serveModel<Req extends { id: number }, Res>(
  load: () => Promise<(req: Req) => Promise<Res>>,
  transfer: (res: Res) => ArrayBuffer[] = () => []
) {
  const port = parentPort!
  const post = (msg: WorkerResponse<Res>, list: ArrayBuffer[] = []) => port.postMessage(msg, list)
  const handler = load()
  handler.then(
    () => post({ type: 'ready' }),
    (e) => post({ type: 'failed', error: String(e) })
  )
  port.on('message', async (req: Req) => {
    try {
      const value = await (await handler)(req)
      post({ type: 'result', id: req.id, value }, transfer(value))
    } catch (e) {
      post({ type: 'error', id: req.id, error: String(e) })
    }
  })
}
