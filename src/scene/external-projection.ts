/**
 * Canonical marks for the declarative external Scene surface.
 *
 * Both construction and admission use these functions. External families may
 * supply semantic values, but they never supply SVG/CSS: the backend's writer
 * projects the marks rebuilt here.
 */

import type {
  ConnectorGeometry,
  ConnectorMark,
  GroupMark,
  MarkPaint,
  SceneNode,
  ScenePoint,
  ShapeMark,
  TextMark,
} from './ir.ts'
import { pathMoveCount } from './connector-geometry.ts'
import * as marks from './marks.ts'

/** External Scene v1 has one path-contour authority. Keep this check shared by
 * construction and admission so a hand-built SceneDoc cannot claim topology
 * that the declarative builder itself would reject. */
export function assertExternalConnectorTopology(geometry: ConnectorGeometry, closed: boolean): void {
  if (geometry.kind !== 'path') {
    if (closed) throw new TypeError('External Scene closed topology is only valid for path geometry')
    return
  }
  if (geometry.subpaths !== undefined) {
    throw new TypeError('External Scene v1 does not expose typed connector subpaths')
  }
  if (pathMoveCount(geometry.d) !== 1) {
    throw new TypeError('External Scene v1 path geometry must contain exactly one SVG subpath')
  }
  const closeCommands = geometry.d.match(/[Zz]/g)?.length ?? 0
  if (closeCommands > 1 || closed !== (closeCommands === 1)) {
    throw new TypeError('External Scene connector closed must exactly match its single SVG path contour')
  }
  assertExternalPathPointAgreement(geometry, closed)
}

/** External Scene v1 deliberately has one path authority. Curved path data
 * cannot be proven equivalent to a caller-supplied hit/bounds polyline, so v1
 * admits only a linear M/L[/Z] contour and verifies every vertex. Rich curves
 * remain available to built-in family lowerings and can be exposed by a later
 * API version with a canonical flattening contract. */
function assertExternalPathPointAgreement(
  geometry: Extract<ConnectorGeometry, { kind: 'path' }>,
  closed: boolean,
): void {
  const tokens = geometry.d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  let index = 0
  const vertices: ScenePoint[] = []
  const number = (): number => {
    const token = tokens[index++]
    const value = Number(token)
    if (token === undefined || !Number.isFinite(value)) {
      throw new TypeError('External Scene v1 path must use finite canonical M/L vertices')
    }
    return value
  }
  if (tokens[index++] !== 'M') {
    throw new TypeError('External Scene v1 path must use one absolute M followed by absolute L vertices')
  }
  vertices.push({ x: number(), y: number() })
  let sawClose = false
  while (index < tokens.length) {
    const command = tokens[index++]
    if (command === 'Z') {
      sawClose = true
      if (index !== tokens.length) throw new TypeError('External Scene v1 path Z must terminate the contour')
      break
    }
    if (command !== 'L') {
      throw new TypeError('External Scene v1 path supports only absolute M/L/Z so route, bounds, hit geometry, and SVG cannot diverge')
    }
    vertices.push({ x: number(), y: number() })
  }
  if (sawClose !== closed) {
    throw new TypeError('External Scene connector closed must exactly match its single SVG path contour')
  }
  if (vertices.length !== geometry.points.length || vertices.some((point, pointIndex) => {
    const typed = geometry.points[pointIndex]
    return !typed || typed.x !== point.x || typed.y !== point.y
  })) {
    throw new TypeError('External Scene v1 path vertices must exactly match typed connector points')
  }
}

/** Rebuild one structured external mark using only fields exposed by the
 * declarative builder. Admission compares the result with the supplied mark. */
export function canonicalExternalNode(node: ShapeMark | TextMark | GroupMark | ConnectorMark): SceneNode {
  switch (node.kind) {
    case 'shape':
      return marks.shape({
        id: node.id,
        role: node.role,
        geometry: node.geometry,
        paint: node.paint,
        ...(node.channels ? { channels: node.channels } : {}),
      })
    case 'text':
      return marks.text({
        id: node.id,
        role: node.role,
        text: node.text,
        x: node.x,
        y: node.y,
        fontSize: node.fontSize,
        fontWeight: 400,
        display: 'literal',
        anchor: node.anchor,
        baselineShift: 0,
        paint: node.paint,
        ...(node.channels ? { channels: node.channels } : {}),
      })
    case 'group':
      return marks.group({
        id: node.id,
        role: node.role,
        open: '<g>',
        close: '</g>',
        children: node.children.map(child => ({ node: child.node, indent: 2 })),
        ...(node.channels ? { channels: node.channels } : {}),
      })
    case 'connector': {
      const start = node.markers.start
      const mid = node.markers.mid.length === 1 ? node.markers.mid[0] : undefined
      const end = node.markers.end
      const geometry = node.route.geometry
      const paint: MarkPaint = {
        fill: 'none',
        stroke: node.stroke.color,
        strokeWidth: String(node.stroke.width),
        ...(node.stroke.opacity === undefined ? {} : { opacity: String(node.stroke.opacity) }),
        ...(node.stroke.dash === undefined ? {} : {
          strokeDasharray: typeof node.stroke.dash.array === 'string' ? node.stroke.dash.array : node.stroke.dash.array.join(' '),
          ...(node.stroke.dash.offset === undefined ? {} : { strokeDashoffset: String(node.stroke.dash.offset) }),
        }),
        strokeLinecap: node.stroke.lineCap,
        strokeLinejoin: node.stroke.lineJoin,
        strokeMiterlimit: String(node.stroke.miterLimit),
        ...(node.stroke.paintOrder === undefined ? {} : { paintOrder: node.stroke.paintOrder }),
        ...(node.stroke.nonScaling ? { vectorEffect: 'non-scaling-stroke' as const } : {}),
      }
      assertExternalConnectorTopology(geometry, node.route.closed)
      return marks.connector({
        id: node.id,
        role: node.role,
        geometry,
        lineStyle: node.lineStyle,
        paint,
        endpoints: {
          ...(node.endpoints.from === undefined ? {} : { from: node.endpoints.from }),
          ...(node.endpoints.to === undefined ? {} : { to: node.endpoints.to }),
          ...(node.endpoints.start?.owner ? { start: { owner: { ...node.endpoints.start.owner } } } : {}),
          ...(node.endpoints.end?.owner ? { end: { owner: { ...node.endpoints.end.owner } } } : {}),
        },
        relationship: node.relationship,
        route: { closed: node.route.closed },
        markers: { ...(start ? { start } : {}), mid: mid ? [mid] : [], ...(end ? { end } : {}) },
        labels: node.labels,
        ...(node.channels ? { channels: node.channels } : {}),
      })
    }
  }
}
