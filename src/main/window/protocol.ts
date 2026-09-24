// Window chrome shared with preload and renderer. No imports: the sandboxed
// preload gets the constants below inlined by the bundler.

export interface WindowState {
  /** macOS fullscreen hides the traffic lights, so the rail drops their gutter. */
  fullscreen: boolean
}

export const WINDOW_STATE_CHANNEL = 'window:state-changed'
