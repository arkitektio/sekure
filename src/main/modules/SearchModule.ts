import { join } from 'path'
import log from 'electron-log'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { bundledModelDir, modelsRoot, ortWasmPaths } from './modelPaths'
import { IpcTransport } from './IpcTransport'
import { WindowManager } from './WindowManager'
import { VaultModule } from './VaultModule'
import { SearchIndex } from '../search/SearchIndex'
import { TypeIndex } from '../search/TypeIndex'
import type { Embedder } from '../search/SearchIndex'
import type { EmbedRequest } from '../search/embedder.worker'
import { WorkerClient } from '../models/WorkerClient'
import { hasModel, removeModel } from '../models/modelStore'
import {
  MODEL,
  SEARCH_STATUS_CHANNEL,
  type SearchHit,
  type SemanticStatus,
  type TypeSuggestion
} from '../search/protocol'
import createEmbedderWorker from '../search/embedder.worker?nodeWorker'

/** The embedding worker as an `Embedder`. */
class EmbedderWorker
  extends WorkerClient<Omit<EmbedRequest, 'id'>, Float32Array[]>
  implements Embedder
{
  embed(texts: string[], kind: 'query' | 'passage') {
    return this.call({ texts, kind })
  }
}

interface SearchSettings {
  semantic: boolean
}

/**
 * Vault search: lexical always, plus a local embedding model that ships inside the
 * signed app (on unless the user turns it off). The worker checks the model files
 * against their sha256 pins before running them. The index and its vectors live in
 * memory only and are dropped on lock; the model runs in a worker thread.
 */
export class SearchModule implements AppModule {
  private settings = new Store<SearchSettings>({
    name: 'search',
    defaults: { semantic: true }
  })
  private index = new SearchIndex((done, total) =>
    this.setStatus(
      done < total ? { state: 'indexing', progress: done / total } : { state: 'ready' }
    )
  )
  private types = new TypeIndex()
  private embedder: EmbedderWorker | undefined
  private status: SemanticStatus = { state: 'off' }

  constructor(
    private ipc: IpcTransport,
    private windows: WindowManager,
    private vault: VaultModule
  ) {}

  private get modelDir() {
    return bundledModelDir(MODEL)
  }

  async setup() {
    const h = this.ipc.handleChannel.bind(this.ipc)
    // Typing a search is user input, but the renderer already reports that via
    // `vault:activity`; this handler must not keep the vault unlocked by itself.
    h('search:query', (_e, query: string): Promise<SearchHit[]> => this.index.search(query))
    // Same for “Add …” suggestions: polled per keystroke, never resets the idle timer.
    h('search:suggestTypes', (_e, query: unknown) => this.suggestTypes(query))
    h('search:status', () => this.status)
    h('search:enableSemantic', () => this.enable())
    h('search:disableSemantic', () => this.disable())

    this.vault.onEvent((event) => {
      if (event.type === 'opened') {
        void this.index.setDocuments(this.vault.searchDocuments())
        if (this.settings.get('semantic')) void this.startEmbedder()
      } else if (event.type === 'changed') {
        void this.index.setDocuments(this.vault.searchDocuments())
      } else if (event.type === 'locked') {
        this.index.clear()
        void this.stopEmbedder()
      }
    })

    if (this.settings.get('semantic')) this.setStatus(await this.bundledStatus())
    // Older versions downloaded the model into userData; the app carries it now.
    void removeModel(join(modelsRoot(), MODEL.id)).catch(() => {})
  }

  /** `ready`, or an error when the build shipped without the model (never in a release). */
  private async bundledStatus(): Promise<SemanticStatus> {
    return (await hasModel(this.modelDir, MODEL))
      ? { state: 'ready' }
      : { state: 'error', message: 'This build of Sekure ships without the search model.' }
  }

  private async suggestTypes(query: unknown): Promise<TypeSuggestion[]> {
    if (typeof query !== 'string' || query.length > 200 || !this.types.ready) return []
    const qv = await this.index.queryVector(query)
    return qv ? this.types.suggest(qv) : []
  }

  async onBeforeQuit() {
    await this.stopEmbedder()
  }

  private async enable() {
    this.settings.set('semantic', true)
    this.setStatus(await this.bundledStatus())
    if (this.status.state === 'ready' && this.vault.isOpen) await this.startEmbedder()
  }

  private async disable() {
    this.settings.set('semantic', false)
    await this.stopEmbedder()
    this.setStatus({ state: 'off' })
  }

  private async startEmbedder() {
    if (this.embedder) return
    this.setStatus({ state: 'loading' })
    const embedder = new EmbedderWorker(
      createEmbedderWorker({
        // `spec`: the worker refuses files that don't match their sha256 pins.
        workerData: { modelDir: this.modelDir, wasmPaths: ortWasmPaths(), spec: MODEL }
      })
    )
    this.embedder = embedder
    try {
      await embedder.ready
    } catch (e) {
      if (this.embedder !== embedder) return // stopped on lock while loading, not a failure
      log.error('Loading the search model failed', e)
      this.embedder = undefined
      await embedder.terminate()
      this.setStatus({
        state: 'error',
        message: 'The search model could not be loaded or failed its integrity check.'
      })
      return
    }
    if (this.embedder !== embedder) return // locked meanwhile
    await Promise.all([this.index.setEmbedder(embedder), this.types.setEmbedder(embedder)])
    if (this.embedder === embedder) this.setStatus({ state: 'ready' })
  }

  private async stopEmbedder() {
    const embedder = this.embedder
    this.embedder = undefined
    await Promise.all([this.index.setEmbedder(undefined), this.types.setEmbedder(undefined)])
    if (embedder) await embedder.terminate()
    if (this.settings.get('semantic') && this.status.state !== 'error') {
      this.setStatus({ state: 'ready' })
    }
  }

  private setStatus(s: SemanticStatus) {
    this.status = s
    this.windows.broadcast(SEARCH_STATUS_CHANNEL, this.status)
  }
}
