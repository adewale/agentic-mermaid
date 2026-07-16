// ============================================================================
// parseRegisteredMermaid: source → ParsedDiagram (multi-error).
//
// v4 sequence fidelity: parseSequenceBody returns null if it encounters ANY
// non-blank, non-comment line it doesn't fully understand. parse then falls
// back to an opaque body (lossless round-trip via canonicalSource) rather
// than silently dropping the unrecognized construct.
// ============================================================================

import { normalizeMermaidSource } from '../mermaid-source.ts'
import { decodeXML } from 'entities'
import {
  classifyMermaidFamilyDescriptorFromFirstLine,
  familyDetectionDiagnostic,
} from '../family-detection.ts'
import { serializeMermaid } from './serialize.ts'
import { attachAccessibilityToBody } from './accessibility-envelope.ts'
import type {
  ParsedDiagram, ExtensionValidDiagram, PreservedValidDiagram, ParseError, Result, ValidDiagram, ValidDiagramMeta,
  SourceMap, SourceComment,
} from './types.ts'
import { ok, err } from './types.ts'
import { assertJsonConfigAdmission } from '../shared/json-config-admission.ts'
import { isBuiltinFamilyId } from './families.ts'

// Re-exports for callers/tests that used the previous in-tree parser homes.
export { parseSequenceBody } from './sequence-body.ts'
export { parseTimelineBody } from './timeline-body.ts'

const COMMENT_LINE_REGEX = /^\s*%%(?!\{)\s*(.*)$/

/** Copy descriptor-owned JSON into a core-owned graph without invoking
 * accessors during the copy. Shared references remain shared; the admission
 * pass rejects cycles before the snapshot is published. */
function snapshotExtensionJson(value: unknown): unknown {
  const clones = new WeakMap<object, object>()
  const clone = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate !== 'object') return candidate
    const existing = clones.get(candidate)
    if (existing) return existing

    if (Array.isArray(candidate)) {
      const output: unknown[] = new Array(candidate.length)
      clones.set(candidate, output)
      const descriptors = Object.getOwnPropertyDescriptors(candidate)
      for (const key of Reflect.ownKeys(candidate)) {
        if (key === 'length') continue
        if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= candidate.length) {
          throw new TypeError('extension data arrays must not define custom properties')
        }
      }
      for (let index = 0; index < candidate.length; index++) {
        const descriptor = descriptors[String(index)]
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          throw new TypeError('extension data arrays must contain only enumerable data properties')
        }
        output[index] = clone(descriptor.value)
      }
      return output
    }

    const output: Record<string, unknown> = {}
    clones.set(candidate, output)
    const descriptors = Object.getOwnPropertyDescriptors(candidate)
    for (const key of Reflect.ownKeys(candidate)) {
      if (typeof key !== 'string') throw new TypeError('extension data must not contain symbol keys')
      const descriptor = descriptors[key]
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        throw new TypeError('extension data objects must contain only enumerable data properties')
      }
      Object.defineProperty(output, key, {
        value: clone(descriptor.value),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return output
  }

  const snapshot = clone(value)
  // Re-admit the exact graph we will publish. This also catches a cycle copied
  // through a shared reference and keeps the snapshot helper subordinate to
  // the one public JSON admission authority.
  assertJsonConfigAdmission(snapshot, 'Extension family parse body.data snapshot')
  const freeze = (candidate: unknown, seen = new WeakSet<object>()): void => {
    if (candidate === null || typeof candidate !== 'object' || seen.has(candidate)) return
    seen.add(candidate)
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(candidate))) {
      if ('value' in descriptor) freeze(descriptor.value, seen)
    }
    Object.freeze(candidate)
  }
  freeze(snapshot)
  return snapshot
}

function admittedExtensionData(value: unknown, family: string): unknown {
  assertJsonConfigAdmission(value, `Family "${family}" parse body.data`)
  return snapshotExtensionJson(value)
}

function semanticFamilyLineSource(
  source: string,
  familyLineBoundary: number,
): { readonly source: string; readonly authoredHeader: string } {
  const lineStart = Math.max(0, Math.min(source.length, familyLineBoundary))
  const newline = source.indexOf('\n', lineStart)
  const physicalEnd = newline < 0 ? source.length : newline
  const lineEnd = source.charCodeAt(physicalEnd - 1) === 13 ? physicalEnd - 1 : physicalEnd
  const line = source.slice(lineStart, lineEnd)
  const authoredHeader = line.trim()
  if (!authoredHeader) return { source, authoredHeader }
  const relativeStart = line.indexOf(authoredHeader)
  const headerStart = lineStart + relativeStart
  const headerEnd = headerStart + authoredHeader.length
  const semanticHeader = decodeXML(authoredHeader)
  return {
    source: semanticHeader === authoredHeader
      ? source
      : `${source.slice(0, headerStart)}${semanticHeader}${source.slice(headerEnd)}`,
    authoredHeader,
  }
}

/** Descriptor-dispatched parser with a forward-compatible extension envelope. */
export function parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]> {
  const errors: ParseError[] = []
  // Normalize once and reuse its frontmatter in extractMeta, rather than
  // re-running the full preprocess a second time just for frontmatter.
  const authoredEnvelope = normalizeMermaidSource(source)
  const familyLineBoundary = authoredEnvelope.wrapperSource?.length ?? 0
  const familyLine = semanticFamilyLineSource(source, familyLineBoundary)
  const normalizedSemanticSource = familyLine.source === source
    ? authoredEnvelope
    : normalizeMermaidSource(familyLine.source)
  const semanticHeader = normalizedSemanticSource.lines[0] ?? normalizedSemanticSource.firstLine
  // Public parsing historically preserves entities in labels, titles and
  // accessibility text. Decode only the family line needed for routing and
  // grammar selection; the render waist decodes the complete serialized
  // source later. This gives `flowchart&#32;LR` parse/render parity without
  // silently changing the parse/serialize data contract for diagram content.
  const normalized = normalizedSemanticSource === authoredEnvelope
    ? authoredEnvelope
    : {
        ...normalizedSemanticSource,
        originalText: source,
        ...(authoredEnvelope.wrapperSource !== undefined
          ? { wrapperSource: authoredEnvelope.wrapperSource }
          : { wrapperSource: undefined }),
      }
  const meta = extractMeta(authoredEnvelope)
  const canonicalSource = authoredEnvelope.text
  // For opaque bodies, preserve original indentation/blank lines so the
  // serializer can re-emit the untouched body. canonicalSource at the
  // ValidDiagram level remains the normalized (line-trimmed) form used by
  // the built-in renderer paths.
  const opaqueSource = authoredEnvelope.body

  if (normalized.lines.length === 0) {
    errors.push({ code: 'EMPTY', message: 'Empty diagram' })
    return err(errors)
  }

  const header = semanticHeader
  const detection = classifyMermaidFamilyDescriptorFromFirstLine(header, 'loose')
  if (detection.kind !== 'registered') {
    const diagnostic = familyDetectionDiagnostic(
      detection,
      source,
      familyLineBoundary,
      familyLine.authoredHeader,
    )
    const preservation = diagnostic.preservation
    const kind = (detection.kind === 'upstream'
      ? `family:upstream/${detection.match.family.id}`
      : 'family:unknown') as import('./types.ts').ExternalFamilyId
    const diagram: PreservedValidDiagram = {
      kind,
      meta,
      body: {
        kind: 'preserved',
        representation: preservation.classification === 'unknown' ? 'unknown' : 'opaque',
        source,
        preservation,
        spans: preservation.spans!,
        diagnostic: {
          code: diagnostic.code,
          message: diagnostic.message,
          help: diagnostic.help,
        },
      },
      source: emptySourceMap(),
      canonicalSource,
    }
    return ok(diagram)
  }
  const plugin = detection.family
  const kind = plugin.id

  // BUILD-3: every family dispatches through its FamilyDescriptor.parse hook —
  // structured-or-opaque for the narrow families, error semantics for
  // flowchart/state. Families without a hook stay source-level.
  if (plugin.parse) {
    const parsed = plugin.parse({
      source: normalized,
      lines: normalized.familyLines,
      envelopeLines: normalized.lines,
      opaqueSource,
      meta,
      canonicalSource,
    })
    if (!parsed.ok) {
      errors.push(...parsed.error)
      return err(errors)
    }
    if (parsed.value.kind === 'preserved') {
      return err([{
        code: 'FAMILY_DESCRIPTOR_CONTRACT',
        message: `Registered family "${kind}" cannot return a core preserved-family envelope`,
        line: 1,
      }])
    }
    if (!isBuiltinFamilyId(kind)) {
      if (parsed.value.kind !== 'extension' || parsed.value.family !== kind) {
        return err([{
          code: 'FAMILY_DESCRIPTOR_CONTRACT',
          message: `Family "${kind}" parse hook must return an extension body for the same family`,
          line: 1,
        }])
      }
      let data: unknown
      if (parsed.value.data !== undefined) {
        try {
          data = admittedExtensionData(parsed.value.data, kind)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          return err([{
            code: 'FAMILY_DESCRIPTOR_CONTRACT',
            message: `Family "${kind}" parse hook returned invalid body.data: ${reason}`,
            line: 1,
          }])
        }
      }
      const diagram: ExtensionValidDiagram = {
        kind,
        descriptorIdentity: plugin.identity,
        meta,
        // Exact authored post-wrapper source is core-owned. A descriptor may
        // attach opaque structured data, but cannot silently weaken the
        // source-preservation contract by returning a lossy source field.
        body: Object.freeze({
          kind: 'extension',
          family: kind,
          source: opaqueSource,
          ...(data === undefined ? {} : { data }),
        }),
        source: emptySourceMap(),
        canonicalSource,
      }
      return ok(diagram)
    }
    if (parsed.value.kind === 'extension') {
      return err([{
        code: 'FAMILY_DESCRIPTOR_CONTRACT',
        message: `Built-in family "${kind}" cannot return an extension body`,
        line: 1,
      }])
    }
    attachUniversalAccessibility(parsed.value, meta)
    const sourceMap = plugin.buildSourceMap?.(parsed.value, canonicalSource) ?? emptySourceMap()
    const diagram: ValidDiagram = { kind, meta, body: parsed.value, source: sourceMap, canonicalSource }
    markDroppedComments(diagram, normalized.body)
    return ok(diagram)
  }

  if (isBuiltinFamilyId(kind)) {
    return ok<ParsedDiagram>({
      kind, meta, body: { kind: 'opaque', family: kind, source: opaqueSource }, source: emptySourceMap(), canonicalSource,
    })
  }
  return ok<ParsedDiagram>({
    kind,
    descriptorIdentity: plugin.identity,
    meta,
    body: { kind: 'extension', family: kind, source: opaqueSource },
    source: emptySourceMap(),
    canonicalSource,
  })
}

function attachUniversalAccessibility(body: import('./types.ts').DiagramBody, meta: ValidDiagramMeta): void {
  attachAccessibilityToBody(body, meta.accessibility)
}

/**
 * 2C comment policy: structured bodies serialize to canonical source, which
 * does not model `%%` comment lines. Rather than dropping them *silently*,
 * diff the parsed comments against what actually survives serialization
 * (wrapper comments ride along verbatim via meta.wrapperSource; sequence
 * opaque segments may preserve in-body comments) and record the casualties so
 * verify can surface the Tier 3 COMMENT_DROPPED lint. Opaque bodies preserve
 * everything and never reach here.
 */
function markDroppedComments(diagram: ValidDiagram, sourceBody: string): void {
  const comments = diagram.meta.comments
  if (diagram.body.kind === 'opaque' || comments.length === 0) return

  const sourceLines = sourceBody.split(/\r?\n/).map(line => line.trim())
  const serializedLines = serializeMermaid(diagram).split(/\r?\n/).map(line => line.trim())
  const keptSourceLines = longestCommonSubsequenceIndices(sourceLines, serializedLines)
  const keptCommentLines = new Set<number>()
  for (const sourceIndex of keptSourceLines) {
    if (COMMENT_LINE_REGEX.test(sourceLines[sourceIndex]!)) keptCommentLines.add(sourceIndex + 1)
  }

  const dropped: SourceComment[] = comments.filter(comment => !keptCommentLines.has(comment.line))
  if (dropped.length > 0) diagram.meta.droppedComments = dropped
}

function longestCommonSubsequenceIndices(a: string[], b: string[]): number[] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const indices: number[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      indices.push(i)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return indices
}

// ---- Meta extraction -----------------------------------------------------

function extractMeta(
  normalized: ReturnType<typeof normalizeMermaidSource>,
  authoredWrapperSource = normalized.wrapperSource,
): ValidDiagramMeta {
  return {
    initDirectives: normalized.initDirectives as ValidDiagramMeta['initDirectives'],
    comments: normalized.comments,
    accessibility: normalized.accessibility,
    ...(authoredWrapperSource !== undefined ? { wrapperSource: authoredWrapperSource } : {}),
    ...(Object.keys(normalized.frontmatter).length > 0
      ? { frontmatter: normalized.frontmatter as ValidDiagramMeta['frontmatter'] }
      : {}),
  }
}

function emptySourceMap(): SourceMap {
  return { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
}
