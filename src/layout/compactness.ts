// Advisory compactness checks over final positioned geometry (verify Tier 3).
//
// Rank slack: a forward edge spans more node layers than any path between its
// endpoints requires. Layers are the merged intervals of node boxes projected
// on the flow axis, and an edge is forward when its target's layer follows its
// source's, so back edges drop out by construction. An edge of authored length
// L asks for L layers of advance and a path for the sum of its edges' lengths;
// slack is the advance beyond the longest forward path, which then needs no
// node between the endpoints to sit where it does.
//
// Title strip: a visible horizontal route segment inside a titled group,
// between the bottom of its header band and the top of its first member or
// child group. Certification already refuses routes that enter the painted
// header band itself, or for Swimlane lanes that travel inside it rather than
// cross it (positionedHeaderRouteFindings in ./certification.ts), so the strip
// starts exactly where that band ends.

import type { Direction } from '../types.ts'

export interface CompactnessNode {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface CompactnessEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly path: readonly (readonly [number, number])[]
  /** Hidden (invisible) edges still order layers but are never reported. */
  readonly visibility?: 'visible' | 'hidden'
  /** Authored Mermaid link length (rank-distance intent); undefined means 1. */
  readonly length?: number
}

export interface CompactnessGroup extends CompactnessNode {
  /** Direct member node ids. */
  readonly members: readonly string[]
  readonly parentId?: string
  /** Height of the reserved title band; 0 means the group draws no title. */
  readonly headerHeight: number
}

export interface CompactnessGeometry {
  readonly nodes: readonly CompactnessNode[]
  readonly edges: readonly CompactnessEdge[]
  readonly groups: readonly CompactnessGroup[]
}

export interface RankSlackFinding {
  readonly edge: string
  readonly from: string
  readonly to: string
  /** Node layers strictly between the endpoints' layers. */
  readonly spannedLayers: number
  /** Layers the longest forward path between the endpoints needs between them. */
  readonly requiredLayers: number
}

export interface TitleStripFinding {
  readonly edge: string
  readonly from: string
  readonly to: string
  readonly group: string
  /** Distance from the bottom of the title band to the closest such segment. */
  readonly clearancePx: number
}

/** Smallest reported slack: one spare layer is common and harmless. */
export const RANK_SLACK_MIN = 2
const TITLE_STRIP_MIN_OVERLAP = 8
const EPSILON = 0.5

/** Rank slack needs the flow direction; without one only the title strip is checked. */
export function compactnessFindings(geometry: CompactnessGeometry, direction?: Direction): { rankSlack: RankSlackFinding[]; titleStripRoutes: TitleStripFinding[] } {
  return { rankSlack: direction ? rankSlack(geometry, direction) : [], titleStripRoutes: titleStripRoutes(geometry) }
}

function rankSlack({ nodes, edges }: CompactnessGeometry, direction: Direction): RankSlackFinding[] {
  const horizontal = direction === 'LR' || direction === 'RL'
  const reversed = direction === 'BT' || direction === 'RL'
  const ordered = nodes
    .map(node => {
      const low = horizontal ? node.x : node.y
      const high = low + (horizontal ? node.w : node.h)
      return { id: node.id, low: reversed ? -high : low, high: reversed ? -low : high }
    })
    .sort((a, b) => a.low - b.low || a.high - b.high)
  const layer = new Map<string, number>()
  let index = -1
  let end = -Infinity
  for (const node of ordered) {
    if (node.low >= end - EPSILON) {
      index++
      end = node.high
    } else end = Math.max(end, node.high)
    layer.set(node.id, index)
  }

  const length = (edge: CompactnessEdge) => Math.max(1, edge.length ?? 1)
  const advance = (edge: CompactnessEdge) => (layer.get(edge.to) ?? -Infinity) - (layer.get(edge.from) ?? Infinity)
  const forward = edges.filter(edge => edge.from !== edge.to && advance(edge) > 0)
  const outgoing = new Map<string, CompactnessEdge[]>()
  for (const edge of forward) {
    const list = outgoing.get(edge.from)
    if (list) list.push(edge)
    else outgoing.set(edge.from, [edge])
  }
  const candidates = forward.filter(edge => edge.visibility !== 'hidden' && advance(edge) - length(edge) >= RANK_SLACK_MIN)

  // Longest weighted forward path from one source: layers strictly increase
  // along forward edges, so the layer order is a topological order.
  const longestFrom = new Map<string, Map<string, number>>()
  const longest = (source: string): Map<string, number> => {
    const known = longestFrom.get(source)
    if (known) return known
    const distance = new Map([[source, 0]])
    for (const { id } of ordered) {
      const reached = distance.get(id)
      if (reached === undefined) continue
      for (const edge of outgoing.get(id) ?? []) distance.set(edge.to, Math.max(distance.get(edge.to) ?? 0, reached + length(edge)))
    }
    longestFrom.set(source, distance)
    return distance
  }

  const findings: RankSlackFinding[] = []
  for (const edge of candidates) {
    const spannedLayers = advance(edge) - 1
    const requiredLayers = longest(edge.from).get(edge.to)! - 1
    if (spannedLayers - requiredLayers >= RANK_SLACK_MIN) findings.push({ edge: edge.id, from: edge.from, to: edge.to, spannedLayers, requiredLayers })
  }
  return findings
}

function titleStripRoutes({ nodes, edges, groups }: CompactnessGeometry): TitleStripFinding[] {
  const boxes = new Map(nodes.map(node => [node.id, node]))
  const findings: TitleStripFinding[] = []
  for (const group of groups) {
    if (!(group.headerHeight > 0)) continue
    const contentTops = [
      ...group.members.flatMap(id => (boxes.has(id) ? [boxes.get(id)!.y] : [])),
      ...groups.filter(child => child.parentId === group.id).map(child => child.y),
    ]
    // An empty group has no content for a route to push down; any strip
    // ends at the group's own bottom edge.
    if (contentTops.length === 0) continue
    const firstTop = Math.min(...contentTops, group.y + group.h)
    const stripTop = group.y + group.headerHeight
    if (!(firstTop - EPSILON > stripTop)) continue
    for (const edge of edges) {
      if (edge.visibility === 'hidden' || edge.from === edge.to) continue
      let clearance = Infinity
      for (let index = 1; index < edge.path.length; index++) {
        const [ax, ay] = edge.path[index - 1]!
        const [bx, by] = edge.path[index]!
        if (Math.abs(ay - by) > EPSILON || ay < stripTop || ay >= firstTop - EPSILON) continue
        const overlap = Math.min(Math.max(ax, bx), group.x + group.w) - Math.max(Math.min(ax, bx), group.x)
        if (overlap >= TITLE_STRIP_MIN_OVERLAP) clearance = Math.min(clearance, ay - stripTop)
      }
      if (clearance < Infinity) findings.push({ edge: edge.id, from: edge.from, to: edge.to, group: group.id, clearancePx: clearance })
    }
  }
  return findings
}
