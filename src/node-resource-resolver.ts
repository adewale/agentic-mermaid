import { createHash } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import {
  BUILTIN_RESOURCE_MEDIA_TYPES,
  snapshotResourceManifest,
  type ResourceManifest,
  type ResourceManifestEntry,
  type ResourceMediaTypeVerifier,
} from './resource-manifest.ts'

export type ResourceResolutionCode =
  | 'INVALID_RESOURCE_MANIFEST'
  | 'UNKNOWN_RESOURCE'
  | 'RESOURCE_MISSING'
  | 'RESOURCE_PATH_ESCAPE'
  | 'RESOURCE_SYMLINK_REJECTED'
  | 'RESOURCE_NOT_REGULAR'
  | 'RESOURCE_SIZE_LIMIT'
  | 'RESOURCE_SIZE_MISMATCH'
  | 'RESOURCE_MEDIA_TYPE_MISMATCH'
  | 'RESOURCE_DIGEST_MISMATCH'
  | 'RESOURCE_LICENSE_NOTICE_MISSING'

export class ResourceResolutionError extends Error {
  readonly code: ResourceResolutionCode
  readonly resourceId: string

  constructor(code: ResourceResolutionCode, resourceId: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'ResourceResolutionError'
    this.code = code
    this.resourceId = resourceId
  }
}

export interface VerifiedInstalledResource {
  readonly entry: ResourceManifestEntry
  /** Returns a defensive copy of the bytes that passed all integrity checks. */
  readonly readBytes: () => Uint8Array
}

export interface OptionalResourceDiagnostic {
  readonly code: 'OPTIONAL_RESOURCE_MISSING'
  readonly resourceId: string
  readonly message: string
}

export interface InstalledResourceVerification {
  readonly resources: readonly VerifiedInstalledResource[]
  readonly diagnostics: readonly OptionalResourceDiagnostic[]
}

export interface NodeResourceResolverOptions {
  readonly maxResourceBytes?: number
  readonly mediaTypes?: Readonly<Record<string, ResourceMediaTypeVerifier>>
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** @internal Exported only so the cross-platform security fallback is testable. */
export function openedResourceDescriptorPath(platform: NodeJS.Platform, fd: number): string | undefined {
  if (platform === 'linux') return `/proc/self/fd/${fd}`
  if (platform === 'darwin') return `/dev/fd/${fd}`
  return undefined
}

/**
 * Read-only installed-resource resolver. It has no URL or callback fallback:
 * every returned byte came from the declared package root and passed the
 * manifest's path, symlink, size, media-type and SHA-256 checks.
 */
export class NodeResourceResolver {
  readonly #root: string
  readonly #manifest: ResourceManifest
  readonly #maxResourceBytes: number
  readonly #mediaTypes: Readonly<Record<string, ResourceMediaTypeVerifier>>
  readonly #byId: ReadonlyMap<string, ResourceManifestEntry>

  constructor(packageRoot: string, manifest: unknown, options: NodeResourceResolverOptions = {}) {
    let manifestSnapshot: ResourceManifest
    try {
      manifestSnapshot = snapshotResourceManifest(manifest)
    } catch (error) {
      const detail = error instanceof Error
        ? error.message.replace(/^INVALID_RESOURCE_MANIFEST:\s*/, '')
        : String(error)
      throw new ResourceResolutionError('INVALID_RESOURCE_MANIFEST', 'resource-manifest', detail)
    }
    const maxResourceBytes = options.maxResourceBytes ?? 16 * 1024 * 1024
    if (!Number.isSafeInteger(maxResourceBytes) || maxResourceBytes <= 0) {
      throw new ResourceResolutionError('INVALID_RESOURCE_MANIFEST', 'resource-manifest', 'maxResourceBytes must be a positive safe integer')
    }
    try {
      this.#root = realpathSync(packageRoot)
    } catch {
      throw new ResourceResolutionError('RESOURCE_MISSING', 'resource-manifest', `package root does not exist: ${packageRoot}`)
    }
    this.#manifest = manifestSnapshot
    this.#maxResourceBytes = maxResourceBytes
    this.#mediaTypes = Object.freeze({ ...(options.mediaTypes ?? BUILTIN_RESOURCE_MEDIA_TYPES) })
    this.#byId = new Map(this.#manifest.resources.map(entry => [entry.identity.id, entry]))
  }

  list(): readonly ResourceManifestEntry[] {
    return this.#manifest.resources
  }

  #securePath(entry: ResourceManifestEntry, declaredPath: string, missingCode: ResourceResolutionCode): string {
    const segments = declaredPath.split('/')
    let candidate = this.#root
    for (const segment of segments) {
      candidate = join(candidate, segment)
      let stat
      try {
        stat = lstatSync(candidate)
      } catch (error) {
        if (errnoCode(error) === 'ENOENT') {
          throw new ResourceResolutionError(missingCode, entry.identity.id, `declared path is missing: ${declaredPath}`)
        }
        throw error
      }
      if (stat.isSymbolicLink()) {
        throw new ResourceResolutionError('RESOURCE_SYMLINK_REJECTED', entry.identity.id, `symlink component is forbidden: ${declaredPath}`)
      }
    }
    const escaped = relative(this.#root, candidate)
    if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
      throw new ResourceResolutionError('RESOURCE_PATH_ESCAPE', entry.identity.id, `path escapes package root: ${declaredPath}`)
    }
    return candidate
  }

  #openSecureFile(entry: ResourceManifestEntry, declaredPath: string, missingCode: ResourceResolutionCode): number {
    const absolutePath = this.#securePath(entry, declaredPath, missingCode)
    let fd: number
    try {
      // O_NOFOLLOW closes the final-component race. Resolving the opened file
      // descriptor below, rather than the pathname, closes intermediate
      // component swaps and proves the object actually opened stayed rooted.
      fd = openSync(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    } catch (error) {
      const code = errnoCode(error)
      if (code === 'ENOENT') throw new ResourceResolutionError(missingCode, entry.identity.id, `declared path is missing: ${declaredPath}`)
      if (code === 'ELOOP') throw new ResourceResolutionError('RESOURCE_SYMLINK_REJECTED', entry.identity.id, `symlink component is forbidden: ${declaredPath}`)
      throw error
    }
    try {
      const openedStat = fstatSync(fd)
      if (!openedStat.isFile()) {
        throw new ResourceResolutionError('RESOURCE_NOT_REGULAR', entry.identity.id, `resource is not a regular file: ${declaredPath}`)
      }

      // Linux exposes the canonical target through /proc/self/fd and Bun does
      // the same for /dev/fd on macOS. Plain Node on macOS deliberately does
      // not: realpathSync('/dev/fd/N') returns the descriptor path unchanged.
      // Treat descriptor canonicalization as an additional proof when the
      // runtime supplies it, never as the only portable proof of rootedness.
      // Windows and other platforms do not expose either descriptor path. They
      // skip this additional proof and use the portable rooted identity re-walk
      // below; attempting /dev/fd there fails before any resource can verify.
      const descriptorPath = openedResourceDescriptorPath(process.platform, fd)
      if (descriptorPath) {
        const openedPath = realpathSync(descriptorPath)
        if (openedPath !== descriptorPath && !openedPath.startsWith(`${descriptorPath}${sep}`)) {
          const escaped = relative(this.#root, openedPath)
          if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
            throw new ResourceResolutionError('RESOURCE_PATH_ESCAPE', entry.identity.id, `opened file escapes package root: ${declaredPath}`)
          }
        }
      }

      // Re-walk the declared path after open, reject any newly introduced
      // symlink component, and prove the object reachable through that rooted
      // path is the exact object held by the descriptor. This closes an
      // intermediate-directory swap even on runtimes that cannot reveal an
      // opened descriptor's canonical pathname. Subsequent reads use only fd.
      const rootedPath = this.#securePath(entry, declaredPath, missingCode)
      const rootedStat = lstatSync(rootedPath)
      if (!rootedStat.isFile()) {
        throw new ResourceResolutionError('RESOURCE_NOT_REGULAR', entry.identity.id, `resource is not a regular file: ${declaredPath}`)
      }
      if (openedStat.dev !== rootedStat.dev || openedStat.ino !== rootedStat.ino) {
        throw new ResourceResolutionError('RESOURCE_PATH_ESCAPE', entry.identity.id, `opened file identity no longer matches the rooted path: ${declaredPath}`)
      }
      return fd
    } catch (error) {
      closeSync(fd)
      throw error
    }
  }

  resolve(resourceId: string): VerifiedInstalledResource {
    const entry = this.#byId.get(resourceId)
    if (!entry) throw new ResourceResolutionError('UNKNOWN_RESOURCE', resourceId, `resource is not installed: ${resourceId}`)
    if (entry.bytes > this.#maxResourceBytes) {
      throw new ResourceResolutionError('RESOURCE_SIZE_LIMIT', resourceId, `${entry.bytes} exceeds the ${this.#maxResourceBytes}-byte host limit`)
    }
    const licenseFd = this.#openSecureFile(entry, entry.license.noticePath, 'RESOURCE_LICENSE_NOTICE_MISSING')
    closeSync(licenseFd)
    const fd = this.#openSecureFile(entry, entry.path, 'RESOURCE_MISSING')
    let bytes: Uint8Array
    try {
      const before = fstatSync(fd)
      if (before.size !== entry.bytes) {
        throw new ResourceResolutionError('RESOURCE_SIZE_MISMATCH', resourceId, `declared ${entry.bytes} bytes but found ${before.size}`)
      }
      // Never let a pathname race turn a small declared resource into an
      // unbounded read. Read at most the declared bytes plus one sentinel.
      const bounded = new Uint8Array(entry.bytes + 1)
      let read = 0
      while (read < bounded.byteLength) {
        const count = readSync(fd, bounded, read, bounded.byteLength - read, null)
        if (count === 0) break
        read += count
      }
      const after = fstatSync(fd)
      if (read !== entry.bytes || after.size !== entry.bytes) {
        throw new ResourceResolutionError('RESOURCE_SIZE_MISMATCH', resourceId, `declared ${entry.bytes} bytes but securely read ${read}`)
      }
      bytes = bounded.slice(0, read)
    } finally {
      closeSync(fd)
    }
    const mediaType = this.#mediaTypes[entry.mediaType]
    if (!mediaType || !mediaType(bytes)) {
      throw new ResourceResolutionError('RESOURCE_MEDIA_TYPE_MISMATCH', resourceId, `resource bytes do not match ${entry.mediaType}`)
    }
    const actualDigest = sha256(bytes)
    if (actualDigest !== entry.sha256) {
      throw new ResourceResolutionError('RESOURCE_DIGEST_MISMATCH', resourceId, `expected ${entry.sha256}, received ${actualDigest}`)
    }
    const snapshot = bytes.slice()
    return Object.freeze({
      entry,
      readBytes: () => snapshot.slice(),
    })
  }

  verifyInstalled(): InstalledResourceVerification {
    const resources: VerifiedInstalledResource[] = []
    const diagnostics: OptionalResourceDiagnostic[] = []
    for (const entry of this.#manifest.resources) {
      try {
        resources.push(this.resolve(entry.identity.id))
      } catch (error) {
        if (!entry.required && error instanceof ResourceResolutionError && error.code === 'RESOURCE_MISSING') {
          diagnostics.push(Object.freeze({
            code: 'OPTIONAL_RESOURCE_MISSING',
            resourceId: entry.identity.id,
            message: error.message,
          }))
          continue
        }
        throw error
      }
    }
    return Object.freeze({
      resources: Object.freeze(resources),
      diagnostics: Object.freeze(diagnostics),
    })
  }
}
