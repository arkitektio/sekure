import type { SekureApi } from './index'

declare global {
  interface Window {
    api: SekureApi
  }
}
