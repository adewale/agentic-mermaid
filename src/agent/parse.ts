// ============================================================================
// parseMermaid: source → ValidDiagram (multi-error).
//
// v4 sequence fidelity: parseSequenceBody returns null if it encounters ANY
// non-blank, non-comment line it doesn't fully understand. parse then falls
// back to an opaque body (lossless round-trip via canonicalSource) rather
// than silently dropping the unrecognized construct.
// ============================================================================

import { normalizeMermaidSource } from '../mermaid-source.ts'
import { getFamily, isBuiltinFamilyId } from './families.ts'
import { classifyMermaidFamilyFromFirstLine, familyDetectionDiagnostic } from '../family-detection.ts'
import './families-builtin.ts'  // registers built-in family parse/serialize/mutate hooks
import { serializeMermaid } from './serialize.ts'
import { UPSTREAM_MERMAID_FAMILY_INDEX } from '../upstream-family-index.ts'
import { attachAccessibilityToBody } from './accessibility-envelope.ts'
import type {
  ValidDiagram, ParsedDiagram, ExtensionValidDiagram, ParseError, Result, ValidDiagramMeta,
  SourceMap, SourceComment,
} from './types.ts'
import { ok, err } from './types.ts'

// Re-exports for callers/tests that used the previous in-tree parser homes.
export { parseSequenceBody } from './sequence-body.ts'
export { parseTimelineBody } from './timeline-body.ts'

const COMMENT_LINE_REGEX = /^\s*%%(?!\{)\s*(.*)$/

/** Backward-compatible built-in parser. Use parseRegisteredMermaid for open family ids. */
export function parseMermaid(source: string): Result<ValidDiagram, ParseError[]> {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) return err(parsed.error)
  if (isBuiltinParsedDiagram(parsed.value)) return ok(parsed.value)
  return err([{
    code: 'EXTENSION_PARSE_REQUIRES_OPEN_ENVELOPE',
    message: `Installed family "${parsed.value.kind}" parsed successfully through its descriptor, but this compatibility entrypoint returns built-in bodies only`,
    line: 1,
    preservation: {
      version: 1,
      classification: 'unsupported',
      source,
      header: parsed.value.canonicalSource.split(/\r?\n/, 1)[0] ?? '',
      upstreamFamilyId: parsed.value.kind,
      mermaidVersion: UPSTREAM_MERMAID_FAMILY_INDEX.provenance.version,
    },
    help: 'Call parseRegisteredMermaid to receive the namespaced extension body envelope.',
  }])
}

function isBuiltinParsedDiagram(diagram: ParsedDiagram): diagram is ValidDiagram {
  return isBuiltinFamilyId(diagram.kind)
}

/** Descriptor-dispatched parser with a forward-compatible extension envelope. */
export function parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]> {
  const errors: ParseError[] = []
  // Normalize once and reuse its frontmatter in extractMeta, rather than
  // re-running the full preprocess a second time just for frontmatter.
  const normalized = normalizeMermaidSource(source)
  const meta = extractMeta(normalized)
  const canonicalSource = normalized.text
  // For opaque bodies, preserve original indentation/blank lines so the
  // serializer can re-emit the untouched body. canonicalSource at the
  // ValidDiagram level remains the normalized (line-trimmed) form for
  // back-compat with the existing flowchart/legacy paths.
  const opaqueSource = normalized.body

  if (normalized.lines.length === 0) {
    errors.push({ code: 'EMPTY', message: 'Empty diagram' })
    return err(errors)
  }

  const header = normalized.lines[0]!
  const detection = classifyMermaidFamilyFromFirstLine(header, 'loose')
  if (detection.kind !== 'registered') {
    errors.push(familyDetectionDiagnostic(detection, source))
    return err(errors)
  }
  const kind = detection.familyId

  // BUILD-3: every family dispatches through its FamilyPlugin.parse hook —
  // structured-or-opaque for the narrow families, error semantics for
  // flowchart/state. Families without a hook stay source-level.
  const plugin = getFamily(kind)
  if (plugin?.parse) {
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
    if (!isBuiltinFamilyId(kind)) {
      if (parsed.value.kind !== 'extension' || parsed.value.family !== kind) {
        return err([{
          code: 'FAMILY_DESCRIPTOR_CONTRACT',
          message: `Family "${kind}" parse hook must return an extension body for the same family`,
          line: 1,
        }])
      }
      const diagram: ExtensionValidDiagram = {
        kind,
        meta,
        body: parsed.value,
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

function extractMeta(normalized: ReturnType<typeof normalizeMermaidSource>): ValidDiagramMeta {
  return {
    initDirectives: normalized.initDirectives as ValidDiagramMeta['initDirectives'],
    comments: normalized.comments,
    accessibility: normalized.accessibility,
    ...(normalized.wrapperSource !== undefined ? { wrapperSource: normalized.wrapperSource } : {}),
    ...(Object.keys(normalized.frontmatter).length > 0
      ? { frontmatter: normalized.frontmatter as ValidDiagramMeta['frontmatter'] }
      : {}),
  }
}

function emptySourceMap(): SourceMap {
  return { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
}
