import { ZENUML_SOURCE_HOOKS } from './zenuml-body.ts'
import { EVENTMODELING_SOURCE_HOOKS } from './eventmodeling-body.ts'
import { readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import { C4AmbiguousArgumentError, parseC4Diagram } from '../c4/parser.ts'
import { buildC4SourceMap, lintC4, parseC4Body, renderC4 } from './c4-body.ts'

import { STABLE_FAMILY_SOURCE_HOOKS } from './stable-family-source-hooks.ts'
// ============================================================================
// Shared built-in parsing, serialization, verification and source-map hooks.
// Mutation is composed separately by families-builtin.ts before enrollment.
//
// Defines read-only structured operations. The registry combines these
// hooks with each family's render hooks and metadata, validates the complete
// descriptor, and only then makes it discoverable. Structured families own
// their parse/serialize/source-map definitions here; the full SDK adds mutation
// in families-builtin.ts before installing into the same registry.
//
// Flowchart registers through `flowchartFamilyHooks('flowchart')` over the
// legacy MermaidGraph body (error semantics, contributes a SourceMap).
//
// State registers through `structuredFamilyHooks('state', …)` over the
// dedicated StateBody IR (BUILD-19): structured-or-opaque parse, state-shaped
// ops, an `asState` narrower, and a verify hook that runs body-level Tier 1
// checks (verify.ts adds the geometric Tier 2 pass via the graph projection).
// ============================================================================

import { decodeXML } from 'entities'
import { readArchitectureStatements } from '../architecture/parser.ts'
import { type ClassStatementNode, readClassStatements } from '../class/parser.ts'
import { type ErSourceStatement, type ParsedErRelationshipSyntax, readErStatements } from '../er/parser.ts'
import { readGanttStatements } from '../gantt/parser.ts'
import { type JourneyParseIssue, walkJourneyLines } from '../journey/parse-core.ts'
import { getFrontmatterScalar, normalizeMermaidSource } from '../mermaid-source.ts'
import { PIE_QUOTED_TEXT, splitAuthoredPieTitleLine } from '../pie/source-title.ts'
import { parseQuadrantChart, QuadrantCoordinateError } from '../quadrant/parser.ts'
import { sourceLineStarts, sourcePointAt } from '../family-detection.ts'
import { cleanupMermaidSource, originalMermaidOffset } from '../shared/mermaid-cleanup.ts'
import { sequenceFamilySource } from '../sequence/family-source.ts'
import { SequenceParticipantIdError } from '../sequence/parser.ts'
import { splitSequenceStatementLines } from '../sequence/statements.ts'
import { parseDirectionStatement } from '../shared/direction-statement.ts'
import { joinQuotedTextLines, stripTrailingComment } from '../shared/trailing-comment.ts'
import { isTimelineCommentLine, parseTimelineHeader } from '../timeline/parse-core.ts'
import { adoptStatementAccessibility } from './accessibility-envelope.ts'
import { grammarAccessibilityFields } from '../shared/grammar-text.ts'
import { parseArchitectureBody, renderArchitecture, verifyArchitecture, verifyOpaqueArchitectureIcons } from './architecture-body.ts'
import { parseClassBody, renderClass, verifyClass } from './class-body.ts'
import { parseErBody, renderEr, verifyErBody } from './er-body.ts'
import type { ExtractedLabel, FamilyOperations } from './families.ts'
import { extractLabelsGeneric } from './family-labels.ts'
import { buildFlowchartSourceMap, type FlowchartBody, parseFlowchartBody, renderFlowchart } from './flowchart-body.ts'
import { containsFlowchartOpaqueSyntax } from './flowchart-unsupported.ts'
import { parseGanttBody, renderGantt, verifyGantt } from './gantt-body.ts'
import { parseGitGraphBody, renderGitGraphBody, verifyGitGraph } from './gitgraph-body.ts'
import { parseJourneyBody, renderJourney, verifyJourney } from './journey-body.ts'
import { mindmapSerializationProblem, parseMindmapBody, renderMindmapBody, verifyMindmap } from './mindmap-body.ts'
import { parsePieBody, renderPie, verifyPie } from './pie-body.ts'
import { parseQuadrantBody, renderQuadrant, verifyQuadrant } from './quadrant-body.ts'
import { parseRadarBody, renderRadar, verifyRadar } from './radar-body.ts'
import { parseSankeyBody, renderSankey, verifySankey } from './sankey-body.ts'
import { parseSequenceBody, renderSequence } from './sequence-body.ts'
import { recordSourceMapEnds } from './source-map-spans.ts'
import { parseStateBody, renderState, verifyOpaqueState, verifyState } from './state-body.ts'
import { matchFloatingNote } from '../state/parse-core.ts'
import { parseTimelineBody, renderTimeline } from './timeline-body.ts'
import type { ClassBody, DiagramBody, DiagramKind, ErBody, FamilyParsedBody, GanttBody, LayoutWarning, PieBody, QuadrantBody, RadarBody, SankeyBody, SourceLocation, SourceMap, XyChartBody } from './types.ts'
import { err, ok } from './types.ts'
import { parseXyChartBody, renderXyChart, verifyXyChart } from './xychart-body.ts'

// Build the structured-or-opaque hook set shared by every structured family
// that is not flowchart/state. `headerOk` gates structured parsing: families
// with meaningful header suffixes (timeline, journey) stay opaque when the
// header carries one, so the suffix round-trips verbatim.
function structuredFamilyHooks<K extends DiagramBody['kind'] & DiagramKind>(
  kind: K,
  opts: {
    headerOk?: (header: string) => boolean
    ownsAccessibility?: boolean
    parseBody: (lines: string[], accessibility: import('./types.ts').Accessibility, rawBodyLines: string[]) => Extract<DiagramBody, { kind: K }> | null
    serialize: (body: Extract<DiagramBody, { kind: K }>) => string
  },
): Pick<FamilyOperations, 'parse' | 'serialize'> {
  return {
    parse: ctx => {
      const lines = ctx.lines
      const { opaqueSource } = ctx
      const headerOk = opts.headerOk?.(lines[0]?.trim() ?? '') ?? true
      const raw = ctx.source.familyBody.split(/\r?\n/)
      const headerAt = raw.findIndex(line => line.trim() === lines[0]?.trim())
      const body = headerOk ? opts.parseBody(lines.slice(1), ctx.meta.accessibility, raw.slice(headerAt + 1)) : null
      if (body && opts.ownsAccessibility && ('accessibilityTitle' in body || 'accessibilityDescription' in body)) ctx.meta.accessibility = grammarAccessibilityFields(body)
      return ok(body ?? { kind: 'opaque', family: kind, source: opaqueSource })
    },
    serialize: body => {
      if (body.kind !== kind) throw new Error(`${kind} serializer received body kind ${body.kind}`)
      return opts.serialize(body as Extract<DiagramBody, { kind: K }>)
    },
  }
}

// ---- Flowchart ------------------------------------------------------------
// Flowchart-specific label extraction:
//   - `A["text"]`, `A(text)`, `A([text])`, `A{text}`, `A{{text}}`, etc.
//   - `A -- text --> B`, `A -->|text| B`
const FLOWCHART_LABEL_RE = /(?:\["((?:[^"\\]|\\.)*)"\]|\[(["'`]?)([^\]\n]+?)\2\]|\(\(([^)\n]+?)\)\)|\(([^)\n]+?)\)|\{([^}\n]+?)\}|\|([^|\n]+?)\||\>([^\]\n]+?)\])/g

function extractFlowchartLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    const idMatch = raw.match(/^([A-Za-z_][\w-]*)/)
    const target = idMatch ? idMatch[1]! : `line${i + 1}`
    for (const m of raw.matchAll(FLOWCHART_LABEL_RE)) {
      let text = (m[1] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8] ?? '').trim()
      // A quoted "`…`" is a markdown string: its backticks are delimiters,
      // consumed like the quotes (flowchart-labels.ts parseFlowchartLabel).
      if (m[1] !== undefined && text.length >= 2 && text.startsWith('`') && text.endsWith('`')) text = text.slice(1, -1).trim()
      if (text) out.push({ text, target })
    }
  }
  return out
}

// Flowchart owns the legacy MermaidGraph body: the diagram kind selects the
// descriptor, which binds the flowchart header.
function flowchartFamilyHooks(): Pick<FamilyOperations, 'parse' | 'buildSourceMap' | 'serialize'> {
  return {
    parse: ({ source, opaqueSource }) => {
      if (containsFlowchartOpaqueSyntax(source.familyBody)) return ok<DiagramBody>({ kind: 'opaque', family: 'flowchart', source: opaqueSource })
      return parseFlowchartBody(source.familyBody, opaqueSource)
    },
    buildSourceMap: (body, canonicalSource) => (body.kind === 'flowchart' ? buildFlowchartSourceMap(body as FlowchartBody, canonicalSource) : { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }),
    serialize: body => {
      if (body.kind !== 'flowchart') throw new Error(`flowchart serializer received body kind ${body.kind}`)
      return renderFlowchart(body.graph, 'flowchart')
    },
  }
}

export const FLOWCHART_SOURCE_HOOKS = {
  renderSource: () => 'canonical',
  extractLabels: extractFlowchartLabels,
  .../* @__PURE__ */ flowchartFamilyHooks(),
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- State ----------------------------------------------------------------
// BUILD-19: state owns a dedicated StateBody IR (no longer the flowchart body).
// State label extraction for opaque fallbacks: `state "Label" as id`,
// `id : Description`, and transition labels `from --> to : label`.
function extractStateLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    const target = `line${i + 1}`
    let m
    const floating = matchFloatingNote(raw)
    if (floating) {
      out.push({ text: floating.text, target })
    } else if ((m = raw.match(/^state\s+"([^"]+)"\s+as\s+/i))) {
      out.push({ text: m[1]!.trim(), target })
    } else if (raw.includes('-->') && raw.includes(':')) {
      const colon = raw.indexOf(':')
      out.push({ text: raw.slice(colon + 1).trim(), target })
    } else if ((m = raw.match(/^[\w\p{L}\p{M}\p{N}-]+\s*:\s*(.+)$/u))) {
      out.push({ text: m[1]!.trim(), target })
    } else if ((m = raw.match(/^note\s+(?:left of|right of)\s+\S+\s*:\s*(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target })
    }
  }
  return out
}

export const STATE_SOURCE_HOOKS = {
  // Nested bodies omit global statement interleaving. Preserve the source's
  // paint order; typed mutations rebuild canonicalSource when they commit.
  renderSource: () => 'canonical',
  extractLabels: extractStateLabels,
  // The verify hook covers body-level structural Tier 1 (EMPTY/MISANCHORED/
  // LABEL_OVERFLOW); verify.ts adds geometric Tier 2 via the graph projection.
  verify: (body, opts) => (body.kind === 'state' ? verifyState(body, opts) : body.kind === 'opaque' ? verifyOpaqueState(body.source) : []),
  .../* @__PURE__ */ structuredFamilyHooks('state', {
    headerOk: h => /^statediagram(?:-v2)?\s*$/i.test(h),
    parseBody: parseStateBody,
    serialize: renderState,
  }),
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Sequence -------------------------------------------------------------
// Sequence labels: messages (`A->>B: text`), participants (`participant X as Label`,
// `actor X as Label`), notes (`Note over A: text`, `Note left of A: text`),
// block headers (`loop label`, `alt label`, `else label`, `opt label`, `par label`).
function extractSequenceLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    let m
    if ((m = raw.match(/^(?:participant|actor)\s+\S+\s+as\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^Note\s+(?:over|left of|right of)\s+[\w,\s]+?:\s*(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/->>?|-->>?|->|-->|-x|--x/)) && raw.includes(':')) {
      const colon = raw.indexOf(':')
      out.push({ text: raw.slice(colon + 1).trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^(?:loop|alt|else|opt|par|and|critical|break|rect)\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^title\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    }
  }
  return out
}

// Sequence parse needs the RAW (indentation-preserving) body lines so
// opaque-block segments round-trip verbatim. `opaqueSource` is the normalized
// body INCLUDING the header line, with original indentation/blank lines/
// comments intact — drop its header and pass alongside the trimmed lines.
export const SEQUENCE_SOURCE_HOOKS = {
  renderSource: body => (body.kind === 'opaque' ? 'canonical' : 'serialized'),
  extractLabels: extractSequenceLabels,
  parse: ({ source: authored, lines: authoredLines, opaqueSource }) => {
    // The statements the renderer reads, references decoded as it decodes them.
    const source = sequenceFamilySource(authored, 'authored')
    const lines = source === authored ? authoredLines : source.familyLines
    const expandedLines = splitSequenceStatementLines(lines)
      .map(line => line.trim())
      .filter(Boolean)
    // The typed body starts after the header. Preserve a header's inline
    // statement rather than silently discarding it with that first line.
    if (!/^sequenceDiagram$/i.test(expandedLines[0] ?? '')) return ok({ kind: 'opaque', family: 'sequence', source: opaqueSource })
    const rawBodyLines = sequenceRawBodyLines(source.familyBody, expandedLines)
    try {
      const body = parseSequenceBody(expandedLines.slice(1), rawBodyLines)
      return ok(body ?? { kind: 'opaque', family: 'sequence', source: opaqueSource })
    } catch (error) {
      if (!(error instanceof SequenceParticipantIdError)) throw error
      return err([{ code: 'PARSE_FAILED', message: error.message }])
    }
  },
  serialize: body => {
    if (body.kind !== 'sequence') throw new Error(`sequence serializer received body kind ${body.kind}`)
    return renderSequence(body)
  },
} satisfies Omit<FamilyOperations, 'mutate'>

function sequenceRawBodyLines(opaqueSource: string, expandedLines: string[]): string[] {
  const raw = opaqueSource.split(/\r?\n/)
  const headerAt = raw.findIndex(l => /^sequenceDiagram\b/i.test(l.trim()))
  return headerAt >= 0 ? splitSequenceStatementLines(raw.slice(headerAt)).slice(1) : expandedLines.slice(1)
}

// ---- Timeline -------------------------------------------------------------
function extractTimelineLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || isTimelineCommentLine(raw)) continue
    let m
    if ((m = raw.match(/^title\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^section\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if (raw.includes(':')) {
      // `<period> : <event> [: <event>...]` or continuation `: <event>`
      const parts = raw
        .split(':')
        .map(p => p.trim())
        .filter(Boolean)
      for (const p of parts) out.push({ text: p, target: `line${i + 1}` })
    }
  }
  return out
}

// Any non-LR/TD header suffix stays opaque so it round-trips verbatim, but its
// render path must reject it instead of silently projecting LR geometry.
function verifyOpaqueTimeline(body: FamilyParsedBody): LayoutWarning[] {
  if (body.kind !== 'opaque' || body.family !== 'timeline') return []
  // Match parsing/rendering: an inline body statement is split off the header
  // before its suffix is classified as a direction.
  const header = parseTimelineHeader(decodeXML(normalizeMermaidSource(body.source).familyLines[0] ?? ''))
  if (header?.kind !== 'unsupported') return []
  return [
    {
      code: 'UNSUPPORTED_SYNTAX',
      // The opaque body excludes the authored wrapper, so its relative line
      // cannot truthfully be reported as an authored-document location.
      syntax: 'timeline_header_direction',
      message: `Unsupported timeline header suffix "${header.suffix}"; only LR and TD are direction tokens. The source is preserved, but rendering is rejected instead of silently using LR.`,
    },
  ]
}

export const TIMELINE_SOURCE_HOOKS = {
  renderSource: () => 'serialized',
  extractLabels: extractTimelineLabels,
  verify: body => verifyOpaqueTimeline(body),
  parse: ({ lines, opaqueSource, meta }) => {
    const header = parseTimelineHeader(lines[0] ?? '')
    // Native rendering accepts inline header comments, but the structured
    // serializer does not retain them. Preserve authored source instead.
    const body = header?.kind === 'supported' && !header.hasInlineComment ? parseTimelineBody(lines.slice(1), meta.accessibility) : null
    if (body) meta.accessibility = {
      ...(body.accessibilityTitle !== undefined ? { title: body.accessibilityTitle } : {}),
      ...(body.accessibilityDescription !== undefined ? { descr: body.accessibilityDescription } : {}),
    }
    if (body && header?.kind === 'supported' && header.direction) body.direction = header.direction
    return ok(body ?? { kind: 'opaque', family: 'timeline', source: opaqueSource })
  },
  serialize: body => {
    if (body.kind !== 'timeline') throw new Error(`timeline serializer received body kind ${body.kind}`)
    return renderTimeline(body)
  },
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Class ---------------------------------------------------------------
// class Name { +member ... }, Class : +member, class A as "Display Label"
function emptySourceMap(): SourceMap {
  return { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }
}
function loc(line: number, col: number): { line: number; col: number } {
  return { line, col: Math.max(1, col) }
}

function nextOccurrence(counts: Map<string, number>, key: string): number {
  const occurrence = counts.get(key) ?? 0
  counts.set(key, occurrence + 1)
  return occurrence
}

function xyValueTokenOffsets(valueSlice: string): number[] {
  const offsets: number[] = []
  let segmentStart = 0
  let quote: string | undefined
  let escaped = false
  const visit = (end: number): void => {
    const segment = valueSlice.slice(segmentStart, end)
    const match = segment.match(/^\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)/)
    if (match) offsets.push(segmentStart + (match[0].length - match[0].trimStart().length))
    segmentStart = end + 1
  }
  for (let index = 0; index < valueSlice.length; index++) {
    const char = valueSlice[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ',') visit(index)
  }
  visit(valueSlice.length)
  return offsets
}

function xySeriesNameLocation(line: string, lineIndex: number, name: string, valueStart: number): { line: number; col: number } | undefined {
  const kind = line.match(/^\s*(?:bar|line)\b/i)
  if (!kind) return undefined
  const start = kind[0].length
  const prefix = line.slice(start, valueStart >= 0 ? valueStart : line.length)
  const quoted = prefix.match(/(["'])([^"']*)\1/)
  if (quoted?.[2]?.trim() === name && quoted.index !== undefined) {
    const contentStart = start + quoted.index + 1 + (quoted[2]!.length - quoted[2]!.trimStart().length)
    return loc(lineIndex + 1, contentStart + 1)
  }
  const column = line.indexOf(name, start)
  return column >= 0 && (valueStart < 0 || column < valueStart) ? loc(lineIndex + 1, column + 1) : undefined
}

interface LocatedSourceLine {
  line: string
  trimmed: string
  lineIndex: number
  start: number
}

function locatedSourceLines(lines: readonly string[]): LocatedSourceLine[] {
  return lines.map((line, lineIndex) => ({
    line,
    trimmed: line.trim(),
    lineIndex,
    start: line.length - line.trimStart().length,
  }))
}

function pieSliceSourceLocations(lines: readonly string[]): Array<{ label: string; location: { line: number; col: number } }> {
  return joinQuotedTextLines(lines, PIE_QUOTED_TEXT).flatMap((line, lineIndex) => {
    const match = line.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:/)
    if (match?.[1] === undefined || match.index === undefined) return []
    const quote = line.indexOf('"', match.index)
    return [
      {
        label: match[1].replace(/\\(["\\])/g, '$1'),
        location: loc(lineIndex + 1, quote + 2),
      },
    ]
  })
}

function classArrowIndex(line: string): number {
  return line.search(/<\|--\|>|\(\)--|--\(\)|<\|--|--\|>|\.\.\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.?|--|\.\./)
}

function quotedContentLocations(line: string): Array<{ text: string; start: number; end: number }> {
  return [...line.matchAll(/"((?:\\.|[^"\\])*)"/g)].flatMap(match => (match.index === undefined ? [] : [{ text: match[1]!.replace(/\\(["\\])/g, '$1'), start: match.index + 1, end: match.index + match[0].length - 1 }]))
}

function buildClassSourceMap(body: DiagramBody, canonicalSource: string): SourceMap {
  const map = emptySourceMap()
  if (body.kind !== 'class') return map
  const b = body as ClassBody
  const lines = canonicalSource.split(/\r?\n/)
  const tree = readClassStatements(lines)
  const nodeDeclarations = new Map<string, { line: number; col: number }>()
  const memberSources = new Map<string, Array<{ line: number; col: number }>>()
  const relationSources: LocatedSourceLine[] = []
  const cursors = new Map<number, number>()
  const locate = (node: ClassStatementNode): LocatedSourceLine => {
    const lineIndex = node.source.line - 1
    const line = lines[lineIndex]!
    const index = line.indexOf(node.text, cursors.get(lineIndex) ?? 0)
    const start = index >= 0 ? index : line.length - line.trimStart().length
    cursors.set(lineIndex, start + node.text.length)
    return { line, lineIndex, start, trimmed: node.text }
  }
  const addMember = (id: string, text: string, source: LocatedSourceLine): void => {
    const key = `${id}\u0000${text}`
    const entries = memberSources.get(key) ?? []
    const index = source.line.indexOf(text, source.start)
    entries.push(loc(source.lineIndex + 1, (index >= 0 ? index : source.start) + 1))
    memberSources.set(key, entries)
  }
  const declare = (id: string, source: LocatedSourceLine): void => {
    const index = source.line.indexOf(id, source.start)
    nodeDeclarations.set(id, loc(source.lineIndex + 1, (index >= 0 ? index : source.start) + 1))
  }
  const visit = (nodes: ClassStatementNode[], owner?: string): void => {
    const frames = [{ nodes, owner, index: 0 }]
    while (frames.length) {
      const frame = frames.at(-1)!
      if (frame.index === frame.nodes.length) {
        frames.pop()
        continue
      }
      const node = frame.nodes[frame.index++]!
      const { owner } = frame
      const source = locate(node)
      const value = node.value
      if (value.kind === 'class') {
        declare(value.declaration.id, source)
        if (value.declaration.annotation !== undefined) addMember(value.declaration.id, `<<${value.declaration.annotation}>>`, source)
        if (node.children) frames.push({ nodes: node.children, owner: value.declaration.id, index: 0 })
      } else if (value.kind === 'namespace') frames.push({ nodes: node.children!, owner: undefined, index: 0 })
      else if (value.kind === 'relationship') relationSources.push(source)
      else if (value.kind === 'member') {
        const id = value.reference?.id ?? owner!
        addMember(id, value.text, source)
        if (value.reference && !nodeDeclarations.has(id)) declare(id, source)
      } else if (value.kind === 'body-annotation') addMember(owner!, node.text, source)
      else if (value.kind === 'annotation') {
        if (!nodeDeclarations.has(value.annotation.id)) declare(value.annotation.id, source)
        addMember(value.annotation.id, `<<${value.annotation.annotation}>>`, source)
      } else if (value.kind === 'interaction' || value.kind === 'note') {
        const id = value.kind === 'interaction' ? value.interaction.id : value.reference?.id
        if (id && !nodeDeclarations.has(id)) declare(id, source)
      } else if (value.kind === 'style' || value.kind === 'assignment') {
        for (const reference of value.references) if (!nodeDeclarations.has(reference.id)) declare(reference.id, source)
      }
    }
  }
  visit(tree.statements)

  for (const c of b.classes) {
    const declared = nodeDeclarations.get(c.id)
    if (declared) map.nodes.set(c.id, declared)
    const memberOccurrences = new Map<string, number>()
    c.members.forEach((member, index) => {
      const occurrence = nextOccurrence(memberOccurrences, member)
      const found = memberSources.get(`${c.id}\u0000${member}`)?.[occurrence]
      if (found) map.labels.set(`class:${c.id}:member#${index}`, found)
    })
  }

  b.relations.forEach((r, index) => {
    const locatedRelation = relationSources[index]
    if (!locatedRelation) return
    const source = locatedRelation
    const key = `rel#${index}:${r.from}->${r.to}`
    const relationLocation = loc(source.lineIndex + 1, source.start + 1)
    map.edges.set(key, relationLocation)
    if (!map.nodes.has(r.from)) map.nodes.set(r.from, relationLocation)
    if (!map.nodes.has(r.to)) map.nodes.set(r.to, relationLocation)
    const arrow = classArrowIndex(source.trimmed)
    const colon = arrow >= 0 ? source.trimmed.indexOf(':', arrow) : -1
    if (r.label && colon >= 0) {
      const labelCol = source.trimmed.indexOf(r.label, colon + 1)
      if (labelCol >= 0) map.labels.set(key, loc(source.lineIndex + 1, source.start + labelCol + 1))
    }
    const quoted = quotedContentLocations(source.trimmed)
    if (r.fromCardinality && arrow >= 0) {
      const cardinality = quoted.filter(entry => entry.start < arrow).at(-1)
      if (cardinality) map.labels.set(`${key}:fromCardinality`, loc(source.lineIndex + 1, source.start + cardinality.start + 1))
    }
    if (r.toCardinality && arrow >= 0) {
      const cardinality = quoted.find(entry => entry.start > arrow && (colon < 0 || entry.start < colon))
      if (cardinality) map.labels.set(`${key}:toCardinality`, loc(source.lineIndex + 1, source.start + cardinality.start + 1))
    }
  })
  return map
}

function buildErSourceMap(body: DiagramBody, canonicalSource: string): SourceMap {
  const map = emptySourceMap()
  if (body.kind !== 'er') return map
  const b = body as ErBody
  const lines = canonicalSource.split(/\r?\n/)
  const nodeDeclarations = new Map<string, { line: number; col: number }>()
  const attributeSources = new Map<string, Array<{ line: number; col: number }>>()
  const relationSources: Array<{ source: LocatedSourceLine; relation: ParsedErRelationshipSyntax; end: SourceLocation }> = []
  const headerAt = lines.findIndex(line => /^erDiagram\s*$/i.test(line.trim()))
  const tree = readErStatements(lines.slice(headerAt + 1))
  // Statements may share a line, and an attribute may run across lines, so
  // each span ends where its statement does, before any space or comment.
  const ends = { nodes: new Map<string, SourceLocation>(), edges: new Map<string, SourceLocation>(), labels: new Map<string, SourceLocation>() }
  const endOf = (entry: ErSourceStatement): SourceLocation => {
    const from = entry.endLine === entry.line ? entry.column : 0
    const text = lines[headerAt + entry.endLine + 1]!.slice(from, entry.endColumn)
    return loc(headerAt + entry.endLine + 2, from + stripTrailingComment(text).trimEnd().length + 1)
  }
  const attributeEnds = new Map<string, SourceLocation[]>()
  const nodeEnds = new Map<string, SourceLocation>()
  for (const entry of tree.statements) {
    // A statement may share its line (`Z { string id }`): locate it there.
    const source: LocatedSourceLine = {
      line: lines[headerAt + entry.line + 1]!,
      trimmed: entry.raw.trim(),
      lineIndex: headerAt + entry.line + 1,
      start: entry.column + entry.raw.length - entry.raw.trimStart().length,
    }
    const syntax = entry.syntax
    if (syntax.kind === 'attribute') {
      const key = `${entry.entityId}\u0000${syntax.text}`
      const entries = attributeSources.get(key) ?? []
      entries.push(loc(source.lineIndex + 1, source.start + 1))
      attributeSources.set(key, entries)
      attributeEnds.set(key, [...(attributeEnds.get(key) ?? []), endOf(entry)])
    } else if (syntax.kind === 'relation') {
      relationSources.push({ source, relation: syntax.relation, end: endOf(entry) })
    } else if (syntax.kind === 'entity' || syntax.kind === 'block-open') {
      nodeDeclarations.set(syntax.reference.id, loc(source.lineIndex + 1, source.start + 1))
      nodeEnds.set(syntax.reference.id, endOf(entry))
    }
  }

  for (const e of b.entities) {
    const declared = nodeDeclarations.get(e.id)
    if (declared) {
      map.nodes.set(e.id, declared)
      ends.nodes.set(e.id, nodeEnds.get(e.id)!)
    }
    const attributeOccurrences = new Map<string, number>()
    e.attributes.forEach((attr, index) => {
      const occurrence = nextOccurrence(attributeOccurrences, attr.text)
      const found = attributeSources.get(`${e.id}\u0000${attr.text}`)?.[occurrence]
      if (!found) return
      map.labels.set(`er:${e.id}:attr#${index}`, found)
      ends.labels.set(`er:${e.id}:attr#${index}`, attributeEnds.get(`${e.id}\u0000${attr.text}`)![occurrence]!)
    })
  }

  b.relations.forEach((r, index) => {
    const locatedRelation = relationSources[index]
    if (!locatedRelation) return
    const { source, relation, end } = locatedRelation
    const key = `rel#${index}:${r.from}->${r.to}`
    const relationLocation = loc(source.lineIndex + 1, source.start + 1)
    map.edges.set(key, relationLocation)
    ends.edges.set(key, end)
    for (const id of [r.from, r.to]) {
      if (map.nodes.has(id)) continue
      map.nodes.set(id, relationLocation)
      ends.nodes.set(id, end)
    }
    const link = relation.identifying ? '--' : '..'
    const operator = `${relation.leftToken}${link}${relation.rightToken}`
    const operatorStart = source.line.indexOf(operator, source.start)
    if (operatorStart >= 0) {
      map.labels.set(`${key}:leftCardinality`, loc(source.lineIndex + 1, operatorStart + 1))
      map.labels.set(`${key}:rightCardinality`, loc(source.lineIndex + 1, operatorStart + relation.leftToken.length + link.length + 1))
    }
    if (r.label) {
      const colon = source.line.indexOf(':', Math.max(source.start, operatorStart))
      const labelCol = colon >= 0 ? source.line.indexOf(r.label, colon + 1) : -1
      if (labelCol >= 0) {
        // The label is that text, without a quote or comment after it.
        map.labels.set(key, loc(source.lineIndex + 1, labelCol + 1))
        ends.labels.set(key, loc(source.lineIndex + 1, labelCol + r.label.length + 1))
      }
    }
  })
  recordSourceMapEnds(map, ends)
  return map
}

function buildChartSourceMap(body: DiagramBody, canonicalSource: string): SourceMap {
  const map = emptySourceMap()
  const lines = canonicalSource.split(/\r?\n/)
  if (body.kind === 'xychart') {
    const b = body as XyChartBody
    const seriesLines = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^\s*(?:bar|line)\b/i.test(line))
    b.series.forEach((series, si) => {
      const candidate = seriesLines[si]
      if (!candidate || !new RegExp(`^\\s*${series.kind}\\b`, 'i').test(candidate.line)) return
      const lineIndex = candidate.index
      const line = candidate.line
      const valueStart = line.indexOf('[')
      const valueEnd = line.lastIndexOf(']')
      if (series.name) {
        const nameLocation = xySeriesNameLocation(line, lineIndex, series.name, valueStart)
        if (nameLocation) map.labels.set(`xychart:${series.id}:name`, nameLocation)
      }
      const valueSlice = valueStart >= 0 && valueEnd > valueStart ? line.slice(valueStart + 1, valueEnd) : ''
      const numericOffsets = xyValueTokenOffsets(valueSlice)
      series.values.forEach((_value, vi) => {
        const tokenOffset = numericOffsets[vi]
        if (tokenOffset !== undefined) map.labels.set(`xychart:${series.id}:point#${vi}`, loc(lineIndex + 1, valueStart + 2 + tokenOffset))
      })
    })
  } else if (body.kind === 'pie') {
    const sliceSources = pieSliceSourceLocations(lines)
    ;(body as PieBody).slices.forEach((slice, index) => {
      const found = sliceSources[index]
      if (found?.label === slice.label) map.labels.set(`pie:slice#${index}`, found.location)
    })
  } else if (body.kind === 'quadrant') {
    const cleanup = cleanupMermaidSource(canonicalSource)
    const starts = sourceLineStarts(canonicalSource)
    const ends = new Map<string, SourceLocation>()
    let index = 0
    parseQuadrantChart(cleanup.text.split('\n'), undefined, (point, range) => {
      const key = `quadrant:point#${index}`
      if ((body as QuadrantBody).points[index++]?.label !== point.label) return
      const start = sourcePointAt(starts, originalMermaidOffset(cleanup, range.start))
      const end = sourcePointAt(starts, originalMermaidOffset(cleanup, range.end, 'end'))
      map.labels.set(key, loc(start.line, start.col))
      ends.set(key, loc(end.line, end.col))
    })
    recordSourceMapEnds(map, { labels: ends })
  } else if (body.kind === 'sankey') {
    // Canonical form: header line, then one CSV row per link in order.
    const rowLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => {
        const trimmed = line.trim()
        return trimmed.length > 0 && !trimmed.startsWith('%%') && !/^sankey(?:-beta)?\s*:?\s*$/i.test(trimmed)
      })
    ;(body as SankeyBody).links.forEach((link, index) => {
      const candidate = rowLines[index]
      if (!candidate) return
      const start = candidate.line.length - candidate.line.trimStart().length
      map.labels.set(`sankey:link#${index}`, loc(candidate.index + 1, start + 1))
    })
  } else if (body.kind === 'radar') {
    const b = body as RadarBody
    b.axes.forEach((axis, index) => {
      const token = new RegExp(`(?:^\\s*axis\\s+|,\\s*)(${escapeSourceMapRegex(axis.id)})(?=\\s*(?:\\[|,|$))`, 'i')
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const match = lines[lineIndex]!.match(token)
        if (!match?.[1] || match.index === undefined) continue
        map.labels.set(`radar:axis#${index}`, loc(lineIndex + 1, match.index + match[0].lastIndexOf(match[1]) + 1))
        break
      }
    })
    b.curves.forEach((curve, index) => {
      const token = new RegExp(`^\\s*curve\\s+(${escapeSourceMapRegex(curve.id)})(?=\\s*(?:\\[|\\{))`, 'i')
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const match = lines[lineIndex]!.match(token)
        if (!match?.[1] || match.index === undefined) continue
        map.labels.set(`radar:curve#${index}`, loc(lineIndex + 1, match.index + match[0].lastIndexOf(match[1]) + 1))
        break
      }
    })
  }
  return map
}

function buildGanttSourceMap(body: DiagramBody, canonicalSource: string): SourceMap {
  const map = emptySourceMap()
  if (body.kind !== 'gantt') return map
  const b = body as GanttBody
  const lines = canonicalSource.split(/\r?\n/)
  const statements = readGanttStatements(lines)
  const taskOccurrences = new Map<string, number>()
  const sectionOccurrences = new Map<string, number>()
  for (const section of b.sections) {
    if (section.label) {
      const wanted = nextOccurrence(sectionOccurrences, section.label)
      let seen = 0
      for (const statement of statements) {
        if (statement.kind !== 'section' || statement.value !== section.label || seen++ !== wanted) continue
        const location = loc(statement.startLine, statement.valueColumn!)
        map.groups.set(section.id, location)
        map.labels.set(`gantt:${section.id}:label`, location)
        break
      }
    }
    for (const task of section.tasks) {
      const stableId = task.taskId ?? task.id
      const signature = `${task.label}\u0000${task.end}`
      const wanted = nextOccurrence(taskOccurrences, signature)
      let seen = 0
      for (const statement of statements) {
        if (statement.kind !== 'task' || statement.label !== task.label) continue
        const end = statement.meta.end.kind === 'until' ? `until ${statement.meta.end.refs.join(' ')}` : statement.meta.end.raw
        if (end !== task.end) continue
        if (seen++ !== wanted) continue
        const location = loc(statement.startLine, statement.valueColumn!)
        map.nodes.set(stableId, location)
        map.labels.set(`gantt:task:${stableId}`, location)
        break
      }
    }
  }
  return map
}

function escapeSourceMapRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractClassLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    let m
    if ((m = raw.match(/^class\s+\S+\s+as\s+"([^"]+)"/i))) {
      out.push({ text: m[1]!, target: `line${i + 1}` })
    } else if ((m = raw.match(/^\S+\s*:\s*(.+)$/))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^[+\-#~]\s*(.+)$/))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^note\s+(?:for\s+\S+\s+)?"([^"]+)"/i))) {
      out.push({ text: m[1]!, target: `line${i + 1}` })
    }
  }
  return out
}

export const CLASS_SOURCE_HOOKS = {
  renderSource: () => 'canonical',
  extractLabels: extractClassLabels,
  // Loop 8 A1: the structured class verifier IS the verify path — verifyMermaid
  // routes class diagrams through this descriptor hook (Loop 9 M2 removed the
  // duplicate per-body branch). Single source of truth.
  verify: (body, opts) => (body.kind === 'class' ? verifyClass(body, opts) : []),
  buildSourceMap: buildClassSourceMap,
  .../* @__PURE__ */ structuredFamilyHooks('class', { parseBody: parseClassBody, serialize: renderClass, }),
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- ER -------------------------------------------------------------------
// CUSTOMER ||--o{ ORDER : places, attributes inside braces.
function extractErLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    let m
    if ((m = raw.match(/:\s*"?([^"]+?)"?$/))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    }
    // Attribute lines inside `{ ... }` blocks
    if (raw.match(/^\s*\w+\s+\w+/) && !raw.match(/[<>|}]/)) {
      out.push({ text: raw, target: `line${i + 1}` })
    }
  }
  return out
}

export const ER_SOURCE_HOOKS = {
  renderSource: () => 'canonical',
  extractLabels: extractErLabels,
  // Loop 8 A1: same as class — this hook is the verify path for ER (Loop 9 M2
  // removed the duplicate per-body branch in verify.ts).
  verify: (body, opts) => (body.kind === 'er' ? verifyErBody(body, opts) : []),
  buildSourceMap: buildErSourceMap,
  .../* @__PURE__ */ structuredFamilyHooks('er', {
    // Source normalization moves a statement written on the header line
    // (`erDiagram subgraph X`, repo #103) onto a line of its own
    // (splitHeaderStatement), so a structured header is bare.
    headerOk: h => /^erdiagram\s*$/i.test(h),
    parseBody: (lines, _accessibility, rawBodyLines) => parseErBody(lines, rawBodyLines),
    serialize: renderEr,
  }),
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Journey --------------------------------------------------------------
// title T, section S, task: 3: Me — label extraction rides the shared parse
// core walker (scan mode: issues are skipped, labels still flow), so opaque
// journey sources get overflow checks from the same grammar the parsers use.
function extractJourneyLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  const headerIndex = lines.findIndex(line => /^\s*journey\b/i.test(line))
  const push = (text: string, lineIndex: number): void => {
    for (const part of text.split('\n')) {
      if (part) out.push({ text: part, target: `line${lineIndex + 1}` })
    }
  }
  walkJourneyLines(lines, headerIndex + 1, {
    title: push,
    accTitle: push,
    accDescr: push,
    section: push,
    task: (text, _score, actors, lineIndex) => {
      push(text, lineIndex)
      for (const actor of actors) push(actor, lineIndex)
    },
  })
  return out
}

// Opaque-journey diagnostics re-derive the blocking issue from source with the
// SAME shared grammar the parsers use (src/journey/parse-core.ts), so the
// reported reason cannot drift from what the parser actually rejected — and
// comments / accDescr block interiors are never mistaken for bad task lines.
function verifyOpaqueJourney(body: DiagramBody): LayoutWarning[] {
  if (body.kind !== 'opaque' || body.family !== 'journey') return []
  const warnings: LayoutWarning[] = []
  const lines = body.source.split(/\r?\n/)
  // Skip the header line wherever it sits (leading blanks/comments preserved
  // in opaque source keep their positions, so line numbers stay truthful).
  const headerIndex = lines.findIndex(line => /^\s*journey\b/i.test(line))
  let blocking: JourneyParseIssue | undefined
  walkJourneyLines(lines, headerIndex + 1, {
    issue: issue => {
      if (issue.code === 'invalid_score') {
        warnings.push({
          code: 'UNSUPPORTED_SYNTAX',
          line: issue.lineIndex + 1,
          syntax: 'journey_invalid_score',
          message: `${issue.detail}.`,
        })
        return
      }
      blocking ??= issue
    },
  })
  if (blocking) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      line: blocking.lineIndex + 1,
      syntax: `journey_${blocking.code}`,
      message: `${blocking.detail}. The diagram is preserved verbatim as source; fix this line to unlock typed journey mutation.`,
    })
  }
  return warnings
}

export const JOURNEY_SOURCE_HOOKS = {
  renderSource: () => 'canonical',
  extractLabels: extractJourneyLabels,
  // BUILD-15: journey is structured-when-narrowed. The verify hook covers the
  // structured body; opaque fallbacks keep the universal label-extraction path.
  verify: (body, opts) => (body.kind === 'journey' ? verifyJourney(body, opts) : body.kind === 'opaque' ? verifyOpaqueJourney(body) : []),
  .../* @__PURE__ */ structuredFamilyHooks('journey', {
    ownsAccessibility: true,
    headerOk: h => /^journey\s*$/i.test(h),
    parseBody: (lines, accessibility) => {
      const outcome = parseJourneyBody(lines, accessibility)
      return outcome.ok ? outcome.body : null
    },
    serialize: renderJourney,
  }),
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- XY chart -------------------------------------------------------------
// title "T", x-axis [a,b,c], y-axis "label"
function extractXyChartLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!.trim()
    if (!rawLine || rawLine.startsWith('%%')) continue
    const statements = splitXyLabelStatements(rawLine)
    for (const raw of statements) {
      const target = `line${i + 1}`
      let m
      if ((m = raw.match(/^accDescr\s*:?\s*\{\s*(.*)$/i))) {
        const first = m[1]!
        const end = first.indexOf('}')
        if (end >= 0) {
          const text = first.slice(0, end).trim()
          if (text) out.push({ text, target })
        } else {
          const text = first.trim()
          if (text) out.push({ text, target })
          for (i += 1; i < lines.length; i++) {
            const line = lines[i]!.trim()
            const close = line.indexOf('}')
            const text = (close >= 0 ? line.slice(0, close) : line).trim()
            if (text) out.push({ text, target: `line${i + 1}` })
            if (close >= 0) break
          }
        }
        continue
      }
      if ((m = raw.match(/^accTitle\s*:?\s*(.+)$/i))) out.push({ text: m[1]!.trim(), target })
      else if ((m = raw.match(/^accDescr\s*:?\s*(.+)$/i))) out.push({ text: m[1]!.trim(), target })
      // All quoted strings, including escaped quote/backslash pairs.
      for (const q of quotedLabelMatches(raw)) out.push({ text: q, target })
      const title = raw.match(/^title\s+(.+)$/i)
      if (title && !/^['"]/.test(title[1]!.trim())) out.push({ text: title[1]!.trim(), target })
      const axisTitleWithCategories = raw.match(/^[xy]-axis\s+(.+?)\s*\[[^\]]+\]\s*$/i)
      const axisTitleWithRange = raw.match(/^[xy]-axis\s+(\S+)\s+[+-]?(?:(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*-->/i)
      const axisTitle = axisTitleWithCategories ?? axisTitleWithRange ?? raw.match(/^[xy]-axis\s+([^\[\d.+-][^\[]*?)\s*(?:\[|[+-]?\d|$)/i)
      if (axisTitle && !/^['"]/.test(axisTitle[1]!.trim())) out.push({ text: axisTitle[1]!.trim(), target })
      const seriesLabel = raw.match(/^(?:bar|line)\s+(.+?)\s+\[[^\]]+\]\s*$/i)
      if (seriesLabel && !/^['"]/.test(seriesLabel[1]!.trim())) out.push({ text: seriesLabel[1]!.trim(), target })
      // x-axis [a, b, c] — extract individual entries
      const ax = raw.match(/^[xy]-axis\b.*\[([^\]]+)\]/i)
      if (ax) {
        for (const entry of ax[1]!.split(',')) {
          const t = entry.trim().replace(/^["']|["']$/g, '')
          if (t) out.push({ text: t, target })
        }
      }
    }
  }
  return out
}

function quotedLabelMatches(raw: string): string[] {
  const labels: string[] = []
  for (const quote of ['"', "'"] as const) {
    const pattern = quote === '"' ? /"((?:\\.|[^"\\])+)"/g : /'((?:\\.|[^'\\])*)'/g
    for (const m of raw.matchAll(pattern)) labels.push(m[1]!.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
  }
  return labels
}

function splitXyLabelStatements(line: string): string[] {
  const statements: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (quote) {
      current += char
      if (char === '\\') {
        current += line[++i] ?? ''
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === ';') {
      const trimmed = current.trim()
      if (trimmed) statements.push(trimmed)
      current = ''
      continue
    }
    current += char
  }
  const trimmed = current.trim()
  if (trimmed) statements.push(trimmed)
  return statements
}

export const XYCHART_SOURCE_HOOKS = {
  renderSource: body => (body.kind === 'opaque' ? 'canonical' : 'serialized'),
  extractLabels: extractXyChartLabels,
  // BUILD-16: xychart is structured-when-narrowed. The verify hook covers the
  // structured body; opaque fallbacks (accTitle/accDescr, quoted text,
  // multi-statement `;` lines, unmodeled tokens like `curve basis`) keep the
  // universal label-extraction path. headerOk requires `xychart`/`xychart-beta`
  // with at most a `horizontal`/`vertical` orientation suffix — any other
  // trailing token (e.g. `EXTRA`) stays opaque so it round-trips verbatim.
  verify: (body, opts) => (body.kind === 'xychart' ? verifyXyChart(body, opts) : []),
  buildSourceMap: buildChartSourceMap,
  // Pass the complete family source to the shared XY grammar. Header spelling,
  // orientation, and same-line semicolon statements therefore have one parser
  // authority instead of a second regex in the agent projection.
  parse: ({ lines, opaqueSource, meta }) => {
    const body = parseXyChartBody(lines)
    if (!body) return ok({ kind: 'opaque', family: 'xychart', source: opaqueSource })
    // The family reads an accessibility directive written after a statement
    // on its line, which the envelope (directives that start a line) misses:
    // the envelope adopts it. When the envelope holds another value, Mermaid
    // keeps whichever is written last, which neither reader can tell, so the
    // source is kept (verify reports xychart_accessibility_order).
    if (!adoptStatementAccessibility(meta, { title: body.accessibilityTitle, descr: body.accessibilityDescription })) return ok({ kind: 'opaque', family: 'xychart', source: opaqueSource })
    return ok(body)
  },
  serialize: body => {
    if (body.kind !== 'xychart') throw new Error(`xychart serializer received body kind ${body.kind}`)
    return renderXyChart(body)
  },
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Pie ------------------------------------------------------------------
// pie [showData] [title T], optional `title T`, `"label" : number` entries.
// Pie is structured-when-narrowed: the body parses to a PieBody (title,
// showData, slices) or falls back to opaque when any line is unmodeled.
// Labels are the quoted slice labels plus the optional title text.
function extractPieLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    const target = `line${i + 1}`
    // Header may carry an inline title: `pie title Pets` / `pie showData title Pets`.
    let m
    if ((m = raw.match(/^pie\b\s*(?:showData\b\s*)?title\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target })
      continue
    }
    if (/^pie\b/i.test(raw)) continue
    if ((m = raw.match(/^title\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target })
      continue
    }
    // Entry line: `"label" : value` — extract the quoted label.
    if ((m = raw.match(/^"((?:[^"\\]|\\.)*)"\s*:/))) {
      const text = m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim()
      if (text) out.push({ text, target })
    }
  }
  return out
}

// Parse the `pie [showData] [title <text>]` header tail. Returns null when the
// tail carries unmodeled tokens, so the whole body falls back to opaque.
function parsePieHeader(header: string): { showData: boolean; title?: string } | null {
  const m = header.match(/^pie\b(.*)$/i)
  if (!m) return null
  let tail = m[1]!.trim()
  let showData = false
  const sd = tail.match(/^showData\b\s*(.*)$/i)
  if (sd) {
    showData = true
    tail = sd[1]!.trim()
  }
  const inlineTitle = tail.match(/^title\s+(.+)$/i)
  if (inlineTitle) return { showData, title: inlineTitle[1]!.trim() }
  if (tail.length > 0) return null // unexpected text after the header → opaque
  return { showData }
}

export const PIE_SOURCE_HOOKS = {
  renderSource: body => (body.kind === 'opaque' ? 'canonical' : 'serialized'),
  extractLabels: extractPieLabels,
  // Pie is structured-when-narrowed. The verify hook covers the structured
  // body; opaque fallbacks keep the universal label-extraction path. The header
  // carries showData / inline title, so pie uses a tailored parse hook (like
  // xychart) — serialize/mutate stay identical to every other structured family.
  verify: (body, opts) => (body.kind === 'pie' ? verifyPie(body, opts) : []),
  buildSourceMap: buildChartSourceMap,
  parse: ({ lines, opaqueSource }) => {
    const header = parsePieHeader(stripTrailingComment(lines[0]?.trim() ?? ''))
    const bodyLines = lines.slice(1).map(line => {
      const title = splitAuthoredPieTitleLine(line, 'body')
      return title ? title.decodedPrefix + title.authoredTitle : line
    })
    const body = header ? parsePieBody(bodyLines, header) : null
    return ok(body ?? { kind: 'opaque', family: 'pie', source: opaqueSource })
  },
  serialize: body => {
    if (body.kind !== 'pie') throw new Error(`pie serializer received body kind ${body.kind}`)
    return renderPie(body)
  },
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Quadrant -------------------------------------------------------------
// quadrantChart header; `title T`; `x-axis a --> b`; `y-axis a --> b`;
// `quadrant-1..4 label`; `Label: [x, y]`. Quadrant is structured-when-narrowed:
// the body parses to a QuadrantBody (title, axes, quadrant labels, points) or
// falls back to opaque when any line is unmodeled (unportable styling,
// malformed coords). Labels are the title, both axis label sides, the
// four quadrant region labels, and the point labels.
function extractQuadrantLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    const target = `line${i + 1}`
    if (/^quadrant(?:chart)?\b/i.test(raw)) continue
    let m
    if ((m = raw.match(/^title\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target })
      continue
    }
    // x-axis / y-axis: `<near> [--> <far>]` — extract both sides.
    if ((m = raw.match(/^[xy]-axis\s+(.+)$/i))) {
      const tail = m[1]!.trim()
      const arrow = tail.indexOf('-->')
      if (arrow >= 0) {
        const near = tail.slice(0, arrow).trim()
        const far = tail.slice(arrow + 3).trim()
        if (near) out.push({ text: near, target })
        if (far) out.push({ text: far, target })
      } else if (tail) {
        out.push({ text: tail, target })
      }
      continue
    }
    if ((m = raw.match(/^quadrant-[1-4]\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target })
      continue
    }
    // Point line: `Label[:::class]: [x, y] [style metadata]` — extract the
    // display label, not the optional class/style adornments.
    if ((m = raw.match(/^(.+?)\s*:\s*\[[^\]]*\]\s*(?:.*)?$/))) {
      const text = m[1]!.replace(/\s*:::\s*[A-Za-z_][\w-]*\s*$/, '').trim()
      if (text) out.push({ text, target })
    }
  }
  return out
}

function verifyOpaqueQuadrant(body: DiagramBody): LayoutWarning[] {
  if (body.kind !== 'opaque' || body.family !== 'quadrant') return []
  const warnings: LayoutWarning[] = []
  // Unrenderable opaque sources are the universal render-parity gate's job
  // (Tier-1 RENDER_FAILED in verifyMermaid) — this hook's remaining value is
  // the style-metadata lint, which scans raw lines and needs no parse.
  // Well-formed styles/classDefs parse STRUCTURED now (upstream #5173 is
  // modeled end to end), so these warnings only fire when style-looking
  // metadata rides on an OPAQUE body: either the metadata itself is malformed
  // (the renderer errors loudly on it) or another line forced the fallback.

  let sawPointStyle = false
  let sawClassDef = false
  for (const rawLine of body.source.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw || raw.startsWith('%%')) continue
    if (/^classDef\b/i.test(raw)) sawClassDef = true
    const point = raw.match(/^(.+?)\s*:\s*\[[^\]]*\]\s*(.*)$/)
    if (point && (point[1]!.includes(':::') || point[2]!.trim().length > 0)) sawPointStyle = true
  }
  if (sawPointStyle) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'quadrant_point_style_metadata',
      message: 'Quadrant point style/class metadata is present but this diagram fell back to an opaque body (malformed style metadata or other unmodeled syntax), so typed mutation cannot see the styles. Well-formed radius/color/stroke styling parses structured and renders.',
    })
  }
  if (sawClassDef) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'quadrant_classDef_metadata',
      message: 'Quadrant classDef metadata is present but this diagram fell back to an opaque body (malformed classDef or other unmodeled syntax), so typed mutation cannot see the classes. Well-formed classDefs parse structured and render.',
    })
  }
  return warnings
}

export const QUADRANT_SOURCE_HOOKS = {
  renderSource: body => (body.kind === 'opaque' ? 'canonical' : 'serialized'),
  extractLabels: extractQuadrantLabels,
  // Quadrant is structured-when-narrowed. The verify hook covers the structured
  // body; opaque fallbacks keep the universal label-extraction path and warn
  // when style-looking metadata is preserved on an opaque body.
  verify: (body, opts) => (body.kind === 'quadrant' ? verifyQuadrant(body, opts) : body.kind === 'opaque' ? verifyOpaqueQuadrant(body) : []),
  buildSourceMap: buildChartSourceMap,
  parse: ctx => {
    const source = normalizeMermaidSource(ctx.source.originalText, {}, 'render')
    let body: QuadrantBody | null
    try {
      body = /^quadrant(?:chart)?\s*$/i.test(stripTrailingComment(source.familyLines[0] ?? '')) ? parseQuadrantBody(source.familyLines.slice(1)) : null
    } catch (error) {
      if (error instanceof QuadrantCoordinateError) return err([{ code: 'PARSE_FAILED', message: error.message }])
      throw error
    }
    return ok(body ?? { kind: 'opaque', family: 'quadrant', source: ctx.opaqueSource })
  },
  serialize: body => {
    if (body.kind !== 'quadrant') throw new Error(`quadrant serializer received body kind ${body.kind}`)
    return renderQuadrant(body)
  },
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Gantt ------------------------------------------------------------------
// title T, section S, task lines `Label : meta`, plus directive labels that
// matter for LABEL_OVERFLOW on opaque bodies (accTitle/accDescr, todayMarker
// excluded — they are styling/config, not display labels).
function extractGanttLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (const statement of readGanttStatements(lines)) {
    const target = `line${statement.startLine}`
    if (statement.kind === 'title' || statement.kind === 'section') out.push({ text: statement.value, target })
    else if (statement.kind === 'task') out.push({ text: statement.label, target })
    else if (statement.kind === 'accessibility') out.push({ text: statement.directive.value, target })
  }
  return out
}

// Gantt parse needs the RAW (indentation-preserving) body lines so opaque
// segments (directives, click lines, comments) round-trip verbatim — the
// same wiring as sequence, except the header is located rather than assumed
// to be raw line 0 (leading blank lines must not duplicate the header).
function ganttRawBodyLines(opaqueSource: string): string[] {
  const raw = opaqueSource.split(/\r?\n/)
  const headerAt = raw.findIndex(l => /^gantt\b/i.test(l.trim()))
  return headerAt >= 0 ? raw.slice(headerAt + 1) : raw.slice(1)
}

export const GANTT_SOURCE_HOOKS = {
  renderSource: body => (body.kind === 'opaque' ? 'canonical' : 'serialized'),
  extractLabels: extractGanttLabels,
  // Source-level structural checks (EMPTY/LABEL_OVERFLOW/EDGE_MISANCHORED on
  // after/until refs); see docs/design/families/gantt.md §Verification.
  verify: (body, opts) => (body.kind === 'gantt' ? verifyGantt(body, opts) : []),
  buildSourceMap: buildGanttSourceMap,
  parse: ({ source, lines, opaqueSource }) => {
    const headerOk = /^gantt\s*$/i.test(stripTrailingComment(lines[0]?.trim() ?? ''))
    const body = headerOk ? parseGanttBody(lines.slice(1), ganttRawBodyLines(source.familyBody)) : null
    const axisFormat = getFrontmatterScalar<string>(source.frontmatter, ['gantt', 'axisFormat'])
    if (body && body.axisFormat === undefined && typeof axisFormat === 'string') body.axisFormat = axisFormat
    return ok(body ?? { kind: 'opaque', family: 'gantt', source: opaqueSource })
  },
  serialize: body => {
    if (body.kind !== 'gantt') throw new Error(`gantt serializer received body kind ${body.kind}`)
    return renderGantt(body)
  },
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Architecture ---------------------------------------------------------
// group api(cloud)[API], service db(database)[DB] in api
function extractArchitectureLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (const statement of readArchitectureStatements(lines)) {
    if (statement.kind === 'title') out.push({ text: statement.value, target: 'title' })
    else if (statement.kind === 'group' || statement.kind === 'service') out.push({ text: statement.declaration.title, target: `line${statement.startLine}` })
    else if (statement.kind === 'edge' && statement.edge.label !== undefined) out.push({ text: statement.edge.label, target: `line${statement.startLine}` })
  }
  return out
}

export const ARCHITECTURE_SOURCE_HOOKS = {
  renderSource: () => 'canonical',
  extractLabels: extractArchitectureLabels,
  // BUILD-17: architecture is structured-when-narrowed. The verify hook covers
  // the structured body; opaque fallbacks (accTitle/accDescr, {group} boundary
  // edges, unmodeled syntax) keep the universal label-extraction path.
  verify: (body, opts) => (body.kind === 'architecture' ? verifyArchitecture(body, opts) : body.kind === 'opaque' ? verifyOpaqueArchitectureIcons(body.source) : []),
  .../* @__PURE__ */ structuredFamilyHooks('architecture', {
    headerOk: h => /^architecture(?:-beta)?\s*$/i.test(stripTrailingComment(h)),
    parseBody: parseArchitectureBody,
    serialize: renderArchitecture,
  }),
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Mindmap ---------------------------------------------------------------
export const MINDMAP_SOURCE_HOOKS = {
  renderSource: () => 'serialized',
  extractLabels: extractLabelsGeneric,
  parse: ({ source, opaqueSource, meta }) => {
    try {
      meta.accessibility = readAuthoredGrammarAccessibility(meta.accessibility)
      // The opaque source starts at the header, after the wrapper's lines.
      const body = parseMindmapBody(source.familyBody, opaqueSource)
      return ok(mindmapSerializationProblem(body, opaqueSource) ? { kind: 'opaque', family: 'mindmap', source: opaqueSource } : body)
    } catch (error) {
      return err([{ code: 'PARSE_FAILED', message: error instanceof Error ? error.message : String(error) }])
    }
  },
  serialize: body => {
    if (body.kind !== 'mindmap') throw new Error(`mindmap serializer received body kind ${body.kind}`)
    return renderMindmapBody(body)
  },
  verify: (body, opts) => (body.kind === 'mindmap' ? verifyMindmap(body, opts) : []),
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- GitGraph --------------------------------------------------------------
export const GITGRAPH_SOURCE_HOOKS = {
  renderSource: () => 'serialized',
  extractLabels: extractLabelsGeneric,
  parse: ({ source, meta }) => {
    try {
      const merged: Record<string, unknown> = {
        ...(meta.frontmatter?.gitGraph && typeof meta.frontmatter.gitGraph === 'object' ? meta.frontmatter.gitGraph : {}),
      }
      const body = parseGitGraphBody(source.familyBody, {
        mainBranchName: typeof merged.mainBranchName === 'string' ? merged.mainBranchName : undefined,
        mainBranchOrder: typeof merged.mainBranchOrder === 'number' ? merged.mainBranchOrder : undefined,
        title: typeof meta.frontmatter?.title === 'string' ? meta.frontmatter.title : undefined,
      })
      return ok(body)
    } catch (error) {
      return err([{ code: 'PARSE_FAILED', message: error instanceof Error ? error.message : String(error) }])
    }
  },
  serialize: body => {
    if (body.kind !== 'gitgraph') throw new Error(`gitgraph serializer received body kind ${body.kind}`)
    return renderGitGraphBody(body)
  },
  verify: (body, opts): LayoutWarning[] => (body.kind === 'gitgraph' ? verifyGitGraph(body, opts) : []),
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Radar -----------------------------------------------------------------
// radar-beta header; `title`; `axis id["Label"], …`; `curve id["Label"]{…}`;
// `min/max/ticks/graticule/showLegend`. Radar is structured-when-narrowed: the
// body parses to a RadarBody or falls back to opaque (accTitle/accDescr,
// malformed lines, curves without axes). Labels are the title, axis labels, and curve
// labels.
function extractRadarLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    const target = `line${i + 1}`
    let m
    if ((m = raw.match(/^title\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target })
      continue
    }
    if (/^radar-beta\b/i.test(raw)) continue
    // axis / curve quoted labels: id["Label"] …
    for (const q of raw.matchAll(/\[\s*["']([^"'\]]+)["']\s*\]/g)) out.push({ text: q[1]!, target })
  }
  return out
}

export const RADAR_SOURCE_HOOKS = {
  renderSource: body => (body.kind === 'opaque' ? 'canonical' : 'serialized'),
  extractLabels: extractRadarLabels,
  // Radar is structured-when-narrowed. The verify hook covers the structured
  // body; opaque fallbacks keep the universal label-extraction path.
  verify: (body, opts) => (body.kind === 'radar' ? verifyRadar(body, opts) : []),
  buildSourceMap: buildChartSourceMap,
  // The grammar reads an accessibility directive after a statement on its
  // line, which the envelope adopts, as for XYChart.
  parse: ({ lines, opaqueSource, meta }) => {
    const parsed = /^radar-beta\s*:?\s*$/i.test(stripTrailingComment(lines[0]?.trim() ?? '')) ? parseRadarBody(lines.slice(1)) : null
    if (!parsed || !adoptStatementAccessibility(meta, parsed.accessibility)) return ok({ kind: 'opaque', family: 'radar', source: opaqueSource })
    return ok(parsed.body)
  },
  serialize: body => {
    if (body.kind !== 'radar') throw new Error(`radar serializer received body kind ${body.kind}`)
    return renderRadar(body)
  },
} satisfies Omit<FamilyOperations, 'mutate'>

// ---- Sankey ----------------------------------------------------------------
// sankey / sankey-beta header; CSV rows of `source,target,value` (RFC 4180
// subset). Sankey is structured-when-narrowed: the body parses to a
// SankeyBody or falls back to opaque (accTitle/accDescr, malformed rows,
// zero links). Labels are the node labels from the first two CSV columns.
const SANKEY_CSV_FIELD_RE = /"((?:[^"]|"")*)"|([^,]+)/g

function extractSankeyLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%') || /^sankey(?:-beta)?\b/i.test(raw)) continue
    const target = `line${i + 1}`
    const fields: string[] = []
    for (const m of raw.matchAll(SANKEY_CSV_FIELD_RE)) {
      fields.push(m[1] !== undefined ? m[1].replace(/""/g, '"') : (m[2] ?? '').trim())
    }
    for (const text of fields.slice(0, 2)) if (text) out.push({ text, target })
  }
  return out
}

export const SANKEY_SOURCE_HOOKS = {
  renderSource: () => 'serialized',
  extractLabels: extractSankeyLabels,
  // Sankey is structured-when-narrowed. The verify hook covers the structured
  // body; opaque fallbacks keep the universal label-extraction path.
  verify: (body, opts) => (body.kind === 'sankey' ? verifySankey(body, opts) : []),
  buildSourceMap: buildChartSourceMap,
  .../* @__PURE__ */ structuredFamilyHooks('sankey', {
    headerOk: h => /^sankey(?:-beta)?\s*$/i.test(h),
    parseBody: (lines, accessibility) => {
      // This family's metadata lives only in the universal envelope.
      const logical = readAuthoredGrammarAccessibility(accessibility)
      Object.assign(accessibility, logical)
      return parseSankeyBody(lines)
    },
    serialize: renderSankey,
  }),
} satisfies Omit<FamilyOperations, 'mutate'>

export const C4_SOURCE_HOOKS = {
  renderSource: body => (body.kind === 'opaque' ? 'canonical' : 'serialized'),
  parse: ctx => {
    try { return ok(parseC4Body(ctx.opaqueSource, ctx.meta.accessibility) ?? { kind: 'opaque', family: 'c4', source: ctx.opaqueSource }) }
    catch (error) {
      if (!(error instanceof C4AmbiguousArgumentError)) throw error
      return err([{ code: 'PARSE_FAILED', message: error.message }])
    }
  },
  serialize: body => {
    if (body.kind !== 'c4') throw new Error(`C4 serializer received body kind ${body.kind}`)
    return renderC4(body)
  },
  verify: (body, opts) => (body.kind === 'c4' ? lintC4(body, opts) : []),
  buildSourceMap: (body, source) => (body.kind === 'c4' ? buildC4SourceMap(body, source) : { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() }),
  extractLabels: source => {
    try {
      const body = parseC4Diagram(source)
      return [
        ...(body.title === undefined ? [] : [{ text: body.title, target: 'title' }]),
        ...body.elements.flatMap(element => [element.label, element.technology, element.description].filter((text): text is string => typeof text === 'string' && text.length > 0).map(text => ({ text, target: element.id }))),
        ...body.boundaries.map(boundary => ({ text: boundary.label, target: boundary.id })),
        ...body.relationships.flatMap(relationship => [relationship.label, relationship.technology, relationship.description].filter((text): text is string => typeof text === 'string' && text.length > 0).map(text => ({ text, target: relationship.id }))),
      ]
    } catch {
      return extractLabelsGeneric(source)
    }
  },
} satisfies Omit<FamilyOperations, 'mutate'>

export const BUILTIN_SOURCE_HOOKS = /* @__PURE__ */ Object.freeze({
  flowchart: FLOWCHART_SOURCE_HOOKS,
  state: STATE_SOURCE_HOOKS,
  sequence: SEQUENCE_SOURCE_HOOKS,
  timeline: TIMELINE_SOURCE_HOOKS,
  class: CLASS_SOURCE_HOOKS,
  er: ER_SOURCE_HOOKS,
  journey: JOURNEY_SOURCE_HOOKS,
  xychart: XYCHART_SOURCE_HOOKS,
  pie: PIE_SOURCE_HOOKS,
  quadrant: QUADRANT_SOURCE_HOOKS,
  gantt: GANTT_SOURCE_HOOKS,
  architecture: ARCHITECTURE_SOURCE_HOOKS,
  mindmap: MINDMAP_SOURCE_HOOKS,
  gitgraph: GITGRAPH_SOURCE_HOOKS,
  radar: RADAR_SOURCE_HOOKS,
  sankey: SANKEY_SOURCE_HOOKS,
  c4: C4_SOURCE_HOOKS,
  zenuml: ZENUML_SOURCE_HOOKS,
  eventmodeling: EVENTMODELING_SOURCE_HOOKS,
  ...STABLE_FAMILY_SOURCE_HOOKS,
}) satisfies Readonly<Record<DiagramKind, Omit<FamilyOperations, 'mutate'>>>
export { EVENTMODELING_SOURCE_HOOKS } from './eventmodeling-body.ts'
export { ZENUML_SOURCE_HOOKS } from './zenuml-body.ts'
