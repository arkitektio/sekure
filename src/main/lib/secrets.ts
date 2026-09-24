import { safeStorage } from 'electron'
import Store from 'electron-store'

/**
 * Small wrapper around `safeStorage` (macOS Keychain / DPAPI / libsecret) for
 * values that must never sit on disk in plaintext: the Google refresh token and
 * the Touch ID quick-unlock secrets. Ciphertext lives in its own store file.
 */
export class SecretStore {
  private store = new Store<Record<string, string>>({ name: 'secrets' })

  available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  set(key: string, value: string): void {
    if (!this.available()) throw new Error('OS secure storage is not available')
    this.store.set(key, safeStorage.encryptString(value).toString('base64'))
  }

  get(key: string): string | undefined {
    const b64 = this.store.get(key)
    if (!b64 || !this.available()) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'))
    } catch {
      // Keychain item rotated or file copied from another machine.
      this.store.delete(key)
      return undefined
    }
  }

  has(key: string): boolean {
    return this.store.has(key)
  }

  delete(key: string): void {
    this.store.delete(key)
  }
}
