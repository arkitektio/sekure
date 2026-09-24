import * as kdbxweb from 'kdbxweb'
import { describe, expect, it } from 'vitest'
import { installArgon2 } from './argon2'
import { makeCredentials, VaultError, VaultSession } from './VaultSession'
import { generatePassword } from './generator'
import { base32Decode, parseOtp, totp } from './totp'

installArgon2()

/** A KDBX4 / Argon2id file, like KeePassXC writes by default (cheap params). */
async function makeFile(password = 'hunter2'): Promise<ArrayBuffer> {
  const db = kdbxweb.Kdbx.create(makeCredentials(password), 'Test DB')
  db.setVersion(4)
  db.setKdf(kdbxweb.Consts.KdfId.Argon2id)
  db.header.kdfParameters!.set(
    'M',
    kdbxweb.VarDictionary.ValueType.UInt64,
    kdbxweb.Int64.from(1024 * 1024)
  )
  db.header.kdfParameters!.set('I', kdbxweb.VarDictionary.ValueType.UInt64, kdbxweb.Int64.from(2))

  const root = db.getDefaultGroup()
  const email = db.createGroup(root, 'Email')
  const entry = db.createEntry(email)
  entry.fields.set('Title', 'Gmail')
  entry.fields.set('UserName', 'me@example.com')
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString('s3cret'))
  entry.fields.set('URL', 'https://mail.google.com')
  entry.fields.set('otp', 'otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&period=30')
  entry.fields.set('Recovery', kdbxweb.ProtectedValue.fromString('abc-def'))
  return db.save()
}

const open = async (bytes: ArrayBuffer, pw = 'hunter2') =>
  VaultSession.open(bytes, makeCredentials(pw), 'file-1', 'test.kdbx')

describe('VaultSession', () => {
  it('opens an Argon2id KDBX4 file and exposes no secrets in the snapshot', async () => {
    const session = await open(await makeFile())
    const snap = session.snapshot()

    expect(snap.dbName).toBe('Test DB')
    expect(snap.root.groups.map((g) => g.name)).toContain('Email')
    expect(snap.entries).toHaveLength(1)
    expect(snap.entries[0]).toMatchObject({
      title: 'Gmail',
      username: 'me@example.com',
      hasPassword: true,
      hasOtp: true
    })
    expect(JSON.stringify(snap)).not.toContain('s3cret')

    const detail = session.entryDetail(snap.entries[0].uuid)
    expect(detail.customFields.find((f) => f.key === 'Recovery')).toEqual({
      key: 'Recovery',
      protected: true,
      value: null
    })
    expect(session.reveal(snap.entries[0].uuid, 'Password')).toBe('s3cret')
  })

  it('rejects a wrong password with InvalidKey', async () => {
    const bytes = await makeFile()
    await expect(open(bytes, 'nope')).rejects.toMatchObject({ code: 'InvalidKey' })
    await expect(open(bytes, 'nope')).rejects.toBeInstanceOf(VaultError)
  })

  it('edits, saves and reloads', async () => {
    const session = await open(await makeFile())
    const uuid = session.snapshot().entries[0].uuid

    session.updateEntry(uuid, {
      title: 'Gmail (work)',
      username: 'me@work.com',
      url: 'https://mail.google.com',
      notes: 'rotated',
      tags: ['work']
    })
    const created = session.createEntry(undefined, {
      title: 'GitHub',
      username: 'octo',
      password: 'pw-2',
      url: '',
      notes: '',
      tags: []
    })
    expect(session.dirty).toBe(true)

    const reloaded = await open(await session.save())
    const snap = reloaded.snapshot()
    expect(snap.entries.map((e) => e.title).sort()).toEqual(['GitHub', 'Gmail (work)'])
    // password untouched when omitted from the input
    expect(reloaded.reveal(uuid, 'Password')).toBe('s3cret')
    expect(reloaded.reveal(created, 'Password')).toBe('pw-2')
    expect(reloaded.entryDetail(uuid).historyCount).toBe(1)
    // custom fields survive an update that does not mention them
    expect(reloaded.reveal(uuid, 'Recovery')).toBe('abc-def')
  })

  it('flags deleted entries as being in the recycle bin', async () => {
    const session = await open(await makeFile())
    const uuid = session.snapshot().entries[0].uuid
    expect(session.snapshot().entries[0].inRecycleBin).toBe(false)
    session.deleteEntry(uuid)
    expect(session.snapshot().entries.find((e) => e.uuid === uuid)?.inRecycleBin).toBe(true)
  })

  it('merges a concurrently edited remote copy', async () => {
    const original = await makeFile()
    const local = await open(original)
    const remote = await open(original)
    const uuid = local.snapshot().entries[0].uuid

    // Remote gets a new entry, local edits the existing one.
    remote.createEntry(undefined, {
      title: 'Remote only',
      username: '',
      url: '',
      notes: '',
      tags: []
    })
    const remoteBytes = await remote.save()
    await new Promise((r) => setTimeout(r, 5)) // distinct lastModTime
    local.updateEntry(uuid, { title: 'Local edit', username: 'u', url: '', notes: '', tags: [] })

    const remoteDb = await kdbxweb.Kdbx.load(remoteBytes, makeCredentials('hunter2'))
    local.merge(remoteDb)

    const merged = await open(await local.save())
    expect(
      merged
        .snapshot()
        .entries.map((e) => e.title)
        .sort()
    ).toEqual(['Local edit', 'Remote only'])
  })
})

describe('entry types', () => {
  const blank = { title: '', username: '', url: '', notes: '', tags: [] as string[] }
  const rawEntry = (s: VaultSession, uuid: string) =>
    [...s.db.getDefaultGroup().allEntries()].find((e) => e.uuid.id === uuid)!

  it('stores a typed entry as plain KDBX fields plus a CustomData marker', async () => {
    const session = await open(await makeFile())
    const uuid = session.createEntry(undefined, {
      ...blank,
      title: 'Passport – Jane Doe',
      type: 'passport',
      customFields: [
        { key: 'Given names', value: 'Jane', protected: false },
        { key: 'Surname', value: 'Doe', protected: false },
        { key: 'Passport number', value: ' C01X00T47 ', protected: false },
        { key: 'Nationality', value: 'de', protected: false },
        { key: 'Date of expiry', value: '2031-02-28', protected: false }
      ]
    })

    const reloaded = await open(await session.save())
    const entry = rawEntry(reloaded, uuid)
    expect(entry.customData?.get('sekure.type')?.value).toBe('passport@1')
    expect(entry.icon).toBe(9)
    // Readable by any KeePass app: ordinary string fields with readable names.
    expect(entry.fields.get('Passport number')).toBe('C01X00T47')
    expect(entry.fields.get('Nationality')).toBe('DE')

    const summary = reloaded.snapshot().entries.find((e) => e.uuid === uuid)!
    expect(summary).toMatchObject({ type: 'passport', subtitle: 'Jane Doe' })
    expect(reloaded.entryDetail(uuid).typeDetected).toBe(false)
  })

  it('protects secret fields even when the renderer says otherwise', async () => {
    const session = await open(await makeFile())
    const uuid = session.createEntry(undefined, {
      ...blank,
      title: 'Visa',
      type: 'creditCard',
      customFields: [
        { key: 'Card number', value: '4111111111111111', protected: false },
        { key: 'CVV', value: '737', protected: false },
        { key: 'Card issuer', value: 'Visa', protected: false },
        { key: 'Expiry', value: '3/2029', protected: false }
      ]
    })

    const reloaded = await open(await session.save())
    const entry = rawEntry(reloaded, uuid)
    expect(entry.fields.get('Card number')).toBeInstanceOf(kdbxweb.ProtectedValue)
    expect(entry.fields.get('CVV')).toBeInstanceOf(kdbxweb.ProtectedValue)
    expect(reloaded.reveal(uuid, 'Card number')).toBe('4111 1111 1111 1111')
    expect(entry.fields.get('Expiry')).toBe('03/29')

    const snap = JSON.stringify(reloaded.snapshot())
    expect(snap).not.toContain('4111')
    expect(snap).not.toContain('737')
    const detail = reloaded.entryDetail(uuid)
    expect(detail.customFields.find((f) => f.key === 'CVV')?.value).toBeNull()
  })

  it('recognises an entry without a marker from its fields and marks it on edit', async () => {
    const session = await open(await makeFile())
    const uuid = session.createEntry(undefined, {
      ...blank,
      title: 'Giro',
      customFields: [{ key: 'IBAN', value: 'DE89370400440532013000', protected: false }]
    })
    // Plain createEntry without a type: as if another KeePass app had written it.
    rawEntry(session, uuid).customData?.delete('sekure.type')

    expect(session.snapshot().entries.find((e) => e.uuid === uuid)?.type).toBe('bankAccount')
    expect(session.entryDetail(uuid).typeDetected).toBe(true)

    session.updateEntry(uuid, { ...blank, title: 'Giro' })
    expect(rawEntry(session, uuid).customData?.get('sekure.type')?.value).toBe('bankAccount@1')
    expect(session.entryDetail(uuid).typeDetected).toBe(false)
  })

  it('lets a detectable entry stay a plain login', async () => {
    const session = await open(await makeFile())
    const uuid = session.createEntry(undefined, {
      ...blank,
      title: 'Bank login',
      type: 'login',
      customFields: [{ key: 'IBAN', value: 'DE89370400440532013000', protected: false }]
    })
    expect(session.snapshot().entries.find((e) => e.uuid === uuid)?.type).toBe('login')
    expect(rawEntry(session, uuid).customData?.get('sekure.type')?.value).toBe('login@1')
  })

  it('converts types and rejects unknown ones', async () => {
    const session = await open(await makeFile())
    const uuid = session.snapshot().entries[0].uuid
    expect(session.snapshot().entries[0].type).toBe('login')

    session.updateEntry(uuid, { ...blank, title: 'Home Wi-Fi', type: 'wifi' })
    expect(session.snapshot().entries[0]).toMatchObject({ type: 'wifi', icon: 12 })
    session.updateEntry(uuid, { ...blank, title: 'Gmail', type: 'login' })
    expect(session.snapshot().entries[0]).toMatchObject({ type: 'login', icon: 0 })
    expect(rawEntry(session, uuid).customData?.has('sekure.type')).toBeFalsy()

    expect(() => session.updateEntry(uuid, { ...blank, type: 'spaceship' })).toThrow(VaultError)
  })

  it('keeps the marker when a remote copy wins the merge', async () => {
    const original = await makeFile()
    const local = await open(original)
    const remote = await open(original)
    const uuid = local.snapshot().entries[0].uuid

    await new Promise((r) => setTimeout(r, 5))
    remote.updateEntry(uuid, { ...blank, title: 'Office Wi-Fi', type: 'wifi' })
    const added = remote.createEntry(undefined, { ...blank, title: 'Note', type: 'secureNote' })
    const remoteDb = await kdbxweb.Kdbx.load(await remote.save(), makeCredentials('hunter2'))
    local.merge(remoteDb)

    const merged = await open(await local.save())
    const types = Object.fromEntries(merged.snapshot().entries.map((e) => [e.uuid, e.type]))
    expect(types[uuid]).toBe('wifi')
    expect(types[added]).toBe('secureNote')
  })

  it('keeps the marker in a KDBX3 file', async () => {
    const db = kdbxweb.Kdbx.create(makeCredentials('hunter2'), 'Old')
    db.setVersion(3)
    const session = new VaultSession(db, makeCredentials('hunter2'), 'f', 'old.kdbx')
    const uuid = session.createEntry(undefined, { ...blank, title: 'Note', type: 'secureNote' })
    const reloaded = await open(await session.save())
    expect(reloaded.snapshot().entries.find((e) => e.uuid === uuid)?.type).toBe('secureNote')
  })
})

describe('searchDocuments', () => {
  it('indexes names and metadata but never protected values', async () => {
    const session = await open(await makeFile())
    session.createEntry(undefined, {
      title: 'Visa',
      username: '',
      url: '',
      notes: 'Travel card',
      tags: ['finance'],
      type: 'creditCard',
      customFields: [
        { key: 'Card number', value: '4111111111111111', protected: true },
        { key: 'CVV', value: '737', protected: true },
        { key: 'Card issuer', value: 'Visa', protected: false }
      ]
    })

    const docs = session.searchDocuments()
    const text = JSON.stringify(docs)
    for (const secret of ['4111', '737', 's3cret', 'abc-def', 'GEZDGNBV']) {
      expect(text).not.toContain(secret)
    }

    const gmail = docs.find((d) => d.title === 'Gmail')!
    expect(gmail).toMatchObject({ group: 'Email', host: 'google', username: 'me@example.com' })
    expect(gmail.fieldNames).toEqual(['Recovery']) // the otp field is left out

    const visa = docs.find((d) => d.title === 'Visa')!
    expect(visa).toMatchObject({ type: 'Credit card', notes: 'Travel card', tags: ['finance'] })
    expect(visa.fieldNames).toEqual(expect.arrayContaining(['Card number', 'CVV', 'Card issuer']))
  })
})

describe('attachments', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const PDF = new TextEncoder().encode('%PDF-1.7 fake')

  it('adds, lists, reads, renames and removes attachments across save/reload', async () => {
    const session = await open(await makeFile())
    const uuid = session.snapshot().entries[0].uuid

    expect(await session.addAttachment(uuid, 'passport.png', PNG)).toBe('passport.png')
    expect(await session.addAttachment(uuid, 'contract.pdf', PDF)).toBe('contract.pdf')
    // name clash gets a suffix instead of overwriting
    expect(await session.addAttachment(uuid, 'passport.png', PDF)).toBe('passport (2).png')

    const reloaded = await open(await session.save())
    const detail = reloaded.entryDetail(uuid)
    expect(detail.attachmentCount).toBe(3)
    expect(detail.attachments.find((a) => a.name === 'passport.png')).toEqual({
      name: 'passport.png',
      size: PNG.byteLength,
      mime: 'image/png',
      kind: 'image'
    })
    expect(detail.attachments.find((a) => a.name === 'contract.pdf')?.kind).toBe('pdf')
    expect(Array.from(reloaded.readAttachment(uuid, 'passport.png').bytes)).toEqual(Array.from(PNG))

    expect(reloaded.renameAttachment(uuid, 'contract.pdf', 'lease.pdf')).toBe('lease.pdf')
    reloaded.removeAttachment(uuid, 'passport (2).png')
    const again = await open(await reloaded.save())
    expect(
      again
        .entryDetail(uuid)
        .attachments.map((a) => a.name)
        .sort()
    ).toEqual(['lease.pdf', 'passport.png'])
  })

  it('refuses oversized attachments', async () => {
    const session = await open(await makeFile())
    const uuid = session.snapshot().entries[0].uuid
    const big = new Uint8Array(50 * 1024 * 1024 + 1)
    await expect(session.addAttachment(uuid, 'huge.bin', big)).rejects.toBeInstanceOf(VaultError)
  })
})

describe('generatePassword', () => {
  it('honours length and classes', () => {
    const pw = generatePassword({
      length: 32,
      lower: true,
      upper: false,
      digits: true,
      symbols: false,
      unambiguous: true
    })
    expect(pw).toHaveLength(32)
    expect(pw).toMatch(/^[a-z2-9]+$/)
    expect(pw).toMatch(/\d/)
  })
})

describe('totp', () => {
  it('matches the RFC 6238 SHA1 vector', () => {
    // RFC secret "12345678901234567890", T=59 → 94287082 (8 digits)
    const secret = new TextEncoder().encode('12345678901234567890')
    expect(totp({ secret, digits: 8, period: 30, algorithm: 'sha1' }, 59_000).code).toBe('94287082')
  })

  it('parses otpauth URIs and bare seeds', () => {
    const uri = parseOtp('otpauth://totp/x?secret=GEZDGNBVGY3TQOJQ&digits=8&period=60')
    expect(uri).toMatchObject({ digits: 8, period: 60, algorithm: 'sha1' })
    expect(Array.from(parseOtp('GEZDGNBV').secret)).toEqual(Array.from(base32Decode('GEZDGNBV')))
  })
})

describe('database custom data', () => {
  it('stores app settings in Meta/CustomData across a save', async () => {
    const session = await open(await makeFile())
    expect(session.getCustomData('sekure.preferences')).toBeUndefined()
    session.setCustomData('sekure.preferences', '{"brand":null}')
    expect(session.dirty).toBe(true)

    const reopened = await open(await session.save())
    expect(reopened.getCustomData('sekure.preferences')).toBe('{"brand":null}')
  })

  it('takes the remote value on merge unless it was changed here', async () => {
    const base = await open(await makeFile())
    base.setCustomData('a', 'base')
    base.setCustomData('b', 'base')
    const file = await base.save()

    const local = await open(file)
    const remote = await open(file)
    remote.setCustomData('a', 'remote')
    remote.setCustomData('b', 'remote')
    local.setCustomData('b', 'local')
    local.merge(await kdbxweb.Kdbx.load(await remote.save(), makeCredentials('hunter2')))

    expect(local.getCustomData('a')).toBe('remote')
    expect(local.getCustomData('b')).toBe('local')
  })
})
