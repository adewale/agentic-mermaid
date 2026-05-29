// ============================================================================
// Built-in family registrations.
//
// Registers all 9 families with the plugin registry. Today this populates
// `extractLabels` only — parse/serialize/mutate/verify continue to dispatch
// through their existing in-tree branches in parse.ts / serialize.ts /
// mutate.ts / verify.ts. As each family migrates to a fully plugin-owned
// implementation, fill in `parse`/`serialize`/`mutate`/`verify` here.
// ============================================================================

import { registerFamily, extractLabelsGeneric, type ExtractedLabel } from './families.ts'
import { verifyClass } from './class-body.ts'
import { verifyErBody } from './er-body.ts'

// ---- Flowchart / State ----------------------------------------------------
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

registerFamily({ id: 'flowchart', detect: l => l.startsWith('flowchart') || l.startsWith('graph'), extractLabels: extractFlowchartLabels })
registerFamily({ id: 'state', detect: l => l.startsWith('statediagram') || l.startsWith('statediagram-v2'), extractLabels: extractFlowchartLabels })

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

registerFamily({ id: 'sequence', detect: l => l.startsWith('sequencediagram'), extractLabels: extractSequenceLabels })

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

registerFamily({ id: 'timeline', detect: l => l.startsWith('timeline'), extractLabels: extractTimelineLabels })

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
  // Loop 8 A1: wire the structured class verifier into the plugin so the
  // dispatcher (Loop 7 M1) actually fires on built-in families. The per-body
  // verify branch in verify.ts still runs and the dispatcher dedupes warnings
  // against it — see Loop 9 TODO below.
  verify: (body, opts) => body.kind === 'class' ? verifyClass(body, opts) : [],
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
  // Loop 8 A1: same as class above — wire the structured ER verifier.
  verify: (body, opts) => body.kind === 'er' ? verifyErBody(body, opts) : [],
})

// TODO (Loop 9): the per-body class/er branches in verify.ts now duplicate
// what the plugin hooks return. The Loop 7 review fix added dedupedConcat /
// mergeFinalize so the duplication is observationally invisible but does
// redundant compute. Deleting the branches requires moving the
// emptyRenderedLayout(d.kind) handling to a fall-through that's safe across
// all body kinds — out of scope for Loop 8.

// ---- Journey --------------------------------------------------------------
// title T, section S, task: 3: Me
function extractJourneyLabels(source: string): ExtractedLabel[] {
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
    } else if ((m = raw.match(/^([^:]+):\s*\d+\s*:/))) {
      out.push({ text: m[1]!.trim(), target: `line${i + 1}` })
    }
  }
  return out
}

registerFamily({ id: 'journey', detect: l => l.startsWith('journey'), extractLabels: extractJourneyLabels })

// ---- XY chart -------------------------------------------------------------
// title "T", x-axis [a,b,c], y-axis "label"
function extractXyChartLabels(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw || raw.startsWith('%%')) continue
    // All quoted strings
    for (const m of raw.matchAll(/"([^"]+)"/g)) {
      out.push({ text: m[1]!, target: `line${i + 1}` })
    }
    // x-axis [a, b, c] — extract individual entries
    const ax = raw.match(/^[xy]-axis\s+\[([^\]]+)\]/i)
    if (ax) {
      for (const entry of ax[1]!.split(',')) {
        const t = entry.trim().replace(/^["']|["']$/g, '')
        if (t) out.push({ text: t, target: `line${i + 1}` })
      }
    }
  }
  return out
}

registerFamily({ id: 'xychart', detect: l => l.startsWith('xychart'), extractLabels: extractXyChartLabels })

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

registerFamily({ id: 'architecture', detect: l => l.startsWith('architecture'), extractLabels: extractArchitectureLabels })

// Re-export so importing this module is the only thing needed to populate
// the registry.
export { registerFamily, getFamily, knownFamilies, extractLabelsGeneric } from './families.ts'
