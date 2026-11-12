import { withParserSource } from '../shared/parser-source.ts'
import type { parseRegisteredMermaid } from '../agent/parse.ts'
import { parseFlowchartRenderSource, type parseMermaid } from '../parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

/** One execution's authored model. Graph drawing can reuse it when source
 * admission did not change the grammar input; other family grammars stay local. */
export function terminalInputModel(source: string, admittedFamilyText: string, parse?: () => ReturnType<typeof parseRegisteredMermaid>) {
  let parsed: ReturnType<typeof parseRegisteredMermaid> | undefined
  let graph: ReturnType<typeof parseMermaid> | undefined
  return Object.freeze({
    parsed() {
      if (!parse) throw new Error('Parsed terminal metadata requires the complete package entry')
      return parsed ??= parse()
    },
    graph() {
      if (graph) return graph
      const normalized = normalizeMermaidSource(source)
      const authored = normalized.familyBody
      if (parse && authored === admittedFamilyText) {
        const result = this.parsed()
        if (result.ok && result.value.body.kind === 'flowchart') return graph = result.value.body.graph
      }
      return graph = withParserSource(normalized, () => admittedFamilyText.split('\n'), () => parseFlowchartRenderSource(authored, admittedFamilyText))
    },
  })
}
export type TerminalInputModel = ReturnType<typeof terminalInputModel>
