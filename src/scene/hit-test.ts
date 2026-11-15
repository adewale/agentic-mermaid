import type { ConnectorMark, SceneDoc, SceneNode, ScenePoint } from './ir.ts'
import { connectorSegments } from './connector-geometry.ts'
import { composeMatrices, IDENTITY_MATRIX, inverseMatrix, transformMatrix, transformPoint, type AffineMatrix } from './transforms.ts'

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


/** Distance from a world-space point to the connector's typed hit route.
 * Returns undefined for deliberately non-interactive connectors or for a path
 * that failed to provide the point projection required by the Scene contract. */
function transformedHitDistance(connector: ConnectorMark, point: ScenePoint, parent: AffineMatrix): number | undefined {
  if (connector.hit.pointerEvents === 'none') return undefined
  const segments = connectorSegments(connector.hit.geometry, connector.hit.closed)
  if (segments.length === 0) return undefined
  const matrix = composeMatrices(parent, transformMatrix(connector.transform))
  let distance = Number.POSITIVE_INFINITY
  for (const segment of segments) {
    distance = Math.min(distance, distanceToSegment(point, transformPoint(segment.start, matrix), transformPoint(segment.end, matrix)))
  }
  return distance
}

export function connectorHitDistance(connector: ConnectorMark, point: ScenePoint): number | undefined {
  return transformedHitDistance(connector, point, IDENTITY_MATRIX)
}

function hitsTransformed(connector: ConnectorMark, point: ScenePoint, tolerance: number, parent: AffineMatrix): boolean {
  if (connector.hit.pointerEvents === 'none') return false
  const matrix = composeMatrices(parent, transformMatrix(connector.transform))
  const inverse = inverseMatrix(matrix)
  if (!inverse) return false
  if (connector.stroke.nonScaling) {
    const distance = transformedHitDistance(connector, point, parent)
    return distance !== undefined && distance <= connector.hit.strokeWidth / 2 + Math.max(0, tolerance)
  }
  const local = transformPoint(point, inverse)
  // A world-space tolerance expands conservatively under an affine inverse;
  // the declared local hit stroke itself is tested exactly, including scale.
  const inverseExtent = (Math.hypot(inverse[0] + inverse[3], inverse[1] - inverse[2]) + Math.hypot(inverse[0] - inverse[3], inverse[1] + inverse[2])) / 2
  const threshold = connector.hit.strokeWidth / 2 + (tolerance > 0 ? tolerance * inverseExtent : 0)
  return connectorSegments(connector.hit.geometry, connector.hit.closed).some(segment => distanceToSegment(local, segment.start, segment.end) <= threshold)
}

export function hitTestConnector(connector: ConnectorMark, point: ScenePoint, tolerance = 0): boolean {
  return hitsTransformed(connector, point, tolerance, IDENTITY_MATRIX)
}

function visitConnectors(nodes: readonly SceneNode[], parent: AffineMatrix, visit: (connector: ConnectorMark, parent: AffineMatrix) => void): void {
  // Reverse paint order: the visually topmost connector wins ties.
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!
    if (node.kind === 'connector') visit(node, parent)
    else if (node.kind === 'group') visitConnectors(node.children.map(child => child.node), composeMatrices(parent, transformMatrix(node.transform)), visit)
  }
}

/** Hit-test every connector using only typed Scene hit geometry. */
export function hitTestSceneConnectors(
  scene: SceneDoc,
  point: ScenePoint,
  tolerance = 0,
): readonly SceneConnectorHit[] {
  const hits: SceneConnectorHit[] = []
  visitConnectors(scene.parts, IDENTITY_MATRIX, (connector, parent) => {
    const distance = transformedHitDistance(connector, point, parent)
    if (distance !== undefined && hitsTransformed(connector, point, tolerance, parent)) {
      hits.push(Object.freeze({ id: connector.id, role: connector.role, connector, distance }))
    }
  })
  return Object.freeze(hits.sort((left, right) => left.distance - right.distance))
}
