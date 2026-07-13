/** Runtime admission checks for the Scene contract.
 *
 * Validation is deliberately non-mutating. Built-in lowerings retain their
 * exact crisp bytes; external family scenes receive stricter containment,
 * reference, and non-fetching checks before a backend can observe them.
 */

import { applyOutputSecurityPolicy } from '../output-security.ts'
import { buildStyleBlock, svgOpenTag, type DiagramColors } from '../theme.ts'
import { escapeAttr, escapeXml } from '../multiline-utils.ts'
import { safeCssPaint } from '../shared/css-color.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import { parseExtensionId } from '../shared/extension-identity.ts'
import { nodeWorldBounds } from './bounds.ts'
import { sceneFidelityProblems } from './fidelity.ts'
import type {
  Geometry,
  MarkPaint,
  MarkerDescriptor,
  SceneDoc,
  SceneNode,
  SceneRole,
  SemanticChannels,
} from './ir.ts'
import { assertRenderableMarker, serializeMarkerResources } from './marker-resources.ts'
import { BUILTIN_SCENE_ROLE_TRAITS, sceneRoleTraits } from './roles.ts'

export const SCENE_VALIDATION_VERSION = 1 as const
export const SCENE_VALIDATION_LIMITS = Object.freeze({
  maxExtent: 1_000_000,
  maxNodes: 100_000,
  maxDepth: 64,
  maxTextLength: 1_000_000,
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
const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/
const NAMESPACED_ROLE = /^[a-z0-9][a-z0-9._/-]*:[a-z0-9][a-z0-9._/-]*$/i
const SAFE_PATH = /^[\s,0-9eE.+\-MmLlHhVvCcSsQqTtAaZz]+$/
const SAFE_DASH = /^(?:none|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?(?:[\s,]+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)*)$/

type MutableDiagnostic = SceneValidationDiagnostic

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

function validatePaint(value: unknown, path: string, diagnostics: MutableDiagnostic[]): void {
  if (!record(value)) {
    add(diagnostics, 'SCENE_PAINT', path, 'must be a paint object')
    return
  }
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
  if (value.paintOrder !== undefined && (typeof value.paintOrder !== 'string' || !/^[a-z -]+$/i.test(value.paintOrder))) {
    add(diagnostics, 'SCENE_PAINT', `${path}.paintOrder`, 'must contain paint-order keywords only')
  }
}

function validatePoint(value: unknown, path: string, diagnostics: MutableDiagnostic[]): void {
  if (!record(value)) {
    add(diagnostics, 'SCENE_FINITE', path, 'must be a point object')
    return
  }
  finite(value.x, `${path}.x`, diagnostics)
  finite(value.y, `${path}.y`, diagnostics)
}

function validatePoints(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  minimum: number,
): void {
  if (!Array.isArray(value)) {
    add(diagnostics, 'SCENE_FINITE', path, 'must be an array of points')
    return
  }
  if (value.length < minimum) add(diagnostics, 'SCENE_BOUNDS', path, `must contain at least ${minimum} points`)
  if (value.length > MAX_SCENE_NODES) add(diagnostics, 'SCENE_BOUNDS', path, 'contains too many points')
  value.forEach((point, index) => validatePoint(point, `${path}[${index}]`, diagnostics))
}

function validateGeometry(
  value: unknown,
  path: string,
  diagnostics: MutableDiagnostic[],
  marker = false,
  depth = 0,
): void {
  if (depth > MAX_SCENE_DEPTH) {
    add(diagnostics, 'SCENE_BOUNDS', path, `geometry exceeds maximum nesting depth ${MAX_SCENE_DEPTH}`)
    return
  }
  if (!record(value) || typeof value.kind !== 'string') {
    add(diagnostics, 'SCENE_DOCUMENT', path, 'must be a typed geometry object')
    return
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
      validatePoints(value.points, `${path}.points`, diagnostics, 3)
      return
    case 'polyline':
      validatePoints(value.points, `${path}.points`, diagnostics, 2)
      return
    case 'path':
      if (typeof value.d !== 'string' || value.d.length === 0 || value.d.length > MAX_TEXT_LENGTH || !SAFE_PATH.test(value.d)) {
        add(diagnostics, 'SCENE_SECURITY', `${path}.d`, 'must use the bounded non-fetching SVG path grammar')
      }
      if (value.points !== undefined) validatePoints(value.points, `${path}.points`, diagnostics, 2)
      return
    case 'compound':
      if (!Array.isArray(value.children)) {
        add(diagnostics, 'SCENE_BOUNDS', `${path}.children`, 'must be a geometry array')
        return
      }
      value.children.forEach((child, index) => validateGeometry(child, `${path}.children[${index}]`, diagnostics, marker, depth + 1))
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
): value is MarkerDescriptor {
  if (!record(value)) {
    add(diagnostics, 'SCENE_MARKER', path, 'must be a marker descriptor')
    return false
  }
  boundedString(value.id, `${path}.id`, diagnostics, { externalId: external })
  validateGeometry(value.geometry, `${path}.geometry`, diagnostics, true)
  if (external && record(value.geometry) && value.geometry.kind === 'compound' && (!Array.isArray(value.geometry.children) || value.geometry.children.length === 0)) {
    add(diagnostics, 'SCENE_BOUNDS', `${path}.geometry.children`, 'external marker compounds must contain geometry')
  }
  if (record(value.size)) {
    finite(value.size.width, `${path}.size.width`, diagnostics, { positive: true })
    finite(value.size.height, `${path}.size.height`, diagnostics, { positive: true })
  }
  if (record(value.ref)) validatePoint(value.ref, `${path}.ref`, diagnostics)
  if (value.paint !== undefined) validatePaint(value.paint, `${path}.paint`, diagnostics)
  if (record(value.viewBox)) {
    finite(value.viewBox.x, `${path}.viewBox.x`, diagnostics)
    finite(value.viewBox.y, `${path}.viewBox.y`, diagnostics)
    finite(value.viewBox.width, `${path}.viewBox.width`, diagnostics, { positive: true })
    finite(value.viewBox.height, `${path}.viewBox.height`, diagnostics, { positive: true })
  }
  if (record(value.bounds)) {
    for (const field of ['x0', 'y0', 'x1', 'y1'] as const) finite(value.bounds[field], `${path}.bounds.${field}`, diagnostics)
    if (typeof value.bounds.x0 === 'number' && typeof value.bounds.x1 === 'number' && value.bounds.x0 > value.bounds.x1) {
      add(diagnostics, 'SCENE_BOUNDS', `${path}.bounds`, 'x0 must not exceed x1')
    }
    if (typeof value.bounds.y0 === 'number' && typeof value.bounds.y1 === 'number' && value.bounds.y0 > value.bounds.y1) {
      add(diagnostics, 'SCENE_BOUNDS', `${path}.bounds`, 'y0 must not exceed y1')
    }
  }
  if (value.scale !== undefined) finite(value.scale, `${path}.scale`, diagnostics, { nonNegative: true })
  if (typeof value.orient === 'number') finite(value.orient, `${path}.orient`, diagnostics)
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
  readonly ids: Map<string, string>
  readonly markerIds: Map<string, MarkerDescriptor>
  readonly markerReferences: Array<{ id: string; path: string; marker: MarkerDescriptor }>
  readonly endpointReferences: Array<{ id: string; path: string }>
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
  if (!['shape', 'connector', 'text', 'group', 'raw', 'document', 'prelude'].includes(kind)) {
    add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.kind`, `unknown Scene node kind "${kind}"`)
    return
  }
  if (state.external && depth > 0 && (kind === 'document' || kind === 'prelude')) {
    add(state.diagnostics, 'SCENE_DOCUMENT', path, `${kind} marks must be top-level document furniture`)
  }
  if (state.external) {
    const base = ['kind', 'id', 'role', 'identity', 'accessibility', 'channels', 'transform', 'crisp']
    const fields: Record<string, readonly string[]> = {
      shape: [...base, 'geometry', 'paint'],
      text: [...base, 'text', 'x', 'y', 'fontSize', 'anchor', 'paint'],
      group: [...base, 'open', 'close', 'children', 'join'],
      raw: base,
      'document': [...base, 'element', 'text', 'domId', 'markerResources'],
      prelude: [...base, 'prelude'],
      connector: [
        ...base, 'geometry', 'lineStyle', 'paint', 'startMarker', 'endMarker',
        'endpoints', 'relationship', 'route', 'stroke', 'markers', 'labels', 'hit',
        'terminalProjection',
      ],
    }
    rejectUnknownKeys(value, fields[kind]!, path, state.diagnostics)
  }
  if (boundedString(value.id, `${path}.id`, state.diagnostics, { externalId: state.external })) {
    const prior = state.ids.get(value.id)
    if (state.external && prior) add(state.diagnostics, 'SCENE_ID', `${path}.id`, `duplicates ${prior}`)
    else state.ids.set(value.id, `${path}.id`)
  }
  validateRole(kind, value.role, `${path}.role`, state)
  validateChannels(value.channels, `${path}.channels`, state.diagnostics)
  if (typeof value.crisp !== 'string' || value.crisp.length > 5_000_000) {
    add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.crisp`, 'must be a bounded SVG projection string')
  }
  if (value.transform !== undefined) {
    if (!record(value.transform) || value.transform.kind !== 'rotate') {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.transform`, 'must be a rotate transform')
    } else {
      finite(value.transform.angle, `${path}.transform.angle`, state.diagnostics)
      finite(value.transform.cx, `${path}.transform.cx`, state.diagnostics)
      finite(value.transform.cy, `${path}.transform.cy`, state.diagnostics)
    }
  }

  if (kind === 'shape') {
    validateGeometry(value.geometry, `${path}.geometry`, state.diagnostics)
    if (state.external && record(value.geometry) && (value.geometry.kind === 'path' || value.geometry.kind === 'compound')) {
      add(state.diagnostics, 'SCENE_BOUNDS', `${path}.geometry`, 'external shapes must use a directly bounded structured geometry')
    }
    validatePaint(value.paint, `${path}.paint`, state.diagnostics)
    return
  }
  if (kind === 'text') {
    boundedString(value.text, `${path}.text`, state.diagnostics, { empty: true, max: MAX_TEXT_LENGTH })
    finite(value.x, `${path}.x`, state.diagnostics); finite(value.y, `${path}.y`, state.diagnostics)
    finite(value.fontSize, `${path}.fontSize`, state.diagnostics, { positive: true })
    if (!['start', 'middle', 'end'].includes(String(value.anchor))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.anchor`, 'must be start, middle, or end')
    validatePaint(value.paint, `${path}.paint`, state.diagnostics)
    return
  }
  if (kind === 'group') {
    if (!Array.isArray(value.children)) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.children`, 'must be an array')
      return
    }
    value.children.forEach((child, index) => {
      if (!record(child)) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.children[${index}]`, 'must wrap a Scene node')
      else {
        finite(child.indent, `${path}.children[${index}].indent`, state.diagnostics, { nonNegative: true })
        validateNode(child.node, `${path}.children[${index}].node`, state, depth + 1)
      }
    })
    if (state.external && (typeof value.open !== 'string' || !/^<g(?:\s|>)/.test(value.open) || value.close !== '</g>')) {
      add(state.diagnostics, 'SCENE_SECURITY', path, 'external containers must use a generated <g> wrapper')
    }
    return
  }
  if (kind === 'raw') {
    if (state.external) add(state.diagnostics, 'SCENE_SECURITY', path, 'raw marks are not allowed in external Scene documents')
    return
  }
  if (kind === 'prelude') {
    if (!record(value.prelude)) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.prelude`, 'must be a typed document prelude')
      return
    }
    finite(value.prelude.width, `${path}.prelude.width`, state.diagnostics, state.external ? { positive: true } : { nonNegative: true })
    finite(value.prelude.height, `${path}.prelude.height`, state.diagnostics, state.external ? { positive: true } : { nonNegative: true })
    boundedString(value.prelude.font, `${path}.prelude.font`, state.diagnostics)
    if (safeCssFontFamily(value.prelude.font) === undefined) add(state.diagnostics, 'SCENE_SECURITY', `${path}.prelude.font`, 'must be a safe non-fetching font family')
    if (!record(value.prelude.colors)) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.prelude.colors`, 'must be a DiagramColors object')
    if (typeof value.prelude.transparent !== 'boolean') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.prelude.transparent`, 'must be boolean')
    if (typeof value.prelude.hasMonoFont !== 'boolean') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.prelude.hasMonoFont`, 'must be boolean')
    if (typeof value.prelude.extraCss !== 'string') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.prelude.extraCss`, 'must be a string')
    if (state.external && value.prelude.extraCss !== '') add(state.diagnostics, 'SCENE_SECURITY', `${path}.prelude.extraCss`, 'external Scene documents cannot provide CSS')
    return
  }
  if (kind === 'document') {
    if (!['title', 'description', 'definitions', 'close'].includes(String(value.element))) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.element`, 'has an unknown document element')
    }
    if (value.markerResources !== undefined) {
      if (!Array.isArray(value.markerResources)) add(state.diagnostics, 'SCENE_MARKER', `${path}.markerResources`, 'must be an array')
      else {
        value.markerResources.forEach((marker, index) => {
          const markerPath = `${path}.markerResources[${index}]`
          if (validateMarker(marker, markerPath, state.diagnostics, state.external) && typeof marker.id === 'string') {
            const prior = state.markerIds.get(marker.id)
            if (prior) add(state.diagnostics, 'SCENE_MARKER', `${markerPath}.id`, `duplicates marker resource "${marker.id}"`)
            else state.markerIds.set(marker.id, marker)
          }
        })
        if (state.external && value.element === 'definitions') {
          try {
            const expected = `<defs>\n${serializeMarkerResources(value.markerResources as MarkerDescriptor[])}\n</defs>`
            if (value.crisp !== expected) add(state.diagnostics, 'SCENE_FIDELITY', `${path}.crisp`, 'must be generated from the typed marker resources')
          } catch {
            // The marker diagnostic above is more precise.
          }
        }
      }
    }
    if (state.external && value.element === 'close' && value.crisp !== '</svg>') {
      add(state.diagnostics, 'SCENE_SECURITY', `${path}.crisp`, 'external document close must be canonical')
    }
    return
  }

  // Connector
  validateGeometry(value.geometry, `${path}.geometry`, state.diagnostics)
  if (state.external && record(value.geometry) && value.geometry.kind === 'path' && !Array.isArray(value.geometry.points)) {
    add(state.diagnostics, 'SCENE_BOUNDS', `${path}.geometry.points`, 'external connector paths require deterministic routed points')
  }
  validatePaint(value.paint, `${path}.paint`, state.diagnostics)
  if (!['solid', 'dotted', 'dashed', 'thick', 'invisible'].includes(String(value.lineStyle))) {
    add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.lineStyle`, 'has an unknown line style')
  }
  if (record(value.endpoints)) {
    for (const field of ['from', 'to'] as const) {
      if (value.endpoints[field] !== undefined && boundedString(value.endpoints[field], `${path}.endpoints.${field}`, state.diagnostics, { externalId: state.external })) {
        state.endpointReferences.push({ id: value.endpoints[field] as string, path: `${path}.endpoints.${field}` })
      }
    }
    for (const field of ['start', 'end'] as const) {
      const endpoint = value.endpoints[field]
      if (record(endpoint)) {
        if (endpoint.point !== undefined) validatePoint(endpoint.point, `${path}.endpoints.${field}.point`, state.diagnostics)
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
    validateGeometry(value.route.geometry, `${path}.route.geometry`, state.diagnostics)
    finite(value.route.bendRadius, `${path}.route.bendRadius`, state.diagnostics, { nonNegative: true })
    if (!['authored', 'layout', 'family', 'projected'].includes(String(value.route.ownership))) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.ownership`, 'has an unknown route ownership')
    }
    if (typeof value.route.closed !== 'boolean') add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.closed`, 'must be boolean')
    if (value.route.startTangent !== undefined) validatePoint(value.route.startTangent, `${path}.route.startTangent`, state.diagnostics)
    if (value.route.endTangent !== undefined) validatePoint(value.route.endTangent, `${path}.route.endTangent`, state.diagnostics)
    if (Array.isArray(value.route.labelAnchors)) value.route.labelAnchors.forEach((point, index) => validatePoint(point, `${path}.route.labelAnchors[${index}]`, state.diagnostics))
    else add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.route.labelAnchors`, 'must be an array')
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
    validateGeometry(value.hit.geometry, `${path}.hit.geometry`, state.diagnostics)
    finite(value.hit.strokeWidth, `${path}.hit.strokeWidth`, state.diagnostics, { nonNegative: true })
    if (!['stroke', 'none'].includes(String(value.hit.pointerEvents))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.hit.pointerEvents`, 'has unknown pointer-event semantics')
  } else add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.hit`, 'must be typed hit geometry')
  if (Array.isArray(value.labels)) value.labels.forEach((label, index) => {
    if (!record(label)) return add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.labels[${index}]`, 'must be a label descriptor')
    boundedString(label.text, `${path}.labels[${index}].text`, state.diagnostics, { empty: true, max: MAX_TEXT_LENGTH })
    if (label.anchor !== undefined) validatePoint(label.anchor, `${path}.labels[${index}].anchor`, state.diagnostics)
    if (record(label.bounds)) for (const field of ['x0', 'y0', 'x1', 'y1'] as const) finite(label.bounds[field], `${path}.labels[${index}].bounds.${field}`, state.diagnostics)
  })
  if (record(value.markers)) {
    if (!Array.isArray(value.markers.mid)) add(state.diagnostics, 'SCENE_MARKER', `${path}.markers.mid`, 'must be an array')
    const markers: Array<[unknown, string]> = [
      [value.markers.start, `${path}.markers.start`],
      [value.markers.end, `${path}.markers.end`],
      ...(Array.isArray(value.markers.mid) ? value.markers.mid.map((marker, index) => [marker, `${path}.markers.mid[${index}]`] as [unknown, string]) : []),
    ]
    for (const [marker, markerPath] of markers) {
      if (marker === undefined) continue
      if (validateMarker(marker, markerPath, state.diagnostics, state.external) && record(marker) && typeof marker.id === 'string') {
        state.markerReferences.push({ id: marker.id, path: `${markerPath}.id`, marker: marker as unknown as MarkerDescriptor })
      }
    }
  } else add(state.diagnostics, 'SCENE_MARKER', `${path}.markers`, 'must be a typed marker set')
  if (record(value.terminalProjection)) {
    if (!['native', 'emulated', 'projected', 'lossy', 'unsupported'].includes(String(value.terminalProjection.realization))) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.realization`, 'has an unknown realization')
    }
    if (!['line', 'polyline', 'path'].includes(String(value.terminalProjection.topology))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.topology`, 'has an unknown topology')
    if (!['forward', 'reverse', 'bidirectional', 'undirected', 'self'].includes(String(value.terminalProjection.direction))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.direction`, 'has an unknown direction')
    if (!['solid', 'dotted', 'dashed', 'thick', 'invisible'].includes(String(value.terminalProjection.lineStyle))) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.lineStyle`, 'has an unknown line style')
    for (const field of ['labels', 'strokeLosses', 'diagnostics'] as const) {
      if (!Array.isArray(value.terminalProjection[field])) add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.${field}`, 'must be an array')
    }
    if (!record(value.terminalProjection.markers) || !Array.isArray(value.terminalProjection.markers.mid)) {
      add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection.markers`, 'must contain a mid-marker array')
    }
  } else add(state.diagnostics, 'SCENE_DOCUMENT', `${path}.terminalProjection`, 'must be a terminal projection')
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
  if (external) rejectUnknownKeys(value, ['family', 'width', 'height', 'colors', 'parts'], 'scene', diagnostics)
  boundedString(value.family, 'scene.family', diagnostics)
  const widthOk = finite(value.width, 'scene.width', diagnostics, external ? { positive: true } : { nonNegative: true })
  const heightOk = finite(value.height, 'scene.height', diagnostics, external ? { positive: true } : { nonNegative: true })
  if (!record(value.colors)) add(diagnostics, 'SCENE_DOCUMENT', 'scene.colors', 'must be a DiagramColors object')
  else {
    for (const key of ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'] as const) {
      if ((key === 'bg' || key === 'fg' || value.colors[key] !== undefined) && safeCssPaint(value.colors[key]) === undefined) {
        add(diagnostics, 'SCENE_PAINT', `scene.colors.${key}`, 'must be a safe non-fetching CSS paint')
      }
    }
    if (value.colors.font !== undefined && safeCssFontFamily(value.colors.font) === undefined) {
      add(diagnostics, 'SCENE_SECURITY', 'scene.colors.font', 'must be a safe non-fetching font family')
    }
  }
  if (!Array.isArray(value.parts)) {
    add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'must be an array')
  } else {
    const state: ValidationState = {
      diagnostics,
      external,
      ids: new Map(),
      markerIds: new Map(),
      markerReferences: [],
      endpointReferences: [],
      nodeCount: 0,
    }
    value.parts.forEach((part, index) => validateNode(part, `scene.parts[${index}]`, state, 0))
    if (external) {
      const indexed = value.parts.map((part, index) => ({ part, index })).filter(entry => record(entry.part))
      const preludes = indexed.filter(entry => entry.part.kind === 'prelude')
      const documents = indexed.filter(entry => entry.part.kind === 'document')
      const titles = documents.filter(entry => entry.part.element === 'title')
      const descriptions = documents.filter(entry => entry.part.element === 'description')
      const definitions = documents.filter(entry => entry.part.element === 'definitions')
      const closes = documents.filter(entry => entry.part.element === 'close')
      if (preludes.length !== 1 || preludes[0]?.index !== 0) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents require exactly one leading prelude')
      if (titles.length !== 1 || titles[0]?.index !== 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents require exactly one title after the prelude')
      if (descriptions.length > 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents allow at most one description')
      if (definitions.length > 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents allow at most one definitions mark')
      if (closes.length !== 1 || closes[0]?.index !== value.parts.length - 1) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'external Scene documents require exactly one trailing close')

      const furnitureEnd = 1 + titles.length + descriptions.length + definitions.length
      const expectedFurniture = [
        ...titles,
        ...descriptions,
        ...definitions,
      ].map(entry => entry.index)
      if (expectedFurniture.some((index, offset) => index !== offset + 1) || documents.some(entry => entry.part.element !== 'close' && entry.index > furnitureEnd)) {
        add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts', 'title, description, and typed definitions must be contiguous leading furniture')
      }

      const title = titles[0]?.part
      if (title && (title.id !== 'external-scene-title' || title.domId !== 'external-scene-title')) {
        add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${titles[0]!.index}]`, 'external title must use the canonical generated identity')
      }
      if (title && typeof title.text === 'string') {
        const expected = `<title id="external-scene-title">${escapeXml(title.text)}</title>`
        if (title.crisp !== expected) add(diagnostics, 'SCENE_FIDELITY', `scene.parts[${titles[0]!.index}].crisp`, 'external title must use the canonical generated projection')
      }
      const description = descriptions[0]?.part
      if (description && (description.id !== 'external-scene-description' || description.domId !== 'external-scene-description')) {
        add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${descriptions[0]!.index}]`, 'external description must use the canonical generated identity')
      }
      if (description && typeof description.text === 'string') {
        const expected = `<desc id="${escapeAttr('external-scene-description')}">${escapeXml(description.text)}</desc>`
        if (description.crisp !== expected) add(diagnostics, 'SCENE_FIDELITY', `scene.parts[${descriptions[0]!.index}].crisp`, 'external description must use the canonical generated projection')
      }
      const definition = definitions[0]?.part
      if (definition && (definition.id !== 'external-scene-definitions' || !Array.isArray(definition.markerResources) || definition.markerResources.length === 0)) {
        add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${definitions[0]!.index}]`, 'external definitions must be the canonical non-empty typed marker resource mark')
      }
      const close = closes[0]?.part
      if (close && close.id !== 'svg-close') add(diagnostics, 'SCENE_DOCUMENT', `scene.parts[${closes[0]!.index}]`, 'external close must use the canonical generated identity')

      const prelude = preludes[0]?.part
      if (prelude && record(prelude.prelude)) {
        if (prelude.id !== 'external-scene-prelude') add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts[0].id', 'external prelude must use the canonical generated identity')
        if (prelude.prelude.width !== value.width || prelude.prelude.height !== value.height) add(diagnostics, 'SCENE_BOUNDS', 'scene.parts[0].prelude', 'prelude dimensions must equal document dimensions')
        if (prelude.prelude.hasMonoFont !== false) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts[0].prelude.hasMonoFont', 'external builder does not expose a monospace font resource')
        if (record(prelude.prelude.colors)) {
          const preludeColors = prelude.prelude.colors as unknown as DiagramColors
          const documentColors = record(value.colors) ? value.colors : {}
          const colorsMatch = ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border', 'font', 'shadow', 'embedFontImport']
            .every(key => (preludeColors as unknown as Record<string, unknown>)[key] === documentColors[key])
          if (!colorsMatch || preludeColors.embedFontImport !== false) add(diagnostics, 'SCENE_DOCUMENT', 'scene.parts[0].prelude.colors', 'must equal the document colors with external font imports disabled')
          try {
            const ariaIds = ['external-scene-title', ...(descriptions.length ? ['external-scene-description'] : [])].join(' ')
            const expected = [
              svgOpenTag(value.width as number, value.height as number, preludeColors, Boolean(prelude.prelude.transparent), {
                attrs: { role: 'img', 'aria-labelledby': ariaIds },
              }),
              buildStyleBlock(String(prelude.prelude.font), false, preludeColors.shadow, false),
            ].join('\n')
            if (prelude.crisp !== expected) add(diagnostics, 'SCENE_SECURITY', 'scene.parts[0].crisp', 'must be the canonical CSS-free external document projection')
          } catch (error) {
            add(diagnostics, 'SCENE_SECURITY', 'scene.parts[0].crisp', error instanceof Error ? error.message : String(error))
          }
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
      if (widthOk && heightOk) {
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
          if (node.kind === 'group' && Array.isArray(node.children)) node.children.forEach((child, index) => {
            if (record(child)) visitBounds(child.node, `${path}.children[${index}].node`)
          })
        }
        value.parts.forEach((part, index) => visitBounds(part, `scene.parts[${index}]`))
      }
    }

    if (diagnostics.length === 0) {
      const scene = value as unknown as SceneDoc
      try {
        for (const problem of sceneFidelityProblems(scene)) add(diagnostics, 'SCENE_FIDELITY', 'scene', problem)
      } catch (error) {
        add(diagnostics, 'SCENE_FIDELITY', 'scene', error instanceof Error ? error.message : String(error))
      }
      try {
        applyOutputSecurityPolicy(scene.parts.map(part => part.crisp).join('\n'), external ? 'strict' : 'default')
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
