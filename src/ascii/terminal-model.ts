import { parseRegisteredMermaid } from '../agent/parse.ts'
import { parseMermaid } from '../parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'

/** One execution's authored model. Graph drawing can reuse it when source
 * admission did not change the grammar input; other family grammars stay local. */
export function terminalInputModel(source: string, admittedFamilyText: string) {
  let parsed: ReturnType<typeof parseRegisteredMermaid> | undefined
  let graph: ReturnType<typeof parseMermaid> | undefined
  return Object.freeze({
    parsed: () => parsed ??= parseRegisteredMermaid(source),
    graph() {
      if (graph) return graph
      if (normalizeMermaidSource(source).familyText === admittedFamilyText) {
        const result = this.parsed()
        if (result.ok && result.value.body.kind === 'flowchart') return graph = result.value.body.graph
      }
      return graph = parseMermaid(admittedFamilyText)
    },
  })
}
export type TerminalInputModel = ReturnType<typeof terminalInputModel>
const terminalInputs = new WeakMap<object, TerminalInputModel>()
export function retainTerminalInput(result: object, model: TerminalInputModel): void { terminalInputs.set(result, model) }
export function terminalInputOf(result: object): TerminalInputModel { return terminalInputs.get(result)! }
