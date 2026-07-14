/** Versioned, deterministic capability negotiation for hosts and receipts. */

import { RENDER_OUTPUTS } from './render-outputs.ts'

export const CAPABILITY_NEGOTIATION_VERSION = 1 as const

export type CapabilityId = `${string}:${string}`
export type CapabilityRequirementLevel = 'required' | 'preferred' | 'optional'

export interface CapabilityOffer {
  id: CapabilityId
  version: string
}

export interface CapabilityRequirement {
  id: CapabilityId
  range: string
  level: CapabilityRequirementLevel
}

export interface CapabilityResolution {
  id: CapabilityId
  range: string
  level: CapabilityRequirementLevel
  status: 'selected' | 'unsupported' | 'incompatible'
  version?: string
}

export interface CapabilityDecision {
  version: typeof CAPABILITY_NEGOTIATION_VERSION
  accepted: boolean
  resolutions: readonly CapabilityResolution[]
}

const CAPABILITY_ID_RE = /^[a-z][a-z0-9.-]*:[a-z0-9][a-z0-9._/-]*$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const CAPABILITY_REQUIREMENT_LEVELS = new Set<unknown>(['required', 'preferred', 'optional'])

interface SemVer { major: string; minor: string; patch: string; prerelease?: string }

export function isCapabilityId(value: string): value is CapabilityId {
  return CAPABILITY_ID_RE.test(value)
}

export function parseSemVer(value: string): SemVer | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.match(SEMVER_RE)
  if (!match) return undefined
  const prerelease = match[4]
  if (prerelease?.split('.').some(identifier => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    return undefined
  }
  return {
    // SemVer numeric identifiers have arbitrary precision. Keep their canonical
    // digit spelling instead of passing through Number and aliasing distinct
    // versions above Number.MAX_SAFE_INTEGER.
    major: match[1]!, minor: match[2]!, patch: match[3]!,
    ...(prerelease ? { prerelease } : {}),
  }
}

function compareNumericIdentifier(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return left === right ? 0 : left < right ? -1 : 1
}

function compare(left: SemVer, right: SemVer): number {
  return compareNumericIdentifier(left.major, right.major)
    || compareNumericIdentifier(left.minor, right.minor)
    || compareNumericIdentifier(left.patch, right.patch)
}

export function isSupportedSemVerRange(range: unknown): boolean {
  if (typeof range !== 'string') return false
  const trimmed = range.trim()
  if (trimmed === '*' || /^(0|[1-9]\d*)\.(?:x|\*)$/i.test(trimmed)) return true
  const operator = trimmed.match(/^(\^|~|>=)?(.+)$/)
  const expected = parseSemVer(operator?.[2] ?? '')
  if (!operator || !expected) return false
  // Keep prerelease semantics deliberately narrow and deterministic: an
  // extension may negotiate its exact prerelease identity, but ranges over
  // prereleases are outside this small public language.
  return !expected.prerelease || operator[1] === undefined
}

/** Deliberately small public range language: exact, ^, ~, >=, major.x, or *. */
export function semVerSatisfies(version: string, range: string): boolean {
  const actual = parseSemVer(version)
  if (!actual || !isSupportedSemVerRange(range)) return false
  const trimmed = range.trim()
  if (trimmed === '*') return actual.prerelease === undefined
  const wildcard = trimmed.match(/^(0|[1-9]\d*)\.(?:x|\*)$/i)
  if (wildcard) return actual.prerelease === undefined && actual.major === wildcard[1]
  const operator = trimmed.match(/^(\^|~|>=)?(.+)$/)
  const expected = parseSemVer(operator?.[2] ?? '')
  if (!operator || !expected) return false
  const relation = compare(actual, expected)
  if (actual.prerelease || expected.prerelease) {
    return operator[1] === undefined
      && relation === 0
      && actual.prerelease === expected.prerelease
  }
  switch (operator[1]) {
    case '>=': return relation >= 0
    case '~': return relation >= 0 && actual.major === expected.major && actual.minor === expected.minor
    case '^':
      if (relation < 0) return false
      if (expected.major !== '0') return actual.major === expected.major
      if (expected.minor !== '0') return actual.major === '0' && actual.minor === expected.minor
      return actual.major === '0' && actual.minor === '0' && actual.patch === expected.patch
    default: return relation === 0
  }
}

export function negotiateCapabilities(
  offers: readonly CapabilityOffer[],
  requirements: readonly CapabilityRequirement[],
): CapabilityDecision {
  if (!Array.isArray(offers)) throw new TypeError('Capability offers must be an array')
  if (!Array.isArray(requirements)) throw new TypeError('Capability requirements must be an array')
  const offered = new Map<CapabilityId, string>()
  for (const [index, offer] of offers.entries()) {
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) {
      throw new TypeError(`Capability offer at index ${index} must be an object`)
    }
    if (typeof offer.id !== 'string') throw new Error(`Invalid capability id "${String(offer.id)}"`)
    if (!isCapabilityId(offer.id)) throw new Error(`Invalid capability id "${offer.id}"`)
    if (typeof offer.version !== 'string') throw new Error(`Capability "${offer.id}" has invalid semantic version "${String(offer.version)}"`)
    if (!parseSemVer(offer.version)) throw new Error(`Capability "${offer.id}" has invalid semantic version "${offer.version}"`)
    if (offered.has(offer.id)) throw new Error(`Duplicate capability offer "${offer.id}"`)
    offered.set(offer.id, offer.version)
  }
  const seen = new Set<CapabilityId>()
  const resolutions = requirements.map((requirement, index) => {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      throw new TypeError(`Capability requirement at index ${index} must be an object`)
    }
    if (typeof requirement.id !== 'string') throw new Error(`Invalid capability id "${String(requirement.id)}"`)
    if (!isCapabilityId(requirement.id)) throw new Error(`Invalid capability id "${requirement.id}"`)
    if (!CAPABILITY_REQUIREMENT_LEVELS.has(requirement.level)) {
      throw new Error(`Capability "${requirement.id}" has invalid requirement level "${String(requirement.level)}"`)
    }
    if (!isSupportedSemVerRange(requirement.range)) {
      throw new Error(`Capability "${requirement.id}" has invalid semantic-version range "${String(requirement.range)}"`)
    }
    if (seen.has(requirement.id)) throw new Error(`Duplicate capability requirement "${requirement.id}"`)
    seen.add(requirement.id)
    const version = offered.get(requirement.id)
    const status: CapabilityResolution['status'] = version === undefined
      ? 'unsupported'
      : semVerSatisfies(version, requirement.range) ? 'selected' : 'incompatible'
    return Object.freeze({
      id: requirement.id,
      range: requirement.range,
      level: requirement.level,
      status,
      ...(version !== undefined ? { version } : {}),
    })
  })
  const accepted = resolutions.every(result => result.level !== 'required' || result.status === 'selected')
  return Object.freeze({
    version: CAPABILITY_NEGOTIATION_VERSION,
    accepted,
    resolutions: Object.freeze(resolutions),
  })
}

/** Built-in waist offers. Output and Scene support are tuple-specific: they
 * are offered by execution planning only after the selected family/hooks and
 * backend form a complete path. Unknown optional requirements are grease by
 * design. */
export const CORE_CAPABILITY_OFFERS: readonly CapabilityOffer[] = Object.freeze(([
  { id: 'core:render-request', version: '1.0.0' },
  { id: 'core:family-descriptor', version: '1.0.0' },
] satisfies CapabilityOffer[]).map(offer => Object.freeze(offer)))

export interface RenderCapabilityTuple {
  /** Offers proved by the exact family/backend snapshot selected for execution. */
  readonly offers: readonly CapabilityOffer[]
  /** Hook/backend requirements for this particular family/output path. */
  readonly requirements: readonly CapabilityRequirement[]
  /** Whether the complete tuple can expose the requested logical output. */
  readonly outputAvailable: boolean
}

function negotiateRenderCapabilitySet(
  output: string,
  offers: readonly CapabilityOffer[],
  requirements: readonly CapabilityRequirement[],
  outputAvailable: boolean,
): CapabilityDecision {
  const outputOffer: CapabilityOffer = {
    id: `output:${output}` as CapabilityId,
    version: '1.0.0',
  }
  const knownOutput = (RENDER_OUTPUTS as readonly string[]).includes(output)
  return negotiateCapabilities(
    [
      ...CORE_CAPABILITY_OFFERS,
      ...offers,
      ...(!knownOutput || !outputAvailable ? [] : [outputOffer]),
    ],
    [
      { id: 'core:render-request', range: '^1.0.0', level: 'required' },
      ...requirements,
      { id: `output:${output}` as CapabilityId, range: '^1.0.0', level: 'required' },
    ],
  )
}

/** Public compatibility negotiation over the nominal render waist. Runtime
 * execution uses negotiateRenderCapabilityTuple() with proved hooks/backend. */
export function negotiateRenderCapabilities(
  output: string,
  family?: CapabilityOffer,
): CapabilityDecision {
  return negotiateRenderCapabilitySet(
    output,
    family ? [family] : [],
    family ? [{ id: family.id, range: family.version, level: 'required' }] : [],
    true,
  )
}

/** Internal exact-tuple negotiation used by immutable execution planning. */
export function negotiateRenderCapabilityTuple(
  output: string,
  tuple: RenderCapabilityTuple,
): CapabilityDecision {
  return negotiateRenderCapabilitySet(
    output,
    tuple.offers,
    tuple.requirements,
    tuple.outputAvailable,
  )
}
