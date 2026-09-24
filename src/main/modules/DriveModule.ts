import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { DriveClient } from '../drive/DriveClient'
import { GoogleAuthModule } from './GoogleAuthModule'

/** Drive API access: listing vaults. Reading/writing goes through DriveSource. */
export class DriveModule implements AppModule {
  readonly client: DriveClient

  constructor(
    private ipc: IpcTransport,
    auth: GoogleAuthModule
  ) {
    this.client = new DriveClient(() => auth.getAccessToken())
  }

  setup() {
    this.ipc.handleChannel('drive:list', (_e, search?: string) => this.client.listVaults(search))
  }
}
