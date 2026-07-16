/** Runtime admission checks for the Scene contract.
 *
 * Validation is deliberately non-mutating. Built-in lowerings carry a
 * canonical backend-private projection; external family scenes receive stricter containment,
 * reference, and non-fetching checks before a backend can observe them.
 */

import { applyOutputSecurityPolicy } from '../output-security.ts'
import { buildStyleBlock, svgOpenTag, type DiagramColors } from '../theme.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import { safeCssPaint } from '../shared/css-color.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import { parseExtensionId } from '../shared/extension-identity.ts'
import { nodeWorldBounds } from './bounds.ts'
import { canonicalExternalNode } from './external-projection.ts'
import { sceneFidelityProblems } from './fidelity.ts'
import type {
  Geometry,
  ConnectorMark,
  MarkPaint,
  MarkerDescriptor,
  SceneDoc,
  SceneNode,
  SceneRole,
  SemanticChannels,
} from './ir.ts'
import { deriveConnectorTerminalProjection } from './connector-terminal.ts'
import {
  connectorContourSemantics,
  connectorEndpointAnchors,
  connectorGeometryHasCurves,
  sameConnectorPoint,
} from './connector-geometry.ts'
import { assertRenderableMarker, serializeMarkerResources } from './marker-resources.ts'
import { BUILTIN_SCENE_ROLE_TRAITS, sceneRoleTraits } from './roles.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { canonicalizeSceneNodeSerialization, sceneNodeSerialization } from './serialization.ts'

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
  if (boundedUtf8ByteLength(value, MAX_FINAL_SVG_BYTES) > MAX_FINAL_SVG_BYTES) {
    throw new RangeError(`${stage} exceeds the ${MAX_FINAL_SVG_BYTES}-byte final SVG limit`)
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function add(
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
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) add(diagnostics, 'SCENE_ID', path, 'contains a control character')
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
  const numericMatch = text?.match(options.length
    ? /^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)(?:px)?$/
    : /^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/)
  const parsed = typeof value === 'number' ? value : numericMatch ? Number(numericMatch[1]) : Number.NaN
  if (!Number.isFinite(parsed)) {
    if (typeof value === 'string' && /^var\(--[a-z0-9_-]+(?:,\s*[-+]?\d*\.?\d+)?\)$/i.test(value.trim())) return
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
    if (paint !== undefined && safeCssPaint(paint) === undefined) {
      add(diagnostics, 'SCENE_PAINT', `${path}.${key}`, 'must be a safe non-fetching CSS paint')
    }
  }
  numericCss(value.strokeWidth, `${path}.strokeWidth`, diagnostics, { nonNegative: true, length: true })
  numericCss(value.strokeDashoffset, `${path}.strokeDashoffset`, diagnostics, { length: true })
  numericCss(value.strokeMiterlimit, `${path}.strokeMiterlimit`, diagnostics, { nonNegative: true })
  numericCss(value.opacity, `${path}.opacity`, diagnostics, { unitInterval: true })
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
  if (budget?.pointCollections.has(value)) return
  budget?.pointCollections.add(value)
  if (value.length < minimum) add(diagnostics, 'SCENE_BOUNDS', path, `must contain at least ${minimum} points`)
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

interface ValidationState {
  readonly diagnostics: MutableDiagnostic[]
  readonly external: boolean
  readonly ids: Map<string, { path: string; kind: string }>
  readonly domIds: Map<string, string>
  readonly markerIds: Map<string, MarkerDescriptor>
  readonly markerReferences: Array<{ id: string; path: string; marker: MarkerDescriptor }>
  readonly endpointReferences: Array<{ id: string; path: string }>
  readonly companionLabelReferences: Array<{ id: string; path: string }>
  readonly budget: ValidationBudget
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

function validateNode(value: unknown, path: string, state: ValidationState, depth: number): void {
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
  if (!['shape', 'connector', 'text', 'group', 'document'].includes(kind)) {
    add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.kind`, `unknown Scene node kind "${kind}"`)
    return
  }
  if (state.external && depth > 0 && kind === 'document') {
    add(state.diagnostics, 'SCENE_DOCUMENT', path, `${kind} marks must be top-level document furniture`)
  }
  if (state.external) {
    const base = ['kind', 'id', 'role', 'identity', 'accessibility', 'channels', 'transform']
    const fields: Record<string, readonly string[]> = {
      shape: [...base, 'geometry', 'paint'],
      text: [...base, 'text', 'x', 'y', 'fontSize', 'anchor', 'paint'],
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
    if (state.external && prior) add(state.diagnostics, 'SCENE_ID', `${path}.domId`, `duplicates DOM id owned by ${prior}`)
    else if (state.external && marker) add(state.diagnostics, 'SCENE_ID', `${path}.domId`, `collides with marker resource "${value.domId}"`)
    else state.domIds.set(value.domId, `${path}.domId`)
  }
  validateRole(kind, value.role, `${path}.role`, state)
  validateChannels(value.channels, `${path}.channels`, state.diagnostics)
  let serialized: string | undefined
  try {
    serialized = sceneNodeSerialization(value as unknown as SceneNode)
    if (boundedUtf8ByteLength(serialized, MAX_SERIALIZATION_BYTES_PER_NODE) > MAX_SERIALIZATION_BYTES_PER_NODE) {
      add(state.diagnostics, 'SCENE_DOCUMENT', path, 'has an oversized SVG serialization')
    }
  } catch (error) {
    add(state.diagnostics, 'SCENE_DOCUMENT', path, error instanceof Error ? error.message : String(error))
  }
  if (state.external && serialized !== undefined) {
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
  if (value.transform !== undefined) {
    if (!record(value.transform) || value.transform.kind !== 'rotate') {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.transform`, 'must be a rotate transform')
    } else {
      finite(value.transform.angle, `${path}.transform.angle`, state.diagnostics)
      finite(value.transform.cx, `${path}.transform.cx`, state.diagnostics)
      finite(value.transform.cy, `${path}.transform.cy`, state.diagnostics)
    }
    if (state.external) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.transform`, 'external Scene transforms are not exposed by the declarative builder')
  }

  if (kind === 'shape') {
    validateGeometry(value.geometry, `${path}.geometry`, state.diagnostics, false, 0, state.budget, state.external)
    if (state.external && record(value.geometry) && (value.geometry.kind === 'path' || value.geometry.kind === 'compound')) {
      add(state.diagnostics, 'SCENE_BOUNDS', `${path}.geometry`, 'external shapes must use a directly bounded structured geometry')
    }
    validatePaint(value.paint, `${path}.paint`, state.diagnostics, state.external)
    return
  }
  if (kind === 'text') {
    boundedString(value.text, `${path}.text`, state.diagnostics, { empty: true, max: MAX_TEXT_LENGTH })
    if (state.external) consumeStringBudget(state.budget, 'textBytes', 'textExceeded', value.text, `${path}.text`, state.diagnostics, MAX_TEXT_BYTES, 'Scene text values')
    finite(value.x, `${path}.x`, state.diagnostics); finite(value.y, `${path}.y`, state.diagnostics)
    finite(value.fontSize, `${path}.fontSize`, state.diagnostics, { positive: true })
    if (!['start', 'middle', 'end'].includes(String(value.anchor))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.anchor`, 'must be start, middle, or end')
    validatePaint(value.paint, `${path}.paint`, state.diagnostics, state.external)
    return
  }
  if (kind === 'group') {
    if (!Array.isArray(value.children)) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.children`, 'must be an array')
      return
    }
    if (value.children.length > MAX_SCENE_NODES) add(state.diagnostics, 'SCENE_BOUNDS', `${path}.children`, 'contains too many Scene nodes')
    const childCount = Math.min(value.children.length, Math.max(0, MAX_SCENE_NODES - state.nodeCount + 1))
    for (let index = 0; index < childCount; index++) {
      const child = value.children[index]
      if (!record(child)) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.children[${index}]`, 'must wrap a Scene node')
      else {
        finite(child.indent, `${path}.children[${index}].indent`, state.diagnostics, { nonNegative: true })
        validateNode(child.node, `${path}.children[${index}].node`, state, depth + 1)
      }
    }
    if (state.external && (typeof value.open !== 'string' || !/^<g(?:\s|>)/.test(value.open) || value.close !== '</g>')) {
      add(state.diagnostics, 'SCENE_SECURITY', path, 'external containers must use a generated <g> wrapper')
    }
    return
  }
  if (kind === 'document') {
    if (!['open', 'title', 'description', 'definitions', 'content', 'close'].includes(String(value.element))) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.element`, 'has an unknown document element')
    }
    if (value.markerResources !== undefined) {
      if (!Array.isArray(value.markerResources)) add(state.diagnostics, 'SCENE_MARKER', `${path}.markerResources`, 'must be an array')
      else {
        if (value.markerResources.length > MAX_SCENE_NODES) add(state.diagnostics, 'SCENE_BOUNDS', `${path}.markerResources`, 'contains too many marker resources')
        for (let index = 0; index < Math.min(value.markerResources.length, MAX_SCENE_NODES); index++) {
          const marker = value.markerResources[index]
          const markerPath = `${path}.markerResources[${index}]`
          if (validateMarker(marker, markerPath, state.diagnostics, state.external, state.budget) && typeof marker.id === 'string') {
            const prior = state.markerIds.get(marker.id)
            const domPrior = state.domIds.get(marker.id)
            if (prior) add(state.diagnostics, 'SCENE_MARKER', `${markerPath}.id`, `duplicates marker resource "${marker.id}"`)
            else if (state.external && domPrior) add(state.diagnostics, 'SCENE_ID', `${markerPath}.id`, `collides with DOM id owned by ${domPrior}`)
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
    if (state.external && (value.element === 'title' || value.element === 'description')) {
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
    if (safeCssPaint(value.stroke.color) === undefined) add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.color`, 'must be a safe non-fetching CSS paint')
    numericCss(value.stroke.width, `${path}.stroke.width`, state.diagnostics, { nonNegative: true, length: true })
    numericCss(value.stroke.opacity, `${path}.stroke.opacity`, state.diagnostics, { unitInterval: true })
    numericCss(value.stroke.miterLimit, `${path}.stroke.miterLimit`, state.diagnostics, { nonNegative: true })
    numericCss(value.stroke.pathLength, `${path}.stroke.pathLength`, state.diagnostics, { nonNegative: true })
    if (!['butt', 'round', 'square'].includes(String(value.stroke.lineCap))) add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.lineCap`, 'has an unknown line cap')
    if (!['arcs', 'bevel', 'miter', 'miter-clip', 'round'].includes(String(value.stroke.lineJoin))) add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.lineJoin`, 'has an unknown line join')
    if (typeof value.stroke.nonScaling !== 'boolean') add(state.diagnostics, 'SCENE_PAINT', `${path}.stroke.nonScaling`, 'must be boolean')
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
      if (state.external) consumeStringBudget(state.budget, 'textBytes', 'textExceeded', label.text, `${path}.labels[${index}].text`, state.diagnostics, MAX_TEXT_BYTES, 'Scene text values')
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
      if (label.fontSize !== undefined) finite(label.fontSize, `${path}.labels[${index}].fontSize`, state.diagnostics, { positive: true })
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
  if (!state.external) validateConnectorProjectionConsistency(value, path, state)
}

function structurallyEqual(left: unknown, right: unknown): boolean {
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
function validateCanonicalExternalNode(
  node: SceneNode,
  path: string,
  diagnostics: MutableDiagnostic[],
): void {
  if (node.kind === 'document') return
  let expected: SceneNode
  try {
    expected = canonicalExternalNode(node)
  } catch (error) {
    add(diagnostics, 'SCENE_FIDELITY', path, error instanceof Error ? error.message : String(error))
    return
  }
  if (sceneNodeSerialization(node) !== sceneNodeSerialization(expected)) {
    add(diagnostics, 'SCENE_FIDELITY', path, 'must equal the canonical serialization generated from the external Scene fields')
  }
  if (!structurallyEqual(node.identity, expected.identity) || !structurallyEqual(node.accessibility, expected.accessibility)) {
    add(diagnostics, 'SCENE_FIDELITY', path, 'typed identity and accessibility must equal the canonical generated projection')
  }
  if (node.kind === 'group' && expected.kind === 'group') {
    if (node.open !== expected.open || node.close !== expected.close || node.join !== expected.join) {
      add(diagnostics, 'SCENE_FIDELITY', path, 'external containers must use the canonical generated wrapper and join')
    }
    node.children.forEach((child, index) => {
      if (child.indent !== 2) add(diagnostics, 'SCENE_FIDELITY', `${path}.children[${index}].indent`, 'external container children must use the canonical two-space indent')
      validateCanonicalExternalNode(child.node, `${path}.children[${index}].node`, diagnostics)
    })
  }
  if (node.kind === 'connector' && expected.kind === 'connector') {
    const derivedFields = ['endpoints', 'route', 'stroke', 'hit', 'terminalProjection'] as const
    for (const field of derivedFields) {
      if (!structurallyEqual(node[field], expected[field])) {
        add(diagnostics, 'SCENE_FIDELITY', `${path}.${field}`, 'must equal semantics derived by the external Scene builder')
      }
    }
    if (!structurallyEqual(node.markers, expected.markers)) {
      add(diagnostics, 'SCENE_FIDELITY', `${path}.markers`, 'must equal the canonical external start/mid/end marker projection')
    }
  }
}

function validateCanonicalExternalScene(scene: SceneDoc, diagnostics: MutableDiagnostic[]): void {
  scene.parts.forEach((node, index) => validateCanonicalExternalNode(node, `scene.parts[${index}]`, diagnostics))
}

function boundedExternalSvg(
  parts: readonly unknown[],
  diagnostics: MutableDiagnostic[],
): string | undefined {
  const chunks: string[] = []
  let bytes = Math.max(0, parts.length - 1) // one ASCII newline between chunks
  if (bytes > MAX_FINAL_SVG_BYTES) {
    add(diagnostics, 'SCENE_BOUNDS', 'scene.parts', `serialized SVG exceeds the aggregate ${MAX_FINAL_SVG_BYTES}-byte limit`)
    return undefined
  }
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (!record(part)) return undefined
    let serialized: string
    try { serialized = sceneNodeSerialization(part as unknown as SceneNode) } catch { return undefined }
    const remaining = Math.max(0, MAX_FINAL_SVG_BYTES - bytes)
    const chunkBytes = boundedUtf8ByteLength(serialized, remaining)
    if (chunkBytes > remaining) {
      add(diagnostics, 'SCENE_BOUNDS', 'scene.parts', `serialized SVG exceeds the aggregate ${MAX_FINAL_SVG_BYTES}-byte limit`)
      return undefined
    }
    bytes += chunkBytes
    chunks.push(serialized)
  }
  return chunks.join('\n')
}

/** Validate an unknown value against the current Scene behavioral contract. */
export function validateSceneDoc(value: unknown, options: SceneValidationOptions = {}): SceneValidationResult {
  const diagnostics: MutableDiagnostic[] = []
  if (!record(value)) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([{ code: 'SCENE_DOCUMENT', path: 'scene', message: 'must be a Scene document object' } as const]),
    })
  }
  const parsedFamily = typeof value.family === 'string' ? parseExtensionId(value.family) : undefined
  const external = options.mode === 'external' || (options.mode !== 'internal' && parsedFamily?.kind === 'family')
  if (external) rejectUnknownKeys(value, ['family', 'width', 'height', 'colors', 'transparent', 'parts'], 'scene', diagnostics)
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
  if (!Array.isArray(value.parts)) {
    add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'must be an array')
  } else {
    const state: ValidationState = {
      diagnostics,
      external,
      ids: new Map(),
      domIds: new Map(),
      markerIds: new Map(),
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
      nodeCount: 0,
    }
    if (value.parts.length > MAX_SCENE_NODES) add(diagnostics, 'SCENE_BOUNDS', 'scene.parts', 'contains too many top-level Scene nodes')
    for (let index = 0; index < Math.min(value.parts.length, MAX_SCENE_NODES); index++) {
      validateNode(value.parts[index], `scene.parts[${index}]`, state, 0)
    }
    const externalSvg = external && value.parts.length <= MAX_SCENE_NODES
      ? boundedExternalSvg(value.parts, diagnostics)
      : undefined
    if (external) {
      const indexed: Array<{ part: Record<string, unknown>; index: number }> = []
      for (let index = 0; index < Math.min(value.parts.length, MAX_SCENE_NODES); index++) {
        const part = value.parts[index]
        if (record(part)) indexed.push({ part, index })
      }
      const documents = indexed.filter(entry => entry.part.kind === 'document')
      const opens = documents.filter(entry => entry.part.element === 'open')
      const titles = documents.filter(entry => entry.part.element === 'title')
      const descriptions = documents.filter(entry => entry.part.element === 'description')
      const definitions = documents.filter(entry => entry.part.element === 'definitions')
      const closes = documents.filter(entry => entry.part.element === 'close')
      if (opens.length !== 1 || opens[0]?.index !== 0) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents require exactly one leading open mark')
      if (titles.length !== 1 || titles[0]?.index !== 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents require exactly one title after the open mark')
      if (descriptions.length > 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents allow at most one description')
      if (definitions.length > 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents allow at most one definitions mark')
      if (closes.length !== 1 || closes[0]?.index !== value.parts.length - 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents require exactly one trailing close')

      const furnitureEnd = 1 + titles.length + descriptions.length + definitions.length
      const expectedFurniture = [
        ...titles,
        ...descriptions,
        ...definitions,
      ].map(entry => entry.index)
      if (expectedFurniture.some((index, offset) => index !== offset + 1) || documents.some(entry => !['open', 'close'].includes(String(entry.part.element)) && entry.index > furnitureEnd)) {
        add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'title, description, and typed definitions must be contiguous leading furniture')
      }

      const title = titles[0]?.part
      if (title && (title.id !== 'external-scene-title' || title.domId !== 'external-scene-title')) {
        add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${titles[0]!.index}]`, 'external title must use the canonical generated identity')
      }
      if (title && typeof title.text === 'string') {
        const expected = canonicalizeSceneNodeSerialization(
          `<title id="external-scene-title">${escapeXml(title.text)}</title>`,
        )
        if (sceneNodeSerialization(title as unknown as SceneNode) !== expected) add(diagnostics, 'SCENE_FIDELITY', `scene.parts[${titles[0]!.index}]`, 'external title must use the canonical generated serialization')
      }
      const description = descriptions[0]?.part
      if (description && (description.id !== 'external-scene-description' || description.domId !== 'external-scene-description')) {
        add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${descriptions[0]!.index}]`, 'external description must use the canonical generated identity')
      }
      if (description && typeof description.text === 'string') {
        const expected = canonicalizeSceneNodeSerialization(
          `<desc id="${escapeAttr('external-scene-description')}">${escapeXml(description.text)}</desc>`,
        )
        if (sceneNodeSerialization(description as unknown as SceneNode) !== expected) add(diagnostics, 'SCENE_FIDELITY', `scene.parts[${descriptions[0]!.index}]`, 'external description must use the canonical generated serialization')
      }
      const definition = definitions[0]?.part
      if (definition && (definition.id !== 'external-scene-definitions' || !Array.isArray(definition.markerResources) || definition.markerResources.length === 0)) {
        add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${definitions[0]!.index}]`, 'external definitions must be the canonical non-empty typed marker resource mark')
      }
      const close = closes[0]?.part
      if (close && close.id !== 'svg-close') add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${closes[0]!.index}]`, 'external close must use the canonical generated identity')

      const open = opens[0]?.part
      if (open) {
        if (open.id !== 'external-scene-prelude') add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts[0].id', 'external open mark must use the canonical generated identity')
        try {
          const colors = value.colors as unknown as DiagramColors
          const ariaIds = ['external-scene-title', ...(descriptions.length ? ['external-scene-description'] : [])].join(' ')
          const expected = canonicalizeSceneNodeSerialization([
            svgOpenTag(value.width as number, value.height as number, colors, Boolean(value.transparent), {
              attrs: { role: 'img', 'aria-labelledby': ariaIds },
            }),
            buildStyleBlock(colors.font ?? 'Inter', false, colors.shadow, false),
          ].join('\n'))
          if (sceneNodeSerialization(open as unknown as SceneNode) !== expected) add(diagnostics, 'SCENE_SECURITY', 'scene.parts[0]', 'must be the canonical CSS-free external document serialization')
        } catch (error) {
          add(diagnostics, 'SCENE_SECURITY', 'scene.parts[0]', error instanceof Error ? error.message : String(error))
        }
      }
      for (const reference of state.markerReferences) {
        const resource = state.markerIds.get(reference.id)
        if (!resource) add(diagnostics, 'SCENE_REFERENCE', reference.path, `references undeclared marker "${reference.id}"`)
        else if (resource !== reference.marker) add(diagnostics, 'SCENE_REFERENCE', reference.path, `must reference the exact typed marker resource "${reference.id}"`)
      }
      for (const reference of state.endpointReferences) {
        if (!state.ids.has(reference.id)) add(diagnostics, 'SCENE_REFERENCE', reference.path, `references unknown Scene id "${reference.id}"`)
      }
      if (widthOk && heightOk && diagnostics.length === 0) {
        const docWidth = value.width as number
        const docHeight = value.height as number
        const visitBounds = (node: unknown, path: string): void => {
          if (!record(node)) return
          if (['shape', 'connector', 'text'].includes(String(node.kind))) {
            try {
              const bounds = nodeWorldBounds(node as unknown as SceneNode)
              if (bounds && (bounds.x0 < -1 || bounds.y0 < -1 || bounds.x1 > docWidth + 1 || bounds.y1 > docHeight + 1)) {
                add(diagnostics, 'SCENE_BOUNDS', path, `visual bounds [${bounds.x0}, ${bounds.y0}, ${bounds.x1}, ${bounds.y1}] escape the ${docWidth}x${docHeight} document`)
              }
            } catch (error) {
              add(diagnostics, 'SCENE_BOUNDS', path, error instanceof Error ? error.message : String(error))
            }
          }
          if (node.kind === 'group' && Array.isArray(node.children)) {
            for (let index = 0; index < Math.min(node.children.length, MAX_SCENE_NODES); index++) {
              const child = node.children[index]
              if (record(child)) visitBounds(child.node, `${path}.children[${index}].node`)
            }
          }
        }
        for (let index = 0; index < Math.min(value.parts.length, MAX_SCENE_NODES); index++) {
          visitBounds(value.parts[index], `scene.parts[${index}]`)
        }
      }
    }

    for (const reference of state.companionLabelReferences) {
      const target = state.ids.get(reference.id)
      if (!target) add(diagnostics, 'SCENE_REFERENCE', reference.path, `references unknown companion Text mark "${reference.id}"`)
      else if (target.kind !== 'text') add(diagnostics, 'SCENE_REFERENCE', reference.path, `must reference a Text mark; "${reference.id}" is a ${target.kind} mark`)
    }

    if (diagnostics.length === 0 && external) {
      validateCanonicalExternalScene(value as unknown as SceneDoc, diagnostics)
    }
    if (diagnostics.length === 0) {
      const scene = value as unknown as SceneDoc
      try {
        for (const problem of sceneFidelityProblems(scene)) add(diagnostics, 'SCENE_FIDELITY', 'scene', problem)
      } catch (error) {
        add(diagnostics, 'SCENE_FIDELITY', 'scene', error instanceof Error ? error.message : String(error))
      }
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

export function assertValidSceneDoc(
  value: unknown,
  options: SceneValidationOptions = {},
): asserts value is SceneDoc {
  const result = validateSceneDoc(value, options)
  if (!result.valid) throw new SceneValidationError(result.diagnostics)
}
