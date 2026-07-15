import {
  detectRegisteredFamilyDescriptorFromFirstLine,
} from './agent/families.ts'
import type { FamilyDescriptor } from './agent/families.ts'
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
  const family = detectRegisteredFamilyDescriptorFromFirstLine(firstLine, mode)
  if (family) return { kind: 'registered', family }
  const upstream = findUpstreamFamilyByHeader(firstLine)
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
    if (source.charCodeAt(index) === 10) starts.push(index + 1)
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
): readonly SourceSpan[] {
  const body = source.slice(bodyStart)
  const blocks = matchingSpans(
    body,
    // Stop at the closing brace. A family statement may legally follow that
    // brace on the same physical line and must remain visible to source maps.
    /^[ \t]*accDescr\s*:?\s*\{[\s\S]*?\}/gmi,
    bodyStart,
    lineStarts,
  )
  const lines = matchingSpans(
    body,
    /^[ \t]*(?:accTitle(?:\s*:\s*|\s+).*|accDescr(?!\s*:?\s*\{)(?:\s*:\s*|\s+).*)(?:\r?\n|$)/gmi,
    bodyStart,
    lineStarts,
  )
  let blockIndex = 0
  const uncoveredLines: SourceSpan[] = []
  for (const line of lines) {
    while (blocks[blockIndex] && blocks[blockIndex]!.end.offset <= line.start.offset) blockIndex++
    const block = blocks[blockIndex]
    if (block && line.start.offset >= block.start.offset && line.end.offset <= block.end.offset) continue
    uncoveredLines.push(line)
  }
  const merged: SourceSpan[] = []
  let blockCursor = 0
  let lineCursor = 0
  while (blockCursor < blocks.length || lineCursor < uncoveredLines.length) {
    if (lineCursor >= uncoveredLines.length
      || (blockCursor < blocks.length && blocks[blockCursor]!.start.offset <= uncoveredLines[lineCursor]!.start.offset)) {
      merged.push(blocks[blockCursor++]!)
    } else {
      merged.push(uncoveredLines[lineCursor++]!)
    }
  }
  return Object.freeze(merged)
}

function universalDirectiveSpans(
  source: string,
  bodyStart: number,
  lineStarts = sourceLineStarts(source),
): Pick<
  PreservedSourceSpans,
  'frontmatter' | 'initDirectives' | 'accessibilityDirectives'
> {
  const frontmatter = source.match(/^\uFEFF?\s*---\s*\r?\n[\s\S]*?\r?\n\s*---\s*(?:\r?\n|$)/)
  const frontmatterEnd = frontmatter ? frontmatter.index! + frontmatter[0].length : 0
  const initDirectives = matchingSpans(
    // Source normalization recognizes init/initialize directives anywhere
    // after frontmatter, not only in the leading wrapper. Trace the same
    // admitted directives so meta.initDirectives and preserved spans cannot
    // disagree for an in-body directive.
    source.slice(frontmatterEnd),
    /^[ \t]*%%\{\s*(?:init|initialize)\s*:[\s\S]*?\}\s*%%[ \t]*(?:\r?\n|$)/gmi,
    frontmatterEnd,
    lineStarts,
  )
  const accessibilityDirectives = accessibilityDirectiveSpans(source, bodyStart, lineStarts)
  return {
    ...(frontmatter
      ? { frontmatter: sourceSpan(lineStarts, frontmatter.index!, frontmatter.index! + frontmatter[0].length) }
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
    const newline = source.indexOf('\n', lineStart)
    const lineEnd = newline < 0 ? source.length : newline
    const raw = source.slice(lineStart, lineEnd).replace(/\r$/, '')
    // String trimming already treats U+FEFF as whitespace. Locate the header
    // in the untouched line instead of adding a second BOM offset.
    const trimmed = raw.trim()
    if (trimmed === header || (trimmed.startsWith(header) && /^\s*;/.test(trimmed.slice(header.length)))) {
      const relativeStart = raw.indexOf(header)
      headerStart = lineStart + relativeStart
      headerEnd = headerStart + header.length
      if (trimmed === header) {
        payloadStart = newline < 0 ? source.length : newline + 1
      } else {
        const semicolon = raw.indexOf(';', relativeStart + header.length)
        payloadStart = semicolon + 1
        while (payloadStart < lineEnd && /[ \t]/.test(source[payloadStart]!)) payloadStart++
      }
      break
    }
    if (newline < 0) break
    lineStart = newline + 1
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
    ...universalDirectiveSpans(source, payloadStart, lineStarts),
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
