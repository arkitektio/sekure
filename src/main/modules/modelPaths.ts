import { join } from 'path'
import { pathToFileURL } from 'url'
import { app } from 'electron'

/** Where downloaded models live: `userData/models/<id>/<revision>`. */
export const modelsRoot = () => join(app.getPath('userData'), 'models')

/** ORT's WASM runtime, copied next to the main bundle and unpacked from the asar. */
export function ortWasmPaths(): string {
  const dir = join(__dirname, 'ort').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  return pathToFileURL(dir).href + '/'
}
