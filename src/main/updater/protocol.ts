// Auto-update state, shared with preload and renderer. No imports: the sandboxed
// preload gets the constants below inlined by the bundler.

/** "next" surfaces prereleases (`-rc`); "latest" is stable. */
export type UpdateChannel = 'latest' | 'next'

export type UpdatePhase =
  /** Not a packaged build (`pnpm dev`): updates are off. */
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'downloading'
  /** Downloaded; installs on restart (or on the next quit). */
  | 'ready'
  | 'upToDate'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** The running version. */
  current: string
  channel: UpdateChannel
  /** The version being downloaded or ready to install. */
  version?: string
  /** 0–1 while downloading. */
  progress?: number
  error?: string
}

export const UPDATE_STATE_CHANNEL = 'updater:state'
