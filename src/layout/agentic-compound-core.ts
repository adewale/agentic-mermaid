import { assertFinalBoundaryContacts, routeCrossHierarchy } from './compound-boundary-routes.ts'
import { planAncestorBoundaryConnections, projectAncestorBoundaryPlaceholder } from './ancestor-boundary-routes.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import { placeMeasuredScopes } from './measured-scopes.ts'
import type { NativeNestingResult } from './native-nesting.ts'

/** Cross-scope paths share authored root order before disconnected child
 * forests choose their coordinates. Eligibility is complete before refill. */
function orderPrivateLeafPaths(input: MeasuredGraph, owners: Int32Array, children: number[][], work: ChannelWork): void {
  const count = input.nodes.length, groups = input.groups!.length, edges = input.edges.length
  // Every component visits at most one leaf per group in the quotient DAG.
  // N = G * (N - E) admits complete bundles, preserving partial-path rows.
  if (count !== groups * (count - edges)) return
  // The already-paid quotient DAG rules out leaf cycles and scope revisits.
  // Reserve all storage and traversal work before the first private write.
  const slots = 2 * count + groups + 3, operations = 6 * count + groups + 4 * edges + 3
  if (work.arcs < slots || work.pairs < operations) return
  work.arcs -= 2 * count + 2
  work.pairs -= 2 * count + 4 * edges + 2
  const incoming = new Int32Array(count).fill(-1), outgoing = new Int32Array(count).fill(-1)
  for (const edge of input.edges) {
    if (outgoing[edge.source] !== -1 || incoming[edge.target] !== -1) return
    outgoing[edge.source] = edge.target; incoming[edge.target] = edge.source
  }
  work.arcs -= groups + 1
  work.pairs -= 4 * count + groups + 1
  const cursors = new Int32Array(groups)
  for (let root = 0; root < count; root++) if (incoming[root] === -1) {
    for (let node = root; node !== -1; node = outgoing[node]!) {
      const owner = owners[node]!
      children[owner + 1]![cursors[owner]!] = node
      cursors[owner] = cursors[owner]! + 1
    }
  }
}

/** Place scopes bottom-up, then join leaves and frames through bounded boundary
 * corridors. Explicit ancestor contacts reserve their own interior corridors. */
export function layoutCompoundGraph(
  input: MeasuredGraph,
  layout: (flat: MeasuredGraph) => AgenticLayout,
  unsupported: (reason: string) => never,
  expansionLimit: number,
  routingWork: ChannelWork,
  global?: (owners: Int32Array, children: number[][], lifted: ReadonlyMap<number, { source: number; target: number; host: number }>) => NativeNestingResult,
): AgenticLayout {
  let groups = input.groups!
  const leafCount = input.nodes.length
  let pathOrder = (input.direction === 'LR' || input.direction === 'RL') && groups.length > 1 && leafCount > 0 && input.edges.length > 0
  const count = leafCount + groups.length
  const owners = new Int32Array(count).fill(-1)
  const children: number[][] = Array.from({ length: groups.length + 1 }, () => [])
  const hosted: number[][] = Array.from({ length: groups.length + 1 }, () => [])
  const lifted = new Map<number, { source: number; target: number; host: number }>()
  let ancestorEdges: number[] | undefined
  const ids = new Set<string>()
  for (let index = 0; index < count; index++) {
    const subject = index < leafCount ? input.nodes[index]! : groups[index - leafCount]!
    if (ids.has(subject.id)) throw new TypeError('Measured compound identities must be unique')
    ids.add(subject.id)
    if (subject.modelOrder !== undefined && (!Number.isSafeInteger(subject.modelOrder) || subject.modelOrder < 0)) throw new TypeError('Invalid measured model order')
    if (subject.partition !== undefined && (!Number.isSafeInteger(subject.partition) || subject.partition < 0 || subject.partition > 10000)) throw new TypeError('Invalid measured partition')
    const parent = subject.parent ?? -1
    if (!Number.isInteger(parent) || parent < -1 || parent >= groups.length || (parent >= 0 && index === leafCount + parent)) throw new TypeError('Invalid measured compound parent')
    if (pathOrder && (subject.modelOrder !== undefined || subject.partition !== undefined || (index < leafCount ? parent < 0 : parent !== -1))) pathOrder = false
    if (index < leafCount) {
      const node = input.nodes[index]!
      if (![node.width, node.height].every(value => Number.isFinite(value) && value > 0)) throw new TypeError('Invalid measured compound leaf dimensions')
    }
    owners[index] = parent
    children[parent + 1]!.push(index)
  }
  // Check every chain before recursive placement, including detached cycles.
  for (let index = 0; index < groups.length; index++) {
    const seen = new Set<number>()
    for (let parent = index; parent >= 0; parent = owners[leafCount + parent]!) {
      if (seen.has(parent)) throw new TypeError('Measured compound parents must be acyclic')
      seen.add(parent)
      if (seen.size > 64) unsupported('agentic local compound-depth limit')
    }
    const group = groups[index]!
    if (group.direction !== undefined && !['TD', 'TB', 'BT', 'LR', 'RL'].includes(group.direction)) throw new TypeError('Invalid measured compound direction')
    if (pathOrder && group.direction !== undefined && group.direction !== input.direction) pathOrder = false
    if (![group.minWidth, ...Object.values(group.padding)].every(value => Number.isFinite(value) && value >= 0)) throw new TypeError('Invalid measured compound dimensions')
    if (group.headerHeight !== undefined && (!Number.isFinite(group.headerHeight) || group.headerHeight < 0 || group.headerHeight > group.padding.top)) throw new TypeError('Invalid measured compound header')
  }
  for (let index = 0; index < input.edges.length; index++) {
    const edge = input.edges[index]!
    if (!Number.isInteger(edge.source) || !Number.isInteger(edge.target) || edge.source < 0 || edge.target < 0 || edge.source >= count || edge.target >= count) throw new TypeError('Invalid measured compound endpoint')
    if (pathOrder && (edge.source >= leafCount || edge.target >= leafCount || edge.source === edge.target || edge.label !== undefined || edge.visible === false || owners[edge.source] === owners[edge.target])) pathOrder = false
    if (!Number.isSafeInteger(edge.minSpan) || edge.minSpan < 1 || (edge.label && ![edge.label.width, edge.label.height].every(value => Number.isFinite(value) && value >= 0))) throw new TypeError('Invalid measured compound edge dimensions')
    if (edge.short !== undefined && edge.short !== true) throw new TypeError('Invalid measured short-edge preference')
    if (edge.boundaryMarker !== undefined && (![edge.boundaryMarker.inset, edge.boundaryMarker.height].every(value => Number.isFinite(value) && value >= 0))) throw new TypeError('Invalid measured ancestor marker dimensions')
    let owner = owners[edge.source]!
    if (owner !== owners[edge.target]) {
      const ancestors = new Set<number>([-1])
      for (let parent = owner; parent >= 0; parent = owners[leafCount + parent]!) ancestors.add(parent)
      owner = owners[edge.target]!
      while (!ancestors.has(owner)) owner = owners[leafCount + owner]!
      const representative = (endpoint: number): number => {
        while (owners[endpoint] !== owner) endpoint = leafCount + owners[endpoint]!
        return endpoint
      }
      const source = representative(edge.source), target = representative(edge.target)
      if (source === target) { (ancestorEdges ??= []).push(index); continue }
      lifted.set(index, { source, target, host: owner })
    }
    hosted[owner + 1]!.push(index)
  }
  const globalResult = global?.(owners, children, lifted)
  if (globalResult && globalResult !== 'acyclic-quotient') return globalResult
  if (pathOrder && globalResult === 'acyclic-quotient') orderPrivateLeafPaths(input, owners, children, routingWork)
  const ancestorPlan = ancestorEdges ? planAncestorBoundaryConnections(input, owners, routingWork, unsupported) : undefined
  if (ancestorPlan) {
    if (ancestorEdges!.some(index => !ancestorPlan.connections.has(index))) throw new TypeError('Ancestor planner lost an authored endpoint occurrence')
    groups = ancestorPlan.groups
  }
  let expandedVertices = 0
  const edges: AgenticLayout['edges'] = new Array(input.edges.length)
  const { root, scopes, nodes, frames } = placeMeasuredScopes<AgenticLayout>(input, groups, children, leafCount, (scope, direction, placeChild) => {
    const members = children[scope]!, local = new Map(members.map((id, index) => [id, index]))
    const nodes = members.map(id => {
      if (id < leafCount) {
        const { parent: _parent, ...node } = input.nodes[id]!
        return node
      }
      const child = placeChild(id)
      return { id: groups[id - leafCount]!.id, width: child.width, height: child.height, partition: groups[id - leafCount]!.partition, modelOrder: groups[id - leafCount]!.modelOrder }
    })
    const edges = hosted[scope]!.map(index => {
      const edge = input.edges[index]!
      const endpoints = lifted.get(index) ?? edge
      return { ...edge, source: local.get(endpoints.source)!, target: local.get(endpoints.target)! }
    })
    const flat: MeasuredGraph = { nodes, edges, padding: 0, direction, nodeSpacing: input.nodeSpacing, layerSpacing: input.layerSpacing, edgeSpacing: input.edgeSpacing, ...(input.minimumTerminalLead !== undefined ? { minimumTerminalLead: input.minimumTerminalLead } : {}), ...(input.placementOnly ? { placementOnly: true } : {}) }
    if (lifted.size && hosted[scope]!.some(index => lifted.has(index))) {
      flat.compactPrivateRanks = true
      flat.groupCycleEdges = hosted[scope]!.flatMap((index, local) => lifted.has(index) ? [local] : [])
    }
    const placed = layout(flat)
    expandedVertices += placed.expandedVertices ?? nodes.length
    if (expandedVertices > expansionLimit) unsupported('agentic local compound-expansion limit')
    return placed
  }, unsupported, (scope, dx, dy, placed) => {
    hosted[scope]!.forEach((id, index) => {
      const edge = placed.edges[index]!
      edges[id] = { points: edge.points.map(point => ({ x: point.x + dx, y: point.y + dy })),
        ...(edge.labelPosition ? { labelPosition: { x: edge.labelPosition.x + dx, y: edge.labelPosition.y + dy } } : {}) }
    })
  })
  if (ancestorPlan) for (const index of ancestorPlan.connections.keys()) edges[index] = projectAncestorBoundaryPlaceholder(ancestorPlan, index, frames, amount => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError('Invalid ancestor placeholder reservation')
    if (expandedVertices + amount > expansionLimit) unsupported('agentic local compound-expansion limit')
    expandedVertices += amount
  })
  const result: AgenticLayout = { topology: 'layered', width: root.width, height: root.height, nodes, groups: frames, edges, expandedVertices }
  // Every cross-scope edge participated at its lowest common scope. The
  // family owns boundary routing; omitting that work must not omit the edge's
  // placement influence as the previous filtered retry did.
  let markerPaint = false
  if (input.maximumEdgeStrokeWidth !== undefined) for (const edge of input.edges) {
    if (--routingWork.pairs<0) unsupported('agentic marker metadata work limit')
    if (edge.markerPaint?.start?.length || edge.markerPaint?.end?.length) { markerPaint=true;break }
  }
  if (input.placementOnly) return result
  if (!lifted.size && !ancestorPlan && !markerPaint) {
    if (input.maximumEdgeStrokeWidth !== undefined && input.maximumEdgeBendRadius === 0) {
      if (--routingWork.arcs < 0) unsupported('agentic local cross-hierarchy visibility-arc limit')
      if (--routingWork.pairs < 0) unsupported('agentic local cross-hierarchy crossing-work limit')
      assertFinalBoundaryContacts(input,result,new Set(),routingWork,unsupported)
    }
    return result
  }
  return routeCrossHierarchy(input, result, owners, lifted, scopes.map(scope => scope.direction), routingWork, expansionLimit, unsupported, ancestorPlan)
}
