// ============================================================================
// verifyMermaid — Tier 1 (source/structure) + Tier 2 (geometric) + Tier 3 (lint).
//
// v4: no LayoutContext, no seed wrapper (ELK is deterministic on its own).
// LABEL_OVERFLOW is a rendered-line char-count check (Tier 1): the cap applies
// to the longest displayed line (entities decoded, <br> splits), not raw
// source chars — see label-metrics.ts.
// ============================================================================

import { parseRegisteredMermaid } from './parse.ts'
import { serializeMermaid } from './serialize.ts'
import { logToolInvocation } from './trace-log.ts'
import { countStructuralElements, faithfulnessWarning } from './structural-count.ts'
import { lowerPositionedFamilyScene, renderPositionedMermaidSVG } from '../graphical-render.ts'
import { auditRouteContracts, findRouteHitches } from '../route-contracts.ts'
import type { PositionedGraph } from '../types.ts'
import type {
  ParsedDiagram, ExtensionValidDiagram, ValidDiagram, VerifyOptions, VerifyResult, LayoutWarning, RenderedLayout,
  WarningCode, SequenceBody,
} from './types.ts'
import { WARNING_SEVERITY, DEFAULT_LABEL_CHAR_CAP } from './types.ts'
import { emptyRenderedLayout } from './layout-to-rendered.ts'
import {
  FamilyLayoutError,
  positionFamilyArtifact,
  ganttGeometryWarnings,
  ganttScheduleWarning,
  layoutGeometryWarnings,
  type ProjectedFamilyArtifact,
} from './family-layouts.ts'
import { getFamily, extractLabelsGeneric, builtinFamilyMetadata } from './families.ts'
import { labelOverflowWarning } from './label-metrics.ts'
import { stateBodyToGraph } from './state-body.ts'
import { flowchartUnsupportedSyntaxWarnings } from './flowchart-unsupported.ts'
import { erUnsupportedSyntaxWarnings } from './er-body.ts'
import { parseGanttModel, applyGanttFrontmatterConfig } from '../gantt/parser.ts'
import { parseTodayMarkerStyle, GANTT_TODAY_MARKER_STYLE_PROPS } from '../gantt/today-marker.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { normalizeV11Shape } from '../flowchart-shapes.ts'
import { familyConfigDiagnostics } from '../shared/family-config-diagnostics.ts'
import { sequenceMessages } from './sequence-body.ts'
import { sameExtensionIdentity } from '../shared/extension-identity.ts'
import { wcagCssContrastRatio } from '../shared/color-math.ts'
import { evaluateBrandConstraints } from '../scene/brand-constraints.ts'

function familyConfigShapeWarnings(d: ValidDiagram): LayoutWarning[] {
  const roots: unknown[] = [d.meta.frontmatter, ...d.meta.initDirectives.map(directive => directive.parsed)]
  return familyConfigDiagnostics(d.kind, roots)
}

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
    const reparsed = parseRegisteredMermaid(serializeMermaid(d))
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

export function verifyMermaid(input: ParsedDiagram | string, opts: VerifyOptions = {}): VerifyResult {
  logToolInvocation('verify')
  const parsed = typeof input === 'string' ? parseRegisteredMermaid(input) : { ok: true as const, value: input }
  if (!parsed.ok) {
    // Strict parsing must fail closed, but source-level repair diagnostics are
    // still valuable (and were historically part of verify's contract).
    // Report them alongside the hard failure instead of making malformed
    // delimiters and dangling edges disappear merely because admission failed.
    const sourceWarnings = typeof input === 'string' ? flowchartUnsupportedSyntaxWarnings(input) : []
    return finalize([{ code: 'EMPTY_DIAGRAM' }, ...sourceWarnings], emptyRenderedLayout('flowchart'), opts)
  }
  if (parsed.value.body.kind === 'preserved') {
    const { diagnostic } = parsed.value.body
    return finalize(
      [{ code: 'RENDER_FAILED', reason: `${diagnostic.code}: ${diagnostic.message}` }],
      emptyRenderedLayout(parsed.value.kind),
      opts,
      false,
    )
  }
  const positioned = memoizedVerificationArtifact(parsed.value, opts)
  try {
    const structured = verifyStructure(parsed.value, opts, positioned)
    return withRenderParity(withBrandConstraints(structured, opts, positioned), opts, positioned)
  } catch (error) {
    if (!(error instanceof FamilyLayoutError)) throw error
    return finalize(
      [{ code: 'RENDER_FAILED', reason: error.message }],
      emptyRenderedLayout(parsed.value.kind),
      opts,
      false,
    )
  }
}

type VerificationArtifact = () => ProjectedFamilyArtifact | null

function withBrandConstraints(
  result: VerifyResult,
  opts: VerifyOptions,
  positioned: VerificationArtifact,
): VerifyResult {
  if (!result.ok) return result
  try {
    const artifact = positioned()
    const constraints = artifact?.request.appearance.style?.constraints
    if (!artifact || !constraints || constraints.length === 0) return result
    const scene = lowerPositionedFamilyScene(artifact.request, artifact.layoutResult)
    const suppressed = new Set(opts.suppress ?? [])
    const warnings = evaluateBrandConstraints(scene, artifact.request)
      .filter(warning => !suppressed.has(warning.code))
    return {
      ...result,
      ok: result.ok && !warnings.some(warning => WARNING_SEVERITY[warning.code] === 'error'),
      warnings: [...result.warnings, ...warnings],
    }
  } catch {
    // The canonical render-parity gate owns layout/Scene failures. Constraint
    // inspection never replaces that primary diagnosis.
    return result
  }
}

/** One lazy artifact per verify call; failures are memoized as well as values. */
function memoizedVerificationArtifact(d: ParsedDiagram, opts: VerifyOptions): VerificationArtifact {
  let attempted = false
  let artifact: ProjectedFamilyArtifact | null = null
  let failure: unknown
  return () => {
    if (attempted) {
      if (failure !== undefined) throw failure
      return artifact
    }
    attempted = true
    try {
      // Resolve the graphical plan up front, then project its exact positioned
      // result for geometric verification. The renderability gate consumes
      // this same request + result and therefore cannot parse or lay out again.
      artifact = positionFamilyArtifact(d, {
        renderOptions: opts.renderOptions,
        output: 'svg',
      })
      return artifact
    } catch (error) {
      failure = error
      throw error
    }
  }
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
function withRenderParity(
  result: VerifyResult,
  opts: VerifyOptions,
  positioned: VerificationArtifact,
): VerifyResult {
  if (!result.ok || (opts.suppress ?? []).some(code => code === 'RENDER_FAILED' || WARNING_SEVERITY[code] === 'error')) return result
  try {
    const artifact = positioned()
    if (!artifact) throw new Error(`Mermaid family "${result.layout.kind}" has no positioned graphical artifact`)
    renderPositionedMermaidSVG(artifact.request, artifact.layoutResult, [])
    return result
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return { ...result, ok: false, warnings: [...result.warnings, { code: 'RENDER_FAILED', reason }] }
  }
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

/** Preserve Mermaid-authored Radar paint exactly and diagnose measurable
 * contrast after request resolution. This consumes the same frozen visual
 * config and background as rendering, so verification never guesses from raw
 * source or introduces an automatic repaint stage. */
function radarAuthoredContrastWarnings(positioned: VerificationArtifact): LayoutWarning[] {
  try {
    const artifact = positioned()
    if (artifact?.request.renderOptions.transparent) return []
    const visual = artifact?.request.familyConfig?.visual as { axisColor?: unknown } | undefined
    const foreground = visual?.axisColor
    if (typeof foreground !== 'string') return []
    const background = artifact!.request.appearance.colors.bg
    const ratio = wcagCssContrastRatio(foreground, background)
    if (ratio === null || ratio >= 4.5) return []
    const roundedRatio = Math.round(ratio * 100) / 100
    return [{
      code: 'LOW_CONTRAST',
      field: 'themeVariables.radar.axisColor',
      foreground,
      background,
      ratio: roundedRatio,
      minimum: 4.5,
      message: `Authored Radar axis label color ${foreground} has contrast ${roundedRatio}:1 against ${background}; expected at least 4.5:1. The color is preserved as authored.`,
    }]
  } catch {
    // Layout/render failures have their own RENDER_FAILED path; do not replace
    // the primary diagnosis with a speculative contrast warning.
    return []
  }
}

export function configWarningsForDiagram(d: ParsedDiagram): LayoutWarning[] {
  if (d.body.kind === 'extension' || d.body.kind === 'preserved') return []
  const builtin = d as ValidDiagram
  const familySpecific = builtin.kind === 'gantt' ? ganttTodayMarkerWarnings(builtin) : []
  return dedupedConcat(familySpecific, familyConfigShapeWarnings(builtin))
}

/** Lightweight source-only config diagnostics; never lays out or renders. */
export function configWarningsForMermaid(source: string): LayoutWarning[] {
  const parsed = parseRegisteredMermaid(source)
  return parsed.ok ? configWarningsForDiagram(parsed.value) : []
}

function verifyStructure(
  parsed: ParsedDiagram,
  opts: VerifyOptions,
  positioned: VerificationArtifact,
): VerifyResult {
  const cap = opts.labelCharCap ?? DEFAULT_LABEL_CHAR_CAP

  // FamilyDescriptor verify dispatcher pass: every registered family's `verify`
  // hook gets a chance to contribute warnings. Runs ahead of per-body branches
  // so descriptors can hook into any body kind (structured or opaque). Closes the
  // dead-code gap where `FamilyDescriptor.verify` was declared but never invoked.
  // 2C comment policy: in-body comments that structured serialization drops
  // (recorded at parse time) surface here as the Tier 3 COMMENT_DROPPED lint,
  // so the loss is announced rather than silent.
  const metaWarnings: LayoutWarning[] = parsed.meta.droppedComments?.length
    ? [{ code: 'COMMENT_DROPPED', count: parsed.meta.droppedComments.length, lines: parsed.meta.droppedComments.map(c => c.line) }]
    : []
  const dispatchedWarnings = dispatchFamilyVerify(parsed, opts)
  if (parsed.body.kind === 'extension') {
    return verifyExtension(parsed as ExtensionValidDiagram, cap, opts, dedupedConcat(metaWarnings, dispatchedWarnings), positioned)
  }

  const d = parsed as ValidDiagram
  const sourceWarnings = d.kind === 'flowchart'
    ? dedupedConcat(flowchartUnsupportedSyntaxWarnings(d.canonicalSource), flowchartShapeSubstitutionWarnings(d))
    : d.kind === 'er' ? erUnsupportedSyntaxWarnings(d.canonicalSource)
    : d.kind === 'quadrant' ? quadrantInertStyleWarnings(d) : []
  const faithfulnessWarnings = roundtripFaithfulnessWarnings(d)
  const configWarnings = configWarningsForDiagram(d)
  let pluginWarnings = dedupedConcat(dedupedConcat(dedupedConcat(dedupedConcat(metaWarnings, dispatchedWarnings), sourceWarnings), faithfulnessWarnings), configWarnings)
  // Mermaid treats universal accessibility metadata as renderable document
  // furniture. A classDiagram containing only accTitle/accDescr therefore is
  // not an empty source even though its structural layout has zero classes.
  // The metadata lives in the normalized envelope, not in ClassBody, so remove
  // only the body-local emptiness verdict here at their shared boundary.
  if (d.body.kind === 'class' && (d.meta.accessibility.title !== undefined || d.meta.accessibility.descr !== undefined)) {
    pluginWarnings = pluginWarnings.filter(warning => warning.code !== 'EMPTY_DIAGRAM')
  }

  if (d.body.kind === 'sequence') return mergeFinalize(verifySequence(d as ValidDiagram & { body: SequenceBody }, cap, opts, positioned), pluginWarnings, opts)
  if (d.body.kind === 'timeline') return mergeFinalize(verifyTimeline(d as ValidDiagram & { body: import('./types.ts').TimelineBody }, cap, opts, positioned), pluginWarnings, opts)
  // class + ER: the FamilyDescriptor.verify hooks from the atomic registry
  // already produce the per-body warnings. Loop 9 M2 removes the duplicate
  // explicit branches; the dispatcher path + emptyRenderedLayout fall-through
  // does the work. Dedup is unnecessary now (single source of truth) so we
  // emit pluginWarnings directly.
  // class + ER + journey + architecture: the FamilyDescriptor.verify hooks produce
  // the per-body warnings (journey added by BUILD-15, architecture by BUILD-17).
  // Gantt adds geometric tripwires (OFF_CANVAS / GROUP_BREACH) over its real
  // layout and surfaces unresolvable schedules (UNRESOLVABLE_SCHEDULE),
  // alongside the body-level descriptor warnings — see docs/design/families/gantt.md
  // §Verification.
  if (d.body.kind === 'gantt') {
    // Schedule resolution is the named render precondition for Gantt. If it
    // fails, do not invoke layout merely to translate the same exception into
    // a second, less-specific RENDER_FAILED warning (or an empty-layout lint).
    // This also keeps the documented suppression knob meaningful: callers
    // acknowledging UNRESOLVABLE_SCHEDULE do not have the same failure
    // resurrected under a generic code.
    const schedFail = ganttScheduleWarning(d)
    if (schedFail) {
      return finalize(
        dedupedConcat(pluginWarnings, [schedFail]),
        emptyRenderedLayout(d.kind),
        opts,
        false,
      )
    }
    const layoutOutcome = familyLayoutForVerify(d, positioned)
    const layout = layoutOutcome.layout
    const geometric = dedupedConcat(
      ganttGeometryWarnings(layout),
      layoutOutcome.warnings,
    )
    return finalize(dedupedConcat(pluginWarnings, geometric), layout, opts)
  }

  if (d.body.kind === 'class' || d.body.kind === 'er' || d.body.kind === 'journey' || d.body.kind === 'architecture' || d.body.kind === 'xychart' || d.body.kind === 'pie' || d.body.kind === 'quadrant' || d.body.kind === 'mindmap' || d.body.kind === 'gitgraph' || d.body.kind === 'radar') {
    // QUAL-1: verify.layout is now truthful — the real positioned layout from
    // the family adapters (was emptyRenderedLayout). #33 adds zero-noise
    // class/ER semantic geometry tripwires: relationship endpoints must sit on
    // class/entity box boundaries and boxes must remain on-canvas/non-overlap.
    const layoutOutcome = familyLayoutForVerify(d, positioned)
    const layout = layoutOutcome.layout
    const familyGeometry = (d.body.kind === 'class' || d.body.kind === 'er')
      // Class namespaces are groups whose members are the namespaced class
      // boxes (family-layouts.ts), so containment is a reportable breach.
      ? layoutGeometryWarnings(layout, { edgeAnchors: true, nodeOverlaps: true, groupContainment: d.body.kind === 'class' })
      : layoutGeometryWarnings(layout, {
        nodeOverlaps: d.body.kind === 'journey',
        // Journey sections are groups with task members (family-layouts.ts),
        // so a task laid outside its section band is a reportable breach.
        groupContainment: d.body.kind === 'xychart' || d.body.kind === 'quadrant'
          ? 'center'
          : d.body.kind === 'journey',
      })
    const appearanceWarnings = d.body.kind === 'radar'
      ? radarAuthoredContrastWarnings(positioned)
      : []
    return finalize(
      dedupedConcat(dedupedConcat(dedupedConcat(pluginWarnings, familyGeometry), layoutOutcome.warnings), appearanceWarnings),
      layout,
      opts,
    )
  }

  // State diagrams (BUILD-19): the StateBody projects to a MermaidGraph via the
  // legacy state parser — the exact graph the renderer lays out — so the full
  // flowchart Tier 1 + Tier 2 geometric path runs unchanged. pluginWarnings
  // (verifyState) add the body-level structural checks on the StateBody itself.
  if (d.body.kind === 'state') {
    const graph = stateBodyToGraph(d.body)
    if (graph.nodes.size === 0) return finalize(dedupedConcat([{ code: 'EMPTY_DIAGRAM' }], pluginWarnings), emptyRenderedLayout(d.kind), opts)
    const { warnings, layout } = verifyGraph(graph, d, cap, positioned)
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
    // real positioned layout from canonicalSource. Descriptor failures become
    // an explicit RENDER_FAILED result below rather than escaping verification.
    const layoutOutcome = familyLayoutForVerify(d, positioned)
    const opaqueLayout = layoutOutcome.layout
    // Opaque bodies are preserved-not-rendered: an empty local layout means
    // the syntax is unmodeled, not that the diagram is empty — the isEmpty
    // header-only check above owns genuine emptiness here.
    return finalize(dedupedConcat(dedupedConcat(warnings, pluginWarnings), layoutOutcome.warnings), opaqueLayout, opts, false)
  }

  const graph = d.body.graph
  if (graph.nodes.size === 0) return finalize([{ code: 'EMPTY_DIAGRAM' }], emptyRenderedLayout(d.kind), opts)
  const { warnings: graphWarnings, layout: graphLayout } = verifyGraph(graph, d, cap, positioned)
  return finalize(dedupedConcat(graphWarnings, pluginWarnings), graphLayout, opts)
}

/** Registered families use their own verify and positioned-projection hooks;
 * core contributes only the family-neutral label cap and explicit failures. */
function verifyExtension(
  d: ExtensionValidDiagram,
  cap: number,
  opts: VerifyOptions,
  initialWarnings: LayoutWarning[],
  positioned: VerificationArtifact,
): VerifyResult {
  const warnings = [...initialWarnings]
  const descriptor = getFamily(d.kind)
  const labels = (descriptor?.extractLabels ?? extractLabelsGeneric)(d.body.source)
  const seenLabels = new Set<string>()
  for (const label of labels) {
    const warning = labelOverflowWarning(label.target, label.text, cap)
    if (!warning) continue
    const key = `${label.target}:${label.text}`
    if (seenLabels.has(key)) continue
    seenLabels.add(key)
    warnings.push(warning)
  }

  const layoutOutcome = familyLayoutForVerify(d, positioned)
  return finalize([...warnings, ...layoutOutcome.warnings], layoutOutcome.layout, opts, false)
}

function familyLayoutForVerify(
  d: ParsedDiagram,
  positioned: VerificationArtifact,
): { layout: RenderedLayout; warnings: LayoutWarning[] } {
  try {
    const artifact = positioned()
    return artifact
      ? { layout: artifact.rendered, warnings: [] }
      : {
          layout: emptyRenderedLayout(d.kind),
          warnings: [{
            code: 'RENDER_FAILED',
            reason: `Mermaid family "${d.kind}" has no public layout projection registered`,
          }],
        }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      layout: emptyRenderedLayout(d.kind),
      warnings: [{ code: 'RENDER_FAILED', reason }],
    }
  }
}

/**
 * Full Tier 1 (structural) + Tier 2 (geometric) + Tier 3 (lint) verify over a
 * MermaidGraph. Shared by flowchart bodies and state-diagram bodies (which
 * project to a graph via stateBodyToGraph). Returns warnings + the rendered
 * layout; the caller finalizes (suppress + ok flag).
 */
function verifyGraph(
  graph: import('../types.ts').MermaidGraph,
  d: ValidDiagram,
  cap: number,
  positionedArtifact: VerificationArtifact,
): { warnings: LayoutWarning[]; layout: RenderedLayout } {
  let artifact: ProjectedFamilyArtifact | null
  try {
    artifact = positionedArtifact()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { warnings: [{ code: 'RENDER_FAILED', reason }], layout: emptyRenderedLayout(d.kind) }
  }
  if (!artifact || !isPositionedGraph(artifact.positioned)) {
    return {
      warnings: [{ code: 'UNSUPPORTED_SYNTAX', syntax: 'positioned_artifact', message: `The ${d.kind} family did not produce its declared positioned-graph artifact.` }],
      layout: emptyRenderedLayout(d.kind),
    }
  }
  const positioned = artifact.positioned
  const layout = artifact.rendered
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
 * Run the registered FamilyDescriptor.verify hook for this diagram's kind.
 * Returns the warnings the descriptor produced. Registered extension families
 * without a hook, and hooks that throw, become explicit verification errors.
 */
function dispatchFamilyVerify(d: ParsedDiagram, opts: VerifyOptions): LayoutWarning[] {
  const plugin = getFamily(d.kind)
  if (!plugin?.verify) return d.body.kind === 'extension'
    ? [{ code: 'RENDER_FAILED', reason: `Mermaid family "${d.kind}" has no verify hook registered` }]
    : []
  try {
    let body = d.body
    if (d.body.kind === 'extension') {
      const extension = d as ExtensionValidDiagram
      if (!sameExtensionIdentity(extension.descriptorIdentity, plugin.identity)) {
        // Descriptor-owned structured data is meaningful only to the exact
        // registration that produced it. Serialize falls back to this same
        // core-owned source on an identity mismatch; reparse that source under
        // the current descriptor before invoking its verification hook.
        const reparsed = parseRegisteredMermaid(serializeMermaid(d))
        if (!reparsed.ok || reparsed.value.kind !== d.kind || reparsed.value.body.kind !== 'extension') {
          return [{
            code: 'RENDER_FAILED',
            reason: `Mermaid family "${d.kind}" could not reparse source under its current descriptor before verification`,
          }]
        }
        body = reparsed.value.body
      }
    }
    return plugin.verify(body, opts)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return [{ code: 'RENDER_FAILED', reason: `Mermaid family "${d.kind}" verify hook failed: ${reason}` }]
  }
}

/** finalize() variant that merges an already-finalized result with extra warnings.
 *  Loop 9 M10: now delegates fully to dedupedConcat → finalize. Dedupes on
 *  (code, target/edge/node) so a descriptor verify hook returning a warning
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
  if (w.code === 'RENDER_FAILED') return `${w.code}:${w.reason}`
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

function verifyTimeline(
  d: ValidDiagram & { body: import('./types.ts').TimelineBody },
  cap: number,
  opts: VerifyOptions,
  positioned: VerificationArtifact,
): VerifyResult {
  const body = d.body
  const layoutOutcome = familyLayoutForVerify(d, positioned)
  const layout = layoutOutcome.layout
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
  return finalize(dedupedConcat(dedupedConcat(warnings, layoutGeometryWarnings(layout, { nodeOverlaps: true, groupContainment: true })), layoutOutcome.warnings), layout, opts)
}

function verifySequence(
  d: ValidDiagram & { body: SequenceBody },
  cap: number,
  opts: VerifyOptions,
  positioned: VerificationArtifact,
): VerifyResult {
  const body = d.body
  const layoutOutcome = familyLayoutForVerify(d, positioned)
  const layout = layoutOutcome.layout
  const warnings: LayoutWarning[] = []
  // BUILD-18: a segment-preserving body may carry content only in opaque-block
  // segments (e.g. activation-shorthand messages `A->>+B`, blocks). That is
  // not an empty diagram — it just isn't structurally modeled.
  const hasOpaqueContent = body.statements.some(
    s => s.kind === 'opaque-block' && s.lines.some(l => l.trim().length > 0),
  )
  const allMessages = sequenceMessages(body)
  if (body.participants.length === 0 && allMessages.length === 0 && !hasOpaqueContent) {
    return finalize([{ code: 'EMPTY_DIAGRAM' }], layout, opts, false)
  }
  const ids = new Set(body.participants.map(p => p.id))
  allMessages.forEach((m, i) => {
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
  for (const statement of body.statements) if (statement.kind === 'fragment') {
    if (statement.fragment.label) {
      const w = labelOverflowWarning(`fragment:${statement.fragment.fragmentKind}`, statement.fragment.label, cap)
      if (w) warnings.push(w)
    }
    for (const [index, branch] of statement.fragment.branches.entries()) if (branch.label) {
      const w = labelOverflowWarning(`fragment:${statement.fragment.fragmentKind}:branch#${index}`, branch.label, cap)
      if (w) warnings.push(w)
    }
  }
  // BUILD-18: opaque-block segments (Note/alt/loop/par/title lines) still get
  // universal LABEL_OVERFLOW via the family's label extractor, so the safety
  // check survives the move from whole-body-opaque to structured-with-segments.
  const opaqueLines = body.statements
    .filter((s): s is Extract<typeof s, { kind: 'opaque-block' }> => s.kind === 'opaque-block')
    .flatMap(s => s.lines)
  if (opaqueLines.length > 0) {
    warnings.push({
      code: 'UNSUPPORTED_SYNTAX',
      syntax: 'sequence_opaque_segment',
      message: 'This sequence contains source-preserved constructs that are not represented in describe/facts or typed fragment operations. Inspect the source directly before relying on semantic read-back.',
    })
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
  const guardEmpty = body.participants.length === 0 && allMessages.length === 0
  return finalize(dedupedConcat(dedupedConcat(warnings, layoutGeometryWarnings(layout, { nodeOverlaps: true })), layoutOutcome.warnings), layout, opts, guardEmpty)
}

// ---- helpers --------------------------------------------------------------

function isPositionedGraph(positioned: import('../types.ts').PositionedDiagram): positioned is PositionedGraph {
  const candidate = positioned as Partial<PositionedGraph>
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges) && Array.isArray(candidate.groups)
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
