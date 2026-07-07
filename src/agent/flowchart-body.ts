// ============================================================================
// Flowchart/state structured body: parse / serialize / mutate / source-map
// (FamilyPlugin hooks — BUILD-3 stage 2, removing the in-tree exception).
//
// Flowchart and state are two DiagramKinds sharing one body kind
// ('flowchart', holding the legacy renderer's MermaidGraph). Both register
// a plugin built by `flowchartFamilyHooks(headerKind)`, which binds the
// serialized header (`flowchart <dir>` vs `stateDiagram-v2`).
//
// Contract differences from the narrow structured families, kept on purpose:
//   - parse ERRORS on bad syntax instead of falling back to opaque. The
//     legacy parser is broad and has no lossless bail-out mode; silent
//     opaque fallback would convert crisp parse errors on the flagship
//     family into render-time failures.
//   - parse consumes the full canonical source (the legacy parser needs the
//     header) and contributes a SourceMap via the buildSourceMap hook.
// ============================================================================

import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type { MermaidGraph, MermaidNode, MermaidEdge, MermaidSubgraph } from '../types.ts'
import type {
  DiagramBody, FlowchartMutationOp, MutationError, ParseError, Result, SourceMap,
} from './types.ts'
import { ok, err } from './types.ts'

export type FlowchartBody = Extract<DiagramBody, { kind: 'flowchart' }>

// ---- Parser -----------------------------------------------------------------

export function parseFlowchartBody(canonicalSource: string): Result<FlowchartBody, ParseError[]> {
  try {
    const graph = parseFlowchartLegacy(canonicalSource)
    return ok({ kind: 'flowchart', graph })
  } catch (e) {
    return err([{ code: 'PARSE_FAILED', message: e instanceof Error ? e.message : String(e) }])
  }
}

// ---- SourceMap --------------------------------------------------------------

export function buildFlowchartSourceMap(body: FlowchartBody, canonicalSource: string): SourceMap {
  const map: SourceMap = { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
  const lines = canonicalSource.split(/\r?\n/)

  for (const id of Array.from(body.graph.nodes.keys())) {
    const re = new RegExp(`\\b${escapeRegex(id)}\\b`)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const idx = line.search(re)
      if (idx >= 0) {
        map.nodes.set(id, { line: i + 1, col: idx + 1 })
        const node = body.graph.nodes.get(id)
        const labelCol = node ? labelColumn(line, node.label, idx + id.length) : -1
        if (labelCol >= 0) map.labels.set(`node:${id}`, { line: i + 1, col: labelCol + 1 })
        break
      }
    }
  }

  for (const sg of body.graph.subgraphs) mapSubgraphSource(sg, lines, map)

  body.graph.edges.forEach((edge, index) => {
    const indexedKey = edgeSourceMapKey(index, edge)
    const pairKey = `${edge.source}->${edge.target}`
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (!lineMentionsEdge(line, edge.source, edge.target)) continue
      const col = Math.max(0, line.search(new RegExp(`\\b${escapeRegex(edge.source)}\\b`)))
      const loc = { line: i + 1, col: col + 1 }
      map.edges.set(indexedKey, loc)
      if (!map.edges.has(pairKey)) map.edges.set(pairKey, loc)
      if (edge.label) {
        const labelCol = labelColumn(line, edge.label, edgeOperatorSearchStart(line, col, edge.source))
        if (labelCol >= 0) map.labels.set(indexedKey, { line: i + 1, col: labelCol + 1 })
      }
      break
    }
  })

  return map
}

function edgeSourceMapKey(index: number, edge: MermaidEdge): string { return `edge#${index}:${edge.source}->${edge.target}` }

function lineMentionsEdge(line: string, source: string, target: string): boolean {
  if (!/(?:[-.=~]+|<[-.=]+|[-.=]+[>ox]|[ox][-.=])/.test(line)) return false
  const sourceIdx = line.search(new RegExp(`\\b${escapeRegex(source)}\\b`))
  const targetIdx = source === target ? sourceIdx : line.search(new RegExp(`\\b${escapeRegex(target)}\\b`))
  // Source maps follow the canonical source direction for ordinary Mermaid
  // chains. This rejects the common false positive where the previous forward
  // line `A --> B` also mentions a later feedback edge's endpoint pair `B,A`.
  return sourceIdx >= 0 && targetIdx >= 0 && (source === target || sourceIdx <= targetIdx)
}

function edgeOperatorSearchStart(line: string, sourceCol: number, source: string): number {
  const afterSource = sourceCol + source.length
  const operatorOffset = line.slice(afterSource).search(/[-.=~]/)
  return operatorOffset >= 0 ? afterSource + operatorOffset : afterSource
}

function labelColumn(line: string, label: string, afterCol: number): number {
  if (!label || label.trim().length === 0) return -1
  const direct = line.indexOf(label, Math.max(0, afterCol))
  if (direct >= 0) return direct
  const escaped = label.replace(/<br\s*\/?\s*>/gi, '\\n')
  if (escaped !== label) return line.indexOf(escaped, Math.max(0, afterCol))
  return -1
}

function mapSubgraphSource(sg: MermaidSubgraph, lines: string[], map: SourceMap): void {
  const re = new RegExp(`^\\s*subgraph\\s+${escapeRegex(sg.id)}(?:\\b|\\[|$)`, 'i')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!re.test(line)) continue
    const col = line.indexOf(sg.id)
    map.groups.set(sg.id, { line: i + 1, col: col + 1 })
    const labelCol = sg.label && sg.label !== sg.id ? labelColumn(line, sg.label, col + sg.id.length) : -1
    if (labelCol >= 0) map.labels.set(`group:${sg.id}`, { line: i + 1, col: labelCol + 1 })
    break
  }
  for (const child of sg.children) mapSubgraphSource(child, lines, map)
}

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// ---- Serializer -------------------------------------------------------------

export function renderFlowchart(graph: MermaidGraph, headerKind: 'flowchart' | 'state'): string {
  const lines: string[] = [headerKind === 'state' ? 'stateDiagram-v2' : `flowchart ${graph.direction}`]
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
    case 'lean-r': return `[/${lbl}/]`
    case 'lean-l': return `[\\${lbl}\\]`
    case 'service': return `[${lbl}]`
    case 'state-start':
    case 'state-end': return ''
  }
}

function escapeLabel(label: string): string {
  const normalized = label.replace(/\r?\n/g, '<br>')
  if (/[\[\]{}()|]/.test(normalized)) return `"${normalized.replace(/["\\]/g, '\\$&')}"`
  return normalized
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
  // Extra shaft units for a lengthened link (Mermaid rank distance). `length`
  // is undefined ≡ 1 for base operators, so they serialize byte-identically.
  const extra = Math.max(0, (edge.length ?? 1) - 1)
  switch (edge.style) {
    case 'invisible': return '~'.repeat(3 + extra)
    case 'solid': return `${start}${'-'.repeat((!edge.hasArrowStart && !edge.hasArrowEnd ? 3 : 2) + extra)}${end}`
    case 'dotted': return `${start}-${'.'.repeat(1 + extra)}-${end}`
    case 'thick': return `${start}${'='.repeat((!edge.hasArrowStart && !edge.hasArrowEnd ? 3 : 2) + extra)}${end}`
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

// ---- Mutator ----------------------------------------------------------------

export function mutateFlowchart(body: FlowchartBody, op: FlowchartMutationOp): Result<FlowchartBody, MutationError> {
  const graph = cloneGraph(body.graph)
  const done = (): Result<FlowchartBody, MutationError> => ok({ kind: 'flowchart', graph })
  switch (op.kind) {
    case 'add_node': {
      if (graph.nodes.has(op.id)) return err({ code: 'DUPLICATE_NODE', message: `Node "${op.id}" already exists` })
      graph.nodes.set(op.id, { id: op.id, label: op.label, shape: op.shape ?? 'rectangle' })
      if (op.parent) {
        const parent = findSubgraph(graph, op.parent)
        if (!parent) return err({ code: 'INVALID_OP', message: `Parent group "${op.parent}" not found` })
        parent.nodeIds.push(op.id)
      }
      return done()
    }
    case 'remove_node': {
      if (!graph.nodes.has(op.id)) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.id}" not found` })
      graph.nodes.delete(op.id)
      graph.edges = graph.edges.filter(e => e.source !== op.id && e.target !== op.id)
      for (const sg of graph.subgraphs) removeFromSubgraph(sg, op.id)
      graph.classAssignments.delete(op.id)
      graph.nodeStyles.delete(op.id)
      return done()
    }
    case 'rename_node': {
      if (!graph.nodes.has(op.from)) return err({ code: 'NODE_NOT_FOUND', message: `Node "${op.from}" not found` })
      if (graph.nodes.has(op.to)) return err({ code: 'DUPLICATE_NODE', message: `Cannot rename to "${op.to}" — already exists` })
      const node = graph.nodes.get(op.from)!
      graph.nodes.delete(op.from)
      graph.nodes.set(op.to, { ...node, id: op.to, label: node.label === op.from ? op.to : node.label })
      for (const e of graph.edges) {
        if (e.source === op.from) e.source = op.to
        if (e.target === op.from) e.target = op.to
      }
      for (const sg of graph.subgraphs) renameInSubgraph(sg, op.from, op.to)
      if (graph.classAssignments.has(op.from)) {
        graph.classAssignments.set(op.to, graph.classAssignments.get(op.from)!); graph.classAssignments.delete(op.from)
      }
      if (graph.nodeStyles.has(op.from)) {
        graph.nodeStyles.set(op.to, graph.nodeStyles.get(op.from)!); graph.nodeStyles.delete(op.from)
      }
      return done()
    }
    case 'set_label': {
      if (graph.nodes.has(op.target)) {
        const n = graph.nodes.get(op.target)!
        graph.nodes.set(op.target, { ...n, label: op.label })
        return done()
      }
      const idx = findEdgeIndexById(graph, op.target)
      if (idx >= 0) { graph.edges[idx]!.label = op.label; return done() }
      return err({ code: 'NODE_NOT_FOUND', message: `Target "${op.target}" matches no node or edge` })
    }
    case 'add_edge': {
      ensureNode(graph, op.from); ensureNode(graph, op.to)
      graph.edges.push({ source: op.from, target: op.to, label: op.label, style: op.style ?? 'solid', hasArrowStart: false, hasArrowEnd: true })
      return done()
    }
    case 'remove_edge': {
      const idx = findEdgeIndexById(graph, op.id)
      if (idx < 0) return err({ code: 'EDGE_NOT_FOUND', message: `Edge "${op.id}" not found` })
      graph.edges.splice(idx, 1)
      return done()
    }
    default: {
      const _x: never = op
      return err({ code: 'INVALID_OP', message: unknownOpMessage('flowchart', _x) })
    }
  }
}

// ---- Graph helpers ----------------------------------------------------------

export function edgeIdOf(edge: MermaidEdge, idx = 0): string {
  return idx === 0 ? `${edge.source}->${edge.target}` : `${edge.source}->${edge.target}#${idx}`
}

function findEdgeIndexById(graph: MermaidGraph, id: string): number {
  const [endpoints, suffix] = id.split('#')
  const [from, to] = (endpoints ?? '').split('->')
  if (!from || !to) return -1
  const occ = suffix ? parseInt(suffix, 10) : 0
  let seen = 0
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i]!
    if (e.source === from && e.target === to) { if (seen === occ) return i; seen++ }
  }
  return -1
}

function ensureNode(graph: MermaidGraph, id: string): void {
  if (!graph.nodes.has(id)) graph.nodes.set(id, { id, label: id, shape: 'rectangle' })
}

function findSubgraph(graph: MermaidGraph, id: string): MermaidSubgraph | null {
  const search = (list: MermaidSubgraph[]): MermaidSubgraph | null => {
    for (const sg of list) { if (sg.id === id) return sg; const c = search(sg.children); if (c) return c }
    return null
  }
  return search(graph.subgraphs)
}
function removeFromSubgraph(sg: MermaidSubgraph, id: string): void {
  sg.nodeIds = sg.nodeIds.filter(n => n !== id)
  for (const c of sg.children) removeFromSubgraph(c, id)
}
function renameInSubgraph(sg: MermaidSubgraph, from: string, to: string): void {
  sg.nodeIds = sg.nodeIds.map(n => (n === from ? to : n))
  for (const c of sg.children) renameInSubgraph(c, from, to)
}

function cloneGraph(graph: MermaidGraph): MermaidGraph {
  return {
    direction: graph.direction,
    nodes: new Map(Array.from(graph.nodes, ([k, v]) => [k, { ...v }])),
    edges: graph.edges.map(e => ({ ...e })),
    subgraphs: graph.subgraphs.map(cloneSubgraph),
    classDefs: new Map(Array.from(graph.classDefs, ([k, v]) => [k, { ...v }])),
    classAssignments: new Map(graph.classAssignments),
    nodeStyles: new Map(Array.from(graph.nodeStyles, ([k, v]) => [k, { ...v }])),
    linkStyles: new Map(Array.from(graph.linkStyles, ([k, v]) => [k, { ...v }])),
  }
}
function cloneSubgraph(sg: MermaidGraph['subgraphs'][number]): MermaidGraph['subgraphs'][number] {
  return { id: sg.id, label: sg.label, nodeIds: [...sg.nodeIds], children: sg.children.map(cloneSubgraph), direction: sg.direction }
}
