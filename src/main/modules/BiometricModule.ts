import { systemPreferences } from 'electron'
import log from 'electron-log'
import { AppModule } from './AppModule'
import { IpcTransport } from './IpcTransport'
import { VaultModule } from './VaultModule'
import { SecretStore } from '../lib/secrets'
import { VaultError } from '../vault/VaultSession'
import type { VaultSnapshot } from '../vault/protocol'

interface StoredUnlock {
  password: string
  /** base64 key-file bytes, when the database uses one. */
  keyFile?: string
}

const keyFor = (fileId: string) => `biometric.${fileId}`

/**
 * Touch ID quick unlock, KeePassXC-style: the master password is sealed with
 * `safeStorage` (Keychain-backed) and only released after `promptTouchID`
 * succeeds. The password never reaches the renderer.
 *
 * Limitation: the Keychain item itself is not biometry-bound (that needs a
 * native `kSecAccessControlBiometryCurrentSet` item); Touch ID is enforced by
 * this process. See README → Security model.
 */
export class BiometricModule implements AppModule {
  private secrets = new SecretStore()

  constructor(
    private ipc: IpcTransport,
    private vault: VaultModule
  ) {}

  setup() {
    this.ipc.handleChannel('biometric:available', () => this.available())
    this.ipc.handleChannel('biometric:enabled', (_e, fileId: string) =>
      this.secrets.has(keyFor(fileId))
    )
    this.ipc.handleChannel('biometric:enable', (_e, fileId: string) => this.enable(fileId))
    this.ipc.handleChannel('biometric:disable', (_e, fileId: string) => {
      this.secrets.delete(keyFor(fileId))
    })
    this.ipc.handleChannel('biometric:unlock', (_e, fileId: string) => this.unlock(fileId))
  }

  available(): boolean {
    return (
      process.platform === 'darwin' &&
      systemPreferences.canPromptTouchID() &&
      this.secrets.available()
    )
  }

  private async enable(fileId: string): Promise<void> {
    if (!this.available()) throw new Error('Touch ID is not available on this Mac')
    // Only credentials that just opened this very file, held by main since
    // that `vault:open`: the renderer never sends the password again.
    const credentials = this.vault.takeBiometricCredentials(fileId)
    if (!credentials) throw new Error('Unlock the vault with its password first')
    await systemPreferences.promptTouchID('enable Touch ID unlock for this vault')
    const stored: StoredUnlock = {
      password: credentials.password,
      keyFile: credentials.keyFile ? Buffer.from(credentials.keyFile).toString('base64') : undefined
    }
    this.secrets.set(keyFor(fileId), JSON.stringify(stored))
  }

  private async unlock(fileId: string): Promise<VaultSnapshot> {
    if (!this.available()) throw new Error('Touch ID is not available on this Mac')
    await systemPreferences.promptTouchID('unlock your vault')
    const raw = this.secrets.get(keyFor(fileId))
    if (!raw) throw new Error('Touch ID is not set up for this vault')
    const stored = JSON.parse(raw) as StoredUnlock
    try {
      return await this.vault.open(
        fileId,
        stored.password,
        stored.keyFile ? new Uint8Array(Buffer.from(stored.keyFile, 'base64')) : undefined
      )
    } catch (e) {
      if (e instanceof VaultError && e.code === 'InvalidKey') {
        // Master password changed elsewhere: the sealed copy is useless now.
        log.info('Stored Touch ID credentials no longer open the vault; clearing')
        this.secrets.delete(keyFor(fileId))
        throw new Error('InvalidKey: The master password has changed. Unlock with your password.')
      }
      if (e instanceof VaultError) throw new Error(`${e.code}: ${e.message}`)
      throw e
    }
  }
}
