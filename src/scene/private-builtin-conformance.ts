import type { StyleBackend } from './backend.ts'
import type { BackendConformanceReport } from './backend-conformance.ts'
import { primitiveCapabilityClaimKey, type PrimitiveCapabilityClaim } from './capabilities.ts'

interface CapturedBuiltin {
  readonly fields: readonly PropertyDescriptor[]
  readonly report: BackendConformanceReport
}

const proofs = new WeakMap<StyleBackend, CapturedBuiltin>()
const enrolled = new Set<string>()
const fields = ['id', 'capabilities', 'drawNode', 'render'] as const

/** The codec shares strings, while reconstructing fresh report objects. */
export function decodePrivateBuiltinReports(strings: readonly string[], value: unknown): unknown {
  if (typeof value === 'number') return strings[value]
  if (!Array.isArray(value)) return value
  if (value[0] === 'n') return value[1]
  if (value[0] === 'a') return value.slice(1).map(child => decodePrivateBuiltinReports(strings, child))
  const object: Record<string, unknown> = {}
  for (let index = 1; index < value.length; index += 2) {
    object[strings[value[index] as number]!] = decodePrivateBuiltinReports(strings, value[index + 1])
  }
  return object
}

export interface PackedPrivateBuiltinReport {
  readonly report: Omit<BackendConformanceReport, 'claims'>
  readonly rows: readonly (readonly [readonly string[], Readonly<Record<string, unknown>>])[]
}

/** Value compression only: execution supplies every status and observation.
 * Claim identity and declared limitations already exist in immutable claims. */
export function privateBuiltinClaimTemplate(claim: PrimitiveCapabilityClaim, fixtureId: string): Record<string, unknown> {
  return { claimKey: primitiveCapabilityClaimKey(claim), target: claim.target, primitive: claim.primitive,
    feature: claim.feature, operation: claim.operation, realization: claim.realization,
    ...(claim.diagnostic ? { limitation: claim.diagnostic } : {}),
    witnessId: `${fixtureId}/${claim.primitive}/${claim.feature}/${claim.operation}` }
}

export function restorePrivateBuiltinReport(packed: PackedPrivateBuiltinReport, capabilities: readonly PrimitiveCapabilityClaim[]): BackendConformanceReport {
  if (packed.rows.length !== capabilities.length) throw new Error('Private built-in certificate claim count changed')
  const claims = packed.rows.map(([removed, changed], index) => {
    const row = privateBuiltinClaimTemplate(capabilities[index]!, packed.report.fixtureId)
    for (const key of removed) delete row[key]
    return { ...row, ...changed }
  })
  return { ...packed.report, claims } as unknown as BackendConformanceReport
}

function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child)
    Object.freeze(value)
  }
  return value
}

/** Used only by the private build, immediately after a built-in's declaration.
 * No backend implementation is imported here: optional backends stay lazy. */
export function capturePrivateBuiltinConformance(backend: StyleBackend, report: BackendConformanceReport): void {
  const descriptors = fields.map(field => Object.getOwnPropertyDescriptor(backend, field))
  if (descriptors.some(descriptor => !descriptor || !('value' in descriptor))) {
    throw new Error('Private built-in conformance requires original data properties')
  }
  const captured = descriptors as PropertyDescriptor[]
  const id = captured[0]!.value as string
  const capabilities = captured[1]!.value as StyleBackend['capabilities']
  if (enrolled.has(id) || report.backendId !== `backend:${id}` || report.passed !== true
    || typeof captured[2]!.value !== 'function' || typeof captured[3]!.value !== 'function'
    || !Array.isArray(capabilities) || !Object.isFrozen(capabilities)
    || capabilities.some(claim => !Object.isFrozen(claim))) {
    throw new Error('Private built-in conformance certificate does not match its owner')
  }
  enrolled.add(id)
  proofs.set(backend, { fields: captured, report: immutable(report) })
}

/** Called before the canonical registry wraps methods and snapshots claims.
 * Unknown objects are rejected before reading any of their properties. */
export function requirePrivateBuiltinConformance(backend: StyleBackend): BackendConformanceReport {
  const proof = proofs.get(backend)
  if (!proof || fields.some((field, index) => {
    const current = Object.getOwnPropertyDescriptor(backend, field)
    const original = proof.fields[index]!
    return !current || !('value' in current) || current.value !== original.value
      || current.enumerable !== original.enumerable || current.configurable !== original.configurable
      || current.writable !== original.writable
  })) throw new Error('Private built-in implementation changed after certification')
  return proof.report
}
