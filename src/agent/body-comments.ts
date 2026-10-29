import type { AnyMutationOp, ParsedDiagram, SourceMap, StateBody, StateNode, StateTransition, ValidDiagramMeta } from './types.ts'
import { readStateStatements, matchTransitionLine, matchStateDeclarationLine, matchStereotypeDecl, isConcurrencySeparator, STATE_ALIAS_RE, STATE_COMPOSITE_OPEN_RE, STATE_DESCRIPTION_RE } from '../state/parse-core.ts'
import { scanStateComments } from '../state/comment.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { splitHeaderStatement } from '../mermaid-source-wrapper.ts'
import { maskAccessibilityDirectivesForSourceMap, sourcePreservationSpans } from '../family-detection.ts'
import { getFamily } from './families.ts'
import { writeMermaidComment } from '../shared/trailing-comment.ts'
import { edgeSourceMapKey, findEdgeIndexById } from './flowchart-body.ts'

interface CommentStatement {
  collection: 'nodes' | 'edges' | 'groups'
  id: string
  line: number
  endLine: number
}

function stateEdgeAnchor(parent: string | null, region: number, from: string, to: string, occurrence: number): string {
  return JSON.stringify([parent, region, from, to, occurrence])
}

function stateScopes(body: StateBody): Array<{ parent: string | null; region: number; transitions: StateTransition[] }> {
  const result = [{ parent: null as string | null, region: 0, transitions: body.transitions }]
  const walk = (states: StateNode[]): void => {
    for (const state of states) {
      if (state.regions) state.regions.forEach((region, index) => {
        result.push({ parent: state.id, region: index, transitions: region.transitions })
        walk(region.states)
      })
      else if (state.states) {
        result.push({ parent: state.id, region: 0, transitions: state.transitions ?? [] })
        walk(state.states)
      }
    }
  }
  walk(body.states)
  return result
}

/** Rebase identities before reparsing can mistake a deleted anchor for a new
 * occurrence with the same spelling. A removed anchor becomes unassociated. */
export function snapshotBodyCommentAnchors(diagram: ParsedDiagram): ParsedDiagram {
  if (!diagram.meta.bodyComments?.length || diagram.body.kind !== 'flowchart') return diagram
  // An owned batch can edit the same graph again. Rebase needs the preceding
  // edge identities, not a second copy of all node/style/group data.
  return { ...diagram, body: { ...diagram.body, graph: { ...diagram.body.graph, edges: diagram.body.graph.edges.map(edge => ({ ...edge })) } } } as ParsedDiagram
}

export function rebaseBodyComments(diagram: ParsedDiagram, next: ParsedDiagram['body'], op: AnyMutationOp): ParsedDiagram {
  if (!diagram.meta.bodyComments?.length || next.kind === 'preserved' || next.kind === 'extension') return diagram
  const renamed = op.kind === 'rename_node' || op.kind === 'rename_state' ? op : undefined
  const rename = (id: string): string => {
    if (!renamed) return id
    if (id === renamed.from) return renamed.to
    if (diagram.kind === 'state' && (id === `${renamed.from}[H]` || id === `${renamed.from}[H*]`)) return renamed.to + id.slice(renamed.from.length)
    return id
  }
  const edges = new Map<string, string>()
  if (diagram.body.kind === 'flowchart' && next.kind === 'flowchart') {
    const removed = op.kind === 'remove_edge' && typeof op.id === 'string' ? findEdgeIndexById(diagram.body.graph, op.id) : -1
    const beforeOccurrences = new Map<string, number>()
    const afterPairs = new Set(next.graph.edges.map(edge => JSON.stringify([edge.source, edge.target])))
    let nextIndex = 0
    for (const [index, edge] of diagram.body.graph.edges.entries()) {
      const pair = `${edge.source}->${edge.target}`
      const occurrence = beforeOccurrences.get(pair) ?? 0
      beforeOccurrences.set(pair, occurrence + 1)
      if (index === removed || !afterPairs.has(JSON.stringify([rename(edge.source), rename(edge.target)]))) continue
      const target = edgeSourceMapKey(nextIndex++, { ...edge, source: rename(edge.source), target: rename(edge.target) })
      edges.set(edgeSourceMapKey(index, edge), target)
      edges.set(`${pair}#${occurrence}`, target)
      if (occurrence === 0) edges.set(pair, target)
    }
  } else if (diagram.body.kind === 'state' && next.kind === 'state') {
    const afterScopes = stateScopes(next)
    for (const scope of stateScopes(diagram.body)) {
      const parent = scope.parent === null ? null : rename(scope.parent)
      const afterScope = afterScopes.find(candidate => candidate.parent === parent && candidate.region === scope.region)
      if (!afterScope) continue
      const removed = op.kind === 'remove_transition' && (op.parent ?? null) === scope.parent && (op.region ?? 0) === scope.region
        ? op.index ?? scope.transitions.findIndex(transition => transition.from === op.from && transition.to === op.to) : -1
      const beforeOccurrences = new Map<string, number>()
      const afterOccurrences = new Map<string, number>()
      const afterPairs = new Set(afterScope.transitions.map(transition => JSON.stringify([transition.from, transition.to])))
      for (const [index, transition] of scope.transitions.entries()) {
        const pair = JSON.stringify([transition.from, transition.to])
        const occurrence = beforeOccurrences.get(pair) ?? 0
        beforeOccurrences.set(pair, occurrence + 1)
        const from = rename(transition.from), to = rename(transition.to)
        if (index === removed || !afterPairs.has(JSON.stringify([from, to]))) continue
        const afterPair = JSON.stringify([from, to])
        const afterOccurrence = afterOccurrences.get(afterPair) ?? 0
        afterOccurrences.set(afterPair, afterOccurrence + 1)
        edges.set(stateEdgeAnchor(scope.parent, scope.region, transition.from, transition.to, occurrence), stateEdgeAnchor(parent, scope.region, from, to, afterOccurrence))
      }
    }
  }
  const serialized = getFamily(diagram.kind)?.serialize?.(next)
  const statements = serialized && next.kind === 'state' ? stateCommentStatements(serialized) : undefined
  const map = serialized && !statements ? getFamily(diagram.kind)?.buildSourceMap?.(next, serialized) : undefined
  const bodyComments = diagram.meta.bodyComments.map(comment => {
    if (!comment.anchor) return comment
    const { collection, id } = comment.anchor
    const mapped = collection === 'edges' && (next.kind === 'flowchart' || next.kind === 'state') ? edges.get(id) : rename(id)
    const exists = mapped !== undefined && (statements
      ? statements.some(statement => statement.collection === collection && statement.id === mapped)
      : map?.[collection].has(mapped))
    return { ...comment, anchor: exists ? { collection, id: mapped! } : undefined }
  })
  return { ...diagram, meta: { ...diagram.meta, bodyComments } } as ParsedDiagram
}

function stateCommentStatements(source: string): CommentStatement[] {
  const normalized = normalizeMermaidSource(source)
  const wrapperEnd = normalized.authoredWrapperLength ?? normalized.wrapperSource?.length ?? 0
  const header = splitHeaderStatement(source.slice(wrapperEnd).split(/\r?\n/, 1)[0]!.trim()).split('\n')[0]!.trim()
  const bodyStart = sourcePreservationSpans(source, header, wrapperEnd).body.start.offset
  const masked = maskAccessibilityDirectivesForSourceMap(source)
  const body = masked.slice(0, bodyStart).replace(/[^\r\n]/g, ' ') + masked.slice(bodyStart)
  const statements: CommentStatement[] = []
  const nodes = new Set<string>()
  const occurrences = new Map<string, number>()
  const scopes: Array<{ parent: string | null; region: number }> = [{ parent: null, region: 0 }]
  for (const statement of readStateStatements(scanStateComments(body.split(/\r?\n/))).statements) {
    if (statement.noteBody) continue
    if (statement.text === '}') { if (scopes.length > 1) scopes.pop(); continue }
    if (isConcurrencySeparator(statement.text)) { scopes.at(-1)!.region++; continue }
    const location = { line: statement.line + 1, endLine: statement.line + 1 + (statement.text.match(/\n/g) ?? []).length }
    const transition = matchTransitionLine(statement.text)
    if (transition) {
      const pair = JSON.stringify([scopes.at(-1)!.parent, scopes.at(-1)!.region, transition.from, transition.to])
      const occurrence = occurrences.get(pair) ?? 0
      statements.push({ collection: 'edges', id: stateEdgeAnchor(scopes.at(-1)!.parent, scopes.at(-1)!.region, transition.from, transition.to, occurrence), ...location })
      occurrences.set(pair, occurrence + 1)
    } else {
      const id = matchStateDeclarationLine(statement.text) ?? matchStereotypeDecl(statement.text)?.id
        ?? STATE_ALIAS_RE.exec(statement.text)?.[2] ?? STATE_COMPOSITE_OPEN_RE.exec(statement.text)?.[2]
        ?? STATE_DESCRIPTION_RE.exec(statement.text)?.[1]
      if (id && !nodes.has(id)) {
        nodes.add(id)
        statements.push({ collection: 'nodes', id, ...location })
      }
      const composite = STATE_COMPOSITE_OPEN_RE.exec(statement.text)
      if (composite) scopes.push({ parent: composite[2]!, region: 0 })
    }
  }
  return statements
}

/** Only comments the owning parser identified as comments enter this sidecar. */
export function retainBodyComments(diagram: ParsedDiagram, authored: string): void {
  if (!diagram.meta.droppedComments?.length) return
  const lines = authored.split(/\r?\n/)
  const stateLines = diagram.kind === 'state' ? scanStateComments(lines) : undefined
  const statements = (diagram.kind === 'state' ? stateCommentStatements(authored)
    : diagram.kind !== 'flowchart' ? [] : (['nodes', 'edges', 'groups'] as const).flatMap(collection =>
      [...(diagram.source.spans?.[collection] ?? [])].map(([id, span]) => ({ collection, id, line: span.start.line, endLine: span.end.line }))))
    // An edge's inline node declaration is part of that edge statement. Its
    // incidental node span must not steal a comment when the source reloads.
    .sort((a, b) => a.line - b.line || Number(b.collection === 'edges') - Number(a.collection === 'edges'))
  diagram.meta.bodyComments = diagram.meta.droppedComments.map(comment => {
    const line = lines[comment.line - 1] ?? ''
    // The owning parser has already identified this comment. Match its exact
    // suffix rather than treating a quoted %% earlier on the line as a marker.
    let marker = stateLines ? stateLines[comment.line - 1]?.commentIndex ?? -1 : line.indexOf('%%')
    while (!stateLines && marker >= 0 && line.slice(marker + 2).trim() !== comment.text.trim()) marker = line.indexOf('%%', marker + 2)
    const raw = marker >= 0 ? line.slice(marker) : `%% ${comment.text}`
    const inline = marker > 0 && line.slice(0, marker).trim().length > 0
    const afterStatement = inline && comment.line !== diagram.source.spans?.preserved.header.start.line
    const target = afterStatement ? statements.find(statement => statement.line <= comment.line && statement.endLine >= comment.line) : statements.find(statement => statement.line > comment.line)
    return { raw, ...(target ? { anchor: { collection: target.collection, id: target.id } } : {}), placement: afterStatement && target ? 'after' as const : 'before' as const }
  })
  delete diagram.meta.droppedComments
}

/** Insert safe standalone comments; a deleted anchor leaves its comment at the end. */
export function restoreBodyComments(bodySource: string, kind: ParsedDiagram['kind'], body: ParsedDiagram['body'], meta: ValidDiagramMeta): string {
  if (!meta.bodyComments?.length || body.kind === 'opaque' || body.kind === 'preserved' || body.kind === 'extension') return bodySource
  const stateStatements = kind === 'state' ? stateCommentStatements(bodySource) : undefined
  const map: SourceMap | undefined = stateStatements ? undefined : getFamily(kind)?.buildSourceMap?.(body, bodySource)
  const lines = bodySource.trimEnd().split('\n')
  const insertions = new Map<number, string[]>()
  for (const comment of meta.bodyComments) {
    if (typeof comment.raw !== 'string' || !comment.raw.startsWith('%%') || /[\r\n]/.test(comment.raw)
      || !['before', 'after'].includes(comment.placement)
      || (comment.anchor && !['nodes', 'edges', 'groups'].includes(comment.anchor.collection))) throw new Error('Invalid body comment metadata')
    const location = comment.anchor && (stateStatements?.find(statement => statement.collection === comment.anchor!.collection && statement.id === comment.anchor!.id)
      ?? map?.[comment.anchor.collection].get(comment.anchor.id))
    const endLine = location && 'endLine' in location ? location.endLine : location?.line
    const at = location ? comment.placement === 'before' ? location.line - 1 : endLine! : lines.length
    const list = insertions.get(at) ?? []
    // Mermaid's public comment cleanup requires a payload character. A bare
    // %% otherwise reaches Sankey's CSV lexer, even on its own line.
    const raw = kind === 'sankey' && comment.raw === '%%' ? '%% ' : comment.raw
    list.push(writeMermaidComment(raw)); insertions.set(at, list)
  }
  return lines.flatMap((line, index) => [...(insertions.get(index) ?? []), line]).concat(insertions.get(lines.length) ?? []).join('\n') + '\n'
}
