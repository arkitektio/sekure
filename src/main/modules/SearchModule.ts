import { join } from 'path'
import { pathToFileURL } from 'url'
import { app, net } from 'electron'
import log from 'electron-log'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { WindowManager } from './WindowManager'
import { VaultModule } from './VaultModule'
import { SearchIndex } from '../search/SearchIndex'
import { WorkerEmbedder } from '../search/WorkerEmbedder'
import { ensureModel, hasModel, removeModel } from '../search/modelStore'
import {
  MODEL,
  MODEL_BYTES,
  SEARCH_STATUS_CHANNEL,
  type SearchHit,
  type SemanticStatus
} from '../search/protocol'
import createEmbedderWorker from '../search/embedder.worker?nodeWorker'

interface SearchSettings {
  semantic: boolean
}

/**
 * Vault search: lexical always, plus a local embedding model once the user opts
 * in (downloaded once, then offline). The index and its vectors live in memory
 * only and are dropped on lock; the model runs in a worker thread.
 */
export class SearchModule implements AppModule {
  private settings = new Store<SearchSettings>({
    name: 'search',
    defaults: { semantic: false }
  })
  private index = new SearchIndex((done, total) =>
    this.setStatus(
      done < total ? { state: 'indexing', progress: done / total } : { state: 'ready' }
    )
  )
  private embedder: WorkerEmbedder | undefined
  private status: SemanticStatus = { state: 'off', downloadBytes: MODEL_BYTES }
  private enabling: Promise<void> | undefined

  constructor(
    private ipc: IpcTransport,
    private windows: WindowManager,
    private vault: VaultModule
  ) {}

  private get modelDir() {
    return join(app.getPath('userData'), 'models', MODEL.id, MODEL.revision)
  }

  /** ORT's WASM runtime, copied next to the main bundle (unpacked from the asar). */
  private get wasmPaths() {
    const dir = join(__dirname, 'ort').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    return pathToFileURL(dir).href + '/'
  }

  async setup() {
    const h = this.ipc.handleChannel.bind(this.ipc)
    // Typing a search is user input, but the renderer already reports that via
    // `vault:activity`; this handler must not keep the vault unlocked by itself.
    h('search:query', (_e, query: string): Promise<SearchHit[]> => this.index.search(query))
    h('search:status', () => this.status)
    h('search:enableSemantic', () => this.enable())
    h('search:disableSemantic', (_e, removeFiles: boolean) => this.disable(removeFiles))

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

    if (this.settings.get('semantic')) {
      this.setStatus(
        (await hasModel(this.modelDir))
          ? { state: 'ready' }
          : { state: 'error', message: 'The search model is missing. Enable smart search again.' }
      )
    }
  }

  async onBeforeQuit() {
    await this.stopEmbedder()
  }

  private enable(): Promise<void> {
    this.enabling ??= (async () => {
      try {
        this.setStatus({ state: 'downloading', progress: 0 })
        await ensureModel(
          this.modelDir,
          (url) => net.fetch(url),
          (progress) => this.setStatus({ state: 'downloading', progress })
        )
        this.settings.set('semantic', true)
        this.setStatus({ state: 'ready' })
        if (this.vault.isOpen) await this.startEmbedder()
      } catch (e) {
        log.error('Enabling smart search failed', e)
        this.setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) })
        throw e
      } finally {
        this.enabling = undefined
      }
    })()
    return this.enabling
  }

  private async disable(removeFiles: boolean) {
    this.settings.set('semantic', false)
    await this.stopEmbedder()
    if (removeFiles) await removeModel(join(app.getPath('userData'), 'models'))
    this.setStatus({ state: 'off' })
  }

  private async startEmbedder() {
    if (this.embedder) return
    this.setStatus({ state: 'loading' })
    const embedder = new WorkerEmbedder(
      createEmbedderWorker({ workerData: { modelDir: this.modelDir, wasmPaths: this.wasmPaths } })
    )
    this.embedder = embedder
    try {
      await embedder.ready
    } catch (e) {
      if (this.embedder !== embedder) return // stopped on lock while loading, not a failure
      log.error('Loading the search model failed', e)
      this.embedder = undefined
      await embedder.terminate()
      this.setStatus({ state: 'error', message: 'The search model could not be loaded.' })
      return
    }
    if (this.embedder !== embedder) return // locked meanwhile
    await this.index.setEmbedder(embedder)
    if (this.embedder === embedder) this.setStatus({ state: 'ready' })
  }

  private async stopEmbedder() {
    const embedder = this.embedder
    this.embedder = undefined
    await this.index.setEmbedder(undefined)
    if (embedder) await embedder.terminate()
    if (this.settings.get('semantic') && this.status.state !== 'error') {
      this.setStatus({ state: 'ready' })
    }
  }

  private setStatus(s: Omit<SemanticStatus, 'downloadBytes'>) {
    this.status = { ...s, downloadBytes: MODEL_BYTES }
    this.windows.broadcast(SEARCH_STATUS_CHANNEL, this.status)
  }
}
