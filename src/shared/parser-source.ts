import { preservedMermaidFamilySource, type NormalizedMermaidSource } from '../mermaid-source.ts'
import { splitHeaderStatement } from '../mermaid-source-wrapper.ts'
import { installedFamilyStatementEnds } from '../agent/family-router.ts'
import { scanAccessibilityDirectives } from './accessibility-directives.ts'
import { sourceLineStarts, sourcePointAt } from './source-spans.ts'
import { LocatedParserError, type MermaidSyntaxErrorLocation } from './syntax-error.ts'

type Source = Pick<NormalizedMermaidSource, 'familyLines' | 'originalText' | 'wrapperSource' | 'authoredWrapperLength' | 'cleanup'>
export interface GrammarRow { text: string; offset: number }
export interface ParserGrammarTrace {
  project(text: string): { text: string; sourceOffset: (offset: number) => number }
  statements(rows: readonly GrammarRow[], text: string): readonly GrammarRow[]
}

/** Reconstruct the grammar's eligible spans only on failure. Universal fields
 * and comments cannot impersonate statements; cleanup owns encoded offsets. */
function grammarRows(source: Source, view: 'authored' | 'render' | 'grammar', trace?: ParserGrammarTrace) {
  const preserved = preservedMermaidFamilySource(source, view === 'grammar' ? 'authored' : view)
  const projected = view === 'grammar' ? trace?.project(preserved.text) : undefined
  const payload = projected ? { text: projected.text, sourceOffset: (offset: number) => preserved.sourceOffset(projected.sourceOffset(offset)) } : preserved
  const rows: GrammarRow[] = []
  let offset = 0
  for (const match of payload.text.matchAll(/([^\r\n]*)(\r\n?|\n|$)/g)) {
    if (match[0] === '') continue
    const text = match[1]!
    const parts = rows.length === 0 ? splitHeaderStatement(text).split('\n') : [text]
    let cursor = 0
    for (const part of parts) {
      const at = text.indexOf(part, cursor)
      rows.push({ text: part, offset: offset + Math.max(0, at) })
      cursor = Math.max(0, at) + part.length
    }
    offset += match[0].length
  }
  const input = trace ? trace.statements(rows, payload.text) : rows
  const texts = input.map(row => row.text)
  const scan = scanAccessibilityDirectives(texts, installedFamilyStatementEnds(texts[0] ?? '', texts))
  const eligible = scan.familyLines.flatMap((text, index): GrammarRow[] => {
    if (!text.trim() || text.trim().startsWith('%%')) return []
    const row = input[scan.familyOrigins[index]!]!
    const suffix = row.text.lastIndexOf(text.trim())
    return [{ text, offset: text === row.text ? row.offset : row.offset + Math.max(0, suffix) - text.search(/\S/) }]
  })
  return { rows: eligible, sourceOffset: payload.sourceOffset }
}

export function authoredParserPositions(source: Source, grammar: readonly string[], trace?: ParserGrammarTrace) {
  const starts = sourceLineStarts(source.originalText)
  let matches: Array<{ offset: number; lead: number; sourceOffset: (offset: number) => number } | undefined> = []
  // A render view may decode XML; authored flowchart parsing preserves it.
  // Select a complete monotone alignment, rather than searching removed text.
  const views = trace ? ['grammar', 'render', 'authored'] as const : ['render', 'authored'] as const
  for (const view of views) {
    const traced = grammarRows(source, view, trace)
    let rowIndex = 0, column = 0
    const found: typeof matches = []
    for (const text of grammar) {
      const wanted = text.trim()
      if (!wanted || wanted.startsWith('%%')) { found.push(undefined); continue }
      let point: NonNullable<(typeof matches)[number]> | undefined
      for (let at = rowIndex; at < traced.rows.length; at++) {
        const row = traced.rows[at]!
        const start = row.text.indexOf(wanted, at === rowIndex ? column : 0)
        if (start < 0) continue
        point = { offset: row.offset + start, lead: text.search(/\S/), sourceOffset: traced.sourceOffset }
        rowIndex = at
        column = start + wanted.length
        if (column === row.text.length) { rowIndex++; column = 0 }
        break
      }
      found.push(point)
      if (!point) break
    }
    if (found.filter(Boolean).length > matches.filter(Boolean).length) matches = found
    if (grammar.every((text, index) => !text.trim() || text.trim().startsWith('%%') || matches[index] !== undefined)) break
  }
  return (index: number, column = 1): { line?: number; column?: number } => {
    const match = matches[index]
    if (!match) return {}
    const point = sourcePointAt(starts, match.sourceOffset(match.offset + column - match.lead - 1))
    return { line: point.line, column: point.col }
  }
}

export function authoredParserLine(source: Source, trace?: ParserGrammarTrace): (index: number) => number | undefined {
  let position: ReturnType<typeof authoredParserPositions> | undefined
  return index => (position ??= authoredParserPositions(source, source.familyLines, trace))(index).line
}

export function authoredSyntaxLocation(source: Source, grammar: readonly string[], location: MermaidSyntaxErrorLocation): MermaidSyntaxErrorLocation {
  if (location.line === undefined) return { diagramType: location.diagramType }
  return { diagramType: location.diagramType, ...authoredParserPositions(source, grammar)(location.line - 1, location.column), ...(location.column === undefined ? { column: undefined } : {}) }
}

export function withParserSource<T>(source: Source, grammar: () => readonly string[], parse: () => T): T {
  try { return parse() } catch (error) {
    if (!(error instanceof LocatedParserError)) throw error
    const location = authoredSyntaxLocation(source, grammar(), error)
    for (const key of ['line', 'column', 'diagramType'] as const) {
      Object.defineProperty(error, key, { value: location[key], enumerable: true, configurable: true })
    }
    throw error
  }
}

export function authoredParserColumn(source: Source, trace?: ParserGrammarTrace): (index: number, column: number) => number | undefined {
  let position: ReturnType<typeof authoredParserPositions> | undefined
  return (index, column) => (position ??= authoredParserPositions(source, source.familyLines, trace))(index, column + 1).column
}
