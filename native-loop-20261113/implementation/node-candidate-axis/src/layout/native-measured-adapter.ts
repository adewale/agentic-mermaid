import { layoutAgenticGraph } from './agentic-layered.ts'
import type { MeasuredLayoutAdapter, MeasuredLayoutRequest, MeasuredLayoutResult, MeasuredLayoutRole } from './measured-graph.ts'

/** Native search flags remain private to its existing producer. */
export const nativeMeasuredAdapter: MeasuredLayoutAdapter<MeasuredLayoutRole> = {
  solve(request: MeasuredLayoutRequest): MeasuredLayoutResult {
    const geometry = layoutAgenticGraph(request.role === 'placement' ? { ...request.graph, placementOnly: true } : request.graph)
    return request.role === 'placement' ? { kind: 'placed', geometry } : { kind: 'routed', geometry }
  },
}
