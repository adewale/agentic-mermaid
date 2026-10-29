/** Runtime admission checks for the Scene contract.
 *
 * Validation is deliberately non-mutating. Built-in lowerings carry a
 * canonical backend-private projection; external family scenes receive stricter containment,
 * reference, and non-fetching checks before a backend can observe them.
 */

import { assertInertGroup } from './group-emission.ts'
import { isRetainedPixelText } from '../shared/prepared-text.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { applyOutputSecurityPolicy } from '../output-security.ts'
import { safeCssPaint } from '../shared/css-color.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import { parseExtensionId } from '../shared/extension-identity.ts'
import { hasDomSvgIdentityRole } from './identity.ts'
import type {
  Geometry,
  ConnectorMark,
  LinearGradientDescriptor,
  MarkPaint,
  MarkerDescriptor,
  SceneDoc,
  SceneNode,
  SceneRole,
  SemanticChannels,
  SceneOwner,
} from './ir.ts'
import { deriveConnectorTerminalProjection } from './connector-terminal.ts'
import { deferredTerminalProjectionInput } from './deferred-terminal-projection.ts'
import {
  connectorContourSemantics,
  connectorEndpointAnchors,
  connectorGeometryHasCurves,
  sameConnectorPoint,
} from './connector-geometry.ts'
import { assertRenderableMarker, serializeMarkerResources } from './marker-resources.ts'
import { assertRenderableLinearGradient, LINEAR_GRADIENT_LIMITS, serializeLinearGradientResources } from './gradient-resources.ts'
import { BUILTIN_SCENE_ROLE_TRAITS, sceneRoleTraits } from './roles.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { inspectSvgOnce } from '../svg-inspection-cache.ts'
import { canonicalizeSceneNodeSerialization, sceneNodeSerialization } from './serialization.ts'
import { MARK_CLASS_TOKENS, MARK_DATA_KEY, WRITER_OWNED_DATA_KEYS } from './svg-writer.ts'

export const SCENE_VALIDATION_VERSION = 2 as const
export const SCENE_VALIDATION_LIMITS = Object.freeze({
  maxExtent: 1_000_000,
  maxNodes: 100_000,
  maxDepth: 64,
  maxTextLength: 1_000_000,
  maxTextBytes: 2_000_000,
  maxPoints: 50_000,
  maxSerializationBytesPerNode: 5_000_000,
  maxAggregateSerializationBytes: 16_000_000,
  maxFinalSvgBytes: 8_000_000,
} as const)

export type SceneValidationDiagnosticCode =
  | 'SCENE_DOCUMENT'
  | 'SCENE_FINITE'
  | 'SCENE_BOUNDS'
  | 'SCENE_ID'
  | 'SCENE_ROLE'
  | 'SCENE_PAINT'
  | 'SCENE_MARKER'
  | 'SCENE_REFERENCE'
  | 'SCENE_SECURITY'
  | 'SCENE_FIDELITY'
  | 'SCENE_PRIMITIVE_CLAIM'
  | 'SCENE_CHANNEL_CLAIM'

export interface SceneValidationDiagnostic {
  readonly code: SceneValidationDiagnosticCode
  readonly path: string
  readonly message: string
}

export interface SceneValidationResult {
  readonly valid: boolean
  readonly diagnostics: readonly SceneValidationDiagnostic[]
}

export interface SceneValidationOptions {
  /** `auto` applies strict rules to a valid `family:*` document id. */
  readonly mode?: 'auto' | 'internal' | 'external'
}

export class SceneValidationError extends Error {
  readonly code = 'SCENE_VALIDATION_FAILED'

  constructor(readonly diagnostics: readonly SceneValidationDiagnostic[]) {
    super(`Scene validation failed: ${diagnostics.map(item => `${item.path}: ${item.message}`).join('; ')}`)
    this.name = 'SceneValidationError'
  }
}

const MAX_SCENE_EXTENT = SCENE_VALIDATION_LIMITS.maxExtent
const MAX_SCENE_NODES = SCENE_VALIDATION_LIMITS.maxNodes
const MAX_SCENE_DEPTH = SCENE_VALIDATION_LIMITS.maxDepth
const MAX_TEXT_LENGTH = SCENE_VALIDATION_LIMITS.maxTextLength
const MAX_TEXT_BYTES = SCENE_VALIDATION_LIMITS.maxTextBytes
const MAX_SCENE_POINTS = SCENE_VALIDATION_LIMITS.maxPoints
const MAX_SERIALIZATION_BYTES_PER_NODE = SCENE_VALIDATION_LIMITS.maxSerializationBytesPerNode
const MAX_AGGREGATE_SERIALIZATION_BYTES = SCENE_VALIDATION_LIMITS.maxAggregateSerializationBytes
const MAX_FINAL_SVG_BYTES = SCENE_VALIDATION_LIMITS.maxFinalSvgBytes
const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/
const NAMESPACED_ROLE = /^[a-z0-9][a-z0-9._/-]*:[a-z0-9][a-z0-9._/-]*$/i
const SAFE_DASH = /^(?:none|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?(?:[\s,]+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)*)$/
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const NUMERIC_CSS_LENGTH = /^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)(?:px)?$/
const NUMERIC_CSS_VALUE = /^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/
const NUMERIC_CSS_REFERENCE = /^var\(--[a-z0-9_-]+(?:,\s*[-+]?\d*\.?\d+)?\)$/i
const SVG_PATH_COMMANDS = 'MmLlHhVvCcSsQqTtAaZz'
const SVG_PATH_ARITY: Readonly<Record<string, number>> = Object.freeze({
  M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1,
  C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2,
  A: 7, a: 7, Z: 0, z: 0,
})
const SVG_PATH_NUMBER = /[-+]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][-+]?\d+)?/y
const PAINT_FIELDS = [
  'fill', 'stroke', 'strokeWidth', 'strokeDasharray', 'strokeDashoffset',
  'strokeLinecap', 'strokeLinejoin', 'strokeMiterlimit', 'vectorEffect',
  'paintOrder', 'opacity',
] as const

type MutableDiagnostic = SceneValidationDiagnostic

/** Enforce the one post-backend/family SVG artifact budget without allocating
 * an encoded copy. Callers apply this both before and after SVG transforms so
 * neither extension output nor namespace/accessibility expansion can bypass it. */
export function assertFinalSvgByteBudget(value: unknown, stage = 'final SVG'): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${stage} must be a string`)
  // A UTF-16 code unit encodes to at most three UTF-8 bytes, so a string this
  // short is within the budget without counting.
  if (value.length * 3 <= MAX_FINAL_SVG_BYTES) return
  if (!inspectSvgOnce('final-svg-budget', value, () => boundedUtf8ByteLength(value, MAX_FINAL_SVG_BYTES) <= MAX_FINAL_SVG_BYTES)) {
    throw new RangeError(`${stage} exceeds the ${MAX_FINAL_SVG_BYTES}-byte final SVG limit`)
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function add(
  diagnostics: MutableDiagnostic[],
  code: SceneValidationDiagnosticCode,
  path: string,
  message: string,
): void {
  diagnostics.push({ code, path, message })
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  diagnostics: MutableDiagnostic[],
): void {
  const allow = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allow.has(key)) add(diagnostics, 'SCENE_DOCUMENT', `${path}.${key}`, 'is not part of the external Scene contract')
  }
}

/** Parse the SVG path command stream rather than merely allowlisting its
 * characters. External Scene paths must have complete command groups, finite
 * bounded numbers, legal arc flags, and an initial moveto. A caller that has
 * only one typed point sequence can additionally forbid ambiguous subpaths. */
function svgPathDataProblem(value: string, singleSubpath = false): string | undefined {
  let index = 0
  let activeCommand: string | undefined
  let sawCommand = false
  let parameterSets = 0
  const skipSeparators = (): void => {
    while (index < value.length && (value[index] === ',' || /\s/.test(value[index]!))) index++
  }
  const commandAtCursor = (): string | undefined => {
    const candidate = value[index]
    return candidate !== undefined && SVG_PATH_COMMANDS.includes(candidate) ? candidate : undefined
  }
  const finiteNumber = (): string | undefined => {
    skipSeparators()
    SVG_PATH_NUMBER.lastIndex = index
    const match = SVG_PATH_NUMBER.exec(value)
    if (!match) return 'expected a numeric path parameter'
    index = SVG_PATH_NUMBER.lastIndex
    const parsed = Number(match[0])
    if (!Number.isFinite(parsed)) return `path parameter ${match[0]} is not finite`
    if (Math.abs(parsed) > MAX_SCENE_EXTENT) return `path parameter ${match[0]} exceeds ${MAX_SCENE_EXTENT} user units`
    return undefined
  }

  while (true) {
    skipSeparators()
    if (index >= value.length) break
    const nextCommand = commandAtCursor()
    if (nextCommand !== undefined) {
      activeCommand = nextCommand
      index++
      if (!sawCommand && activeCommand !== 'M' && activeCommand !== 'm') {
        return 'must start with an M or m moveto command'
      }
      if (sawCommand && singleSubpath && (activeCommand === 'M' || activeCommand === 'm')) {
        return 'multiple moveto subpaths require typed subpath geometry'
      }
      sawCommand = true
      if (activeCommand === 'Z' || activeCommand === 'z') {
        activeCommand = undefined
        continue
      }
    } else if (activeCommand === undefined) {
      return 'path parameters must follow a command'
    }

    const arity = SVG_PATH_ARITY[activeCommand]
    if (arity === undefined || arity === 0) return `unknown path command ${String(activeCommand)}`
    let groups = 0
    while (true) {
      skipSeparators()
      if (index >= value.length || commandAtCursor() !== undefined) {
        if (groups === 0) return `command ${activeCommand} requires ${arity} parameters`
        break
      }
      for (let parameter = 0; parameter < arity; parameter++) {
        skipSeparators()
        if (index >= value.length || commandAtCursor() !== undefined) {
          return `command ${activeCommand} ended before its ${arity}-parameter group was complete`
        }
        if ((activeCommand === 'A' || activeCommand === 'a') && (parameter === 3 || parameter === 4)) {
          // Arc flags are one grammar character each. Reading them separately
          // also supports SVG's legal compact spelling `01`.
          const flag = value[index]
          if (flag !== '0' && flag !== '1') return `command ${activeCommand} arc flags must be 0 or 1`
          index++
        } else {
          const problem = finiteNumber()
          if (problem) return problem
        }
      }
      groups++
      if (++parameterSets > MAX_SCENE_POINTS) return `contains more than ${MAX_SCENE_POINTS} path parameter groups`
    }
  }
  return sawCommand ? undefined : 'must contain an M or m moveto command'
}

function finite(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  options: { positive?: boolean; nonNegative?: boolean } = {},
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    add(diagnostics, 'SCENE_FINITE', path, 'must be a finite number')
    return false
  }
  if (options.positive && value <= 0) add(diagnostics, 'SCENE_BOUNDS', path, 'must be positive')
  if (options.nonNegative && value < 0) add(diagnostics, 'SCENE_BOUNDS', path, 'must be non-negative')
  if (Math.abs(value) > MAX_SCENE_EXTENT) add(diagnostics, 'SCENE_BOUNDS', path, `must not exceed ${MAX_SCENE_EXTENT} user units`)
  return true
}

function boundedString(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  options: { empty?: boolean; max?: number; externalId?: boolean } = {},
): value is string {
  if (typeof value !== 'string') {
    add(diagnostics, 'SCENE_ID', path, 'must be a string')
    return false
  }
  if (!options.empty && value.length === 0) add(diagnostics, 'SCENE_ID', path, 'must not be empty')
  if (value.length > (options.max ?? 256)) add(diagnostics, 'SCENE_ID', path, 'is too long')
  if (CONTROL_CHARACTER.test(value)) add(diagnostics, 'SCENE_ID', path, 'contains a control character')
  if (options.externalId && !EXTERNAL_ID.test(value)) add(diagnostics, 'SCENE_ID', path, 'must use the safe external id grammar')
  return true
}

function numericCss(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  options: { nonNegative?: boolean; unitInterval?: boolean; length?: boolean } = {},
): void {
  if (value === undefined) return
  if (typeof value !== 'string' && typeof value !== 'number') {
    add(diagnostics, 'SCENE_PAINT', path, 'must be a finite numeric value')
    return
  }
  const text = typeof value === 'string' ? value.trim() : undefined
  const numericMatch = text?.match(options.length ? NUMERIC_CSS_LENGTH : NUMERIC_CSS_VALUE)
  const parsed = typeof value === 'number' ? value : numericMatch ? Number(numericMatch[1]) : Number.NaN
  if (!Number.isFinite(parsed)) {
    if (typeof value === 'string' && NUMERIC_CSS_REFERENCE.test(value.trim())) return
    add(diagnostics, 'SCENE_PAINT', path, `must be a finite number or safe numeric custom-property reference (received ${JSON.stringify(value)})`)
  } else if (options.nonNegative && parsed < 0) {
    add(diagnostics, 'SCENE_PAINT', path, 'must be non-negative')
  } else if (options.unitInterval && (parsed < 0 || parsed > 1)) {
    add(diagnostics, 'SCENE_PAINT', path, 'must be in [0,1]')
  }
}

function validatePaint(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  external = false,
): void {
  if (!record(value)) {
    add(diagnostics, 'SCENE_PAINT', path, 'must be a paint object')
    return
  }
  if (external) rejectUnknownKeys(value, PAINT_FIELDS, path, diagnostics)
  for (const key of ['fill', 'stroke'] as const) {
    const paint = value[key]
    const localResource = localPaintResourceId(paint)
    if (paint !== undefined && safeCssPaint(paint) === undefined && (external || !localResource)) {
      add(diagnostics, 'SCENE_PAINT', `${path}.${key}`, 'must be a safe non-fetching CSS paint')
    }
  }
  numericCss(value.strokeWidth, `${path}.strokeWidth`, diagnostics, { nonNegative: true, length: true })
  numericCss(value.strokeDashoffset, `${path}.strokeDashoffset`, diagnostics, { length: true })
  numericCss(value.strokeMiterlimit, `${path}.strokeMiterlimit`, diagnostics, { nonNegative: true })
  numericCss(value.opacity, `${path}.opacity`, diagnostics, { unitInterval: true })
  numericCss(value.fillOpacity, `${path}.fillOpacity`, diagnostics, { unitInterval: true })
  numericCss(value.strokeOpacity, `${path}.strokeOpacity`, diagnostics, { unitInterval: true })
  if (value.strokeDasharray !== undefined && (typeof value.strokeDasharray !== 'string' || !SAFE_DASH.test(value.strokeDasharray.trim()))) {
    add(diagnostics, 'SCENE_PAINT', `${path}.strokeDasharray`, 'must be "none" or a finite numeric dash list')
  }
  if (value.strokeLinecap !== undefined && !['butt', 'round', 'square'].includes(String(value.strokeLinecap))) {
    add(diagnostics, 'SCENE_PAINT', `${path}.strokeLinecap`, 'must be butt, round, or square')
  }
  if (value.strokeLinejoin !== undefined && !['arcs', 'bevel', 'miter', 'miter-clip', 'round'].includes(String(value.strokeLinejoin))) {
    add(diagnostics, 'SCENE_PAINT', `${path}.strokeLinejoin`, 'must be arcs, bevel, miter, miter-clip, or round')
  }
  if (value.vectorEffect !== undefined && !['none', 'non-scaling-stroke'].includes(String(value.vectorEffect))) {
    add(diagnostics, 'SCENE_PAINT', `${path}.vectorEffect`, 'must be none or non-scaling-stroke')
  }
  if (value.paintOrder !== undefined) {
    const tokens = typeof value.paintOrder === 'string'
      ? value.paintOrder.trim().split(/\s+/).filter(Boolean).map(token => token.toLowerCase())
      : []
    const valid = (tokens.length === 1 && tokens[0] === 'normal')
      || (tokens.length >= 1
        && tokens.length <= 3
        && new Set(tokens).size === tokens.length
        && tokens.every(token => ['fill', 'stroke', 'markers'].includes(token)))
    if (!valid) add(diagnostics, 'SCENE_PAINT', `${path}.paintOrder`, 'must be normal or one to three unique fill, stroke, and markers keywords')
  }
}

/** Writer hooks: class tokens and data-* strings, with writer-owned keys
 * reserved (see svg-writer.ts). */
function validateMarkAttributes(value: unknown, path: string, diagnostics: MutableDiagnostic[]): void {
  if (!record(value)) {
    add(diagnostics, 'SCENE_DOCUMENT', path, 'must be an attribute hook object')
    return
  }
  rejectUnknownKeys(value, ['className', 'data', 'ariaHidden', 'tabIndex', 'ariaLabel'], path, diagnostics)
  if (value.className !== undefined && (typeof value.className !== 'string' || !MARK_CLASS_TOKENS.test(value.className))) {
    add(diagnostics, 'SCENE_DOCUMENT', `${path}.className`, 'must be space-separated CSS class tokens')
  }
  if (value.ariaHidden !== undefined && value.ariaHidden !== true) add(diagnostics, 'SCENE_DOCUMENT', `${path}.ariaHidden`, 'must be true when present')
  if (value.tabIndex !== undefined && value.tabIndex !== 0) add(diagnostics, 'SCENE_DOCUMENT', `${path}.tabIndex`, 'must be 0 when present')
  if (value.ariaLabel !== undefined) boundedString(value.ariaLabel, `${path}.ariaLabel`, diagnostics, { max: MAX_TEXT_LENGTH })
  if (value.data === undefined) return
  if (!record(value.data)) {
    add(diagnostics, 'SCENE_DOCUMENT', `${path}.data`, 'must be a string record')
    return
  }
  for (const [key, item] of Object.entries(value.data)) {
    if (!MARK_DATA_KEY.test(key) || WRITER_OWNED_DATA_KEYS.has(key)) add(diagnostics, 'SCENE_DOCUMENT', `${path}.data.${key}`, 'must be a family data-* key the writer does not own')
    boundedString(item, `${path}.data.${key}`, diagnostics, { empty: true, max: MAX_TEXT_LENGTH })
  }
}

function localPaintResourceId(value: unknown): string | undefined {
  const match = typeof value === 'string'
    ? /^url\(#([A-Za-z_][A-Za-z0-9_.:-]*)\)$/.exec(value.trim())
    : null
  return match?.[1]
}

interface ValidationBudget {
  textBytes: number
  serializationBytes: number
  points: number
  textExceeded: boolean
  serializationExceeded: boolean
  pointsExceeded: boolean
  readonly pointCollections: WeakSet<object>
}

function consumeStringBudget(
  budget: ValidationBudget | undefined,
  field: 'textBytes' | 'serializationBytes',
  exceededField: 'textExceeded' | 'serializationExceeded',
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  maximum: number,
  label: string,
): void {
  if (!budget || typeof value !== 'string' || budget[exceededField]) return
  const remaining = Math.max(0, maximum - budget[field])
  const bytes = boundedUtf8ByteLength(value, remaining)
  if (bytes > remaining) {
    budget[field] = maximum + 1
    budget[exceededField] = true
    add(diagnostics, 'SCENE_BOUNDS', path, `${label} exceed the aggregate ${maximum}-byte limit`)
  } else {
    budget[field] += bytes
  }
}

function consumePointBudget(
  budget: ValidationBudget | undefined,
  path: string,
  diagnostics: MutableDiagnostic[],
): void {
  if (!budget || budget.pointsExceeded) return
  if (++budget.points > MAX_SCENE_POINTS) {
    budget.pointsExceeded = true
    add(diagnostics, 'SCENE_BOUNDS', path, `Scene points exceed the aggregate ${MAX_SCENE_POINTS}-point limit`)
  }
}

function validatePoint(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  budget?: ValidationBudget,
  external = false,
): void {
  if (!record(value)) {
    add(diagnostics, 'SCENE_FINITE', path, 'must be a point object')
    return
  }
  if (external) rejectUnknownKeys(value, ['x', 'y'], path, diagnostics)
  consumePointBudget(budget, path, diagnostics)
  finite(value.x, `${path}.x`, diagnostics)
  finite(value.y, `${path}.y`, diagnostics)
}

function validateUnitVector(value: unknown, path: string, diagnostics: MutableDiagnostic[]): void {
  if (!record(value) || typeof value.x !== 'number' || typeof value.y !== 'number') return
  const length = Math.hypot(value.x, value.y)
  if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-9) {
    add(diagnostics, 'SCENE_FINITE', path, 'must be a finite unit vector')
  }
}

function validatePoints(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  minimum: number,
  budget?: ValidationBudget,
  external = false,
): void {
  if (!Array.isArray(value)) {
    add(diagnostics, 'SCENE_FINITE', path, 'must be an array of points')
    return
  }
  // Shared arrays still have to satisfy each primitive's own minimum.
  if (value.length < minimum) add(diagnostics, 'SCENE_BOUNDS', path, `must contain at least ${minimum} points`)
  if (budget?.pointCollections.has(value)) return
  budget?.pointCollections.add(value)
  if (value.length > MAX_SCENE_NODES) add(diagnostics, 'SCENE_BOUNDS', path, 'contains too many points')
  const count = Math.min(value.length, MAX_SCENE_NODES, budget ? Math.max(0, MAX_SCENE_POINTS - budget.points + 1) : MAX_SCENE_NODES)
  for (let index = 0; index < count; index++) validatePoint(value[index], `${path}[${index}]`, diagnostics, budget, external)
}

function validateGeometry(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  marker = false,
  depth = 0,
  budget?: ValidationBudget,
  external = false,
): void {
  if (depth > MAX_SCENE_DEPTH) {
    add(diagnostics, 'SCENE_BOUNDS', path, `geometry exceeds maximum nesting depth ${MAX_SCENE_DEPTH}`)
    return
  }
  if (!record(value) || typeof value.kind !== 'string') {
    add(diagnostics, 'SCENE_DOCUMENT', path, 'must be a typed geometry object')
    return
  }
  if (external) {
    const fields: Readonly<Record<string, readonly string[]>> = {
      rect: ['kind', 'x', 'y', 'width', 'height', 'rx', 'ry'],
      circle: ['kind', 'cx', 'cy', 'r'],
      ellipse: ['kind', 'cx', 'cy', 'rx', 'ry'],
      line: ['kind', 'x1', 'y1', 'x2', 'y2'],
      polygon: ['kind', 'points'],
      polyline: ['kind', 'points'],
      path: ['kind', 'd', 'points'],
      compound: ['kind', 'children'],
    }
    const allowed = fields[value.kind]
    if (allowed) rejectUnknownKeys(value, allowed, path, diagnostics)
  }
  switch (value.kind) {
    case 'rect':
      finite(value.x, `${path}.x`, diagnostics); finite(value.y, `${path}.y`, diagnostics)
      finite(value.width, `${path}.width`, diagnostics, { nonNegative: true })
      finite(value.height, `${path}.height`, diagnostics, { nonNegative: true })
      if (value.rx !== undefined) finite(value.rx, `${path}.rx`, diagnostics, { nonNegative: true })
      if (value.ry !== undefined) finite(value.ry, `${path}.ry`, diagnostics, { nonNegative: true })
      return
    case 'circle':
      finite(value.cx, `${path}.cx`, diagnostics); finite(value.cy, `${path}.cy`, diagnostics)
      finite(value.r, `${path}.r`, diagnostics, { nonNegative: true })
      return
    case 'ellipse':
      finite(value.cx, `${path}.cx`, diagnostics); finite(value.cy, `${path}.cy`, diagnostics)
      finite(value.rx, `${path}.rx`, diagnostics, { nonNegative: true })
      finite(value.ry, `${path}.ry`, diagnostics, { nonNegative: true })
      return
    case 'line':
      finite(value.x1, `${path}.x1`, diagnostics); finite(value.y1, `${path}.y1`, diagnostics)
      finite(value.x2, `${path}.x2`, diagnostics); finite(value.y2, `${path}.y2`, diagnostics)
      return
    case 'polygon':
      validatePoints(value.points, `${path}.points`, diagnostics, 3, budget, external)
      return
    case 'polyline':
      validatePoints(value.points, `${path}.points`, diagnostics, 2, budget, external)
      return
    case 'path':
      if (typeof value.d !== 'string' || value.d.length === 0 || value.d.length > MAX_TEXT_LENGTH) {
        add(diagnostics, 'SCENE_SECURITY', `${path}.d`, 'must use bounded SVG path data')
      } else {
        const problem = svgPathDataProblem(value.d, external && !marker)
        if (problem) add(diagnostics, 'SCENE_SECURITY', `${path}.d`, `must use semantic SVG path data: ${problem}`)
      }
      if (value.points !== undefined) validatePoints(value.points, `${path}.points`, diagnostics, 2, budget, external)
      if (value.markerMidpoints !== undefined) {
        validatePoints(value.markerMidpoints, `${path}.markerMidpoints`, diagnostics, 0, budget, external)
      }
      if (value.subpaths !== undefined) {
        if (!Array.isArray(value.subpaths) || value.subpaths.length === 0) {
          add(diagnostics, 'SCENE_BOUNDS', `${path}.subpaths`, 'must be a non-empty array of typed contours')
        } else {
          for (let index = 0; index < Math.min(value.subpaths.length, MAX_SCENE_NODES); index++) {
            const subpath = value.subpaths[index]
            if (!record(subpath)) {
              add(diagnostics, 'SCENE_DOCUMENT', `${path}.subpaths[${index}]`, 'must be a typed contour')
              continue
            }
            validatePoints(subpath.points, `${path}.subpaths[${index}].points`, diagnostics, 2, budget, external)
            if (typeof subpath.closed !== 'boolean') add(diagnostics, 'SCENE_DOCUMENT', `${path}.subpaths[${index}].closed`, 'must be boolean')
          }
        }
      }
      return
    case 'compound':
      if (!Array.isArray(value.children)) {
        add(diagnostics, 'SCENE_BOUNDS', `${path}.children`, 'must be a geometry array')
        return
      }
      if (value.children.length > MAX_SCENE_NODES) add(diagnostics, 'SCENE_BOUNDS', `${path}.children`, 'contains too many geometries')
      for (let index = 0; index < Math.min(value.children.length, MAX_SCENE_NODES); index++) {
        validateGeometry(value.children[index], `${path}.children[${index}]`, diagnostics, marker, depth + 1, budget, external)
      }
      return
    default:
      add(diagnostics, 'SCENE_DOCUMENT', `${path}.kind`, `unknown geometry kind "${value.kind}"`)
  }
}

function validateChannels(value: unknown, path: string, diagnostics: MutableDiagnostic[]): void {
  if (value === undefined) return
  if (!record(value)) {
    add(diagnostics, 'SCENE_DOCUMENT', path, 'must be a semantic channel object')
    return
  }
  for (const field of ['importance', 'value', 'progress'] as const) {
    if (value[field] !== undefined) finite(value[field], `${path}.${field}`, diagnostics)
  }
  if (typeof value.progress === 'number' && (value.progress < 0 || value.progress > 1)) {
    add(diagnostics, 'SCENE_BOUNDS', `${path}.progress`, 'must be in [0,1]')
  }
  for (const field of ['category', 'status', 'route'] as const) {
    if (value[field] !== undefined) boundedString(value[field], `${path}.${field}`, diagnostics, { max: 4096 })
  }
  if (value.emphasis !== undefined && typeof value.emphasis !== 'boolean') {
    add(diagnostics, 'SCENE_DOCUMENT', `${path}.emphasis`, 'must be boolean')
  }
}

function validateMarker(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  external: boolean,
  budget?: ValidationBudget,
): value is MarkerDescriptor {
  if (!record(value)) {
    add(diagnostics, 'SCENE_MARKER', path, 'must be a marker descriptor')
    return false
  }
  if (external) {
    rejectUnknownKeys(value, [
      'id', 'shape', 'geometry', 'size', 'viewBox', 'ref', 'bounds',
      'units', 'orient', 'overflow', 'paint', 'scale',
    ], path, diagnostics)
  }
  boundedString(value.id, `${path}.id`, diagnostics, { externalId: external })
  if (!['arrow', 'open-arrow', 'circle', 'cross', 'triangle', 'diamond', 'diamond-open'].includes(String(value.shape))) {
    add(diagnostics, 'SCENE_MARKER', `${path}.shape`, 'must be a known marker shape')
  }
  validateGeometry(value.geometry, `${path}.geometry`, diagnostics, true, 0, budget, external)
  if (external && record(value.geometry) && value.geometry.kind === 'compound' && (!Array.isArray(value.geometry.children) || value.geometry.children.length === 0)) {
    add(diagnostics, 'SCENE_BOUNDS', `${path}.geometry.children`, 'external marker compounds must contain geometry')
  }
  if (record(value.size)) {
    if (external) rejectUnknownKeys(value.size, ['width', 'height'], `${path}.size`, diagnostics)
    finite(value.size.width, `${path}.size.width`, diagnostics, { positive: true })
    finite(value.size.height, `${path}.size.height`, diagnostics, { positive: true })
  }
  if (record(value.ref)) validatePoint(value.ref, `${path}.ref`, diagnostics, budget, external)
  if (value.paint !== undefined) validatePaint(value.paint, `${path}.paint`, diagnostics, external)
  if (record(value.viewBox)) {
    if (external) rejectUnknownKeys(value.viewBox, ['x', 'y', 'width', 'height'], `${path}.viewBox`, diagnostics)
    finite(value.viewBox.x, `${path}.viewBox.x`, diagnostics)
    finite(value.viewBox.y, `${path}.viewBox.y`, diagnostics)
    finite(value.viewBox.width, `${path}.viewBox.width`, diagnostics, { positive: true })
    finite(value.viewBox.height, `${path}.viewBox.height`, diagnostics, { positive: true })
  }
  if (record(value.bounds)) {
    if (external) rejectUnknownKeys(value.bounds, ['x0', 'y0', 'x1', 'y1'], `${path}.bounds`, diagnostics)
    for (const field of ['x0', 'y0', 'x1', 'y1'] as const) finite(value.bounds[field], `${path}.bounds.${field}`, diagnostics)
    if (typeof value.bounds.x0 === 'number' && typeof value.bounds.x1 === 'number' && value.bounds.x0 > value.bounds.x1) {
      add(diagnostics, 'SCENE_BOUNDS', `${path}.bounds`, 'x0 must not exceed x1')
    }
    if (typeof value.bounds.y0 === 'number' && typeof value.bounds.y1 === 'number' && value.bounds.y0 > value.bounds.y1) {
      add(diagnostics, 'SCENE_BOUNDS', `${path}.bounds`, 'y0 must not exceed y1')
    }
  }
  if (value.scale !== undefined) finite(value.scale, `${path}.scale`, diagnostics, { nonNegative: true })
  if (value.units !== undefined && !['strokeWidth', 'userSpaceOnUse'].includes(String(value.units))) {
    add(diagnostics, 'SCENE_MARKER', `${path}.units`, 'must be strokeWidth or userSpaceOnUse')
  }
  if (typeof value.orient === 'number') finite(value.orient, `${path}.orient`, diagnostics)
  else if (value.orient !== undefined && !['auto', 'auto-start-reverse'].includes(String(value.orient))) {
    add(diagnostics, 'SCENE_MARKER', `${path}.orient`, 'must be auto, auto-start-reverse, or a finite angle')
  }
  if (value.overflow !== undefined && !['hidden', 'visible'].includes(String(value.overflow))) {
    add(diagnostics, 'SCENE_MARKER', `${path}.overflow`, 'must be hidden or visible')
  }
  try {
    assertRenderableMarker(value as unknown as MarkerDescriptor)
  } catch (error) {
    add(diagnostics, 'SCENE_MARKER', path, error instanceof Error ? error.message : String(error))
  }
  return typeof value.id === 'string'
}

export interface ValidationState {
  readonly diagnostics: MutableDiagnostic[]
  readonly external: boolean
  readonly aggregateBudgets: boolean
  readonly native?: {
    readonly artwork: Array<{ id: string; owner: SceneOwner; path: string }>
    readonly groups: Set<string>
    readonly enclosures: Map<string, SceneOwner>
  }
  readonly paintReferences: Array<{ id: string; path: string }>
  readonly ids: Map<string, { path: string; kind: string }>
  readonly subjects: Set<string>
  readonly ownerReferences: Array<{ key: string; path: string }>
  readonly domIds: Map<string, string>
  readonly markerIds: Map<string, MarkerDescriptor>
  readonly gradientIds: Map<string, LinearGradientDescriptor>
  readonly markerReferences: Array<{ id: string; path: string; marker: MarkerDescriptor }>
  readonly endpointReferences: Array<{ id: string; path: string }>
  readonly companionLabelReferences: Array<{ id: string; path: string }>
  readonly budget: ValidationBudget
  /** Re-derive and compare what internal lowering derived (see assertions.ts). */
  readonly crossChecks: boolean
  nodeCount: number
}

function validateRole(kind: string, value: unknown, path: string, state: ValidationState): value is SceneRole {
  if (typeof value !== 'string') {
    add(state.diagnostics, 'SCENE_ROLE', path, 'must be a Scene role string')
    return false
  }
  const builtin = Object.prototype.hasOwnProperty.call(BUILTIN_SCENE_ROLE_TRAITS, value)
  if (!builtin && !NAMESPACED_ROLE.test(value)) {
    add(state.diagnostics, 'SCENE_ROLE', path, 'must be a built-in or namespaced Scene role')
    return false
  }
  if (!sceneRoleTraits(value as SceneRole).applicableKinds.includes(kind as never)) {
    add(state.diagnostics, 'SCENE_ROLE', path, `role "${value}" is not applicable to ${kind} marks`)
  }
  return true
}

function validateNodeSerialization(value: SceneNode, path: string, state: ValidationState): string | undefined {
  let serialized: string | undefined
  try {
    serialized = sceneNodeSerialization(value)
    if (boundedUtf8ByteLength(serialized, MAX_SERIALIZATION_BYTES_PER_NODE) > MAX_SERIALIZATION_BYTES_PER_NODE) {
      add(state.diagnostics, 'SCENE_DOCUMENT', path, 'has an oversized SVG serialization')
    }
  } catch (error) {
    add(state.diagnostics, 'SCENE_DOCUMENT', path, error instanceof Error ? error.message : String(error))
  }
  if (state.aggregateBudgets && serialized !== undefined) {
    consumeStringBudget(
      state.budget,
      'serializationBytes',
      'serializationExceeded',
      serialized,
      path,
      state.diagnostics,
      MAX_AGGREGATE_SERIALIZATION_BYTES,
      'Scene serializations',
    )
  }
  return serialized
}

function validateNode(value: unknown, path: string, state: ValidationState, depth: number, enclosing?: SceneOwner): void {
  if (depth > MAX_SCENE_DEPTH) {
    add(state.diagnostics, 'SCENE_BOUNDS', path, `exceeds maximum nesting depth ${MAX_SCENE_DEPTH}`)
    return
  }
  if (++state.nodeCount > MAX_SCENE_NODES) {
    if (state.nodeCount === MAX_SCENE_NODES + 1) add(state.diagnostics, 'SCENE_BOUNDS', path, 'contains too many Scene nodes')
    return
  }
  if (!record(value) || typeof value.kind !== 'string') {
    add(state.diagnostics, 'SCENE_DOCUMENT', path, 'must be a typed Scene node')
    return
  }
  const kind = value.kind
  localPaintResourceReferences(value, path, state.paintReferences)
  if (!['shape', 'connector', 'text', 'group', 'document'].includes(kind)) {
    add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.kind`, `unknown Scene node kind "${kind}"`)
    return
  }
  if (state.external && depth > 0 && kind === 'document') {
    add(state.diagnostics, 'SCENE_DOCUMENT', path, `${kind} marks must be top-level document furniture`)
  }
  if (state.external) {
    const base = ['kind', 'id', 'role', 'identity', 'accessibility', 'channels', 'transform', 'owner']
    const fields: Record<string, readonly string[]> = {
      shape: [...base, 'geometry', 'paint'],
      text: [...base, 'text', 'x', 'y', 'fontSize', 'anchor', 'baselineShift', 'paint', 'fontWeight', 'letterSpacing', 'display', 'textLayout', 'block', 'measurement', 'prepared'],
      group: [...base, 'open', 'close', 'children', 'join'],
      'document': [...base, 'element', 'text', 'domId', 'markerResources'],
      connector: [
        ...base, 'lineStyle', 'endpoints', 'relationship', 'route', 'stroke', 'markers', 'labels', 'hit',
        'terminalProjection',
      ],
    }
    rejectUnknownKeys(value, fields[kind]!, path, state.diagnostics)
  }
  if (boundedString(value.id, `${path}.id`, state.diagnostics, { externalId: state.external })) {
    const prior = state.ids.get(value.id)
    if (state.external && prior) add(state.diagnostics, 'SCENE_ID', `${path}.id`, `duplicates ${prior.path}`)
    else state.ids.set(value.id, { path: `${path}.id`, kind })
  }
  if (value.domId !== undefined && boundedString(value.domId, `${path}.domId`, state.diagnostics, { externalId: state.external })) {
    const prior = state.domIds.get(value.domId)
    const marker = state.markerIds.get(value.domId)
    const gradient = state.gradientIds.get(value.domId)
    if (state.external && prior) add(state.diagnostics, 'SCENE_ID', `${path}.domId`, `duplicates DOM id owned by ${prior}`)
    else if (state.external && marker) add(state.diagnostics, 'SCENE_ID', `${path}.domId`, `collides with marker resource "${value.domId}"`)
    else if (gradient) add(state.diagnostics, 'SCENE_ID', `${path}.domId`, `collides with gradient resource "${value.domId}"`)
    else state.domIds.set(value.domId, `${path}.domId`)
  }
  validateRole(kind, value.role, `${path}.role`, state)
  if (typeof value.id === 'string' && typeof value.role === 'string') state.subjects.add(JSON.stringify([value.id, value.role]))
  if (record(value.identity) && typeof value.identity.id === 'string' && typeof value.identity.role === 'string') state.subjects.add(JSON.stringify([value.identity.id, value.identity.role]))
  if (record(value.owner) && typeof value.owner.id === 'string' && typeof value.owner.role === 'string') state.ownerReferences.push({ key: JSON.stringify([value.owner.id, value.owner.role]), path: `${path}.owner` })
  validateChannels(value.channels, `${path}.channels`, state.diagnostics)
  const serialized = !state.native || kind === 'document'
    ? validateNodeSerialization(value as unknown as SceneNode, path, state)
    : undefined
  if (value.transform !== undefined) {
    if (!record(value.transform) || !['rotate', 'matrix'].includes(String(value.transform.kind))) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.transform`, 'must be a rotate or matrix transform')
    } else {
      const fields = value.transform.kind === 'matrix' ? ['a', 'b', 'c', 'd', 'e', 'f'] : ['angle', 'cx', 'cy']
      for (const field of fields) finite(value.transform[field], `${path}.transform.${field}`, state.diagnostics)
    }
    if (state.external) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.transform`, 'external Scene transforms are not exposed by the declarative builder')
  }

  if (value.owner !== undefined) {
    if (!record(value.owner)) add(state.diagnostics, 'SCENE_REFERENCE', `${path}.owner`, 'must be a semantic owner')
    else {
      boundedString(value.owner.id, `${path}.owner.id`, state.diagnostics)
      if (typeof value.owner.role !== 'string' || (!Object.hasOwn(BUILTIN_SCENE_ROLE_TRAITS, value.owner.role) && !NAMESPACED_ROLE.test(value.owner.role))) add(state.diagnostics, 'SCENE_ROLE', `${path}.owner.role`, 'must be a Scene role')
    }
  }
  if (value.visibility !== undefined && value.visibility !== 'conditional') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.visibility`, 'must be conditional')
  if (value.attributes !== undefined) validateMarkAttributes(value.attributes, `${path}.attributes`, state.diagnostics)

  if (kind === 'shape') {
    if (value.identity === undefined && typeof value.role === 'string' && hasDomSvgIdentityRole(value.role as SceneRole)) {
      if (state.native && typeof value.id === 'string' && record(value.owner) && typeof value.owner.id === 'string' && value.owner.role === value.role) {
        state.native.artwork.push({ id: value.id, owner: { id: value.owner.id, role: value.role as SceneRole }, path: `${path}.identity` })
      } else if (!enclosing || !record(value.owner) || value.role !== enclosing.role || value.owner.id !== enclosing.id || value.owner.role !== enclosing.role) {
        add(state.diagnostics, 'SCENE_FIDELITY', `${path}.identity`, 'owned artwork without DOM identity must be inside its matching semantic group')
      }
    }
    if (value.surfaceFragment !== undefined && typeof value.surfaceFragment !== 'boolean') {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.surfaceFragment`, 'must be boolean')
    }
    validateGeometry(value.geometry, `${path}.geometry`, state.diagnostics, false, 0, state.budget, state.external)
    if (state.external && record(value.geometry) && (value.geometry.kind === 'path' || value.geometry.kind === 'compound')) {
      add(state.diagnostics, 'SCENE_BOUNDS', `${path}.geometry`, 'external shapes must use a directly bounded structured geometry')
    }
    validatePaint(value.paint, `${path}.paint`, state.diagnostics, state.external)
    if (value.childPaints !== undefined) {
      if (!Array.isArray(value.childPaints) || !record(value.geometry) || value.geometry.kind !== 'compound' || !Array.isArray(value.geometry.children) || value.childPaints.length !== value.geometry.children.length) {
        add(state.diagnostics, 'SCENE_PAINT', `${path}.childPaints`, 'must give one paint per compound geometry child')
      } else value.childPaints.forEach((paint, index) => validatePaint(paint, `${path}.childPaints[${index}]`, state.diagnostics, state.external))
    }
    if (value.conditionalPaint !== undefined) {
      if (value.visibility !== 'conditional') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.conditionalPaint`, 'requires an explicit conditional state')
      validatePaint(value.conditionalPaint, `${path}.conditionalPaint`, state.diagnostics, state.external)
    }
    return
  }
  if (kind === 'text') {
    boundedString(value.text, `${path}.text`, state.diagnostics, { empty: true, max: MAX_TEXT_LENGTH })
    if (state.aggregateBudgets) consumeStringBudget(state.budget, 'textBytes', 'textExceeded', value.text, `${path}.text`, state.diagnostics, MAX_TEXT_BYTES, 'Scene text values')
    finite(value.x, `${path}.x`, state.diagnostics); finite(value.y, `${path}.y`, state.diagnostics)
    finite(value.fontSize, `${path}.fontSize`, state.diagnostics, { positive: true })
    if (value.fontWeight !== undefined) finite(value.fontWeight, `${path}.fontWeight`, state.diagnostics, { positive: true })
    if (value.letterSpacing !== undefined) finite(value.letterSpacing, `${path}.letterSpacing`, state.diagnostics)
    if (value.display !== undefined && value.display !== 'literal' && value.display !== 'formatted') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.display`, 'must be literal or formatted')
    if (value.measurement !== undefined && !['prepared', 'fallback'].includes(String(value.measurement))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.measurement`, 'must identify prepared or fallback measurement')
    if (value.measurement === 'prepared' && (!record(value.block) || value.block.unit !== 'px' || !record(value.block.prepared))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.block`, 'prepared text must retain its actual pixel block')
    if (record(value.block)) {
      if (!isRetainedPixelText(value.block)) add(state.diagnostics, 'SCENE_FIDELITY', `${path}.block`, 'must retain the actual immutable pixel text preparation')
      for (const field of ['fontSize', 'fontWeight', 'letterSpacing'] as const) {
        if (value[field] !== undefined && value[field] !== value.block[field]) add(state.diagnostics, 'SCENE_FIDELITY', `${path}.block.${field}`, 'must equal the retained text typography')
      }
      for (const field of ['width', 'height', 'fontSize', 'fontWeight', 'lineHeight']) finite(value.block[field], `${path}.block.${field}`, state.diagnostics, { nonNegative: true })
      if (record(value.textLayout) && (value.block.width !== value.textLayout.width || value.block.height !== value.textLayout.height || value.block.lineHeight !== value.textLayout.lineHeight)) add(state.diagnostics, 'SCENE_FIDELITY', `${path}.textLayout`, 'retained block differs from occupied text geometry')
    }
    if (value.textLayout !== undefined) {
      if (!record(value.textLayout)) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.textLayout`, 'must be measured text geometry')
      else {
        if (state.external) rejectUnknownKeys(value.textLayout, ['width', 'height', 'lineHeight', 'offsetY'], `${path}.textLayout`, state.diagnostics)
        finite(value.textLayout.width, `${path}.textLayout.width`, state.diagnostics, { nonNegative: true })
        finite(value.textLayout.height, `${path}.textLayout.height`, state.diagnostics, { nonNegative: true })
        finite(value.textLayout.lineHeight, `${path}.textLayout.lineHeight`, state.diagnostics, { positive: true })
        finite(value.textLayout.offsetY, `${path}.textLayout.offsetY`, state.diagnostics)
      }
    }
    if (!['start', 'middle', 'end'].includes(String(value.anchor))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.anchor`, 'must be start, middle, or end')
    if (value.baselineShift !== undefined) finite(value.baselineShift, `${path}.baselineShift`, state.diagnostics)
    if (value.dominantBaseline !== undefined && !['middle', 'central', 'hanging'].includes(String(value.dominantBaseline))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.dominantBaseline`, 'must be middle, central, or hanging')
    if (value.fontStyle !== undefined && value.fontStyle !== 'italic') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.fontStyle`, 'must be italic')
    if (value.textDecoration !== undefined && !['underline', 'line-through', 'underline line-through'].includes(String(value.textDecoration))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.textDecoration`, 'must be underline, line-through, or both')
    if (value.spans !== undefined) {
      if (!Array.isArray(value.spans) || value.spans.length === 0) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.spans`, 'must be a non-empty run list')
      else {
        if (value.spans.length > MAX_SCENE_NODES) add(state.diagnostics, 'SCENE_BOUNDS', `${path}.spans`, 'contains too many text runs')
        for (let index = 0; index < Math.min(value.spans.length, MAX_SCENE_NODES); index++) {
          const span = value.spans[index]
          if (!record(span)) { add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.spans[${index}]`, 'must be a painted run'); continue }
          boundedString(span.text, `${path}.spans[${index}].text`, state.diagnostics, { empty: true, max: MAX_TEXT_LENGTH })
          if (state.aggregateBudgets) consumeStringBudget(state.budget, 'textBytes', 'textExceeded', span.text, `${path}.spans[${index}].text`, state.diagnostics, MAX_TEXT_BYTES, 'Scene text values')
          validatePaint({ fill: span.fill }, `${path}.spans[${index}]`, state.diagnostics, state.external)
        }
      }
    }
    validatePaint(value.paint, `${path}.paint`, state.diagnostics, state.external)
    return
  }
  if (kind === 'group') {
    if (state.native && typeof value.role === 'string' && hasDomSvgIdentityRole(value.role as SceneRole)
      && record(value.identity) && typeof value.identity.id === 'string' && value.identity.role === value.role) {
      state.native.groups.add(JSON.stringify([value.identity.id, value.role]))
    }
    if (value.paint !== undefined) {
      validatePaint(value.paint, `${path}.paint`, state.diagnostics, state.external)
      if (record(value.paint)) rejectUnknownKeys(value.paint, ['opacity', 'fill'], `${path}.paint`, state.diagnostics)
    }
    if (!Array.isArray(value.children)) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.children`, 'must be an array')
      return
    }
    if (value.children.length > MAX_SCENE_NODES) add(state.diagnostics, 'SCENE_BOUNDS', `${path}.children`, 'contains too many Scene nodes')
    const childCount = Math.min(value.children.length, Math.max(0, MAX_SCENE_NODES - state.nodeCount + 1))
    const subject = typeof value.role === 'string' && hasDomSvgIdentityRole(value.role as SceneRole)
      ? record(value.identity) && typeof value.identity.id === 'string' && value.identity.role === value.role ? { id: value.identity.id, role: value.role as SceneRole } : undefined
      : enclosing
    for (let index = 0; index < childCount; index++) {
      const child = value.children[index]
      if (!record(child)) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.children[${index}]`, 'must wrap a Scene node')
      else {
        finite(child.indent, `${path}.children[${index}].indent`, state.diagnostics, { nonNegative: true })
        validateNode(child.node, `${path}.children[${index}].node`, state, depth + 1, subject)
      }
    }
    try { assertInertGroup(value as unknown as import('./ir.ts').GroupMark) } catch (error) { add(state.diagnostics, 'SCENE_DOCUMENT', path, String(error)) }
    if (state.external && (typeof value.open !== 'string' || !/^<g(?:\s|>)/.test(value.open) || value.close !== '</g>')) {
      add(state.diagnostics, 'SCENE_SECURITY', path, 'external containers must use a generated <g> wrapper')
    }
    return
  }
  if (kind === 'document') {
    if (value.nonPaint !== undefined) {
      const tags: Record<string, readonly string[]> = { accessibility: ['title', 'desc'], stylesheet: ['style'], 'interaction-metadata': ['title', 'desc'] }
      const allowed = tags[String(value.nonPaint)]
      if (value.element !== 'content' || !allowed || serialized === undefined || scanSvgStartTags(serialized).some(tag => !allowed.includes(tag.name))) {
        add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.nonPaint`, 'must describe only closed non-painting metadata elements')
      }
    }
    if (!['open', 'title', 'description', 'definitions', 'content', 'close'].includes(String(value.element))) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.element`, 'has an unknown document element')
    }
    if (value.markerResources !== undefined) {
      if (!Array.isArray(value.markerResources)) add(state.diagnostics, 'SCENE_MARKER', `${path}.markerResources`, 'must be an array')
      else {
        if (value.markerResources.length > MAX_SCENE_NODES) add(state.diagnostics, 'SCENE_BOUNDS', `${path}.markerResources`, 'contains too many marker resources')
        for (let index = 0; index < Math.min(value.markerResources.length, MAX_SCENE_NODES); index++) {
          if (state.native && state.markerIds.size >= MAX_SCENE_NODES) {
            add(state.diagnostics, 'SCENE_BOUNDS', `${path}.markerResources`, 'contains too many aggregate marker resources')
            return
          }
          const marker = value.markerResources[index]
          const markerPath = `${path}.markerResources[${index}]`
          if (validateMarker(marker, markerPath, state.diagnostics, state.external, state.budget) && typeof marker.id === 'string') {
            const prior = state.markerIds.get(marker.id)
            const domPrior = state.domIds.get(marker.id)
            if (prior) add(state.diagnostics, 'SCENE_MARKER', `${markerPath}.id`, `duplicates marker resource "${marker.id}"`)
            else if (state.external && domPrior) add(state.diagnostics, 'SCENE_ID', `${markerPath}.id`, `collides with DOM id owned by ${domPrior}`)
            else if (state.gradientIds.has(marker.id)) add(state.diagnostics, 'SCENE_ID', `${markerPath}.id`, `collides with gradient resource "${marker.id}"`)
            else state.markerIds.set(marker.id, marker)
          }
        }
        if (state.external && value.element === 'definitions') {
          try {
            const expected = canonicalizeSceneNodeSerialization(
              `<defs>\n${serializeMarkerResources(value.markerResources as MarkerDescriptor[])}\n</defs>`,
            )
            if (serialized !== expected) add(state.diagnostics, 'SCENE_FIDELITY', path, 'definitions must be generated from the typed marker resources')
          } catch {
            // The marker diagnostic above is more precise.
          }
        }
      }
    }
    if (value.gradientResources !== undefined) {
      if (value.element !== 'definitions') add(state.diagnostics, 'SCENE_PAINT', `${path}.gradientResources`, 'are only valid on a definitions document mark')
      if (!Array.isArray(value.gradientResources)) add(state.diagnostics, 'SCENE_PAINT', `${path}.gradientResources`, 'must be an array')
      else {
        if (value.gradientResources.length > LINEAR_GRADIENT_LIMITS.maxResources) add(state.diagnostics, 'SCENE_BOUNDS', `${path}.gradientResources`, `contains more than ${LINEAR_GRADIENT_LIMITS.maxResources} gradient resources`)
        for (let index = 0; index < Math.min(value.gradientResources.length, LINEAR_GRADIENT_LIMITS.maxResources); index++) {
          if (state.native && state.gradientIds.size >= LINEAR_GRADIENT_LIMITS.maxResources) {
            add(state.diagnostics, 'SCENE_BOUNDS', `${path}.gradientResources`, `contains more than ${LINEAR_GRADIENT_LIMITS.maxResources} aggregate gradient resources`)
            return
          }
          const gradient = value.gradientResources[index]
          const gradientPath = `${path}.gradientResources[${index}]`
          try {
            assertRenderableLinearGradient(gradient as LinearGradientDescriptor)
            const typed = gradient as LinearGradientDescriptor
            if (state.gradientIds.has(typed.id) || state.markerIds.has(typed.id) || state.domIds.has(typed.id)) {
              add(state.diagnostics, 'SCENE_ID', `${gradientPath}.id`, `duplicates SVG resource id "${typed.id}"`)
            } else {
              state.gradientIds.set(typed.id, typed)
            }
          } catch (error) {
            add(state.diagnostics, 'SCENE_PAINT', gradientPath, error instanceof Error ? error.message : String(error))
          }
        }
        if (value.element === 'definitions') {
          try {
            const resources = [
              ...(Array.isArray(value.markerResources) && value.markerResources.length > 0
                ? [serializeMarkerResources(value.markerResources as MarkerDescriptor[])]
                : []),
              ...(value.gradientResources.length > 0
                ? [serializeLinearGradientResources(value.gradientResources as LinearGradientDescriptor[])]
                : []),
            ].join('\n')
            const expected = canonicalizeSceneNodeSerialization(`<defs>\n${resources}\n</defs>`)
            if (serialized !== expected) add(state.diagnostics, 'SCENE_FIDELITY', path, 'definitions must be generated from typed resources')
          } catch {
            // Resource-specific diagnostics above are more precise.
          }
        }
      }
    }
    if (state.aggregateBudgets && (value.element === 'title' || value.element === 'description')) {
      boundedString(value.text, `${path}.text`, state.diagnostics, { empty: true, max: MAX_TEXT_LENGTH })
      consumeStringBudget(state.budget, 'textBytes', 'textExceeded', value.text, `${path}.text`, state.diagnostics, MAX_TEXT_BYTES, 'Scene text values')
    }
    if (state.external && value.element === 'close' && serialized !== '</svg>') {
      add(state.diagnostics, 'SCENE_SECURITY', path, 'external document close must be canonical')
    }
    return
  }

  // Connector
  if (!['solid', 'dotted', 'dashed', 'thick', 'invisible'].includes(String(value.lineStyle))) {
    add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.lineStyle`, 'has an unknown line style')
  }
  if (record(value.endpoints)) {
    for (const field of ['from', 'to'] as const) {
      if (state.external && value.endpoints[field] === undefined) {
        add(state.diagnostics, 'SCENE_REFERENCE', `${path}.endpoints.${field}`, 'is required for external connectors')
      } else if (value.endpoints[field] !== undefined && boundedString(value.endpoints[field], `${path}.endpoints.${field}`, state.diagnostics, { externalId: state.external })) {
        state.endpointReferences.push({ id: value.endpoints[field] as string, path: `${path}.endpoints.${field}` })
      }
    }
    for (const field of ['start', 'end'] as const) {
      const endpoint = value.endpoints[field]
      if (record(endpoint)) {
        if (endpoint.point !== undefined) validatePoint(endpoint.point, `${path}.endpoints.${field}.point`, state.diagnostics, state.budget, state.external)
        if (endpoint.id !== undefined) boundedString(endpoint.id, `${path}.endpoints.${field}.id`, state.diagnostics, { externalId: state.external })
        if (endpoint.portId !== undefined) boundedString(endpoint.portId, `${path}.endpoints.${field}.portId`, state.diagnostics, { externalId: state.external })
        if (endpoint.owner !== undefined) {
          const ownerPath = `${path}.endpoints.${field}.owner`
          if (!record(endpoint.owner)) add(state.diagnostics, 'SCENE_REFERENCE', ownerPath, 'must be a semantic owner')
          else {
            boundedString(endpoint.owner.id, `${ownerPath}.id`, state.diagnostics)
            if (typeof endpoint.owner.role !== 'string' || (!Object.hasOwn(BUILTIN_SCENE_ROLE_TRAITS, endpoint.owner.role) && !NAMESPACED_ROLE.test(endpoint.owner.role))) add(state.diagnostics, 'SCENE_ROLE', `${ownerPath}.role`, 'must be a Scene role')
            const id = value.endpoints[field === 'start' ? 'from' : 'to']
            if (id !== undefined && endpoint.owner.id !== id) add(state.diagnostics, 'SCENE_FIDELITY', ownerPath, 'must retain the authored endpoint identity')
            state.ownerReferences.push({ key: JSON.stringify([endpoint.owner.id, endpoint.owner.role]), path: ownerPath })
          }
        }
      }
    }
  } else add(state.diagnostics, 'SCENE_REFERENCE', `${path}.endpoints`, 'must be a typed endpoint object')
  if (record(value.relationship)) boundedString(value.relationship.kind, `${path}.relationship.kind`, state.diagnostics, { max: 4096 })
  else add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.relationship`, 'must be a typed relationship')
  if (record(value.relationship) && !['forward', 'reverse', 'bidirectional', 'undirected', 'self'].includes(String(value.relationship.direction))) {
    add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.relationship.direction`, 'has an unknown connector direction')
  }
  if (record(value.route)) {
    validateGeometry(value.route.geometry, `${path}.route.geometry`, state.diagnostics, false, 0, state.budget, state.external)
    if (state.external && record(value.route.geometry) && value.route.geometry.kind === 'path' && !Array.isArray(value.route.geometry.points)) {
      add(state.diagnostics, 'SCENE_BOUNDS', `${path}.route.geometry.points`, 'external connector paths require deterministic routed points')
    }
    finite(value.route.bendRadius, `${path}.route.bendRadius`, state.diagnostics, { nonNegative: true })
    if (!['authored', 'layout', 'family', 'projected'].includes(String(value.route.ownership))) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.ownership`, 'has an unknown route ownership')
    }
    if (typeof value.route.closed !== 'boolean') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.closed`, 'must be boolean')
    if (value.route.closed === true && record(value.route.geometry) && value.route.geometry.kind !== 'path') {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.closed`, 'closed connector topology requires path geometry')
    }
    if (value.route.startTangent !== undefined) {
      validatePoint(value.route.startTangent, `${path}.route.startTangent`, state.diagnostics, state.budget, state.external)
      validateUnitVector(value.route.startTangent, `${path}.route.startTangent`, state.diagnostics)
    }
    if (value.route.endTangent !== undefined) {
      validatePoint(value.route.endTangent, `${path}.route.endTangent`, state.diagnostics, state.budget, state.external)
      validateUnitVector(value.route.endTangent, `${path}.route.endTangent`, state.diagnostics)
    }
    if (Array.isArray(value.route.labelAnchors)) {
      if (value.route.labelAnchors.length > MAX_SCENE_NODES) add(state.diagnostics, 'SCENE_BOUNDS', `${path}.route.labelAnchors`, 'contains too many points')
      const count = Math.min(value.route.labelAnchors.length, MAX_SCENE_NODES, Math.max(0, MAX_SCENE_POINTS - state.budget.points + 1))
      for (let index = 0; index < count; index++) validatePoint(value.route.labelAnchors[index], `${path}.route.labelAnchors[${index}]`, state.diagnostics, state.budget, state.external)
    }
    else add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.labelAnchors`, 'must be an array')
    if (Array.isArray(value.route.contours)) {
      if (value.route.contours.length === 0 || value.route.contours.length > MAX_SCENE_NODES) {
        add(state.diagnostics, 'SCENE_BOUNDS', `${path}.route.contours`, 'must contain a bounded non-empty contour list')
      }
      for (let index = 0; index < Math.min(value.route.contours.length, MAX_SCENE_NODES); index++) {
        const contour = value.route.contours[index]
        if (!record(contour)) {
          add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.contours[${index}]`, 'must be typed contour semantics')
          continue
        }
        validatePoint(contour.start, `${path}.route.contours[${index}].start`, state.diagnostics, state.budget, state.external)
        validatePoint(contour.end, `${path}.route.contours[${index}].end`, state.diagnostics, state.budget, state.external)
        if (typeof contour.closed !== 'boolean') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.contours[${index}].closed`, 'must be boolean')
        for (const [field, tangent] of [['startTangent', contour.startTangent], ['endTangent', contour.endTangent]] as const) {
          if (tangent === undefined) continue
          const tangentPath = `${path}.route.contours[${index}].${field}`
          validatePoint(tangent, tangentPath, state.diagnostics, state.budget, state.external)
          validateUnitVector(tangent, tangentPath, state.diagnostics)
        }
      }
    } else add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.contours`, 'must be an array')
  } else add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route`, 'must be a typed connector route')
  if (record(value.stroke)) {
    if (safeCssPaint(value.stroke.color) === undefined && (state.external || !localPaintResourceId(value.stroke.color))) {
      add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.color`, 'must be a safe non-fetching CSS paint')
    }
    numericCss(value.stroke.width, `${path}.stroke.width`, state.diagnostics, { nonNegative: true, length: true })
    numericCss(value.stroke.opacity, `${path}.stroke.opacity`, state.diagnostics, { unitInterval: true })
    numericCss(value.stroke.miterLimit, `${path}.stroke.miterLimit`, state.diagnostics, { nonNegative: true })
    numericCss(value.stroke.pathLength, `${path}.stroke.pathLength`, state.diagnostics, { nonNegative: true })
    if (!['butt', 'round', 'square'].includes(String(value.stroke.lineCap))) add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.lineCap`, 'has an unknown line cap')
    if (!['arcs', 'bevel', 'miter', 'miter-clip', 'round'].includes(String(value.stroke.lineJoin))) add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.lineJoin`, 'has an unknown line join')
    if (value.stroke.mixBlendMode !== undefined && !['normal', 'multiply'].includes(String(value.stroke.mixBlendMode))) add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.mixBlendMode`, 'must be normal or multiply')
    if (typeof value.stroke.nonScaling !== 'boolean') add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.nonScaling`, 'must be boolean')
    if (value.stroke.encodesValue !== undefined && typeof value.stroke.encodesValue !== 'boolean') add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.encodesValue`, 'must be boolean')
    if (value.stroke.dash !== undefined) {
      if (!record(value.stroke.dash)) add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.dash`, 'must be a dash descriptor')
      else {
        const array = value.stroke.dash.array
        if (typeof array === 'string') {
          if (!SAFE_DASH.test(array.trim())) add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.dash.array`, 'must be a finite numeric dash list')
        } else if (Array.isArray(array)) {
          array.forEach((item, index) => numericCss(item, `${path}.stroke.dash.array[${index}]`, state.diagnostics, { nonNegative: true }))
        } else add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.dash.array`, 'must be a string or numeric array')
        numericCss(value.stroke.dash.offset, `${path}.stroke.dash.offset`, state.diagnostics)
      }
    }
  } else add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke`, 'must be a typed connector stroke')
  if (record(value.hit)) {
    validateGeometry(value.hit.geometry, `${path}.hit.geometry`, state.diagnostics, false, 0, state.budget, state.external)
    finite(value.hit.strokeWidth, `${path}.hit.strokeWidth`, state.diagnostics, { nonNegative: true })
    if (typeof value.hit.closed !== 'boolean') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.hit.closed`, 'must be boolean')
    if (!['stroke', 'none'].includes(String(value.hit.pointerEvents))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.hit.pointerEvents`, 'has unknown pointer-event semantics')
    if (record(value.route) && typeof value.route.closed === 'boolean' && typeof value.hit.closed === 'boolean' && value.hit.closed !== value.route.closed) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.hit.closed`, 'must match route.closed topology')
    }
  } else add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.hit`, 'must be typed hit geometry')
  if (Array.isArray(value.labels)) {
    if (value.labels.length > MAX_SCENE_NODES) add(state.diagnostics, 'SCENE_BOUNDS', `${path}.labels`, 'contains too many connector labels')
    for (let index = 0; index < Math.min(value.labels.length, MAX_SCENE_NODES); index++) {
      const label = value.labels[index]
      if (!record(label)) {
        add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.labels[${index}]`, 'must be a label descriptor')
        continue
      }
      if (state.external) rejectUnknownKeys(label, [
        'id', 'text', 'anchor', 'bounds', 'halo', 'clearance', 'paint',
        'fontSize', 'textAnchor', 'visual',
      ], `${path}.labels[${index}]`, state.diagnostics)
      if (label.id !== undefined) boundedString(label.id, `${path}.labels[${index}].id`, state.diagnostics, { externalId: state.external })
      boundedString(label.text, `${path}.labels[${index}].text`, state.diagnostics, { empty: true, max: MAX_TEXT_LENGTH })
      if (state.aggregateBudgets) consumeStringBudget(state.budget, 'textBytes', 'textExceeded', label.text, `${path}.labels[${index}].text`, state.diagnostics, MAX_TEXT_BYTES, 'Scene text values')
      if (label.anchor !== undefined) validatePoint(label.anchor, `${path}.labels[${index}].anchor`, state.diagnostics, state.budget, state.external)
      if (label.bounds !== undefined) {
        if (!record(label.bounds)) {
          add(state.diagnostics, 'SCENE_BOUNDS', `${path}.labels[${index}].bounds`, 'must be a finite ordered box')
        } else {
          if (state.external) rejectUnknownKeys(label.bounds, ['x0', 'y0', 'x1', 'y1'], `${path}.labels[${index}].bounds`, state.diagnostics)
          for (const field of ['x0', 'y0', 'x1', 'y1'] as const) finite(label.bounds[field], `${path}.labels[${index}].bounds.${field}`, state.diagnostics)
          if (typeof label.bounds.x0 === 'number' && typeof label.bounds.x1 === 'number' && label.bounds.x0 > label.bounds.x1) {
            add(state.diagnostics, 'SCENE_BOUNDS', `${path}.labels[${index}].bounds`, 'x0 must not exceed x1')
          }
          if (typeof label.bounds.y0 === 'number' && typeof label.bounds.y1 === 'number' && label.bounds.y0 > label.bounds.y1) {
            add(state.diagnostics, 'SCENE_BOUNDS', `${path}.labels[${index}].bounds`, 'y0 must not exceed y1')
          }
        }
      }
      if (label.clearance !== undefined) finite(label.clearance, `${path}.labels[${index}].clearance`, state.diagnostics, { nonNegative: true })
      if (label.block !== undefined && (!record(label.block) || !isRetainedPixelText(label.block))) add(state.diagnostics, 'SCENE_FIDELITY', `${path}.labels[${index}].block`, 'must retain the actual immutable pixel text preparation')
      if (label.fontSize !== undefined) finite(label.fontSize, `${path}.labels[${index}].fontSize`, state.diagnostics, { positive: true })
      if (label.fontWeight !== undefined) finite(label.fontWeight, `${path}.labels[${index}].fontWeight`, state.diagnostics, { positive: true })
      if (label.letterSpacing !== undefined) finite(label.letterSpacing, `${path}.labels[${index}].letterSpacing`, state.diagnostics)
      if (label.display !== undefined && label.display !== 'literal' && label.display !== 'formatted') {
        add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.labels[${index}].display`, 'must be literal or formatted')
      }
      if (label.textAnchor !== undefined && !['start', 'middle', 'end'].includes(String(label.textAnchor))) {
        add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.labels[${index}].textAnchor`, 'must be start, middle, or end')
      }
      if (label.paint !== undefined) validatePaint(label.paint, `${path}.labels[${index}].paint`, state.diagnostics, state.external)
      if (label.halo !== undefined) {
        if (!record(label.halo)) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.labels[${index}].halo`, 'must be a halo descriptor')
        else {
          if (state.external) rejectUnknownKeys(label.halo, ['color', 'width'], `${path}.labels[${index}].halo`, state.diagnostics)
          finite(label.halo.width, `${path}.labels[${index}].halo.width`, state.diagnostics, { nonNegative: true })
          if (label.halo.color !== undefined && safeCssPaint(label.halo.color) === undefined) {
            add(state.diagnostics, 'SCENE_PAINT', `${path}.labels[${index}].halo.color`, 'must be a safe non-fetching CSS paint')
          }
        }
      }
      if (label.visual !== undefined) {
        if (!record(label.visual) || !['inline', 'companion'].includes(String(label.visual.kind))) {
          add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.labels[${index}].visual`, 'must be inline or companion label ownership')
        } else if (label.visual.kind === 'companion') {
          const referencePath = `${path}.labels[${index}].visual.markId`
          if (boundedString(label.visual.markId, referencePath, state.diagnostics, { externalId: state.external })) {
            state.companionLabelReferences.push({ id: label.visual.markId as string, path: referencePath })
          }
        } else if (label.anchor === undefined || label.paint === undefined || label.fontSize === undefined || label.textAnchor === undefined) {
          add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.labels[${index}].visual`, 'inline labels require anchor, paint, fontSize, and textAnchor')
        }
      }
    }
  }
  if (record(value.markers)) {
    if (!Array.isArray(value.markers.mid)) add(state.diagnostics, 'SCENE_MARKER', `${path}.markers.mid`, 'must be an array')
    if (Array.isArray(value.markers.mid) && value.markers.mid.length > MAX_SCENE_NODES) add(state.diagnostics, 'SCENE_BOUNDS', `${path}.markers.mid`, 'contains too many mid markers')
    const markers: Array<[unknown, string]> = [
      [value.markers.start, `${path}.markers.start`],
      [value.markers.end, `${path}.markers.end`],
    ]
    if (Array.isArray(value.markers.mid)) {
      for (let index = 0; index < Math.min(value.markers.mid.length, MAX_SCENE_NODES); index++) {
        markers.push([value.markers.mid[index], `${path}.markers.mid[${index}]`])
      }
    }
    for (const [marker, markerPath] of markers) {
      if (marker === undefined) continue
      if (validateMarker(marker, markerPath, state.diagnostics, state.external, state.budget) && record(marker) && typeof marker.id === 'string') {
        state.markerReferences.push({ id: marker.id, path: `${markerPath}.id`, marker: marker as unknown as MarkerDescriptor })
      }
    }
  } else add(state.diagnostics, 'SCENE_MARKER', `${path}.markers`, 'must be a typed marker set')
  // A native mark is transient: its source fields above were checked and
  // its derived payload never escapes admission. Only the exact registered
  // getter is trusted; full Scenes and explicit checks materialize it.
  if (!state.external && !state.crossChecks
    && state.native && deferredTerminalProjectionInput(value) !== undefined) return
  if (record(value.terminalProjection)) {
    if (!['native', 'emulated', 'projected', 'lossy', 'unsupported'].includes(String(value.terminalProjection.realization))) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.realization`, 'has an unknown realization')
    }
    if (!['line', 'polyline', 'path'].includes(String(value.terminalProjection.topology))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.topology`, 'has an unknown topology')
    validateGeometry(value.terminalProjection.geometry, `${path}.terminalProjection.geometry`, state.diagnostics, false, 0, undefined, state.external)
    if (!['forward', 'reverse', 'bidirectional', 'undirected', 'self'].includes(String(value.terminalProjection.direction))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.direction`, 'has an unknown direction')
    if (!['solid', 'dotted', 'dashed', 'thick', 'invisible'].includes(String(value.terminalProjection.lineStyle))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.lineStyle`, 'has an unknown line style')
    for (const field of ['labels', 'strokeLosses', 'diagnostics'] as const) {
      if (!Array.isArray(value.terminalProjection[field])) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.${field}`, 'must be an array')
    }
    if (!record(value.terminalProjection.markers) || !Array.isArray(value.terminalProjection.markers.mid)) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.markers`, 'must contain a mid-marker array')
    }
    if (!record(value.terminalProjection.markerPlacements)) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.markerPlacements`, 'must contain typed start/mid/end marker placements')
    } else {
      for (const position of ['start', 'mid', 'end'] as const) {
        const placements = value.terminalProjection.markerPlacements[position]
        if (!Array.isArray(placements)) {
          add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.markerPlacements.${position}`, 'must be an array')
          continue
        }
        for (let index = 0; index < Math.min(placements.length, MAX_SCENE_NODES); index++) {
          const placement = placements[index]
          if (!record(placement)) {
            add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.markerPlacements.${position}[${index}]`, 'must be a marker placement')
            continue
          }
          boundedString(placement.markerId, `${path}.terminalProjection.markerPlacements.${position}[${index}].markerId`, state.diagnostics, { externalId: state.external })
          validatePoint(placement.point, `${path}.terminalProjection.markerPlacements.${position}[${index}].point`, state.diagnostics, undefined, state.external)
          finite(placement.contourIndex, `${path}.terminalProjection.markerPlacements.${position}[${index}].contourIndex`, state.diagnostics, { nonNegative: true })
        }
      }
    }
    for (const field of ['endpoints', 'route', 'stroke', 'hit'] as const) {
      if (!record(value.terminalProjection[field])) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.${field}`, 'must preserve typed connector semantics')
    }
  } else add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection`, 'must be a terminal projection')
  // External documents are compared with a freshly rebuilt canonical node in
  // validateCanonicalExternalScene. Internal lowerings need the same invariant
  // here because they intentionally bypass the external builder.
  if (!state.external && state.crossChecks) validateConnectorProjectionConsistency(value, path, state)
}

export function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]))
  }
  if (!record(left) || !record(right)) return false
  const leftKeys = Object.keys(left).filter(key => left[key] !== undefined).sort()
  const rightKeys = Object.keys(right).filter(key => right[key] !== undefined).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]))
}

function validateConnectorProjectionConsistency(
  value: Record<string, unknown>,
  path: string,
  state: ValidationState,
): void {
  if (!record(value.route)
    || !record(value.stroke)
    || !record(value.markers)
    || !Array.isArray(value.markers.mid)
    || !Array.isArray(value.labels)
    || !record(value.hit)
    || !record(value.endpoints)
    || !record(value.relationship)
    || !record(value.terminalProjection)
    || !Array.isArray(value.terminalProjection.diagnostics)) return

  const connector = value as unknown as ConnectorMark
  const geometry = connector.route.geometry
  const anchors = connectorEndpointAnchors(geometry, connector.route.closed)
  const expectedStart = anchors.starts[0]
  const expectedEnd = anchors.ends.at(-1)
  for (const [field, actual, expected] of [
    ['start', connector.endpoints.start?.point, expectedStart],
    ['end', connector.endpoints.end?.point, expectedEnd],
  ] as const) {
    if (actual && expected && !sameConnectorPoint(actual, expected)) {
      add(state.diagnostics, 'SCENE_FIDELITY', `${path}.endpoints.${field}.point`, 'must equal the endpoint derived from connector geometry')
    }
  }
  const derivedContours = connectorContourSemantics(geometry, connector.route.closed)
  if (connector.route.contours.length !== derivedContours.length) {
    add(state.diagnostics, 'SCENE_FIDELITY', `${path}.route.contours`, 'must match the geometry-derived contour count')
  }
  const linearGeometry = !connectorGeometryHasCurves(geometry)
  for (let index = 0; index < Math.min(connector.route.contours.length, derivedContours.length); index++) {
    const actual = connector.route.contours[index]!
    const expected = derivedContours[index]!
    if (!sameConnectorPoint(actual.start, expected.start)
      || !sameConnectorPoint(actual.end, expected.end)
      || actual.closed !== expected.closed) {
      add(state.diagnostics, 'SCENE_FIDELITY', `${path}.route.contours[${index}]`, 'must match geometry-derived endpoint topology')
    }
    if (linearGeometry) {
      for (const field of ['startTangent', 'endTangent'] as const) {
        const actualTangent = actual[field]
        const expectedTangent = expected[field]
        if ((actualTangent === undefined) !== (expectedTangent === undefined)
          || (actualTangent && expectedTangent && !sameConnectorPoint(actualTangent, expectedTangent, 1e-9))) {
          add(state.diagnostics, 'SCENE_FIDELITY', `${path}.route.contours[${index}].${field}`, 'must match the tangent derived from linear route geometry')
        }
      }
    }
  }
  const contourStart = connector.route.contours[0]?.startTangent
  const contourEnd = connector.route.contours.at(-1)?.endTangent
  for (const [field, actual, expected] of [
    ['startTangent', connector.route.startTangent, contourStart],
    ['endTangent', connector.route.endTangent, contourEnd],
  ] as const) {
    if ((actual === undefined) !== (expected === undefined)
      || (actual && expected && !sameConnectorPoint(actual, expected, 1e-9))) {
      add(state.diagnostics, 'SCENE_FIDELITY', `${path}.route.${field}`, 'must equal the corresponding contour tangent authority')
    }
  }

  try {
    const expected = deriveConnectorTerminalProjection({
      geometry,
      lineStyle: connector.lineStyle,
      endpoints: connector.endpoints,
      relationship: connector.relationship,
      route: connector.route,
      stroke: connector.stroke,
      markers: connector.markers,
      labels: connector.labels,
      hit: connector.hit,
      ...(connector.transform ? { transform: connector.transform } : {}),
      additionalDiagnostics: connector.terminalProjection.diagnostics.slice(1),
    })
    if (!structurallyEqual(connector.terminalProjection, expected)) {
      add(state.diagnostics, 'SCENE_FIDELITY', `${path}.terminalProjection`, 'must equal the canonical projection derived from connector semantics')
    }
  } catch (error) {
    add(state.diagnostics, 'SCENE_FIDELITY', `${path}.terminalProjection`, error instanceof Error ? error.message : String(error))
  }
}

/** External structured marks have exactly one backend-owned SVG projection. */
function collectPaintResourceReferences(paint: unknown, path: string, references: Array<{ id: string; path: string }>): void {
  if (!record(paint)) return
  for (const key of ['fill', 'stroke'] as const) {
    const id = localPaintResourceId(paint[key])
    if (id) references.push({ id, path: `${path}.${key}` })
  }
}

function localPaintResourceReferences(node: unknown, path: string, references: Array<{ id: string; path: string }>): void {
  if (!record(node)) return
  if (node.kind === 'connector') {
    if (record(node.stroke)) {
      const id = localPaintResourceId(node.stroke.color)
      if (id) references.push({ id, path: `${path}.stroke.color` })
    }
    if (Array.isArray(node.labels)) {
      for (let index = 0; index < Math.min(node.labels.length, MAX_SCENE_NODES); index++) {
        const label = node.labels[index]
        if (record(label)) collectPaintResourceReferences(label.paint, `${path}.labels[${index}].paint`, references)
      }
    }
  } else {
    collectPaintResourceReferences(node.paint, `${path}.paint`, references)
  }
}

/** The rule set `validateSceneDoc` applies to a document under `options`. */
export function sceneValidationMode(value: unknown, options: SceneValidationOptions = {}): 'internal' | 'external' {
  if (options.mode === 'external' || options.mode === 'internal') return options.mode
  const family = record(value) && typeof value.family === 'string' ? parseExtensionId(value.family) : undefined
  return family?.kind === 'family' ? 'external' : 'internal'
}

/** Incremental admission for built-in lowerings. No submitted mark is retained.
 * Groups are shallow headers; submit each child separately, in any order.
 * The caller reports final nesting depth and actual semantic enclosures while
 * composing fragments, then applies the final SVG security and byte gates.
 */
export interface NativeSceneValidator {
  /** Rejects invalid source fields before writing; groups must have children: []. */
  node(node: SceneNode, depth?: number): string
  depth(depth: number): void
  enclosure(artworkId: string, owner: SceneOwner): void
  /** Checks the full composed group limit without recounting its child bytes. */
  serialization(svg: string): void
  finish(): SceneValidationResult
}

export function createNativeSceneValidator(
  header: Omit<SceneDoc, 'parts'>,
  options: { readonly crossChecks?: boolean } = {},
): NativeSceneValidator {
  const diagnostics: MutableDiagnostic[] = []
  validateSceneHeader(header, false, diagnostics)
  if (sceneValidationMode(header) === 'external') add(diagnostics, 'SCENE_DOCUMENT', 'scene.family', 'native admission requires a built-in family')
  if (diagnostics.length > 0) throw new SceneValidationError(diagnostics)
  const native = { artwork: [] as Array<{ id: string; owner: SceneOwner; path: string }>, groups: new Set<string>(), enclosures: new Map<string, SceneOwner>() }
  const state = { ...createValidationState(diagnostics, false, options.crossChecks ?? false, true), native }
  let result: SceneValidationResult | undefined
  const open = (): void => {
    if (result) throw new Error('Native Scene validation has already finished')
    if (diagnostics.length > 0) throw new SceneValidationError(diagnostics)
  }
  const depth = (value: number): void => {
    open()
    if (!Number.isInteger(value) || value < 0 || value > MAX_SCENE_DEPTH) {
      add(diagnostics, 'SCENE_BOUNDS', 'scene.depth', `must be an integer nesting depth between 0 and ${MAX_SCENE_DEPTH}`)
      throw new SceneValidationError(diagnostics)
    }
  }
  return {
    node(node, nesting = 0) {
      open()
      depth(nesting)
      if (node.kind === 'group' && (!Array.isArray(node.children) || node.children.length !== 0)) {
        add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'native groups must be shallow headers with separately submitted children')
        throw new SceneValidationError(diagnostics)
      }
      const path = `scene.parts[${state.nodeCount}]`
      validateNode(node, path, state, nesting)
      // Typed leaves must be structurally admissible before any writer runs.
      if (diagnostics.length > 0) throw new SceneValidationError(diagnostics)
      const serialized = node.kind === 'document' ? sceneNodeSerialization(node) : validateNodeSerialization(node, path, state)
      if (diagnostics.length > 0) throw new SceneValidationError(diagnostics)
      return serialized!
    },
    depth,
    enclosure(artworkId, owner) {
      open()
      boundedString(artworkId, 'scene.enclosure.id', diagnostics)
      boundedString(owner.id, 'scene.enclosure.owner.id', diagnostics)
      const prior = native.enclosures.get(artworkId)
      if (prior && (prior.id !== owner.id || prior.role !== owner.role)) {
        add(diagnostics, 'SCENE_FIDELITY', 'scene.enclosure', 'artwork cannot have conflicting semantic enclosures')
      } else if (native.enclosures.size >= MAX_SCENE_NODES) {
        add(diagnostics, 'SCENE_BOUNDS', 'scene.enclosure', 'contains too many semantic enclosure relations')
      } else native.enclosures.set(artworkId, { id: owner.id, role: owner.role })
      if (diagnostics.length > 0) throw new SceneValidationError(diagnostics)
    },
    serialization(svg) {
      open()
      if (boundedUtf8ByteLength(svg, MAX_SERIALIZATION_BYTES_PER_NODE) > MAX_SERIALIZATION_BYTES_PER_NODE) {
        add(diagnostics, 'SCENE_DOCUMENT', 'scene.serialization', 'has an oversized SVG serialization')
        throw new SceneValidationError(diagnostics)
      }
    },
    finish() {
      if (result) return result
      validateAggregateReferences(state)
      for (const artwork of native.artwork) {
        const enclosing = native.enclosures.get(artwork.id)
        if (!enclosing || enclosing.id !== artwork.owner.id || enclosing.role !== artwork.owner.role
          || !native.groups.has(JSON.stringify([enclosing.id, enclosing.role]))) {
          add(diagnostics, 'SCENE_FIDELITY', artwork.path, 'owned artwork without DOM identity must be inside its matching semantic group')
        }
      }
      result = Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics.map(item => Object.freeze(item))) })
      return result
    },
  }
}

function validateAggregateReferences(state: ValidationState): void {
  for (const reference of state.paintReferences) {
    if (!state.gradientIds.has(reference.id)) add(state.diagnostics, 'SCENE_REFERENCE', reference.path, `references undeclared gradient "${reference.id}"`)
  }
  for (const reference of state.ownerReferences) if (!state.subjects.has(reference.key)) add(state.diagnostics, 'SCENE_REFERENCE', reference.path, 'must reference an actual Scene subject identity and role')
  for (const reference of state.companionLabelReferences) {
    const target = state.ids.get(reference.id)
    if (!target) add(state.diagnostics, 'SCENE_REFERENCE', reference.path, `references unknown companion Text mark "${reference.id}"`)
    else if (target.kind !== 'text') add(state.diagnostics, 'SCENE_REFERENCE', reference.path, `must reference a Text mark; "${reference.id}" is a ${target.kind} mark`)
  }
}

function createValidationState(diagnostics: MutableDiagnostic[], external: boolean, crossChecks: boolean, aggregateBudgets = external): ValidationState {
  return {
    diagnostics,
    external,
    aggregateBudgets,
    paintReferences: [],
    ids: new Map(),
    subjects: new Set(),
    ownerReferences: [],
    domIds: new Map(),
    markerIds: new Map(),
    gradientIds: new Map(),
    markerReferences: [],
    endpointReferences: [],
    companionLabelReferences: [],
    budget: {
      textBytes: 0,
      serializationBytes: 0,
      points: 0,
      textExceeded: false,
      serializationExceeded: false,
      pointsExceeded: false,
      pointCollections: new WeakSet(),
    },
    crossChecks,
    nodeCount: 0,
  }
}

function validateSceneHeader(value: Record<string, unknown>, external: boolean, diagnostics: MutableDiagnostic[]): { widthOk: boolean; heightOk: boolean } {
  boundedString(value.family, 'scene.family', diagnostics)
  const widthOk = finite(value.width, 'scene.width', diagnostics, external ? { positive: true } : { nonNegative: true })
  const heightOk = finite(value.height, 'scene.height', diagnostics, external ? { positive: true } : { nonNegative: true })
  if (value.transparent !== undefined && typeof value.transparent !== 'boolean') add(diagnostics, 'SCENE_DOCUMENT', 'scene.transparent', 'must be boolean')
  if (!record(value.colors)) add(diagnostics, 'SCENE_DOCUMENT', 'scene.colors', 'must be a DiagramColors object')
  else {
    if (external) {
      rejectUnknownKeys(value.colors, [
        'bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border',
        'font', 'shadow', 'embedFontImport',
      ], 'scene.colors', diagnostics)
    }
    for (const key of ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'] as const) {
      if ((key === 'bg' || key === 'fg' || value.colors[key] !== undefined) && safeCssPaint(value.colors[key]) === undefined) {
        add(diagnostics, 'SCENE_PAINT', `scene.colors.${key}`, 'must be a safe non-fetching CSS paint')
      }
    }
    if (value.colors.font !== undefined && safeCssFontFamily(value.colors.font) === undefined) {
      add(diagnostics, 'SCENE_SECURITY', 'scene.colors.font', 'must be a safe non-fetching font family')
    }
    if (value.colors.shadow !== undefined && typeof value.colors.shadow !== 'boolean') {
      add(diagnostics, 'SCENE_DOCUMENT', 'scene.colors.shadow', 'must be boolean')
    }
    if (value.colors.embedFontImport !== undefined && typeof value.colors.embedFontImport !== 'boolean') {
      add(diagnostics, 'SCENE_DOCUMENT', 'scene.colors.embedFontImport', 'must be boolean')
    }
  }
  return { widthOk, heightOk }
}

/** Shared document traversal. Only the full public Scene consumer supplies
 * external document/readback rules; native consumers cannot admit them. */
export interface ExternalSceneDocumentChecks {
  document(value: Record<string, unknown>, state: ValidationState, widthOk: boolean, heightOk: boolean): string | undefined
  canonical(scene: SceneDoc, diagnostics: SceneValidationDiagnostic[]): void
}

export function validateSceneDocument(value: unknown, options: SceneValidationOptions, crossChecks: boolean, externalChecks?: ExternalSceneDocumentChecks): SceneValidationResult {
  const diagnostics: MutableDiagnostic[] = []
  if (!record(value)) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([{ code: 'SCENE_DOCUMENT', path: 'scene', message: 'must be a Scene document object' } as const]),
    })
  }
  const external = sceneValidationMode(value, options) === 'external'
  if (external && !externalChecks) {
    add(diagnostics, 'SCENE_DOCUMENT', 'scene.family', 'source-only browser admission requires a built-in family')
    return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) })
  }
  if (external) rejectUnknownKeys(value, ['family', 'width', 'height', 'colors', 'transparent', 'parts'], 'scene', diagnostics)
  const { widthOk, heightOk } = validateSceneHeader(value, external, diagnostics)
  if (!Array.isArray(value.parts)) {
    add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'must be an array')
  } else {
    const state = createValidationState(diagnostics, external, crossChecks)
    if (value.parts.length > MAX_SCENE_NODES) add(diagnostics, 'SCENE_BOUNDS', 'scene.parts', 'contains too many top-level Scene nodes')
    for (let index = 0; index < Math.min(value.parts.length, MAX_SCENE_NODES); index++) {
      validateNode(value.parts[index], `scene.parts[${index}]`, state, 0)
    }
    const externalSvg = external ? externalChecks!.document(value, state, widthOk, heightOk) : undefined
    validateAggregateReferences(state)

    if (diagnostics.length === 0 && external) {
      externalChecks!.canonical(value as unknown as SceneDoc, diagnostics)
    }
    // The security check inspects the serialized Scene; for an internal Scene
    // the final output-security gate already inspects the document a render
    // actually emits, so it runs with the cross-checks. Mark serializations
    // need no fidelity comparison: the writer draws them from their fields.
    if (diagnostics.length === 0 && crossChecks) {
      const scene = value as unknown as SceneDoc
      try {
        const svg = external ? externalSvg : scene.parts.map(sceneNodeSerialization).join('\n')
        if (svg !== undefined) applyOutputSecurityPolicy(svg, external ? 'strict' : 'default')
      } catch (error) {
        add(diagnostics, 'SCENE_SECURITY', 'scene', error instanceof Error ? error.message : String(error))
      }
    }
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics.map(item => Object.freeze(item))) })
}
