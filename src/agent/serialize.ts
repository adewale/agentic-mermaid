// ============================================================================
// serializeMermaid: ValidDiagram → canonical Mermaid source
//
// Round-trip contracts:
//   serializeMermaid(parseMermaid(s)) ≡ normalize(s) for canonical s
//   parseMermaid(serializeMermaid(d)) ≡ d for every reachable d
//
// For flowchart: emits a fresh canonical form from the parsed graph.
// For opaque families: emits the preserved canonical source verbatim,
// re-attaching frontmatter/init/accessibility metadata.
// ============================================================================

import type {
  ValidDiagram,
  ValidDiagramMeta,
  DiagramBody,
} from './types.ts'
import type { MermaidGraph, MermaidNode, MermaidEdge, EdgeStyle, NodeShape } from '../types.ts'
import YAML from 'yaml'

export function serializeMermaid(d: ValidDiagram): string {
  const metaPrefix = renderMeta(d.meta)
  const body = renderBody(d.body, d.kind)
  return metaPrefix + body
}

function renderMeta(meta: ValidDiagramMeta): string {
  const parts: string[] = []

  if (meta.frontmatter && Object.keys(meta.frontmatter).length > 0) {
    const yaml = YAML.stringify(meta.frontmatter).trimEnd()
    parts.push(`---\n${yaml}\n---\n`)
  }

  for (const directive of meta.initDirectives) {
    parts.push(directive.raw.trimEnd() + '\n')
  }

  // Accessibility directives are emitted after the header in the body
  // section, not in the meta prefix, since Mermaid expects them inside
  // the diagram body. We pass them through the body emitter via meta.
  return parts.join('')
}

function renderBody(body: DiagramBody, kind: ValidDiagram['kind']): string {
  if (body.kind === 'flowchart') {
    return renderFlowchart(body.graph, kind)
  }
  // Opaque: preserved verbatim.
  return body.source.endsWith('\n') ? body.source : body.source + '\n'
}

// ---- Flowchart serializer ------------------------------------------------

function renderFlowchart(graph: MermaidGraph, kind: ValidDiagram['kind']): string {
  const lines: string[] = []
  const header =
    kind === 'state' ? 'stateDiagram-v2' : `flowchart ${graph.direction}`
  lines.push(header)

  // Two-pass strategy to avoid emitting shape declarations twice:
  // (1) Inline a node's shape on its first edge reference.
  // (2) Nodes that don't appear in any edge get their own declaration line.
  const declaredInline = new Set<string>()

  for (const edge of graph.edges) {
    lines.push('  ' + renderEdge(edge, graph.nodes, declaredInline))
  }

  // Orphan node declarations (nodes not referenced by any edge).
  for (const [id, node] of graph.nodes) {
    if (declaredInline.has(id)) continue
    if (needsExplicitDeclaration(node) || graph.edges.every(e => e.source !== id && e.target !== id)) {
      lines.push('  ' + renderNodeDeclaration(node))
    }
  }

  // Subgraphs (groups)
  for (const sg of graph.subgraphs) {
    lines.push(`  subgraph ${sg.id}${sg.label !== sg.id ? `[${sg.label}]` : ''}`)
    if (sg.direction) lines.push(`    direction ${sg.direction}`)
    for (const nid of sg.nodeIds) {
      lines.push(`    ${nid}`)
    }
    lines.push('  end')
  }

  // classDefs / class assignments / styles / linkStyles
  for (const [name, props] of graph.classDefs) {
    lines.push(`  classDef ${name} ${stringifyStyleProps(props)}`)
  }
  for (const [id, cls] of graph.classAssignments) {
    lines.push(`  class ${id} ${cls}`)
  }
  for (const [id, style] of graph.nodeStyles) {
    lines.push(`  style ${id} ${stringifyStyleProps(style)}`)
  }
  for (const [idx, style] of graph.linkStyles) {
    lines.push(`  linkStyle ${idx} ${stringifyStyleProps(style)}`)
  }

  return lines.join('\n') + '\n'
}

function needsExplicitDeclaration(node: MermaidNode): boolean {
  // If the label differs from the id, or the shape isn't rectangle, we need
  // an explicit declaration. (Edges below can also implicitly declare nodes,
  // so we emit only when something must be said.)
  return node.label !== node.id || node.shape !== 'rectangle'
}

function renderNodeDeclaration(node: MermaidNode): string {
  return `${node.id}${renderShape(node)}`
}

function renderShape(node: MermaidNode): string {
  const lbl = escapeLabel(node.label)
  switch (node.shape) {
    case 'rectangle':
      return `[${lbl}]`
    case 'rounded':
      return `(${lbl})`
    case 'stadium':
      return `([${lbl}])`
    case 'subroutine':
      return `[[${lbl}]]`
    case 'cylinder':
      return `[(${lbl})]`
    case 'circle':
      return `((${lbl}))`
    case 'doublecircle':
      return `(((${lbl})))`
    case 'asymmetric':
      return `>${lbl}]`
    case 'diamond':
      return `{${lbl}}`
    case 'hexagon':
      return `{{${lbl}}}`
    case 'trapezoid':
      return `[/${lbl}\\]`
    case 'trapezoid-alt':
      return `[\\${lbl}/]`
    case 'service':
      return `[${lbl}]`
    case 'state-start':
    case 'state-end':
      return ''
  }
}

function escapeLabel(label: string): string {
  // Quote if the label contains shape-significant characters.
  if (/[\[\]{}()<>|]/.test(label)) return `"${label.replace(/"/g, '\\"')}"`
  return label
}

function renderEdge(
  edge: MermaidEdge,
  nodes: Map<string, MermaidNode>,
  declaredInline: Set<string>,
): string {
  const src = inlineNodeRef(edge.source, nodes, declaredInline)
  const dst = inlineNodeRef(edge.target, nodes, declaredInline)
  const arrow = renderEdgeArrow(edge)
  const labelPart = edge.label ? `|${escapeLabel(edge.label)}|` : ''
  return `${src} ${arrow}${labelPart} ${dst}`
}

function inlineNodeRef(
  id: string,
  nodes: Map<string, MermaidNode>,
  declaredInline: Set<string>,
): string {
  const n = nodes.get(id)
  if (!n) return id
  if (needsExplicitDeclaration(n) && !declaredInline.has(id)) {
    declaredInline.add(id)
    return `${id}${renderShape(n)}`
  }
  return id
}

function renderEdgeArrow(edge: MermaidEdge): string {
  // Compose: <startMarker><body><endMarker>
  // - solid:  base body is "--" with no-arrow form padded to "---"
  // - dotted: base body is "-.-" (no padding needed)
  // - thick:  base body is "==" with no-arrow form padded to "==="
  const startMarker = edge.hasArrowStart
    ? markerChar(edge.startMarker ?? 'arrow', /* isStart */ true)
    : ''
  const endMarker = edge.hasArrowEnd
    ? markerChar(edge.endMarker ?? 'arrow', /* isStart */ false)
    : ''

  switch (edge.style) {
    case 'solid': {
      // "---" no arrows, "-->" arrow end, "o--o" double circles, etc.
      const body =
        !edge.hasArrowStart && !edge.hasArrowEnd ? '---' : '--'
      return `${startMarker}${body}${endMarker}`
    }
    case 'dotted': {
      // "-.-" no arrows, "-.->" arrow end, "o-.-o" double circles.
      return `${startMarker}-.-${endMarker}`
    }
    case 'thick': {
      // "===" no arrows, "==>" arrow end, "o==o" double circles.
      const body =
        !edge.hasArrowStart && !edge.hasArrowEnd ? '===' : '=='
      return `${startMarker}${body}${endMarker}`
    }
  }
}

function markerChar(marker: 'arrow' | 'circle' | 'cross', isStart: boolean): string {
  if (marker === 'arrow') return isStart ? '<' : '>'
  if (marker === 'circle') return 'o'
  return 'x'
}

function stringifyStyleProps(props: Record<string, string>): string {
  return Object.entries(props)
    .map(([k, v]) => `${k}:${v}`)
    .join(',')
}
