// ============================================================================
// Sequence runtime config — wire-or-warn (family-elevation-
// plan §Sequence item 6, config half; the class/er/flowchart pattern).
//
// Mermaid's documented SequenceDiagramConfig keys split into exactly two
// buckets: WIRED keys are resolved HERE; NOOP keys are the registry's sequence
// config.noopKeys in src/agent/families.ts, which verify's lint reads:
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
// Absent config resolves to {} and every layout formula uses the canonical
// sequence defaults asserted by src/__tests__/sequence-config.test.ts.
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
