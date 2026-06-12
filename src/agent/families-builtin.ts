// ============================================================================
// Built-in family registrations.
//
// Registers all 9 families with the plugin registry. Structured families own
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

import { registerFamily, extractLabelsGeneric, type ExtractedLabel, type FamilyPlugin } from './families.ts'
import type { DiagramBody, DiagramKind, AnyMutationOp, MutationError, Result } from './types.ts'
import { ok, err } from './types.ts'
import { verifyClass, parseClassBody, renderClass, mutateClass } from './class-body.ts'
import { verifyErBody, parseErBody, renderEr, mutateEr } from './er-body.ts'
import { parseSequenceBody, renderSequence, mutateSequence } from './sequence-body.ts'
import { parseTimelineBody, renderTimeline, mutateTimeline } from './timeline-body.ts'
import { parseJourneyBody, renderJourney, mutateJourney, verifyJourney } from './journey-body.ts'
import { parseArchitectureBody, renderArchitecture, mutateArchitecture, verifyArchitecture } from './architecture-body.ts'
import { parseXyChartBody, renderXyChart, mutateXyChart, verifyXyChart } from './xychart-body.ts'
import { parsePieBody, renderPie, mutatePie, verifyPie } from './pie-body.ts'
import { parseQuadrantBody, renderQuadrant, mutateQuadrant, verifyQuadrant } from './quadrant-body.ts'
import { parseStateBody, renderState, mutateState, verifyState } from './state-body.ts'
import { parseFlowchartBody, renderFlowchart, mutateFlowchart, buildFlowchartSourceMap, type FlowchartBody } from './flowchart-body.ts'

// Build the structured-or-opaque hook set shared by every structured family
// that is not flowchart/state. `headerOk` gates structured parsing: families
// with meaningful header suffixes (timeline, journey) stay opaque when the
// header carries one, so the suffix round-trips verbatim.
function structuredFamilyHooks<K extends DiagramBody['kind'] & DiagramKind>(
  kind: K,
  opts: {
    headerOk?: (header: string) => boolean
    parseBody: (lines: string[]) => Extract<DiagramBody, { kind: K }> | null
    serialize: (body: Extract<DiagramBody, { kind: K }>) => string
    mutate: (body: Extract<DiagramBody, { kind: K }>, op: never) => Result<Extract<DiagramBody, { kind: K }>, MutationError>
  },
): Pick<FamilyPlugin, 'parse' | 'serialize' | 'mutate'> {
  return {
    parse: (lines, opaqueSource) => {
      const headerOk = opts.headerOk?.(lines[0]?.trim() ?? '') ?? true
      const body = headerOk ? opts.parseBody(lines.slice(1)) : null
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
// plugin, which binds the flowchart header.
function flowchartFamilyHooks(): Pick<FamilyPlugin, 'parse' | 'buildSourceMap' | 'serialize' | 'mutate'> {
  return {
    parse: (_lines, _opaqueSource, _meta, canonicalSource) => parseFlowchartBody(canonicalSource),
    buildSourceMap: (body, canonicalSource) =>
      buildFlowchartSourceMap(body as FlowchartBody, canonicalSource),
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

registerFamily({
  id: 'flowchart',
  detect: l => l.startsWith('flowchart') || l.startsWith('graph'),
  extractLabels: extractFlowchartLabels,
  ...flowchartFamilyHooks(),
})

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

registerFamily({
  id: 'state',
  detect: l => l.startsWith('statediagram') || l.startsWith('statediagram-v2'),
  extractLabels: extractStateLabels,
  // The verify hook covers body-level structural Tier 1 (EMPTY/MISANCHORED/
  // LABEL_OVERFLOW); verify.ts adds geometric Tier 2 via the graph projection.
  verify: (body, opts) => body.kind === 'state' ? verifyState(body, opts) : [],
  ...structuredFamilyHooks('state', {
    headerOk: h => /^statediagram(?:-v2)?\s*$/i.test(h),
    parseBody: parseStateBody, serialize: renderState, mutate: mutateState,
  }),
})

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
registerFamily({
  id: 'sequence',
  detect: l => l.startsWith('sequencediagram'),
  extractLabels: extractSequenceLabels,
  parse: (lines, opaqueSource) => {
    const rawBodyLines = opaqueSource.split(/\r?\n/).slice(1)
    const body = parseSequenceBody(lines.slice(1), rawBodyLines)
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
})

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

registerFamily({
  id: 'timeline',
  detect: l => l.startsWith('timeline'),
  extractLabels: extractTimelineLabels,
  ...structuredFamilyHooks('timeline', {
    headerOk: h => /^timeline\s*$/i.test(h),
    parseBody: parseTimelineBody, serialize: renderTimeline, mutate: mutateTimeline,
  }),
})

// ---- Class ---------------------------------------------------------------
// class Name { +member ... }, Class : +member, class A as "Display Label"
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

registerFamily({
  id: 'class',
  detect: l => l.startsWith('classdiagram'),
  extractLabels: extractClassLabels,
  // Loop 8 A1: the structured class verifier IS the verify path — verifyMermaid
  // routes class diagrams through this plugin hook (Loop 9 M2 removed the
  // duplicate per-body branch). Single source of truth.
  verify: (body, opts) => body.kind === 'class' ? verifyClass(body, opts) : [],
  ...structuredFamilyHooks('class', { parseBody: parseClassBody, serialize: renderClass, mutate: mutateClass }),
})

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

registerFamily({
  id: 'er',
  detect: l => l.startsWith('erdiagram'),
  extractLabels: extractErLabels,
  // Loop 8 A1: same as class — this hook is the verify path for ER (Loop 9 M2
  // removed the duplicate per-body branch in verify.ts).
  verify: (body, opts) => body.kind === 'er' ? verifyErBody(body, opts) : [],
  ...structuredFamilyHooks('er', { parseBody: parseErBody, serialize: renderEr, mutate: mutateEr }),
})

// ---- Journey --------------------------------------------------------------
// title T, section S, task: 3: Me
function extractJourneyLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    let m
    if ((m = raw.match(/^accDescr\s*:?\s*\{\s*(.*)$/i))) {
      const first = m[1]!
      const end = first.indexOf('}')
      if (end >= 0) {
        const text = first.slice(0, end).trim()
        if (text) out.push({ text, target: `line${i + 1}` })
      } else {
        const text = first.trim()
        if (text) out.push({ text, target: `line${i + 1}` })
        for (i += 1; i < lines.length; i++) {
          const line = lines[i]!.trim()
          const close = line.indexOf('}')
          const text = (close >= 0 ? line.slice(0, close) : line).trim()
          if (text) out.push({ text, target: `line${i + 1}` })
          if (close >= 0) break
        }
      }
    } else if ((m = raw.match(/^accTitle\s*:?\s*(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^accDescr\s*:?\s*(.+)$/i))) {
      out.push({ text: m[1]!.replace(/^\{/, '').replace(/\}$/, '').trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^title\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^section\s+(.+)$/i))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    } else if ((m = raw.match(/^(.+?):\s*\d+(?:\s*:\s*(.*))?$/))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
      for (const actor of (m[2] ?? '').split(',')) {
        const text = actor.trim()
        if (text) out.push({ text, target: `line${i + 1}` })
      }
    }
  }
  return out
}

registerFamily({
  id: 'journey',
  detect: l => l.startsWith('journey'),
  extractLabels: extractJourneyLabels,
  // BUILD-15: journey is structured-when-narrowed. The verify hook covers the
  // structured body; opaque fallbacks keep the universal label-extraction path.
  verify: (body, opts) => body.kind === 'journey' ? verifyJourney(body, opts) : [],
  ...structuredFamilyHooks('journey', {
    headerOk: h => /^journey\s*$/i.test(h),
    parseBody: parseJourneyBody, serialize: renderJourney, mutate: mutateJourney,
  }),
})

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

registerFamily({
  id: 'xychart',
  detect: l => l.startsWith('xychart'),
  extractLabels: extractXyChartLabels,
  // BUILD-16: xychart is structured-when-narrowed. The verify hook covers the
  // structured body; opaque fallbacks (accTitle/accDescr, quoted text,
  // multi-statement `;` lines, unmodeled tokens like `curve basis`) keep the
  // universal label-extraction path. headerOk requires `xychart`/`xychart-beta`
  // with at most a `horizontal`/`vertical` orientation suffix — any other
  // trailing token (e.g. `EXTRA`) stays opaque so it round-trips verbatim.
  verify: (body, opts) => body.kind === 'xychart' ? verifyXyChart(body, opts) : [],
  // xychart needs the header to model the `horizontal` orientation suffix, so it
  // uses a tailored parse hook (not the shared structuredFamilyHooks) — but
  // serialize/mutate stay identical to every other structured family.
  parse: (lines, opaqueSource) => {
    const header = lines[0]?.trim() ?? ''
    const hm = header.match(/^xychart(?:-beta)?(?:\s+(horizontal|vertical))?\s*$/i)
    const body = hm ? parseXyChartBody(lines.slice(1)) : null
    if (body && hm?.[1]?.toLowerCase() === 'horizontal') body.horizontal = true
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
})

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

registerFamily({
  id: 'pie',
  detect: l => l.startsWith('pie'),
  extractLabels: extractPieLabels,
  // Pie is structured-when-narrowed. The verify hook covers the structured
  // body; opaque fallbacks keep the universal label-extraction path. The header
  // carries showData / inline title, so pie uses a tailored parse hook (like
  // xychart) — serialize/mutate stay identical to every other structured family.
  verify: (body, opts) => body.kind === 'pie' ? verifyPie(body, opts) : [],
  parse: (lines, opaqueSource) => {
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
})

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
    if (/^quadrantchart\b/i.test(raw)) continue
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
    // Point line: `Label: [x, y]` — extract the label.
    if ((m = raw.match(/^(.+?)\s*:\s*\[[^\]]*\]\s*$/))) {
      const text = m[1]!.trim()
      if (text) out.push({ text, target })
    }
  }
  return out
}

registerFamily({
  id: 'quadrant',
  detect: l => l.startsWith('quadrantchart'),
  extractLabels: extractQuadrantLabels,
  // Quadrant is structured-when-narrowed. The verify hook covers the structured
  // body; opaque fallbacks keep the universal label-extraction path.
  verify: (body, opts) => body.kind === 'quadrant' ? verifyQuadrant(body, opts) : [],
  ...structuredFamilyHooks('quadrant', {
    headerOk: h => /^quadrantchart\s*$/i.test(h),
    parseBody: parseQuadrantBody, serialize: renderQuadrant, mutate: mutateQuadrant,
  }),
})

// ---- Architecture ---------------------------------------------------------
// group api(cloud)[API], service db(database)[DB] in api
function extractArchitectureLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    for (const m of raw.matchAll(/\[([^\]]+)\]/g)) {
      out.push({ text: m[1]!, target: `line${i + 1}` })
    }
  }
  return out
}

registerFamily({
  id: 'architecture',
  detect: l => l.startsWith('architecture'),
  extractLabels: extractArchitectureLabels,
  // BUILD-17: architecture is structured-when-narrowed. The verify hook covers
  // the structured body; opaque fallbacks (accTitle/accDescr, {group} boundary
  // edges, unmodeled syntax) keep the universal label-extraction path.
  verify: (body, opts) => body.kind === 'architecture' ? verifyArchitecture(body, opts) : [],
  ...structuredFamilyHooks('architecture', {
    headerOk: h => /^architecture-beta\s*$/i.test(h),
    parseBody: parseArchitectureBody, serialize: renderArchitecture, mutate: mutateArchitecture,
  }),
})

// Re-export so importing this module is the only thing needed to populate
// the registry.
export { registerFamily, getFamily, knownFamilies, extractLabelsGeneric } from './families.ts'
