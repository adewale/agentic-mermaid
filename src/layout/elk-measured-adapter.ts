import type { ElkNode } from 'elkjs'
import { elkLayoutSync } from '../elk-instance.ts'
import { directionToElk, GraphLayoutUnsupportedError } from './backend.ts'
import { alignElkRoundoff } from './elk-roundoff.ts'
import type { MeasuredLayoutAdapter, MeasuredLayoutRequest, MeasuredLayoutResult, MeasuredLayoutRole } from './measured-graph.ts'

/** Existing flat-family ELK policy. Algorithm options do not enter the common IR. */
export function elkMeasuredAdapter(policy: { rootId: string; edgeNodeSpacing: number; labelText?: readonly string[] }): MeasuredLayoutAdapter<MeasuredLayoutRole> {
  return {
    solve(request: MeasuredLayoutRequest): MeasuredLayoutResult {
      const input = request.graph
      if (input.groups?.length || input.shareCompleteFans || input.edgeSpacing !== undefined || input.nodeClearance !== undefined || input.maximumEdgeStrokeWidth !== undefined || input.maximumEdgeBendRadius !== undefined || input.nodes.some(n => n.parent !== undefined || n.partition || n.modelOrder !== undefined || n.minimumPortSpacing !== undefined || n.paintStrokeWidth !== undefined || n.paintCornerRadius !== undefined)
        || input.edges.some(e => e.minSpan !== 1 || e.short || e.visible === false || e.markerPaint !== undefined || e.sourcePortSpan !== undefined || e.targetPortSpan !== undefined || e.boundaryMarker)) throw new GraphLayoutUnsupportedError('ELK flat measured adapter requires the existing family adapter for these constraints', 'ELK')
      const terminalLead = Math.max(policy.edgeNodeSpacing, input.minimumTerminalLead ?? 0)
      const graph: ElkNode = {
        id: policy.rootId,
        layoutOptions: {
          'elk.algorithm': 'layered', 'elk.direction': directionToElk(input.direction), 'elk.edgeRouting': 'ORTHOGONAL',
          'elk.spacing.edgeNode': String(terminalLead), 'elk.layered.spacing.edgeNodeBetweenLayers': String(terminalLead),
          'elk.spacing.nodeNode': String(input.nodeSpacing), 'elk.layered.spacing.nodeNodeBetweenLayers': String(input.layerSpacing),
          'elk.padding': `[top=${input.padding},left=${input.padding},bottom=${input.padding},right=${input.padding}]`,
        },
        children: input.nodes.map((node, index) => ({ id: `n${index}`, width: node.width, height: node.height })),
        edges: input.edges.map((edge, index) => ({ id: `e${index}`, sources: [`n${edge.source}`], targets: [`n${edge.target}`],
          ...(edge.label ? { labels: [{ text: policy.labelText?.[index] ?? '', width: edge.label.width, height: edge.label.height }] } : {}) })),
      }
      if (input.edges.some(e => e.minSpan !== 1)) throw new GraphLayoutUnsupportedError('ELK flat measured adapter requires the existing family adapter for long-edge constraints', 'ELK')
      const placed = input.nodes.length ? elkLayoutSync(graph) : { ...graph, width: input.padding * 2, height: input.padding * 2 }
      const nodes = input.nodes.map(() => ({ x: 0, y: 0 }))
      for (const child of placed.children ?? []) nodes[Number(child.id!.slice(1))] = { x: child.x ?? 0, y: child.y ?? 0 }
      const geometry = { width: placed.width ?? 0, height: placed.height ?? input.padding * 2, nodes,
        edges: input.edges.map((_, index) => {
          const edge = placed.edges?.[index], label = edge?.labels?.[0]
          return { points: alignElkRoundoff((edge?.sections ?? []).flatMap(s => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint])),
            ...(label?.x !== undefined ? { labelPosition: { x: label.x + (label.width ?? 0) / 2, y: (label.y ?? 0) + (label.height ?? 0) / 2 } } : {}) }
        }) }
      return request.role === 'placement' ? { kind: 'placed', geometry } : { kind: 'routed', geometry }
    },
  }
}
