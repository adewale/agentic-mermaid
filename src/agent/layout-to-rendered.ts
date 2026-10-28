// ============================================================================
// Shared converter: ELK PositionedGraph → public RenderedLayout JSON.
// Previously implemented in two places (verify.ts and index.ts's layoutMermaid)
// — see DIVERGENCES "Cleanup findings". Single source of truth.
// ============================================================================

import type { PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup } from '../types.ts'
import type {
  FamilyId, Finite, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup, RenderedLabelBounds,
} from './types.ts'
import { toFinite } from './types.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import { calculatePathMidpoint } from '../layout/geometry.ts'
import { edgeEndpointSelectors, edgeSelectorIndices } from '../shared/edge-selectors.ts'

export function retainedLabelBounds(block: PixelTextBlock | undefined, x: number, y: number, anchor: 'start' | 'middle' | 'end' = 'middle'): RenderedLabelBounds | undefined {
  if (!block) return undefined
  return {
    x: toFinite(x - (anchor === 'start' ? 0 : anchor === 'end' ? block.width : block.width / 2)),
    y: toFinite(y - block.height / 2), w: toFinite(block.width), h: toFinite(block.height),
  }
}

export function retainedLabelGeometry(block: PixelTextBlock | undefined, x: number, y: number, container: { x: number; y: number; width: number; height: number }, anchor: 'start' | 'middle' | 'end' = 'middle'): Pick<RenderedLayoutNode, 'labelBounds' | 'labelContainer'> {
  const labelBounds = retainedLabelBounds(block, x, y, anchor)
  return labelBounds ? { labelBounds, labelContainer: { x: toFinite(container.x), y: toFinite(container.y), w: toFinite(container.width), h: toFinite(container.height) } } : {}
}

function node(n: PositionedNode): RenderedLayoutNode {
  // Nodes, routes, and retained text share positioned precision so public and
  // internal quality predicates use the same physical evidence.
  return { id: n.id, x: toFinite(n.x), y: toFinite(n.y), w: toFinite(n.width), h: toFinite(n.height), shape: n.shape, label: n.label,
    ...retainedLabelGeometry(n.labelBlock, n.x + n.width / 2, n.y + n.height / 2, n) }
}

function edge(e: PositionedEdge, id: string, debug: boolean): RenderedLayoutEdge {
  const labelPosition = e.label ? e.labelPosition ?? calculatePathMidpoint(e.points) : undefined
  return {
    id,
    from: e.source, to: e.target,
    // Crossing quality uses physical tolerances; rounding can turn a proper
    // near-endpoint crossing into endpoint contact in the public projection.
    path: e.points.map(p => [toFinite(p.x), toFinite(p.y)] as [Finite, Finite]),
    ...(e.style === 'invisible' ? { visibility: 'hidden' as const } : {}),
    label: e.label && labelPosition
      ? { x: toFinite(labelPosition.x), y: toFinite(labelPosition.y), text: e.label, bounds: retainedLabelBounds(e.labelBlock, labelPosition.x, labelPosition.y) }
      : undefined,
    ...(debug && e.routeCertificate ? { route: e.routeCertificate } : {}),
  }
}

export function positionedToRenderedLayout(p: PositionedGraph, kind: FamilyId, opts: { debug?: boolean } = {}): RenderedLayout {
  const view = positionedGraphToRenderedView(p, opts)
  return {
    version: view.version,
    kind,
    nodes: view.nodes,
    edges: view.edges,
    groups: view.groups,
    bounds: view.bounds,
  }
}

/** Pure family-neutral view used by descriptor `projectPositioned` hooks.
 * All geometry retains finite subpixel coordinates;
 * consumers should round only for display, after measuring quality. */
export function positionedGraphToRenderedView(
  p: PositionedGraph,
  opts: { debug?: boolean } = {},
): Omit<RenderedLayout, 'kind' | 'regions' | 'actions'> {
  // ELK extracts root edges before nested edges. Occurrence selectors belong
  // to source order, even when the positioned collection has another order.
  const sourceEdges = p.edges.map((value, index) => ({ value, index }))
    .sort((a, b) => (a.value.edgeIndex ?? a.index) - (b.value.edgeIndex ?? b.index))
    .map(entry => entry.value)
  const selectors = edgeEndpointSelectors(sourceEdges)
  const selectorIndices = edgeSelectorIndices(sourceEdges)
  const reserved = new Set(p.nodes.map(value => value.id))
  const groups = [...p.groups]
  for (const group of groups) { reserved.add(group.id); groups.push(...group.children) }
  const identities = new Map(sourceEdges.map((value, index) => {
    const authored = value.id
    const selector = selectors[index]!
    const alias = selector.replace(/#0$/, '')
    return [value, authored && !reserved.has(authored) && selectorIndices.get(authored) === index
      ? authored : selectorIndices.get(alias) === index ? alias : selector]
  }))
  return {
    version: 1,
    nodes: p.nodes.map(node),
    edges: p.edges.map(e => edge(e, identities.get(e)!, opts.debug === true)),
    groups: renderedGroups(p.groups, p.nodes),
    bounds: { w: toFinite(p.width), h: toFinite(p.height) },
  }
}

function renderedGroups(groups: PositionedGroup[], nodes: PositionedNode[]): RenderedLayoutGroup[] {
  const out: RenderedLayoutGroup[] = []
  const containsNode = (g: PositionedGroup, n: PositionedNode): boolean =>
    n.x >= g.x - 0.5 && n.y >= g.y - 0.5 && n.x + n.width <= g.x + g.width + 0.5 && n.y + n.height <= g.y + g.height + 0.5
  const visit = (g: PositionedGroup, parentId?: string): void => {
    const authoredMembers = g.nodeIds ? new Set(g.nodeIds) : undefined
    const members = nodes
      .filter(n => authoredMembers ? authoredMembers.has(n.id) : containsNode(g, n) && !g.children.some(child => containsNode(child, n)))
      .map(n => n.id)
    out.push({
      id: g.id,
      x: toFinite(g.x), y: toFinite(g.y), w: toFinite(g.width), h: toFinite(g.height),
      members, label: g.label,
      ...(parentId ? { parentId } : {}),
    })
    for (const child of g.children) visit(child, g.id)
  }
  for (const g of groups) visit(g)
  return out
}

export function emptyRenderedLayout(kind: FamilyId): RenderedLayout {
  return { version: 1, kind, nodes: [], edges: [], groups: [], bounds: { w: toFinite(0), h: toFinite(0) } }
}
