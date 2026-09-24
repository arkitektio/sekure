// Shared between main, preload and renderer. No imports: the sandboxed preload
// gets the constants below inlined by the bundler.

export type SpanKind =
  | 'PERSON'
  | 'ORG'
  | 'ADDRESS'
  | 'EMAIL'
  | 'PHONE'
  | 'DATE'
  | 'ID'
  | 'IBAN'
  | 'CARD'
  | 'ACCOUNT'
  | 'IP'
  | 'URL'
  | 'USERNAME'
  | 'SECRET'
  | 'CREDENTIAL'
  | 'HEALTH'
  | 'OTHER'

export type SpanSource = 'vault' | 'rule' | 'model' | 'manual'

/** A piece of the reviewed text: plain, or a detected span the user can toggle. */
export type ReviewSegment =
  | { type: 'text'; text: string }
  | {
      type: 'span'
      id: string
      kind: SpanKind
      /** What was detected (`email`, `Gmail / Password`, …). */
      label: string
      /** The original text. Absent for vault credentials: they never reach a renderer. */
      text?: string
      /** Vault credentials are always replaced. */
      locked: boolean
      enabled: boolean
      source: SpanSource
    }

export type DeidentifyMode = 'deidentify' | 'reidentify'

export type ModelState = 'off' | 'downloading' | 'loading' | 'running' | 'ready' | 'error'

export interface DeidentifyView {
  sessionId: number
  mode: DeidentifyMode
  /** The app the text came from. */
  targetName?: string
  /** No selection could be read: the popup asks for text instead. */
  empty: boolean
  /** The vault is locked: unlock first, so the credential check can run. */
  needsUnlock: boolean
  segments: ReviewSegment[]
  /** Placeholders in the text that the mapping can restore (re-identify mode). */
  restorable: number
  model: { state: ModelState; progress?: number; message?: string }
}

export interface DeidentifyDecision {
  /** Ids of (unlocked) spans to replace. Locked spans are always replaced. */
  enabled: string[]
  /** Extra spans the user marked, as offsets into a plain-text segment. */
  manual: { segment: number; start: number; end: number }[]
}

export type DeidentifyAction = 'paste' | 'copy'

export interface DeidentifyResult {
  pasted: boolean
  replaced: number
}

export interface DeidentifySettings {
  enabled: boolean
  shortcut: string
  /** Use the local PII model for names, addresses and IDs (downloaded once). */
  model: boolean
}

/** Same three-modifier pattern as auto-type (⌘⌥⇧K). */
export const DEFAULT_DEIDENTIFY_SHORTCUT = 'CommandOrControl+Alt+Shift+D'

export const DEFAULT_DEIDENTIFY_SETTINGS: DeidentifySettings = {
  enabled: true,
  shortcut: DEFAULT_DEIDENTIFY_SHORTCUT,
  model: false
}

export interface DeidentifyStatus {
  registered: boolean
  model: DeidentifyView['model']
  modelBytes: number
  /** Live placeholder mappings (for “Forget”). */
  mappings: number
}

export const DEIDENTIFY_VIEW_CHANNEL = 'deidentify:view'
export const DEIDENTIFY_STATUS_CHANNEL = 'deidentify:status'

/**
 * GLiNER multi-PII (Apache-2.0), fp16: the int8 export collapses the logits and
 * finds nothing, fp16 matches fp32.
 */
export const GLINER_MODEL = {
  id: 'gliner-multi-pii-v1',
  repo: 'onnx-community/gliner_multi_pii-v1',
  revision: '2e0397a7e8a250d76c37122232b3cbde42c8d629',
  files: [
    {
      path: 'gliner_config.json',
      size: 732,
      sha256: '69e141f7fe1864e0d81ab0e542c68387d588db62393bcd93b471d54dcf0f5c16'
    },
    {
      path: 'tokenizer_config.json',
      size: 1806,
      sha256: '78f866883daf7ee2bc400200a155cdbe9116ed0a6ed597ff573ea2c9862a89a6'
    },
    {
      path: 'tokenizer.json',
      size: 16331948,
      sha256: '914bd3c8fb7b525af9e23b60d0ec7b1248ddb2b99014efd9c02ebeb022f8cab7'
    },
    {
      path: 'onnx/model_fp16.onnx',
      size: 579717643,
      sha256: 'e756837e13d16ef832f6cd9fca473c2c3dd1eb232cab13e6443d958d608e797b'
    }
  ]
} as const
