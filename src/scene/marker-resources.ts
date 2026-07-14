import { escapeAttr } from '../multiline-utils.ts'
import type { Geometry, MarkerDescriptor, MarkPaint } from './ir.ts'

/** A marker resource is renderable only when its geometry, viewport, and
 * reference point are explicit. Connector references reuse this descriptor. */
export type RenderableMarkerDescriptor = MarkerDescriptor & Required<Pick<MarkerDescriptor, 'geometry' | 'size' | 'ref'>>

export interface MarkerSerializationOptions {
  readonly indent?: number
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`Marker ${field} must be finite`)
  return value
}

function paintAttributes(paint: MarkPaint | undefined): string {
  if (!paint) return ''
  const attrs: string[] = []
  if (paint.fill !== undefined) attrs.push(`fill="${escapeAttr(paint.fill)}"`)
  if (paint.stroke !== undefined) attrs.push(`stroke="${escapeAttr(paint.stroke)}"`)
  if (paint.strokeWidth !== undefined) attrs.push(`stroke-width="${escapeAttr(paint.strokeWidth)}"`)
  if (paint.strokeDasharray !== undefined) attrs.push(`stroke-dasharray="${escapeAttr(paint.strokeDasharray)}"`)
  if (paint.strokeDashoffset !== undefined) attrs.push(`stroke-dashoffset="${escapeAttr(paint.strokeDashoffset)}"`)
  if (paint.strokeLinecap !== undefined) attrs.push(`stroke-linecap="${escapeAttr(paint.strokeLinecap)}"`)
  if (paint.strokeLinejoin !== undefined) attrs.push(`stroke-linejoin="${escapeAttr(paint.strokeLinejoin)}"`)
  if (paint.strokeMiterlimit !== undefined) attrs.push(`stroke-miterlimit="${escapeAttr(paint.strokeMiterlimit)}"`)
  if (paint.vectorEffect !== undefined) attrs.push(`vector-effect="${escapeAttr(paint.vectorEffect)}"`)
  if (paint.paintOrder !== undefined) attrs.push(`paint-order="${escapeAttr(paint.paintOrder)}"`)
  if (paint.opacity !== undefined) attrs.push(`opacity="${escapeAttr(paint.opacity)}"`)
  return attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
}

function pointList(points: readonly { x: number; y: number }[]): string {
  // Preserve the long-standing marker grammar used by every built-in family:
  // coordinates within a point are space-separated and points use `, `.
  return points.map(point => `${finite(point.x, 'point.x')} ${finite(point.y, 'point.y')}`).join(', ')
}

function geometryElements(geometry: Geometry, paint: MarkPaint | undefined, indent: string): string[] {
  const attrs = paintAttributes(paint)
  switch (geometry.kind) {
    case 'rect':
      return [`${indent}<rect x="${finite(geometry.x, 'rect.x')}" y="${finite(geometry.y, 'rect.y')}" width="${finite(geometry.width, 'rect.width')}" height="${finite(geometry.height, 'rect.height')}"${geometry.rx !== undefined ? ` rx="${finite(geometry.rx, 'rect.rx')}"` : ''}${geometry.ry !== undefined ? ` ry="${finite(geometry.ry, 'rect.ry')}"` : ''}${attrs} />`]
    case 'circle':
      return [`${indent}<circle cx="${finite(geometry.cx, 'circle.cx')}" cy="${finite(geometry.cy, 'circle.cy')}" r="${finite(geometry.r, 'circle.r')}"${attrs} />`]
    case 'ellipse':
      return [`${indent}<ellipse cx="${finite(geometry.cx, 'ellipse.cx')}" cy="${finite(geometry.cy, 'ellipse.cy')}" rx="${finite(geometry.rx, 'ellipse.rx')}" ry="${finite(geometry.ry, 'ellipse.ry')}"${attrs} />`]
    case 'line':
      return [`${indent}<line x1="${finite(geometry.x1, 'line.x1')}" y1="${finite(geometry.y1, 'line.y1')}" x2="${finite(geometry.x2, 'line.x2')}" y2="${finite(geometry.y2, 'line.y2')}"${attrs} />`]
    case 'polygon':
      return [`${indent}<polygon points="${pointList(geometry.points)}"${attrs} />`]
    case 'polyline':
      return [`${indent}<polyline points="${pointList(geometry.points)}"${attrs} />`]
    case 'path':
      return [`${indent}<path d="${escapeAttr(geometry.d)}"${attrs} />`]
    case 'compound':
      return geometry.children.flatMap(child => geometryElements(child, paint, indent))
  }
}

export function assertRenderableMarker(marker: MarkerDescriptor): asserts marker is RenderableMarkerDescriptor {
  if (typeof marker.id !== 'string' || marker.id.trim() === '') throw new Error('Marker id must not be empty')
  if (!['arrow', 'open-arrow', 'circle', 'cross', 'triangle', 'diamond', 'diamond-open'].includes(String(marker.shape))) {
    throw new Error(`Marker "${marker.id}" has an unknown shape`)
  }
  if (!marker.geometry) throw new Error(`Marker "${marker.id}" must declare geometry`)
  if (!marker.size) throw new Error(`Marker "${marker.id}" must declare marker size`)
  if (!marker.ref) throw new Error(`Marker "${marker.id}" must declare a reference point`)
  if (!(marker.size.width > 0) || !(marker.size.height > 0)) throw new Error(`Marker "${marker.id}" size must be positive`)
  finite(marker.size.width, 'size.width')
  finite(marker.size.height, 'size.height')
  finite(marker.ref.x, 'ref.x')
  finite(marker.ref.y, 'ref.y')
  if (marker.units !== undefined && marker.units !== 'strokeWidth' && marker.units !== 'userSpaceOnUse') {
    throw new Error(`Marker "${marker.id}" units must be strokeWidth or userSpaceOnUse`)
  }
  if (typeof marker.orient === 'number') finite(marker.orient, 'orient')
  else if (marker.orient !== undefined && marker.orient !== 'auto' && marker.orient !== 'auto-start-reverse') {
    throw new Error(`Marker "${marker.id}" orient must be auto, auto-start-reverse, or a finite angle`)
  }
  if (marker.overflow !== undefined && marker.overflow !== 'hidden' && marker.overflow !== 'visible') {
    throw new Error(`Marker "${marker.id}" overflow must be hidden or visible`)
  }
  if (marker.viewBox) {
    finite(marker.viewBox.x, 'viewBox.x')
    finite(marker.viewBox.y, 'viewBox.y')
    finite(marker.viewBox.width, 'viewBox.width')
    finite(marker.viewBox.height, 'viewBox.height')
    if (!(marker.viewBox.width > 0) || !(marker.viewBox.height > 0)) throw new Error(`Marker "${marker.id}" viewBox must be positive`)
  }
}

export function serializeMarkerResource(
  marker: MarkerDescriptor,
  options: MarkerSerializationOptions = {},
): string {
  assertRenderableMarker(marker)
  const outerIndent = ' '.repeat(options.indent ?? 2)
  const innerIndent = `${outerIndent}  `
  const units = marker.units
  const orient = marker.orient ?? 'auto'
  const attrs = [
    `id="${escapeAttr(marker.id)}"`,
    `markerWidth="${finite(marker.size.width, 'size.width')}"`,
    `markerHeight="${finite(marker.size.height, 'size.height')}"`,
    `refX="${finite(marker.ref.x, 'ref.x')}"`,
    `refY="${finite(marker.ref.y, 'ref.y')}"`,
    `orient="${escapeAttr(String(orient))}"`,
    ...(units ? [`markerUnits="${escapeAttr(units)}"`] : []),
    ...(marker.viewBox ? [`viewBox="${finite(marker.viewBox.x, 'viewBox.x')} ${finite(marker.viewBox.y, 'viewBox.y')} ${finite(marker.viewBox.width, 'viewBox.width')} ${finite(marker.viewBox.height, 'viewBox.height')}"`] : []),
    ...(marker.overflow ? [`overflow="${escapeAttr(marker.overflow)}"`] : []),
  ]
  return [
    `${outerIndent}<marker ${attrs.join(' ')}>`,
    ...geometryElements(marker.geometry, marker.paint, innerIndent),
    `${outerIndent}</marker>`,
  ].join('\n')
}

export function serializeMarkerResources(
  markers: readonly MarkerDescriptor[],
  options: MarkerSerializationOptions = {},
): string {
  const ids = new Set<string>()
  for (const marker of markers) {
    if (ids.has(marker.id)) throw new Error(`Duplicate marker resource "${marker.id}"`)
    ids.add(marker.id)
  }
  return markers.map(marker => serializeMarkerResource(marker, options)).join('\n')
}
