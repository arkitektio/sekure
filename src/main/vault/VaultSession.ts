import * as kdbxweb from 'kdbxweb'
import { installArgon2 } from './argon2'
import { kindForMime, mimeForName } from './mime'
import { hostLabel, NOTES_LIMIT, type SearchDocument } from '../search/document'
import {
  detectType,
  formatMarker,
  getType,
  loginType,
  normalizeValue,
  parseMarker,
  subtitleFor,
  TYPE_MARKER_KEY,
  LOGIN_TYPE,
  type EntryType
} from './entryTypes'
import {
  MAX_ATTACHMENT_BYTES,
  STANDARD_FIELDS,
  type VaultAttachment,
  type EntryInput,
  type VaultCustomField,
  type VaultEntryDetail,
  type VaultEntrySummary,
  type VaultGroupNode,
  type VaultSnapshot
} from './protocol'

installArgon2()

const OTP_FIELDS = ['otp', 'TOTP Seed']

export class VaultError extends Error {
  constructor(
    public code: 'InvalidKey' | 'NotFound' | 'Corrupt' | 'Unknown',
    message: string
  ) {
    super(message)
  }
}

export function toBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function makeCredentials(password: string, keyFile?: Uint8Array): kdbxweb.KdbxCredentials {
  return new kdbxweb.Credentials(
    kdbxweb.ProtectedValue.fromString(password),
    keyFile ? toBuffer(keyFile) : null
  )
}

export async function loadKdbx(
  bytes: ArrayBuffer,
  credentials: kdbxweb.KdbxCredentials
): Promise<kdbxweb.Kdbx> {
  try {
    return await kdbxweb.Kdbx.load(bytes, credentials)
  } catch (e) {
    if (e instanceof kdbxweb.KdbxError) {
      if (e.code === kdbxweb.Consts.ErrorCodes.InvalidKey) {
        throw new VaultError('InvalidKey', 'Wrong password or key file')
      }
      throw new VaultError('Corrupt', e.message)
    }
    throw e
  }
}

const fieldText = (v: kdbxweb.KdbxEntryField | undefined): string => {
  if (v === undefined) return ''
  return v instanceof kdbxweb.ProtectedValue ? v.getText() : v
}

/** Unwrap whatever shape kdbxweb holds a binary in to raw bytes. */
const binaryBytes = (b: kdbxweb.KdbxBinary | kdbxweb.KdbxBinaryWithHash): Uint8Array => {
  const value = kdbxweb.KdbxBinaries.isKdbxBinaryWithHash(b) ? b.value : b
  return value instanceof kdbxweb.ProtectedValue ? value.getBinary() : new Uint8Array(value)
}

const iso = (d: Date | undefined) => (d ? d.toISOString() : undefined)

/**
 * One open database. Pure kdbxweb — no electron — so it can be tested in node.
 * Nothing it returns to callers contains a password or protected field unless
 * the caller asks for that specific value with `reveal`.
 */
export class VaultSession {
  dirty = false
  /** Meta/CustomData keys changed since the last save (see `merge`). */
  private editedCustomData = new Set<string>()

  constructor(
    public db: kdbxweb.Kdbx,
    public credentials: kdbxweb.KdbxCredentials,
    public fileId: string,
    public fileName: string
  ) {}

  static async open(
    bytes: ArrayBuffer,
    credentials: kdbxweb.KdbxCredentials,
    fileId: string,
    fileName: string
  ): Promise<VaultSession> {
    const db = await loadKdbx(bytes, credentials)
    return new VaultSession(db, credentials, fileId, fileName)
  }

  // ---------------------------------------------------------------- reading

  snapshot(): VaultSnapshot {
    const root = this.db.getDefaultGroup()
    const entries: VaultEntrySummary[] = []
    for (const entry of root.allEntries()) entries.push(this.summarize(entry))
    return {
      fileId: this.fileId,
      fileName: this.fileName,
      dbName: this.db.meta.name || this.fileName,
      root: this.groupNode(root),
      entries,
      dirty: this.dirty
    }
  }

  entryDetail(uuid: string): VaultEntryDetail {
    const entry = this.getEntry(uuid)
    const customFields: VaultCustomField[] = []
    for (const [key, value] of entry.fields) {
      if ((STANDARD_FIELDS as readonly string[]).includes(key)) continue
      const isProtected = value instanceof kdbxweb.ProtectedValue
      customFields.push({ key, protected: isProtected, value: isProtected ? null : value })
    }
    const attachments: VaultAttachment[] = []
    for (const [name, b] of entry.binaries) {
      const mime = mimeForName(name)
      attachments.push({ name, size: binaryBytes(b).byteLength, mime, kind: kindForMime(mime) })
    }
    return {
      ...this.summarize(entry),
      notes: fieldText(entry.fields.get('Notes')),
      attachments,
      created: iso(entry.times.creationTime),
      expires: entry.times.expires ? iso(entry.times.expiryTime) : undefined,
      customFields,
      historyCount: entry.history.length,
      typeDetected: this.resolveType(entry).detected
    }
  }

  /**
   * What search indexes: titles, types, groups, tags, hosts, usernames, the names
   * of custom fields and the start of the notes. Protected values are never read.
   */
  searchDocuments(): SearchDocument[] {
    const plain = (entry: kdbxweb.KdbxEntry, key: string) => {
      const v = entry.fields.get(key)
      return typeof v === 'string' ? v : ''
    }
    const docs: SearchDocument[] = []
    for (const entry of this.db.getDefaultGroup().allEntries()) {
      const summary = this.summarize(entry)
      const type = getType(summary.type)
      const groups: string[] = []
      for (let g = entry.parentGroup; g?.parentGroup; g = g.parentGroup)
        groups.unshift(g.name ?? '')
      docs.push({
        uuid: summary.uuid,
        title: plain(entry, 'Title'),
        type: type && type.id !== LOGIN_TYPE ? type.label : '',
        tags: entry.tags,
        group: groups.filter(Boolean).join(' / '),
        host: hostLabel(plain(entry, 'URL')),
        url: plain(entry, 'URL'),
        username: plain(entry, 'UserName'),
        subtitle: summary.subtitle,
        fieldNames: [...entry.fields.keys()].filter(
          (k) => !(STANDARD_FIELDS as readonly string[]).includes(k) && !OTP_FIELDS.includes(k)
        ),
        notes: plain(entry, 'Notes').slice(0, NOTES_LIMIT),
        inRecycleBin: summary.inRecycleBin
      })
    }
    return docs
  }

  reveal(uuid: string, field: string): string {
    const entry = this.getEntry(uuid)
    if (!entry.fields.has(field)) throw new VaultError('NotFound', `No field ${field}`)
    return fieldText(entry.fields.get(field))
  }

  readAttachment(uuid: string, name: string): { bytes: Uint8Array; mime: string } {
    const b = this.getEntry(uuid).binaries.get(name)
    if (!b) throw new VaultError('NotFound', `No attachment ${name}`)
    return { bytes: binaryBytes(b), mime: mimeForName(name) }
  }

  otpSource(uuid: string): string | undefined {
    const entry = this.getEntry(uuid)
    for (const key of OTP_FIELDS) {
      const v = fieldText(entry.fields.get(key))
      if (v) return v
    }
    return undefined
  }

  // ---------------------------------------------------------------- editing

  createEntry(groupUuid: string | undefined, input: EntryInput): string {
    const group = groupUuid ? this.getGroup(groupUuid) : this.db.getDefaultGroup()
    const entry = this.db.createEntry(group)
    this.applyInput(entry, input, true)
    this.touch()
    return entry.uuid.id
  }

  updateEntry(uuid: string, input: EntryInput): void {
    const entry = this.getEntry(uuid)
    // KeePass keeps the previous version in the entry history; KeePassXC and
    // Strongbox both show it, and merge relies on it.
    entry.pushHistory()
    this.applyInput(entry, input)
    entry.times.update()
    this.touch()
  }

  deleteEntry(uuid: string): void {
    // `remove` moves to the recycle bin when it is enabled, else deletes and
    // records a DeletedObject so merge does not resurrect it.
    this.db.remove(this.getEntry(uuid))
    this.touch()
  }

  /**
   * Attach a file to an entry. Names are unique per entry, so a clash gets a
   * ` (2)` suffix rather than silently replacing the existing attachment.
   * Returns the name actually used.
   */
  async addAttachment(uuid: string, name: string, bytes: Uint8Array): Promise<string> {
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new VaultError(
        'Unknown',
        `${name} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`
      )
    }
    const entry = this.getEntry(uuid)
    const finalName = uniqueName(name, new Set(entry.binaries.keys()))
    const binary = await this.db.createBinary(kdbxweb.ProtectedValue.fromBinary(toBuffer(bytes)))
    entry.pushHistory()
    entry.binaries.set(finalName, binary)
    entry.times.update()
    this.touch()
    return finalName
  }

  removeAttachment(uuid: string, name: string): void {
    const entry = this.getEntry(uuid)
    if (!entry.binaries.has(name)) throw new VaultError('NotFound', `No attachment ${name}`)
    entry.pushHistory()
    entry.binaries.delete(name)
    entry.times.update()
    this.touch()
  }

  renameAttachment(uuid: string, from: string, to: string): string {
    const entry = this.getEntry(uuid)
    const b = entry.binaries.get(from)
    if (!b) throw new VaultError('NotFound', `No attachment ${from}`)
    if (from === to) return to
    const others = new Set(entry.binaries.keys())
    others.delete(from)
    const finalName = uniqueName(to, others)
    entry.pushHistory()
    entry.binaries.delete(from)
    entry.binaries.set(finalName, b)
    entry.times.update()
    this.touch()
    return finalName
  }

  moveEntry(uuid: string, groupUuid: string): void {
    this.db.move(this.getEntry(uuid), this.getGroup(groupUuid))
    this.touch()
  }

  createGroup(parentUuid: string | undefined, name: string): string {
    const parent = parentUuid ? this.getGroup(parentUuid) : this.db.getDefaultGroup()
    const group = this.db.createGroup(parent, name)
    this.touch()
    return group.uuid.id
  }

  renameGroup(uuid: string, name: string): void {
    const group = this.getGroup(uuid)
    group.name = name
    group.times.update()
    this.touch()
  }

  deleteGroup(uuid: string): void {
    const group = this.getGroup(uuid)
    if (group === this.db.getDefaultGroup()) {
      throw new VaultError('Unknown', 'The root group cannot be deleted')
    }
    this.db.remove(group)
    this.touch()
  }

  // ---------------------------------------------------------------- database custom data

  /** A value from the database's Meta/CustomData (app settings that travel with the file). */
  getCustomData(key: string): string | undefined {
    return this.db.meta.customData.get(key)?.value
  }

  /** Marks the vault dirty. */
  setCustomData(key: string, value: string): void {
    if (this.getCustomData(key) === value) return
    this.db.meta.customData.set(key, { value, lastModified: new Date() })
    this.editedCustomData.add(key)
    this.touch()
  }

  // ---------------------------------------------------------------- persisting

  async save(): Promise<ArrayBuffer> {
    return this.db.save()
  }

  /** Pull `remote` (the newer copy on Drive) into this database. */
  merge(remote: kdbxweb.Kdbx): void {
    // KDBX < 4.1 stores no timestamps for Meta/CustomData, so kdbxweb would
    // always keep ours. Take the remote value unless we changed it since the last save.
    for (const [key, item] of remote.meta.customData) {
      if (!this.editedCustomData.has(key)) this.db.meta.customData.set(key, item)
    }
    const remoteEntries = new Map<string, kdbxweb.KdbxEntry>()
    for (const e of remote.getDefaultGroup().allEntries()) remoteEntries.set(e.uuid.id, e)
    this.db.merge(remote)
    // kdbxweb's merge copies an entry's fields but not its CustomData, so an entry
    // where the remote copy won would lose its type marker. Carry it over.
    for (const entry of this.db.getDefaultGroup().allEntries()) {
      const r = remoteEntries.get(entry.uuid.id)
      const remoteTime = r?.times.lastModTime?.getTime()
      if (r?.customData && remoteTime !== undefined) {
        if (entry.times.lastModTime?.getTime() === remoteTime) {
          entry.customData = new Map(r.customData)
        }
      }
    }
    this.dirty = true
  }

  markSaved(): void {
    this.dirty = false
    this.editedCustomData.clear()
    this.db.removeLocalEditState()
  }

  // ---------------------------------------------------------------- internals

  private touch() {
    this.dirty = true
  }

  private applyInput(entry: kdbxweb.KdbxEntry, input: EntryInput, isNew = false) {
    const previous = this.resolveType(entry)
    let type = previous.type
    if (input.type !== undefined) {
      const requested = getType(input.type)
      if (!requested) throw new VaultError('Unknown', `Unknown entry type ${input.type}`)
      type = requested
    }
    entry.fields.set('Title', input.title)
    entry.fields.set('UserName', input.username)
    if (input.password !== undefined) {
      entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(input.password))
    }
    entry.fields.set('URL', input.url)
    entry.fields.set('Notes', input.notes)
    entry.tags = input.tags

    if (input.customFields) {
      const keep = new Set(input.customFields.map((f) => f.key))
      for (const key of [...entry.fields.keys()]) {
        if (!(STANDARD_FIELDS as readonly string[]).includes(key) && !keep.has(key)) {
          entry.fields.delete(key)
        }
      }
      for (const f of input.customFields) {
        if (f.value === undefined) continue
        entry.fields.set(f.key, f.protected ? kdbxweb.ProtectedValue.fromString(f.value) : f.value)
      }
    }

    this.applyType(entry, type, isNew || type !== previous.type)
  }

  /**
   * Record the type marker and bring the type's fields into canonical shape. Fields the
   * registry declares protected are always stored protected, whatever the renderer sent.
   */
  private applyType(entry: kdbxweb.KdbxEntry, type: EntryType, changed: boolean) {
    if (type.id === LOGIN_TYPE) {
      if (changed && entry.icon !== undefined && entry.icon !== 0) entry.icon = 0
      // A plain login needs no marker, unless its fields would be recognised as a type.
      if (!detectType(entry.fields.keys())) {
        entry.customData?.delete(TYPE_MARKER_KEY)
        return
      }
    }
    entry.customData ??= new Map()
    const marker = formatMarker(type)
    if (entry.customData.get(TYPE_MARKER_KEY)?.value !== marker) {
      entry.customData.set(TYPE_MARKER_KEY, { value: marker, lastModified: new Date() })
    }
    if (type.id === LOGIN_TYPE) return
    if (changed) entry.icon = type.kdbxIcon

    for (const f of type.fields) {
      const current = entry.fields.get(f.key)
      if (current === undefined) continue
      const isProtected = f.protected || current instanceof kdbxweb.ProtectedValue
      const text = normalizeValue(f.kind, fieldText(current))
      if (!isProtected && current === text) continue
      entry.fields.set(f.key, isProtected ? kdbxweb.ProtectedValue.fromString(text) : text)
    }
  }

  /** The entry's type: from its marker, else recognised from its fields, else a login. */
  private resolveType(entry: kdbxweb.KdbxEntry): { type: EntryType; detected: boolean } {
    const marker = parseMarker(entry.customData?.get(TYPE_MARKER_KEY)?.value)
    const marked = getType(marker?.id)
    if (marked) return { type: marked, detected: false }
    const detected = detectType(entry.fields.keys())
    if (detected) return { type: detected, detected: true }
    return { type: loginType(), detected: false }
  }

  private summarize(entry: kdbxweb.KdbxEntry): VaultEntrySummary {
    const { type } = this.resolveType(entry)
    // Only plain string fields feed the subtitle: a protected value never reaches a snapshot.
    const plain = (key: string) => {
      const v = entry.fields.get(key)
      return typeof v === 'string' ? v : ''
    }
    return {
      uuid: entry.uuid.id,
      groupUuid: entry.parentGroup?.uuid.id ?? '',
      title: fieldText(entry.fields.get('Title')),
      username: fieldText(entry.fields.get('UserName')),
      url: fieldText(entry.fields.get('URL')),
      tags: entry.tags,
      icon: entry.icon,
      type: type.id,
      subtitle: subtitleFor(type, plain),
      hasPassword: fieldText(entry.fields.get('Password')).length > 0,
      hasOtp: OTP_FIELDS.some((k) => entry.fields.has(k)),
      attachmentCount: entry.binaries.size,
      inRecycleBin: this.isInRecycleBin(entry.parentGroup),
      modified: iso(entry.times.lastModTime)
    }
  }

  private groupNode(group: kdbxweb.KdbxGroup): VaultGroupNode {
    return {
      uuid: group.uuid.id,
      name: group.name ?? '',
      icon: group.icon,
      isRecycleBin: this.isRecycleBin(group),
      groups: group.groups.map((g) => this.groupNode(g)),
      entryCount: group.entries.length
    }
  }

  private isRecycleBin(group: kdbxweb.KdbxGroup): boolean {
    const bin = this.db.meta.recycleBinUuid
    return !!bin && group.uuid.equals(bin)
  }

  private isInRecycleBin(group: kdbxweb.KdbxGroup | undefined): boolean {
    for (let g = group; g; g = g.parentGroup) {
      if (this.isRecycleBin(g)) return true
    }
    return false
  }

  private getEntry(uuid: string): kdbxweb.KdbxEntry {
    for (const entry of this.db.getDefaultGroup().allEntries()) {
      if (entry.uuid.id === uuid) return entry
    }
    throw new VaultError('NotFound', `Entry ${uuid} not found`)
  }

  private getGroup(uuid: string): kdbxweb.KdbxGroup {
    const group = this.db.getGroup(uuid)
    if (!group) throw new VaultError('NotFound', `Group ${uuid} not found`)
    return group
  }
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!taken.has(candidate)) return candidate
  }
}
