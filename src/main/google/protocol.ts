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
}
