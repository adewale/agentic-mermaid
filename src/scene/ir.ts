// ============================================================================
// SceneGraph IR — the post-layout semantic render-mark tree (SPEC §3.1).
//
// Family renderers lower their positioned results to a SceneDoc instead of
// concatenating SVG strings directly. Each mark carries BOTH:
//   - semantic fields (role, geometry, paints, channels, stable id) that
//     styled backends (rough/hybrid) consume, and
//   - the exact crisp serialization, built at construction time from the same
//     inputs by the mark constructors in marks.ts, which the DefaultBackend
//     emits verbatim — so the default path stays byte-identical to the
//     pre-IR string renderers (guarded by svg-equivalence.test.ts).
//
// The scene-fidelity test (scene-fidelity.test.ts) parses each mark's crisp
// element and asserts the semantic fields agree with it, so a styled backend
// can never silently draw different geometry than crisp output shows.
//
// Determinism: constructing a SceneDoc is pure — no RNG, no clock. Stochastic
// styling happens inside styled backends, seeded per §8's substream contract
// (see seed.ts).
// ============================================================================

import type { DiagramColors } from '../theme.ts'

/** Semantic channels preserved across the renderer boundary (SPEC §5).
 *  `tone`/hue are style-derived outputs, not stored here. */
export interface SemanticChannels {
  /** Hierarchy / callout weight / star magnitude. */
  importance?: number
  /** Chart value or quantitative measure (normalized where known). */
  value?: number
  /** Chart series, entity type, swimlane, section identity. */
  category?: string
  /** e.g. gantt 'done' | 'active' | 'crit'; state 'start' | 'end'. */
  status?: string
  /** Task completion in [0,1]. */
  progress?: number
  /** Transit route / PCB net identity. */
  route?: string
  /** Author-flagged emphasis. */
  emphasis?: boolean
}

/** Mark roles. A closed set per family keeps backends role-aware ("don't
 *  hachure a lifeline; do hatch a node") without importing family modules. */
export type SceneRole =
  // shared / flowchart
  | 'node' | 'edge' | 'edge-label' | 'group' | 'group-header' | 'label'
  // sequence
  | 'actor' | 'lifeline' | 'activation' | 'message' | 'block' | 'note'
  // class / er
  | 'class-box' | 'member' | 'entity' | 'attribute' | 'relationship' | 'cardinality'
  // charts
  | 'pie-slice' | 'legend' | 'bar' | 'series' | 'point' | 'axis' | 'grid'
  | 'plate' | 'section' | 'task' | 'milestone' | 'marker-line'
  // timeline / journey / architecture
  | 'rail' | 'period' | 'event' | 'score' | 'actor-pill' | 'service' | 'junction' | 'icon'
  // document furniture
  | 'title' | 'defs' | 'prelude' | 'chrome'

/** Geometry a styled backend can redraw. Numbers are in final user units.
 *  Paint strings may be CSS var()/color-mix() refs — they resolve later via
 *  inlineResolvedColors, exactly like the crisp path. */
export type Geometry =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number; ry?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polygon'; points: Array<{ x: number; y: number }> }
  | { kind: 'polyline'; points: Array<{ x: number; y: number }> }
  | { kind: 'path'; d: string }
  | { kind: 'compound'; children: Geometry[] }

/** The resolved paint attached to a mark — already cascaded (theme tokens,
 *  classDef, inline style, role defaults) by the family lowering. */
export interface MarkPaint {
  fill?: string
  stroke?: string
  strokeWidth?: string
  strokeDasharray?: string
  opacity?: string
}

export interface SceneNodeBase {
  /** Stable identifier for seeding and cross-references. Derived from source
   *  semantics (node id, edge endpoints, slice label...), never list position
   *  (§8 seed contract). */
  id: string
  role: SceneRole
  channels?: SemanticChannels
  /** The exact crisp SVG serialization of this mark (possibly multi-line,
   *  possibly '' for marks that draw nothing, e.g. invisible edges). */
  crisp: string
}

export interface ShapeMark extends SceneNodeBase {
  kind: 'shape'
  geometry: Geometry
  paint: MarkPaint
}

export interface MarkerRef {
  /** Def id referenced via url(#...) — 'arrowhead', 'cls-inherit', ... */
  id: string
  /** Marker archetype so styled backends can redraw without parsing defs. */
  shape: 'arrow' | 'open-arrow' | 'circle' | 'cross' | 'triangle' | 'diamond' | 'diamond-open'
}

export interface ConnectorMark extends SceneNodeBase {
  kind: 'connector'
  geometry:
    | { kind: 'polyline'; points: Array<{ x: number; y: number }> }
    | { kind: 'path'; d: string; points?: Array<{ x: number; y: number }> }
    | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  lineStyle: 'solid' | 'dotted' | 'dashed' | 'thick' | 'invisible'
  paint: MarkPaint
  startMarker?: MarkerRef
  endMarker?: MarkerRef
}

export interface TextMark extends SceneNodeBase {
  kind: 'text'
  /** Unescaped source text (may contain <br> separators for multiline). */
  text: string
  /** Anchor position the crisp emitter used. */
  x: number
  y: number
  fontSize: number
  anchor: 'start' | 'middle' | 'end'
  paint: MarkPaint
}

/** A semantic wrapper (<g ...>...</g>) whose children are scene nodes.
 *  Serialization is reconstructed from open/close/children + per-child indent,
 *  so styled backends can restyle children while keeping wrapper semantics
 *  (classes, data-* attributes, ARIA) byte-compatible. */
export interface GroupMark extends SceneNodeBase {
  kind: 'group'
  open: string
  close: string
  children: Array<{ node: SceneNode; indent: number }>
  /** Joiner between open/children/close segments; '\n' everywhere today. */
  join: string
}

/** Escape hatch for chunks not yet lowered semantically (style blocks,
 *  defs bodies, icon glyph stacks...). Styled backends pass these through or
 *  replace them wholesale via their own prelude/defs policy — they must not
 *  parse them. Aim to shrink raw usage over time. */
export interface RawMark extends SceneNodeBase {
  kind: 'raw'
}

/** Document prelude parameters — everything svgOpenTag/buildStyleBlock were
 *  called with, so a styled backend can re-derive its own document shell
 *  (different palette, fonts, backdrop) without string-parsing the crisp one. */
export interface PreludeMark extends SceneNodeBase {
  kind: 'prelude'
  prelude: {
    width: number
    height: number
    colors: DiagramColors
    transparent: boolean
    font: string
    hasMonoFont: boolean
    /** Family-specific extra CSS appended after the shared style block ('' if none). */
    extraCss: string
  }
}

export type SceneNode = ShapeMark | ConnectorMark | TextMark | GroupMark | RawMark | PreludeMark

/** The lowered document: an ordered flat list of top-level marks. The crisp
 *  serialization is parts.map(crisp).join('\n') — exactly what the string
 *  renderers produced. */
export interface SceneDoc {
  family: string
  width: number
  height: number
  colors: DiagramColors
  parts: SceneNode[]
}
