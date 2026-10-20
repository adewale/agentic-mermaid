import type { LayoutWarning } from './types.ts'
import { cleanupMermaidSource, type MermaidCleanup } from '../shared/mermaid-cleanup.ts'
import { INIT_DIRECTIVE_REGEX, matchMermaidFrontmatter, mermaidFirstLine } from '../mermaid-source-wrapper.ts'
import { detectInstalledFamilyDescriptorFromFirstLine } from './family-router.ts'
import { parseAccessibilityDirective, statementEndAt } from '../shared/accessibility-directives.ts'

const STYLE_STATEMENT_FAMILIES = new Set(['flowchart', 'state', 'class', 'er'])
const CLASS_DEF_STATEMENT_FAMILIES = new Set([...STYLE_STATEMENT_FAMILIES, 'quadrant'])

/** Cleanup is universal source syntax. Report its lossy rewrites once per
 * authored line, independently of the selected family or its grammar. Entity
 * protection, transport XML decoding and newline normalization are ordinary
 * reading operations, rather than portability findings. */
export function mermaidCleanupWarnings(input: string | MermaidCleanup): LayoutWarning[] {
  const source = typeof input === 'string' ? input : input.originalText
  if (!source.includes('<') && !source.includes('style') && !source.includes('classDef')) return []
  const cleanup = typeof input === 'string' ? cleanupMermaidSource(source) : input
  // Route encoded headers as rendering does; scan authored rows for locations.
  const family = detectInstalledFamilyDescriptorFromFirstLine(mermaidFirstLine(cleanup.text), 'loose')
  const frontmatterEnd = matchMermaidFrontmatter(source)?.source.length ?? 0
  const directives = [...source.matchAll(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'))]
  const physicalLines = source.split(/\r\n?|\n/)
  let continuations: Set<number> | undefined
  const insideText = (line: number): boolean => {
    if (!continuations) {
      continuations = new Set<number>()
      const wrapperLines = source.slice(0, frontmatterEnd).match(/\r\n?|\n/g)?.length ?? 0
      const grammarLines = physicalLines.map((text, index) => index < wrapperLines ? '' : text)
      const ends = family?.statementEnds?.(grammarLines)
      for (let index = 0; index < grammarLines.length; index++) {
        const accessibility = parseAccessibilityDirective(grammarLines, index)
        const end = accessibility === undefined ? grammarLines.length - 1 : accessibility ? accessibility.endIndex : statementEndAt(ends, index, grammarLines.length)
        for (let next = index + 1; next <= end; next++) continuations.add(next + 1)
        index = end
      }
    }
    return continuations.has(line)
  }
  const lines = new Map<number, Set<string>>()
  for (const change of cleanup.changes) {
    if (change.reason !== 'html-attribute-quotes' && change.reason !== 'style-semicolon') continue
    if (change.reason === 'style-semicolon') {
      if (change.originalStart < frontmatterEnd) continue
      if (/^\s*%%/.test(physicalLines[change.line - 1] ?? '')) continue
      const keyword = /^\s*(style|classDef)\s/.exec(physicalLines[change.line - 1] ?? '')?.[1]
      const owners = keyword === 'classDef' ? CLASS_DEF_STATEMENT_FAMILIES : STYLE_STATEMENT_FAMILIES
      if (keyword && family && owners.has(family.id) && !insideText(change.line)) continue
      let low = 0, high = directives.length
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2)
        if (directives[middle]!.index <= change.originalStart) low = middle + 1
        else high = middle
      }
      const directive = directives[low - 1]
      if (directive && change.originalStart < directive.index + directive[0].length) continue
    }
    const reasons = lines.get(change.line) ?? new Set<string>()
    reasons.add(change.reason === 'html-attribute-quotes' ? 'rewrites double-quoted HTML-like attributes to single quotes' : 'removes a style/classDef semicolon')
    lines.set(change.line, reasons)
  }
  return [...lines].sort(([a], [b]) => a - b).map(([line, reasons]) => ({
    code: 'UNSUPPORTED_SYNTAX', syntax: 'mermaid_cleanup', line,
    message: `Mermaid's cleanup changed this line: it ${[...reasons].join(' and ')} before parsing. Agentic Mermaid retains the authored text; use entity codes for literal punctuation when exporting to Mermaid.`,
  }))
}
