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
import type { SvgSemanticIdentity } from './identity.ts'
import type { SvgSemanticAccessibility } from './accessibility.ts'
import type { PrimitiveRealization } from './capabilities.ts'

/** Version of the extension-facing Scene document/mark behavioral contract. */
export const SCENE_CONTRACT_VERSION = 1 as const
import type { SceneRole } from './roles.ts'

export type {
  BuiltinSceneRole, CoreSceneRole, NamespacedSceneRole, SceneRole,
  SceneRoleTraits, SceneSketchPolicy,
} from './roles.ts'

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
  strokeDashoffset?: string
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round'
  strokeMiterlimit?: string
  vectorEffect?: 'none' | 'non-scaling-stroke'
  paintOrder?: string
  opacity?: string
}

export type SceneTransform = { kind: 'rotate'; angle: number; cx: number; cy: number }

export interface SceneNodeBase {
  /** Stable identifier for seeding and cross-references. Derived from source
   *  semantics (node id, edge endpoints, slice label...), never list position
   *  (§8 seed contract). */
  id: string
  role: SceneRole
  /** Typed DOM identity mirrored as data-id/data-role on structured SVG marks. */
  identity?: SvgSemanticIdentity
  /** Typed accessibility semantics mirrored into ARIA on relation marks. */
  accessibility?: SvgSemanticAccessibility
  channels?: SemanticChannels
  /** Semantic geometry transform applied by every backend. */
  transform?: SceneTransform
  /** The exact crisp SVG serialization of this mark (possibly multi-line,
   *  possibly '' for marks that draw nothing, e.g. invisible edges). */
  crisp: string
}

export interface ShapeMark extends SceneNodeBase {
  kind: 'shape'
  geometry: Geometry
  paint: MarkPaint
}

export interface ScenePoint {
  x: number
  y: number
}

export interface SceneBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type MarkerShape = 'arrow' | 'open-arrow' | 'circle' | 'cross' | 'triangle' | 'diamond' | 'diamond-open'

/** Complete marker resource description. Existing family renderers need only
 * id/shape; extension renderers can provide geometry and bounds without
 * requiring a backend to inspect SVG defs. */
export interface MarkerDescriptor {
  /** Def id referenced via url(#...) — 'arrowhead', 'cls-inherit', ... */
  id: string
  /** Marker archetype so styled backends can redraw without parsing defs. */
  shape: MarkerShape
  geometry?: Geometry
  /** Marker viewport emitted as markerWidth/markerHeight. */
  size?: { width: number; height: number }
  viewBox?: { x: number; y: number; width: number; height: number }
  ref?: ScenePoint
  bounds?: SceneBox
  units?: 'strokeWidth' | 'userSpaceOnUse'
  orient?: 'auto' | 'auto-start-reverse' | number
  overflow?: 'hidden' | 'visible'
  paint?: MarkPaint
  /** Scalar relative to marker units; used for conservative bounds. */
  scale?: number
}

/** Compatibility name used by existing family lowerings. */
export type MarkerRef = MarkerDescriptor

export type ConnectorGeometry =
  | { kind: 'polyline'; points: Array<ScenePoint> }
  /** Curved path plus its deterministic routed polyline projection. Requiring
   * points keeps bounds, hit-testing, tangents and terminal projection total
   * without asking consumers to reparse SVG path data. */
  | { kind: 'path'; d: string; points: Array<ScenePoint> }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }

export type ConnectorDirection = 'forward' | 'reverse' | 'bidirectional' | 'undirected' | 'self'

export interface ConnectorEndpointAnchor {
  /** Semantic node/entity identifier. */
  id?: string
  /** Optional family-owned port/terminal identifier. */
  portId?: string
  /** Routed endpoint in final user units. */
  point?: ScenePoint
}

export interface ConnectorEndpoints {
  from?: string
  to?: string
  start?: ConnectorEndpointAnchor
  end?: ConnectorEndpointAnchor
}

export interface ConnectorRelationship {
  /** Family vocabulary, e.g. dependency, inheritance, parent, message. */
  kind: string
  direction: ConnectorDirection
}

export interface ConnectorRoute {
  geometry: ConnectorGeometry
  ownership: 'authored' | 'layout' | 'family' | 'projected'
  closed: boolean
  bendRadius: number
  startTangent?: ScenePoint
  endTangent?: ScenePoint
  labelAnchors: readonly ScenePoint[]
}

export interface ConnectorDash {
  array: string | readonly number[]
  offset?: string | number
}

export interface ConnectorStroke {
  color: string
  width: string | number
  opacity?: string | number
  dash?: ConnectorDash
  lineCap: 'butt' | 'round' | 'square'
  lineJoin: 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round'
  miterLimit: number
  pathLength?: number
  paintOrder?: string
  nonScaling: boolean
}

export interface ConnectorLabelDescriptor {
  id?: string
  text: string
  anchor?: ScenePoint
  bounds?: SceneBox
  halo?: { color?: string; width: number }
  clearance?: number
}

export interface ConnectorHitGeometry {
  geometry: ConnectorGeometry
  strokeWidth: number
  pointerEvents: 'stroke' | 'none'
}

export type ConnectorTerminalStrokeLoss =
  | 'continuous-geometry'
  | 'bend-radius'
  | 'stroke-width'
  | 'stroke-opacity'
  | 'stroke-cap'
  | 'stroke-join'
  | 'stroke-miter'
  | 'dash-pattern'
  | 'dash-offset'
  | 'path-length'
  | 'paint-order'
  | 'non-scaling-stroke'

export interface ConnectorTerminalMarkerProjection {
  readonly id: string
  readonly shape: MarkerShape
}

export interface ConnectorTerminalLabelProjection {
  readonly id?: string
  readonly text: string
}

export interface ConnectorTerminalProjection {
  realization: PrimitiveRealization
  topology: 'line' | 'polyline' | 'path'
  direction: ConnectorDirection
  relationship: string
  markers: {
    start?: ConnectorTerminalMarkerProjection
    mid: readonly ConnectorTerminalMarkerProjection[]
    end?: ConnectorTerminalMarkerProjection
  }
  labels: readonly ConnectorTerminalLabelProjection[]
  lineStyle: ConnectorMark['lineStyle']
  strokeLosses: readonly ConnectorTerminalStrokeLoss[]
  diagnostics: readonly string[]
}

export interface ConnectorMark extends SceneNodeBase {
  kind: 'connector'
  /** Compatibility geometry; identical by reference to route.geometry. */
  geometry: ConnectorGeometry
  lineStyle: 'solid' | 'dotted' | 'dashed' | 'thick' | 'invisible'
  /** Compatibility paint; connector backends consume `stroke`, not crisp. */
  paint: MarkPaint
  startMarker?: MarkerRef
  endMarker?: MarkerRef
  endpoints: ConnectorEndpoints
  relationship: ConnectorRelationship
  route: ConnectorRoute
  stroke: ConnectorStroke
  markers: {
    start?: MarkerDescriptor
    mid: readonly MarkerDescriptor[]
    end?: MarkerDescriptor
  }
  labels: readonly ConnectorLabelDescriptor[]
  hit: ConnectorHitGeometry
  terminalProjection: ConnectorTerminalProjection
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
export interface DocumentMark extends SceneNodeBase {
  kind: 'document'
  element: 'title' | 'description' | 'definitions' | 'close'
  text?: string
  domId?: string
  /** Typed marker resources owned by the definitions mark. Backends may
   * reserialize these without inspecting the crisp SVG definition string. */
  markerResources?: readonly MarkerDescriptor[]
}

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

export type SceneNode = ShapeMark | ConnectorMark | TextMark | GroupMark | RawMark | DocumentMark | PreludeMark

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
