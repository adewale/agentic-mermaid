// ============================================================================
// serializeMermaid: ValidDiagram → canonical Mermaid source.
//
// v3: serializes structured sequence bodies as well as flowchart bodies.
// Adds synthesizeFromGraph to build a ValidDiagram from a JSON payload
// without re-parsing source — makes `am parse | am serialize` work cleanly.
// ============================================================================

import type {
  ValidDiagram,
  ValidDiagramMeta,
  DiagramBody,
  SequenceBody,
  SequenceMessage,
  SequenceMessageStyle,
  ValidDiagramPayload,
  ParseError,
  Result,
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
    const yaml = YAML.stringify(meta.frontmatter).trimEnd()
    parts.push(`---\n${yaml}\n---\n`)
  }
  for (const directive of meta.initDirectives) {
    parts.push(directive.raw.trimEnd() + '\n')
  }
  return parts.join('')
}

function renderBody(body: DiagramBody, kind: ValidDiagram['kind']): string {
  if (body.kind === 'flowchart') return renderFlowchart(body.graph, kind)
  if (body.kind === 'sequence') return renderSequence(body)
  return body.source.endsWith('\n') ? body.source : body.source + '\n'
}

// ---- Sequence serializer ------------------------------------------------

function renderSequence(body: SequenceBody): string {
  const lines: string[] = ['sequenceDiagram']
  // Only emit explicit participant declarations when they carry information
  // beyond the implicit-from-message-endpoint form (i.e., label != id, or
  // actor kind). Plain id-only participants are emitted implicitly by their
  // first message reference.
  for (const p of body.participants) {
    if (p.label !== p.id || p.kind === 'actor') {
      const tag = p.kind === 'actor' ? 'actor' : 'participant'
      const labelPart = p.label !== p.id ? ` as ${p.label}` : ''
      lines.push(`  ${tag} ${p.id}${labelPart}`)
    }
  }
  for (const m of body.messages) {
    lines.push(`  ${m.from} ${arrowForStyle(m.style)} ${m.to}: ${m.text}`)
  }
  return lines.join('\n') + '\n'
}

function arrowForStyle(s: SequenceMessageStyle): string {
  switch (s) {
    case 'sync':         return '->>'
    case 'reply':        return '-->>'
    case 'async':        return '->'
    case 'async-dashed': return '-->'
    case 'lost':         return '-x'
    case 'lost-dashed':  return '--x'
  }
}

// ---- Flowchart serializer (unchanged from v2) ---------------------------

function renderFlowchart(graph: MermaidGraph, kind: ValidDiagram['kind']): string {
  const lines: string[] = []
  lines.push(kind === 'state' ? 'stateDiagram-v2' : `flowchart ${graph.direction}`)

  const declaredInline = new Set<string>()

  for (const edge of graph.edges) {
    lines.push('  ' + renderEdge(edge, graph.nodes, declaredInline))
  }

  for (const [id, node] of graph.nodes) {
    if (declaredInline.has(id)) continue
    const orphan = graph.edges.every(e => e.source !== id && e.target !== id)
    if (orphan || needsExplicitDeclaration(node)) {
      lines.push('  ' + renderNodeDeclaration(node))
    }
  }

  for (const sg of graph.subgraphs) {
    lines.push(`  subgraph ${sg.id}${sg.label !== sg.id ? `[${sg.label}]` : ''}`)
    if (sg.direction) lines.push(`    direction ${sg.direction}`)
    for (const nid of sg.nodeIds) lines.push(`    ${nid}`)
    lines.push('  end')
  }

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
  return node.label !== node.id || node.shape !== 'rectangle'
}

function renderNodeDeclaration(node: MermaidNode): string {
  return `${node.id}${renderShape(node)}`
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
  const start = edge.hasArrowStart ? markerChar(edge.startMarker ?? 'arrow', true) : ''
  const end = edge.hasArrowEnd ? markerChar(edge.endMarker ?? 'arrow', false) : ''
  switch (edge.style) {
    case 'solid': {
      const body = !edge.hasArrowStart && !edge.hasArrowEnd ? '---' : '--'
      return `${start}${body}${end}`
    }
    case 'dotted':
      return `${start}-.-${end}`
    case 'thick': {
      const body = !edge.hasArrowStart && !edge.hasArrowEnd ? '===' : '=='
      return `${start}${body}${end}`
    }
  }
}

function markerChar(marker: 'arrow' | 'circle' | 'cross', isStart: boolean): string {
  if (marker === 'arrow') return isStart ? '<' : '>'
  if (marker === 'circle') return 'o'
  return 'x'
}

function stringifyStyleProps(props: Record<string, string>): string {
  return Object.entries(props).map(([k, v]) => `${k}:${v}`).join(',')
}

// ---- synthesizeFromGraph -------------------------------------------------

/**
 * Build a ValidDiagram from a JSON-safe payload. Used by the CLI's
 * `am parse | am serialize` pipeline so consumers don't need canonicalSource
 * to survive a round-trip through JSON. The canonicalSource on the resulting
 * ValidDiagram is the freshly-serialized form.
 */
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
    const nodesMap = sg.nodes instanceof Array
      ? new Map(sg.nodes)
      : new Map(Object.entries(sg.nodes))
    const graph: MermaidGraph = {
      direction: sg.direction,
      nodes: nodesMap,
      edges: sg.edges,
      subgraphs: sg.subgraphs ?? [],
      classDefs: new Map(),
      classAssignments: new Map(),
      nodeStyles: new Map(),
      linkStyles: new Map(),
    }
    body = { kind: 'flowchart', graph }
  } else if (payload.body.kind === 'sequence') {
    body = payload.body
  } else if (payload.body.kind === 'opaque') {
    body = payload.body
  } else {
    return err([{ code: 'INVALID_PAYLOAD', message: `unknown body kind` }])
  }

  const draft: ValidDiagram = {
    kind: payload.kind,
    meta,
    body,
    source: { nodes: new Map(), edges: new Map(), groups: new Map() },
    canonicalSource: '',
  }
  // Compute canonicalSource by serializing — keeps it consistent.
  const canonicalSource = serializeMermaid(draft)
  return ok({ ...draft, canonicalSource })
}
