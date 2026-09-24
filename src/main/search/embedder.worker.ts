// Worker thread that owns the embedding model, so indexing never blocks main.
import { workerData } from 'worker_threads'
import { serveModel } from '../models/workerHost'
import { loadE5, type E5Options } from './e5'

export interface EmbedRequest {
  id: number
  texts: string[]
  kind: 'query' | 'passage'
}

serveModel<EmbedRequest, Float32Array[]>(
  async () => {
    const model = await loadE5(workerData as E5Options)
    return (req) => model.embed(req.texts, req.kind)
  },
  (vectors) => vectors.map((v) => v.buffer as ArrayBuffer)
)
