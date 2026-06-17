// ============================================================================
// Shared converter: ELK PositionedGraph → public RenderedLayout JSON.
// Previously implemented in two places (verify.ts and index.ts's layoutMermaid)
// — see DIVERGENCES "Cleanup findings". Single source of truth.
// ============================================================================

import type { PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup } from '../types.ts'
import type {
  DiagramKind, Finite, RenderedLayout, RenderedLayoutNode, RenderedLayoutEdge, RenderedLayoutGroup,
} from './types.ts'
import { toFinite } from './types.ts'

function f(n: number): Finite { return toFinite(Math.round(n)) }

function node(n: PositionedNode): RenderedLayoutNode {
  return { id: n.id, x: f(n.x), y: f(n.y), w: f(n.width), h: f(n.height), shape: n.shape, label: n.label }
}

function edge(e: PositionedEdge, debug: boolean): RenderedLayoutEdge {
  return {
    id: `${e.source}->${e.target}`,
    from: e.source, to: e.target,
    path: e.points.map(p => [f(p.x), f(p.y)] as [Finite, Finite]),
    label: e.label && e.labelPosition
      ? { x: f(e.labelPosition.x), y: f(e.labelPosition.y), text: e.label }
      : undefined,
    ...(debug && e.routeCertificate ? { route: e.routeCertificate } : {}),
  }
}

export function positionedToRenderedLayout(p: PositionedGraph, kind: DiagramKind, opts: { debug?: boolean } = {}): RenderedLayout {
  return {
    version: 1, kind,
    nodes: p.nodes.map(node),
    edges: p.edges.map(e => edge(e, opts.debug === true)),
    groups: renderedGroups(p.groups, p.nodes),
    bounds: { w: f(p.width), h: f(p.height) },
  }
}

function renderedGroups(groups: PositionedGroup[], nodes: PositionedNode[]): RenderedLayoutGroup[] {
  const out: RenderedLayoutGroup[] = []
  const containsNode = (g: PositionedGroup, n: PositionedNode): boolean =>
    n.x >= g.x - 0.5 && n.y >= g.y - 0.5 && n.x + n.width <= g.x + g.width + 0.5 && n.y + n.height <= g.y + g.height + 0.5
  const visit = (g: PositionedGroup, parentId?: string): void => {
    const members = nodes
      .filter(n => containsNode(g, n) && !g.children.some(child => containsNode(child, n)))
      .map(n => n.id)
    out.push({
      id: g.id,
      x: f(g.x), y: f(g.y), w: f(g.width), h: f(g.height),
      members, label: g.label,
      ...(parentId ? { parentId } : {}),
    })
    for (const child of g.children) visit(child, g.id)
  }
  for (const g of groups) visit(g)
  return out
}

export function emptyRenderedLayout(kind: DiagramKind): RenderedLayout {
  return { version: 1, kind, nodes: [], edges: [], groups: [], bounds: { w: f(0), h: f(0) } }
}
