import type { LayoutWarning } from './types.ts'
import { cleanedMermaidOffset, cleanupMermaidSource, mermaidLineEnd, originalMermaidOffset, type MermaidCleanup, type MermaidCleanupChange } from '../shared/mermaid-cleanup.ts'
import { INIT_DIRECTIVE_REGEX, matchMermaidFrontmatter, mermaidFirstLine } from '../mermaid-source-wrapper.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { detectInstalledFamilyDescriptorFromFirstLine } from './family-router.ts'
import { parseRegisteredMermaid } from './parse.ts'
import { parseAccessibilityDirective, statementEndAt } from '../shared/accessibility-directives.ts'
import { classStyleStatementLines } from '../class/parser.ts'
import { erStyleStatementLines } from '../er/parser.ts'
import { flowchartStatementSpans } from '../flowchart-lexer.ts'
import { tokenize as tokenizeBlock } from '../block/lexer.ts'
import { T as BlockToken } from '../block/tokens.ts'
import { tokenize as tokenizeRequirement } from '../requirement/lexer.ts'
import { T as RequirementToken } from '../requirement/tokens.ts'

const STYLE_STATEMENT_FAMILIES = new Set(['flowchart', 'state', 'class', 'er', 'block', 'requirement'])
const CLASS_DEF_STATEMENT_FAMILIES = new Set([...STYLE_STATEMENT_FAMILIES, 'quadrant', 'treemap'])

/** These grammars consume style declarations through the physical row's end.
 * Their lexers distinguish declaration tokens from quoted multiline payloads. */
function styleTokenLines(lines: readonly string[], tokens: { types: readonly number[]; starts: readonly number[] }, style: number, classDef: number): ReadonlySet<number> {
  const result = new Set<number>()
  let line = 0, start = 0
  for (let index = 0; index < tokens.types.length; index++) {
    if (tokens.types[index] !== style && tokens.types[index] !== classDef) continue
    const offset = tokens.starts[index]!
    while (line + 1 < lines.length && start + lines[line]!.length < offset) start += lines[line++]!.length + 1
    if (!lines[line]!.slice(0, offset - start).trim()) result.add(line + 1)
  }
  return result
}

function requirementStyleLines(lines: readonly string[], cleanup: MermaidCleanup): ReadonlySet<number> {
  const grammar = [...lines]
  const headerRow = grammar.findIndex(line => line.trim() && !line.trimStart().startsWith('%%'))
  if (headerRow >= 0) {
    let originalStart = 0
    for (let row = 0; row < headerRow; row++) {
      const end = mermaidLineEnd(cleanup.originalText, originalStart)
      originalStart = end + (cleanup.originalText[end] === '\r' && cleanup.originalText[end + 1] === '\n' ? 2 : 1)
    }
    const start = cleanedMermaidOffset(cleanup, originalStart)
    const header = /^[^\S\r\n]*requirement(?:Diagram)?(?=$|[\s;%])/i.exec(cleanup.text.slice(start))
    if (header) {
      // Decode only the routing token through the existing receipt. Payload
      // quotes and physical row positions remain in their authored form.
      const end = originalMermaidOffset(cleanup, start + header[0].length, 'end')
      grammar[headerRow] = 'requirementDiagram' + grammar[headerRow]!.slice(end - originalStart)
    }
  }
  return styleTokenLines(grammar, tokenizeRequirement(grammar.join('\n')), RequirementToken.STYLE, RequirementToken.CLASSDEF)
}

/** What a diagram draws, as text to compare: comments, which nothing draws,
 * aside. Each tag's attribute quotes in the body can be read as Mermaid's
 * cleanup leaves them, where Mermaid draws that text as HTML. */
function readingOf(source: string, htmlBody: boolean): string | undefined {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind === 'opaque' || parsed.value.body.kind === 'preserved') return undefined
  const { comments: _, wrapperSource: __, ...meta } = parsed.value.meta
  return JSON.stringify([meta, parsed.value.body], (_key, value: unknown) =>
    value instanceof Map ? [...value] : value instanceof Set ? [...value]
      : htmlBody && typeof value === 'string' && value.includes('<') ? cleanupMermaidSource(value).upstreamText : value)
}

/** Whether these rewrites change what we read. Each is applied in place, a
 * dropped `;` as a blank, so no later offset moves. A rewrite that leaves the
 * reading as it was is one Mermaid's grammar does not see either: a `;` that
 * only ended a style statement, or tag attribute quotes inside one label. */
function changesReading(source: string, changes: readonly MermaidCleanupChange[], authored: (htmlBody: boolean) => string | undefined, htmlLabels: boolean): boolean {
  const htmlBody = htmlLabels && changes.some(change => change.reason === 'html-attribute-quotes')
  const before = authored(htmlBody)
  if (before === undefined) return true
  let rewritten = source
  for (const change of [...changes].sort((a, b) => b.originalStart - a.originalStart)) {
    const replacement = change.reason === 'style-semicolon' ? ' '.repeat(change.originalEnd - change.originalStart) : "'"
    rewritten = rewritten.slice(0, change.originalStart) + replacement + rewritten.slice(change.originalEnd)
  }
  return readingOf(rewritten, htmlBody) !== before
}

/** Cleanup is universal source syntax. Report its rewrites that change what is
 * read once per authored line, independently of the family's grammar. Entity
 * protection, transport XML decoding and newline normalization are ordinary
 * reading operations, rather than portability findings. */
export function mermaidCleanupWarnings(input: string | MermaidCleanup): LayoutWarning[] {
  const source = typeof input === 'string' ? input : input.originalText
  if (!source.includes('<') && !source.includes('style') && !source.includes('classDef')) return []
  const cleanup = typeof input === 'string' ? cleanupMermaidSource(source) : input
  if (!cleanup.changes.some(change => change.reason === 'html-attribute-quotes' || change.reason === 'style-semicolon')) return []
  // Route encoded headers as rendering does; scan authored rows for locations.
  const family = detectInstalledFamilyDescriptorFromFirstLine(mermaidFirstLine(cleanup.text), 'loose')
  const frontmatterEnd = matchMermaidFrontmatter(source)?.source.length ?? 0
  const directives = [...source.matchAll(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'))]
  const physicalLines = source.split(/\r\n?|\n/)
  let continuations: Set<number> | undefined
  let grammarLines: string[] | undefined
  let actualStyleLines: ReadonlySet<number> | undefined
  const insideText = (line: number): boolean => {
    if (!continuations) {
      continuations = new Set<number>()
      const wrapperLines = source.slice(0, frontmatterEnd).match(/\r\n?|\n/g)?.length ?? 0
      const sourceLines = source.replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'), text => text.replace(/[^\r\n]/g, ' '))
        .split(/\r\n?|\n/).map((text, index) => index < wrapperLines ? '' : text)
      grammarLines = sourceLines.slice()
      const ends = family?.statementEnds?.(sourceLines)
      for (let index = 0; index < sourceLines.length; index++) {
        const accessibility = parseAccessibilityDirective(sourceLines, index)
        const end = accessibility === undefined ? sourceLines.length - 1 : accessibility ? accessibility.endIndex : statementEndAt(ends, index, sourceLines.length)
        for (let next = index + 1; next <= end; next++) continuations.add(next + 1)
        if (accessibility !== null) for (let next = index; next <= end; next++) grammarLines[next] = ''
        index = end
      }
    }
    return continuations.has(line)
  }
  const ownsWholeStyleRow = (line: number): boolean => {
    if (family?.id === 'flowchart') return flowchartStatementSpans(physicalLines[line - 1] ?? '').length === 1
    if (family?.id !== 'class' && family?.id !== 'er' && family?.id !== 'block' && family?.id !== 'requirement') return true
    if (!actualStyleLines) {
      try {
        if (family.id === 'class') actualStyleLines = classStyleStatementLines(grammarLines!)
        else if (family.id === 'er') actualStyleLines = erStyleStatementLines(grammarLines!)
        else if (family.id === 'block') actualStyleLines = styleTokenLines(grammarLines!, tokenizeBlock(grammarLines!.join('\n')), BlockToken.STYLE, BlockToken.CLASSDEF)
        else actualStyleLines = requirementStyleLines(grammarLines!, cleanup)
      } catch { actualStyleLines = new Set() }
    }
    return actualStyleLines.has(line)
  }
  const lineChanges = new Map<number, MermaidCleanupChange[]>()
  for (const change of cleanup.changes) {
    if (change.reason !== 'html-attribute-quotes' && change.reason !== 'style-semicolon') continue
    if (change.reason === 'style-semicolon') {
      if (change.originalStart < frontmatterEnd) continue
      if (/^\s*%%/.test(physicalLines[change.line - 1] ?? '')) continue
      const keyword = /^\s*(style|classDef)\s/.exec(physicalLines[change.line - 1] ?? '')?.[1]
      const owners = keyword === 'classDef' ? CLASS_DEF_STATEMENT_FAMILIES : STYLE_STATEMENT_FAMILIES
      const suffix = physicalLines[change.line - 1]!.slice(change.col - 1 + change.originalEnd - change.originalStart)
      if (keyword && family && owners.has(family.id) && !suffix.trim() && !insideText(change.line) && ownsWholeStyleRow(change.line)) continue
      let low = 0, high = directives.length
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2)
        if (directives[middle]!.index <= change.originalStart) low = middle + 1
        else high = middle
      }
      const directive = directives[low - 1]
      if (directive && change.originalStart < directive.index + directive[0].length) continue
    }
    lineChanges.set(change.line, [...lineChanges.get(change.line) ?? [], change])
  }
  if (lineChanges.size === 0) return []
  // Mermaid draws Flowchart labels as HTML unless htmlLabels is off, so
  // there an attribute's quote character is not drawn.
  let htmlLabels = false
  if (family?.id === 'flowchart') {
    try {
      const { config } = normalizeMermaidSource(source)
      htmlLabels = String(config.htmlLabels ?? config.flowchart?.htmlLabels ?? true) !== 'false'
    } catch { htmlLabels = false }
  }
  const readings = new Map<boolean, string | undefined>()
  const authored = (htmlBody: boolean): string | undefined => {
    if (!readings.has(htmlBody)) readings.set(htmlBody, readingOf(source, htmlBody))
    return readings.get(htmlBody)
  }
  // One reading per kind of rewrite bounds the cost on large diagrams: a
  // diagram mixing harmless and reading-changing rewrites of one kind reports
  // each line of that kind.
  const candidates = [...lineChanges.values()].flat()
  const kinds = [...new Set(candidates.map(change => change.reason))]
  let changing = kinds.filter(reason => changesReading(source, candidates.filter(change => change.reason === reason), authored, htmlLabels))
  if (changing.length === 0 && kinds.length > 1 && changesReading(source, candidates, authored, htmlLabels)) changing = kinds
  const lines = new Map<number, string[]>()
  for (const [line, changes] of lineChanges) {
    const reported = changing.filter(reason => changes.some(change => change.reason === reason))
    if (reported.length > 0) lines.set(line, reported.map(reason => reason === 'html-attribute-quotes' ? 'rewrites double-quoted HTML-like attributes to single quotes' : 'removes a style/classDef semicolon'))
  }
  return [...lines].sort(([a], [b]) => a - b).map(([line, reasons]) => ({
    code: 'UNSUPPORTED_SYNTAX', syntax: 'mermaid_cleanup', line,
    message: `Mermaid's cleanup changed this line: it ${[...reasons].join(' and ')} before parsing. Agentic Mermaid retains the authored text; use entity codes for literal punctuation when exporting to Mermaid.`,
  }))
}
