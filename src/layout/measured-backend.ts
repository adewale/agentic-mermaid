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
  return geometry as R extends 'placement' ? MeasuredPlacement : MeasuredRoutes
}
