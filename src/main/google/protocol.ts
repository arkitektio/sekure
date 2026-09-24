export interface GoogleAccount {
  email: string
  name?: string
  picture?: string
}

export interface AuthStatus {
  connected: boolean
  account?: GoogleAccount
  /** False when the build has no OAuth client configured (missing .env). */
  configured: boolean
  /**
   * Set once after an update disconnected an old full-Drive grant: reconnect,
   * then re-pick Drive vaults (Sekure now only sees files it was given).
   */
  scopeChanged?: boolean
}
