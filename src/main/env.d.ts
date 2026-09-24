/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
  /** Browser API key for the Google Picker (restricted to the Picker API). */
  readonly MAIN_VITE_GOOGLE_API_KEY?: string
  /** Google Cloud project number, required by the Picker for drive.file. */
  readonly MAIN_VITE_GOOGLE_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
