import { withParserObservationGrammar } from '../shared/parser-observation.ts'
import { parseFlowchartRenderSource, parseMermaid } from '../parser.ts'
import type { MermaidGraph } from '../types.ts'

/** Change only the grammar header. Labels, comments and quoted content never
 * pass through a source-to-source rewrite. */
export function swimlaneFlowchartSource(source: string): string {
  let replaced = false
  return source.replace(/^([ \t]*)(swimlane-beta|swimlane)(?=[\s;]|$)/gim, (all, prefix: string) => {
    if (replaced) return all
    replaced = true
    return `${prefix}flowchart`
  })
}

export function parseSwimlane(source: string): MermaidGraph {
  return withParserObservationGrammar('swimlane', 'flowchart', () => parseMermaid(swimlaneFlowchartSource(source)))
}

export function parseSwimlaneRenderSource(authored: string, decoded = authored): MermaidGraph {
  return withParserObservationGrammar('swimlane', 'flowchart', () => parseFlowchartRenderSource(swimlaneFlowchartSource(authored), swimlaneFlowchartSource(decoded)))
}
