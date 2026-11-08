import type { MeasuredLayoutAdapter, MeasuredLayoutRequest, MeasuredLayoutRole, MeasuredLayoutResult, MeasuredPlacement, MeasuredRoutes } from './measured-graph.ts'

export { runMeasuredGraphBackend } from './backend.ts'

/** Check the adapter's result role and correspondence before family completion.
 * Geometry/paint certification remains at its existing owning boundary. */
export function solveMeasuredLayout<R extends MeasuredLayoutRole>(
  request: MeasuredLayoutRequest<R>, adapter: MeasuredLayoutAdapter<MeasuredLayoutRole>,
): R extends 'placement' ? MeasuredPlacement : MeasuredRoutes {
  const result: MeasuredLayoutResult = adapter.solve(request)
  if (result.kind !== (request.role === 'placement' ? 'placed' : 'routed')) throw new TypeError('Measured layout adapter returned the wrong result role')
  const geometry = result.geometry
  if (geometry.nodes.length !== request.graph.nodes.length || (geometry.groups?.length ?? 0) !== (request.graph.groups?.length ?? 0)
    || result.kind === 'routed' && result.geometry.edges.length !== request.graph.edges.length) throw new TypeError('Measured layout adapter lost authored subjects')
  if (!Number.isFinite(geometry.width) || geometry.width < 0 || !Number.isFinite(geometry.height) || geometry.height < 0) throw new TypeError('Measured layout adapter returned an invalid extent')
  for (let index = 0; index < geometry.nodes.length; index++) {
    const node = geometry.nodes[index]!, measured = request.graph.nodes[index]!
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new TypeError('Measured layout adapter returned a nonfinite position')
    if (node.width !== undefined || node.height !== undefined) {
      if (node.width === undefined || node.height === undefined || !Number.isFinite(node.width) || !Number.isFinite(node.height) || node.width <= 0 || node.height <= 0
        || (measured.sizePolicy === 'minimum' ? node.width < measured.width || node.height < measured.height : node.width !== measured.width || node.height !== measured.height)) throw new TypeError('Measured layout adapter violated body size policy')
    }
  }
  for (const group of geometry.groups ?? []) if (![group.x, group.y, group.width, group.height].every(Number.isFinite) || group.width < 0 || group.height < 0) throw new TypeError('Measured layout adapter returned an invalid group')
  if (result.kind === 'routed') for (let index = 0; index < result.geometry.edges.length; index++) {
    const edge = result.geometry.edges[index]!, measured = request.graph.edges[index]!, subjects = request.graph.nodes.length + (request.graph.groups?.length ?? 0)
    if (![measured.source, measured.target].every(value => Number.isInteger(value) && value >= 0 && value < subjects)) throw new TypeError('Measured edge endpoint is outside authored subjects')
    if (measured.visible !== false && edge.points.length < 2 || edge.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))
      || edge.labelPosition && (!Number.isFinite(edge.labelPosition.x) || !Number.isFinite(edge.labelPosition.y))) throw new TypeError('Measured layout adapter returned invalid route geometry')
  }
  return geometry as R extends 'placement' ? MeasuredPlacement : MeasuredRoutes
}
