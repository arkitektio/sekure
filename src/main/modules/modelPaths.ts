import { join } from 'path'
import { pathToFileURL } from 'url'
import { app } from 'electron'
import type { ModelSpec } from '../models/spec'

/** Where downloaded models live: `userData/models/<id>/<revision>`. */
export const modelsRoot = () => join(app.getPath('userData'), 'models')

/** Files next to the main bundle that electron-builder unpacks from the asar. */
const unpacked = (dir: string) => dir.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

/** ORT's WASM runtime, copied next to the main bundle and unpacked from the asar. */
export function ortWasmPaths(): string {
  return pathToFileURL(unpacked(join(__dirname, 'ort'))).href + '/'
}

/** A model shipped with the app (`out/main/models/<id>/<revision>`), inside the signed bundle. */
export const bundledModelDir = (spec: ModelSpec) =>
  unpacked(join(__dirname, 'models', spec.id, spec.revision))
