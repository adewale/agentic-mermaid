// ============================================================================
// Junction contraction for complete-bipartite edge blocks above the layout
// cost thresholds (src/layout/layout-cost.ts).
//
// A block is a set of sources S and targets T where every s ∈ S has an
// unlabeled edge to every t ∈ T, all with the same shaft, markers and
// presentation, no other edge joins those pairs, and the block is closed: no
// other edge leaves a source or enters a target. `A & B & C --> D & E & F`
// authors one. ELK routes |S|·|T| segments through one layer gap, and its
// orthogonal router orders them pairwise, so a 40 × 40 block costs seconds and
// reserves a routing slot per edge. Above the thresholds the layout graph
// replaces each block by |S| + |T| edges through a hidden, zero-size junction:
// sources fan in to it and targets fan out of it, so the existing fan-in and
// fan-out passes draw one collector trunk and one distributor trunk.
//
// Expansion projects the layout back onto the authored graph: every authored
// edge keeps its own identity, endpoints, shaft and markers, and its route is
// its source's collector route followed by its target's distributor route. The
// junction is removed. Shared bus ink is honest because the block is
// complete: wherever the routes of s → t and s' → t' share ink, s → t' and
// s' → t are also authored edges painted alike (the reading the fan bundler's
// opposing-ink admission accepts). Collector ink flows toward the junction and
// distributor ink away from it, so members never share a segment in opposite
// directions. Each source's members share the collector route from that source
// and are recorded as one constructed bundle, so certification audits them as
// intentional shared ink, not as unexplained detours.
// ============================================================================

import type { MermaidEdge, MermaidGraph, MermaidNode, MermaidSubgraph, Point, PositionedEdge, PositionedGraph, PositionedGroup, RouteCertificate } from '../types.ts'
import { resolveEdgeInlineStyle } from '../color-resolver.ts'
import { positionedEdgeFromAuthored } from './passes/elk-edges.ts'
import { bundleRouteBeforeRewrite, reindexConstructedBundleRoute, retainConstructedBundleRoutes } from './bundle-routes.ts'

/** One contracted block: authored edges `sources × targets` meet at `junction`. */
export interface JunctionBlock {
  readonly junction: string
  readonly sources: readonly string[]
  readonly targets: readonly string[]
}

export interface JunctionContraction {
  /** The graph laid out in place of the authored graph. */
  readonly graph: MermaidGraph
  readonly blocks: readonly JunctionBlock[]
  /** Per authored edge: the layout-graph edge carrying it (kept edges), or the
   * collector and distributor edges whose routes it joins (block members). */
  readonly routes: ReadonlyArray<number | readonly [collector: number, distributor: number]>
}

/** Junction placement size: a point, so collector and distributor meet. */
export const JUNCTION_SIZE = Object.freeze({ width: 0, height: 0 })

/** A block is contracted only when it removes edges: |S|·|T| > |S| + |T|. */
function contractsEdges(sources: number, targets: number): boolean {
  return sources >= 2 && targets >= 2 && sources * targets > sources + targets
}

function parentScopes(subgraphs: readonly MermaidSubgraph[]): { parent: Map<string, string>; groups: Set<string> } {
  const parent = new Map<string, string>(), groups = new Set<string>()
  const visit = (group: MermaidSubgraph): void => {
    groups.add(group.id)
    for (const id of group.nodeIds) parent.set(id, group.id)
    group.children.forEach(visit)
  }
  subgraphs.forEach(visit)
  return { parent, groups }
}

/** Everything the drawn bus shares between members, beyond endpoints and identity. */
function sharedInkSignature(graph: MermaidGraph, edge: MermaidEdge, index: number): string {
  return JSON.stringify([
    edge.style, edge.hasArrowStart, edge.hasArrowStart ? edge.startMarker ?? 'arrow' : '', edge.hasArrowEnd, edge.hasArrowEnd ? edge.endMarker ?? 'arrow' : '',
    edge.curve ?? '', edge.animate ?? false, edge.animation ?? '', graph.linkCurves?.get(index) ?? '',
    resolveEdgeInlineStyle(index, graph) ?? null,
    edge.id !== undefined ? graph.classAssignments.get(edge.id) ?? '' : '',
  ])
}

/**
 * The maximal complete-bipartite blocks whose sources share an identical
 * target set, contracted through junctions. O(V + E log E) and deterministic:
 * blocks, junction identities and layout edges follow authored order.
 * Undefined when no block removes an edge.
 */
export function contractBipartiteBlocks(graph: MermaidGraph): JunctionContraction | undefined {
  const { parent, groups } = parentScopes(graph.subgraphs)
  const pairs = new Map<string, number>()
  for (const edge of graph.edges) {
    const pair = JSON.stringify([edge.source, edge.target])
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1)
  }
  // Candidate edges: plain, unlabeled, between two leaf nodes of one scope,
  // the only edge joining their ordered pair.
  const families = new Map<string, Map<string, number[]>>()
  graph.edges.forEach((edge, index) => {
    if (edge.source === edge.target || edge.label !== undefined || edge.style === 'invisible' || (edge.length ?? 1) !== 1) return
    if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target) || groups.has(edge.source) || groups.has(edge.target)) return
    if (pairs.get(JSON.stringify([edge.source, edge.target])) !== 1) return
    const scope = parent.get(edge.source) ?? ''
    if ((parent.get(edge.target) ?? '') !== scope) return
    const family = JSON.stringify([scope, sharedInkSignature(graph, edge, index)])
    let bySource = families.get(family)
    if (!bySource) families.set(family, bySource = new Map())
    let members = bySource.get(edge.source)
    if (!members) bySource.set(edge.source, members = [])
    members.push(index)
  })
  const nodeOrder = new Map<string, number>()
  for (const id of graph.nodes.keys()) nodeOrder.set(id, nodeOrder.size)
  interface Draft { scope: string; sources: string[]; targets: string[]; first: number; members: number[] }
  const drafts: Draft[] = []
  for (const [family, bySource] of families) {
    const scope = JSON.parse(family)[0] as string
    const byTargets = new Map<string, Draft>()
    for (const [source, members] of bySource) {
      const targets = members.map(index => graph.edges[index]!.target).sort((a, b) => nodeOrder.get(a)! - nodeOrder.get(b)!)
      const key = JSON.stringify(targets)
      const draft = byTargets.get(key)
      if (draft) { draft.sources.push(source); draft.members.push(...members); draft.first = Math.min(draft.first, members[0]!) }
      else byTargets.set(key, { scope, sources: [source], targets, first: members[0]!, members: [...members] })
    }
    for (const draft of byTargets.values()) if (contractsEdges(draft.sources.length, draft.targets.length)) drafts.push(draft)
  }
  // A block is closed: no other edge leaves one of its sources or enters one of
  // its targets. Every route at a block terminal is then the block's one shared
  // collector or distributor route with one marker, so no unrelated arrowhead
  // or port competes with the bus there.
  const outgoing = new Map<string, number>(), incoming = new Map<string, number>()
  for (const edge of graph.edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
  }
  for (let k = drafts.length - 1; k >= 0; k--) {
    const { sources, targets } = drafts[k]!
    if (sources.some(s => outgoing.get(s) !== targets.length) || targets.some(t => incoming.get(t) !== sources.length)) drafts.splice(k, 1)
  }
  if (drafts.length === 0) return undefined
  drafts.sort((a, b) => a.first - b.first)

  const taken = new Set<string>([...graph.nodes.keys(), ...groups])
  const junctionId = (k: number): string => {
    let id = `am-junction-${k}`
    while (taken.has(id)) id = `_${id}`
    taken.add(id)
    return id
  }
  const memberOf = new Map<number, { draft: number; source: string; target: string }>()
  drafts.forEach((draft, k) => { for (const index of draft.members) memberOf.set(index, { draft: k, source: graph.edges[index]!.source, target: graph.edges[index]!.target }) })
  const blocks = drafts.map((draft, k) => ({ junction: junctionId(k), sources: draft.sources, targets: draft.targets }))

  // Layout edges in authored order; a block's collector and distributor edges
  // take the place of its first authored member.
  const anchored = new Map(drafts.map((draft, k) => [draft.first, k]))
  const edges: MermaidEdge[] = []
  const linkStyles = new Map<number | 'default', Record<string, string>>()
  const defaultStyle = graph.linkStyles.get('default')
  if (defaultStyle) linkStyles.set('default', defaultStyle)
  const linkCurves = graph.linkCurves ? new Map<number | 'default', string>() : undefined
  const defaultCurve = graph.linkCurves?.get('default')
  if (linkCurves && defaultCurve !== undefined) linkCurves.set('default', defaultCurve)
  const collector = new Map<string, number>(), distributor = new Map<string, number>()
  const routes: Array<number | readonly [number, number]> = []
  graph.edges.forEach((edge, index) => {
    const k = anchored.get(index)
    if (k !== undefined) {
      // Shaft and presentation stay the authored ones (members share them);
      // the start marker belongs to each source, the end marker to each target,
      // and none to the junction.
      const first = drafts[k]!.first, block = blocks[k]!
      const { id: _id, ...shared } = graph.edges[first]!
      const style = resolveEdgeInlineStyle(first, graph), curve = graph.linkCurves?.get(first)
      const push = (layoutEdge: MermaidEdge): number => {
        if (style) linkStyles.set(edges.length, style)
        if (linkCurves && curve !== undefined) linkCurves.set(edges.length, curve)
        return edges.push(layoutEdge) - 1
      }
      for (const source of block.sources) collector.set(`${k}\0${source}`, push({ ...shared, source, target: block.junction, hasArrowEnd: false, endMarker: undefined }))
      for (const target of block.targets) distributor.set(`${k}\0${target}`, push({ ...shared, source: block.junction, target, hasArrowStart: false, startMarker: undefined }))
    }
    const member = memberOf.get(index)
    if (member) { routes.push([collector.get(`${member.draft}\0${member.source}`)!, distributor.get(`${member.draft}\0${member.target}`)!]); return }
    const style = graph.linkStyles.get(index), curve = graph.linkCurves?.get(index)
    if (style) linkStyles.set(edges.length, style)
    if (linkCurves && curve !== undefined) linkCurves.set(edges.length, curve)
    routes.push(edges.push(edge) - 1)
  })

  // Each junction follows its block's last-declared source in model order,
  // so model-order ranking and ordering see sources, junction, targets.
  const after = new Map<string, string[]>()
  const scoped = new Map<string, string[]>()
  blocks.forEach((block, k) => {
    const last = block.sources.reduce((a, b) => nodeOrder.get(b)! > nodeOrder.get(a)! ? b : a)
    after.set(last, [...(after.get(last) ?? []), block.junction])
    const scope = drafts[k]!.scope
    if (scope) scoped.set(scope, [...(scoped.get(scope) ?? []), block.junction])
  })
  const nodes = new Map<string, MermaidNode>()
  for (const [id, node] of graph.nodes) {
    nodes.set(id, node)
    for (const junction of after.get(id) ?? []) nodes.set(junction, { id: junction, label: '', shape: 'rectangle' })
  }
  const withJunctions = (subgraphs: readonly MermaidSubgraph[]): MermaidSubgraph[] => subgraphs.map(group => ({
    ...group,
    nodeIds: scoped.has(group.id) ? [...group.nodeIds, ...scoped.get(group.id)!] : group.nodeIds,
    children: withJunctions(group.children),
  }))
  const contracted: MermaidGraph = {
    ...graph,
    nodes,
    edges,
    subgraphs: scoped.size ? withJunctions(graph.subgraphs) : graph.subgraphs,
    linkStyles,
    ...(linkCurves ? { linkCurves } : {}),
  }
  return { graph: contracted, blocks, routes }
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

/** Join a collector route (ending at the junction) and a distributor route
 * (starting there) into one orthogonal polyline without repeated or
 * collinear interior points. */
function joinAtJunction(collector: readonly Point[], distributor: readonly Point[]): Point[] {
  const joined: Point[] = collector.map(point => ({ ...point }))
  const last = joined.at(-1)!, first = distributor[0]!
  // A junction is a point; a route that stops short of it on one axis
  // meets the other with one orthogonal step.
  if (!samePoint(last, first) && Math.abs(last.x - first.x) > 1e-6 && Math.abs(last.y - first.y) > 1e-6) joined.push({ x: first.x, y: last.y })
  for (const point of distributor) joined.push({ ...point })
  const simplified: Point[] = []
  for (const point of joined) {
    const previous = simplified.at(-1)
    if (previous && samePoint(previous, point)) continue
    const before = simplified.at(-2)
    if (before && previous && ((Math.abs(before.x - previous.x) < 1e-6 && Math.abs(previous.x - point.x) < 1e-6 && (previous.y - before.y) * (point.y - previous.y) >= 0)
      || (Math.abs(before.y - previous.y) < 1e-6 && Math.abs(previous.y - point.y) < 1e-6 && (previous.x - before.x) * (point.x - previous.x) >= 0))) simplified.pop()
    simplified.push(point)
  }
  return simplified
}

/**
 * Project a layout of `contraction.graph` onto the authored graph, in place:
 * junction nodes are removed and every authored edge, in authored order,
 * carries its own identity on its joined route.
 */
export function expandJunctionLayout(authored: MermaidGraph, contraction: JunctionContraction, positioned: PositionedGraph): PositionedGraph {
  const junctions = new Set(contraction.blocks.map(block => block.junction))
  const produced = new Map<number, PositionedEdge>()
  for (const edge of positioned.edges) if (edge.edgeIndex !== undefined) produced.set(edge.edgeIndex, edge)
  const edges: PositionedEdge[] = []
  const bySource = new Map<string, PositionedEdge[]>()
  contraction.routes.forEach((route, index) => {
    if (typeof route === 'number') {
      const edge = produced.get(route)
      if (!edge) return
      const owned = bundleRouteBeforeRewrite(edge)
      const projected = positionedEdgeFromAuthored(authored, index, edge.points, edge.labelPosition)
      edges.push(Object.assign(edge, projected, edge.routeCertificate ? { routeCertificate: { ...edge.routeCertificate, edgeIndex: index } } : {}))
      reindexConstructedBundleRoute(edge, owned)
      return
    }
    const collector = produced.get(route[0]), distributor = produced.get(route[1])
    if (!collector || !distributor || collector.points.length === 0 || distributor.points.length === 0) return
    const points = joinAtJunction(collector.points, distributor.points)
    const edge = positionedEdgeFromAuthored(authored, index, points, undefined)
    delete edge.labelPosition
    const certificate: RouteCertificate = {
      edgeIndex: index,
      routeClass: collector.routeCertificate?.routeClass ?? 'primary-forward',
      invariant: 'bundle',
      bendCount: Math.max(0, points.length - 2),
      ...(collector.routeCertificate?.sourcePort ? { sourcePort: collector.routeCertificate.sourcePort } : {}),
      ...(distributor.routeCertificate?.targetPort ? { targetPort: distributor.routeCertificate.targetPort } : {}),
      ...(collector.routeCertificate?.sourcePortAssignment ? { sourcePortAssignment: collector.routeCertificate.sourcePortAssignment } : {}),
      ...(distributor.routeCertificate?.targetPortAssignment ? { targetPortAssignment: distributor.routeCertificate.targetPortAssignment } : {}),
    }
    edge.routeCertificate = certificate
    edges.push(edge)
    let fan = bySource.get(edge.source)
    if (!fan) bySource.set(edge.source, fan = [])
    fan.push(edge)
  })
  // Each source's members share its collector route up to the junction.
  const owned = new Set<PositionedEdge>()
  for (const fan of bySource.values()) if (fan.length >= 2) retainConstructedBundleRoutes(fan, owned)
  positioned.nodes = positioned.nodes.filter(node => !junctions.has(node.id))
  const prune = (groups: PositionedGroup[]): void => {
    for (const group of groups) {
      if (group.nodeIds) group.nodeIds = group.nodeIds.filter(id => !junctions.has(id))
      prune(group.children)
    }
  }
  prune(positioned.groups)
  positioned.edges = edges
  return positioned
}
