import { measureTextWidth } from '../text-metrics.ts'
import { rotateBoxBounds, type AxisAlignedBox } from '../shared/transformed-bounds.ts'
import type { Geometry, SceneNode } from './ir.ts'

function pointsBounds(points: Array<{ x: number; y: number }>): AxisAlignedBox | undefined {
  if (points.length === 0) return undefined
  return {
    x0: Math.min(...points.map(point => point.x)),
    y0: Math.min(...points.map(point => point.y)),
    x1: Math.max(...points.map(point => point.x)),
    y1: Math.max(...points.map(point => point.y)),
  }
}

export function geometryBounds(geometry: Geometry): AxisAlignedBox | undefined {
  switch (geometry.kind) {
    case 'rect': return { x0: geometry.x, y0: geometry.y, x1: geometry.x + geometry.width, y1: geometry.y + geometry.height }
    case 'circle': return { x0: geometry.cx - geometry.r, y0: geometry.cy - geometry.r, x1: geometry.cx + geometry.r, y1: geometry.cy + geometry.r }
    case 'ellipse': return { x0: geometry.cx - geometry.rx, y0: geometry.cy - geometry.ry, x1: geometry.cx + geometry.rx, y1: geometry.cy + geometry.ry }
    case 'line': return { x0: Math.min(geometry.x1, geometry.x2), y0: Math.min(geometry.y1, geometry.y2), x1: Math.max(geometry.x1, geometry.x2), y1: Math.max(geometry.y1, geometry.y2) }
    case 'polygon':
    case 'polyline': return pointsBounds(geometry.points)
    case 'compound': {
      const children = geometry.children.map(geometryBounds).filter((box): box is AxisAlignedBox => box !== undefined)
      if (children.length === 0) return undefined
      return {
        x0: Math.min(...children.map(box => box.x0)), y0: Math.min(...children.map(box => box.y0)),
        x1: Math.max(...children.map(box => box.x1)), y1: Math.max(...children.map(box => box.y1)),
      }
    }
    case 'path': return undefined
  }
}

/** World-space bounds for typed Scene geometry. Path bounds remain family-owned. */
export function nodeWorldBounds(node: SceneNode): AxisAlignedBox | undefined {
  let local: AxisAlignedBox | undefined
  if (node.kind === 'shape' || node.kind === 'connector') local = geometryBounds(node.geometry)
  else if (node.kind === 'text') {
    const width = measureTextWidth(node.text, node.fontSize, 500)
    const x0 = node.anchor === 'middle' ? node.x - width / 2 : node.anchor === 'end' ? node.x - width : node.x
    local = { x0, y0: node.y - node.fontSize, x1: x0 + width, y1: node.y + node.fontSize * 0.28 }
  } else return undefined
  if (!local || !node.transform) return local
  if (node.transform.kind === 'rotate') {
    return rotateBoxBounds(local, { x: node.transform.cx, y: node.transform.cy }, node.transform.angle)
  }
  return local
}
