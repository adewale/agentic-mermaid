import type { IshikawaBody, IshikawaNode } from './types.ts'
import { scanAccessibilityDirectives, requireClosedAccessibility, accessibilityFields } from '../shared/accessibility-directives.ts'
import { observeParserStatement, observeParserMutation } from '../shared/parser-observation.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { readAuthoredGrammarAccessibility, readGrammarAuthoredText, readGrammarText } from '../shared/grammar-text.ts'
export const isIshikawaHeader = (line: string): boolean => /^ishikawa(?:-beta)?\s*(?:%%.*)?$/i.test(line.trim())

/** The first cause establishes the indentation baseline, independently of the effect. */
export function parseIshikawaDiagram(input: string | readonly string[]): IshikawaBody {
  const scanned = scanAccessibilityDirectives(typeof input === 'string' ? input.split(/\r?\n/) : input)
  requireClosedAccessibility(scanned)
  const lines = scanned.familyLines
  const first = lines.findIndex(line => line.trim() && !line.trim().startsWith('%%'))
  if (!isIshikawaHeader(lines[first] ?? '')) throw new Error('Ishikawa source must start with ishikawa')
  const body: IshikawaBody = { kind: 'ishikawa', nodes: [], ...accessibilityFields(readAuthoredGrammarAccessibility(scanned.accessibility)) }
  const stack: { level: number; node: IshikawaNode }[] = []
  let base: number | undefined
  for (let i = first + 1; i < lines.length; i++) {
    const raw = lines[i]!
    const authored = raw.trim()
    if (!authored || authored.startsWith('%%')) continue
    const label = readGrammarText(readGrammarAuthoredText(authored))
    observeParserStatement('ishikawa', 'node', raw, { line: i + 1, unit: 'normalized' })
    assertDiagramWorkLimit('nodes', body.nodes.length + 1)
    const indent = raw.match(/^[\t ]*/)?.[0].length ?? 0
    if (body.nodes.length === 0) {
      const effect: IshikawaNode = { id: 'effect', label }
      body.nodes.push(effect)
      observeParserMutation('ishikawa', 'add-node', effect)
      stack.push({ level: 0, node: effect })
      continue
    }
    base ??= indent
    const level = Math.max(1, indent - base + 1)
    while (stack.length > 1 && stack.at(-1)!.level >= level) stack.pop()
    assertDiagramWorkLimit('nesting', stack.length)
    const node: IshikawaNode = { id: `cause-${body.nodes.length}`, label, parentId: stack.at(-1)!.node.id }
    body.nodes.push(node)
    stack.push({ level, node })
    observeParserMutation('ishikawa', 'add-node', node)
  }
  return body
}
