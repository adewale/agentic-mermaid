// ============================================================================
// Built-in family agent-operation definitions.
//
// Defines all built-in structured operations. The registry combines these
// hooks with each family's render hooks and metadata, validates the complete
// descriptor, and only then makes it discoverable. Structured families own
// their parse/serialize/mutate here (BUILD-3 consolidation): parseMermaid,
// serializeMermaid, and mutate dispatch through these hooks, so adding a
// family means one registration plus a body module — no core edits.
//
// Flowchart registers through `flowchartFamilyHooks('flowchart')` over the
// legacy MermaidGraph body (error semantics, contributes a SourceMap).
//
// State registers through `structuredFamilyHooks('state', …)` over the
// dedicated StateBody IR (BUILD-19): structured-or-opaque parse, state-shaped
// ops, an `asState` narrower, and a verify hook that runs body-level Tier 1
// checks (verify.ts adds the geometric Tier 2 pass via the graph projection).
// ============================================================================

import type { ExtractedLabel, FamilyOperations } from './families.ts'
import { extractLabelsGeneric } from './family-labels.ts'
import type { DiagramBody, DiagramKind, AnyMutationOp, MutationError, Result, LayoutWarning, SourceMap, ClassBody, ErBody, XyChartBody, PieBody, QuadrantBody, GanttBody, RadarBody } from './types.ts'
import { ok, err } from './types.ts'
import { verifyClass, parseClassBody, renderClass, mutateClass } from './class-body.ts'
import { verifyErBody, parseErBody, renderEr, mutateEr } from './er-body.ts'
import { parseSequenceBody, renderSequence, mutateSequence } from './sequence-body.ts'
import { parseTimelineBody, renderTimeline, mutateTimeline } from './timeline-body.ts'
import { parseJourneyBody, renderJourney, mutateJourney, verifyJourney } from './journey-body.ts'
import { walkJourneyLines, type JourneyParseIssue } from '../journey/parse-core.ts'
import { parseArchitectureBody, renderArchitecture, mutateArchitecture, verifyArchitecture, verifyOpaqueArchitectureIcons } from './architecture-body.ts'
import { parseXyChartBody, renderXyChart, mutateXyChart, verifyXyChart } from './xychart-body.ts'
import { parsePieBody, renderPie, mutatePie, verifyPie } from './pie-body.ts'
import { parseQuadrantBody, renderQuadrant, mutateQuadrant, verifyQuadrant } from './quadrant-body.ts'
import { parseStateBody, renderState, mutateState, verifyState } from './state-body.ts'
import { parseGanttBody, renderGantt, mutateGantt, verifyGantt } from './gantt-body.ts'
import { parseFlowchartBody, renderFlowchart, mutateFlowchart, buildFlowchartSourceMap, type FlowchartBody } from './flowchart-body.ts'
import { containsFlowchartOpaqueSyntax } from './flowchart-unsupported.ts'
import { parseMindmapBody, renderMindmapBody, mutateMindmap, verifyMindmap } from './mindmap-body.ts'
import { parseGitGraphBody, renderGitGraphBody, mutateGitGraph, verifyGitGraph } from './gitgraph-body.ts'
import { parseRadarBody, renderRadar, mutateRadar, verifyRadar } from './radar-body.ts'

// Build the structured-or-opaque hook set shared by every structured family
// that is not flowchart/state. `headerOk` gates structured parsing: families
// with meaningful header suffixes (timeline, journey) stay opaque when the
// header carries one, so the suffix round-trips verbatim.
function structuredFamilyHooks<K extends DiagramBody['kind'] & DiagramKind>(
  kind: K,
  opts: {
    headerOk?: (header: string) => boolean
    parseBody: (
      lines: string[],
      accessibility: import('./types.ts').Accessibility,
    ) => Extract<DiagramBody, { kind: K }> | null
    serialize: (body: Extract<DiagramBody, { kind: K }>) => string
    mutate: (body: Extract<DiagramBody, { kind: K }>, op: never) => Result<Extract<DiagramBody, { kind: K }>, MutationError>
  },
): Pick<FamilyOperations, 'parse' | 'serialize' | 'mutate'> {
  return {
    parse: (ctx) => {
      const lines = ctx.lines
      const { opaqueSource } = ctx
      const headerOk = opts.headerOk?.(lines[0]?.trim() ?? '') ?? true
      const body = headerOk ? opts.parseBody(lines.slice(1), ctx.meta.accessibility) : null
      return ok(body ?? { kind: 'opaque', family: kind, source: opaqueSource })
    },
    serialize: body => {
      if (body.kind !== kind) throw new Error(`${kind} serializer received body kind ${body.kind}`)
      return opts.serialize(body as Extract<DiagramBody, { kind: K }>)
    },
    mutate: (body: DiagramBody, op: AnyMutationOp) => {
      if (body.kind !== kind) return err<MutationError>({ code: 'INVALID_OP', message: `${kind} mutator received body kind ${body.kind}` })
      return opts.mutate(body as Extract<DiagramBody, { kind: K }>, op as never)
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
      const text = (m[1] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8] ?? '').trim()
      if (text) out.push({ text, target })
    }
  }
  return out
}

// Flowchart owns the legacy MermaidGraph body: the diagram kind selects the
// descriptor, which binds the flowchart header.
function flowchartFamilyHooks(): Pick<FamilyOperations, 'parse' | 'buildSourceMap' | 'serialize' | 'mutate'> {
  return {
    parse: ({ source, opaqueSource }) => {
      if (containsFlowchartOpaqueSyntax(source.familyText)) return ok<DiagramBody>({ kind: 'opaque', family: 'flowchart', source: opaqueSource })
      return parseFlowchartBody(source.familyText)
    },
    buildSourceMap: (body, canonicalSource) =>
      body.kind === 'flowchart' ? buildFlowchartSourceMap(body as FlowchartBody, canonicalSource) : { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() },
    serialize: body => {
      if (body.kind !== 'flowchart') throw new Error(`flowchart serializer received body kind ${body.kind}`)
      return renderFlowchart(body.graph, 'flowchart')
    },
    mutate: (body, op) => {
      if (body.kind !== 'flowchart') return err<MutationError>({ code: 'INVALID_OP', message: `flowchart mutator received body kind ${body.kind}` })
      return mutateFlowchart(body, op as never)
    },
  }
}

const FLOWCHART_AGENT_HOOKS = {
  extractLabels: extractFlowchartLabels,
  ...flowchartFamilyHooks(),
} satisfies FamilyOperations

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
    if ((m = raw.match(/^state\s+"([^"]+)"\s+as\s+/i))) {
      out.push({ text: m[1]!.trim(), target })
    } else if (raw.includes('-->') && raw.includes(':')) {
      const colon = raw.indexOf(':')
      out.push({ text: raw.slice(colon + 1).trim(), target })
    } else if ((m = raw.match(/^[\w\p{L}-]+\s*:\s*(.+)$/u))) {
      out.push({ text: m[1]!.trim(), target })
    } else if ((m = raw.match(/^note\s+(?:left of|right of)\s+\S+\s*:\s*(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target })
    }
  }
  return out
}

const STATE_AGENT_HOOKS = {
  extractLabels: extractStateLabels,
  // The verify hook covers body-level structural Tier 1 (EMPTY/MISANCHORED/
  // LABEL_OVERFLOW); verify.ts adds geometric Tier 2 via the graph projection.
  verify: (body, opts) => body.kind === 'state' ? verifyState(body, opts) : [],
  ...structuredFamilyHooks('state', {
    headerOk: h => /^statediagram(?:-v2)?\s*$/i.test(h),
    parseBody: parseStateBody, serialize: renderState, mutate: mutateState,
  }),
} satisfies FamilyOperations

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
const SEQUENCE_AGENT_HOOKS = {
  extractLabels: extractSequenceLabels,
  parse: ({ source, lines, opaqueSource }) => {
    const expandedLines = expandInlineSequenceStatements(lines)
    const rawBodyLines = sequenceRawBodyLines(source.familyBody, expandedLines)
    const body = parseSequenceBody(expandedLines.slice(1), rawBodyLines)
    return ok(body ?? { kind: 'opaque', family: 'sequence', source: opaqueSource })
  },
  serialize: body => {
    if (body.kind !== 'sequence') throw new Error(`sequence serializer received body kind ${body.kind}`)
    return renderSequence(body)
  },
  mutate: (body, op) => {
    if (body.kind !== 'sequence') return err<MutationError>({ code: 'INVALID_OP', message: `sequence mutator received body kind ${body.kind}` })
    return mutateSequence(body, op as never)
  },
} satisfies FamilyOperations

function expandInlineSequenceStatements(lines: readonly string[]): string[] {
  const header = lines[0]?.trim() ?? ''
  if (!/^sequenceDiagram\s*;/i.test(header)) return [...lines]
  return [...header.split(';').map(part => part.trim()).filter(Boolean), ...lines.slice(1)]
}

function sequenceRawBodyLines(opaqueSource: string, expandedLines: string[]): string[] {
  const raw = opaqueSource.split(/\r?\n/)
  const headerAt = raw.findIndex(l => /^sequenceDiagram\b/i.test(l.trim()))
  if (headerAt >= 0 && raw[headerAt]!.includes(';')) return expandedLines.slice(1)
  return headerAt >= 0 ? raw.slice(headerAt + 1) : raw.slice(1)
}

// ---- Timeline -------------------------------------------------------------
function extractTimelineLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    let m
    if ((m = raw.match(/^title\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^section\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if (raw.includes(':')) {
      // `<period> : <event> [: <event>...]` or continuation `: <event>`
      const parts = raw.split(':').map(p => p.trim()).filter(Boolean)
      for (const p of parts) out.push({ text: p, target: `line${i + 1}` })
    }
  }
  return out
}

// Upstream PR #7270: the header may carry an LR/TD direction token
// (`timeline TD` = vertical). It is part of the modeled grammar — captured on
// the body so it survives serialize — while any OTHER header suffix still
// falls back to a verbatim opaque body (structuredFamilyHooks headerOk
// convention, spelled out here because the hook needs the header line).
const TIMELINE_BODY_HEADER_RE = /^timeline(?:\s+(LR|TD))?\s*$/i

const TIMELINE_AGENT_HOOKS = {
  extractLabels: extractTimelineLabels,
  parse: ({ lines, opaqueSource, meta }) => {
    const header = (lines[0]?.trim() ?? '').match(TIMELINE_BODY_HEADER_RE)
    const body = header ? parseTimelineBody(lines.slice(1), meta.accessibility) : null
    if (body && header?.[1]) body.direction = header[1].toUpperCase() as 'LR' | 'TD'
    return ok(body ?? { kind: 'opaque', family: 'timeline', source: opaqueSource })
  },
  serialize: body => {
    if (body.kind !== 'timeline') throw new Error(`timeline serializer received body kind ${body.kind}`)
    return renderTimeline(body)
  },
  mutate: (body, op) => {
    if (body.kind !== 'timeline') return err<MutationError>({ code: 'INVALID_OP', message: `timeline mutator received body kind ${body.kind}` })
    return mutateTimeline(body, op as never)
  },
} satisfies FamilyOperations

// ---- Class ---------------------------------------------------------------
// class Name { +member ... }, Class : +member, class A as "Display Label"
function emptySourceMap(): SourceMap { return { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() } }
function loc(line: number, col: number): { line: number; col: number } { return { line, col: Math.max(1, col) } }
function firstIndex(line: string, text: string): number { const i = line.indexOf(text); return i >= 0 ? i + 1 : 1 }

function buildClassSourceMap(body: DiagramBody, canonicalSource: string): SourceMap {
  const map = emptySourceMap()
  if (body.kind !== 'class') return map
  const b = body as ClassBody
  const lines = canonicalSource.split(/\r?\n/)
  for (const c of b.classes) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (new RegExp(`\\b${escapeSourceMapRegex(c.id)}\\b`).test(line)) { map.nodes.set(c.id, loc(i + 1, firstIndex(line, c.id))); break }
    }
    c.members.forEach((member, index) => {
      for (let i = 0; i < lines.length; i++) {
        const col = lines[i]!.indexOf(member)
        if (col >= 0) { map.labels.set(`class:${c.id}:member#${index}`, loc(i + 1, col + 1)); break }
      }
    })
  }
  b.relations.forEach((r, index) => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (!line.includes(r.from) || !line.includes(r.to)) continue
      const key = `rel#${index}:${r.from}->${r.to}`
      map.edges.set(key, loc(i + 1, firstIndex(line, r.from)))
      if (r.label) {
        const labelCol = line.lastIndexOf(r.label)
        if (labelCol >= 0) map.labels.set(key, loc(i + 1, labelCol + 1))
      }
      if (r.fromCardinality) {
        const col = line.indexOf(`"${r.fromCardinality}"`)
        if (col >= 0) map.labels.set(`${key}:fromCardinality`, loc(i + 1, col + 2))
      }
      if (r.toCardinality) {
        const col = line.indexOf(`"${r.toCardinality}"`)
        if (col >= 0) map.labels.set(`${key}:toCardinality`, loc(i + 1, col + 2))
      }
      break
    }
  })
  return map
}

function buildErSourceMap(body: DiagramBody, canonicalSource: string): SourceMap {
  const map = emptySourceMap()
  if (body.kind !== 'er') return map
  const b = body as ErBody
  const lines = canonicalSource.split(/\r?\n/)
  for (const e of b.entities) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (new RegExp(`\\b${escapeSourceMapRegex(e.id)}\\b`).test(line)) { map.nodes.set(e.id, loc(i + 1, firstIndex(line, e.id))); break }
    }
    e.attributes.forEach((attr, index) => {
      for (let i = 0; i < lines.length; i++) {
        const col = lines[i]!.indexOf(attr.text)
        if (col >= 0) { map.labels.set(`er:${e.id}:attr#${index}`, loc(i + 1, col + 1)); break }
      }
    })
  }
  b.relations.forEach((r, index) => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (!line.includes(r.from) || !line.includes(r.to)) continue
      const key = `rel#${index}:${r.from}->${r.to}`
      map.edges.set(key, loc(i + 1, firstIndex(line, r.from)))
      if (r.label) {
        const labelCol = line.lastIndexOf(r.label)
        if (labelCol >= 0) map.labels.set(key, loc(i + 1, labelCol + 1))
      }
      const between = line.slice(line.indexOf(r.from) + r.from.length, line.indexOf(r.to))
      const relStart = line.indexOf(between)
      const cardMatches = [...between.matchAll(/[|o}{]{2}/g)]
      if (cardMatches[0]) map.labels.set(`${key}:leftCardinality`, loc(i + 1, relStart + cardMatches[0].index! + 1))
      if (cardMatches[1]) map.labels.set(`${key}:rightCardinality`, loc(i + 1, relStart + cardMatches[1].index! + 1))
      break
    }
  })
  return map
}

function buildChartSourceMap(body: DiagramBody, canonicalSource: string): SourceMap {
  const map = emptySourceMap()
  const lines = canonicalSource.split(/\r?\n/)
  if (body.kind === 'xychart') {
    const b = body as XyChartBody
    b.series.forEach((series, si) => {
      const lineIndex = lines.findIndex(line => line.trim().startsWith(series.kind))
      if (lineIndex < 0) return
      const line = lines[lineIndex]!
      if (series.name) map.labels.set(`xychart:${series.id}:name`, loc(lineIndex + 1, firstIndex(line, series.name)))
      series.values.forEach((value, vi) => {
        const valueText = String(value)
        const col = line.indexOf(valueText)
        if (col >= 0) map.labels.set(`xychart:${series.id}:point#${vi}`, loc(lineIndex + 1, col + 1))
      })
    })
  } else if (body.kind === 'pie') {
    ;(body as PieBody).slices.forEach((slice, index) => {
      const lineIndex = lines.findIndex(line => line.includes(slice.label))
      if (lineIndex >= 0) map.labels.set(`pie:slice#${index}`, loc(lineIndex + 1, firstIndex(lines[lineIndex]!, slice.label)))
    })
  } else if (body.kind === 'quadrant') {
    ;(body as QuadrantBody).points.forEach((point, index) => {
      const lineIndex = lines.findIndex(line => line.includes(point.label))
      if (lineIndex >= 0) map.labels.set(`quadrant:point#${index}`, loc(lineIndex + 1, firstIndex(lines[lineIndex]!, point.label)))
    })
  } else if (body.kind === 'radar') {
    const b = body as RadarBody
    b.axes.forEach((axis, index) => {
      const lineIndex = lines.findIndex(line => /^\s*axis\b/i.test(line) && line.includes(axis.id))
      if (lineIndex >= 0) map.labels.set(`radar:axis#${index}`, loc(lineIndex + 1, firstIndex(lines[lineIndex]!, axis.id)))
    })
    b.curves.forEach((curve, index) => {
      const lineIndex = lines.findIndex(line => /^\s*curve\b/i.test(line) && line.includes(curve.id))
      if (lineIndex >= 0) map.labels.set(`radar:curve#${index}`, loc(lineIndex + 1, firstIndex(lines[lineIndex]!, curve.id)))
    })
  }
  return map
}

function buildGanttSourceMap(body: DiagramBody, canonicalSource: string): SourceMap {
  const map = emptySourceMap()
  if (body.kind !== 'gantt') return map
  const b = body as GanttBody
  const lines = canonicalSource.split(/\r?\n/)
  for (const section of b.sections) {
    if (section.label) {
      const lineIndex = lines.findIndex(line => /^\s*section\s+/i.test(line) && line.includes(section.label!))
      if (lineIndex >= 0) { map.groups.set(section.id, loc(lineIndex + 1, firstIndex(lines[lineIndex]!, section.label))); map.labels.set(`gantt:${section.id}:label`, loc(lineIndex + 1, firstIndex(lines[lineIndex]!, section.label))) }
    }
    for (const task of section.tasks) {
      const stableId = task.taskId ?? task.id
      const lineIndex = lines.findIndex(line => line.includes(task.label) && line.includes(task.end))
      if (lineIndex < 0) continue
      const line = lines[lineIndex]!
      map.nodes.set(stableId, loc(lineIndex + 1, firstIndex(line, task.label)))
      map.labels.set(`gantt:task:${stableId}`, loc(lineIndex + 1, firstIndex(line, task.label)))
    }
  }
  return map
}

function escapeSourceMapRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

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

const CLASS_AGENT_HOOKS = {
  extractLabels: extractClassLabels,
  // Loop 8 A1: the structured class verifier IS the verify path — verifyMermaid
  // routes class diagrams through this descriptor hook (Loop 9 M2 removed the
  // duplicate per-body branch). Single source of truth.
  verify: (body, opts) => body.kind === 'class' ? verifyClass(body, opts) : [],
  buildSourceMap: buildClassSourceMap,
  ...structuredFamilyHooks('class', { parseBody: parseClassBody, serialize: renderClass, mutate: mutateClass }),
} satisfies FamilyOperations

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

const ER_AGENT_HOOKS = {
  extractLabels: extractErLabels,
  // Loop 8 A1: same as class — this hook is the verify path for ER (Loop 9 M2
  // removed the duplicate per-body branch in verify.ts).
  verify: (body, opts) => body.kind === 'er' ? verifyErBody(body, opts) : [],
  buildSourceMap: buildErSourceMap,
  ...structuredFamilyHooks('er', {
    // A header-riding subgraph clause (`erDiagram subgraph X`, repo #103) is
    // tolerated by the renderer but unmodeled here: keep the body opaque so
    // the clause round-trips verbatim instead of being dropped on serialize.
    headerOk: h => /^erdiagram\s*$/i.test(h),
    parseBody: parseErBody, serialize: renderEr, mutate: mutateEr,
  }),
} satisfies FamilyOperations

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

const JOURNEY_AGENT_HOOKS = {
  extractLabels: extractJourneyLabels,
  // BUILD-15: journey is structured-when-narrowed. The verify hook covers the
  // structured body; opaque fallbacks keep the universal label-extraction path.
  verify: (body, opts) => body.kind === 'journey'
    ? verifyJourney(body, opts)
    : body.kind === 'opaque' ? verifyOpaqueJourney(body) : [],
  ...structuredFamilyHooks('journey', {
    headerOk: h => /^journey\s*$/i.test(h),
    parseBody: (lines, accessibility) => {
      const outcome = parseJourneyBody(lines, accessibility)
      return outcome.ok ? outcome.body : null
    },
    serialize: renderJourney, mutate: mutateJourney,
  }),
} satisfies FamilyOperations

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
      if (char === '\\') { current += line[++i] ?? ''; continue }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
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

const XYCHART_AGENT_HOOKS = {
  extractLabels: extractXyChartLabels,
  // BUILD-16: xychart is structured-when-narrowed. The verify hook covers the
  // structured body; opaque fallbacks (accTitle/accDescr, quoted text,
  // multi-statement `;` lines, unmodeled tokens like `curve basis`) keep the
  // universal label-extraction path. headerOk requires `xychart`/`xychart-beta`
  // with at most a `horizontal`/`vertical` orientation suffix — any other
  // trailing token (e.g. `EXTRA`) stays opaque so it round-trips verbatim.
  verify: (body, opts) => body.kind === 'xychart' ? verifyXyChart(body, opts) : [],
  buildSourceMap: buildChartSourceMap,
  // xychart needs the header to model the `horizontal` orientation suffix, so it
  // uses a tailored parse hook (not the shared structuredFamilyHooks) — but
  // serialize/mutate stay identical to every other structured family.
  parse: ({ lines, opaqueSource }) => {
    const header = lines[0]?.trim() ?? ''
    const hm = header.match(/^xychart(?:-beta)?(?:\s+(horizontal|vertical))?\s*$/i)
    const body = hm ? parseXyChartBody(lines.slice(1)) : null
    if (body && hm?.[1]) body.horizontal = hm[1].toLowerCase() === 'horizontal'
    return ok(body ?? { kind: 'opaque', family: 'xychart', source: opaqueSource })
  },
  serialize: body => {
    if (body.kind !== 'xychart') throw new Error(`xychart serializer received body kind ${body.kind}`)
    return renderXyChart(body)
  },
  mutate: (body, op) => {
    if (body.kind !== 'xychart') return err<MutationError>({ code: 'INVALID_OP', message: `xychart mutator received body kind ${body.kind}` })
    return mutateXyChart(body, op as never)
  },
} satisfies FamilyOperations

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
  if (sd) { showData = true; tail = sd[1]!.trim() }
  const inlineTitle = tail.match(/^title\s+(.+)$/i)
  if (inlineTitle) return { showData, title: inlineTitle[1]!.trim() }
  if (tail.length > 0) return null // unexpected text after the header → opaque
  return { showData }
}

const PIE_AGENT_HOOKS = {
  extractLabels: extractPieLabels,
  // Pie is structured-when-narrowed. The verify hook covers the structured
  // body; opaque fallbacks keep the universal label-extraction path. The header
  // carries showData / inline title, so pie uses a tailored parse hook (like
  // xychart) — serialize/mutate stay identical to every other structured family.
  verify: (body, opts) => body.kind === 'pie' ? verifyPie(body, opts) : [],
  buildSourceMap: buildChartSourceMap,
  parse: ({ lines, opaqueSource }) => {
    const header = parsePieHeader(lines[0]?.trim() ?? '')
    const body = header ? parsePieBody(lines.slice(1), header) : null
    return ok(body ?? { kind: 'opaque', family: 'pie', source: opaqueSource })
  },
  serialize: body => {
    if (body.kind !== 'pie') throw new Error(`pie serializer received body kind ${body.kind}`)
    return renderPie(body)
  },
  mutate: (body, op) => {
    if (body.kind !== 'pie') return err<MutationError>({ code: 'INVALID_OP', message: `pie mutator received body kind ${body.kind}` })
    return mutatePie(body, op as never)
  },
} satisfies FamilyOperations

// ---- Quadrant -------------------------------------------------------------
// quadrantChart header; `title T`; `x-axis a --> b`; `y-axis a --> b`;
// `quadrant-1..4 label`; `Label: [x, y]`. Quadrant is structured-when-narrowed:
// the body parses to a QuadrantBody (title, axes, quadrant labels, points) or
// falls back to opaque when any line is unmodeled (styling, malformed coords,
// duplicate point labels). Labels are the title, both axis label sides, the
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

const QUADRANT_AGENT_HOOKS = {
  extractLabels: extractQuadrantLabels,
  // Quadrant is structured-when-narrowed. The verify hook covers the structured
  // body; opaque fallbacks keep the universal label-extraction path and warn
  // when style-looking metadata is preserved on an opaque body.
  verify: (body, opts) => body.kind === 'quadrant'
    ? verifyQuadrant(body, opts)
    : body.kind === 'opaque' ? verifyOpaqueQuadrant(body) : [],
  buildSourceMap: buildChartSourceMap,
  ...structuredFamilyHooks('quadrant', {
    headerOk: h => /^quadrant(?:chart)?\s*$/i.test(h),
    parseBody: parseQuadrantBody, serialize: renderQuadrant, mutate: mutateQuadrant,
  }),
} satisfies FamilyOperations

// ---- Gantt ------------------------------------------------------------------
// title T, section S, task lines `Label : meta`, plus directive labels that
// matter for LABEL_OVERFLOW on opaque bodies (accTitle/accDescr, todayMarker
// excluded — they are styling/config, not display labels).
function extractGanttLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    const target = `line${i + 1}`
    let m
    if (/^gantt\s*$/i.test(raw)) continue
    if ((m = raw.match(/^(?:title|section)\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target })
      continue
    }
    if ((m = raw.match(/^acc(?:Title|Descr)\s*:\s*(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target })
      continue
    }
    // Directive lines carry config values, not labels.
    if (/^(dateFormat|axisFormat|tickInterval|inclusiveEndDates|topAxis|excludes|includes|todayMarker|weekday|weekend|click|accDescr)\b/i.test(raw)) continue
    // Task line: the label is everything before the first colon.
    const colon = raw.indexOf(':')
    if (colon > 0) {
      const text = raw.slice(0, colon).trim()
      if (text) out.push({ text, target })
    }
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

const GANTT_AGENT_HOOKS = {
  extractLabels: extractGanttLabels,
  // Source-level structural checks (EMPTY/LABEL_OVERFLOW/EDGE_MISANCHORED on
  // after/until refs); see docs/design/families/gantt.md §Verification.
  verify: (body, opts) => body.kind === 'gantt' ? verifyGantt(body, opts) : [],
  buildSourceMap: buildGanttSourceMap,
  parse: ({ source, lines, opaqueSource }) => {
    const headerOk = /^gantt\s*$/i.test(lines[0]?.trim() ?? '')
    const body = headerOk ? parseGanttBody(lines.slice(1), ganttRawBodyLines(source.familyBody)) : null
    return ok(body ?? { kind: 'opaque', family: 'gantt', source: opaqueSource })
  },
  serialize: body => {
    if (body.kind !== 'gantt') throw new Error(`gantt serializer received body kind ${body.kind}`)
    return renderGantt(body)
  },
  mutate: (body, op) => {
    if (body.kind !== 'gantt') return err<MutationError>({ code: 'INVALID_OP', message: `gantt mutator received body kind ${body.kind}` })
    return mutateGantt(body, op as never)
  },
} satisfies FamilyOperations

// ---- Architecture ---------------------------------------------------------
// group api(cloud)[API], service db(database)[DB] in api
function extractArchitectureLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    const title = raw.match(/^title\s+(.+)$/i)
    if (title) out.push({ text: title[1]!.trim(), target: 'title' })
    for (const m of raw.matchAll(/\[([^\]]+)\]/g)) {
      out.push({ text: m[1]!, target: `line${i + 1}` })
    }
  }
  return out
}

const ARCHITECTURE_AGENT_HOOKS = {
  extractLabels: extractArchitectureLabels,
  // BUILD-17: architecture is structured-when-narrowed. The verify hook covers
  // the structured body; opaque fallbacks (accTitle/accDescr, {group} boundary
  // edges, unmodeled syntax) keep the universal label-extraction path.
  verify: (body, opts) => body.kind === 'architecture'
    ? verifyArchitecture(body, opts)
    : body.kind === 'opaque' ? verifyOpaqueArchitectureIcons(body.source) : [],
  ...structuredFamilyHooks('architecture', {
    headerOk: h => /^architecture(?:-beta)?\s*$/i.test(h),
    parseBody: parseArchitectureBody, serialize: renderArchitecture, mutate: mutateArchitecture,
  }),
} satisfies FamilyOperations

// ---- Mindmap ---------------------------------------------------------------
const MINDMAP_AGENT_HOOKS = {
  extractLabels: extractLabelsGeneric,
  parse: ({ source }) => {
    try { return ok(parseMindmapBody(source.familyBody)) }
    catch (error) { return err([{ code: 'PARSE_FAILED', message: error instanceof Error ? error.message : String(error) }]) }
  },
  serialize: body => {
    if (body.kind !== 'mindmap') throw new Error(`mindmap serializer received body kind ${body.kind}`)
    return renderMindmapBody(body)
  },
  mutate: (body, op) => body.kind === 'mindmap'
    ? mutateMindmap(body, op as never)
    : err({ code: 'INVALID_OP', message: `mindmap mutator received body kind ${body.kind}` }),
  verify: (body, opts) => body.kind === 'mindmap' ? verifyMindmap(body, opts) : [],
} satisfies FamilyOperations

// ---- GitGraph --------------------------------------------------------------
const GITGRAPH_AGENT_HOOKS = {
  extractLabels: extractLabelsGeneric,
  parse: ({ source, meta }) => {
    try {
      const merged: Record<string, unknown> = {
        ...((meta.frontmatter?.gitGraph && typeof meta.frontmatter.gitGraph === 'object') ? meta.frontmatter.gitGraph : {}),
      }
      for (const directive of meta.initDirectives) {
        const section = directive.parsed?.gitGraph
        if (section && typeof section === 'object') Object.assign(merged, section)
      }
      return ok(parseGitGraphBody(source.familyBody, {
        mainBranchName: typeof merged.mainBranchName === 'string' ? merged.mainBranchName : undefined,
        mainBranchOrder: typeof merged.mainBranchOrder === 'number' ? merged.mainBranchOrder : undefined,
        title: typeof meta.frontmatter?.title === 'string' ? meta.frontmatter.title : undefined,
      }))
    } catch (error) { return err([{ code: 'PARSE_FAILED', message: error instanceof Error ? error.message : String(error) }]) }
  },
  serialize: body => {
    if (body.kind !== 'gitgraph') throw new Error(`gitgraph serializer received body kind ${body.kind}`)
    return renderGitGraphBody(body)
  },
  mutate: (body, op) => body.kind === 'gitgraph'
    ? mutateGitGraph(body, op as never)
    : err({ code: 'INVALID_OP', message: `gitgraph mutator received body kind ${body.kind}` }),
  verify: (body, opts) => body.kind === 'gitgraph' ? verifyGitGraph(body, opts) : [],
} satisfies FamilyOperations

// ---- Radar -----------------------------------------------------------------
// radar-beta header; `title`; `axis id["Label"], …`; `curve id["Label"]{…}`;
// `min/max/ticks/graticule/showLegend`. Radar is structured-when-narrowed: the
// body parses to a RadarBody or falls back to opaque (accTitle/accDescr,
// malformed lines, zero axes). Labels are the title, axis labels, and curve
// labels.
function extractRadarLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    const target = `line${i + 1}`
    let m
    if ((m = raw.match(/^title\s+(.+)$/i))) { out.push({ text: m[1]!.trim(), target }); continue }
    if (/^radar-beta\b/i.test(raw)) continue
    // axis / curve quoted labels: id["Label"] …
    for (const q of raw.matchAll(/\[\s*["']([^"'\]]+)["']\s*\]/g)) out.push({ text: q[1]!, target })
  }
  return out
}

const RADAR_AGENT_HOOKS = {
  extractLabels: extractRadarLabels,
  // Radar is structured-when-narrowed. The verify hook covers the structured
  // body; opaque fallbacks keep the universal label-extraction path.
  verify: (body, opts) => body.kind === 'radar' ? verifyRadar(body, opts) : [],
  buildSourceMap: buildChartSourceMap,
  ...structuredFamilyHooks('radar', {
    headerOk: h => /^radar-beta\s*:?\s*$/i.test(h),
    parseBody: parseRadarBody, serialize: renderRadar, mutate: mutateRadar,
  }),
} satisfies FamilyOperations

export const BUILTIN_AGENT_HOOKS = Object.freeze({
  flowchart: FLOWCHART_AGENT_HOOKS,
  state: STATE_AGENT_HOOKS,
  sequence: SEQUENCE_AGENT_HOOKS,
  timeline: TIMELINE_AGENT_HOOKS,
  class: CLASS_AGENT_HOOKS,
  er: ER_AGENT_HOOKS,
  journey: JOURNEY_AGENT_HOOKS,
  xychart: XYCHART_AGENT_HOOKS,
  pie: PIE_AGENT_HOOKS,
  quadrant: QUADRANT_AGENT_HOOKS,
  gantt: GANTT_AGENT_HOOKS,
  architecture: ARCHITECTURE_AGENT_HOOKS,
  mindmap: MINDMAP_AGENT_HOOKS,
  gitgraph: GITGRAPH_AGENT_HOOKS,
  radar: RADAR_AGENT_HOOKS,
}) satisfies Readonly<Record<DiagramKind, FamilyOperations>>
