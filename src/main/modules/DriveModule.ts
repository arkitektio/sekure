import { shell } from 'electron'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { DriveClient } from '../drive/DriveClient'
import { pickDriveFile } from '../drive/picker'
import type { PickedFile } from '../drive/protocol'
import { GoogleAuthModule } from './GoogleAuthModule'

/** Drive API access: listing and picking vaults. Reading/writing goes through DriveSource. */
export class DriveModule implements AppModule {
  readonly client: DriveClient
  private picking: AbortController | undefined

  constructor(
    private ipc: IpcTransport,
    private auth: GoogleAuthModule
  ) {
    this.client = new DriveClient((force) => auth.getAccessToken(force))
  }

  setup() {
    this.ipc.handleChannel('drive:list', (_e, search?: unknown) =>
      this.client.listVaults(typeof search === 'string' ? search : undefined)
    )
    this.ipc.handleChannel('drive:pick', () => this.pick())
    this.ipc.handleChannel('drive:cancelPick', () => this.picking?.abort())
  }

  onBeforeQuit() {
    this.picking?.abort()
  }

  /** Google Picker in the browser; grants Sekure (drive.file) access to the chosen file. */
  private async pick(): Promise<PickedFile | null> {
    const apiKey = import.meta.env.MAIN_VITE_GOOGLE_API_KEY
    const appId = import.meta.env.MAIN_VITE_GOOGLE_APP_ID
    if (!apiKey || !appId) {
      throw new Error(
        'No Google Picker key configured in this build. See README → Google Cloud setup.'
      )
    }
    this.picking?.abort()
    const controller = new AbortController()
    this.picking = controller
    try {
      const accessToken = await this.auth.getAccessToken()
      return await pickDriveFile({ accessToken, apiKey, appId }, (url) => shell.openExternal(url), {
        signal: controller.signal
      })
    } finally {
      if (this.picking === controller) this.picking = undefined
    }
  }
}
