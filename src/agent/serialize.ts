// ============================================================================
// serializeMermaid: ValidDiagram → canonical Mermaid source.
// synthesizeFromGraph: build a ValidDiagram from a JSON payload (no re-parse).
// ============================================================================

import type {
  ValidDiagram, ValidDiagramMeta, DiagramBody,
  ValidDiagramPayload, ParseError, Result,
} from './types.ts'
import { ok, err } from './types.ts'
import type { MermaidGraph, MermaidNode, MermaidEdge } from '../types.ts'
import YAML from 'yaml'
import { getFamily } from './families.ts'
import './families-builtin.ts'  // registers built-in family serialize hooks

// Re-export for callers that used the previous in-tree serializer home.
export { renderTimeline } from './timeline-body.ts'

export function serializeMermaid(d: ValidDiagram): string {
  return renderMeta(d.meta) + renderBody(d.body, d.kind)
}

export function renderMeta(meta: ValidDiagramMeta): string {
  const parts: string[] = []
  if (meta.frontmatter && Object.keys(meta.frontmatter).length > 0) {
    parts.push(`---\n${YAML.stringify(meta.frontmatter).trimEnd()}\n---\n`)
  }
  for (const d of meta.initDirectives) parts.push(d.raw.trimEnd() + '\n')
  return parts.join('')
}

function renderBody(body: DiagramBody, kind: ValidDiagram['kind']): string {
  // Flowchart/state share the legacy graph body and stay in-tree (BUILD-3
  // exception); opaque bodies re-emit preserved source verbatim. Every other
  // structured body serializes through its FamilyPlugin hook.
  if (body.kind === 'flowchart') return renderFlowchart(body.graph, kind)
  if (body.kind === 'opaque') return body.source.endsWith('\n') ? body.source : body.source + '\n'
  const plugin = getFamily(body.kind)
  if (plugin?.serialize) return plugin.serialize(body)
  throw new Error(`No serializer registered for body kind "${body.kind}"`)
}

// ---- Flowchart ------------------------------------------------------------

function renderFlowchart(graph: MermaidGraph, kind: ValidDiagram['kind']): string {
  const lines: string[] = [kind === 'state' ? 'stateDiagram-v2' : `flowchart ${graph.direction}`]
  const declaredInline = new Set<string>()

  // Subgraph blocks MUST come before edges: the legacy parser associates a
  // node with the subgraph in whose block it FIRST appears. If an edge at the
  // top declared the node first, a later bare reference inside the subgraph is
  // ignored and membership is lost on re-parse. Emitting members (with their
  // shape declaration) inside the block first makes round-trip stable.
  const membersDeclared = new Set<string>()
  const renderSubgraph = (sg: MermaidGraph['subgraphs'][number], indent: string) => {
    lines.push(`${indent}subgraph ${sg.id}${sg.label !== sg.id ? `[${sg.label}]` : ''}`)
    if (sg.direction) lines.push(`${indent}  direction ${sg.direction}`)
    for (const child of sg.children) renderSubgraph(child, indent + '  ')
    for (const nid of sg.nodeIds) {
      const node = graph.nodes.get(nid)
      if (node && needsExplicitDeclaration(node)) {
        lines.push(`${indent}  ${node.id}${renderShape(node)}`)
        declaredInline.add(nid)
      } else {
        lines.push(`${indent}  ${nid}`)
      }
      membersDeclared.add(nid)
    }
    lines.push(`${indent}end`)
  }
  for (const sg of graph.subgraphs) renderSubgraph(sg, '  ')

  for (const edge of graph.edges) lines.push('  ' + renderEdge(edge, graph.nodes, declaredInline))

  for (const [id, node] of graph.nodes) {
    if (declaredInline.has(id) || membersDeclared.has(id)) continue
    const orphan = graph.edges.every(e => e.source !== id && e.target !== id)
    if (orphan || needsExplicitDeclaration(node)) lines.push('  ' + `${node.id}${renderShape(node)}`)
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
        edges: sg.edges ?? [],
        // Defensive: the SDK-declared subgraph shape omits `children`/`direction`.
        // Normalize recursively so cloneSubgraph / findSubgraphById never hit
        // `undefined.map`. (A crash reachable straight from the documented SDK.)
        subgraphs: normalizeSubgraphs(sg.subgraphs),
        // Round-trip styling too, so `am parse | am serialize` is lossless.
        classDefs: toMap(sg.classDefs),
        classAssignments: toMap(sg.classAssignments),
        nodeStyles: toMap(sg.nodeStyles),
        linkStyles: toLinkStyleMap(sg.linkStyles),
      },
    }
  } else if (payload.body.kind === 'sequence' || payload.body.kind === 'timeline' || payload.body.kind === 'class' || payload.body.kind === 'er' || payload.body.kind === 'journey' || payload.body.kind === 'opaque') {
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

interface LooseSubgraph {
  id: string
  label?: string
  nodeIds?: string[]
  children?: LooseSubgraph[]
  direction?: import('../types.ts').Direction
}

function normalizeSubgraphs(input: unknown, seen: Set<unknown> = new Set()): import('../types.ts').MermaidSubgraph[] {
  if (!Array.isArray(input)) return []
  const out: import('../types.ts').MermaidSubgraph[] = []
  for (const sg of input as Array<LooseSubgraph | null | undefined>) {
    // Skip null/undefined elements rather than crashing.
    if (!sg || typeof sg !== 'object') continue
    // Cycle guard: a subgraph that points at itself (transitively) would
    // recurse forever. Drop the cyclic edge by returning [] for children
    // we've already visited on this branch.
    if (seen.has(sg)) continue
    seen.add(sg)
    out.push({
      id: String(sg.id ?? ''),
      label: sg.label ?? String(sg.id ?? ''),
      nodeIds: Array.isArray(sg.nodeIds) ? sg.nodeIds.map(String) : [],
      children: normalizeSubgraphs(sg.children, seen),
      direction: sg.direction,
    })
    seen.delete(sg)
  }
  return out
}

function toMap<V>(input: unknown): Map<string, V> {
  if (input instanceof Map) {
    // Coerce keys to string so callers can look up by string consistently.
    const out = new Map<string, V>()
    for (const [k, v] of input as Map<unknown, V>) out.set(String(k), v)
    return out
  }
  if (Array.isArray(input)) {
    // Only accept well-formed [k, v] tuples; ignore the rest rather than
    // throwing 'Iterator value X is not an entry object'.
    const out = new Map<string, V>()
    for (const entry of input as unknown[]) {
      if (Array.isArray(entry) && entry.length >= 2) {
        out.set(String((entry as unknown[])[0]), (entry as unknown[])[1] as V)
      }
    }
    return out
  }
  if (input && typeof input === 'object') {
    return new Map(Object.entries(input as Record<string, V>))
  }
  return new Map()
}

function toLinkStyleMap(input: unknown): Map<number | 'default', Record<string, string>> {
  const raw = toMap<Record<string, string>>(input)
  const out = new Map<number | 'default', Record<string, string>>()
  for (const [k, v] of raw) {
    if (k === 'default') { out.set('default', v); continue }
    // Only accept non-negative integer keys; silently drop anything else
    // rather than producing NaN- or float-keyed entries that downstream
    // index lookups can never find.
    const n = Number(k)
    if (Number.isInteger(n) && n >= 0) out.set(n, v)
  }
  return out
}
