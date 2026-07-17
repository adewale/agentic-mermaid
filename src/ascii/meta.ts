// ============================================================================
// renderMermaidASCIIWithMeta — render ASCII art and return per-region metadata.
//
// Loop 9 M11. The intended use case is TUI integration: callers (e.g. a TUI
// debugger) need to know which characters in the rendered grid correspond to
// which node id so they can highlight, click-target, or scroll-anchor a
// region.
//
// Implementation choice: rather than instrument every renderer to capture
// per-character roles (which would touch grid.ts, canvas.ts, draw.ts, and
// every family-specific renderer), this module derives regions by scanning
// the rendered string for known node labels. This is honest about what it
// can prove:
//   - Flowchart / state: regions for each node by label match. Flowchart
//     subgraphs are exposed as best-effort label regions using the same stable
//     ids as SVG/layout JSON; edge spans remain deferred until renderer
//     instrumentation lands.
//   - Sequence / class / ER / timeline / gantt / journey / xychart /
//     architecture: regions for each participant / class / entity / section /
//     task, derived by label scan. Best-effort; some renderers wrap labels
//     and the scan misses them.
//
// Determinism: identical input → identical regions (no randomness, no
// timestamps). Region order follows the scan order (top-down, left-to-right).
// ============================================================================

import { renderMermaidASCII, type AsciiRenderOptions } from './index.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { collectActionRecords } from '../agent/analyze.ts'
import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { convertToAsciiGraph } from './converter.ts'
import { createMapping } from './grid.ts'
import { visualWidth } from './width.ts'
import type { TerminalProjectionDiagnostic, TerminalProjectionDiagnosticCode } from '../terminal-style.ts'
import type { DiagramActionRecord, ParsedDiagram, RenderedRegionKind } from '../agent/types.ts'
import type { AsciiConfig } from './types.ts'
import { stateBodyToGraph } from '../agent/state-body.ts'
import type { ClassBody, ClassRelationKind } from '../agent/types.ts'
import { prepareRenderInput } from '../agent/render-input.ts'
import { ParsedDiagramFamilyMismatchError } from '../render-contract.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { plainTextFromInlineFormatting } from '../shared/inline-format.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { sanitizeTerminalText } from '../terminal-security.ts'
import { decodeXML } from 'entities'
import type { MermaidGraph } from '../types.ts'

export type RegionKind = Exclude<RenderedRegionKind, 'canvas' | 'group'> | 'group' | 'subgraph'

export type AsciiWarningCode = 'ASCII_RENDER_FAILED' | 'ASCII_EDGE_REGION_UNMAPPED' | TerminalProjectionDiagnosticCode
export interface AsciiWarning { code: AsciiWarningCode; message: string; severity: 'degraded' }

export const ASCII_ROUTE_PARITY_CONTRACT = {
  version: 1,
  routeIntent: 'shared-route-classes',
  svgSource: 'route-contract classifyRoutes() + certificates',
  asciiSource: 'grid router seeded with classifyRoutes() routeClass metadata, longest-path layering, and direct-lane-first routing',
  degradationWarnings: ['ASCII_RENDER_FAILED', 'ASCII_EDGE_REGION_UNMAPPED'],
} as const

export interface AsciiRegion {
  kind: RegionKind
  /** Stable identifier for the diagram element (e.g. node id, participant id). */
  id: string
  /** Optional 1-based source line where the element was declared, when known. */
  sourceLine?: number
  /** 0-based row in the rendered canvas where the region starts. */
  canvasRow: number
  /** 0-based column where the region starts (inclusive). */
  canvasColStart: number
  /** 0-based column where the region ends (exclusive). */
  canvasColEnd: number
  /** Optional row count when the region spans multiple lines (boxed node). */
  rowSpan?: number
  /** Normalized text this best-effort label region was matched from. */
  projectedText?: string
}

export interface AsciiWithMeta {
  ascii: string
  regions: AsciiRegion[]
  /** Inert action records keyed to the same stable target ids as `regions`. */
  actions: DiagramActionRecord[]
  warnings: AsciiWarning[]
  routeParity: typeof ASCII_ROUTE_PARITY_CONTRACT
}

export function renderMermaidASCIIWithMeta(input: ParsedDiagram | string, opts: AsciiRenderOptions = {}): AsciiWithMeta {
  const source = prepareRenderInput(input).source
  // Mirror parseMermaid's structured-or-opaque rule: if the renderer rejects
  // the source (parse failure), surface empty regions rather than throwing —
  // the meta API is read-only and shouldn't propagate parser errors.
  try {
    const projection: TerminalProjectionDiagnostic[] = []
    const ascii = renderMermaidASCII(input, {
      ...opts,
      onProjectionDiagnostic: diagnostic => {
        projection.push(diagnostic)
        opts.onProjectionDiagnostic?.(diagnostic)
      },
    })
    const regions = addSemanticContainerRegions(ascii, source, deriveRegions(ascii, source))
    const projectionWarnings: AsciiWarning[] = projection.map(diagnostic => ({
      code: diagnostic.code,
      severity: 'degraded',
      message: diagnostic.message,
    }))
    return { ascii, regions, actions: actionRecords(source), warnings: [...deriveWarnings(source, regions), ...projectionWarnings], routeParity: ASCII_ROUTE_PARITY_CONTRACT }
  } catch (error) {
    if (error instanceof ParsedDiagramFamilyMismatchError) throw error
    return { ascii: '', regions: [], actions: [], warnings: [{ code: 'ASCII_RENDER_FAILED', severity: 'degraded', message: 'ASCII/Unicode renderer failed; no route parity evidence is available.' }], routeParity: ASCII_ROUTE_PARITY_CONTRACT }
  }
}

function actionRecords(source: string): DiagramActionRecord[] {
  const parsed = parseMermaid(source)
  return parsed.ok ? collectActionRecords(parsed.value).map(sanitizeTerminalAction) : []
}

function sanitizeTerminalAction(action: DiagramActionRecord): DiagramActionRecord {
  const safe = (value: string | undefined): string | undefined => value === undefined ? undefined : sanitizeTerminalText(value)
  return {
    ...action,
    id: safe(action.id),
    regionId: safe(action.regionId),
    target: safe(action.target)!,
    raw: safe(action.raw)!,
    href: safe(action.href),
    message: safe(action.message),
  }
}

function deriveWarnings(source: string, regions: AsciiRegion[]): AsciiWarning[] {
  const parsed = parseMermaid(source)
  if (!parsed.ok) return []
  if (parsed.value.body.kind !== 'flowchart' && parsed.value.body.kind !== 'state') return []
  const edgeRegions = regions.filter(r => r.kind === 'edge').length
  const edgeCount = parsed.value.body.kind === 'flowchart' ? parsed.value.body.graph.edges.length : parsed.value.body.transitions.length
  if (edgeCount > 0 && edgeRegions === 0) {
    return [{
      code: 'ASCII_EDGE_REGION_UNMAPPED',
      severity: 'degraded',
      message: 'ASCII route drawing follows the explicit route-intent parity mapping, but per-edge cell spans are not instrumented yet.',
    }]
  }
  return []
}

interface Candidate { id: string; label: string; sourceLine?: number; kind?: RegionKind }

function addCandidate(out: Candidate[], id: string, label: string | undefined, sourceLine?: number, kind: RegionKind = 'node'): void {
  const normalized = label?.trim()
  if (!normalized) return
  out.push({ id, label: normalized, sourceLine, kind })
}

function addCandidateWithFallback(out: Candidate[], id: string, label: string | undefined, sourceLine?: number, kind: RegionKind = 'node'): void {
  addCandidate(out, id, label, sourceLine, kind)
  if (label !== id) addCandidate(out, id, id, sourceLine, kind)
}

function deriveRegions(ascii: string, source: string): AsciiRegion[] {
  const candidates = candidatesForDiagram(source)
  if (candidates.length === 0) return []
  const lines = ascii.split('\n')
  // Sort longest label first so 'Alpha' wins over 'A' on the same row.
  const sorted = [...candidates].sort((a, b) => visualWidth(b.label) - visualWidth(a.label))
  // Track regions already assigned so a label scan doesn't double-match.
  const used = new Set<string>()
  const occupied = new Map<number, Array<readonly [number, number]>>()
  const out: AsciiRegion[] = []
  for (const c of sorted) {
    const candidateKey = `${c.kind ?? 'node'}\u0000${c.id}`
    if (used.has(candidateKey)) continue
    const match = matchProjectedLabel(lines, c.label, occupied)
    if (!match) continue
    out.push({
      kind: c.kind ?? 'node',
      id: c.id,
      sourceLine: c.sourceLine,
      canvasRow: match.row,
      canvasColStart: match.colStart,
      canvasColEnd: match.colEnd,
      ...(match.rowSpan > 1 ? { rowSpan: match.rowSpan } : {}),
      projectedText: projectedLabelText(c.label),
    })
    used.add(candidateKey)
  }
  // Stable order: by canvasRow then canvasColStart.
  out.sort((a, b) => a.canvasRow - b.canvasRow || a.canvasColStart - b.canvasColStart)
  return out
}

interface ProjectedLabelMatch { row: number; colStart: number; colEnd: number; rowSpan: number }
interface TextOccurrence {
  row: number
  /** UTF-16 offsets used only to continue searching the source string. */
  start: number
  end: number
  /** Terminal display-cell coordinates used for every spatial decision. */
  colStart: number
  colEnd: number
}

function overlapsOccupied(occupied: Map<number, Array<readonly [number, number]>>, occurrence: TextOccurrence): boolean {
  return (occupied.get(occurrence.row) ?? []).some(([start, end]) => occurrence.colStart < end && occurrence.colEnd > start)
}

function occurrencesOf(lines: string[], text: string, occupied: Map<number, Array<readonly [number, number]>>): TextOccurrence[] {
  const out: TextOccurrence[] = []
  if (!text) return out
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!
    for (let start = line.indexOf(text); start >= 0; start = line.indexOf(text, start + Math.max(1, text.length))) {
      const end = start + text.length
      const occurrence = {
        row,
        start,
        end,
        colStart: visualWidth(line.slice(0, start)),
        colEnd: visualWidth(line.slice(0, end)),
      }
      if (!overlapsOccupied(occupied, occurrence)) out.push(occurrence)
    }
  }
  return out
}

function projectedLabelText(label: string): string {
  return sanitizeTerminalText(decodeXML(plainTextFromInlineFormatting(normalizeBrTags(label))), true)
    .replace(/^[`]|[`]$/g, '')
    .trim()
}

function claimOccurrences(
  occurrences: TextOccurrence[],
  occupied: Map<number, Array<readonly [number, number]>>,
): ProjectedLabelMatch {
  for (const occurrence of occurrences) {
    const spans = occupied.get(occurrence.row) ?? []
    spans.push([occurrence.colStart, occurrence.colEnd])
    occupied.set(occurrence.row, spans)
  }
  const firstRow = Math.min(...occurrences.map(occurrence => occurrence.row))
  const lastRow = Math.max(...occurrences.map(occurrence => occurrence.row))
  return {
    row: firstRow,
    colStart: Math.min(...occurrences.map(occurrence => occurrence.colStart)),
    colEnd: Math.max(...occurrences.map(occurrence => occurrence.colEnd)),
    rowSpan: lastRow - firstRow + 1,
  }
}

/** Match the exact label first, then its terminal projection. Width-bounded
 * rendering inserts line breaks after parsing, while markdown/entity/<br>
 * normalization changes the visible spelling; the ordered-token fallback
 * maps those projected lines without falling back to an unrelated node id. */
function matchProjectedLabel(
  lines: string[],
  label: string,
  occupied: Map<number, Array<readonly [number, number]>>,
): ProjectedLabelMatch | undefined {
  const projected = projectedLabelText(label)
  for (const text of new Set([label, projected])) {
    const occurrence = occurrencesOf(lines, text, occupied)[0]
    if (occurrence) return claimOccurrences([occurrence], occupied)
  }

  const tokens = projected.split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return undefined
  for (const first of occurrencesOf(lines, tokens[0]!, occupied)) {
    const matches = [first]
    let previous = first
    let rowStart = first.start
    let rowEnd = first.end
    let complete = true
    for (const token of tokens.slice(1)) {
      // A projected label is one contiguous text cluster: tokens either remain
      // on the same row with only ordinary inter-word spacing, or continue on
      // the immediately following row with overlapping display columns. Without
      // this bound, a trailing token can be stolen from a neighbouring node.
      const next = occurrencesOf(lines, token, occupied).find(candidate =>
        (candidate.row === previous.row
          && candidate.colStart >= previous.colEnd
          && candidate.colStart - previous.colEnd <= 3)
        || (candidate.row === previous.row + 1
          && candidate.colStart < rowEnd
          && candidate.colEnd > rowStart))
      if (!next) {
        complete = false
        break
      }
      matches.push(next)
      if (next.row === previous.row) {
        rowStart = Math.min(rowStart, next.colStart)
        rowEnd = Math.max(rowEnd, next.colEnd)
      } else {
        rowStart = next.colStart
        rowEnd = next.colEnd
      }
      previous = next
    }
    if (complete) return claimOccurrences(matches, occupied)
  }
  return undefined
}

interface SemanticContainer {
  id: string
  kind: Extract<RegionKind, 'cluster' | 'compartment' | 'plot' | 'ring' | 'band'>
  members: string[]
  geometry?: { kind: 'quadrant'; index: number } | { kind: 'ring'; index: number; count: number }
}

function semanticContainers(source: string): SemanticContainer[] {
  const parsed = parseMermaid(source)
  if (!parsed.ok) return []
  const body = parsed.value.body
  if (body.kind === 'state') {
    const out: SemanticContainer[] = []
    const visit = (states: typeof body.states): string[] => states.flatMap(state => {
      let members: string[] = []
      if (state.regions) {
        state.regions.forEach((region, index) => {
          const regionMembers = visit(region.states)
          out.push({ id: `${state.id}__r${index + 1}`, kind: 'cluster', members: regionMembers })
          members.push(...regionMembers)
        })
      } else if (state.states) {
        members = visit(state.states)
      }
      if (state.states || state.regions) out.push({ id: state.id, kind: 'cluster', members })
      return [state.id, ...members]
    })
    visit(body.states)
    return out
  }
  if (body.kind === 'sequence') {
    let index = 0
    return (body.statements ?? []).flatMap(statement => statement.kind === 'fragment'
      ? [{ id: `block#${index++}:${statement.fragment.fragmentKind}`, kind: 'compartment' as const, members: [] }]
      : [])
  }
  if (body.kind === 'class') {
    return (body.namespaces ?? []).map(namespace => ({
      id: namespace.name,
      kind: 'cluster' as const,
      members: body.classes.filter(cls => cls.namespace === namespace.name).map(cls => cls.id),
    }))
  }
  if (body.kind === 'er') return (body.groups ?? []).map(group => ({
    id: group.id,
    kind: 'cluster' as const,
    members: [
      ...body.entities.filter(entity => entity.groupId === group.id).map(entity => entity.id),
      ...(body.groups ?? []).filter(child => child.parentId === group.id).map(child => child.id),
    ],
  }))
  if (body.kind === 'xychart') return [{ id: 'plot', kind: 'plot', members: [] }]
  if (body.kind === 'radar') return Array.from({ length: body.ticks }, (_, index) => ({
    id: `ring:${index}`,
    kind: 'ring' as const,
    members: [],
    geometry: { kind: 'ring' as const, index, count: body.ticks },
  }))
  if (body.kind === 'quadrant') return Array.from({ length: 4 }, (_, index) => ({
    id: `quadrant#${index + 1}`,
    kind: 'compartment' as const,
    members: [],
    geometry: { kind: 'quadrant' as const, index: index + 1 },
  }))
  if (body.kind === 'gantt') return body.sections.map((section, index) => ({
    id: `section#${index}`,
    kind: 'band' as const,
    members: section.tasks.map(task => task.taskId ?? task.id),
  }))
  return []
}

function addSemanticContainerRegions(ascii: string, source: string, regions: AsciiRegion[]): AsciiRegion[] {
  const lines = ascii.split('\n')
  const canvasEnd = Math.max(1, ...lines.map(visualWidth))
  const canvasRows = Math.max(1, lines.length)
  const result = [...regions]
  for (const container of semanticContainers(source)) {
    if (result.some(region => region.id === container.id && region.kind === container.kind)) continue
    const members = result.filter(region => container.members.includes(region.id))
    if (container.geometry?.kind === 'quadrant') {
      const left = container.geometry.index === 2 || container.geometry.index === 3
      const top = container.geometry.index === 1 || container.geometry.index === 2
      const halfCol = Math.floor(canvasEnd / 2)
      const halfRow = Math.floor(canvasRows / 2)
      result.push({
        id: container.id,
        kind: container.kind,
        canvasRow: top ? 0 : halfRow,
        canvasColStart: left ? 0 : halfCol,
        canvasColEnd: left ? Math.max(1, halfCol) : canvasEnd,
        rowSpan: Math.max(1, top ? halfRow : canvasRows - halfRow),
      })
      continue
    }
    if (container.geometry?.kind === 'ring') {
      const maxInset = Math.max(0, Math.floor(Math.min(canvasEnd, canvasRows) / 2) - 1)
      const inset = container.geometry.count <= 1
        ? 0
        : Math.round((container.geometry.count - 1 - container.geometry.index) * maxInset / container.geometry.count)
      result.push({
        id: container.id,
        kind: container.kind,
        canvasRow: inset,
        canvasColStart: inset,
        canvasColEnd: Math.max(inset + 1, canvasEnd - inset),
        rowSpan: Math.max(1, canvasRows - inset * 2),
      })
      continue
    }
    const firstRow = members.length > 0 ? Math.min(...members.map(region => region.canvasRow)) : 0
    const lastRow = members.length > 0
      ? Math.max(...members.map(region => region.canvasRow + (region.rowSpan ?? 1)))
      : Math.max(1, lines.length)
    result.push({
      id: container.id,
      kind: container.kind,
      canvasRow: firstRow,
      canvasColStart: members.length > 0 ? Math.min(...members.map(region => region.canvasColStart)) : 0,
      canvasColEnd: members.length > 0 ? Math.max(...members.map(region => region.canvasColEnd)) : canvasEnd,
      rowSpan: Math.max(1, lastRow - firstRow),
    })
  }
  result.sort((a, b) => a.canvasRow - b.canvasRow || a.canvasColStart - b.canvasColStart || compareCodePointStrings(a.id, b.id))
  return result
}

function orderGraphNodesForTerminal<T extends { id: string }>(
  graph: import('../types.ts').MermaidGraph,
  nodes: T[],
): void {
  try {
    const config: AsciiConfig = {
      useAscii: false,
      paddingX: 5,
      paddingY: 5,
      boxBorderPadding: 1,
      graphDirection: graph.direction === 'LR' || graph.direction === 'RL' ? 'LR' : 'TD',
    }
    const projected = convertToAsciiGraph(graph, config)
    createMapping(projected)
    const position = new Map(projected.nodes.flatMap(node => node.drawingCoord
      ? [[node.name, node.drawingCoord] as const]
      : []))
    const bottomToTop = graph.direction === 'BT'
    nodes.sort((a, b) => {
      const pa = position.get(a.id)
      const pb = position.get(b.id)
      if (!pa || !pb) return pa ? -1 : pb ? 1 : 0
      const row = bottomToTop ? pb.y - pa.y : pa.y - pb.y
      return row || pa.x - pb.x
    })
  } catch {
    // Best-effort metadata retains deterministic parse order if projection
    // cannot be repeated.
  }
}

function orderClassesForTerminal(body: ClassBody): ClassBody['classes'] {
  const classes = [...body.classes]
  const parents = new Map<string, Set<string>>()
  const children = new Map<string, Set<string>>()
  for (const relation of body.relations) {
    const hierarchical = relation.kind === 'inheritance' || relation.kind === 'realization'
    const parent = hierarchical && relation.markerAt === 'to' ? relation.to : relation.from
    const child = hierarchical && relation.markerAt === 'to' ? relation.from : relation.to
    if (!parents.has(child)) parents.set(child, new Set())
    parents.get(child)!.add(parent)
    if (!children.has(parent)) children.set(parent, new Set())
    children.get(parent)!.add(child)
  }
  const level = new Map<string, number>()
  const queue = classes.filter(cls => !parents.has(cls.id) || parents.get(cls.id)!.size === 0).map(cls => cls.id)
  for (const id of queue) level.set(id, 0)
  const cap = Math.max(0, classes.length - 1)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]!
    for (const child of children.get(id) ?? []) {
      const next = (level.get(id) ?? 0) + 1
      if (next > cap) continue
      if (!level.has(child) || level.get(child)! < next) {
        level.set(child, next)
        queue.push(child)
      }
    }
  }
  for (const cls of classes) if (!level.has(cls.id)) level.set(cls.id, 0)
  const authoredIndex = new Map(classes.map((cls, index) => [cls.id, index]))
  return classes.sort((a, b) => level.get(a.id)! - level.get(b.id)!
    || authoredIndex.get(a.id)! - authoredIndex.get(b.id)!)
}

function legacyClassBodyForCandidates(source: string): ClassBody | undefined {
  try {
    const legacy = parseClassDiagram(toMermaidLines(source))
    const namespaces: NonNullable<ClassBody['namespaces']> = []
    const namespaceByClass = new Map<string, string>()
    const visitNamespaces = (items: typeof legacy.namespaces, parent = ''): void => {
      for (const namespace of items) {
        const path = parent ? `${parent}.${namespace.name}` : namespace.name
        namespaces.push(namespace.label === undefined ? { name: path } : { name: path, label: namespace.label })
        for (const id of namespace.classIds) if (!namespaceByClass.has(id)) namespaceByClass.set(id, path)
        visitNamespaces(namespace.children, path)
      }
    }
    visitNamespaces(legacy.namespaces)
    return {
      kind: 'class',
      classes: legacy.classes.map(cls => ({
        id: cls.id,
        label: cls.label,
        generic: cls.generic,
        members: [],
        ...(namespaceByClass.has(cls.id) ? { namespace: namespaceByClass.get(cls.id) } : {}),
      })),
      relations: legacy.relationships.map(relation => ({
        from: relation.from,
        to: relation.to,
        kind: relation.type as ClassRelationKind,
        markerAt: relation.markerAt,
      })),
      notes: [],
      ...(namespaces.length > 0 ? { namespaces } : {}),
    }
  } catch {
    return undefined
  }
}

function classCandidates(body: ClassBody): Candidate[] {
  const classes = body.classes.some((cls, index, all) =>
    all.findIndex(other => (other.label || other.id) === (cls.label || cls.id)) !== index)
    ? orderClassesForTerminal(body)
    : body.classes
  const namespaces = body.namespaces ?? []
  const namespaceLabel = (name: string, label?: string): string => label ?? name.split('.').at(-1) ?? name
  const collidingNamespaces = new Set(namespaces.filter(namespace =>
    body.classes.some(cls => (cls.namespace === namespace.name || cls.namespace?.startsWith(`${namespace.name}.`))
      && (cls.label || cls.id) === namespaceLabel(namespace.name, namespace.label)))
    .map(namespace => namespace.name))
  const out: Candidate[] = []
  for (const namespace of namespaces) {
    if (collidingNamespaces.has(namespace.name)) {
      addCandidateWithFallback(out, namespace.name, namespaceLabel(namespace.name, namespace.label), undefined, 'cluster')
    }
  }
  out.push(...classes.flatMap(c => {
    const out: Candidate[] = []
    addCandidateWithFallback(out, c.id, c.label || c.id)
    return out
  }))
  for (const namespace of namespaces) {
    if (!collidingNamespaces.has(namespace.name)) {
      addCandidateWithFallback(out, namespace.name, namespaceLabel(namespace.name, namespace.label), undefined, 'cluster')
    }
  }
  return out
}

function candidatesForDiagram(source: string): Candidate[] {
  const r = parseMermaid(source)
  if (!r.ok) return []
  const d = r.value
  let graphBody: MermaidGraph | undefined
  let nodeSourceLine: ((id: string) => number | undefined) | undefined
  let groupSourceLine: ((id: string) => number | undefined) | undefined
  if (d.body.kind === 'flowchart') {
    graphBody = d.body.graph
    nodeSourceLine = id => d.source.nodes.get(id)?.line
    groupSourceLine = id => d.source.groups.get(id)?.line
  } else if (d.kind === 'flowchart') {
    // Markdown strings and other losslessly-preserved syntax can make the
    // agent body opaque even though the terminal renderer consumes the shared
    // legacy graph parser. Use that same parser for region identities.
    try { graphBody = parseFlowchartLegacy(d.canonicalSource) } catch { graphBody = undefined }
  }
  if (graphBody) {
    const out: Candidate[] = []
    const nodes = [...graphBody.nodes.values()]
    const labels = nodes.map(node => node.label && node.label.length > 0 ? node.label : node.id)
    if (new Set(labels).size !== labels.length) {
      orderGraphNodesForTerminal(graphBody, nodes)
    }
    const collidingGroups = new Set<string>()
    const descendantIds = (group: typeof graphBody.subgraphs[number]): string[] => [
      ...group.nodeIds,
      ...group.children.flatMap(descendantIds),
    ]
    const groupCollidesWithMember = (group: typeof graphBody.subgraphs[number]): boolean => {
      const groupLabel = group.label || group.id
      return descendantIds(group).some(id => {
        const node = graphBody.nodes.get(id)
        return (node?.label || node?.id) === groupLabel
      })
    }
    const addGroups = (groups: typeof graphBody.subgraphs, colliding: boolean): void => {
      for (const group of groups) {
        if (groupCollidesWithMember(group)) collidingGroups.add(group.id)
        if (collidingGroups.has(group.id) === colliding) {
          addCandidateWithFallback(out, group.id, group.label || group.id, groupSourceLine?.(group.id), 'subgraph')
        }
        addGroups(group.children, colliding)
      }
    }
    // A subgraph header is rendered before its contained node. Reserve that
    // occurrence only when both carry the same text; unrelated groups retain
    // the ordinary node-first candidate order.
    addGroups(graphBody.subgraphs, true)
    for (const n of nodes) addCandidateWithFallback(out, n.id, n.label && n.label.length > 0 ? n.label : n.id, nodeSourceLine?.(n.id))
    const visit = (groups: typeof graphBody.subgraphs): void => {
      for (const g of groups) {
        if (!collidingGroups.has(g.id)) addCandidateWithFallback(out, g.id, g.label || g.id, groupSourceLine?.(g.id), 'subgraph')
        visit(g.children)
      }
    }
    visit(graphBody.subgraphs)
    return out
  }
  if (d.body.kind === 'state') {
    const out: Candidate[] = []
    const topLevel = [...d.body.states]
    const labels = topLevel.map(state => state.label ?? state.id)
    if (new Set(labels).size !== labels.length) orderGraphNodesForTerminal(stateBodyToGraph(d.body), topLevel)
    const visit = (states: typeof d.body.states): void => {
      for (const s of states) {
        const nested = s.states ?? s.regions?.flatMap(region => region.states) ?? []
        addCandidateWithFallback(out, s.id, s.label ?? s.id, undefined, nested.length > 0 ? 'cluster' : 'node')
        if (nested.length > 0) visit(nested)
      }
    }
    visit(topLevel)
    return out
  }
  if (d.body.kind === 'sequence') {
    const out = d.body.participants.flatMap(p => {
      const out: Candidate[] = []
      addCandidateWithFallback(out, p.id, p.label || p.id)
      return out
    })
    let blockIndex = 0
    for (const statement of d.body.statements ?? []) {
      if (statement.kind !== 'fragment') continue
      addCandidateWithFallback(
        out,
        `block#${blockIndex++}:${statement.fragment.fragmentKind}`,
        statement.fragment.label ?? statement.fragment.fragmentKind,
        undefined,
        'compartment',
      )
    }
    return out
  }
  if (d.body.kind === 'class') return classCandidates(d.body)
  if (d.kind === 'class') {
    // Callback, call, and unsafe-link directives intentionally keep the agent
    // body opaque. The terminal renderer still consumes the legacy Class
    // parser, so use the same model to retain visible node/namespace regions.
    const classBody = legacyClassBodyForCandidates(d.canonicalSource)
    if (classBody) return classCandidates(classBody)
  }
  if (d.body.kind === 'er') {
    const out: Candidate[] = d.body.entities.map(e => ({ id: e.id, label: e.id }))
    for (const group of d.body.groups ?? []) {
      addCandidateWithFallback(out, group.id, group.label || group.id, undefined, 'cluster')
    }
    return out
  }
  if (d.body.kind === 'timeline') {
    const out: Candidate[] = []
    for (const s of d.body.sections) {
      addCandidate(out, s.id, s.label, undefined, 'band')
      for (const p of s.periods) addCandidate(out, p.id, p.label)
    }
    return out
  }
  if (d.body.kind === 'journey') {
    const out: Candidate[] = []
    addCandidate(out, 'title', d.body.title)
    for (const s of d.body.sections) {
      addCandidate(out, s.id, s.label, undefined, 'band')
      for (const t of s.tasks) addCandidate(out, t.id, t.text)
    }
    return out
  }
  if (d.body.kind === 'architecture') {
    const out: Candidate[] = []
    for (const g of d.body.groups) addCandidateWithFallback(out, g.id, g.label || g.id, undefined, 'cluster')
    for (const s of d.body.services) addCandidateWithFallback(out, s.id, s.label || s.id)
    return out
  }
  if (d.body.kind === 'xychart') {
    const out: Candidate[] = []
    addCandidate(out, 'title', d.body.title)
    addCandidate(out, 'x-axis', d.body.xAxis?.name)
    addCandidate(out, 'y-axis', d.body.yAxis?.name)
    d.body.xAxis?.categories?.forEach((label, index) => addCandidate(out, `x-category-${index}`, label))
    for (const s of d.body.series) addCandidate(out, s.id, s.name)
    return out
  }
  if (d.body.kind === 'pie') {
    const out: Candidate[] = []
    addCandidate(out, 'title', d.body.title)
    for (const s of d.body.slices) addCandidate(out, s.id, s.label)
    return out
  }
  if (d.body.kind === 'quadrant') {
    const out: Candidate[] = []
    addCandidate(out, 'title', d.body.title)
    addCandidate(out, 'x-axis-near', d.body.xAxis?.near)
    addCandidate(out, 'x-axis-far', d.body.xAxis?.far)
    addCandidate(out, 'y-axis-near', d.body.yAxis?.near)
    addCandidate(out, 'y-axis-far', d.body.yAxis?.far)
    d.body.quadrants.forEach((label, index) => addCandidate(out, `quadrant-label#${index + 1}`, label, undefined, 'label'))
    d.body.points.forEach((p, index) => addCandidate(out, `point-${index}`, p.label))
    return out
  }
  if (d.body.kind === 'gantt') {
    // Issue #26 WS10: gantt tasks/sections as stable click-mappable regions.
    // Region ids prefer the Mermaid task id (the durable handle agents use in
    // after/until/click) over the parse-order internal id.
    const out: Candidate[] = []
    for (let index = 0; index < d.body.sections.length; index++) {
      const s = d.body.sections[index]!
      addCandidate(out, `section-label#${index}`, s.label, undefined, 'label')
      for (const t of s.tasks) addCandidate(out, t.taskId ?? t.id, t.label)
    }
    return out
  }
  if (d.body.kind === 'gitgraph') {
    const out: Candidate[] = []
    for (const branch of d.body.branches) addCandidate(out, `branch:${branch.name}`, branch.name, undefined, 'lane')
    for (const commit of d.body.commits) addCandidateWithFallback(out, commit.id, commit.message || commit.id)
    return out
  }
  if (d.body.kind === 'mindmap') {
    const out: Candidate[] = []
    const visit = (node: typeof d.body.root): void => {
      addCandidateWithFallback(out, node.id, node.label || node.id)
      for (const child of node.children) visit(child)
    }
    visit(d.body.root)
    return out
  }
  if (d.body.kind === 'radar') {
    const out: Candidate[] = []
    for (const axis of d.body.axes) addCandidateWithFallback(out, axis.id, axis.label || axis.id)
    for (const curve of d.body.curves) addCandidateWithFallback(out, curve.id, curve.label || curve.id)
    return out
  }
  return []
}
