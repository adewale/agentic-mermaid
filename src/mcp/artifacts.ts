import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

export interface ArtifactStoreOptions {
  dir?: string
  baseUrl?: string
  maxBytes?: number
  maxTotalBytes?: number
  maxArtifacts?: number
  ttlMs?: number
  now?: () => number
}

export interface WriteArtifactOptions {
  extension: string
  mimeType: string
}

export interface ArtifactRecord {
  name: string
  path: string
  mimeType: string
  bytes: number
  sha256: string
  url?: string
}

export interface StoredArtifact {
  path: string
  mimeType: string
  bytes: Buffer
  expiresAt: number
  cacheMaxAgeSeconds: number
}

interface TrackedRecord extends ArtifactRecord {
  createdAt: number
  expiresAt: number
}

interface ArtifactManifest {
  schemaVersion: 1
  records: Array<Pick<TrackedRecord, 'name' | 'mimeType' | 'bytes' | 'sha256' | 'createdAt' | 'expiresAt'>>
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024
const DEFAULT_MAX_ARTIFACTS = 1_000
const DEFAULT_TTL_MS = 60 * 60 * 1000
const MANIFEST_NAME = '.agentic-mermaid-artifacts-v1.json'
const MAX_MANIFEST_BYTES = 1024 * 1024
const MANAGED_NAME = /^[0-9a-z]+-[0-9a-f-]{36}\.[a-z0-9_-]+$/

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`artifact ${field} must be a positive safe integer`)
  return value
}

export class ArtifactStore {
  readonly dir: string
  readonly maxBytes: number
  readonly maxTotalBytes: number
  readonly maxArtifacts: number
  readonly ttlMs: number
  private baseUrl?: string
  private readonly now: () => number
  private readonly records = new Map<string, TrackedRecord>()
  private readonly manifestPath: string

  constructor(opts: ArtifactStoreOptions = {}) {
    this.dir = resolve(opts.dir ?? join(tmpdir(), 'agentic-mermaid-mcp-artifacts'))
    this.baseUrl = normalizeBaseUrl(opts.baseUrl)
    this.maxBytes = positiveSafeInteger(opts.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes')
    this.maxTotalBytes = positiveSafeInteger(opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES, 'maxTotalBytes')
    this.maxArtifacts = positiveSafeInteger(opts.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS, 'maxArtifacts')
    this.ttlMs = positiveSafeInteger(opts.ttlMs ?? DEFAULT_TTL_MS, 'ttlMs')
    if (this.maxBytes > this.maxTotalBytes) throw new Error('artifact maxBytes must not exceed maxTotalBytes')
    this.now = opts.now ?? (() => Date.now())
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    this.manifestPath = join(this.dir, MANIFEST_NAME)
    this.loadManifest()
    this.cleanupExpired()
  }

  setBaseUrl(baseUrl: string | undefined): void {
    this.baseUrl = normalizeBaseUrl(baseUrl)
  }

  hasBaseUrl(): boolean { return typeof this.baseUrl === 'string' && this.baseUrl.length > 0 }

  write(bytes: Uint8Array, opts: WriteArtifactOptions): ArtifactRecord {
    if (bytes.byteLength > this.maxBytes) throw new Error(`artifact exceeds maxBytes (${bytes.byteLength} > ${this.maxBytes})`)
    if (bytes.byteLength > this.maxTotalBytes) throw new Error(`artifact exceeds maxTotalBytes (${bytes.byteLength} > ${this.maxTotalBytes})`)
    this.cleanupExpired()
    if (this.records.size >= this.maxArtifacts) throw new Error(`artifact store exceeds maxArtifacts (${this.records.size + 1} > ${this.maxArtifacts})`)
    const totalBytes = [...this.records.values()].reduce((total, record) => total + record.bytes, 0)
    if (totalBytes + bytes.byteLength > this.maxTotalBytes) {
      throw new Error(`artifact store exceeds maxTotalBytes (${totalBytes + bytes.byteLength} > ${this.maxTotalBytes})`)
    }

    const buffer = Buffer.from(bytes)
    const sha256 = digest(buffer)
    const ext = sanitizeExtension(opts.extension)
    const createdAt = this.now()
    const name = `${createdAt.toString(36)}-${randomUUID()}${ext}`
    const path = safePath(this.dir, name)
    const temp = safePath(this.dir, `.${name}.${randomUUID()}.tmp`)
    const tracked: TrackedRecord = {
      name,
      path,
      mimeType: opts.mimeType,
      bytes: buffer.length,
      sha256,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    }
    try {
      writeFileSync(temp, buffer, { mode: 0o600 })
      renameSync(temp, path)
      this.records.set(name, tracked)
      this.persistManifest()
    } catch (error) {
      this.records.delete(name)
      try { unlinkSync(temp) } catch {}
      try { unlinkSync(path) } catch {}
      throw error
    }
    return this.publicRecord(tracked)
  }

  read(name: string): StoredArtifact | null {
    let path: string
    try { path = safePath(this.dir, name) } catch { return null }
    const record = this.records.get(name)
    if (!record || record.path !== path) return null
    const now = this.now()
    if (record.expiresAt <= now) {
      this.deleteRecord(name, path, true)
      return null
    }
    if (!existsSync(path)) {
      this.records.delete(name)
      this.persistManifest()
      return null
    }
    const st = lstatSync(path)
    if (!st.isFile() || st.isSymbolicLink() || st.size !== record.bytes) {
      this.deleteRecord(name, path, true)
      return null
    }
    const bytes = readFileSync(path)
    if (digest(bytes) !== record.sha256) {
      this.deleteRecord(name, path, true)
      return null
    }
    return {
      path,
      bytes,
      mimeType: record.mimeType,
      expiresAt: record.expiresAt,
      cacheMaxAgeSeconds: Math.max(0, Math.floor((record.expiresAt - now) / 1000)),
    }
  }

  cleanupExpired(): void {
    const cutoff = this.now()
    let changed = false
    for (const [name, record] of this.records) {
      if (record.expiresAt <= cutoff) {
        this.deleteRecord(name, record.path, false)
        changed = true
      }
    }
    if (changed) this.persistManifest()
  }

  private publicRecord(record: TrackedRecord): ArtifactRecord {
    const output: ArtifactRecord = {
      name: record.name,
      path: record.path,
      mimeType: record.mimeType,
      bytes: record.bytes,
      sha256: record.sha256,
    }
    if (this.baseUrl) output.url = `${this.baseUrl}/${encodeURIComponent(record.name)}`
    return output
  }

  private loadManifest(): void {
    if (!existsSync(this.manifestPath)) return
    const stat = lstatSync(this.manifestPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) {
      throw new Error('artifact manifest must be a bounded regular file')
    }
    let manifest: ArtifactManifest
    try { manifest = JSON.parse(readFileSync(this.manifestPath, 'utf8')) as ArtifactManifest }
    catch { throw new Error('artifact manifest is not valid JSON') }
    if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.records) || manifest.records.length > this.maxArtifacts) {
      throw new Error('artifact manifest has an unsupported or oversized shape')
    }
    let totalBytes = 0
    for (const candidate of manifest.records) {
      if (!candidate || typeof candidate !== 'object'
        || typeof candidate.name !== 'string' || !MANAGED_NAME.test(candidate.name)
        || typeof candidate.mimeType !== 'string' || candidate.mimeType.length === 0
        || !Number.isSafeInteger(candidate.bytes) || candidate.bytes < 0
        || typeof candidate.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.sha256)
        || !Number.isSafeInteger(candidate.createdAt) || !Number.isSafeInteger(candidate.expiresAt)
        || candidate.expiresAt <= candidate.createdAt) {
        throw new Error('artifact manifest contains an invalid record')
      }
      const path = safePath(this.dir, candidate.name)
      if (!existsSync(path)) continue
      const file = lstatSync(path)
      if (!file.isFile() || file.isSymbolicLink() || file.size !== candidate.bytes) {
        throw new Error(`artifact manifest record ${candidate.name} does not match a regular file`)
      }
      const bytes = readFileSync(path)
      if (digest(bytes) !== candidate.sha256) throw new Error(`artifact manifest record ${candidate.name} failed integrity verification`)
      totalBytes += candidate.bytes
      if (totalBytes > this.maxTotalBytes) throw new Error('artifact manifest exceeds maxTotalBytes')
      this.records.set(candidate.name, { ...candidate, path })
    }
    if (this.records.size !== manifest.records.length) this.persistManifest()
  }

  private persistManifest(): void {
    const records = [...this.records.values()]
      .sort((a, b) => a.createdAt - b.createdAt || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ name, mimeType, bytes, sha256, createdAt, expiresAt }) => ({ name, mimeType, bytes, sha256, createdAt, expiresAt }))
    const body = JSON.stringify({ schemaVersion: 1, records } satisfies ArtifactManifest)
    if (Buffer.byteLength(body) > MAX_MANIFEST_BYTES) throw new Error('artifact manifest exceeds its byte budget')
    const temp = join(this.dir, `.${MANIFEST_NAME}.${process.pid}.${randomUUID()}.tmp`)
    try {
      writeFileSync(temp, body, { mode: 0o600 })
      renameSync(temp, this.manifestPath)
    } finally {
      try { unlinkSync(temp) } catch {}
    }
  }

  private deleteRecord(name: string, path: string, persist: boolean): void {
    this.records.delete(name)
    try { unlinkSync(path) } catch {}
    if (persist) this.persistManifest()
  }
}

export function createArtifactStore(opts: ArtifactStoreOptions = {}): ArtifactStore {
  return new ArtifactStore(opts)
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizeBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  return url.replace(/\/+$/, '')
}

function sanitizeExtension(extension: string): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  const safe = ext.toLowerCase().replace(/[^.a-z0-9_-]/g, '')
  return safe && safe !== '.' ? safe : '.bin'
}

function safePath(root: string, name: string): string {
  const leaf = basename(name)
  if (!leaf || leaf !== name || leaf.includes('..')) throw new Error('invalid artifact name')
  const path = resolve(root, leaf)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (!path.startsWith(prefix)) throw new Error('artifact path escaped root')
  return path
}
