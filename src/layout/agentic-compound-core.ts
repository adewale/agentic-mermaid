import { assertFinalBoundaryContacts, routeCrossHierarchy } from './compound-boundary-routes.ts'
import { planAncestorBoundaryConnections, projectAncestorBoundaryPlaceholder } from './ancestor-boundary-routes.ts'
import type { ChannelWork } from './channel-tracks.ts'
import type { AgenticLayout, MeasuredGraph } from './agentic-layered-core.ts'
import type { Direction } from '../types.ts'

/** Place scopes bottom-up, then join leaves and frames through bounded boundary
 * corridors. Explicit ancestor contacts reserve their own interior corridors. */
export function layoutCompoundGraph(
  input: MeasuredGraph,
  layout: (flat: MeasuredGraph) => AgenticLayout,
  unsupported: (reason: string) => never,
  expansionLimit: number,
  routingWork: ChannelWork,
): AgenticLayout {
  let groups = input.groups!
  const leafCount = input.nodes.length
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
    if (![group.minWidth, ...Object.values(group.padding)].every(value => Number.isFinite(value) && value >= 0)) throw new TypeError('Invalid measured compound dimensions')
    if (group.headerHeight !== undefined && (!Number.isFinite(group.headerHeight) || group.headerHeight < 0 || group.headerHeight > group.padding.top)) throw new TypeError('Invalid measured compound header')
  }
  for (let index = 0; index < input.edges.length; index++) {
    const edge = input.edges[index]!
    if (!Number.isInteger(edge.source) || !Number.isInteger(edge.target) || edge.source < 0 || edge.target < 0 || edge.source >= count || edge.target >= count) throw new TypeError('Invalid measured compound endpoint')
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
  const ancestorPlan = ancestorEdges ? planAncestorBoundaryConnections(input, owners, routingWork, unsupported) : undefined
  if (ancestorPlan) {
    if (ancestorEdges!.some(index => !ancestorPlan.connections.has(index))) throw new TypeError('Ancestor planner lost an authored endpoint occurrence')
    groups = ancestorPlan.groups
  }
  type Scope = { direction: Direction; placed: AgenticLayout; width: number; height: number; dx: number; dy: number }
  const scopes: Scope[] = new Array(groups.length + 1)
  let expandedVertices = 0
  const place = (scope: number, inherited: Direction): Scope => {
    const group = groups[scope - 1]
    const direction = group?.direction ?? inherited
    const members = children[scope]!, local = new Map(members.map((id, index) => [id, index]))
    const nodes = members.map(id => {
      if (id < leafCount) {
        const { id: identity, width, height, partition, modelOrder, minimumPortSpacing } = input.nodes[id]!
        return { id: identity, width, height, partition, modelOrder, ...(minimumPortSpacing!==undefined?{minimumPortSpacing}:{}) }
      }
      const child = place(id - leafCount + 1, direction)
      return { id: groups[id - leafCount]!.id, width: child.width, height: child.height, partition: groups[id - leafCount]!.partition, modelOrder: groups[id - leafCount]!.modelOrder }
    })
    const edges = hosted[scope]!.map(index => {
      const edge = input.edges[index]!
      const endpoints = lifted.get(index) ?? edge
      return { ...edge, source: local.get(endpoints.source)!, target: local.get(endpoints.target)! }
    })
    const flat: MeasuredGraph = { nodes, edges, padding: 0, direction, nodeSpacing: input.nodeSpacing, layerSpacing: input.layerSpacing, edgeSpacing: input.edgeSpacing, ...(input.minimumTerminalLead !== undefined ? { minimumTerminalLead: input.minimumTerminalLead } : {}), ...(input.placementOnly ? { placementOnly: true } : {}) }
    if (lifted.size && hosted[scope]!.some(index => lifted.has(index))) flat.compactPrivateRanks = true
    const placed = layout(flat)
    expandedVertices += placed.expandedVertices ?? nodes.length
    if (expandedVertices > expansionLimit) unsupported('agentic local compound-expansion limit')
    const pad = group?.padding ?? { top: input.padding, right: input.padding, bottom: input.padding, left: input.padding }
    const width = Math.max(group?.minWidth ?? 0, placed.width + pad.left + pad.right, 1)
    const value = { direction, placed, width, height: Math.max(placed.height + pad.top + pad.bottom, 1), dx: pad.left + (width - placed.width - pad.left - pad.right) / 2, dy: pad.top }
    if (!Number.isFinite(value.width + value.height + value.dx + value.dy)) unsupported('agentic local coordinate-range limit')
    scopes[scope] = value
    return value
  }
  const root = place(0, input.direction)
  const nodes: AgenticLayout['nodes'] = new Array(leafCount)
  const frames: NonNullable<AgenticLayout['groups']> = new Array(groups.length)
  const edges: AgenticLayout['edges'] = new Array(input.edges.length)
  const project = (scope: number, x: number, y: number): void => {
    const value = scopes[scope]!, dx = x + value.dx, dy = y + value.dy
    children[scope]!.forEach((id, index) => {
      const point = value.placed.nodes[index]!, location = { x: point.x + dx, y: point.y + dy }
      if (id < leafCount) nodes[id] = location
      else {
        const groupIndex = id - leafCount, child = scopes[groupIndex + 1]!
        frames[groupIndex] = { ...location, width: child.width, height: child.height }
        project(groupIndex + 1, location.x, location.y)
      }
    })
    hosted[scope]!.forEach((id, index) => {
      const edge = value.placed.edges[index]!
      edges[id] = { points: edge.points.map(point => ({ x: point.x + dx, y: point.y + dy })),
        ...(edge.labelPosition ? { labelPosition: { x: edge.labelPosition.x + dx, y: edge.labelPosition.y + dy } } : {}) }
    })
  }
  project(0, 0, 0)
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
