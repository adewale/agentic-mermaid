import type { FamilyDescriptor } from './agent/families.ts'
import { detectInstalledFamilyDescriptorFromFirstLine, installedFamilyStatementEnds } from './agent/family-router.ts'
import type {
  FamilyId,
  PreservedDiagramBody,
  PreservedSourceSpans,
  SourcePreservationReceipt,
  SourceSpan,
  SourceSpanPoint,
} from './agent/types.ts'
import {
  findUpstreamFamilyByHeader,
  UPSTREAM_MERMAID_FAMILY_INDEX,
  type UpstreamHeaderMatch,
} from './upstream-family-index.ts'
import { matchMermaidFrontmatter, splitHeaderStatement } from './mermaid-source-wrapper.ts'
import { parseAccessibilityDirective, statementEndAt } from './shared/accessibility-directives.ts'

export type MermaidFamilyClassification =
  | { kind: 'registered'; familyId: FamilyId }
  | { kind: 'upstream'; match: UpstreamHeaderMatch }
  | { kind: 'unknown'; header: string }

type MermaidFamilyDescriptorClassification =
  | { kind: 'registered'; family: FamilyDescriptor }
  | { kind: 'upstream'; match: UpstreamHeaderMatch }
  | { kind: 'unknown'; header: string }

/** Internal descriptor-bearing classification captures one immutable registry
 * snapshot across detection and dispatch. */
export function classifyMermaidFamilyDescriptorFromFirstLine(
  firstLine: string,
  mode: 'strict' | 'loose' = 'strict',
): MermaidFamilyDescriptorClassification {
  // Mermaid comments are inert even when appended to a family declaration.
  // Keep authored bytes separately for provenance and diagnostics.
  const semanticFirstLine = firstLine.replace(/%%.*$/, '').trim()
  const family = detectInstalledFamilyDescriptorFromFirstLine(semanticFirstLine, mode)
  if (family) return { kind: 'registered', family }
  const upstream = findUpstreamFamilyByHeader(semanticFirstLine)
  if (upstream) return { kind: 'upstream', match: upstream }
  return { kind: 'unknown', header: firstLine }
}

export interface FamilyDetectionDiagnostic {
  code: 'UNSUPPORTED_FAMILY' | 'UNKNOWN_HEADER' | 'FAMILY_DESCRIPTOR_MISMATCH'
  message: string
  line: 1
  preservation: SourcePreservationReceipt
  help: string
}

function sourceLineStarts(source: string): readonly number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 13) {
      if (source.charCodeAt(index + 1) === 10) index++
      starts.push(index + 1)
    } else if (source.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

function sourcePointAt(lineStarts: readonly number[], offset: number): SourceSpanPoint {
  let low = 0
  let high = lineStarts.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (lineStarts[middle]! <= offset) low = middle + 1
    else high = middle
  }
  const lineIndex = Math.max(0, low - 1)
  return Object.freeze({ offset, line: lineIndex + 1, col: offset - lineStarts[lineIndex]! + 1 })
}

function sourceSpan(lineStarts: readonly number[], start: number, end: number): SourceSpan {
  return Object.freeze({ start: sourcePointAt(lineStarts, start), end: sourcePointAt(lineStarts, end) })
}

function matchingSpans(
  source: string,
  expression: RegExp,
  baseOffset = 0,
  lineStarts = sourceLineStarts(source),
): readonly SourceSpan[] {
  const spans: SourceSpan[] = []
  const regex = new RegExp(expression.source, expression.flags.includes('g') ? expression.flags : `${expression.flags}g`)
  let match: RegExpExecArray | null
  while ((match = regex.exec(source)) !== null) {
    spans.push(sourceSpan(lineStarts, baseOffset + match.index, baseOffset + match.index + match[0].length))
    if (match[0].length === 0) regex.lastIndex++
  }
  return Object.freeze(spans)
}

function accessibilityDirectiveSpans(
  source: string,
  bodyStart: number,
  lineStarts = sourceLineStarts(source),
  header = source.slice(bodyStart).trimStart().split(/\r\n?|\n/, 1)[0]!,
): readonly SourceSpan[] {
  const physical = [...source.slice(bodyStart).matchAll(/[^\r\n]*(?:\r\n?|\n|$)/g)]
  const physicalLines = physical.map(match => match[0])
  const lines = physicalLines.map(line => line.replace(/[\r\n]+$/, ''))
  const offsets = physical.map(match => bodyStart + match.index)
  const spans: SourceSpan[] = []
  // A line inside a statement's quoted text is the family's, as in source
  // normalization.
  const statementEnds = installedFamilyStatementEnds(header, lines)
  for (let index = 0; index < lines.length; index++) {
    const directive = parseAccessibilityDirective(lines, index)
    // An unclosed block consumes the remainder of the source. Continuing
    // would rescan that suffix for every later opener (quadratic work).
    if (directive === undefined) break
    if (directive === null) {
      index = statementEndAt(statementEnds, index, lines.length)
      continue
    }
    const start = offsets[index]!
    let end: number
    if (directive.form === 'block') {
      // Stop at the first closing brace. A family statement after it stays
      // visible to source maps, exactly as it does to source normalization.
      end = offsets[directive.endIndex]! + lines[directive.endIndex]!.indexOf('}') + 1
    } else {
      end = start + physicalLines[index]!.length
    }
    spans.push(sourceSpan(lineStarts, start, end))
    index = directive.endIndex
  }
  return Object.freeze(spans)
}

function universalDirectiveSpans(
  source: string,
  bodyStart: number,
  header: string,
  lineStarts = sourceLineStarts(source),
): Pick<
  PreservedSourceSpans,
  'frontmatter' | 'initDirectives' | 'accessibilityDirectives'
> {
  const frontmatter = matchMermaidFrontmatter(source)
  const frontmatterEnd = frontmatter?.source.length ?? 0
  const initDirectives = matchingSpans(
    // Source normalization recognizes init/initialize directives anywhere
    // after frontmatter, not only in the leading wrapper. Trace the same
    // admitted directives so meta.initDirectives and preserved spans cannot
    // disagree for an in-body directive.
    source.slice(frontmatterEnd),
    /^[ \t]*%%\{\s*(?:init|initialize)\s*:[\s\S]*?\}\s*%%[ \t]*(?:\r\n?|\n|$)/gmi,
    frontmatterEnd,
    lineStarts,
  )
  const accessibilityDirectives = accessibilityDirectiveSpans(source, bodyStart, lineStarts, header)
  return {
    ...(frontmatter
      ? { frontmatter: sourceSpan(lineStarts, 0, frontmatterEnd) }
      : {}),
    ...(initDirectives.length > 0 ? { initDirectives } : {}),
    ...(accessibilityDirectives.length > 0 ? { accessibilityDirectives: Object.freeze(accessibilityDirectives) } : {}),
  }
}

/** Blank accessibility directives without changing line/column coordinates. */
export function maskAccessibilityDirectivesForSourceMap(source: string): string {
  const chars = source.split('')
  const lineStarts = sourceLineStarts(source)
  for (const directive of accessibilityDirectiveSpans(source, 0, lineStarts)) {
    for (let offset = directive.start.offset; offset < directive.end.offset; offset++) {
      if (chars[offset] !== '\n' && chars[offset] !== '\r') chars[offset] = ' '
    }
  }
  return chars.join('')
}

/** Locate the detected family line without normalizing or discarding authored bytes.
 * `familyLineBoundary` is the exact end of the universal wrapper already
 * identified by source normalization. Starting there prevents header-shaped
 * YAML values from being mistaken for the diagram header. */
export function sourcePreservationSpans(
  source: string,
  header: string,
  familyLineBoundary = 0,
): PreservedSourceSpans {
  const lineStarts = sourceLineStarts(source)
  let headerStart = -1
  let headerEnd = -1
  let payloadStart = source.length
  const searchStart = Math.max(0, Math.min(source.length, familyLineBoundary))
  let lineStart = searchStart
  while (lineStart <= source.length) {
    const lineBreak = /\r\n?|\n/g
    lineBreak.lastIndex = lineStart
    const ending = lineBreak.exec(source)
    const newline = ending?.index ?? -1
    const lineEnd = newline < 0 ? source.length : newline
    const raw = source.slice(lineStart, lineEnd).replace(/\r$/, '')
    // String trimming already treats U+FEFF as whitespace. Locate the header
    // in the untouched line instead of adding a second BOM offset.
    const trimmed = raw.trim()
    // A statement may follow the header on its line, after `;` or, where the
    // family's grammar reads one there, a space; it belongs to the body.
    const suffix = trimmed.startsWith(header) ? trimmed.slice(header.length) : ''
    const semicolon = /^\s*;/.test(suffix)
    if (trimmed === header || semicolon || (/^\s/.test(suffix) && splitHeaderStatement(trimmed) !== trimmed)) {
      const relativeStart = raw.indexOf(header)
      headerStart = lineStart + relativeStart
      headerEnd = headerStart + header.length
      if (trimmed === header) {
        payloadStart = ending ? ending.index + ending[0].length : source.length
      } else {
        payloadStart = semicolon ? source.indexOf(';', headerEnd) + 1 : headerEnd
        while (payloadStart < lineEnd && /[ \t]/.test(source[payloadStart]!)) payloadStart++
      }
      break
    }
    if (newline < 0) break
    lineStart = ending!.index + ending![0].length
  }
  if (headerStart < 0) {
    const fallback = source.indexOf(header, searchStart)
    headerStart = fallback < 0 ? searchStart : fallback
    headerEnd = Math.min(source.length, headerStart + header.length)
    const newline = source.indexOf('\n', headerEnd)
    payloadStart = newline < 0 ? source.length : newline + 1
    lineStart = headerStart
    while (lineStart > 0 && source.charCodeAt(lineStart - 1) !== 10) lineStart--
  }
  return Object.freeze({
    source: sourceSpan(lineStarts, 0, source.length),
    ...(lineStart > 0 ? { wrapper: sourceSpan(lineStarts, 0, lineStart) } : {}),
    ...universalDirectiveSpans(source, payloadStart, header, lineStarts),
    header: sourceSpan(lineStarts, headerStart, headerEnd),
    body: sourceSpan(lineStarts, payloadStart, source.length),
  })
}

export function classifyMermaidFamilyFromFirstLine(
  firstLine: string,
  mode: 'strict' | 'loose' = 'strict',
): MermaidFamilyClassification {
  const classification = classifyMermaidFamilyDescriptorFromFirstLine(firstLine, mode)
  return classification.kind === 'registered'
    ? { kind: 'registered', familyId: classification.family.id }
    : classification
}

export function familyDetectionDiagnostic(
  classification: Exclude<MermaidFamilyClassification, { kind: 'registered' }>,
  source: string,
  familyLineBoundary = 0,
  authoredHeader?: string,
): FamilyDetectionDiagnostic {
  const mermaidVersion = UPSTREAM_MERMAID_FAMILY_INDEX.provenance.version
  if (classification.kind === 'unknown') {
    return {
      code: 'UNKNOWN_HEADER',
      message: `Unrecognized Mermaid header: "${classification.header}"`,
      line: 1,
      preservation: {
        version: 1,
        classification: 'unknown',
        source,
        header: classification.header,
        mermaidVersion,
        spans: sourcePreservationSpans(source, authoredHeader ?? classification.header, familyLineBoundary),
      },
      help: 'Check for a Mermaid upgrade or register a namespaced family descriptor; the source was preserved unchanged.',
    }
  }

  const { family, header } = classification.match
  const preservationClass = header.agenticStatus === 'inventory-only' ? 'inventory-only' : 'unsupported'
  const nativeMismatch = header.agenticStatus === 'native'
  return {
    code: nativeMismatch ? 'FAMILY_DESCRIPTOR_MISMATCH' : 'UNSUPPORTED_FAMILY',
    message: nativeMismatch
      ? `Mermaid ${mermaidVersion} header "${header.value}" is marked native but no installed family descriptor claimed it`
      : `Mermaid ${mermaidVersion} family "${family.id}" is ${preservationClass} in Agentic Mermaid`,
    line: 1,
    preservation: {
      version: 1,
      classification: preservationClass,
      source,
      header: header.value,
      upstreamFamilyId: family.id,
      mermaidVersion,
      spans: sourcePreservationSpans(source, authoredHeader ?? header.value, familyLineBoundary),
    },
    help: nativeMismatch
      ? 'Report a descriptor/manifest mismatch; the source was preserved unchanged.'
      : `Install a family descriptor for "${header.value}" or use a currently native family; the source was preserved unchanged.`,
  }
}

export function familyDetectionDiagnosticFromPreservedBody(
  body: PreservedDiagramBody,
): FamilyDetectionDiagnostic {
  return {
    code: body.diagnostic.code,
    message: body.diagnostic.message,
    line: 1,
    preservation: body.preservation,
    help: body.diagnostic.help,
  }
}

export class MermaidFamilyDetectionError extends Error {
  readonly name = 'MermaidFamilyDetectionError'
  readonly code: FamilyDetectionDiagnostic['code']
  readonly line: 1
  readonly preservation: SourcePreservationReceipt
  readonly help: string

  constructor(diagnostic: FamilyDetectionDiagnostic) {
    super(diagnostic.message)
    this.code = diagnostic.code
    this.line = diagnostic.line
    this.preservation = diagnostic.preservation
    this.help = diagnostic.help
  }

  toJSON(): FamilyDetectionDiagnostic {
    return {
      code: this.code,
      message: this.message,
      line: this.line,
      preservation: this.preservation,
      help: this.help,
    }
  }
}

export function requireRegisteredMermaidFamily(
  firstLine: string,
  source: string,
  mode: 'strict' | 'loose' = 'strict',
  familyLineBoundary = 0,
): FamilyId {
  return requireRegisteredMermaidFamilyDescriptor(firstLine, source, mode, familyLineBoundary).id
}

export function requireRegisteredMermaidFamilyDescriptor(
  firstLine: string,
  source: string,
  mode: 'strict' | 'loose' = 'strict',
  familyLineBoundary = 0,
  authoredHeader?: string,
): FamilyDescriptor {
  const classification = classifyMermaidFamilyDescriptorFromFirstLine(firstLine, mode)
  if (classification.kind === 'registered') return classification.family
  throw new MermaidFamilyDetectionError(
    familyDetectionDiagnostic(classification, source, familyLineBoundary, authoredHeader),
  )
}
