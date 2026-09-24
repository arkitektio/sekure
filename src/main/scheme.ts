// Custom privileged scheme used to serve the packaged renderer (instead of
// file://), so the document has a real, secure origin. Same as orkestrator.
// No imports: electron.vite.config.ts reads the CSP from here at build time.
export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://bundle`

/**
 * The renderer's Content-Security-Policy. Nothing leaves the renderer: all
 * network traffic happens in main (the account avatar arrives as a data: URL).
 * blob: is for previewing decrypted image/PDF attachments. Injected into
 * index.html at build time and also sent as a header by the app:// handler.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  'frame-src blob:',
  'object-src blob:',
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** The dev server's HMR socket; added only by `electron-vite dev`. */
export const DEV_CONNECT_SRC = 'ws://localhost:*'
