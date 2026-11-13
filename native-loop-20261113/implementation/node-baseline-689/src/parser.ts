import { parseGraphSource, parseFlowchartRenderSourceWithParser } from './parser-flowchart.ts'
import { STATE_GRAPH_GRAMMAR } from './parser-state.ts'
import type { MermaidGraph } from './types.ts'
export { parseStyleProps, splitInlineHeaderStatements, splitFlowchartStatements, emptyFlowchartGraph, flowchartStatementNotes, type FlowchartStatementNote } from './parser-flowchart.ts'

/** Public graph compatibility parsing retains both canonical grammars. */
export function parseMermaid(text: string): MermaidGraph {
  return parseGraphSource(text, STATE_GRAPH_GRAMMAR)
}
export function parseFlowchartRenderSource(authoredFamilyText: string, decodedFamilyText: string): MermaidGraph {
  return parseFlowchartRenderSourceWithParser(parseMermaid, authoredFamilyText, decodedFamilyText)
}
