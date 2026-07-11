// ============================================================================
// Sequence runtime config — the single wire-or-warn table (family-elevation-
// plan §Sequence item 6, config half; the class/er/flowchart pattern).
//
// Mermaid's documented SequenceDiagramConfig keys split into exactly two
// buckets, defined HERE so wiring and warning cannot drift:
//
//   WIRED (natural mappings in src/sequence/layout.ts):
//     actorMargin      → gap between actor box edges (upstream: center gap =
//                        (w₁+w₂)/2 + actorMargin)
//     width / height   → actor box minimum size (defaults 80 / 40 preserved)
//     diagramMarginX/Y → outer padding (default 30 preserved)
//     messageMargin    → vertical advance per message row (default 40)
//     noteMargin       → gap between a note and its anchor actor (default 10)
//     activationWidth  → activation rect width (default 10)
//     showSequenceNumbers → autonumber display, threaded into the parser so
//                        SVG and ASCII surfaces agree
//
//   NOOP (accepted for config-shape compatibility, no geometry/paint here —
//   verify names each present key via INEFFECTIVE_CONFIG): wrap, mirrorActors,
//   fonts, loop-box label metrics, alignment, and the interactivity knobs.
//   Font keys deliberately stay unwired: typography routes through the style
//   system (RenderOptions.style roles), not per-family config.
//
// Absent config resolves to {} and every layout formula falls back to the
// historical constants — default geometry stays byte-identical (asserted by
// src/__tests__/sequence-config.test.ts and the svg-equivalence corpus gate).
// ============================================================================

import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterMap, getFrontmatterScalar } from '../mermaid-source.ts'

/** Wired keys, resolved and validated. All optional: absent = default. */
export interface ResolvedSequenceConfig {
  actorMargin?: number
  width?: number
  height?: number
  diagramMarginX?: number
  diagramMarginY?: number
  messageMargin?: number
  noteMargin?: number
  activationWidth?: number
  showSequenceNumbers?: boolean
}

const WIRED_NUMBER_FIELDS = [
  'actorMargin', 'width', 'height', 'diagramMarginX', 'diagramMarginY',
  'messageMargin', 'noteMargin', 'activationWidth',
] as const

export const SEQUENCE_WIRED_CONFIG_FIELDS = [...WIRED_NUMBER_FIELDS, 'showSequenceNumbers'] as const

/** Documented-but-unwired sequence config keys (Tier-3 INEFFECTIVE_CONFIG). */
export const SEQUENCE_NOOP_CONFIG_FIELDS = [
  'actorFontFamily', 'actorFontSize', 'actorFontWeight',
  'arrowMarkerAbsolute', 'bottomMarginAdj', 'boxMargin', 'boxTextMargin',
  'forceMenus', 'hideUnusedParticipants', 'labelBoxHeight', 'labelBoxWidth',
  'messageAlign', 'messageFontFamily', 'messageFontSize', 'messageFontWeight',
  'mirrorActors', 'noteAlign', 'noteFontFamily', 'noteFontSize', 'noteFontWeight',
  'rightAngles', 'useMaxWidth', 'useWidth', 'wrap', 'wrapPadding',
] as const

/**
 * Resolve the wired `sequence` config section from the merged frontmatter map
 * (YAML frontmatter `config.sequence` and `%%{init: {"sequence": …}}%%` both
 * land there). Numbers must be finite and non-negative; anything else is
 * ignored rather than propagated into geometry.
 */
export function resolveSequenceConfig(frontmatter: MermaidFrontmatterMap | undefined): ResolvedSequenceConfig {
  if (!frontmatter || !getFrontmatterMap(frontmatter, ['sequence'])) return {}
  const out: ResolvedSequenceConfig = {}
  for (const field of WIRED_NUMBER_FIELDS) {
    const value = getFrontmatterScalar<number>(frontmatter, ['sequence', field])
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[field] = value
  }
  const numbers = getFrontmatterScalar<boolean>(frontmatter, ['sequence', 'showSequenceNumbers'])
  if (numbers === true) out.showSequenceNumbers = true
  return out
}

/**
 * NOOP keys present in the given config objects, sorted — the input to
 * verify's INEFFECTIVE_CONFIG warnings. The table lives beside the wiring so
 * wire and warn cannot drift.
 */
export function sequenceIneffectiveConfigFields(configs: unknown[]): string[] {
  const present = new Set<string>()
  for (const config of configs) {
    if (!config || typeof config !== 'object') continue
    for (const field of SEQUENCE_NOOP_CONFIG_FIELDS) {
      if (field in (config as Record<string, unknown>)) present.add(field)
    }
  }
  return [...present].sort()
}
