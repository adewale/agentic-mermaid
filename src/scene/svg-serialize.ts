import type { Geometry } from './ir.ts'
import { escapeAttr } from '../multiline-utils.ts'

export type SerializableShapeGeometry = Extract<Geometry, { kind: 'rect' | 'circle' | 'ellipse' | 'polygon' }>

export interface GeometryShapePaint {
  fill: string
  stroke: string
  strokeWidth: string
}

const round = (value: number): number => Math.round(value * 1000) / 1000
const paintAttrs = (paint: GeometryShapePaint): string =>
  `fill="${escapeAttr(paint.fill)}" stroke="${escapeAttr(paint.stroke)}" stroke-width="${escapeAttr(paint.strokeWidth)}"`

/** Serialize the closed primitive subset shared by typed family shape marks. */
export function serializeGeometryShape(geometry: SerializableShapeGeometry, paint: GeometryShapePaint): string {
  const attrs = paintAttrs(paint)
  switch (geometry.kind) {
    case 'rect': return `<rect x="${round(geometry.x)}" y="${round(geometry.y)}" width="${round(geometry.width)}" height="${round(geometry.height)}" rx="${geometry.rx ?? 0}" ry="${geometry.ry ?? 0}" ${attrs} />`
    case 'circle': return `<circle cx="${round(geometry.cx)}" cy="${round(geometry.cy)}" r="${round(geometry.r)}" ${attrs} />`
    case 'ellipse': return `<ellipse cx="${round(geometry.cx)}" cy="${round(geometry.cy)}" rx="${round(geometry.rx)}" ry="${round(geometry.ry)}" ${attrs} />`
    case 'polygon': return `<polygon points="${geometry.points.map(point => `${round(point.x)},${round(point.y)}`).join(' ')}" ${attrs} />`
  }
}
