import { escapeAttr } from '../multiline-utils.ts'
import { safeCssPaint } from '../shared/css-color.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import type { LinearGradientDescriptor } from './ir.ts'

const RESOURCE_ID = /^[A-Za-z_][A-Za-z0-9_.:-]*$/

/** Allocation and serialization ceilings for typed local gradient resources.
 * These are narrower than the enclosing Scene document budgets so direct
 * serializer callers cannot bypass admission by constructing huge stop lists. */
export const LINEAR_GRADIENT_LIMITS = Object.freeze({
  maxIdLength: 256,
  maxCoordinate: 1_000_000,
  maxStopsPerGradient: 256,
  maxResources: 10_000,
  maxAggregateStops: 20_000,
  maxSerializationBytes: 8_000_000,
})

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`Linear gradient ${field} must be finite`)
  if (Math.abs(value) > LINEAR_GRADIENT_LIMITS.maxCoordinate) {
    throw new Error(`Linear gradient ${field} must not exceed ${LINEAR_GRADIENT_LIMITS.maxCoordinate}`)
  }
  return value
}

function percentage(offset: number): string {
  return `${Math.round(offset * 100_000) / 1_000}%`
}

/** Validate a typed, same-document gradient resource before serialization. */
export function assertRenderableLinearGradient(
  gradient: LinearGradientDescriptor,
): void {
  if (!RESOURCE_ID.test(gradient.id)) {
    throw new Error(`Linear gradient id ${JSON.stringify(gradient.id)} must use the safe SVG id grammar`)
  }
  if (gradient.id.length > LINEAR_GRADIENT_LIMITS.maxIdLength) {
    throw new Error(`Linear gradient id must contain at most ${LINEAR_GRADIENT_LIMITS.maxIdLength} characters`)
  }
  if (gradient.units !== 'userSpaceOnUse' && gradient.units !== 'objectBoundingBox') {
    throw new Error(`Linear gradient "${gradient.id}" units must be userSpaceOnUse or objectBoundingBox`)
  }
  finite(gradient.x1, 'x1')
  finite(gradient.y1, 'y1')
  finite(gradient.x2, 'x2')
  finite(gradient.y2, 'y2')
  if (gradient.stops.length < 2) {
    throw new Error(`Linear gradient "${gradient.id}" must declare at least two stops`)
  }
  if (gradient.stops.length > LINEAR_GRADIENT_LIMITS.maxStopsPerGradient) {
    throw new Error(`Linear gradient "${gradient.id}" must declare at most ${LINEAR_GRADIENT_LIMITS.maxStopsPerGradient} stops`)
  }
  let prior = -1
  for (const [index, stop] of gradient.stops.entries()) {
    finite(stop.offset, `stops[${index}].offset`)
    if (stop.offset < 0 || stop.offset > 1) {
      throw new Error(`Linear gradient "${gradient.id}" stop offsets must be in [0,1]`)
    }
    if (stop.offset < prior) {
      throw new Error(`Linear gradient "${gradient.id}" stop offsets must be non-decreasing`)
    }
    prior = stop.offset
    if (safeCssPaint(stop.color) === undefined || /^url\s*\(/i.test(stop.color)) {
      throw new Error(`Linear gradient "${gradient.id}" stop ${index} must use a safe non-fetching CSS paint`)
    }
    if (stop.opacity !== undefined && (!Number.isFinite(stop.opacity) || stop.opacity < 0 || stop.opacity > 1)) {
      throw new Error(`Linear gradient "${gradient.id}" stop opacity must be in [0,1]`)
    }
  }
}

export function serializeLinearGradientResource(
  gradient: LinearGradientDescriptor,
  options: { indent?: number } = {},
): string {
  assertRenderableLinearGradient(gradient)
  const outerIndent = ' '.repeat(options.indent ?? 2)
  const innerIndent = `${outerIndent}  `
  const attrs = [
    `id="${escapeAttr(gradient.id)}"`,
    `gradientUnits="${gradient.units}"`,
    `x1="${finite(gradient.x1, 'x1')}"`,
    `y1="${finite(gradient.y1, 'y1')}"`,
    `x2="${finite(gradient.x2, 'x2')}"`,
    `y2="${finite(gradient.y2, 'y2')}"`,
  ]
  return [
    `${outerIndent}<linearGradient ${attrs.join(' ')}>`,
    ...gradient.stops.map(stop => `${innerIndent}<stop offset="${percentage(stop.offset)}" stop-color="${escapeAttr(stop.color)}"${stop.opacity === undefined ? '' : ` stop-opacity="${stop.opacity}"`} />`),
    `${outerIndent}</linearGradient>`,
  ].join('\n')
}

export function serializeLinearGradientResources(
  gradients: readonly LinearGradientDescriptor[],
  options: { indent?: number } = {},
): string {
  if (gradients.length > LINEAR_GRADIENT_LIMITS.maxResources) {
    throw new Error(`A definitions mark may declare at most ${LINEAR_GRADIENT_LIMITS.maxResources} linear gradients`)
  }
  const ids = new Set<string>()
  let aggregateStops = 0
  let aggregateBytes = 0
  const serialized: string[] = []
  for (const gradient of gradients) {
    if (ids.has(gradient.id)) throw new Error(`Duplicate linear gradient resource "${gradient.id}"`)
    ids.add(gradient.id)
    aggregateStops += gradient.stops.length
    if (aggregateStops > LINEAR_GRADIENT_LIMITS.maxAggregateStops) {
      throw new Error(`Linear gradient resources may declare at most ${LINEAR_GRADIENT_LIMITS.maxAggregateStops} aggregate stops`)
    }
    const resource = serializeLinearGradientResource(gradient, options)
    const separatorBytes = serialized.length === 0 ? 0 : 1
    const remaining = LINEAR_GRADIENT_LIMITS.maxSerializationBytes - aggregateBytes - separatorBytes
    const bytes = boundedUtf8ByteLength(resource, Math.max(0, remaining))
    if (bytes > remaining) {
      throw new Error(`Linear gradient serialization exceeds ${LINEAR_GRADIENT_LIMITS.maxSerializationBytes} bytes`)
    }
    aggregateBytes += bytes + separatorBytes
    serialized.push(resource)
  }
  return serialized.join('\n')
}
