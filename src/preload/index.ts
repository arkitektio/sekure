import { contextBridge, ipcRenderer } from 'electron'
import type { RecentVault, VaultRef } from '../main/sources/protocol'
import {
  VAULT_EVENT_CHANNEL,
  type EntryInput,
  type OpenRequest,
  type PasswordOptions,
  type SaveResult,
  type TotpCode,
  type VaultEntryDetail,
  type VaultEvent,
  type VaultSnapshot,
  type VaultState
} from '../main/vault/protocol'
import {
  AUTOTYPE_OPENED_CHANNEL,
  type AutoTypeOpened,
  type AutoTypeSettings,
  type AutoTypeStatus,
  type FillResult
} from '../main/autotype/protocol'
import {
  PREFERENCES_CHANGED_CHANNEL,
  type Brand,
  type Preferences
} from '../main/preferences/protocol'
import { WINDOW_STATE_CHANNEL, type WindowState } from '../main/window/protocol'
import {
  SEARCH_STATUS_CHANNEL,
  type SearchHit,
  type SemanticStatus,
  type TypeSuggestion
} from '../main/search/protocol'
import {
  DEIDENTIFY_STATUS_CHANNEL,
  DEIDENTIFY_VIEW_CHANNEL,
  type DeidentifyAction,
  type DeidentifyDecision,
  type DeidentifyMode,
  type DeidentifyResult,
  type DeidentifySettings,
  type DeidentifyStatus,
  type DeidentifyView
} from '../main/deidentify/protocol'

// This preload runs sandboxed: it may import only `electron`. Anything else
// (including the channel constant above, which is inlined) must be bundled.

// Subscribe `cb` to an ipcRenderer channel and return the disposer. Every
// event listener exposed to the renderer must be removable, otherwise each
// React remount stacks another listener on the shared ipcRenderer.
const subscribe = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
  const listener = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

type Mutation<T = void> = Promise<{ result: T; snapshot: VaultSnapshot }>

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api = {
  windowControls: {
    platform: (): Promise<NodeJS.Platform> => invoke('window:platform'),
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    close: () => invoke('window:close'),
    setTheme: (resolved: string, source: string) => invoke('window:setTheme', resolved, source),
    /** Whether the sidebar is see-through (macOS vibrancy / Windows acrylic). */
    getGlass: (): Promise<boolean> => invoke('window:getGlass'),
    setGlass: (on: boolean): Promise<boolean> => invoke('window:setGlass', on),
    state: (): Promise<WindowState> => invoke('window:state'),
    onState: (cb: (s: WindowState) => void) => subscribe(WINDOW_STATE_CHANNEL, cb)
  },
  shell: {
    /** Open an http(s) URL in the default browser (main validates it). */
    openUrl: (url: string): Promise<void> => invoke('shell:openUrl', url)
  },
  sources: {
    describe: (id: string): Promise<VaultRef> => invoke('sources:describe', id),
    recent: (): Promise<RecentVault[]> => invoke('sources:recent'),
    forget: (id: string) => invoke('sources:forget', id),
    /** Native file dialog, opening in the Google Drive for desktop folder if present. */
    pickLocal: (): Promise<VaultRef | null> => invoke('sources:pickLocal')
  },
  vault: {
    state: (): Promise<VaultState> => invoke('vault:state'),
    open: (req: OpenRequest): Promise<VaultSnapshot> => invoke('vault:open', req),
    snapshot: (): Promise<VaultSnapshot> => invoke('vault:snapshot'),
    entry: (uuid: string): Promise<VaultEntryDetail> => invoke('vault:entry', uuid),
    reveal: (uuid: string, field: string): Promise<string> => invoke('vault:reveal', uuid, field),
    copy: (uuid: string, field: string): Promise<void> => invoke('vault:copy', uuid, field),
    otp: (uuid: string): Promise<TotpCode | null> => invoke('vault:otp', uuid),
    copyOtp: (uuid: string): Promise<void> => invoke('vault:copyOtp', uuid),
    createEntry: (groupUuid: string | undefined, input: EntryInput): Mutation<string> =>
      invoke('vault:createEntry', groupUuid, input),
    updateEntry: (uuid: string, input: EntryInput): Mutation =>
      invoke('vault:updateEntry', uuid, input),
    /** Link an entry to people (Person entry uuids), replacing its links. */
    setPeople: (uuid: string, people: string[]): Mutation =>
      invoke('vault:setPeople', uuid, people),
    deleteEntry: (uuid: string): Mutation => invoke('vault:deleteEntry', uuid),
    moveEntry: (uuid: string, groupUuid: string): Mutation =>
      invoke('vault:moveEntry', uuid, groupUuid),
    createGroup: (parent: string | undefined, name: string): Mutation<string> =>
      invoke('vault:createGroup', parent, name),
    renameGroup: (uuid: string, name: string): Mutation => invoke('vault:renameGroup', uuid, name),
    deleteGroup: (uuid: string): Mutation => invoke('vault:deleteGroup', uuid),
    pickAttachments: (uuid: string): Promise<string[]> => invoke('vault:pickAttachments', uuid),
    addAttachment: (uuid: string, name: string, bytes: Uint8Array): Mutation<string> =>
      invoke('vault:addAttachment', uuid, name, bytes),
    readAttachment: (uuid: string, name: string): Promise<{ bytes: Uint8Array; mime: string }> =>
      invoke('vault:readAttachment', uuid, name),
    exportAttachment: (uuid: string, name: string): Promise<boolean> =>
      invoke('vault:exportAttachment', uuid, name),
    renameAttachment: (uuid: string, from: string, to: string): Mutation<string> =>
      invoke('vault:renameAttachment', uuid, from, to),
    removeAttachment: (uuid: string, name: string): Mutation =>
      invoke('vault:removeAttachment', uuid, name),
    save: (): Promise<SaveResult> => invoke('vault:save'),
    lock: () => invoke('vault:lock'),
    generatePassword: (opts?: PasswordOptions): Promise<string> =>
      invoke('vault:generatePassword', opts),
    activity: () => invoke('vault:activity'),
    getSettings: (): Promise<{ autoLockMinutes: number; lockOnSleep: boolean }> =>
      invoke('vault:getSettings'),
    setSettings: (patch: Partial<{ autoLockMinutes: number; lockOnSleep: boolean }>) =>
      invoke('vault:setSettings', patch),
    onEvent: (cb: (e: VaultEvent) => void) => subscribe(VAULT_EVENT_CHANNEL, cb)
  },
  search: {
    /** Ranked hits for the open vault: text matches first, then semantic ones. */
    query: (query: string): Promise<SearchHit[]> => invoke('search:query', query),
    /** Entry types whose meaning matches `query` (empty without the local model). */
    suggestTypes: (query: string): Promise<TypeSuggestion[]> =>
      invoke('search:suggestTypes', query),
    status: (): Promise<SemanticStatus> => invoke('search:status'),
    /** Start the local embedding model that ships with the app. */
    enableSemantic: (): Promise<void> => invoke('search:enableSemantic'),
    disableSemantic: (): Promise<void> => invoke('search:disableSemantic'),
    onStatus: (cb: (s: SemanticStatus) => void) => subscribe(SEARCH_STATUS_CHANNEL, cb)
  },
  deidentify: {
    /** The latest view (the popup may load after the first one was sent). */
    current: (): Promise<DeidentifyView | undefined> => invoke('deidentify:current'),
    /** Text typed or pasted into the popup when no selection could be read. */
    submitText: (text: string): Promise<void> => invoke('deidentify:submitText', text),
    setMode: (mode: DeidentifyMode): Promise<void> => invoke('deidentify:setMode', mode),
    apply: (decision: DeidentifyDecision, action: DeidentifyAction): Promise<DeidentifyResult> =>
      invoke('deidentify:apply', decision, action),
    dismiss: () => invoke('deidentify:dismiss'),
    keepOpen: (keep: boolean) => invoke('deidentify:keepOpen', keep),
    suspend: (suspend: boolean) => invoke('deidentify:suspend', suspend),
    forget: () => invoke('deidentify:forget'),
    getSettings: (): Promise<DeidentifySettings> => invoke('deidentify:getSettings'),
    setSettings: (patch: Partial<DeidentifySettings>): Promise<DeidentifyStatus> =>
      invoke('deidentify:setSettings', patch),
    status: (): Promise<DeidentifyStatus> => invoke('deidentify:status'),
    enableModel: (): Promise<void> => invoke('deidentify:enableModel'),
    disableModel: (removeFiles: boolean): Promise<void> =>
      invoke('deidentify:disableModel', removeFiles),
    onView: (cb: (v: DeidentifyView) => void) => subscribe(DEIDENTIFY_VIEW_CHANNEL, cb),
    onStatus: (cb: (s: DeidentifyStatus) => void) => subscribe(DEIDENTIFY_STATUS_CHANNEL, cb)
  },
  biometric: {
    available: (): Promise<boolean> => invoke('biometric:available'),
    enabled: (fileId: string): Promise<boolean> => invoke('biometric:enabled', fileId),
    /** Uses the credentials of the `vault:open` that set `enableBiometric`. */
    enable: (fileId: string): Promise<void> => invoke('biometric:enable', fileId),
    disable: (fileId: string): Promise<void> => invoke('biometric:disable', fileId),
    unlock: (fileId: string): Promise<VaultSnapshot> => invoke('biometric:unlock', fileId)
  },
  autotype: {
    /** Paste one field (or `OTP_FIELD`) of an entry into the app that had focus. */
    fill: (uuid: string, field: string): Promise<FillResult> =>
      invoke('autotype:fill', uuid, field),
    dismiss: () => invoke('autotype:dismiss'),
    /** The latest `onOpened` payload. */
    current: (): Promise<AutoTypeOpened> => invoke('autotype:current'),
    /** Keep the popup open while a system prompt (Touch ID) takes focus. */
    keepOpen: (keep: boolean) => invoke('autotype:keepOpen', keep),
    /** Unregister the shortcut while the user records a new one. */
    suspend: (suspend: boolean) => invoke('autotype:suspend', suspend),
    getSettings: (): Promise<AutoTypeSettings> => invoke('autotype:getSettings'),
    setSettings: (patch: Partial<AutoTypeSettings>): Promise<AutoTypeStatus> =>
      invoke('autotype:setSettings', patch),
    status: (): Promise<AutoTypeStatus> => invoke('autotype:status'),
    requestPermission: (): Promise<AutoTypeStatus> => invoke('autotype:requestPermission'),
    onOpened: (cb: (e: AutoTypeOpened) => void) => subscribe(AUTOTYPE_OPENED_CHANNEL, cb)
  },
  preferences: {
    get: (): Promise<Preferences> => invoke('preferences:get'),
    /** `null` resets to the stylesheet's light/dark defaults. Also stored in the open vault. */
    setBrand: (brand: Brand | null): Promise<Preferences> => invoke('preferences:setBrand', brand),
    onChange: (cb: (p: Preferences) => void) => subscribe(PREFERENCES_CHANGED_CHANNEL, cb)
  },
  updater: {
    check: () => invoke('check-for-updates'),
    quitAndInstall: () => invoke('quit-and-install'),
    onDownloaded: (cb: (info: { version: string }) => void) => subscribe('updater:downloaded', cb)
  }
}

export type SekureApi = typeof api

contextBridge.exposeInMainWorld('api', api)
