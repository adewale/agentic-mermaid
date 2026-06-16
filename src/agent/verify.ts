// ============================================================================
// verifyMermaid — Tier 1 (source/structure) + Tier 2 (geometric) + Tier 3 (lint).
//
// v4: no LayoutContext, no seed wrapper (ELK is deterministic on its own).
// LABEL_OVERFLOW is a source-based char-count check (Tier 1).
// ============================================================================

import { parseMermaid as parseValidDiagram } from './parse.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { auditRouteContracts, findRouteHitches } from '../route-contracts.ts'
import type {
  ValidDiagram, VerifyOptions, VerifyResult, LayoutWarning, RenderedLayout,
  WarningCode, SequenceBody,
} from './types.ts'
import { WARNING_SEVERITY, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { positionedToRenderedLayout, emptyRenderedLayout } from './layout-to-rendered.ts'
import { layoutFamilyToRendered, ganttGeometryWarnings, ganttScheduleWarning } from './family-layouts.ts'
import { getFamily, extractLabelsGeneric } from './families.ts'
import { stateBodyToGraph } from './state-body.ts'
import './families-builtin.ts'  // registers built-in families at import time

const KNOWN_SHAPES = new Set([
  'rectangle', 'service', 'rounded', 'diamond', 'stadium', 'circle',
  'subroutine', 'doublecircle', 'hexagon', 'cylinder', 'asymmetric',
  'trapezoid', 'trapezoid-alt', 'lean-r', 'lean-l', 'state-start', 'state-end',
])

function opaqueSourceHasOnlyHeader(kind: ValidDiagram['kind'], source: string): boolean {
  const statements = source
    .split(/[;\n]/)
    .map(part => part.trim())
    .filter(part => part && !part.startsWith('%%'))
  if (statements.length === 0) return true
  if (statements.length > 1) return false
  const header = statements[0]!.toLowerCase()
  const aliases: Record<string, string[]> = {
    flowchart: ['flowchart', 'graph'],
    state: ['statediagram', 'statediagram-v2'],
    sequence: ['sequencediagram'],
    timeline: ['timeline'],
    class: ['classdiagram'],
    er: ['erdiagram'],
    journey: ['journey'],
    xychart: ['xychart', 'xychart-beta'],
    pie: ['pie'],
    architecture: ['architecture-beta'],
  }
  return (aliases[kind] ?? [kind]).some(alias => header === alias || header.startsWith(`${alias} `))
}

export function verifyMermaid(input: ValidDiagram | string, opts: VerifyOptions = {}): VerifyResult {
  const d = typeof input === 'string' ? unwrap(input) : input
  if (!d) return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyRenderedLayout('flowchart'), opts)

  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP

  // Family-plugin verify dispatcher pass: every registered family's `verify`
  // hook gets a chance to contribute warnings. Runs ahead of per-body branches
  // so plugins can hook into any body kind (structured or opaque). Closes the
  // dead-code gap where `FamilyPlugin.verify` was declared but never invoked.
  // 2C comment policy: in-body comments that structured serialization drops
  // (recorded at parse time) surface here as the Tier 3 COMMENT_DROPPED lint,
  // so the loss is announced rather than silent.
  const metaWarnings: LayoutWarning[] = d.meta.droppedComments?.length
    ? [{ code: 'COMMENT_DROPPED', count: d.meta.droppedComments.length, lines: d.meta.droppedComments.map(c => c.line) }]
    : []
  const pluginWarnings = dedupedConcat(metaWarnings, dispatchFamilyVerify(d, opts))

  if (d.body.kind === 'sequence') return mergeFinalize(verifySequence(d.body, d.kind, cap, opts), pluginWarnings, opts)
  if (d.body.kind === 'timeline') return mergeFinalize(verifyTimeline(d.body, d.kind, cap, opts), pluginWarnings, opts)
  // class + ER: the FamilyPlugin.verify hooks (registered in families-builtin.ts)
  // already produce the per-body warnings. Loop 9 M2 removes the duplicate
  // explicit branches; the dispatcher path + emptyRenderedLayout fall-through
  // does the work. Dedup is unnecessary now (single source of truth) so we
  // emit pluginWarnings directly.
  // class + ER + journey + architecture: the FamilyPlugin.verify hooks produce
  // the per-body warnings (journey added by BUILD-15, architecture by BUILD-17).
  // Gantt adds geometric tripwires (OFF_CANVAS / GROUP_BREACH) over its real
  // layout and surfaces unresolvable schedules (UNRESOLVABLE_SCHEDULE),
  // alongside the body-level plugin warnings — see docs/design/gantt.md
  // §Verification.
  if (d.body.kind === 'gantt') {
    const layout = layoutFamilyToRendered(d) ?? emptyRenderedLayout(d.kind)
    const schedFail = ganttScheduleWarning(d)
    const geometric = dedupedConcat(ganttGeometryWarnings(layout), schedFail ? [schedFail] : [])
    return finalize(dedupedConcat(pluginWarnings, geometric), layout, opts)
  }

  if (d.body.kind === 'class' || d.body.kind === 'er' || d.body.kind === 'journey' || d.body.kind === 'architecture' || d.body.kind === 'xychart' || d.body.kind === 'pie' || d.body.kind === 'quadrant') {
    // QUAL-1: verify.layout is now truthful — the real positioned layout from
    // the family adapters (was emptyRenderedLayout). The structural warnings
    // still come from the FamilyPlugin.verify hooks; only the geometry the
    // layout field reports changes.
    return finalize(pluginWarnings, layoutFamilyToRendered(d) ?? emptyRenderedLayout(d.kind), opts)
  }

  // State diagrams (BUILD-19): the StateBody projects to a MermaidGraph via the
  // legacy state parser — the exact graph the renderer lays out — so the full
  // flowchart Tier 1 + Tier 2 geometric path runs unchanged. pluginWarnings
  // (verifyState) add the body-level structural checks on the StateBody itself.
  if (d.body.kind === 'state') {
    const graph = stateBodyToGraph(d.body)
    if (graph.nodes.size === 0) return finalize(dedupedConcat([{ code: 'EMPTY_DIAGRAM' }], pluginWarnings), emptyRenderedLayout(d.kind), opts)
    const { warnings, layout } = verifyGraph(graph, d.kind, cap)
    return finalize(dedupedConcat(warnings, pluginWarnings), layout, opts)
  }

  if (d.body.kind === 'opaque') {
    const isEmpty = opaqueSourceHasOnlyHeader(d.kind, d.body.source)
    // Universal Tier 1 LABEL_OVERFLOW via family-specific (or generic) label
    // extraction. Closes the gap where opaque-body diagrams (class / ER /
    // journey / xychart / architecture / sequence-with-alt/etc.) never got
    // label-cap checking.
    const plugin = getFamily(d.kind)
    const labels = (plugin?.extractLabels ?? extractLabelsGeneric)(d.body.source)
    const warnings: LayoutWarning[] = isEmpty ? [{ code: 'EMPTY_DIAGRAM' }] : []
    const seen = new Set<string>()
    for (const lbl of labels) {
      if (lbl.text.length <= cap) continue
      const key = `${lbl.target}:${lbl.text}`
      if (seen.has(key)) continue
      seen.add(key)
      warnings.push({ code: 'LABEL_OVERFLOW', target: lbl.target, charCount: lbl.text.length, limit: cap })
    }
    // QUAL-1: opaque bodies of renderable families (pie/quadrant always, and
    // class/er/journey/architecture/xychart when unmodeled) still produce a
    // real positioned layout from canonicalSource. layoutFamilyToRendered
    // degrades to an empty layout on render-error, so this never throws.
    const opaqueLayout = d.kind === 'flowchart'
      ? layoutOpaqueFlowchart(d)
      : layoutFamilyToRendered(d) ?? emptyRenderedLayout(d.kind)
    return finalize(dedupedConcat(warnings, pluginWarnings), opaqueLayout, opts)
  }

  const graph = d.body.graph
  if (graph.nodes.size === 0) return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyRenderedLayout(d.kind), opts)
  const { warnings: graphWarnings, layout: graphLayout } = verifyGraph(graph, d.kind, cap)
  return finalize(dedupedConcat(graphWarnings, pluginWarnings), graphLayout, opts)
}

/**
 * Full Tier 1 (structural) + Tier 2 (geometric) + Tier 3 (lint) verify over a
 * MermaidGraph. Shared by flowchart bodies and state-diagram bodies (which
 * project to a graph via stateBodyToGraph). Returns warnings + the rendered
 * layout; the caller finalizes (suppress + ok flag).
 */
function verifyGraph(graph: import('../types.ts').MermaidGraph, kind: ValidDiagram['kind'], cap: number): { warnings: LayoutWarning[]; layout: RenderedLayout } {
  const positioned = layoutGraphSync(graph, {})
  const layout = positionedToRenderedLayout(positioned, kind)
  const warnings: LayoutWarning[] = []

  // Tier 1 — structural
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target)) {
      warnings.push({
        code: 'EDGE_MISANCHORED', edge: `${edge.source}->${edge.target}`,
        from: graph.nodes.has(edge.source) ? edge.source : undefined,
        to: graph.nodes.has(edge.target) ? edge.target : undefined,
      })
    }
  }
  for (const [id, node] of graph.nodes) {
    if (!KNOWN_SHAPES.has(node.shape)) warnings.push({ code: 'UNKNOWN_SHAPE', node: id, shape: String(node.shape) })
    if (node.label.length > cap) warnings.push({ code: 'LABEL_OVERFLOW', target: id, charCount: node.label.length, limit: cap })
  }
  for (const edge of graph.edges) {
    if (edge.label && edge.label.length > cap) {
      warnings.push({ code: 'LABEL_OVERFLOW', target: `${edge.source}->${edge.target}`, charCount: edge.label.length, limit: cap })
    }
  }
  for (const n of positioned.nodes) {
    // Report x and y independently so a node off-canvas on both axes surfaces
    // both, instead of masking the second behind an else-if.
    if (n.x < 0 || n.x + n.width > positioned.width + 1) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'x' })
    if (n.y < 0 || n.y + n.height > positioned.height + 1) warnings.push({ code: 'OFF_CANVAS', target: n.id, axis: 'y' })
  }
  for (const g of positioned.groups) {
    const visit = (group: typeof g) => {
      const sg = findSubgraphById(graph.subgraphs, group.id)
      if (sg) for (const n of positioned.nodes) {
        if (!sg.nodeIds.includes(n.id)) continue
        const inside = n.x >= group.x && n.y >= group.y &&
          n.x + n.width <= group.x + group.width + 0.5 && n.y + n.height <= group.y + group.height + 0.5
        if (!inside) warnings.push({ code: 'GROUP_BREACH', group: group.id, member: n.id })
      }
      for (const c of group.children) visit(c)
    }
    visit(g)
  }

  // Tier 2 — geometric
  for (let i = 0; i < positioned.nodes.length; i++) {
    for (let j = i + 1; j < positioned.nodes.length; j++) {
      const a = positioned.nodes[i]!, b = positioned.nodes[j]!
      const o = rectIntersection(a, b)
      if (o > 0) warnings.push({ code: 'NODE_OVERLAP', a: a.id, b: b.id, areaPx: Math.round(o) })
    }
  }
  for (const e of positioned.edges) {
    const c = countSelfCrossings(e.points)
    if (c > 0) warnings.push({ code: 'ROUTE_SELF_CROSS', edge: `${e.source}->${e.target}`, count: c })
  }
  // Route-contract tripwires over FINAL geometry: the layout pipeline already
  // upholds these invariants itself (straight clear lanes, border-anchored
  // containers, on-shape endpoints, labels on their own lines), so any hit
  // here means some pass mutated geometry after route certification.
  // See docs/design/route-contracts.md.
  for (const hitch of findRouteHitches(positioned, graph)) {
    warnings.push({ code: 'ROUTE_HITCH', edge: hitch.edge, deviationPx: hitch.deviationPx })
  }
  warnings.push(...auditRouteContracts(positioned, graph))

  // Tier 3 — advisory lint for common agent mistakes that still parse/render.
  warnings.push(...lintFlowchartGraph(graph))

  return { warnings, layout }
}

function dedupedConcat(a: LayoutWarning[], b: LayoutWarning[]): LayoutWarning[] {
  if (b.length === 0) return a
  const seen = new Set(a.map(warningKey))
  const novel = b.filter(w => !seen.has(warningKey(w)))
  return novel.length === 0 ? a : [...a, ...novel]
}

/**
 * Run the registered FamilyPlugin.verify hook for this diagram's kind.
 * Returns the warnings the plugin produced, or [] when no plugin / no hook.
 */
function dispatchFamilyVerify(d: ValidDiagram, opts: VerifyOptions): LayoutWarning[] {
  const plugin = getFamily(d.kind)
  if (!plugin?.verify) return []
  try {
    return plugin.verify(d.body, opts)
  } catch {
    // A faulty plugin shouldn't blow up verifyMermaid. Silent skip is acceptable
    // for an optional hook; the test suite catches bugs in built-in plugins.
    return []
  }
}

/** finalize() variant that merges an already-finalized result with extra warnings.
 *  Loop 9 M10: now delegates fully to dedupedConcat → finalize. Dedupes on
 *  (code, target/edge/node) so a plugin verify hook returning a warning
 *  identical to one the per-body verify already produced doesn't surface twice.
 *  The dispatcher has been live since Loop 7 M1, so this hazard remains real. */
function mergeFinalize(prev: VerifyResult, extra: LayoutWarning[], opts: VerifyOptions): VerifyResult {
  if (extra.length === 0) return prev
  const merged = dedupedConcat(prev.warnings, extra)
  if (merged === prev.warnings) return prev
  return finalize(merged, prev.layout, opts)
}

function warningKey(w: LayoutWarning): string {
  if ('target' in w) return `${w.code}:${w.target}`
  if ('edge' in w) return `${w.code}:${w.edge}`
  if ('node' in w) return `${w.code}:${w.node}`
  if ('group' in w) return `${w.code}:${w.group}`
  if ('a' in w && 'b' in w) return `${w.code}:${w.a}|${w.b}`
  return w.code
}

function lintFlowchartGraph(graph: import('../types.ts').MermaidGraph): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const firstBySignature = new Map<string, { edge: string; from: string; to: string; label?: string }>()
  graph.edges.forEach((edge, index) => {
    const signature = JSON.stringify({
      source: edge.source,
      target: edge.target,
      label: edge.label ?? '',
      style: edge.style,
      hasArrowStart: edge.hasArrowStart,
      hasArrowEnd: edge.hasArrowEnd,
      startMarker: edge.startMarker ?? 'arrow',
      endMarker: edge.endMarker ?? 'arrow',
    })
    const id = `${edge.source}->${edge.target}#${index}`
    const first = firstBySignature.get(signature)
    if (first) {
      warnings.push({ code: 'DUPLICATE_EDGE', edge: id, duplicateOf: first.edge, from: edge.source, to: edge.target, label: edge.label })
    } else {
      firstBySignature.set(signature, { edge: id, from: edge.source, to: edge.target, label: edge.label })
    }
  })

  // ISO 5807 (10.3.1.2) / ANSI X3.5 (4.10.2): when a decision has several
  // exits, EACH exit shall be labeled with its condition value. A diamond
  // with two or more out-edges where any branch is unlabeled is ambiguous.
  const outEdges = new Map<string, { labeled: number; unlabeled: Array<string> }>()
  graph.edges.forEach((edge, index) => {
    const node = graph.nodes.get(edge.source)
    if (!node || node.shape !== 'diamond' || edge.source === edge.target) return
    const entry = outEdges.get(edge.source) ?? { labeled: 0, unlabeled: [] }
    if (edge.label && edge.label.trim().length > 0) entry.labeled++
    else entry.unlabeled.push(`${edge.source}->${edge.target}#${index}`)
    outEdges.set(edge.source, entry)
  })
  for (const [nodeId, entry] of outEdges) {
    if (entry.labeled + entry.unlabeled.length < 2) continue
    for (const edge of entry.unlabeled) {
      warnings.push({ code: 'DECISION_BRANCH_UNLABELED', node: nodeId, edge })
    }
  }

  const ids = Array.from(graph.nodes.keys())
  if (ids.length === 0 || graph.edges.length === 0) return warnings
  const incoming = new Map(ids.map(id => [id, 0]))
  const outgoing = new Map(ids.map(id => [id, [] as string[]]))
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.source) || !graph.nodes.has(edge.target)) continue
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)!.push(edge.target)
  }
  const roots = ids.filter(id => (incoming.get(id) ?? 0) === 0)
  if (roots.length === 0) return warnings
  const seen = new Set<string>(roots)
  const queue = [...roots]
  for (let i = 0; i < queue.length; i++) {
    for (const next of outgoing.get(queue[i]!) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  for (const id of ids) {
    if (!seen.has(id)) warnings.push({ code: 'UNREACHABLE_NODE', node: id })
  }
  return warnings
}

function verifyTimeline(body: import('./types.ts').TimelineBody, kind: ValidDiagram['kind'], cap: number, opts: VerifyOptions): VerifyResult {
  const warnings: LayoutWarning[] = []
  const hasContent = body.sections.some(s => s.periods.length > 0) || body.title !== undefined
  if (!hasContent) return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyRenderedLayout(kind), opts)
  if (body.title !== undefined && body.title.length > cap) {
    warnings.push({ code: 'LABEL_OVERFLOW', target: 'title', charCount: body.title.length, limit: cap })
  }
  for (const s of body.sections) {
    if (s.label !== undefined && s.label.length > cap) {
      warnings.push({ code: 'LABEL_OVERFLOW', target: s.id, charCount: s.label.length, limit: cap })
    }
    for (const p of s.periods) {
      if (p.label.length > cap) warnings.push({ code: 'LABEL_OVERFLOW', target: p.id, charCount: p.label.length, limit: cap })
      for (const e of p.events) {
        if (e.text.length > cap) warnings.push({ code: 'LABEL_OVERFLOW', target: e.id, charCount: e.text.length, limit: cap })
      }
    }
  }
  return finalize(warnings, emptyRenderedLayout(kind), opts)
}

function verifySequence(body: SequenceBody, kind: ValidDiagram['kind'], cap: number, opts: VerifyOptions): VerifyResult {
  const warnings: LayoutWarning[] = []
  // BUILD-18: a segment-preserving body may carry content only in opaque-block
  // segments (e.g. activation-shorthand messages `A->>+B`, blocks). That is
  // not an empty diagram — it just isn't structurally modeled.
  const hasOpaqueContent = (body.statements ?? []).some(
    s => s.kind === 'opaque-block' && s.lines.some(l => l.trim().length > 0),
  )
  if (body.participants.length === 0 && body.messages.length === 0 && !hasOpaqueContent) {
    return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyRenderedLayout(kind), opts)
  }
  const ids = new Set(body.participants.map(p => p.id))
  body.messages.forEach((m, i) => {
    if (!ids.has(m.from) || !ids.has(m.to)) {
      warnings.push({
        code: 'EDGE_MISANCHORED', edge: `msg#${i}:${m.from}->${m.to}`,
        from: ids.has(m.from) ? m.from : undefined, to: ids.has(m.to) ? m.to : undefined,
      })
    }
    if (m.text.length > cap) warnings.push({ code: 'LABEL_OVERFLOW', target: `msg#${i}:${m.from}->${m.to}`, charCount: m.text.length, limit: cap })
  })
  for (const p of body.participants) {
    if (p.label.length > cap) warnings.push({ code: 'LABEL_OVERFLOW', target: p.id, charCount: p.label.length, limit: cap })
  }
  // BUILD-18: opaque-block segments (Note/alt/loop/par/title lines) still get
  // universal LABEL_OVERFLOW via the family's label extractor, so the safety
  // check survives the move from whole-body-opaque to structured-with-segments.
  const opaqueLines = (body.statements ?? [])
    .filter((s): s is Extract<typeof s, { kind: 'opaque-block' }> => s.kind === 'opaque-block')
    .flatMap(s => s.lines)
  if (opaqueLines.length > 0) {
    const plugin = getFamily(kind)
    const labels = (plugin?.extractLabels ?? extractLabelsGeneric)(opaqueLines.join('\n'))
    const seen = new Set<string>()
    for (const lbl of labels) {
      if (lbl.text.length <= cap) continue
      const key = `${lbl.target}:${lbl.text}`
      if (seen.has(key)) continue
      seen.add(key)
      warnings.push({ code: 'LABEL_OVERFLOW', target: lbl.target, charCount: lbl.text.length, limit: cap })
    }
  }
  return finalize(warnings, emptyRenderedLayout(kind), opts)
}

// ---- helpers --------------------------------------------------------------

function layoutOpaqueFlowchart(d: ValidDiagram): RenderedLayout {
  try {
    return positionedToRenderedLayout(layoutGraphSync(parseFlowchartLegacy(d.canonicalSource), {}), d.kind)
  } catch {
    return emptyRenderedLayout(d.kind)
  }
}

function unwrap(source: string): ValidDiagram | null {
  const r = parseValidDiagram(source)
  return r.ok ? r.value : null
}

function finalize(warnings: LayoutWarning[], layout: RenderedLayout, opts: VerifyOptions): VerifyResult {
  const suppress = new Set<WarningCode>(opts.suppress ?? [])
  const kept = warnings.filter(w => !suppress.has(w.code))
  return { ok: !kept.some(w => WARNING_SEVERITY[w.code] === 'error'), warnings: kept, layout }
}

function rectIntersection(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const xo = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const yo = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return xo * yo
}
function countSelfCrossings(points: { x: number; y: number }[]): number {
  if (points.length < 4) return 0
  let count = 0
  for (let i = 0; i < points.length - 1; i++)
    for (let j = i + 2; j < points.length - 1; j++) {
      if (i === 0 && j === points.length - 2) continue
      if (segInt(points[i]!, points[i + 1]!, points[j]!, points[j + 1]!)) count++
    }
  return count
}
function segInt(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, p4: { x: number; y: number }): boolean {
  const d1 = cr(p4.x - p3.x, p4.y - p3.y, p1.x - p3.x, p1.y - p3.y)
  const d2 = cr(p4.x - p3.x, p4.y - p3.y, p2.x - p3.x, p2.y - p3.y)
  const d3 = cr(p2.x - p1.x, p2.y - p1.y, p3.x - p1.x, p3.y - p1.y)
  const d4 = cr(p2.x - p1.x, p2.y - p1.y, p4.x - p1.x, p4.y - p1.y)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}
function cr(x1: number, y1: number, x2: number, y2: number): number { return x1 * y2 - x2 * y1 }

function findSubgraphById(list: import('../types.ts').MermaidSubgraph[], id: string): import('../types.ts').MermaidSubgraph | null {
  for (const sg of list) { if (sg.id === id) return sg; const c = findSubgraphById(sg.children, id); if (c) return c }
  return null
}
