import * as kdbxweb from 'kdbxweb'
import { installArgon2 } from './argon2'
import { kindForMime, mimeForName } from './mime'
import { hostLabel, NOTES_LIMIT, type SearchDocument } from '../search/document'
import { findSecretSpans, type KnownSecret, type SecretHit } from '../deidentify/secretMatch'
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
  MAX_PEOPLE,
  PEOPLE_KEY,
  PERSON_TYPE,
  type EntryType
} from './entryTypes'
import {
  MAX_ATTACHMENT_BYTES,
  STANDARD_FIELDS,
  type StandardField,
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

/**
 * Ceilings for the key-derivation parameters of a file we did not write. The
 * KDF runs before the header HMAC is checked, on the main thread, so without
 * them a crafted header (M = 4 GiB, I = 2^32) freezes the app for any
 * password — including during the merge in `save()`, with the vault open.
 * KeePassXC's own maximums are well below these.
 */
export const KDF_LIMITS = {
  argon2MemoryBytes: 1024 * 1024 * 1024,
  argon2Iterations: 100,
  argon2Parallelism: 64,
  aesRounds: 100_000_000
}

const kdfNumber = (v: unknown): number =>
  typeof v === 'number' ? v : v instanceof kdbxweb.Int64 ? v.value : NaN

/** Throws `VaultError('Corrupt')` if the header asks for a KDF beyond `KDF_LIMITS`. */
export function checkKdfParameters(bytes: ArrayBuffer): void {
  let header: kdbxweb.KdbxHeader
  try {
    const ctx = new kdbxweb.KdbxContext({
      kdbx: kdbxweb.Kdbx.create(new kdbxweb.Credentials(null), '')
    })
    header = kdbxweb.KdbxHeader.read(new kdbxweb.BinaryStream(bytes), ctx)
  } catch {
    return // not a readable header: let Kdbx.load report it
  }
  const tooExpensive = () => new VaultError('Corrupt', 'Unsupported key derivation parameters')
  const params = header.kdfParameters
  if (!params) {
    // KDBX 3: AES-KDF with rounds in the header.
    const rounds = header.keyEncryptionRounds ?? 0
    if (!(rounds <= KDF_LIMITS.aesRounds)) throw tooExpensive()
    return
  }
  const uuid = params.get('$UUID')
  const id = uuid instanceof ArrayBuffer ? kdbxweb.ByteUtils.bytesToBase64(uuid) : ''
  if (id === kdbxweb.Consts.KdfId.Aes) {
    if (!(kdfNumber(params.get('R')) <= KDF_LIMITS.aesRounds)) throw tooExpensive()
  } else if (id === kdbxweb.Consts.KdfId.Argon2d || id === kdbxweb.Consts.KdfId.Argon2id) {
    if (
      !(kdfNumber(params.get('M')) <= KDF_LIMITS.argon2MemoryBytes) ||
      !(kdfNumber(params.get('I')) <= KDF_LIMITS.argon2Iterations) ||
      !(kdfNumber(params.get('P')) <= KDF_LIMITS.argon2Parallelism)
    ) {
      throw tooExpensive()
    }
  }
}

export async function loadKdbx(
  bytes: ArrayBuffer,
  credentials: kdbxweb.KdbxCredentials
): Promise<kdbxweb.Kdbx> {
  checkKdfParameters(bytes)
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

/** Plaintext of an unprotected field; '' for a protected one (reveal on demand). */
const plainText = (v: kdbxweb.KdbxEntryField | undefined): string =>
  typeof v === 'string' ? v : ''

/** Length without decrypting: a snapshot must not leave plaintext garbage in the heap. */
const fieldLength = (v: kdbxweb.KdbxEntryField | undefined): number =>
  v === undefined ? 0 : v instanceof kdbxweb.ProtectedValue ? v.byteLength : v.length

const binarySize = (b: kdbxweb.KdbxBinary | kdbxweb.KdbxBinaryWithHash): number => {
  const value = kdbxweb.KdbxBinaries.isKdbxBinaryWithHash(b) ? b.value : b
  return value.byteLength
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
  /** Bumped on every change; `markSaved` only clears `dirty` if nothing changed since. */
  revision = 0
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
    const people = this.personIds()
    for (const entry of root.allEntries()) entries.push(this.summarize(entry, people))
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
      attachments.push({ name, size: binarySize(b), mime, kind: kindForMime(mime) })
    }
    return {
      ...this.summarize(entry),
      notes: plainText(entry.fields.get('Notes')),
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
  /**
   * Where the vault's secrets occur in `text`: passwords, every protected field,
   * OTP seeds and the fields entry types declare protected. The deidentifier's
   * hard check. Returns entry titles and field names, never values.
   */
  findSecrets(text: string): SecretHit[] {
    const secrets: KnownSecret[] = []
    for (const entry of this.db.getDefaultGroup().allEntries()) {
      const title = fieldText(entry.fields.get('Title')) || '(untitled)'
      const type = this.resolveType(entry).type
      for (const [key, raw] of entry.fields) {
        const declared = type.fields.find((f) => f.key === key)?.protected
        const isOtp = OTP_FIELDS.includes(key)
        if (!(raw instanceof kdbxweb.ProtectedValue) && key !== 'Password' && !declared && !isOtp) {
          continue
        }
        const value = fieldText(raw)
        if (!value) continue
        const field = isOtp ? 'one-time code seed' : key
        secrets.push({ value, entry: title, field, ignoreCase: isOtp })
        // An otpauth:// URI carries the actual seed in `secret=`.
        const seed = /[?&]secret=([A-Z2-7=]+)/i.exec(value)?.[1]
        if (seed) secrets.push({ value: seed, entry: title, field, ignoreCase: true })
      }
    }
    return findSecretSpans(text, secrets)
  }

  searchDocuments(): SearchDocument[] {
    const plain = (entry: kdbxweb.KdbxEntry, key: string) => {
      const v = entry.fields.get(key)
      return typeof v === 'string' ? v : ''
    }
    const docs: SearchDocument[] = []
    const all = this.db.getDefaultGroup().allEntries()
    const persons = this.personIds()
    const names = new Map<string, string>()
    for (const e of all) if (persons.has(e.uuid.id)) names.set(e.uuid.id, this.personName(e))
    for (const entry of this.db.getDefaultGroup().allEntries()) {
      const summary = this.summarize(entry, persons)
      const type = getType(summary.type)
      const groups: string[] = []
      for (let g = entry.parentGroup; g?.parentGroup; g = g.parentGroup)
        groups.unshift(g.name ?? '')
      docs.push({
        uuid: summary.uuid,
        title: plain(entry, 'Title'),
        type: type && type.id !== LOGIN_TYPE ? type.label : '',
        typeKeywords: type && type.id !== LOGIN_TYPE ? (type.keywords ?? []) : [],
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
        people: summary.people.map((id) => names.get(id) ?? '').filter(Boolean),
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

  /** Link an entry to people (Person entry uuids), replacing its current links. */
  setPeople(uuid: string, people: string[]): void {
    const entry = this.getEntry(uuid)
    const next = this.validPeople(entry, people)
    if (next.join(',') === this.readPeople(entry).join(',')) return
    entry.pushHistory()
    this.writePeople(entry, next)
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
    this.touch()
  }

  /**
   * The bytes written were produced at `savedRevision`. Edits made while the
   * write was in flight are not in them, so the vault stays dirty.
   */
  markSaved(savedRevision = this.revision): void {
    if (savedRevision !== this.revision) return
    this.dirty = false
    this.editedCustomData.clear()
    this.db.removeLocalEditState()
  }

  // ---------------------------------------------------------------- internals

  private touch() {
    this.dirty = true
    this.revision++
  }

  private applyInput(entry: kdbxweb.KdbxEntry, input: EntryInput, isNew = false) {
    const previous = this.resolveType(entry)
    let type = previous.type
    if (input.type !== undefined) {
      const requested = getType(input.type)
      if (!requested) throw new VaultError('Unknown', `Unknown entry type ${input.type}`)
      type = requested
    }
    // A standard field the user (or KeePass memory protection) made protected
    // stays protected; `undefined` keeps its current value, like Password.
    const memory = this.db.meta.memoryProtection
    const setStandard = (
      key: StandardField,
      value: string | undefined,
      protectByDefault = false
    ) => {
      if (value === undefined) return
      const wasProtected = entry.fields.get(key) instanceof kdbxweb.ProtectedValue
      entry.fields.set(
        key,
        wasProtected || protectByDefault ? kdbxweb.ProtectedValue.fromString(value) : value
      )
    }
    setStandard('Title', input.title, memory.title)
    setStandard('UserName', input.username, memory.userName)
    setStandard('Password', input.password, true)
    setStandard('URL', input.url, memory.url)
    setStandard('Notes', input.notes, memory.notes)
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
    if (input.people !== undefined) this.writePeople(entry, this.validPeople(entry, input.people))
  }

  // ---------------------------------------------------------------- people

  /** Uuids of Person entries (in or out of the bin). */
  private personIds(): Set<string> {
    const ids = new Set<string>()
    for (const e of this.db.getDefaultGroup().allEntries()) {
      if (this.resolveType(e).type.id === PERSON_TYPE) ids.add(e.uuid.id)
    }
    return ids
  }

  /** The requested links that point at real Person entries, deduplicated, never the entry itself. */
  private validPeople(entry: kdbxweb.KdbxEntry, people: unknown): string[] {
    if (!Array.isArray(people) || people.length > MAX_PEOPLE)
      throw new VaultError('Unknown', 'Invalid people list')
    const persons = this.personIds()
    const out: string[] = []
    for (const id of people) {
      if (typeof id !== 'string' || id === entry.uuid.id || !persons.has(id)) continue
      if (!out.includes(id)) out.push(id)
    }
    return out
  }

  /** Linked people as stored, keeping only ids that are still Person entries. */
  private readPeople(entry: kdbxweb.KdbxEntry, persons = this.personIds()): string[] {
    const raw = entry.customData?.get(PEOPLE_KEY)?.value
    if (!raw) return []
    return [...new Set(raw.split(','))]
      .filter((id) => id !== entry.uuid.id && persons.has(id))
      .slice(0, MAX_PEOPLE)
  }

  private writePeople(entry: kdbxweb.KdbxEntry, people: string[]) {
    if (!people.length) {
      entry.customData?.delete(PEOPLE_KEY)
      return
    }
    entry.customData ??= new Map()
    entry.customData.set(PEOPLE_KEY, { value: people.join(','), lastModified: new Date() })
  }

  /** A person's display name: the entry title, else the name fields (plain text only). */
  private personName(entry: kdbxweb.KdbxEntry): string {
    const plain = (key: string) => {
      const v = entry.fields.get(key)
      return typeof v === 'string' ? v : ''
    }
    return plain('Title') || [plain('Given names'), plain('Surname')].filter(Boolean).join(' ')
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

  private summarize(entry: kdbxweb.KdbxEntry, persons?: Set<string>): VaultEntrySummary {
    const { type } = this.resolveType(entry)
    // Only plain string fields feed the subtitle: a protected value never reaches a snapshot.
    const plain = (key: string) => {
      const v = entry.fields.get(key)
      return typeof v === 'string' ? v : ''
    }
    return {
      uuid: entry.uuid.id,
      groupUuid: entry.parentGroup?.uuid.id ?? '',
      title: plainText(entry.fields.get('Title')),
      username: plainText(entry.fields.get('UserName')),
      url: plainText(entry.fields.get('URL')),
      protectedFields: STANDARD_FIELDS.filter(
        (k) => k !== 'Password' && entry.fields.get(k) instanceof kdbxweb.ProtectedValue
      ),
      tags: entry.tags,
      icon: entry.icon,
      type: type.id,
      subtitle: subtitleFor(type, plain),
      hasPassword: fieldLength(entry.fields.get('Password')) > 0,
      hasOtp: OTP_FIELDS.some((k) => entry.fields.has(k)),
      attachmentCount: entry.binaries.size,
      inRecycleBin: this.isInRecycleBin(entry.parentGroup),
      modified: iso(entry.times.lastModTime),
      people: this.readPeople(entry, persons)
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
