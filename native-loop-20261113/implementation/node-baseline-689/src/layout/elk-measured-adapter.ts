import type { ElkNode } from 'elkjs'
import { elkLayoutSync } from '../elk-instance.ts'
import { directionToElk, GraphLayoutUnsupportedError } from './backend.ts'
import { alignElkRoundoff } from './elk-roundoff.ts'
import { assertMeasuredContactMetadata, type MeasuredLayoutAdapter, type MeasuredLayoutRequest, type MeasuredLayoutResult, type MeasuredLayoutRole, type MeasuredRoutes } from './measured-graph.ts'

/** Existing flat-family ELK policy. Algorithm options do not enter the common IR. */
export function elkMeasuredAdapter(policy: { rootId: string; edgeNodeSpacing: number; labelText?: readonly string[] }): MeasuredLayoutAdapter<MeasuredLayoutRole> {
  return {
    solve(request: MeasuredLayoutRequest): MeasuredLayoutResult {
      const input = request.graph
      const physical = input.maximumEdgeStrokeWidth !== undefined
      if (input.groups?.length || input.shareCompleteFans || input.nodes.some(n => { assertMeasuredContactMetadata(n); return n.contact === 'diamond' || n.parent !== undefined || n.partition || n.modelOrder !== undefined })
        || input.edges.some(e => e.minSpan !== 1 || e.short || e.visible === false || e.markerPaint !== undefined || e.boundaryMarker)
        || (physical ? Number.isFinite(input.maximumEdgeBendRadius) && input.maximumEdgeBendRadius! > 0 : input.edgeSpacing !== undefined || input.nodeClearance !== undefined || input.maximumEdgeBendRadius !== undefined
          || input.nodes.some(n => n.minimumPortSpacing !== undefined || n.paintStrokeWidth !== undefined || n.paintCornerRadius !== undefined)
          || input.edges.some(e => e.sourcePortSpan !== undefined || e.targetPortSpan !== undefined))) throw new GraphLayoutUnsupportedError('ELK flat measured adapter requires the existing family adapter for these constraints', 'ELK')
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
      if (physical) addMeasuredPorts(input, graph)
      const placed = input.nodes.length ? elkLayoutSync(graph) : { ...graph, width: input.padding * 2, height: input.padding * 2 }
      const nodes = indexedSubjects(placed.children ?? [], input.nodes.length, 'n').map(child => ({ x: child.x ?? 0, y: child.y ?? 0, ...(physical ? { width: child.width, height: child.height } : {}) }))
      const edges = indexedSubjects(placed.edges ?? [], input.edges.length, 'e')
      const geometry = { width: placed.width ?? 0, height: placed.height ?? input.padding * 2, nodes,
        edges: input.edges.map((_, index) => {
          const edge = edges[index], label = edge?.labels?.[0]
          return { points: alignElkRoundoff((edge?.sections ?? []).flatMap(s => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint])),
            ...(label?.x !== undefined ? { labelPosition: { x: label.x + (label.width ?? 0) / 2, y: (label.y ?? 0) + (label.height ?? 0) / 2 } } : {}) }
        }) }
      if (physical) assertMeasuredPorts(input, geometry)
      return request.role === 'placement' ? { kind: 'placed', geometry } : { kind: 'routed', geometry }
    },
  }
}

// ELK's result array order is private. Authored correspondence follows the
// generated occurrence identity, including parallel and reciprocal edges.
function indexedSubjects<T extends { id: string }>(subjects: readonly T[], count: number, prefix: string): T[] {
  if (subjects.length !== count) throw new TypeError('ELK lost measured subjects')
  const ordered = new Array<T>(count)
  for (const subject of subjects) {
    const index = Number(subject.id.slice(1))
    if (!Number.isSafeInteger(index) || index < 0 || index >= count || subject.id !== `${prefix}${index}` || ordered[index]) throw new TypeError('ELK returned an invalid measured identity')
    ordered[index] = subject
  }
  return ordered
}

/** Ports are paint envelopes, not visible extra boxes. Their centered anchor
 * and negative border offset keep the route on the logical body's border. */
function addMeasuredPorts(input: MeasuredLayoutRequest['graph'], graph: ElkNode): void {
  const valid = (value: number | undefined, positive = false): value is number => value !== undefined && Number.isFinite(value) && (positive ? value > 0 : value >= 0)
  if (!valid(input.edgeSpacing, true) || !valid(input.maximumEdgeStrokeWidth, true) || !valid(input.minimumTerminalLead)
    || !valid(input.nodeClearance ?? 0) || !valid(input.maximumEdgeBendRadius ?? 0)
    || ![input.padding, input.nodeSpacing, input.layerSpacing].every(value => valid(value)) || !['TD', 'TB', 'BT', 'LR', 'RL'].includes(input.direction)) throw new TypeError('Invalid measured ELK routing demand')
  let margin = 8, border = 0
  const identities = new Set<string>()
  for (const [index, node] of input.nodes.entries()) {
    if (typeof node.id !== 'string' || identities.has(node.id)) throw new TypeError('Measured node identities must be unique strings')
    identities.add(node.id)
    if (node.contact !== 'rectangle' && node.contact !== 'rounded-rectangle' || node.contactEllipse !== undefined) throw new GraphLayoutUnsupportedError('ELK measured contacts require rectangles', 'ELK')
    if (!valid(node.width, true) || !valid(node.height, true) || !valid(node.paintStrokeWidth, true) || !valid(node.paintCornerRadius ?? 0)
      || node.minimumPortSpacing !== undefined && !valid(node.minimumPortSpacing, true)) throw new TypeError('Invalid measured ELK body demand')
    if (node.contact === 'rounded-rectangle' && node.paintCornerRadius === undefined || node.contact === 'rectangle' && node.paintCornerRadius) throw new TypeError('Invalid measured ELK contact radius')
    if (node.sizePolicy !== undefined && node.sizePolicy !== 'fixed' && node.sizePolicy !== 'minimum') throw new TypeError('Invalid measured ELK size policy')
    margin = Math.max(margin, (node.paintCornerRadius ?? 0) + node.paintStrokeWidth / 2)
    border = Math.max(border, node.paintStrokeWidth / 2)
    graph.children![index]!.ports = []
    graph.children![index]!.layoutOptions = {
      'elk.portConstraints': 'FREE', 'elk.nodeSize.constraints': node.sizePolicy === 'minimum' ? '[PORTS, MINIMUM_SIZE]' : '[]',
      'elk.nodeSize.minimum': `(${node.width},${node.height})`,
    }
  }
  const clearance = (input.nodeClearance ?? 0) + border + input.maximumEdgeStrokeWidth / 2
  if (![margin, clearance, input.edgeSpacing + input.maximumEdgeStrokeWidth].every(Number.isFinite)) throw new TypeError('Measured ELK spacing overflow')
  Object.assign(graph.layoutOptions!, {
    'elk.spacing.portPort': String(input.edgeSpacing),
    'elk.spacing.portsSurrounding': `[top=${margin},left=${margin},bottom=${margin},right=${margin}]`,
    'elk.spacing.edgeEdge': String(input.edgeSpacing + input.maximumEdgeStrokeWidth),
    'elk.layered.spacing.edgeEdgeBetweenLayers': String(input.edgeSpacing + input.maximumEdgeStrokeWidth),
    'elk.spacing.edgeNode': String(Math.max(clearance, Number(graph.layoutOptions!['elk.spacing.edgeNode']))),
    'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.max(clearance, Number(graph.layoutOptions!['elk.layered.spacing.edgeNodeBetweenLayers']))),
    'elk.spacing.nodeSelfLoop': graph.layoutOptions!['elk.spacing.edgeNode']!,
  })
  for (const [index, edge] of input.edges.entries()) {
    if (edge.label && (!valid(edge.label.width, true) || !valid(edge.label.height, true))) throw new TypeError('Invalid measured ELK label demand')
    for (const [end, subject, support] of [['s', edge.source, edge.sourcePortSpan], ['t', edge.target, edge.targetPortSpan]] as const) {
      if (!Number.isInteger(subject) || subject < 0 || subject >= input.nodes.length) throw new TypeError('Measured edge endpoint is outside the node array')
      if (!valid(support, true)) throw new TypeError('Invalid measured ELK endpoint demand')
      const node = input.nodes[subject]!, span = Math.max(support, input.maximumEdgeStrokeWidth, (node.minimumPortSpacing ?? 0) - input.edgeSpacing)
      const id = `p${index}${end}`
      graph.children![subject]!.ports!.push({ id, width: span, height: span, layoutOptions: { 'elk.port.anchor': `(${span / 2},${span / 2})`, 'elk.port.borderOffset': String(-span / 2) } })
      const carrier = graph.edges![index]!
      if (end === 's') carrier.sources = [id]
      else carrier.targets = [id]
    }
  }
}

/** Fixed ELK bodies may compress port gaps. Decline that result rather than
 * returning a route whose reserved contact paint cannot fit its body. */
function assertMeasuredPorts(input: MeasuredLayoutRequest['graph'], placed: MeasuredRoutes): void {
  const faces = Array.from({ length: input.nodes.length * 4 }, () => [] as { at: number; span: number }[])
  for (const [index, edge] of input.edges.entries()) {
    const route = placed.edges[index]!.points
    for (const [subject, point, support] of [[edge.source, route[0], edge.sourcePortSpan], [edge.target, route.at(-1), edge.targetPortSpan]] as const) {
      const body = placed.nodes[subject]!, node = input.nodes[subject]!, width = body.width ?? node.width, height = body.height ?? node.height
      if (!point) throw new TypeError('ELK lost a measured contact')
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
      const side = near(point.x, body.x) ? 0 : near(point.y, body.y) ? 1 : near(point.x, body.x + width) ? 2 : near(point.y, body.y + height) ? 3 : -1
      if (side < 0) throw new TypeError('ELK moved a measured contact off its body')
      const at = side % 2 ? point.x - body.x : point.y - body.y, length = side % 2 ? width : height
      const span = Math.max(support!, input.maximumEdgeStrokeWidth!), margin = (node.paintCornerRadius ?? 0) + node.paintStrokeWidth! / 2
      if (at - span / 2 < margin - 1e-6 || at + span / 2 > length - margin + 1e-6) throw new GraphLayoutUnsupportedError('fixed measured ELK body has insufficient contact capacity', 'ELK')
      faces[subject * 4 + side]!.push({ at, span })
    }
  }
  for (const [index, face] of faces.entries()) {
    face.sort((a, b) => a.at - b.at)
    for (let i = 1; i < face.length; i++) {
      const a = face[i - 1]!, b = face[i]!, pitch = input.nodes[Math.floor(index / 4)]!.minimumPortSpacing ?? 0
      if (b.at - a.at + 1e-6 < Math.max(pitch, (a.span + b.span) / 2 + input.edgeSpacing!)) throw new GraphLayoutUnsupportedError('fixed measured ELK body has insufficient contact capacity', 'ELK')
    }
  }
}
