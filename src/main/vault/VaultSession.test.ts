import * as kdbxweb from 'kdbxweb'
import { describe, expect, it } from 'vitest'
import { installArgon2 } from './argon2'
import {
  checkKdfParameters,
  KDF_LIMITS,
  loadKdbx,
  makeCredentials,
  VaultError,
  VaultSession
} from './VaultSession'
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
    expect(visa).toMatchObject({ type: 'Payment card', notes: 'Travel card', tags: ['finance'] })
    expect(visa.fieldNames).toEqual(expect.arrayContaining(['Card number', 'CVV', 'Card issuer']))
  })
})

describe('people', () => {
  const blank = { title: '', username: '', url: '', notes: '', tags: [] as string[] }
  const person = (s: VaultSession, given: string, surname: string) =>
    s.createEntry(undefined, {
      ...blank,
      type: 'personalDetails',
      customFields: [
        { key: 'Given names', value: given, protected: false },
        { key: 'Surname', value: surname, protected: false }
      ]
    })
  const summary = (s: VaultSession, uuid: string) =>
    s.snapshot().entries.find((e) => e.uuid === uuid)!

  it('links entries to Person entries through CustomData, and it survives a save', async () => {
    const session = await open(await makeFile())
    const jane = person(session, 'Jane', 'Doe')
    const passport = session.createEntry(undefined, {
      ...blank,
      type: 'passport',
      people: [jane]
    })
    expect(summary(session, passport).people).toEqual([jane])

    const reloaded = await open(await session.save())
    expect(summary(reloaded, passport).people).toEqual([jane])
    const raw = [...reloaded.db.getDefaultGroup().allEntries()].find((e) => e.uuid.id === passport)!
    expect(raw.customData?.get('sekure.people')?.value).toBe(jane)
  })

  it('drops links to anything that is not a Person, and to itself', async () => {
    const session = await open(await makeFile())
    const jane = person(session, 'Jane', 'Doe')
    const gmail = session.snapshot().entries.find((e) => e.title === 'Gmail')!.uuid
    session.setPeople(gmail, [jane, gmail, 'bogus', jane])
    expect(summary(session, gmail).people).toEqual([jane])
    session.setPeople(jane, [jane])
    expect(summary(session, jane).people).toEqual([])
    expect(() => session.setPeople(gmail, Array(51).fill(jane))).toThrow(VaultError)
  })

  it('records a history step, and forgets links once the person is gone', async () => {
    const session = await open(await makeFile())
    const jane = person(session, 'Jane', 'Doe')
    const gmail = session.snapshot().entries.find((e) => e.title === 'Gmail')!.uuid
    session.setPeople(gmail, [jane])
    const raw = [...session.db.getDefaultGroup().allEntries()].find((e) => e.uuid.id === gmail)!
    expect(raw.history.length).toBe(1)
    // Unchanged links are not another history step.
    session.setPeople(gmail, [jane])
    expect(raw.history.length).toBe(1)

    // Changed into something else: no longer a person, so the link goes.
    session.updateEntry(jane, { ...blank, type: 'secureNote' })
    expect(summary(session, gmail).people).toEqual([])
  })

  it('keeps links when a remote copy wins the merge', async () => {
    const original = await makeFile()
    const local = await open(original)
    const remote = await open(original)
    const gmail = local.snapshot().entries[0].uuid

    await new Promise((r) => setTimeout(r, 5))
    const jane = person(remote, 'Jane', 'Doe')
    remote.setPeople(gmail, [jane])
    local.merge(await kdbxweb.Kdbx.load(await remote.save(), makeCredentials('hunter2')))

    const merged = await open(await local.save())
    expect(summary(merged, gmail).people).toEqual([jane])
  })

  it('indexes the names of linked people for search', async () => {
    const session = await open(await makeFile())
    const jane = person(session, 'Jane', 'Doe')
    const gmail = session.snapshot().entries.find((e) => e.title === 'Gmail')!.uuid
    session.setPeople(gmail, [jane])
    const doc = session.searchDocuments().find((d) => d.uuid === gmail)!
    expect(doc.people).toEqual(['Jane Doe'])
  })
})

describe('findSecrets', () => {
  it('finds passwords, protected fields, OTP seeds and card numbers, reporting names only', async () => {
    const session = await open(await makeFile())
    session.createEntry(undefined, {
      title: 'Visa',
      username: '',
      url: '',
      notes: '',
      tags: [],
      type: 'creditCard',
      customFields: [
        { key: 'Card number', value: '4111111111111111', protected: false },
        { key: 'CVV', value: '737', protected: false }
      ]
    })
    const text =
      'pw s3cret, recovery abc-def, seed gezdgnbvgy3tqojqgezdgnbvgy3tqojq, card 4111-1111-1111-1111 cvv 737, order 97371'
    const hits = session.findSecrets(text)
    const found = hits.map((h) => [text.slice(h.start, h.end), `${h.entry} / ${h.field}`])
    expect(found).toEqual(
      expect.arrayContaining([
        ['s3cret', 'Gmail / Password'],
        ['abc-def', 'Gmail / Recovery'],
        ['gezdgnbvgy3tqojqgezdgnbvgy3tqojq', 'Gmail / one-time code seed'],
        ['4111-1111-1111-1111', 'Visa / Card number'],
        ['737', 'Visa / CVV']
      ])
    )
    expect(found.map((f) => f[0])).not.toContain('97371')
    for (const secret of ['s3cret', 'abc-def', '4111', '737']) {
      expect(JSON.stringify(hits)).not.toContain(secret)
    }
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

describe('generatePassword validation', () => {
  it('fills in missing options instead of producing a short password', () => {
    expect(generatePassword({ symbols: false })).toHaveLength(24)
    expect(generatePassword()).toHaveLength(24)
  })

  it('rejects absurd or non-integer lengths', () => {
    for (const length of [0, 3, 1025, 1e9, 12.5, Number.NaN]) {
      expect(() => generatePassword({ length }), String(length)).toThrow(/between/)
    }
  })
})

describe('key derivation limits', () => {
  const U64 = kdbxweb.VarDictionary.ValueType.UInt64

  /**
   * Just a KDBX4 header with the given KDF parameters, as a crafted file would
   * carry. The check has to reject it before the KDF (or anything else) runs.
   */
  const header = (kdf: string, params: Record<string, number>) => {
    const db = kdbxweb.Kdbx.create(makeCredentials('pw'), 'KDF')
    db.setVersion(4)
    db.setKdf(kdf)
    for (const [key, value] of Object.entries(params)) {
      db.header.kdfParameters!.set(key, U64, kdbxweb.Int64.from(value))
    }
    db.header.generateSalts()
    const stm = new kdbxweb.BinaryStream()
    db.header.write(stm)
    return stm.getWrittenBytes()
  }

  it('accepts ordinary files and leaves unreadable ones to Kdbx.load', async () => {
    expect(() => checkKdfParameters(new Uint8Array(0).buffer)).not.toThrow()
    const ordinary = await makeFile()
    expect(() => checkKdfParameters(ordinary)).not.toThrow()
    expect(() =>
      checkKdfParameters(header(kdbxweb.Consts.KdfId.Argon2id, { M: 64 * 1024 * 1024, I: 3 }))
    ).not.toThrow()
  })

  it('refuses Argon2 memory, iterations or parallelism beyond the limits', async () => {
    const tooMuch: Record<string, number>[] = [
      { M: KDF_LIMITS.argon2MemoryBytes + 1024 },
      { I: KDF_LIMITS.argon2Iterations + 1 },
      { P: KDF_LIMITS.argon2Parallelism + 1 },
      { I: 2 ** 40 }
    ]
    for (const params of tooMuch) {
      for (const kdf of [kdbxweb.Consts.KdfId.Argon2d, kdbxweb.Consts.KdfId.Argon2id]) {
        const bytes = header(kdf, params)
        expect(() => checkKdfParameters(bytes), JSON.stringify(params)).toThrow(VaultError)
        await expect(loadKdbx(bytes, makeCredentials('pw'))).rejects.toThrow(/key derivation/)
      }
    }
  })

  it('refuses AES-KDF rounds beyond the limit', () => {
    const bytes = header(kdbxweb.Consts.KdfId.Aes, { R: KDF_LIMITS.aesRounds * 10 })
    expect(() => checkKdfParameters(bytes)).toThrow(VaultError)
  })
})

describe('protected standard fields', () => {
  it('keeps protected Title/UserName/URL/Notes out of snapshots and details', async () => {
    const db = kdbxweb.Kdbx.create(makeCredentials('pw'), 'Protected')
    const entry = db.createEntry(db.getDefaultGroup())
    entry.fields.set('Title', kdbxweb.ProtectedValue.fromString('Secret bank'))
    entry.fields.set('UserName', kdbxweb.ProtectedValue.fromString('agent-007'))
    entry.fields.set('URL', kdbxweb.ProtectedValue.fromString('https://hidden.example'))
    entry.fields.set('Notes', kdbxweb.ProtectedValue.fromString('pin 1234'))
    entry.fields.set('Password', kdbxweb.ProtectedValue.fromString('pw'))
    const session = await VaultSession.open(await db.save(), makeCredentials('pw'), 'f', 'f')

    const snapshot = JSON.stringify(session.snapshot())
    const detail = session.entryDetail(entry.uuid.id)
    for (const secret of ['Secret bank', 'agent-007', 'hidden.example', 'pin 1234']) {
      expect(snapshot).not.toContain(secret)
      expect(JSON.stringify(detail)).not.toContain(secret)
    }
    expect(detail.protectedFields.sort()).toEqual(['Notes', 'Title', 'URL', 'UserName'])
    expect(detail.hasPassword).toBe(true)
    expect(session.reveal(entry.uuid.id, 'UserName')).toBe('agent-007')
  })

  it('keeps a protected field protected, and unchanged when not sent, on edit', async () => {
    const db = kdbxweb.Kdbx.create(makeCredentials('pw'), 'Protected')
    const entry = db.createEntry(db.getDefaultGroup())
    entry.fields.set('UserName', kdbxweb.ProtectedValue.fromString('agent-007'))
    entry.fields.set('Notes', kdbxweb.ProtectedValue.fromString('pin 1234'))
    const session = await VaultSession.open(await db.save(), makeCredentials('pw'), 'f', 'f')
    const uuid = entry.uuid.id

    session.updateEntry(uuid, { title: 'Bank', username: 'agent-008', url: '', tags: [] })
    const updated = session.db.getDefaultGroup().entries[0]
    expect(updated.fields.get('UserName')).toBeInstanceOf(kdbxweb.ProtectedValue)
    expect(session.reveal(uuid, 'UserName')).toBe('agent-008')
    expect(session.reveal(uuid, 'Notes')).toBe('pin 1234')
    expect(updated.fields.get('Title')).toBe('Bank')
  })
})

describe('save bookkeeping', () => {
  it('stays dirty when an edit lands while a save is in flight', async () => {
    const session = await open(await makeFile())
    session.createEntry(undefined, { title: 'A', username: '', url: '', notes: '', tags: [] })
    const savedAt = session.revision
    const bytes = session.save()
    session.createEntry(undefined, { title: 'B', username: '', url: '', notes: '', tags: [] })
    await bytes
    session.markSaved(savedAt)
    expect(session.dirty).toBe(true)
    session.markSaved(session.revision)
    expect(session.dirty).toBe(false)
  })
})

describe('totp', () => {
  it('matches the RFC 6238 SHA1 vector', () => {
    // RFC secret "12345678901234567890", T=59 → 94287082 (8 digits)
    const secret = new TextEncoder().encode('12345678901234567890')
    expect(totp({ secret, digits: 8, period: 30, algorithm: 'sha1' }, 59_000).code).toBe('94287082')
  })

  it('rejects malformed URIs without echoing the seed', () => {
    let error: unknown
    try {
      parseOtp('otpauth://%%%secret=SEEDSEEDSEED')
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('SEEDSEED')
    expect(() => parseOtp('otpauth://totp/x?secret=GEZDGNBV&period=0')).toThrow(/period/)
    expect(() => parseOtp('otpauth://totp/x?secret=GEZDGNBV&digits=abc')).toThrow(/length/)
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
