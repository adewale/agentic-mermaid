// ============================================================================
// verifyMermaid — Tier 1 (source/structure) + Tier 2 (geometric) + Tier 3 (lint).
//
// v4: no LayoutContext, no seed wrapper (ELK is deterministic on its own).
// LABEL_OVERFLOW is a rendered-line char-count check (Tier 1): the cap applies
// to the longest displayed line (entities decoded, <br> splits), not raw
// source chars — see label-metrics.ts.
// ============================================================================

import { parseMermaid as parseValidDiagram } from './parse.ts'
import { serializeMermaid } from './serialize.ts'
import { logToolInvocation } from './trace-log.ts'
import { countStructuralElements, faithfulnessWarning } from './structural-count.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { renderMermaidSVG } from '../index.ts'
import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { auditRouteContracts, findRouteHitches } from '../route-contracts.ts'
import type {
  ValidDiagram, VerifyOptions, VerifyResult, LayoutWarning, RenderedLayout,
  WarningCode, SequenceBody,
} from './types.ts'
import { WARNING_SEVERITY, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { positionedToRenderedLayout, emptyRenderedLayout } from './layout-to-rendered.ts'
import { layoutFamilyToRendered, ganttGeometryWarnings, ganttScheduleWarning, layoutGeometryWarnings } from './family-layouts.ts'
import { getFamily, extractLabelsGeneric, builtinFamilyMetadata } from './families.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { stateBodyToGraph } from './state-body.ts'
import { flowchartUnsupportedSyntaxWarnings } from './flowchart-unsupported.ts'
import { erUnsupportedSyntaxWarnings } from './er-body.ts'
import { classIneffectiveConfigFields } from '../class/layout.ts'
import { erIneffectiveConfigFields } from '../er/layout.ts'
import { pieIneffectiveConfigFields } from '../pie/config.ts'
import { QUADRANT_NOOP_CONFIG_FIELDS } from '../quadrant/config.ts'
import { architectureIneffectiveConfigFields } from '../architecture/config.ts'
import { flowchartIneffectiveConfigFields } from '../flowchart-config.ts'
import { sequenceIneffectiveConfigFields } from '../sequence/config.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { parseTodayMarkerStyle, GANTT_TODAY_MARKER_STYLE_PROPS } from '../gantt/today-marker.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { normalizeV11Shape } from '../flowchart-shapes.ts'
import './families-builtin.ts'  // registers built-in families at import time

const KNOWN_SHAPES = new Set([
  'rectangle', 'service', 'rounded', 'diamond', 'stadium', 'circle',
  'subroutine', 'doublecircle', 'hexagon', 'cylinder', 'asymmetric',
  'trapezoid', 'trapezoid-alt', 'lean-r', 'lean-l', 'state-start', 'state-end',
  'state-fork', 'state-join', 'state-choice', 'state-history',
])

function opaqueSourceHasOnlyHeader(kind: ValidDiagram['kind'], source: string): boolean {
  const statements = source
    .split(/[;\n]/)
    .map(part => part.trim())
    .filter(part => part && !part.startsWith('%%'))
  if (statements.length === 0) return true
  if (statements.length > 1) return false
  const header = statements[0]!.toLowerCase()
  // Header aliases come from the family metadata table — the single source of
  // truth — instead of a third hand-encoding of the same strings.
  const aliases = (builtinFamilyMetadata(kind)?.headers ?? [kind]).map(h => h.toLowerCase())
  return aliases.some(alias => header === alias || header.startsWith(`${alias} `))
}

/**
 * Tier-3 faithfulness lint: does the structured {nodes, edges, groups} tally
 * survive a parse → serialize → re-parse cycle? Round-trip *byte*-stability
 * (already gated elsewhere) only proves serialize∘parse is idempotent; this
 * proves canonical serialization is not silently dropping a node/edge/group —
 * the ER `}o` class of bug. Promoted from a corpus-only check + the LLM-judge
 * helper so it now runs on EVERY verify, for every family. Opaque bodies carry
 * no structured arrays (their faithfulness is byte-verbatim) and are skipped.
 */
function roundtripFaithfulnessWarnings(d: ValidDiagram): LayoutWarning[] {
  // Thin I/O wrapper: do the parse → serialize → re-parse, then defer the
  // verdict to the pure (mutation-gated, unit-tested) faithfulnessWarning.
  const before = countStructuralElements(d)
  if (!before) return []
  try {
    const reparsed = parseValidDiagram(serializeMermaid(d))
    if (!reparsed.ok) return faithfulnessWarning(before, null)  // total loss
    const after = countStructuralElements(reparsed.value)
    if (!after) return []  // reparsed to an opaque body — the round-trip gate owns that
    return faithfulnessWarning(before, after)
  } catch {
    // Serialization/parse threw — the round-trip-stability gate owns that
    // failure mode; don't double-report it as a faithfulness drop.
    return []
  }
}

export function verifyMermaid(input: ValidDiagram | string, opts: VerifyOptions = {}): VerifyResult {
  logToolInvocation('verify')
  return withRenderParity(input, verifyStructure(input, opts), opts)
}

/**
 * Render-parity gate — generalizes UNRESOLVABLE_SCHEDULE's seam-closing to
 * every family. The agent parser preserves unmodeled syntax verbatim, but the
 * render parser is strict, so a diagram could verify clean and still make
 * `am render` exit 4 (observed live: onboarding agents followed
 * verify-before-commit and shipped unrenderable quadrant/architecture
 * diagrams). A clean verify now proves the canonical source actually renders.
 * Skipped when verify already failed — the render error would only repeat a
 * diagnosis the caller already has to act on — and when the caller
 * suppressed ANY error-severity code: suppression means "I acknowledge this
 * failure class, proceed", and the gate must not resurrect the acknowledged
 * failure under a different name (e.g. suppress UNRESOLVABLE_SCHEDULE on a
 * gantt whose render still throws for exactly that reason).
 */
function withRenderParity(input: ValidDiagram | string, result: VerifyResult, opts: VerifyOptions): VerifyResult {
  if (!result.ok || (opts.suppress ?? []).some(code => code === 'RENDER_FAILED' || WARNING_SEVERITY[code] === 'error')) return result
  const source = typeof input === 'string' ? input : serializeMermaid(input)
  try {
    renderMermaidSVG(source)
    return result
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return { ...result, ok: false, warnings: [...result.warnings, { code: 'RENDER_FAILED', reason }] }
  }
}

// Journey accepts Mermaid's full JourneyDiagramConfig shape, but the
// sequence-era fields have no Journey geometry or paint. Accepting-and-
// ignoring misleads migrating users, so name each ineffective field (lint;
// never flips verify.ok). useMaxWidth and the layout/typography/color fields
// ARE wired and never warn.
const JOURNEY_NOOP_CONFIG_FIELDS = [
  'boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign',
  'bottomMarginAdj', 'rightAngles', 'activationWidth', 'textPlacement',
] as const

function journeyIneffectiveConfigWarnings(d: ValidDiagram): LayoutWarning[] {
  const configs: unknown[] = [
    (d.meta.frontmatter as Record<string, unknown> | undefined)?.journey,
    ...d.meta.initDirectives.map(directive => (directive.parsed as Record<string, unknown> | undefined)?.journey),
  ]
  const present = new Set<string>()
  for (const config of configs) {
    if (!config || typeof config !== 'object') continue
    for (const field of JOURNEY_NOOP_CONFIG_FIELDS) {
      if (field in (config as Record<string, unknown>)) present.add(field)
    }
  }
  return [...present].sort().map(field => ({
    code: 'INEFFECTIVE_CONFIG',
    field,
    message: `Journey config field "${field}" is accepted for Mermaid config-shape compatibility but has no effect on journey geometry or paint.`,
  }))
}

// Timeline wires disableMulticolor + sectionFills/sectionColours
// (src/timeline/renderer.ts). Upstream's documented TimelineDiagramConfig is
// journey-shaped (sequence-era margins, actor boxes, task fonts), and none of
// that remainder — nor the BaseDiagramConfig useWidth/useMaxWidth — touches
// timeline geometry or paint here, so name each field per P4 (wire-or-warn)
// instead of silently swallowing it. Lint only; never flips verify.ok.
const TIMELINE_NOOP_CONFIG_FIELDS = [
  'diagramMarginX', 'diagramMarginY', 'leftMargin', 'width', 'height', 'padding',
  'boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign',
  'bottomMarginAdj', 'rightAngles', 'taskFontSize', 'taskFontFamily', 'taskMargin',
  'activationWidth', 'textPlacement', 'actorColours', 'useMaxWidth', 'useWidth',
] as const

function timelineIneffectiveConfigWarnings(d: ValidDiagram): LayoutWarning[] {
  const configs: unknown[] = [
    (d.meta.frontmatter as Record<string, unknown> | undefined)?.timeline,
    ...d.meta.initDirectives.map(directive => (directive.parsed as Record<string, unknown> | undefined)?.timeline),
  ]
  const present = new Set<string>()
  for (const config of configs) {
    if (!config || typeof config !== 'object') continue
    for (const field of TIMELINE_NOOP_CONFIG_FIELDS) {
      if (field in (config as Record<string, unknown>)) present.add(field)
    }
  }
  return [...present].sort().map(field => ({
    code: 'INEFFECTIVE_CONFIG',
    field,
    message: `Timeline config field "${field}" is accepted for Mermaid config-shape compatibility but has no effect on timeline geometry or paint.`,
  }))
}

// Pie wires textPosition/donutHole/legendPosition + the pieN/stroke/opacity
// theme variables (src/pie/config.ts); the documented remainder is named
// here per P4 (wire-or-warn) instead of being silently swallowed.
function pieIneffectiveConfigWarnings(d: ValidDiagram): LayoutWarning[] {
  const frontmatter = d.meta.frontmatter as Record<string, unknown> | undefined
  const directives = d.meta.initDirectives.map(directive => directive.parsed as Record<string, unknown> | undefined)
  const fields = pieIneffectiveConfigFields(
    [frontmatter?.pie, ...directives.map(parsed => parsed?.pie)],
    [frontmatter?.themeVariables, ...directives.map(parsed => parsed?.themeVariables)],
  )
  return fields.map(field => ({
    code: 'INEFFECTIVE_CONFIG',
    field,
    message: `Pie config field "${field}" is accepted for Mermaid config-shape compatibility but has no effect on pie geometry or paint.`,
  }))
}

// Class wires nodeSpacing/rankSpacing (src/class/layout.ts
// resolveClassRenderOptions) and ER wires layoutDirection +
// nodeSpacing/rankSpacing (src/er/layout.ts applyErFrontmatterConfig); the
// documented remainders are named here per P4 (wire-or-warn) instead of
// being silently swallowed. The NOOP field tables live beside the wiring in
// the family layouts so wire and warn cannot drift.
function classErIneffectiveConfigWarnings(
  d: ValidDiagram,
  sectionKey: 'class' | 'er',
  fieldsPresent: (configs: unknown[]) => string[],
  familyLabel: string,
): LayoutWarning[] {
  const configs: unknown[] = [
    (d.meta.frontmatter as Record<string, unknown> | undefined)?.[sectionKey],
    ...d.meta.initDirectives.map(directive => (directive.parsed as Record<string, unknown> | undefined)?.[sectionKey]),
  ]
  return fieldsPresent(configs).map(field => ({
    code: 'INEFFECTIVE_CONFIG',
    field,
    message: `${familyLabel} config field "${field}" is accepted for Mermaid config-shape compatibility but has no effect on ${sectionKey === 'class' ? 'class-diagram' : 'ER'} geometry or paint.`,
  }))
}

// Quadrant wires most of the documented quadrantChart section (chart size,
// fonts, point radius/padding, border widths, useMaxWidth — see
// src/quadrant/config.ts, the single wire-or-warn table); the unwired
// remainder (axis positions, quadrantTextTopPadding, useWidth) is named here
// per P4 instead of being silently swallowed.
function quadrantIneffectiveConfigWarnings(d: ValidDiagram): LayoutWarning[] {
  const configs: unknown[] = [
    (d.meta.frontmatter as Record<string, unknown> | undefined)?.quadrantChart,
    ...d.meta.initDirectives.map(directive => (directive.parsed as Record<string, unknown> | undefined)?.quadrantChart),
  ]
  const present = new Set<string>()
  for (const config of configs) {
    if (!config || typeof config !== 'object') continue
    for (const field of QUADRANT_NOOP_CONFIG_FIELDS) {
      if (field in (config as Record<string, unknown>)) present.add(field)
    }
  }
  return [...present].sort().map(field => ({
    code: 'INEFFECTIVE_CONFIG',
    field,
    message: `Quadrant config field "${field}" is accepted for Mermaid config-shape compatibility but has no effect on quadrant geometry or paint.`,
  }))
}

// Architecture wires nodeSeparation (sibling spacing) and
// idealEdgeLengthMultiplier (layer gap) plus padding/iconSize/fontSize
// (src/architecture/config.ts, the single wire-or-warn table); the remaining
// documented keys (edgeElasticity, numIter, seed, randomize) tune upstream's
// nondeterministic fcose simulation and have no meaning in this deterministic
// layout — named here per P4 instead of being silently swallowed.
function architectureIneffectiveConfigWarnings(d: ValidDiagram): LayoutWarning[] {
  const configs: unknown[] = [
    (d.meta.frontmatter as Record<string, unknown> | undefined)?.architecture,
    ...d.meta.initDirectives.map(directive => (directive.parsed as Record<string, unknown> | undefined)?.architecture),
  ]
  return architectureIneffectiveConfigFields(configs).map(field => ({
    code: 'INEFFECTIVE_CONFIG',
    field,
    message: `Architecture config field "${field}" tunes upstream's fcose force simulation; this architecture layout is deterministic, so the field is accepted for Mermaid config-shape compatibility but has no effect on geometry.`,
  }))
}

// Flowchart wires nodeSpacing/rankSpacing/wrappingWidth
// (src/flowchart-config.ts resolveFlowchartRenderOptions); the documented
// remainder (curve, htmlLabels, padding, …) is named here per P4
// (wire-or-warn). The NOOP field table lives beside the wiring in
// src/flowchart-config.ts so wire and warn cannot drift.
function flowchartIneffectiveConfigWarnings(d: ValidDiagram): LayoutWarning[] {
  const configs: unknown[] = [
    (d.meta.frontmatter as Record<string, unknown> | undefined)?.flowchart,
    ...d.meta.initDirectives.map(directive => (directive.parsed as Record<string, unknown> | undefined)?.flowchart),
  ]
  return flowchartIneffectiveConfigFields(configs).map(field => ({
    code: 'INEFFECTIVE_CONFIG',
    field,
    message: `Flowchart config field "${field}" is accepted for Mermaid config-shape compatibility but has no effect on flowchart geometry or paint.`,
  }))
}

// Sequence wires actorMargin/width/height/diagramMarginX/Y/messageMargin/
// noteMargin/activationWidth/showSequenceNumbers (src/sequence/config.ts →
// src/sequence/layout.ts); the documented remainder (wrap, mirrorActors,
// fonts, …) is named here per P4 (wire-or-warn). The NOOP field table lives
// beside the wiring in src/sequence/config.ts so wire and warn cannot drift.
function sequenceIneffectiveConfigWarnings(d: ValidDiagram): LayoutWarning[] {
  const configs: unknown[] = [
    (d.meta.frontmatter as Record<string, unknown> | undefined)?.sequence,
    ...d.meta.initDirectives.map(directive => (directive.parsed as Record<string, unknown> | undefined)?.sequence),
  ]
  return sequenceIneffectiveConfigFields(configs).map(field => ({
    code: 'INEFFECTIVE_CONFIG',
    field,
    message: `Sequence config field "${field}" is accepted for Mermaid config-shape compatibility but has no effect on sequence geometry or paint.`,
  }))
}

// Gantt's todayMarker directive style payload: the wired line-paint
// properties apply to the today line (src/gantt/today-marker.ts, the single
// sanitize/wire table); every other property present in the payload — or a
// wired one whose value failed sanitation — is named here per P4 instead of
// being silently swallowed.
function ganttTodayMarkerWarnings(d: ValidDiagram): LayoutWarning[] {
  try {
    const normalized = normalizeMermaidSource(d.canonicalSource)
    const model = applyGanttFrontmatterConfig(parseGanttModel(normalized.lines), normalized.frontmatter)
    const payload = model.todayMarker?.style
    if (payload === undefined) return []
    return [...parseTodayMarkerStyle(payload).ignored].sort().map(prop => ({
      code: 'INEFFECTIVE_CONFIG',
      field: `todayMarker.${prop}`,
      message: `Gantt todayMarker style property "${prop}" is accepted for Mermaid compatibility but is not applied to the today line (wired, sanitized properties: ${GANTT_TODAY_MARKER_STYLE_PROPS.join(', ')}).`,
    }))
  } catch {
    return [] // unparseable gantt bodies surface via UNRESOLVABLE_SCHEDULE instead
  }
}

// v11 typed shapes (repo #44): documented names whose geometry mapping is
// approximate render with the nearest existing geometry — announce each
// substitution (Tier-3, never flips ok) so the approximation is honest.
function flowchartShapeSubstitutionWarnings(d: ValidDiagram): LayoutWarning[] {
  if (d.kind !== 'flowchart' || d.body.kind !== 'flowchart') return []
  const warnings: LayoutWarning[] = []
  for (const node of d.body.graph.nodes.values()) {
    if (!node.semanticShape) continue
    const v11 = normalizeV11Shape(node.semanticShape)
    if (!v11 || v11.exact) continue
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'flowchart_shape_substitution',
      node: node.id,
      message: `Mermaid v11 shape "${node.authoredShape ?? node.semanticShape}" (${v11.description}) has no dedicated renderer yet; node "${node.id}" renders with the nearest geometry "${v11.geometry}".`,
    })
  }
  return warnings
}

// Upstream's quadrant grammar accepts ANY `key: value` style entry and
// applies only radius/color/stroke-color/stroke-width; unknown-but-safe
// entries are preserved verbatim on the body (point-style.ts `extra`) and
// never render. P4: name them instead of staying silent.
function quadrantInertStyleWarnings(d: ValidDiagram): LayoutWarning[] {
  if (d.body.kind !== 'quadrant') return []
  const inert = new Set<string>()
  const collect = (style?: { extra?: string[] }) => {
    for (const entry of style?.extra ?? []) inert.add(entry.slice(0, entry.indexOf(':')).trim())
  }
  for (const point of d.body.points) collect(point.style)
  for (const style of Object.values(d.body.classDefs ?? {})) collect(style)
  return [...inert].sort().map(property => ({
    code: 'UNSUPPORTED_SYNTAX',
    syntax: 'quadrant_style_property',
    message: `Quadrant style property "${property}" is preserved in source for upstream compatibility but has no effect on rendered points (rendered properties: radius, color, stroke-color, stroke-width).`,
  }))
}

function verifyStructure(input: ValidDiagram | string, opts: VerifyOptions = {}): VerifyResult {
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
  const sourceWarnings = d.kind === 'flowchart'
    ? dedupedConcat(flowchartUnsupportedSyntaxWarnings(d.canonicalSource), flowchartShapeSubstitutionWarnings(d))
    : d.kind === 'er' ? erUnsupportedSyntaxWarnings(d.canonicalSource)
    : d.kind === 'quadrant' ? quadrantInertStyleWarnings(d) : []
  const faithfulnessWarnings = roundtripFaithfulnessWarnings(d)
  const configWarnings = d.kind === 'journey'
    ? journeyIneffectiveConfigWarnings(d)
    : d.kind === 'timeline' ? timelineIneffectiveConfigWarnings(d)
    : d.kind === 'pie' ? pieIneffectiveConfigWarnings(d)
    : d.kind === 'quadrant' ? quadrantIneffectiveConfigWarnings(d)
    : d.kind === 'class' ? classErIneffectiveConfigWarnings(d, 'class', classIneffectiveConfigFields, 'Class')
    : d.kind === 'er' ? classErIneffectiveConfigWarnings(d, 'er', erIneffectiveConfigFields, 'Er')
    : d.kind === 'architecture' ? architectureIneffectiveConfigWarnings(d)
    : d.kind === 'flowchart' ? flowchartIneffectiveConfigWarnings(d)
    : d.kind === 'sequence' ? sequenceIneffectiveConfigWarnings(d)
    : d.kind === 'gantt' ? ganttTodayMarkerWarnings(d) : []
  const pluginWarnings = dedupedConcat(dedupedConcat(dedupedConcat(dedupedConcat(metaWarnings, dispatchFamilyVerify(d, opts)), sourceWarnings), faithfulnessWarnings), configWarnings)

  if (d.body.kind === 'sequence') return mergeFinalize(verifySequence(d as ValidDiagram & { body: SequenceBody }, cap, opts), pluginWarnings, opts)
  if (d.body.kind === 'timeline') return mergeFinalize(verifyTimeline(d as ValidDiagram & { body: import('./types.ts').TimelineBody }, cap, opts), pluginWarnings, opts)
  // class + ER: the FamilyPlugin.verify hooks (registered in families-builtin.ts)
  // already produce the per-body warnings. Loop 9 M2 removes the duplicate
  // explicit branches; the dispatcher path + emptyRenderedLayout fall-through
  // does the work. Dedup is unnecessary now (single source of truth) so we
  // emit pluginWarnings directly.
  // class + ER + journey + architecture: the FamilyPlugin.verify hooks produce
  // the per-body warnings (journey added by BUILD-15, architecture by BUILD-17).
  // Gantt adds geometric tripwires (OFF_CANVAS / GROUP_BREACH) over its real
  // layout and surfaces unresolvable schedules (UNRESOLVABLE_SCHEDULE),
  // alongside the body-level plugin warnings — see docs/design/families/gantt.md
  // §Verification.
  if (d.body.kind === 'gantt') {
    const layout = layoutFamilyToRendered(d) ?? emptyRenderedLayout(d.kind)
    const schedFail = ganttScheduleWarning(d)
    const geometric = dedupedConcat(ganttGeometryWarnings(layout), schedFail ? [schedFail] : [])
    return finalize(dedupedConcat(pluginWarnings, geometric), layout, opts)
  }

  if (d.body.kind === 'class' || d.body.kind === 'er' || d.body.kind === 'journey' || d.body.kind === 'architecture' || d.body.kind === 'xychart' || d.body.kind === 'pie' || d.body.kind === 'quadrant') {
    // QUAL-1: verify.layout is now truthful — the real positioned layout from
    // the family adapters (was emptyRenderedLayout). #33 adds zero-noise
    // class/ER semantic geometry tripwires: relationship endpoints must sit on
    // class/entity box boundaries and boxes must remain on-canvas/non-overlap.
    const layout = layoutFamilyToRendered(d) ?? emptyRenderedLayout(d.kind)
    const familyGeometry = (d.body.kind === 'class' || d.body.kind === 'er')
      // Class namespaces are groups whose members are the namespaced class
      // boxes (family-layouts.ts), so containment is a reportable breach.
      ? layoutGeometryWarnings(layout, { edgeAnchors: true, nodeOverlaps: true, groupContainment: d.body.kind === 'class' })
      : layoutGeometryWarnings(layout, {
        nodeOverlaps: d.body.kind === 'journey',
        // Journey sections are groups with task members (family-layouts.ts),
        // so a task laid outside its section band is a reportable breach.
        groupContainment: d.body.kind === 'xychart' || d.body.kind === 'quadrant' || d.body.kind === 'journey',
      })
    return finalize(dedupedConcat(pluginWarnings, familyGeometry), layout, opts)
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
    // Systemic silent-opaque signal: a non-empty opaque body means the parser
    // met syntax it does not model and preserved the diagram verbatim, so the
    // `as*` narrower returns null and typed mutation is unavailable. Flowchart
    // and quadrant already emit a MORE SPECIFIC UNSUPPORTED_SYNTAX naming the
    // exact construct (via sourceWarnings / the quadrant verify hook, both in
    // pluginWarnings) — do not double-flag those. This one line generalizes
    // that announcement to the other families (class/state/er/xychart/pie/
    // journey/timeline/architecture/sequence) that used to fall opaque silently.
    if (!isEmpty && !pluginWarnings.some(w => w.code === 'UNSUPPORTED_SYNTAX')) {
      warnings.push({
        code: 'UNSUPPORTED_SYNTAX',
        syntax: `${d.kind}_opaque`,
        message: `This ${d.kind} diagram uses syntax the structured parser does not model; it is preserved verbatim as source. Typed mutation (the ${d.kind} \`as*\` narrower) is unavailable — edit the source directly, or verify/render it as-is.`,
      })
    }
    const seen = new Set<string>()
    for (const lbl of labels) {
      const w = labelOverflowWarning(lbl.target, lbl.text, cap)
      if (!w) continue
      const key = `${lbl.target}:${lbl.text}`
      if (seen.has(key)) continue
      seen.add(key)
      warnings.push(w)
    }
    // QUAL-1: opaque bodies of renderable families (pie/quadrant always, and
    // class/er/journey/architecture/xychart when unmodeled) still produce a
    // real positioned layout from canonicalSource. layoutFamilyToRendered
    // degrades to an empty layout on render-error, so this never throws.
    const opaqueLayout = d.kind === 'flowchart'
      ? layoutOpaqueFlowchart(d)
      : layoutFamilyToRendered(d) ?? emptyRenderedLayout(d.kind)
    // Opaque bodies are preserved-not-rendered: an empty local layout means
    // the syntax is unmodeled, not that the diagram is empty — the isEmpty
    // header-only check above owns genuine emptiness here.
    return finalize(dedupedConcat(warnings, pluginWarnings), opaqueLayout, opts, false)
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
    const hasSource = graph.nodes.has(edge.source) || Boolean(findSubgraphById(graph.subgraphs, edge.source))
    const hasTarget = graph.nodes.has(edge.target) || Boolean(findSubgraphById(graph.subgraphs, edge.target))
    if (!hasSource || !hasTarget) {
      warnings.push({
        code: 'EDGE_MISANCHORED', edge: `${edge.source}->${edge.target}`,
        from: hasSource ? edge.source : undefined,
        to: hasTarget ? edge.target : undefined,
      })
    }
  }
  for (const [id, node] of graph.nodes) {
    if (!KNOWN_SHAPES.has(node.shape)) warnings.push({ code: 'UNKNOWN_SHAPE', node: id, shape: String(node.shape) })
    const w = labelOverflowWarning(id, node.label, cap)
    if (w) warnings.push(w)
  }
  for (const edge of graph.edges) {
    const w = edge.label ? labelOverflowWarning(`${edge.source}->${edge.target}`, edge.label, cap) : null
    if (w) warnings.push(w)
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
  // See docs/design/system/route-contracts.md.
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
  // prev already went through the caller's guardEmptyLayout choice — don't
  // second-guess it here.
  return finalize(merged, prev.layout, opts, false)
}

function warningKey(w: LayoutWarning): string {
  // node disambiguates per-node lints that share a syntax and carry no line
  // (flowchart_shape_substitution) so two substituted nodes both surface.
  if (w.code === 'UNSUPPORTED_SYNTAX') return `${w.code}:${w.syntax}:${w.line ?? ''}:${w.node ?? ''}`
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

function verifyTimeline(d: ValidDiagram & { body: import('./types.ts').TimelineBody }, cap: number, opts: VerifyOptions): VerifyResult {
  const body = d.body
  const layout = layoutFamilyToRendered(d) ?? emptyRenderedLayout(d.kind)
  const warnings: LayoutWarning[] = []
  // Upstream parity (mirrors the journey furniture rule): a timeline with a
  // title, accessibility metadata, or sections — even period-less ones — still
  // renders as header/section furniture. Only a timeline with NOTHING is empty.
  const hasContent = body.sections.length > 0
    || body.title !== undefined
    || body.accessibilityTitle !== undefined
    || body.accessibilityDescription !== undefined
  if (!hasContent) return finalize([{ code: 'EMPTY_DIAGRAM' }], layout, opts)
  const overflow = (target: string, text: string | undefined) => {
    const w = text !== undefined ? labelOverflowWarning(target, text, cap) : null
    if (w) warnings.push(w)
  }
  overflow('title', body.title)
  for (const s of body.sections) {
    overflow(s.id, s.label)
    for (const p of s.periods) {
      overflow(p.id, p.label)
      for (const e of p.events) overflow(e.id, e.text)
    }
  }
  return finalize(dedupedConcat(warnings, layoutGeometryWarnings(layout, { nodeOverlaps: true, groupContainment: true })), layout, opts)
}

function verifySequence(d: ValidDiagram & { body: SequenceBody }, cap: number, opts: VerifyOptions): VerifyResult {
  const body = d.body
  const layout = layoutFamilyToRendered(d) ?? emptyRenderedLayout(d.kind)
  const warnings: LayoutWarning[] = []
  // BUILD-18: a segment-preserving body may carry content only in opaque-block
  // segments (e.g. activation-shorthand messages `A->>+B`, blocks). That is
  // not an empty diagram — it just isn't structurally modeled.
  const hasOpaqueContent = (body.statements ?? []).some(
    s => s.kind === 'opaque-block' && s.lines.some(l => l.trim().length > 0),
  )
  if (body.participants.length === 0 && body.messages.length === 0 && !hasOpaqueContent) {
    return finalize([{ code: 'EMPTY_DIAGRAM' }], layout, opts, false)
  }
  const ids = new Set(body.participants.map(p => p.id))
  body.messages.forEach((m, i) => {
    if (!ids.has(m.from) || !ids.has(m.to)) {
      warnings.push({
        code: 'EDGE_MISANCHORED', edge: `msg#${i}:${m.from}->${m.to}`,
        from: ids.has(m.from) ? m.from : undefined, to: ids.has(m.to) ? m.to : undefined,
      })
    }
    const w = labelOverflowWarning(`msg#${i}:${m.from}->${m.to}`, m.text, cap)
    if (w) warnings.push(w)
  })
  for (const p of body.participants) {
    const w = labelOverflowWarning(p.id, p.label, cap)
    if (w) warnings.push(w)
  }
  // BUILD-18: opaque-block segments (Note/alt/loop/par/title lines) still get
  // universal LABEL_OVERFLOW via the family's label extractor, so the safety
  // check survives the move from whole-body-opaque to structured-with-segments.
  const opaqueLines = (body.statements ?? [])
    .filter((s): s is Extract<typeof s, { kind: 'opaque-block' }> => s.kind === 'opaque-block')
    .flatMap(s => s.lines)
  if (opaqueLines.length > 0) {
    const plugin = getFamily(d.kind)
    const labels = (plugin?.extractLabels ?? extractLabelsGeneric)(opaqueLines.join('\n'))
    const seen = new Set<string>()
    for (const lbl of labels) {
      const w = labelOverflowWarning(lbl.target, lbl.text, cap)
      if (!w) continue
      const key = `${lbl.target}:${lbl.text}`
      if (seen.has(key)) continue
      seen.add(key)
      warnings.push(w)
    }
  }
  // The empty-layout tripwire only arms when there is no structured content:
  // opaque-only segments still have to lay out SOMETHING (a malformed message
  // like `Alice->>` renders a 0x0 canvas — announce it), whereas a sequence
  // WITH participants whose family layout degrades to empty (e.g.
  // semicolon-packed statements) is a renderer limitation, not emptiness.
  const guardEmpty = body.participants.length === 0 && body.messages.length === 0
  return finalize(dedupedConcat(warnings, layoutGeometryWarnings(layout, { nodeOverlaps: true })), layout, opts, guardEmpty)
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

function finalize(warnings: LayoutWarning[], layout: RenderedLayout, opts: VerifyOptions, guardEmptyLayout = true): VerifyResult {
  const suppress = new Set<WarningCode>(opts.suppress ?? [])
  const kept = warnings.filter(w => !suppress.has(w.code))
  const ok = !kept.some(w => WARNING_SEVERITY[w.code] === 'error')
  // Empty-layout tripwire over the FINAL layout: a 0x0 canvas with no
  // nodes/edges/groups renders as visually nothing, so it must never verify
  // clean (e.g. `sequenceDiagram\n Alice->>` — a malformed message that lays
  // out zero participants). Source that carries content the local layout
  // cannot express stays ok (the upstream-suite bench pins that), so the
  // announcement is UNSUPPORTED_SYNTAX — warning severity, consistent with
  // the ok verdict — never an appended EMPTY_DIAGRAM, whose declared severity
  // is error and would contradict ok:true for callers that gate on it. Truly
  // content-less diagrams keep the explicit, ok-flipping EMPTY_DIAGRAM their
  // verify paths already push. Callers whose empty layout means "unmodeled,
  // preserved" rather than "renders nothing" (opaque bodies) opt out via
  // guardEmptyLayout=false.
  if (guardEmptyLayout && !suppress.has('UNSUPPORTED_SYNTAX')
    && layout.nodes.length === 0 && layout.edges.length === 0 && layout.groups.length === 0
    && layout.bounds.w === 0 && layout.bounds.h === 0
    && !kept.some(w => w.code === 'EMPTY_DIAGRAM')
    && !kept.some(w => w.code === 'UNSUPPORTED_SYNTAX' && w.syntax === 'empty_layout')) {
    return {
      ok,
      warnings: [...kept, { code: 'UNSUPPORTED_SYNTAX', syntax: 'empty_layout', message: 'The source carries content, but the local layout renders nothing (0x0 canvas with no nodes, edges, or groups).' }],
      layout,
    }
  }
  return { ok, warnings: kept, layout }
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
