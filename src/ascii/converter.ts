import { resolveLabelContent, type DisplayTextInput } from '../shared/display-text.ts'
import { assertMermaidGraphWork } from '../shared/diagram-limits.ts'
import { OccupancyMap } from './occupancy.ts'
// ============================================================================
// ASCII renderer — MermaidGraph → AsciiGraph converter
//
// Bridges the existing TypeScript parser output to the ASCII renderer's
// internal graph structure. This avoids maintaining a separate parser
// for ASCII rendering — we reuse parseMermaid() and convert its output.
// ============================================================================

import type { MermaidGraph, MermaidSubgraph } from '../types.ts'
import type {
  AsciiGraph, AsciiNode, AsciiEdge, AsciiSubgraph, AsciiConfig,
} from './types.ts'
import { EMPTY_STYLE } from './types.ts'
import { mkCanvas } from './canvas.ts'
import { classifyRoutes } from '../route-contracts.ts'
import { displayText } from '../multiline-utils.ts'
import { wrapText } from './wrap.ts'
import { resolveNodeInlineStyle, resolveEdgeInlineStyle } from '../color-resolver.ts'

/**
 * Convert a parsed MermaidGraph into an AsciiGraph ready for grid layout.
 *
 * Key mappings:
 * - MermaidGraph.nodes (Map) → ordered AsciiNode[] preserving insertion order
 * - MermaidGraph.edges → AsciiEdge[] with resolved node references
 * - MermaidGraph.subgraphs → AsciiSubgraph[] with parent/child tree
 * - Node labels are used as display names (not raw IDs)
 */
export function convertToAsciiGraph(parsed: MermaidGraph, config: AsciiConfig, containerKind: 'subgraph' | 'cluster' = 'subgraph'): AsciiGraph {
  assertMermaidGraphWork(parsed)
  const width = config.maxWidth === undefined ? undefined : Math.max(config.targetWidth === undefined ? 8 : 1, Math.floor(config.maxWidth / 3))
  const label = (text: DisplayTextInput): string => wrapText(displayText(text), width).join('\n')
  const subgraphIds = collectSubgraphIds(parsed.subgraphs)

  // Build node list preserving Map insertion order. A parsed node whose id is
  // also a subgraph id is a container reference, not a real node box; omit it
  // and route matching edges through a subgraph anchor instead.
  const nodeMap = new Map<string, AsciiNode>()
  let index = 0

  for (const [id, mNode] of parsed.nodes) {
    if (subgraphIds.has(id)) continue

    const asciiNode: AsciiNode = {
      // Use the parser ID as the unique identity key to avoid collisions
      // when multiple nodes share the same label (e.g. A[Web Server], C[Web Server]).
      name: id,
      // The label's display text is drawn inside the box: formatting tags
      // style the SVG runs and are not characters, so the cells show what
      // the SVG shows.
      displayLabel: label(resolveLabelContent(mNode.label, mNode.labelContent)),
      // Preserve shape from parser for shape-aware rendering
      shape: mNode.shape,
      index,
      gridCoord: null,
      drawingCoord: null,
      drawing: null,
      drawn: false,
      styleClassName: '',
      styleClass: EMPTY_STYLE,
    }
    nodeMap.set(id, asciiNode)
    index++
  }

  // Convert subgraphs recursively
  const subgraphs: AsciiSubgraph[] = []
  for (const mSg of parsed.subgraphs) {
    convertSubgraph(mSg, null, nodeMap, subgraphs)
  }
  for (const group of subgraphs) group.name = wrapText(group.name, width).join('\n')

  // Deduplicate subgraph node membership to match Go parser behavior.
  // In Go, a node belongs only to the subgraph where it was FIRST DEFINED.
  // The TS parser adds referenced nodes to all subgraphs they appear in,
  // which causes incorrect bounding boxes when nodes span subgraph boundaries.
  deduplicateSubgraphNodes(parsed.subgraphs, subgraphs)

  // Empty containers still need a placeable cell envelope and real ports.
  // Their private anchors participate in allocation only; they never paint or
  // become semantic members/regions.
  for (const group of [...subgraphs].reverse()) {
    if (group.nodes.length) continue
    let name = `__container:${group.id}`
    while (nodeMap.has(name)) name += ':'
    const anchor: AsciiNode = {
      name, displayLabel: '', shape: 'rectangle', index: index++,
      gridCoord: null, drawingCoord: null, drawing: null, drawn: true,
      styleClassName: '', styleClass: EMPTY_STYLE, containerAnchor: true,
    }
    nodeMap.set(name, anchor)
    for (let parent: AsciiSubgraph | null = group; parent; parent = parent.parent) parent.nodes.push(anchor)
  }

  const subgraphById = new Map(subgraphs.map(sg => [sg.id, sg] as const))
  const routeClasses = classifyRoutes(parsed)

  // Build edges with resolved node references. Edges that target a subgraph id
  // route through a stable inner anchor for placement/pathfinding, then draw to
  // the container border instead of rendering a duplicate phantom node.
  const edges: AsciiEdge[] = []
  for (let edgeIndex = 0; edgeIndex < parsed.edges.length; edgeIndex++) {
    const mEdge = parsed.edges[edgeIndex]!
    const fromSubgraph = nodeMap.has(mEdge.source) ? undefined : subgraphById.get(mEdge.source)
    const toSubgraph = nodeMap.has(mEdge.target) ? undefined : subgraphById.get(mEdge.target)
    const from = nodeMap.get(mEdge.source) ?? (fromSubgraph ? chooseSubgraphAnchor(parsed, fromSubgraph, 'out') : undefined)
    const to = nodeMap.get(mEdge.target) ?? (toSubgraph ? chooseSubgraphAnchor(parsed, toSubgraph, 'in') : undefined)
    if (!from || !to) continue
    const routeClass = routeClasses[edgeIndex]
    if (!routeClass) throw new Error(`ASCII route classification missing for edge ${edgeIndex}`)

    edges.push({
      id: mEdge.id ?? `edge#${edgeIndex}:${mEdge.source}->${mEdge.target}`,
      sourceIndex: edgeIndex,
      inlineStyle: resolveEdgeInlineStyle(edgeIndex, parsed),
      from,
      to,
      fromSubgraph,
      toSubgraph,
      text: label(resolveLabelContent(mEdge.label ?? '', mEdge.labelContent)),
      path: [],
      labelLine: [],
      startDir: { x: 0, y: 0 },
      endDir: { x: 0, y: 0 },
      routeClass,
      style: mEdge.style,
      hasArrowStart: mEdge.hasArrowStart,
      hasArrowEnd: mEdge.hasArrowEnd,
      startMarker: mEdge.startMarker,
      endMarker: mEdge.endMarker,
    })
  }

  const nodes = [...nodeMap.values()]

  for (const node of nodes) {
    node.styleClassName = parsed.classAssignments.get(node.name) ?? ''
    node.styleClass = { name: node.styleClassName, styles: resolveNodeInlineStyle(node.name, parsed) ?? {} }
  }

  const canvas = mkCanvas(0, 0)
  for (const [id, node] of parsed.nodes) {
    for (const field of ['icon', 'image', 'semanticShape'] as const) if (node[field] !== undefined) {
      canvas.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `node:${id}:${field}`, message: `Node ${id} retains its ${field} metadata in source; terminal output uses its label and a shape cue instead of graphical ${field} geometry.` })
    }
  }
  for (const node of nodes) for (const property of Object.keys(node.styleClass.styles)) {
    if (property === 'color' || property === 'stroke') continue
    canvas.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: `node:${node.name}:style:${property}`, message: `Node ${node.name} style ${property} projects to a terminal card with text and border ink; its graphical fill, typography and dimensions remain source data.` })
  }
  return {
    containerKind,
    nodes,
    edges,
    canvas,
    grid: new OccupancyMap(),
    columnWidth: new Map(),
    rowHeight: new Map(),
    subgraphs,
    config,
    offsetX: 0,
    offsetY: 0,
    bundles: [], // Populated by analyzeEdgeBundles() during layout
    trunkJunctions: [], // Populated by sibling trunk-sharing post-processing
  }
}

function collectSubgraphIds(subgraphs: MermaidSubgraph[]): Set<string> {
  const ids = new Set<string>()
  const visit = (sgs: MermaidSubgraph[]) => {
    for (const sg of sgs) {
      ids.add(sg.id)
      visit(sg.children)
    }
  }
  visit(subgraphs)
  return ids
}

function chooseSubgraphAnchor(
  parsed: MermaidGraph,
  sg: AsciiSubgraph,
  side: 'in' | 'out',
): AsciiNode | undefined {
  const ids = new Set(sg.nodes.map(n => n.name))
  if (ids.size === 0) return undefined

  const internalIn = new Set<string>()
  const internalOut = new Set<string>()
  for (const edge of parsed.edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) {
      internalOut.add(edge.source)
      internalIn.add(edge.target)
    }
  }

  const preferred = side === 'in'
    ? sg.nodes.filter(n => !internalIn.has(n.name))
    : sg.nodes.filter(n => !internalOut.has(n.name))
  return preferred[0] ?? sg.nodes[0]
}

/**
 * Recursively convert a MermaidSubgraph to AsciiSubgraph.
 * Flattens the tree into the subgraphs array while maintaining parent/child references.
 * This matches the Go implementation where all subgraphs are in a flat list
 * but linked via parent/children pointers.
 */
function convertSubgraph(
  mSg: MermaidSubgraph,
  parent: AsciiSubgraph | null,
  nodeMap: Map<string, AsciiNode>,
  allSubgraphs: AsciiSubgraph[],
): AsciiSubgraph {
  // Normalize subgraph direction: BT→TD, RL→LR (same as root graph normalization)
  let normalizedDirection: 'LR' | 'TD' | undefined
  if (mSg.direction) {
    normalizedDirection = (mSg.direction === 'LR' || mSg.direction === 'RL') ? 'LR' : 'TD'
  }

  const sg: AsciiSubgraph = {
    id: mSg.id,
    name: displayText(resolveLabelContent(mSg.label, mSg.labelContent)),
    nodes: [],
    parent,
    children: [],
    minX: 0, minY: 0, maxX: 0, maxY: 0,
    direction: normalizedDirection,
    ...(mSg.concurrencyRegion ? { concurrencyRegion: true as const } : {}),
  }

  // Resolve node references
  for (const nodeId of mSg.nodeIds) {
    const node = nodeMap.get(nodeId)
    if (node) sg.nodes.push(node)
  }

  allSubgraphs.push(sg)

  // Recurse into children
  for (const childMSg of mSg.children) {
    const child = convertSubgraph(childMSg, sg, nodeMap, allSubgraphs)
    sg.children.push(child)

    // Child nodes are also part of parent subgraphs (Go behavior).
    // The Go parser adds nodes to ALL subgraphs in the stack, so a nested
    // node belongs to both the inner and outer subgraph.
    for (const childNode of child.nodes) {
      if (!sg.nodes.includes(childNode)) {
        sg.nodes.push(childNode)
      }
    }
  }

  return sg
}

/**
 * Deduplicate subgraph node membership to match Go parser behavior.
 *
 * The Go parser only adds a node to the subgraph that was active when the node
 * was FIRST CREATED. If a node is later referenced inside a different subgraph,
 * it is NOT added to that subgraph. The TS parser is more permissive — it adds
 * referenced nodes to whichever subgraph they appear in.
 *
 * This function fixes the discrepancy by:
 * 1. Walking the edges to determine which nodes were first created inside each subgraph
 * 2. Removing nodes from subgraphs where they weren't first created
 */
function deduplicateSubgraphNodes(
  mermaidSubgraphs: MermaidSubgraph[],
  asciiSubgraphs: AsciiSubgraph[],
): void {
  // Build a map from MermaidSubgraph to its corresponding AsciiSubgraph.
  // The ordering matches since we convert them in the same order.
  const sgMap = new Map<MermaidSubgraph, AsciiSubgraph>()
  buildSgMap(mermaidSubgraphs, asciiSubgraphs, sgMap)

  // Determine which subgraph each node was "first defined" in.
  // A node is first defined in the subgraph where it first appears as a NEW node
  // in the ordered edge/node list. We approximate this by checking the global
  // node insertion order against subgraph membership.
  const nodeOwner = new Map<string, AsciiSubgraph>() // nodeId → owning subgraph

  // Walk all mermaid subgraphs in document order. For each subgraph,
  // claim nodes that haven't been claimed yet by any previous subgraph.
  function claimNodes(mSg: MermaidSubgraph): void {
    const asciiSg = sgMap.get(mSg)
    if (!asciiSg) return

    // Recurse into children first (they appear before parent in the Go parser stack,
    // but nodes defined in children are added to parent too — this is handled by
    // the convertSubgraph function which propagates child nodes to parents).
    // For dedup, we process children first so their claims propagate up correctly.
    for (const child of mSg.children) {
      claimNodes(child)
    }

    // Claim unclaimed nodes in this subgraph
    for (const nodeId of mSg.nodeIds) {
      if (!nodeOwner.has(nodeId)) {
        nodeOwner.set(nodeId, asciiSg)
      }
    }
  }

  for (const mSg of mermaidSubgraphs) {
    claimNodes(mSg)
  }

  // Now remove nodes from subgraphs that don't own them.
  // A node should remain in: its owner subgraph + all ancestors of the owner.
  for (const asciiSg of asciiSubgraphs) {
    asciiSg.nodes = asciiSg.nodes.filter(node => {
      const nodeId = node.name
      if (!nodeId) return false

      const owner = nodeOwner.get(nodeId)
      if (!owner) return true // not in any subgraph claim — keep as-is

      // Keep the node if this subgraph is the owner or an ancestor of the owner
      return isAncestorOrSelf(asciiSg, owner)
    })
  }
}

/** Check if `candidate` is the same as or an ancestor of `target`. */
function isAncestorOrSelf(candidate: AsciiSubgraph, target: AsciiSubgraph): boolean {
  let current: AsciiSubgraph | null = target
  while (current !== null) {
    if (current === candidate) return true
    current = current.parent
  }
  return false
}

/** Build a mapping from MermaidSubgraph → AsciiSubgraph (matching by position). */
function buildSgMap(
  mSgs: MermaidSubgraph[],
  aSgs: AsciiSubgraph[],
  result: Map<MermaidSubgraph, AsciiSubgraph>,
): void {
  // The asciiSubgraphs array is flat (all subgraphs including nested ones),
  // while mermaidSubgraphs is hierarchical. We need to flatten the mermaid tree
  // in the same order the converter processes them (pre-order DFS).
  const flatMermaid: MermaidSubgraph[] = []
  function flatten(sgs: MermaidSubgraph[]): void {
    for (const sg of sgs) {
      flatMermaid.push(sg)
      flatten(sg.children)
    }
  }
  flatten(mSgs)

  for (let i = 0; i < flatMermaid.length && i < aSgs.length; i++) {
    result.set(flatMermaid[i]!, aSgs[i]!)
  }
}
