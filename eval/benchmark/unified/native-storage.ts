/** Lossless storage for caller-selected immutable compiled executables.
 * Restoration happens before invocation: measured startup uses the original
 * executable bytes directly, with no decompression wrapper in the clock. */
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

export interface NativeStorageProof {
  file: string
  archive: string
  sha256: string
  bytes: number
  mode: number
  archiveBytes: number
  format: 'gzip-compiled-native-v1'
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

function regular(path: string): void {
  if (!lstatSync(path).isFile()) throw Error(`Expected a regular compiled artifact: ${path}`)
}

function paths(file: string, archive: string): void {
  if (!isAbsolute(file) || !isAbsolute(archive) || resolve(file) === resolve(archive)) throw Error('Native storage requires distinct absolute caller-selected file/archive paths')
}

function validateProof(proof: NativeStorageProof): void {
  paths(proof.file, proof.archive)
  if (proof.format !== 'gzip-compiled-native-v1' || !/^[a-f0-9]{64}$/.test(proof.sha256) || !Number.isSafeInteger(proof.bytes) || proof.bytes <= 0 || !Number.isInteger(proof.mode) || !(proof.mode & 0o111)) throw Error('Invalid compiled-native storage proof')
}

function verifyBytes(bytes: Buffer, proof: NativeStorageProof): void {
  if (bytes.length !== proof.bytes || sha256(bytes) !== proof.sha256) throw Error('Compiled-native bytes do not match storage proof')
}

function archiveBytes(proof: NativeStorageProof): Buffer {
  regular(proof.archive)
  const compressed = readFileSync(proof.archive)
  if (compressed.length !== proof.archiveBytes) throw Error('Compiled-native archive size changed')
  const bytes = gunzipSync(compressed, { maxOutputLength: proof.bytes })
  verifyBytes(bytes, proof)
  return bytes
}

function verifyFile(proof: NativeStorageProof): void {
  regular(proof.file)
  const stat = lstatSync(proof.file)
  if ((stat.mode & 0o7777) !== proof.mode) throw Error('Compiled-native executable permissions changed')
  verifyBytes(readFileSync(proof.file), proof)
}

function atomicWrite(path: string, bytes: Buffer, mode: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.native-storage-${process.pid}-${Math.random().toString(16).slice(2)}`
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', mode)
    writeFileSync(descriptor, bytes)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    chmodSync(temporary, mode)
    renameSync(temporary, path)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/** Atomically persist and round-trip verify gzip bytes before removing file. */
export function compactNativeArtifact(file: string, archive: string): NativeStorageProof {
  paths(file, archive)
  regular(file)
  const stat = lstatSync(file),
    mode = stat.mode & 0o7777,
    bytes = readFileSync(file)
  if (!(mode & 0o111) || !bytes.length) throw Error('Native compaction requires a nonempty executable artifact')
  const compressed = existsSync(archive) ? (regular(archive), readFileSync(archive)) : gzipSync(bytes),
    proof: NativeStorageProof = { file, archive, sha256: sha256(bytes), bytes: bytes.length, mode, archiveBytes: compressed.length, format: 'gzip-compiled-native-v1' }
  // Existing archives are never replaced on mismatch; the original executable
  // remains available until both the full archive and current file verify.
  verifyBytes(gunzipSync(compressed, { maxOutputLength: bytes.length }), proof)
  if (!existsSync(archive)) atomicWrite(archive, compressed, 0o600)
  archiveBytes(proof)
  verifyFile(proof)
  unlinkSync(file)
  return proof
}

/** Materialize verified original bytes before the caller begins any clocks. */
export function restoreNativeArtifact(proof: NativeStorageProof): void {
  validateProof(proof)
  const bytes = archiveBytes(proof)
  if (existsSync(proof.file)) {
    verifyFile(proof)
    return
  }
  atomicWrite(proof.file, bytes, proof.mode)
  verifyFile(proof)
}

/** Remove only the verified materialized copy, retaining its verified archive. */
export function releaseNativeArtifact(proof: NativeStorageProof): void {
  validateProof(proof)
  archiveBytes(proof)
  if (!existsSync(proof.file)) return
  verifyFile(proof)
  unlinkSync(proof.file)
}
