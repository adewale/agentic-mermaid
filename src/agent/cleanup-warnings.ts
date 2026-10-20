import type { LayoutWarning } from './types.ts'
import { cleanupMermaidSource, type MermaidCleanup } from '../shared/mermaid-cleanup.ts'
import { INIT_DIRECTIVE_REGEX, matchMermaidFrontmatter } from '../mermaid-source-wrapper.ts'

/** Cleanup is universal source syntax. Report its lossy rewrites once per
 * authored line, independently of the selected family or its grammar. Entity
 * protection, transport XML decoding and newline normalization are ordinary
 * reading operations, rather than portability findings. */
export function mermaidCleanupWarnings(input: string | MermaidCleanup): LayoutWarning[] {
  const source = typeof input === 'string' ? input : input.originalText
  if (!source.includes('<') && !source.includes('style') && !source.includes('classDef')) return []
  const cleanup = typeof input === 'string' ? cleanupMermaidSource(source) : input
  const frontmatterEnd = matchMermaidFrontmatter(source)?.source.length ?? 0
  const directives = [...source.matchAll(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'))]
  const physicalLines = source.split(/\r\n?|\n/)
  const lines = new Map<number, Set<string>>()
  for (const change of cleanup.changes) {
    if (change.reason !== 'html-attribute-quotes' && change.reason !== 'style-semicolon') continue
    if (change.reason === 'style-semicolon' && (change.originalStart < frontmatterEnd
      || directives.some(directive => change.originalStart >= directive.index && change.originalStart < directive.index + directive[0].length)
      || /^\s*(?:%%|(?:style|classDef)\s)/.test(physicalLines[change.line - 1] ?? ''))) continue
    const reasons = lines.get(change.line) ?? new Set<string>()
    reasons.add(change.reason === 'html-attribute-quotes' ? 'rewrites double-quoted HTML-like attributes to single quotes' : 'removes a style/classDef semicolon')
    lines.set(change.line, reasons)
  }
  return [...lines].sort(([a], [b]) => a - b).map(([line, reasons]) => ({
    code: 'UNSUPPORTED_SYNTAX', syntax: 'mermaid_cleanup', line,
    message: `Mermaid's cleanup changed this line: it ${[...reasons].join(' and ')} before parsing. Agentic Mermaid retains the authored text; use entity codes for literal punctuation when exporting to Mermaid.`,
  }))
}
