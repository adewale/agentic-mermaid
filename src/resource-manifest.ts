import {
  createExtensionIdentity,
  type ExtensionCompatibility,
  type ExtensionIdentity,
  type ExtensionProvenance,
} from './shared/extension-identity.ts'

export const RESOURCE_MANIFEST_VERSION = 1 as const

export interface ResourceLicense {
  /** SPDX identifier or a stable project-local licence identifier. */
  readonly spdx: string
  /** POSIX path, relative to the installed package root, containing the notice. */
  readonly noticePath: string
}

export interface ResourceManifestEntry {
  readonly identity: ExtensionIdentity<'resource'>
  /** POSIX path relative to the installed package root. */
  readonly path: string
  /** Declared content type; a host must install an explicit verifier for it. */
  readonly mediaType: string
  readonly sha256: string
  readonly bytes: number
  readonly license: ResourceLicense
  readonly required: boolean
  /** Installed resources never fall back to an ambient network fetch. */
  readonly network: 'forbidden'
}

export interface ResourceManifest {
  readonly version: typeof RESOURCE_MANIFEST_VERSION
  readonly resources: readonly ResourceManifestEntry[]
}

export type ResourceMediaTypeVerifier = (bytes: Uint8Array) => boolean

interface ResourceManifestInspection {
  readonly errors: readonly string[]
  readonly snapshot?: ResourceManifest
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
  errors: string[],
): boolean {
  let valid = true
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue
    errors.push(`unknown ${label} field "${key}"`)
    valid = false
  }
  return valid
}

const MANIFEST_FIELDS = new Set(['version', 'resources'])
const RESOURCE_FIELDS = new Set(['identity', 'path', 'mediaType', 'sha256', 'bytes', 'license', 'required', 'network'])
const IDENTITY_FIELDS = new Set(['id', 'kind', 'version', 'compatibility', 'provenance'])
const PROVENANCE_FIELDS = new Set(['owner', 'source', 'reference'])
const LICENSE_FIELDS = new Set(['spdx', 'noticePath'])

function isSafeRelativePackagePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false
  const segments = path.split('/')
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function inspectExtensionIdentity(
  value: unknown,
  fallbackId: string,
  errors: string[],
): ExtensionIdentity<'resource'> | undefined {
  if (!isPlainRecord(value)) {
    errors.push(`missing resource identity: ${fallbackId}`)
    return undefined
  }

  const id = typeof value.id === 'string' ? value.id : fallbackId
  const kind = value.kind
  const version = value.version
  let valid = rejectUnknownFields(value, IDENTITY_FIELDS, 'resource identity', errors)
  if (typeof value.id !== 'string') {
    errors.push(`invalid resource identity id: ${fallbackId}`)
    valid = false
  }
  if (kind !== 'resource') {
    errors.push(`invalid resource identity kind: ${id}`)
    valid = false
  }
  if (typeof version !== 'string') {
    errors.push(`invalid resource identity version: ${id}`)
    valid = false
  }

  const compatibility: Record<string, string | undefined> = {}
  if (value.compatibility !== undefined) {
    if (!isPlainRecord(value.compatibility)) {
      errors.push(`invalid resource compatibility: ${id}`)
      valid = false
    } else {
      for (const [contract, range] of Object.entries(value.compatibility)) {
        if (range !== undefined && typeof range !== 'string') {
          errors.push(`invalid resource compatibility range "${contract}": ${id}`)
          valid = false
        } else {
          compatibility[contract] = range
        }
      }
    }
  }

  let provenance: ExtensionProvenance | undefined
  if (!isPlainRecord(value.provenance)) {
    errors.push(`missing resource provenance: ${id}`)
    valid = false
  } else {
    if (!rejectUnknownFields(value.provenance, PROVENANCE_FIELDS, 'resource provenance', errors)) valid = false
    const { owner, source, reference } = value.provenance
    if (typeof owner !== 'string' || typeof source !== 'string' || (reference !== undefined && typeof reference !== 'string')) {
      errors.push(`invalid resource provenance: ${id}`)
      valid = false
    } else {
      provenance = { owner, source, ...(reference === undefined ? {} : { reference }) }
    }
  }

  if (!valid || provenance === undefined || typeof version !== 'string') return undefined
  try {
    return createExtensionIdentity({
      id,
      kind: 'resource',
      version,
      compatibility: compatibility as ExtensionCompatibility,
      provenance,
    })
  } catch (error) {
    errors.push(`invalid resource identity: ${errorMessage(error)}`)
    return undefined
  }
}

function inspectResourceEntry(value: unknown, index: number, errors: string[]): ResourceManifestEntry | undefined {
  const fallbackId = `resource[${index}]`
  if (!isPlainRecord(value)) {
    errors.push(`resource entry must be a plain object: ${fallbackId}`)
    return undefined
  }

  const identity = inspectExtensionIdentity(value.identity, fallbackId, errors)
  const id = identity?.id ?? (isPlainRecord(value.identity) && typeof value.identity.id === 'string' ? value.identity.id : fallbackId)
  const path = value.path
  const mediaType = value.mediaType
  const sha256 = value.sha256
  const bytes = value.bytes
  const required = value.required
  const network = value.network
  let valid = identity !== undefined
  if (!rejectUnknownFields(value, RESOURCE_FIELDS, 'resource entry', errors)) valid = false

  if (typeof path !== 'string' || !isSafeRelativePackagePath(path)) {
    errors.push(`unsafe resource path: ${id}`)
    valid = false
  }
  if (typeof mediaType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(mediaType)) {
    errors.push(`invalid media type: ${id}`)
    valid = false
  }
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
    errors.push(`invalid sha256: ${id}`)
    valid = false
  }
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
    errors.push(`invalid byte size: ${id}`)
    valid = false
  }
  if (typeof required !== 'boolean') {
    errors.push(`invalid required status: ${id}`)
    valid = false
  }
  if (network !== 'forbidden') {
    errors.push(`resource permits network fallback: ${id}`)
    valid = false
  }

  const licenseValue = value.license
  let license: ResourceLicense | undefined
  if (!isPlainRecord(licenseValue)) {
    errors.push(`missing resource licence: ${id}`)
    valid = false
  } else {
    if (!rejectUnknownFields(licenseValue, LICENSE_FIELDS, 'resource licence', errors)) valid = false
    const spdx = licenseValue.spdx
    const noticePath = licenseValue.noticePath
    if (typeof spdx !== 'string' || spdx.trim() === '') {
      errors.push(`missing resource licence: ${id}`)
      valid = false
    }
    if (typeof noticePath !== 'string' || !isSafeRelativePackagePath(noticePath)) {
      errors.push(`unsafe resource licence path: ${id}`)
      valid = false
    }
    if (typeof spdx === 'string' && spdx.trim() !== '' && typeof noticePath === 'string' && isSafeRelativePackagePath(noticePath)) {
      license = Object.freeze({ spdx, noticePath })
    }
  }

  if (!valid || identity === undefined || license === undefined || typeof path !== 'string' || typeof mediaType !== 'string' || typeof sha256 !== 'string' || typeof bytes !== 'number' || typeof required !== 'boolean') {
    return undefined
  }
  return Object.freeze({ identity, path, mediaType, sha256, bytes, license, required, network: 'forbidden' })
}

function inspectResourceManifest(manifest: unknown): ResourceManifestInspection {
  const errors: string[] = []
  if (!isPlainRecord(manifest)) return { errors: Object.freeze(['resource manifest must be a plain object']) }
  rejectUnknownFields(manifest, MANIFEST_FIELDS, 'resource manifest', errors)
  if (manifest.version !== RESOURCE_MANIFEST_VERSION) errors.push(`unsupported resource manifest version: ${String(manifest.version)}`)
  if (!Array.isArray(manifest.resources)) {
    errors.push('resource manifest resources must be an array')
    return { errors: Object.freeze(errors) }
  }

  const ids = new Set<string>()
  const paths = new Set<string>()
  const resources: ResourceManifestEntry[] = []
  for (const [index, value] of manifest.resources.entries()) {
    const resource = inspectResourceEntry(value, index, errors)
    const record = isPlainRecord(value) ? value : undefined
    const identity = record && isPlainRecord(record.identity) ? record.identity : undefined
    const id = typeof identity?.id === 'string' ? identity.id : `resource[${index}]`
    const path = typeof record?.path === 'string' ? record.path : undefined
    if (ids.has(id)) errors.push(`duplicate resource id: ${id}`)
    if (path !== undefined && paths.has(path)) errors.push(`duplicate resource path: ${path}`)
    ids.add(id)
    if (path !== undefined) paths.add(path)
    if (resource !== undefined) resources.push(resource)
  }

  if (errors.length > 0) return { errors: Object.freeze(errors) }
  return {
    errors: Object.freeze([]),
    snapshot: Object.freeze({
      version: RESOURCE_MANIFEST_VERSION,
      resources: Object.freeze(resources),
    }),
  }
}

/** Validate JSON-like input without trusting compile-time ResourceManifest types. */
export function validateResourceManifest(manifest: unknown): string[] {
  return [...inspectResourceManifest(manifest).errors]
}

/**
 * Validate and defensively copy a manifest into the immutable representation
 * consumed by host resolvers. Caller mutation can never alter this snapshot.
 */
export function snapshotResourceManifest(manifest: unknown): ResourceManifest {
  const inspected = inspectResourceManifest(manifest)
  if (!inspected.snapshot) throw new TypeError(`INVALID_RESOURCE_MANIFEST: ${inspected.errors.join('; ')}`)
  return inspected.snapshot
}

export function isTrueTypeFont(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x00
    && bytes[1] === 0x01
    && bytes[2] === 0x00
    && bytes[3] === 0x00
}

export const BUILTIN_RESOURCE_MEDIA_TYPES: Readonly<Record<string, ResourceMediaTypeVerifier>> = Object.freeze({
  'font/ttf': isTrueTypeFont,
})

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

/** Browser/Worker byte verifier used by bundled in-memory resources. */
export async function verifyResourceBytes(
  entry: ResourceManifestEntry,
  bytes: Uint8Array,
  options: {
    readonly mediaTypes?: Readonly<Record<string, ResourceMediaTypeVerifier>>
    readonly digest?: (bytes: Uint8Array) => Promise<string>
  } = {},
): Promise<void> {
  if (bytes.byteLength !== entry.bytes) {
    throw new Error(`RESOURCE_SIZE_MISMATCH: ${entry.identity.id} declared ${entry.bytes} bytes but received ${bytes.byteLength}`)
  }
  const verifier = (options.mediaTypes ?? BUILTIN_RESOURCE_MEDIA_TYPES)[entry.mediaType]
  if (!verifier || !verifier(bytes)) throw new Error(`RESOURCE_MEDIA_TYPE_MISMATCH: ${entry.identity.id} is not ${entry.mediaType}`)
  const digest = options.digest ?? (async value => {
    if (!globalThis.crypto?.subtle) throw new Error('RESOURCE_DIGEST_UNAVAILABLE: Web Crypto SHA-256 is required')
    const copy = new Uint8Array(value.byteLength)
    copy.set(value)
    return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)))
  })
  const actual = await digest(bytes)
  if (actual !== entry.sha256) throw new Error(`RESOURCE_DIGEST_MISMATCH: ${entry.identity.id}`)
}
