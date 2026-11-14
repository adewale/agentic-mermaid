import { detectCompatibilityGraphFamilyFromFirstLine } from './agent/family-router.ts'
import { classifyMermaidFamilyFromFirstLine } from './family-detection.ts'
import type { MermaidGraph } from './types.ts'
import type { FlowchartLineGroup } from './flowchart-lexer.ts'
import type { MermaidSyntaxErrorLocation } from './shared/syntax-error.ts'

export interface StateGraphGrammar {
  lines(rawLines: string[]): string[]
  parse(lines: string[]): MermaidGraph
}
export interface FlowGraphGrammar {
  statements(lines: string[]): Array<{ text: string; source: FlowchartLineGroup; breaks?: number[] }>
  splitStatements(line: string): string[]
  parse(lines: string[], breaks: ReadonlyArray<readonly number[] | undefined>, locationAt: (index: number, offset: number) => MermaidSyntaxErrorLocation): MermaidGraph
  position(source: FlowchartLineGroup, offset: number): { line: number; col: number }
}

export function parseGraphSource(text: string, flowGrammar: FlowGraphGrammar | undefined, stateGrammar?: StateGraphGrammar): MermaidGraph {
  const rawLines = text.split('\n')
  const firstStatement = rawLines.find(line => line.trim().length > 0 && !line.trim().startsWith('%%'))?.trim() ?? ''
  // State note text must not pass through Flowchart's string coalescers or
  // the generic whole-line comment filter. A `//` line is dropped only
  // outside a string, which reads it as text, as the typed body does.
  const state = /^stateDiagram(?:-v2)?(?=$|[\s;%])/i.test(firstStatement)
  const statements = state ? [] : flowGrammar!.statements(rawLines)
  const lines = expandInlineHeaderStatements(state
    ? stateGrammar!.lines(rawLines)
    : statements.map(statement => statement.text), flowGrammar?.splitStatements)
  // The statements a header line holds (`flowchart TD; A`) start the lines.
  const headerStatements = lines.length - statements.length
  const breaks = headerStatements > 0
    ? [...Array<undefined>(headerStatements + 1), ...statements.slice(1).map(statement => statement.breaks)]
    : statements.map(statement => statement.breaks)

  if (lines.length === 0) {
    throw new Error('Empty mermaid diagram')
  }

  // Detect diagram type from header
  const header = lines[0]!

  const detection = classifyMermaidFamilyFromFirstLine(header, 'strict')
  const familyId = detection.kind === 'registered'
    ? detection.familyId
    : detectCompatibilityGraphFamilyFromFirstLine(header)

  if (familyId === 'state') {
    return stateGrammar!.parse(lines)
  }
  if (familyId === 'flowchart') return flowGrammar!.parse(lines, breaks, (index, start) => {
    const statement = statements[index <= headerStatements ? 0 : index - headerStatements]!
    let offset = statement.source.text.length - statement.source.text.trimStart().length
    if (index > 0 && index <= headerStatements) {
      const expanded = splitInlineHeaderStatementsWithFlow(statement.text, flowGrammar!.splitStatements)!
      let cursor = expanded.header.length
      for (let at = 0; at < index; at++) {
        offset = statement.source.text.indexOf(expanded.statements[at]!, cursor)
        cursor = offset + expanded.statements[at]!.length
      }
    }
    const point = flowGrammar!.position(statement.source, offset + start)
    return { diagramType: 'flowchart', line: point.line + 1, column: point.col + 1 }
  })

  if (detection.kind === 'unknown') throw new Error(`Unknown Mermaid diagram header: ${header}`)
  const detectedFamilyId = detection.kind === 'registered' ? detection.familyId : detection.match.family.id

  // This compatibility API returns a MermaidGraph and therefore cannot
  // truthfully parse non-graph families. Family-neutral callers should use
  // the agent parser instead of falling through to the flowchart grammar.
  throw new Error(`Mermaid family "${detectedFamilyId}" is not a graph family; use the family-neutral agent parser`)
}

function expandInlineHeaderStatements(lines: string[], splitFlowStatements?: (line: string) => string[]): string[] {
  const split = lines.length > 0 ? splitInlineHeaderStatementsWithFlow(lines[0]!, splitFlowStatements) : undefined
  return split ? [split.header, ...split.statements, ...lines.slice(1)] : lines
}

/** A trimmed header line with statements after `;` (`flowchart TD; A`):
 * the header, and the statements after it; undefined for a bare header. */
export function splitInlineHeaderStatementsWithFlow(line: string, splitFlowStatements?: (line: string) => string[]): { header: string; statements: string[] } | undefined {
  if (!line.includes(';')) return undefined
  // The header's direction (`graph >`) is not a statement: split after it.
  const header = line.match(/^(?:(?:graph|flowchart|swimlane)(?:[ \t]+(?:TD|TB|LR|BT|RL|[<>^v])(?![\w-]))?|stateDiagram(?:-v2)?)(?=$|[\s;])/i)
  if (!header) return undefined
  const rest = line.slice(header[0].length).trim()
  if (!rest.startsWith(';')) return undefined
  // The State reader splits its own statements (readStateStatements).
  return { header: header[0], statements: /^stateDiagram/i.test(header[0]) ? [rest] : splitFlowStatements!(rest) }
}

