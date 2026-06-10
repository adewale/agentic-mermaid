import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

export interface ArtifactStoreOptions {
  dir?: string
  baseUrl?: string
  maxBytes?: number
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
}

interface TrackedRecord extends ArtifactRecord {
  expiresAt: number
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_TTL_MS = 60 * 60 * 1000

export class ArtifactStore {
  readonly dir: string
  readonly maxBytes: number
  readonly ttlMs: number
  private baseUrl?: string
  private readonly now: () => number
  private readonly records = new Map<string, TrackedRecord>()

  constructor(opts: ArtifactStoreOptions = {}) {
    this.dir = resolve(opts.dir ?? join(tmpdir(), 'agentic-mermaid-mcp-artifacts'))
    this.baseUrl = normalizeBaseUrl(opts.baseUrl)
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.now = opts.now ?? (() => Date.now())
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
  }

  setBaseUrl(baseUrl: string | undefined): void {
    this.baseUrl = normalizeBaseUrl(baseUrl)
  }

  hasBaseUrl(): boolean { return typeof this.baseUrl === 'string' && this.baseUrl.length > 0 }

  write(bytes: Uint8Array, opts: WriteArtifactOptions): ArtifactRecord {
    if (!Number.isFinite(this.maxBytes) || this.maxBytes <= 0) throw new Error('artifact maxBytes must be a positive finite number')
    if (bytes.byteLength > this.maxBytes) throw new Error(`artifact exceeds maxBytes (${bytes.byteLength} > ${this.maxBytes})`)
    this.cleanupExpired()
    const buffer = Buffer.from(bytes)
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const ext = sanitizeExtension(opts.extension)
    const name = `${this.now().toString(36)}-${sha256.slice(0, 16)}${ext}`
    const path = safePath(this.dir, name)
    writeFileSync(path, buffer, { mode: 0o600 })
    const record: ArtifactRecord = { name, path, mimeType: opts.mimeType, bytes: buffer.length, sha256 }
    if (this.baseUrl) record.url = `${this.baseUrl}/${encodeURIComponent(name)}`
    this.records.set(name, { ...record, expiresAt: this.now() + this.ttlMs })
    return record
  }

  read(name: string): StoredArtifact | null {
    let path: string
    try { path = safePath(this.dir, name) } catch { return null }
    const record = this.records.get(name)
    if (!record || record.path !== path) return null
    if (record.expiresAt < this.now()) {
      this.deleteRecord(name, path)
      return null
    }
    if (!existsSync(path)) {
      this.records.delete(name)
      return null
    }
    const st = lstatSync(path)
    if (!st.isFile() || st.isSymbolicLink()) return null
    const bytes = readFileSync(path)
    return { path, bytes, mimeType: record.mimeType }
  }

  cleanupExpired(): void {
    if (!existsSync(this.dir)) return
    const cutoff = this.now()
    for (const [name, record] of this.records) {
      if (record.expiresAt < cutoff) this.deleteRecord(name, record.path)
    }
    // Untracked files are never served by read(); do not delete them because
    // the user may have pointed --artifact-dir at a shared directory.
  }

  private deleteRecord(name: string, path: string): void {
    this.records.delete(name)
    try { unlinkSync(path) } catch {}
  }
}

export function createArtifactStore(opts: ArtifactStoreOptions = {}): ArtifactStore {
  return new ArtifactStore(opts)
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
