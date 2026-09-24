import { is } from '@electron-toolkit/utils'
import { APP_ORIGIN } from '../scheme'
import { hasOrigin } from './urls'

/** Origins our own renderer is served from: the app bundle, or the dev server. */
export function isAppUrl(url: string): boolean {
  const dev = is.dev && process.env['ELECTRON_RENDERER_URL']
  return hasOrigin(url, APP_ORIGIN) || (!!dev && hasOrigin(url, dev))
}
