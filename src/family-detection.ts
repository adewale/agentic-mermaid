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

function sourcePointAt(source: string, offset: number): SourceSpanPoint {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < offset; index++) {
    if (source.charCodeAt(index) === 10) {
      line++
      lineStart = index + 1
    }
  }
  return Object.freeze({ offset, line, col: offset - lineStart + 1 })
}

function sourceSpan(source: string, start: number, end: number): SourceSpan {
  return Object.freeze({ start: sourcePointAt(source, start), end: sourcePointAt(source, end) })
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
    if (trimmed === header) {
      const relativeStart = raw.indexOf(header)
      headerStart = lineStart + relativeStart
      headerEnd = headerStart + header.length
      payloadStart = newline < 0 ? source.length : newline + 1
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
    source: sourceSpan(source, 0, source.length),
    ...(lineStart > 0 ? { wrapper: sourceSpan(source, 0, lineStart) } : {}),
    header: sourceSpan(source, headerStart, headerEnd),
    body: sourceSpan(source, payloadStart, source.length),
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
