import log from 'electron-log'
import Store from 'electron-store'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { WindowManager } from './WindowManager'
import { VaultModule } from './VaultModule'
import { AutoTypeModule } from './AutoTypeModule'
import { decodePreferences, encodePreferences, sanitizeBrand } from '../preferences/codec'
import {
  PREFERENCES_CHANGED_CHANNEL,
  VAULT_PREFERENCES_KEY,
  type Brand,
  type Preferences
} from '../preferences/protocol'

interface LocalPreferences {
  brand: Brand | null
}

/**
 * App preferences that follow the user: kept on this device, and also
 * written into the open vault's Meta/CustomData so another device picks them
 * up when it opens the same vault. Opening a vault imports what it carries.
 *
 * Synced: the brand color and the auto-type settings.
 */
export class PreferencesModule implements AppModule {
  private store = new Store<LocalPreferences>({ name: 'preferences', defaults: { brand: null } })

  constructor(
    private ipc: IpcTransport,
    private windows: WindowManager,
    private vault: VaultModule,
    private autotype: AutoTypeModule
  ) {}

  setup() {
    this.ipc.handleChannel('preferences:get', () => this.current())
    this.ipc.handleChannel('preferences:setBrand', (_e, brand: unknown) => {
      const clean = sanitizeBrand(brand)
      if (clean === undefined) throw new Error('Invalid brand color')
      this.store.set('brand', clean)
      this.changed(true)
      return this.current()
    })
    this.autotype.onSettingsChanged(() => this.changed(true))
    this.vault.onOpened(() => this.importFromVault())
  }

  private current(): Preferences {
    return {
      brand: this.store.get('brand'),
      autotype: this.autotype.currentSettings,
      vault: this.vault.isOpen ? this.vault.openFileName : undefined
    }
  }

  private changed(writeToVault: boolean) {
    if (writeToVault && this.vault.isOpen) {
      const { brand, autotype } = this.current()
      this.vault.writeCustomData(VAULT_PREFERENCES_KEY, encodePreferences({ brand, autotype }))
    }
    this.windows.broadcast(PREFERENCES_CHANGED_CHANNEL, this.current())
  }

  private importFromVault() {
    const synced = decodePreferences(this.vault.readCustomData(VAULT_PREFERENCES_KEY))
    if (synced) {
      log.info('Applying preferences stored in the vault')
      if (synced.brand !== undefined) this.store.set('brand', synced.brand)
      if (synced.autotype) this.autotype.applySynced(synced.autotype)
    }
    // Also tells the renderer which vault now carries the preferences.
    this.changed(false)
  }
}
