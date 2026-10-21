import type { ParsedDiagram, SourceMap, ValidDiagramMeta } from './types.ts'
import { readStateStatements, matchTransitionLine, matchStateDeclarationLine, matchStereotypeDecl, STATE_ALIAS_RE, STATE_COMPOSITE_OPEN_RE, STATE_DESCRIPTION_RE } from '../state/parse-core.ts'
import { scanStateComments } from '../state/comment.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { splitHeaderStatement } from '../mermaid-source-wrapper.ts'
import { maskAccessibilityDirectivesForSourceMap, sourcePreservationSpans } from '../family-detection.ts'
import { getFamily } from './families.ts'

interface CommentStatement {
  collection: 'nodes' | 'edges' | 'groups'
  id: string
  line: number
  endLine: number
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
  for (const statement of readStateStatements(scanStateComments(body.split(/\r?\n/))).statements) {
    if (statement.noteBody) continue
    const location = { line: statement.line + 1, endLine: statement.line + 1 + (statement.text.match(/\n/g) ?? []).length }
    const transition = matchTransitionLine(statement.text)
    if (transition) {
      const pair = `${transition.from}->${transition.to}`
      const occurrence = occurrences.get(pair) ?? 0
      statements.push({ collection: 'edges', id: `${pair}#${occurrence}`, ...location })
      occurrences.set(pair, occurrence + 1)
    } else {
      const id = matchStateDeclarationLine(statement.text) ?? matchStereotypeDecl(statement.text)?.id
        ?? STATE_ALIAS_RE.exec(statement.text)?.[2] ?? STATE_COMPOSITE_OPEN_RE.exec(statement.text)?.[2]
        ?? STATE_DESCRIPTION_RE.exec(statement.text)?.[1]
      if (id && !nodes.has(id)) {
        nodes.add(id)
        statements.push({ collection: 'nodes', id, ...location })
      }
    }
  }
  return statements
}

/** Only comments the owning parser identified as comments enter this sidecar. */
export function retainBodyComments(diagram: ParsedDiagram, authored: string): void {
  if ((diagram.kind !== 'flowchart' && diagram.kind !== 'state') || !diagram.meta.droppedComments?.length) return
  const lines = authored.split(/\r?\n/)
  const stateLines = diagram.kind === 'state' ? scanStateComments(lines) : undefined
  const statements = (diagram.kind === 'state' ? stateCommentStatements(authored)
    : (['nodes', 'edges', 'groups'] as const).flatMap(collection =>
      [...(diagram.source.spans?.[collection] ?? [])].map(([id, span]) => ({ collection, id, line: span.start.line, endLine: span.end.line }))))
    .sort((a, b) => a.line - b.line)
  diagram.meta.bodyComments = diagram.meta.droppedComments.map(comment => {
    const line = lines[comment.line - 1] ?? ''
    const marker = stateLines ? stateLines[comment.line - 1]?.commentIndex ?? -1 : line.indexOf('%%')
    const raw = marker >= 0 ? line.slice(marker) : `%% ${comment.text}`
    const inline = marker > 0 && line.slice(0, marker).trim().length > 0
    const target = inline ? statements.find(statement => statement.line <= comment.line && statement.endLine >= comment.line) : statements.find(statement => statement.line > comment.line)
    return { raw, ...(target ? { anchor: { collection: target.collection, id: target.id } } : {}), placement: inline && target ? 'after' as const : 'before' as const }
  })
  delete diagram.meta.droppedComments
}

/** Insert safe standalone comments; a deleted anchor leaves its comment at the end. */
export function restoreBodyComments(bodySource: string, kind: ParsedDiagram['kind'], body: ParsedDiagram['body'], meta: ValidDiagramMeta): string {
  if (!meta.bodyComments?.length || (body.kind !== 'flowchart' && body.kind !== 'state')) return bodySource
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
    list.push(comment.raw.startsWith('%%{') ? `%% ${comment.raw.slice(2)}` : comment.raw); insertions.set(at, list)
  }
  return lines.flatMap((line, index) => [...(insertions.get(index) ?? []), line]).concat(insertions.get(lines.length) ?? []).join('\n') + '\n'
}
