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
import { mkCanvas, mkRoleCanvas } from './canvas.ts'

/**
 * Convert a parsed MermaidGraph into an AsciiGraph ready for grid layout.
 *
 * Key mappings:
 * - MermaidGraph.nodes (Map) → ordered AsciiNode[] preserving insertion order
 * - MermaidGraph.edges → AsciiEdge[] with resolved node references
 * - MermaidGraph.subgraphs → AsciiSubgraph[] with parent/child tree
 * - Node labels are used as display names (not raw IDs)
 */
export function convertToAsciiGraph(parsed: MermaidGraph, config: AsciiConfig): AsciiGraph {
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
      // The label is used for rendering inside the box.
      displayLabel: mNode.label,
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

  // Deduplicate subgraph node membership to match Go parser behavior.
  // In Go, a node belongs only to the subgraph where it was FIRST DEFINED.
  // The TS parser adds referenced nodes to all subgraphs they appear in,
  // which causes incorrect bounding boxes when nodes span subgraph boundaries.
  deduplicateSubgraphNodes(parsed.subgraphs, subgraphs, nodeMap, parsed)

  const subgraphById = new Map(subgraphs.map(sg => [sg.id, sg] as const))

  // Build edges with resolved node references. Edges that target a subgraph id
  // route through a stable inner anchor for placement/pathfinding, then draw to
  // the container border instead of rendering a duplicate phantom node.
  const edges: AsciiEdge[] = []
  for (const mEdge of parsed.edges) {
    const fromSubgraph = nodeMap.has(mEdge.source) ? undefined : subgraphById.get(mEdge.source)
    const toSubgraph = nodeMap.has(mEdge.target) ? undefined : subgraphById.get(mEdge.target)
    const from = nodeMap.get(mEdge.source) ?? (fromSubgraph ? chooseSubgraphAnchor(parsed, fromSubgraph, 'out') : undefined)
    const to = nodeMap.get(mEdge.target) ?? (toSubgraph ? chooseSubgraphAnchor(parsed, toSubgraph, 'in') : undefined)
    if (!from || !to) continue

    edges.push({
      from,
      to,
      fromSubgraph,
      toSubgraph,
      text: mEdge.label ?? '',
      path: [],
      labelLine: [],
      startDir: { x: 0, y: 0 },
      endDir: { x: 0, y: 0 },
      style: mEdge.style,
      hasArrowStart: mEdge.hasArrowStart,
      hasArrowEnd: mEdge.hasArrowEnd,
      startMarker: mEdge.startMarker,
      endMarker: mEdge.endMarker,
    })
  }

  const nodes = [...nodeMap.values()]

  // BUILD-14: resolve edges whose endpoint is a subgraph id (a "phantom" node).
  // The parser auto-creates a node for every edge endpoint, so an edge like
  // `Start --> Pipeline` (where Pipeline is a subgraph) yields a node named
  // "Pipeline" in addition to the container. The ELK/SVG path filters this and
  // attaches the edge to the container via hierarchical ports; the ASCII path
  // historically drew a phantom box. Here we drop the phantom node, retarget the
  // edge onto a representative member of the container for routing, and flag the
  // edge so it is visually clipped to the container border.
  const phantomNodeNames = resolveSubgraphEdges(parsed, edges, subgraphs)

  // Apply class definitions
  for (const [nodeId, className] of parsed.classAssignments) {
    const node = nodeMap.get(nodeId)
    const classDef = parsed.classDefs.get(className)
    if (node && classDef) {
      node.styleClassName = className
      node.styleClass = { name: className, styles: classDef }
    }
  }

  // Drop phantom subgraph-id nodes so they are not placed as standalone boxes.
  // Reindex afterwards: grid layout addresses nodes by their array index
  // (graph.nodes[node.index]), so indices must stay contiguous after filtering.
  let renderedNodes = nodes
  if (phantomNodeNames.size > 0) {
    renderedNodes = nodes.filter(n => !phantomNodeNames.has(n.name))
    renderedNodes.forEach((n, i) => { n.index = i })
  }

  return {
    nodes: renderedNodes,
    edges,
    canvas: mkCanvas(0, 0),
    roleCanvas: mkRoleCanvas(0, 0),
    grid: new Map(),
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
    name: mSg.label,
    nodes: [],
    parent,
    children: [],
    minX: 0, minY: 0, maxX: 0, maxY: 0,
    direction: normalizedDirection,
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
  nodeMap: Map<string, AsciiNode>,
  parsed: MermaidGraph,
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
      // Find this node's ID in the nodeMap
      let nodeId: string | undefined
      for (const [id, n] of nodeMap) {
        if (n === node) { nodeId = id; break }
      }
      if (!nodeId) return false

      const owner = nodeOwner.get(nodeId)
      if (!owner) return true // not in any subgraph claim — keep as-is

      // Keep the node if this subgraph is the owner or an ancestor of the owner
      return isAncestorOrSelf(asciiSg, owner)
    })
  }
}

/**
 * BUILD-14: Resolve edges whose endpoint id is a subgraph id.
 *
 * The TS parser auto-creates a leaf node for every edge endpoint, so an edge
 * to/from a subgraph id (e.g. `Start --> Pipeline` where `Pipeline` is a
 * subgraph) produces a redundant "phantom" node sharing the subgraph's id.
 * The SVG/ELK path filters these and attaches such edges to the container via
 * hierarchical ports; the ASCII path used to render the phantom as a real box.
 *
 * This function detects phantom nodes (a node whose id matches a subgraph id and
 * which is not itself a member of any subgraph) and, for each edge touching one:
 *   1. retargets the edge onto a representative member of the container so the
 *      grid layout routes it toward the container, and
 *   2. records the container on the edge (attachFromSubgraph / attachToSubgraph)
 *      so the renderer clips the visible edge to the container border.
 *
 * Returns the set of phantom node ids that should be removed from the node list.
 * Edge semantics are preserved: the visible terminal is the container border,
 * not an arbitrary inner node.
 */
function resolveSubgraphEdges(
  parsed: MermaidGraph,
  edges: AsciiEdge[],
  asciiSubgraphs: AsciiSubgraph[],
): Set<string> {
  const phantoms = new Set<string>()
  if (asciiSubgraphs.length === 0) return phantoms

  // Map subgraph id → AsciiSubgraph.
  const sgById = new Map<string, AsciiSubgraph>()
  for (const sg of asciiSubgraphs) sgById.set(sg.id, sg)
  if (sgById.size === 0) return phantoms

  // A node id is a member of some subgraph if it appears in any subgraph's
  // nodeIds in the parser graph (these are genuine inner nodes, never phantoms).
  const memberIds = new Set<string>()
  const collectMembers = (sg: MermaidSubgraph): void => {
    for (const id of sg.nodeIds) memberIds.add(id)
    for (const child of sg.children) collectMembers(child)
  }
  for (const sg of parsed.subgraphs) collectMembers(sg)

  // A phantom is a node whose id matches a subgraph id, is NOT a genuine member
  // node, and was auto-created (its label equals its id — no explicit label).
  // The label guard pins the id-collision edge case: if the author explicitly
  // gave the id a distinct label, treat it as a real node, not a container ref.
  const isPhantom = (id: string): boolean => {
    if (!sgById.has(id) || memberIds.has(id)) return false
    const mNode = parsed.nodes.get(id)
    return !mNode || mNode.label === id
  }

  for (const edge of edges) {
    const fromSg = isPhantom(edge.from.name) ? sgById.get(edge.from.name) : undefined
    const toSg = isPhantom(edge.to.name) ? sgById.get(edge.to.name) : undefined

    if (toSg) {
      const anchor = pickContainerAnchor(toSg, parsed, 'entry')
      if (anchor && anchor !== edge.from) {
        phantoms.add(edge.to.name)
        edge.to = anchor
        edge.attachToSubgraph = toSg
      }
    }
    if (fromSg) {
      const anchor = pickContainerAnchor(fromSg, parsed, 'exit')
      if (anchor && anchor !== edge.to) {
        phantoms.add(edge.from.name)
        edge.from = anchor
        edge.attachFromSubgraph = fromSg
      }
    }
  }

  // Only remove phantom nodes that are no longer referenced by any edge as a
  // real endpoint (every touching edge was successfully retargeted).
  for (const id of [...phantoms]) {
    const stillUsed = edges.some(e => e.from.name === id || e.to.name === id)
    if (stillUsed) phantoms.delete(id)
  }

  return phantoms
}

/**
 * Choose a representative member node of a container to anchor a container edge.
 * For an incoming edge we prefer an "entry" node (no incoming edge from another
 * member); for an outgoing edge an "exit" node (no outgoing edge to another
 * member). Falls back to the first member. Returns null if the container has no
 * placeable members (e.g. an empty subgraph).
 */
function pickContainerAnchor(
  sg: AsciiSubgraph,
  parsed: MermaidGraph,
  role: 'entry' | 'exit',
): AsciiNode | null {
  const members = collectContainerMembers(sg)
  if (members.length === 0) return null
  const memberSet = new Set(members.map(n => n.name))

  for (const node of members) {
    let isBoundary = true
    for (const edge of parsed.edges) {
      if (role === 'entry' && edge.target === node.name && memberSet.has(edge.source)) {
        isBoundary = false
        break
      }
      if (role === 'exit' && edge.source === node.name && memberSet.has(edge.target)) {
        isBoundary = false
        break
      }
    }
    if (isBoundary) return node
  }
  return members[0]!
}

/** Collect all member nodes of a container, including nested children. */
function collectContainerMembers(sg: AsciiSubgraph): AsciiNode[] {
  const out: AsciiNode[] = [...sg.nodes]
  for (const child of sg.children) {
    for (const n of collectContainerMembers(child)) {
      if (!out.includes(n)) out.push(n)
    }
  }
  return out
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
