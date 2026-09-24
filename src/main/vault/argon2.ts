import * as kdbxweb from 'kdbxweb'
import { argon2d, argon2id } from 'hash-wasm'

/**
 * kdbxweb ships no Argon2 of its own, and KDBX4 files (KeePassXC's default)
 * derive their key with Argon2d or Argon2id. hash-wasm is pure WASM, so this
 * runs in the main process without a native module.
 *
 * kdbxweb already converts memory to KiB, which is what hash-wasm expects.
 */
export const argon2Impl: kdbxweb.CryptoEngine.Argon2Fn = async (
  password,
  salt,
  memory,
  iterations,
  length,
  parallelism,
  type,
  version
) => {
  if (version !== 0x13) {
    // hash-wasm only implements Argon2 v1.3; KeePass has never written 0x10.
    throw new Error(`Unsupported Argon2 version 0x${version.toString(16)}`)
  }
  const fn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d
  const hash = await fn({
    password: new Uint8Array(password),
    salt: new Uint8Array(salt),
    memorySize: memory,
    iterations,
    hashLength: length,
    parallelism,
    outputType: 'binary'
  })
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer
}

let installed = false

export function installArgon2(): void {
  if (installed) return
  kdbxweb.CryptoEngine.setArgon2Impl(argon2Impl)
  installed = true
}
