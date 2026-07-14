import type { ConnectorMark, SceneDoc, SceneNode, ScenePoint } from './ir.ts'
import { connectorSegments } from './connector-geometry.ts'

export interface SceneConnectorHit {
  readonly id: string
  readonly role: ConnectorMark['role']
  readonly connector: ConnectorMark
  readonly distance: number
}

function distanceToSegment(point: ScenePoint, start: ScenePoint, end: ScenePoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

function localPoint(connector: ConnectorMark, point: ScenePoint): ScenePoint {
  if (!connector.transform) return point
  const radians = -connector.transform.angle * Math.PI / 180
  const dx = point.x - connector.transform.cx
  const dy = point.y - connector.transform.cy
  return {
    x: connector.transform.cx + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: connector.transform.cy + dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

/** Distance from a world-space point to the connector's typed hit route.
 * Returns undefined for deliberately non-interactive connectors or for a path
 * that failed to provide the point projection required by the Scene contract. */
export function connectorHitDistance(connector: ConnectorMark, point: ScenePoint): number | undefined {
  if (connector.hit.pointerEvents === 'none') return undefined
  const segments = connectorSegments(connector.hit.geometry, connector.hit.closed)
  if (segments.length === 0) return undefined
  const local = localPoint(connector, point)
  let distance = Number.POSITIVE_INFINITY
  for (const segment of segments) {
    distance = Math.min(distance, distanceToSegment(local, segment.start, segment.end))
  }
  return distance
}

export function hitTestConnector(
  connector: ConnectorMark,
  point: ScenePoint,
  tolerance = 0,
): boolean {
  const distance = connectorHitDistance(connector, point)
  return distance !== undefined && distance <= connector.hit.strokeWidth / 2 + Math.max(0, tolerance)
}

function visitConnectors(nodes: readonly SceneNode[], visit: (connector: ConnectorMark) => void): void {
  // Reverse paint order: the visually topmost connector wins ties.
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!
    if (node.kind === 'connector') visit(node)
    else if (node.kind === 'group') visitConnectors(node.children.map(child => child.node), visit)
  }
}

/** Hit-test every connector using only typed Scene hit geometry. */
export function hitTestSceneConnectors(
  scene: SceneDoc,
  point: ScenePoint,
  tolerance = 0,
): readonly SceneConnectorHit[] {
  const hits: SceneConnectorHit[] = []
  visitConnectors(scene.parts, connector => {
    const distance = connectorHitDistance(connector, point)
    if (distance !== undefined && distance <= connector.hit.strokeWidth / 2 + Math.max(0, tolerance)) {
      hits.push(Object.freeze({ id: connector.id, role: connector.role, connector, distance }))
    }
  })
  return Object.freeze(hits.sort((left, right) => left.distance - right.distance))
}
