import { toFinite, type ParsedDiagram, type RenderedLayout, type RenderedRegion, type RenderedRegionKind } from './types.ts'

export function buildRenderedRegions(d: ParsedDiagram, layout: RenderedLayout): RenderedRegion[] {
  const regions: RenderedRegion[] = [
    {
      id: 'canvas',
      kind: 'canvas',
      bounds: { x: toFinite(0), y: toFinite(0), w: layout.bounds.w, h: layout.bounds.h },
    },
  ]
  const groupByMember = new Map<string, string>()
  for (const group of layout.groups) for (const member of group.members) groupByMember.set(member, group.id)
  const sourceLines = sourceLineHints(d)
  for (const group of layout.groups) {
    regions.push({
      id: `group:${group.id}`,
      kind: group.regionKind ?? renderedGroupRegionKind(layout.kind),
      elementId: group.id,
      parentId: group.parentId ? `group:${group.parentId}` : 'canvas',
      bounds: { x: group.x, y: group.y, w: group.w, h: group.h },
      sourceLine: d.source.groups.get(group.id)?.line ?? sourceLines.groups.get(group.id),
    })
  }
  for (const node of layout.nodes) {
    regions.push({
      id: `node:${node.id}`,
      kind: 'node',
      elementId: node.id,
      parentId: node.parentId !== undefined ? `group:${node.parentId}` : groupByMember.has(node.id) ? `group:${groupByMember.get(node.id)!}` : 'canvas',
      bounds: { x: node.x, y: node.y, w: node.w, h: node.h },
      sourceLine: d.source.nodes.get(node.id)?.line ?? sourceLines.nodes.get(node.id),
    })
  }
  for (const edge of layout.edges) {
    const xs = edge.path.map(p => p[0])
    const ys = edge.path.map(p => p[1])
    if (xs.length > 0 && ys.length > 0) {
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys)
      regions.push({
        id: `edge:${edge.id}`,
        kind: 'edge',
        elementId: edge.id,
        parentId: 'canvas',
        bounds: { x: toFinite(minX), y: toFinite(minY), w: toFinite(Math.max(1, maxX - minX)), h: toFinite(Math.max(1, maxY - minY)) },
      })
    }
    if (edge.label) {
      const w = Math.max(1, edge.label.text.length * 7)
      const h = 14
      const labelX =
        d.kind === 'sequence' && edge.from === edge.to
          ? edge.label.x // sequence self-message labels render with text-anchor="start"
          : edge.label.x - w / 2
      regions.push({
        id: `label:${edge.id}`,
        kind: 'label',
        elementId: edge.id,
        parentId: `edge:${edge.id}`,
        bounds: { x: toFinite(labelX), y: toFinite(edge.label.y - h / 2), w: toFinite(w), h: toFinite(h) },
      })
    }
  }
  return regions
}

function renderedGroupRegionKind(kind: ParsedDiagram['kind']): RenderedRegionKind {
  switch (kind) {
    case 'flowchart':
    case 'state':
    case 'class':
    case 'er':
    case 'architecture':
      return 'cluster'
    case 'gitgraph':
      return 'lane'
    case 'timeline':
    case 'journey':
    case 'gantt':
      return 'band'
    case 'sequence':
    case 'quadrant':
      return 'compartment'
    case 'xychart':
      return 'plot'
    case 'radar':
      return 'ring'
    default:
      return 'group'
  }
}

function sourceLineHints(d: ParsedDiagram): { nodes: Map<string, number>; groups: Map<string, number> } {
  const nodes = new Map<string, number>()
  const groups = new Map<string, number>()
  const source = d.body.kind === 'opaque' || d.body.kind === 'extension' ? d.body.source : d.canonicalSource
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!
    const group = text.match(/^\s*subgraph\s+([A-Za-z0-9_:-]+)/)
    if (group?.[1] && !groups.has(group[1])) groups.set(group[1], i + 1)
    for (const node of text.matchAll(/(?:^|[\s&;])([A-Za-z][A-Za-z0-9_:-]*)(?=\s*(?:\[|\(|\{|--|==|-.|$))/g)) {
      const id = node[1]!
      if (id === 'subgraph' || id === 'end' || id === d.kind) continue
      if (!nodes.has(id)) nodes.set(id, i + 1)
    }
  }
  return { nodes, groups }
}
