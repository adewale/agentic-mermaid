// ============================================================================
// serializeMermaid: ValidDiagram → canonical Mermaid source.
// synthesizeFromGraph: build a ValidDiagram from a JSON payload (no re-parse).
// ============================================================================

import type {
  ValidDiagram, ValidDiagramMeta, DiagramBody, SequenceBody,
  SequenceMessageStyle, ValidDiagramPayload, ParseError, Result,
} from './types.ts'
import { ok, err } from './types.ts'
import type { MermaidGraph, MermaidNode, MermaidEdge } from '../types.ts'
import YAML from 'yaml'

export function serializeMermaid(d: ValidDiagram): string {
  return renderMeta(d.meta) + renderBody(d.body, d.kind)
}

function renderMeta(meta: ValidDiagramMeta): string {
  const parts: string[] = []
  if (meta.frontmatter && Object.keys(meta.frontmatter).length > 0) {
    parts.push(`---\n${YAML.stringify(meta.frontmatter).trimEnd()}\n---\n`)
  }
  for (const d of meta.initDirectives) parts.push(d.raw.trimEnd() + '\n')
  return parts.join('')
}

function renderBody(body: DiagramBody, kind: ValidDiagram['kind']): string {
  if (body.kind === 'flowchart') return renderFlowchart(body.graph, kind)
  if (body.kind === 'sequence') return renderSequence(body)
  return body.source.endsWith('\n') ? body.source : body.source + '\n'
}

// ---- Sequence -------------------------------------------------------------

function renderSequence(body: SequenceBody): string {
  const lines: string[] = ['sequenceDiagram']
  for (const p of body.participants) {
    if (p.label !== p.id || p.kind === 'actor') {
      const tag = p.kind === 'actor' ? 'actor' : 'participant'
      lines.push(`  ${tag} ${p.id}${p.label !== p.id ? ` as ${p.label}` : ''}`)
    }
  }
  for (const m of body.messages) {
    lines.push(`  ${m.from}${arrowForStyle(m.style)}${m.to}: ${m.text}`)
  }
  return lines.join('\n') + '\n'
}

function arrowForStyle(s: SequenceMessageStyle): string {
  switch (s) {
    case 'sync': return '->>'
    case 'reply': return '-->>'
    case 'async': return '->'
    case 'async-dashed': return '-->'
    case 'lost': return '-x'
    case 'lost-dashed': return '--x'
  }
}

// ---- Flowchart ------------------------------------------------------------

function renderFlowchart(graph: MermaidGraph, kind: ValidDiagram['kind']): string {
  const lines: string[] = [kind === 'state' ? 'stateDiagram-v2' : `flowchart ${graph.direction}`]
  const declaredInline = new Set<string>()

  for (const edge of graph.edges) lines.push('  ' + renderEdge(edge, graph.nodes, declaredInline))

  for (const [id, node] of graph.nodes) {
    if (declaredInline.has(id)) continue
    const orphan = graph.edges.every(e => e.source !== id && e.target !== id)
    if (orphan || needsExplicitDeclaration(node)) lines.push('  ' + `${node.id}${renderShape(node)}`)
  }

  for (const sg of graph.subgraphs) {
    lines.push(`  subgraph ${sg.id}${sg.label !== sg.id ? `[${sg.label}]` : ''}`)
    if (sg.direction) lines.push(`    direction ${sg.direction}`)
    for (const nid of sg.nodeIds) lines.push(`    ${nid}`)
    lines.push('  end')
  }

  for (const [name, props] of graph.classDefs) lines.push(`  classDef ${name} ${styleProps(props)}`)
  for (const [id, cls] of graph.classAssignments) lines.push(`  class ${id} ${cls}`)
  for (const [id, style] of graph.nodeStyles) lines.push(`  style ${id} ${styleProps(style)}`)
  for (const [idx, style] of graph.linkStyles) lines.push(`  linkStyle ${idx} ${styleProps(style)}`)

  return lines.join('\n') + '\n'
}

function needsExplicitDeclaration(node: MermaidNode): boolean {
  return node.label !== node.id || node.shape !== 'rectangle'
}

function renderShape(node: MermaidNode): string {
  const lbl = escapeLabel(node.label)
  switch (node.shape) {
    case 'rectangle': return `[${lbl}]`
    case 'rounded': return `(${lbl})`
    case 'stadium': return `([${lbl}])`
    case 'subroutine': return `[[${lbl}]]`
    case 'cylinder': return `[(${lbl})]`
    case 'circle': return `((${lbl}))`
    case 'doublecircle': return `(((${lbl})))`
    case 'asymmetric': return `>${lbl}]`
    case 'diamond': return `{${lbl}}`
    case 'hexagon': return `{{${lbl}}}`
    case 'trapezoid': return `[/${lbl}\\]`
    case 'trapezoid-alt': return `[\\${lbl}/]`
    case 'service': return `[${lbl}]`
    case 'state-start':
    case 'state-end': return ''
  }
}

function escapeLabel(label: string): string {
  if (/[\[\]{}()<>|]/.test(label)) return `"${label.replace(/"/g, '\\"')}"`
  return label
}

function renderEdge(edge: MermaidEdge, nodes: Map<string, MermaidNode>, declaredInline: Set<string>): string {
  const src = inlineNodeRef(edge.source, nodes, declaredInline)
  const dst = inlineNodeRef(edge.target, nodes, declaredInline)
  const labelPart = edge.label ? `|${escapeLabel(edge.label)}|` : ''
  return `${src} ${renderEdgeArrow(edge)}${labelPart} ${dst}`
}

function inlineNodeRef(id: string, nodes: Map<string, MermaidNode>, declaredInline: Set<string>): string {
  const n = nodes.get(id)
  if (!n) return id
  if (needsExplicitDeclaration(n) && !declaredInline.has(id)) {
    declaredInline.add(id)
    return `${id}${renderShape(n)}`
  }
  return id
}

function renderEdgeArrow(edge: MermaidEdge): string {
  const start = edge.hasArrowStart ? markerChar(edge.startMarker ?? 'arrow', true) : ''
  const end = edge.hasArrowEnd ? markerChar(edge.endMarker ?? 'arrow', false) : ''
  switch (edge.style) {
    case 'solid': return `${start}${!edge.hasArrowStart && !edge.hasArrowEnd ? '---' : '--'}${end}`
    case 'dotted': return `${start}-.-${end}`
    case 'thick': return `${start}${!edge.hasArrowStart && !edge.hasArrowEnd ? '===' : '=='}${end}`
  }
}

function markerChar(marker: 'arrow' | 'circle' | 'cross', isStart: boolean): string {
  if (marker === 'arrow') return isStart ? '<' : '>'
  if (marker === 'circle') return 'o'
  return 'x'
}

function styleProps(props: Record<string, string>): string {
  return Object.entries(props).map(([k, v]) => `${k}:${v}`).join(',')
}

// ---- synthesizeFromGraph --------------------------------------------------

export function synthesizeFromGraph(payload: ValidDiagramPayload): Result<ValidDiagram, ParseError[]> {
  const meta: ValidDiagramMeta = {
    initDirectives: payload.meta?.initDirectives ?? [],
    comments: payload.meta?.comments ?? [],
    accessibility: payload.meta?.accessibility ?? {},
    frontmatter: payload.meta?.frontmatter,
  }

  let body: DiagramBody
  if (payload.body.kind === 'flowchart') {
    const sg = payload.body.graph
    const nodesMap = Array.isArray(sg.nodes) ? new Map(sg.nodes) : new Map(Object.entries(sg.nodes))
    body = {
      kind: 'flowchart',
      graph: {
        direction: sg.direction,
        nodes: nodesMap,
        edges: sg.edges,
        subgraphs: sg.subgraphs ?? [],
        classDefs: new Map(),
        classAssignments: new Map(),
        nodeStyles: new Map(),
        linkStyles: new Map(),
      },
    }
  } else if (payload.body.kind === 'sequence' || payload.body.kind === 'opaque') {
    body = payload.body
  } else {
    return err([{ code: 'INVALID_PAYLOAD', message: 'unknown body kind' }])
  }

  const draft: ValidDiagram = {
    kind: payload.kind, meta, body,
    source: { nodes: new Map(), edges: new Map(), groups: new Map() },
    canonicalSource: '',
  }
  return ok({ ...draft, canonicalSource: serializeMermaid(draft) })
}
