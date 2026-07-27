import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

export interface ArtifactStoreOptions {
  dir?: string
  /** Parent for a fresh managed namespace when dir is omitted. Primarily useful
   * to isolate embedding environments and tests; cannot be combined with dir. */
  namespaceRoot?: string
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
const LOCK_NAME = '.agentic-mermaid-artifacts-v1.lock'
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_LOCK_BYTES = 4096
const MANAGED_NAME = /^[0-9a-z]+-[0-9a-f-]{36}\.[a-z0-9_-]+$/
const IMPLICIT_NAMESPACE = /^store-[1-9][0-9]*-[0-9a-f-]{36}$/
const LEGACY_IMPLICIT_NAMESPACE = /^agentic-mermaid-mcp-artifacts-[1-9][0-9]*-[0-9a-f-]{36}$/
const IMPLICIT_REAP_GRACE_MS = 30_000
const DEFAULT_ARTIFACT_ROOT = join(tmpdir(), 'agentic-mermaid-mcp-artifacts')

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
  private readonly lockPath: string
  private readonly lockToken = randomUUID()
  private lockFd = -1
  private closed = false

  constructor(opts: ArtifactStoreOptions = {}) {
    if (opts.dir !== undefined && opts.namespaceRoot !== undefined) {
      throw new Error('artifact dir and namespaceRoot are mutually exclusive')
    }
    this.baseUrl = normalizeBaseUrl(opts.baseUrl)
    this.maxBytes = positiveSafeInteger(opts.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes')
    this.maxTotalBytes = positiveSafeInteger(opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES, 'maxTotalBytes')
    this.maxArtifacts = positiveSafeInteger(opts.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS, 'maxArtifacts')
    this.ttlMs = positiveSafeInteger(opts.ttlMs ?? DEFAULT_TTL_MS, 'ttlMs')
    if (this.maxBytes > this.maxTotalBytes) throw new Error('artifact maxBytes must not exceed maxTotalBytes')
    this.now = opts.now ?? (() => Date.now())
    if (opts.dir !== undefined) {
      this.dir = resolve(opts.dir)
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    } else {
      const root = resolve(opts.namespaceRoot ?? DEFAULT_ARTIFACT_ROOT)
      mkdirSync(root, { recursive: true, mode: 0o700 })
      const rootStat = lstatSync(root)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error('artifact namespace root must be a real directory')
      }
      if (opts.namespaceRoot === undefined) {
        // Migrate namespaces made by the previous process-local layout, which
        // placed each store directly in the OS temp directory.
        reapImplicitArtifactNamespaces(resolve(tmpdir()), this.now(), LEGACY_IMPLICIT_NAMESPACE)
      }
      reapImplicitArtifactNamespaces(root, this.now())
      this.dir = join(root, `store-${process.pid}-${randomUUID()}`)
      mkdirSync(this.dir, { mode: 0o700 })
    }
    this.manifestPath = join(this.dir, MANIFEST_NAME)
    this.lockPath = join(this.dir, LOCK_NAME)
    this.acquireOwnership()
    try {
      this.loadManifest()
      this.reconcileManagedFiles()
      this.cleanupExpired()
    } catch (error) {
      this.close()
      throw error
    }
  }

  setBaseUrl(baseUrl: string | undefined): void {
    this.baseUrl = normalizeBaseUrl(baseUrl)
  }

  hasBaseUrl(): boolean { return typeof this.baseUrl === 'string' && this.baseUrl.length > 0 }

  write(bytes: Uint8Array, opts: WriteArtifactOptions): ArtifactRecord {
    this.assertOpen()
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
    this.assertOpen()
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
    this.assertOpen()
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

  /** Release exclusive ownership of the artifact directory. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    const fd = this.lockFd
    this.lockFd = -1
    try {
      if (fd < 0 || !existsSync(this.lockPath)) return
      const held = fstatSync(fd)
      const current = lstatSync(this.lockPath)
      if (!current.isFile() || current.isSymbolicLink() || held.dev !== current.dev || held.ino !== current.ino) return
      const marker = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { token?: unknown }
      if (marker.token === this.lockToken) unlinkSync(this.lockPath)
    } catch {
      // Never remove a marker whose identity cannot be proven to be ours.
    } finally {
      if (fd >= 0) try { closeSync(fd) } catch {}
    }
  }

  private assertOpen(): void {
    if (this.closed || this.lockFd < 0) throw new Error('artifact store is closed')
  }

  private acquireOwnership(): void {
    let fd = -1
    try {
      fd = openSync(this.lockPath, 'wx', 0o600)
      const marker = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: hostname(), token: this.lockToken })
      writeSync(fd, marker)
      fsyncSync(fd)
      this.lockFd = fd
    } catch (error) {
      if (fd >= 0) {
        try { closeSync(fd) } catch {}
        try { unlinkSync(this.lockPath) } catch {}
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        throw new Error(`artifact directory is already owned; remove ${LOCK_NAME} only after confirming no server is using it`)
      }
      throw error
    }
  }

  private reconcileManagedFiles(): void {
    for (const name of readdirSync(this.dir)) {
      if (!MANAGED_NAME.test(name) || this.records.has(name)) continue
      const path = safePath(this.dir, name)
      try {
        const entry = lstatSync(path)
        if (entry.isFile() || entry.isSymbolicLink()) unlinkSync(path)
      } catch {}
    }
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
      if (!isManifestRecord(candidate)) {
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

/** Reap only auto-created namespaces that are no longer owned. Artifacts stay
 * available after a normal server shutdown until their recorded TTL expires;
 * the next implicit store removes expired files and empty namespaces. */
function reapImplicitArtifactNamespaces(root: string, now: number, namespacePattern = IMPLICIT_NAMESPACE): void {
  let entries: string[]
  try { entries = readdirSync(root) } catch { return }
  for (const name of entries) {
    if (!namespacePattern.test(name)) continue
    const dir = safePath(root, name)
    try {
      const namespace = lstatSync(dir)
      if (!namespace.isDirectory() || namespace.isSymbolicLink()) continue
      // A just-created directory may not have written its lock yet. The grace
      // period makes that construction window ineligible for collection.
      if (now - namespace.mtimeMs < IMPLICIT_REAP_GRACE_MS) continue
      const lockPath = join(dir, LOCK_NAME)
      if (existsSync(lockPath)) {
        const lock = lstatSync(lockPath)
        if (!lock.isFile() || lock.isSymbolicLink() || lock.size > MAX_LOCK_BYTES) continue
        const marker = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown; host?: unknown }
        if (marker.host !== hostname() || !Number.isSafeInteger(marker.pid) || (marker.pid as number) <= 0) continue
        if (processIsAlive(marker.pid as number)) continue
        const current = lstatSync(lockPath)
        if (current.dev !== lock.dev || current.ino !== lock.ino) continue
        unlinkSync(lockPath)
      }
      reapClosedNamespace(dir, now)
    } catch {
      // Corrupt or externally modified namespaces are quarantined rather than
      // guessed at. A future operator can inspect them without data loss.
    }
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function reapClosedNamespace(dir: string, now: number): void {
  const manifestPath = join(dir, MANIFEST_NAME)
  let records: ArtifactManifest['records'] = []
  if (existsSync(manifestPath)) {
    const stat = lstatSync(manifestPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) return
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ArtifactManifest
    if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.records)
      || manifest.records.some(record => !isManifestRecord(record))) return
    records = manifest.records
  }

  const live: ArtifactManifest['records'] = []
  for (const record of records) {
    const path = safePath(dir, record.name)
    if (record.expiresAt <= now) {
      try { unlinkSync(path) } catch {}
      continue
    }
    try {
      const file = lstatSync(path)
      if (file.isFile() && !file.isSymbolicLink() && file.size === record.bytes) live.push(record)
      else if (file.isFile() || file.isSymbolicLink()) unlinkSync(path)
    } catch {}
  }

  const liveNames = new Set(live.map(record => record.name))
  for (const name of readdirSync(dir)) {
    if (!MANAGED_NAME.test(name) || liveNames.has(name)) continue
    const path = safePath(dir, name)
    try {
      const file = lstatSync(path)
      if (file.isFile() || file.isSymbolicLink()) unlinkSync(path)
    } catch {}
  }

  if (live.length > 0) {
    if (live.length !== records.length) persistManifestRecords(dir, live)
    return
  }
  try {
    const manifest = lstatSync(manifestPath)
    if (manifest.isFile() && !manifest.isSymbolicLink()) unlinkSync(manifestPath)
  } catch {}
  try { rmdirSync(dir) } catch {}
}

function persistManifestRecords(dir: string, records: ArtifactManifest['records']): void {
  const path = join(dir, MANIFEST_NAME)
  const temp = join(dir, `.${MANIFEST_NAME}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temp, JSON.stringify({ schemaVersion: 1, records } satisfies ArtifactManifest), { mode: 0o600 })
    renameSync(temp, path)
  } finally {
    try { unlinkSync(temp) } catch {}
  }
}

function isManifestRecord(candidate: unknown): candidate is ArtifactManifest['records'][number] {
  if (!candidate || typeof candidate !== 'object') return false
  const record = candidate as Record<string, unknown>
  return typeof record.name === 'string' && MANAGED_NAME.test(record.name)
    && typeof record.mimeType === 'string' && record.mimeType.length > 0
    && Number.isSafeInteger(record.bytes) && (record.bytes as number) >= 0
    && typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/.test(record.sha256)
    && Number.isSafeInteger(record.createdAt) && Number.isSafeInteger(record.expiresAt)
    && (record.expiresAt as number) > (record.createdAt as number)
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
