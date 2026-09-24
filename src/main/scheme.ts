// Custom privileged scheme used to serve the packaged renderer (instead of
// file://), so the document has a real, secure origin. Same as orkestrator.
export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://bundle`
