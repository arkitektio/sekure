/* eslint-disable @typescript-eslint/no-explicit-any -- IPC payloads are typed at the preload boundary */
import { ipcMain, IpcMainInvokeEvent, IpcMainEvent } from 'electron'
import EventEmitter from 'events'
import log from 'electron-log'
import { isAppUrl } from '../lib/appOrigin'

type SenderEvent = Pick<IpcMainEvent, 'senderFrame' | 'sender'>

/**
 * Only the top frame of one of our own windows may talk to main. Every secret
 * crosses this boundary, so a future <webview>, subframe or stray window that
 * somehow gets a preload must not be able to call `vault:reveal`.
 */
export function isTrustedSender(event: SenderEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) return false
  return isAppUrl(frame.url)
}

export class IpcTransport extends EventEmitter {
  constructor() {
    super()
  }

  /**
   * Listen for IPC events from the renderer process.
   */
  onChannel(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) {
    ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        log.warn(`Ignored ${channel} from an untrusted frame`)
        return
      }
      listener(event, ...args)
    })
  }

  /**
   * Handle IPC invocations from the renderer process.
   */
  handleChannel(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any
  ) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        log.warn(`Rejected ${channel} from an untrusted frame`)
        throw new Error('Forbidden')
      }
      return listener(event, ...args)
    })
  }

  /**
   * Send a message to the provided WebContents (like a BrowserWindow).
   */
  sendTo(webContents: Electron.WebContents, channel: string, ...args: any[]) {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, ...args)
    }
  }
}
