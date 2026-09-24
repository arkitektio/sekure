// Worker thread that owns the PII model, so a long selection never blocks main.
import { workerData } from 'worker_threads'
import { serveModel } from '../models/workerHost'
import { loadGliner, type GlinerOptions } from './gliner'
import type { Span } from './span'

export interface PredictRequest {
  id: number
  text: string
  threshold?: number
}

serveModel<PredictRequest, Span[]>(async () => {
  const model = await loadGliner(workerData as GlinerOptions)
  return (req) => model.predict(req.text, req.threshold)
})
