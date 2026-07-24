import { escapeAttr } from '../multiline-utils.ts'
import { safeCssPaint } from '../shared/css-color.ts'
import type { LinearGradientDescriptor } from './ir.ts'

const RESOURCE_ID = /^[A-Za-z_][A-Za-z0-9_.:-]*$/

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`Linear gradient ${field} must be finite`)
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
  const ids = new Set<string>()
  for (const gradient of gradients) {
    if (ids.has(gradient.id)) throw new Error(`Duplicate linear gradient resource "${gradient.id}"`)
    ids.add(gradient.id)
  }
  return gradients.map(gradient => serializeLinearGradientResource(gradient, options)).join('\n')
}
