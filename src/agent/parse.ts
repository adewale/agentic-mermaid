// ============================================================================
// parseRegisteredMermaid: source → ParsedDiagram (multi-error).
//
// v4 sequence fidelity: parseSequenceBody returns null if it encounters ANY
// non-blank, non-comment line it doesn't fully understand. parse then falls
// back to an opaque body (lossless round-trip via canonicalSource) rather
// than silently dropping the unrecognized construct.
// ============================================================================

import { MermaidFrontmatterError, normalizeMermaidSource, preservedMermaidFamilySource } from '../mermaid-source.ts'
import { INIT_DIRECTIVE_REGEX, MERMAID_DIRECTIVE_REGEX, splitHeaderStatement } from '../mermaid-source-wrapper.ts'
import { stripStateComment } from '../state/comment.ts'
import { stripMindmapComment } from '../mindmap/parser.ts'
import { classCommentStart, readClassStatements, type ClassStatementNode } from '../class/parser.ts'
import { tokenize as tokenizeBlock } from '../block/lexer.ts'
import { tokenize as tokenizeRequirement } from '../requirement/lexer.ts'
import { parseKanbanDiagram } from '../kanban/parser.ts'
import { readGanttStatements } from '../gantt/parser.ts'
import { statementText, trailingCommentStart } from '../shared/trailing-comment.ts'
import { parseAccessibilityDirective, statementEndAt } from '../shared/accessibility-directives.ts'
import { splitAuthoredPieTitleLine } from '../pie/source-title.ts'
import { decodeXML } from 'entities'
import {
  classifyMermaidFamilyDescriptorFromFirstLine,
  familyDetectionDiagnostic,
  familyDetectionDiagnosticFromPreservedBody,
  maskAccessibilityDirectivesForSourceMap,
  sourcePreservationSpans,
  sourceLineStarts,
  sourcePointAt,
} from '../family-detection.ts'
import { retainBodyComments } from './body-comments.ts'
import { serializeMermaid } from './serialize.ts'
import { AccessibilityTextError, attachAccessibilityToBody } from './accessibility-envelope.ts'
import type {
  ParsedDiagram, ExtensionValidDiagram, PreservedValidDiagram, ParseError, Result, ValidDiagram, ValidDiagramMeta,
  SourceMap, SourceComment,
} from './types.ts'
import { ok, err } from './types.ts'
import { assertJsonConfigAdmission, JsonConfigAdmissionError } from '../shared/json-config-admission.ts'
import { isBuiltinFamilyId, type FamilyDescriptor } from './families.ts'
import { attachSourceMapSpans, recordSourceCleanup, type SourceSpanGrammar } from './source-map-spans.ts'

// Re-exports for callers/tests that used the previous in-tree parser homes.
export { parseSequenceBody } from './sequence-body.ts'
export { parseTimelineBody } from './timeline-body.ts'

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
  family: FamilyDescriptor | null,
): { readonly source: string; readonly authoredHeader: string } {
  let lineStart = Math.max(0, Math.min(source.length, familyLineBoundary))
  // Native metadata is mutable envelope content, so it need not belong to
  // the immutable wrapper. Select the header through the classified envelope,
  // including multiline config/trivia interleaved with those fields.
  const firstLine = /^[^\r\n]*/.exec(source.slice(lineStart))![0]
  if (parseAccessibilityDirective([firstLine], 0)?.form === 'native') {
    const grammar = maskAccessibilityDirectivesForSourceMap(source, family)
      .replace(new RegExp(MERMAID_DIRECTIVE_REGEX.source, 'gm'), token => token.replace(/[^\r\n]/g, ' '))
    while (lineStart < source.length) {
      const line = /^[^\r\n]*/.exec(grammar.slice(lineStart))![0]
      if (line.trim() && !line.trimStart().startsWith('%%')) break
      lineStart += line.length
      if (source[lineStart] === '\r') lineStart++
      if (source[lineStart] === '\n') lineStart++
    }
  }
  const lineBreak = /[\r\n]/g
  lineBreak.lastIndex = lineStart
  const physicalEnd = lineBreak.exec(source)?.index ?? source.length
  const lineEnd = source.charCodeAt(physicalEnd - 1) === 13 ? physicalEnd - 1 : physicalEnd
  const rawLine = source.slice(lineStart, lineEnd)
  const stateHeader = /^\s*stateDiagram(?:-v2)?(?=$|[\s;%])/i.test(rawLine)
  const line = stateHeader ? stripStateComment(rawLine) : rawLine
  const routedSource = line === rawLine
    ? source
    : `${source.slice(0, lineStart)}${line}${source.slice(lineEnd)}`
  const authoredLine = line.trim()
  // Mermaid accepts a family declaration followed by a semicolon-delimited
  // statement on the same physical line. Only the declaration is the header;
  // the suffix belongs to the preserved body and the family grammar.
  // Pinned Pie treats every semicolon after an inline `title` as title text,
  // including ordinary punctuation and #entity; markers.
  const pieInlineTitle = splitAuthoredPieTitleLine(authoredLine, 'header')
  let semicolon = -1
  for (let index = 0; !pieInlineTitle && index < authoredLine.length; index++) {
    if (authoredLine.charCodeAt(index) !== 59) continue
    const ampersand = authoredLine.lastIndexOf('&', index)
    if (ampersand >= 0 && /^#?(?:x[0-9a-f]+|\d+|[a-z][a-z0-9]+)$/i.test(authoredLine.slice(ampersand + 1, index))) continue
    semicolon = index
    break
  }
  // So is a statement after the header and a space, where the family's
  // grammar reads one there.
  const beforeSemicolon = (semicolon >= 0 ? authoredLine.slice(0, semicolon) : authoredLine).trimEnd()
  const authoredHeader = pieInlineTitle ? beforeSemicolon : splitHeaderStatement(beforeSemicolon).split('\n')[0]!.trimEnd()
  if (!authoredHeader) return { source: routedSource, authoredHeader }
  const relativeStart = line.indexOf(authoredHeader)
  const headerStart = lineStart + relativeStart
  const headerEnd = headerStart + authoredHeader.length
  // Pie permits an inline title in its header. Decode only the grammar
  // prefix, even when XML references spell its whitespace or letters. An
  // entity-spelled space after a header is no separator (Mermaid rejects
  // `erDiagram&#32;A`), so decoding must not make it one.
  const decodedHeader = decodeXML(authoredHeader)
  const semanticHeader = pieInlineTitle
    ? `${pieInlineTitle.decodedPrefix}${pieInlineTitle.authoredTitle}`
    : splitHeaderStatement(decodedHeader) === decodedHeader ? decodedHeader : authoredHeader
  return {
    source: semanticHeader === authoredHeader
      ? routedSource
      : `${routedSource.slice(0, headerStart)}${semanticHeader}${routedSource.slice(headerEnd)}`,
    authoredHeader,
  }
}

/** Built-in families whose grammar reads a line's indentation as structure
 * (mindmap, treemap and ishikawa parentage; kanban column versus task). */
const INDENTED_GRAMMARS: ReadonlySet<string> = new Set(['mindmap', 'kanban', 'treemap', 'ishikawa'])

/** The canonical lines of an indentation-sensitive family: the same lines,
 * in the same order, as the line-trimmed form (no blank or `%%` line), each
 * keeping its indentation, so parsing the canonical source reads the same
 * tree. The header line is trimmed as in the line-trimmed form. */
function indentedCanonicalText(body: string): string {
  const lines = body.split(/\r\n?|\n/).filter(line => {
    const text = line.trim()
    return text && !text.startsWith('%%')
  }).map(line => line.trimEnd())
  if (lines.length > 0) lines[0] = lines[0]!.trimStart()
  return lines.join('\n')
}

/** Descriptor-dispatched parser with a forward-compatible extension envelope. */
export function parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]> {
  const errors: ParseError[] = []
  let capturedDetection: ReturnType<typeof classifyMermaidFamilyDescriptorFromFirstLine> | undefined
  const captureFamily = (firstLine: string): FamilyDescriptor | null => {
    const header = semanticFamilyLineSource(firstLine, 0, null).source
    capturedDetection = classifyMermaidFamilyDescriptorFromFirstLine(header, 'loose')
    return capturedDetection.kind === 'registered' ? capturedDetection.family : null
  }
  // Normalize once and reuse its frontmatter in extractMeta, rather than
  // re-running the full preprocess a second time just for frontmatter.
  let authoredEnvelope: ReturnType<typeof normalizeMermaidSource>
  try {
    authoredEnvelope = normalizeMermaidSource(source, {}, 'authored', captureFamily)
  } catch (error) {
    // Frontmatter Mermaid rejects is a parse error, not a thrown one. So is
    // config the admission refuses (a reserved key, nesting or size past its
    // bounds): a fault in the diagram's configuration, which verify reports
    // with origin config.
    if (error instanceof MermaidFrontmatterError) return err([{ code: 'INVALID_FRONTMATTER', message: error.message }])
    if (error instanceof JsonConfigAdmissionError) return err([{ code: 'CONFIG_REJECTED', message: error.message }])
    throw error
  }
  const capturedFamily = capturedDetection!.kind === 'registered' ? capturedDetection!.family : null
  const familyLineBoundary = authoredEnvelope.wrapperSource?.length ?? 0
  const familyLine = semanticFamilyLineSource(source, familyLineBoundary, capturedFamily)
  const normalizedSemanticSource = familyLine.source === source
    ? authoredEnvelope
    : normalizeMermaidSource(familyLine.source, {}, 'authored', () => capturedFamily)
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
  // A parsed diagram always has an authored wrapper boundary, even when that
  // exact prefix is empty. Keeping the empty string distinguishes “parsed
  // source with no wrapper” from synthesized payloads, which omit
  // wrapperSource and therefore request canonical wrapper synthesis.
  const meta = extractMeta(authoredEnvelope)
  const canonicalSource = capturedFamily && INDENTED_GRAMMARS.has(capturedFamily.id)
    ? indentedCanonicalText(authoredEnvelope.body)
    : authoredEnvelope.text
  const sourceMapCanonicalSource = maskAccessibilityDirectivesForSourceMap(canonicalSource, capturedFamily)
  const documentSpans = sourcePreservationSpans(
    source,
    familyLine.authoredHeader || semanticHeader,
    familyLineBoundary,
    capturedFamily,
  )
  const tracedSourceMap = (map: SourceMap, grammar?: SourceSpanGrammar): SourceMap => {
    if (authoredEnvelope.cleanup) recordSourceCleanup(map, authoredEnvelope.cleanup)
    return attachSourceMapSpans(map, canonicalSource, source, documentSpans, grammar)
  }
  // Opaque and extension bodies own the exact authored bytes AFTER the leading
  // wrapper. The wrapper is retained separately in meta.wrapperSource, so
  // deriving this value from the preprocessed body would leave leading
  // comments/blank lines in both fields and duplicate them on serialization.
  // Slicing the original source at the one core-owned boundary also preserves
  // non-leading init directives and original line endings for every future
  // registered family without descriptor-specific cleanup.
  const opaqueSource = source.slice(familyLineBoundary)

  if (normalized.lines.length === 0) {
    errors.push({ code: 'EMPTY', message: 'Empty diagram' })
    return err(errors)
  }

  const header = semanticHeader
  const detection = capturedDetection!.kind === 'unknown' ? { ...capturedDetection!, header } : capturedDetection!
  if (detection.kind !== 'registered') {
    const diagnostic = familyDetectionDiagnostic(
      detection,
      source,
      familyLineBoundary,
      familyLine.authoredHeader,
      capturedFamily,
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
      source: tracedSourceMap(emptySourceMap()),
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
    const context = {
      source: normalized,
      lines: normalized.familyLines,
      envelopeLines: normalized.lines,
      opaqueSource,
      meta,
      canonicalSource,
    }
    let parsed: ReturnType<NonNullable<typeof plugin.parse>>
    try {
      parsed = plugin.parse(context)
    } catch (error) {
      // A registered family's hook throwing is a fault in its descriptor,
      // reported as one; a built-in parser's throw stays ours to surface.
      if (isBuiltinFamilyId(kind)) throw error
      const reason = error instanceof Error ? error.message : String(error)
      return err([{ code: 'FAMILY_DESCRIPTOR_CONTRACT', message: `Family "${kind}" parse hook threw: ${reason}`, line: 1 }])
    }
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
        source: tracedSourceMap(emptySourceMap()),
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
    const sourceMap = tracedSourceMap(
      plugin.buildSourceMap?.(parsed.value, sourceMapCanonicalSource, Object.freeze({
        originalText: authoredEnvelope.originalText,
        wrapperSource: authoredEnvelope.wrapperSource,
        authoredWrapperLength: authoredEnvelope.authoredWrapperLength,
        cleanup: authoredEnvelope.cleanup,
      })) ?? emptySourceMap(),
      kind === 'flowchart' ? 'flowchart' : 'generic',
    )
    let diagram: ValidDiagram = { kind, meta, body: parsed.value, source: sourceMap, canonicalSource }
    if ([meta.accessibility.title, meta.accessibility.descr].some(text => text?.includes('%%{'))) {
      try { serializeMermaid(diagram) } catch (error) {
        if (!(error instanceof AccessibilityTextError)) throw error
        diagram = { ...diagram, body: { kind: 'opaque', family: kind, source: opaqueSource } }
      }
    }
    markDroppedComments(diagram, source, plugin.statementEnds)
    retainBodyComments(diagram, source)
    return ok(diagram)
  }

  if (isBuiltinFamilyId(kind)) {
    return ok<ParsedDiagram>({
      kind, meta, body: { kind: 'opaque', family: kind, source: opaqueSource }, source: tracedSourceMap(emptySourceMap()), canonicalSource,
    })
  }
  return ok<ParsedDiagram>({
    kind,
    descriptorIdentity: plugin.identity,
    meta,
    body: { kind: 'extension', family: kind, source: opaqueSource },
    source: tracedSourceMap(emptySourceMap()),
    canonicalSource,
  })
}

function attachUniversalAccessibility(body: import('./types.ts').DiagramBody, meta: ValidDiagramMeta): void {
  attachAccessibilityToBody(body, meta.accessibility)
}

/** Identify comments that canonical serialization does not already own. Counts
 * distinguish repeated comments and quoted text never counts as a comment. */
function markDroppedComments(diagram: ValidDiagram, authoredSource: string, statementEnds?: (lines: readonly string[]) => readonly number[]): void {
  if (!authoredSource.includes('%%') || diagram.kind === 'sequence' || diagram.kind === 'c4' || diagram.body.kind === 'opaque') return

  const commentsIn = (source: string, normalized: Pick<ValidDiagramMeta, 'comments' | 'wrapperSource'>): SourceComment[] => {
    // Directives configure the diagram; they are not comment casualties. Mask
    // their bytes while retaining physical lines for the owning grammar.
    const blank = (directive: string): string => directive.replace(/[^\r\n]/g, ' ')
    const withoutDirectives = source.replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'), blank).replace(MERMAID_DIRECTIVE_REGEX, blank)
    const lines = withoutDirectives.split(/\r\n?|\n/).map(line => line.trim())
    const comments = [...normalized.comments]
    const knownLines = new Set(comments.map(comment => comment.line))
    // These grammars either expose every real comment in envelope metadata,
    // or keep percent pairs inside their statement text.
    if (['flowchart', 'state', 'journey', 'timeline', 'ishikawa', 'sankey'].includes(diagram.kind)) return comments
    if (diagram.kind === 'gantt') {
      const wrapperLines = (normalized.wrapperSource?.match(/\n/g) ?? []).length
      for (const statement of readGanttStatements(lines.map((line, index) => index < wrapperLines ? '' : line))) {
        // These payloads own percent pairs as text. Task metadata comments
        // are already separate comment statements in the shared reader.
        if (['task', 'title', 'section', 'accessibility', 'click'].includes(statement.kind)) continue
        statement.raw.forEach((raw, index) => {
          const start = trailingCommentStart(raw)
          const line = statement.startLine + index
          if (start >= 0 && !knownLines.has(line)) {
            comments.push({ line, text: raw.slice(start + 2).trim() })
            knownLines.add(line)
          }
        })
      }
      return comments.sort((a, b) => a.line - b.line)
    }
    if (diagram.kind === 'block' || diagram.kind === 'requirement') {
      const tokenize = diagram.kind === 'block' ? tokenizeBlock : tokenizeRequirement
      const normalized = normalizeMermaidSource(source)
      const start = normalized.wrapperSource?.length ?? 0
      const prefixLines = (source.slice(0, start).match(/\n/g) ?? []).length
      const text = withoutDirectives.slice(start)
      let cursor = 0, line = prefixLines + 1
      tokenize(text, (begin, end) => {
        for (; cursor < begin; cursor++) if (text.charCodeAt(cursor) === 10) line++
        if (!knownLines.has(line)) comments.push({ line, text: text.slice(begin + 2, end).trim() })
      })
      return comments.sort((a, b) => a.line - b.line)
    }
    if (diagram.kind === 'kanban') {
      const envelope = normalizeMermaidSource(source)
      const payload = preservedMermaidFamilySource(envelope), starts = sourceLineStarts(source)
      parseKanbanDiagram(payload.text, {}, envelope, (_text, _row, range) => {
        const start = payload.sourceOffset(range.start, 'end'), end = payload.sourceOffset(range.end, 'start')
        const line = sourcePointAt(starts, start).line
        if (!knownLines.has(line)) { comments.push({ line, text: source.slice(start, end).trim() }); knownLines.add(line) }
      })
      return comments.sort((a, b) => a.line - b.line)
    }
    if (diagram.kind === 'class') {
      const visit = (nodes: ClassStatementNode[]): void => {
        for (const node of nodes) {
          if (node.value.kind !== 'member' && node.value.kind !== 'body-annotation') {
            const start = classCommentStart(node.raw)
            if (start >= 0) {
              const line = node.source.line + (node.raw.slice(0, start).match(/\n/g) ?? []).length
              if (!knownLines.has(line)) {
                comments.push({ line, text: node.raw.slice(start + 2).split('\n', 1)[0]!.trim() })
                knownLines.add(line)
              }
            }
          }
          if (node.children) visit(node.children)
          if (node.closing) visit([node.closing])
        }
      }
      visit(readClassStatements(lines, undefined, false).statements)
      return comments.sort((a, b) => a.line - b.line)
    }
    const wrapperLines = (normalized.wrapperSource?.match(/\r\n?|\n/g) ?? []).length
    const ends = statementEnds && source.includes('%%') ? statementEnds(lines.map((line, index) => index < wrapperLines ? '' : line)) : undefined
    for (let index = 0; index < lines.length; index++) {
      const end = statementEndAt(ends, index, lines.length)
      const statement = statementText(lines, index, end)
      const stripped = diagram.kind === 'mindmap' ? stripMindmapComment(statement) : undefined
      const start = stripped === undefined ? trailingCommentStart(statement) : stripped.length < statement.length ? stripped.length : -1
      if (start > 0) {
        const line = index + 1 + (statement.slice(0, start).match(/\n/g) ?? []).length
        if (!knownLines.has(line)) comments.push({ line, text: statement.slice(start + 2).split('\n', 1)[0]!.trim() })
      }
      index = end
    }
    return comments.sort((a, b) => a.line - b.line)
  }
  const comments = commentsIn(authoredSource, diagram.meta)
  if (!comments.length) return
  const serialized = serializeMermaid(diagram)
  const owned = new Map<string, number>()
  for (const comment of commentsIn(serialized, normalizeMermaidSource(serialized))) owned.set(comment.text, (owned.get(comment.text) ?? 0) + 1)
  const dropped = comments.filter(comment => {
    const remaining = owned.get(comment.text) ?? 0
    if (!remaining) return true
    owned.set(comment.text, remaining - 1)
    return false
  })
  if (dropped.length) diagram.meta.droppedComments = dropped
}

// ---- Meta extraction -----------------------------------------------------

function extractMeta(
  normalized: ReturnType<typeof normalizeMermaidSource>,
): ValidDiagramMeta {
  return {
    initDirectives: normalized.initDirectives as ValidDiagramMeta['initDirectives'],
    comments: normalized.comments,
    accessibility: normalized.accessibility,
    wrapperSource: normalized.wrapperSource ?? '',
    ...(Object.keys(normalized.frontmatter).length > 0
      ? { frontmatter: normalized.frontmatter as ValidDiagramMeta['frontmatter'] }
      : {}),
  }
}

function emptySourceMap(): SourceMap {
  return { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
}
