// ============================================================================
// SceneGraph IR — semantic drawing parts after layout (SPEC §3.1).
//
// Family renderers lower their positioned results to a SceneDoc instead of
// exposing SVG strings as Scene authority. Each part carries semantic fields
// (role, geometry, paints, channels, stable id) consumed by graphical
// backends. Backend-private serialization is a canonical projection rather
// than a replay of construction-time SVG byte order.
//
// Determinism: constructing a SceneDoc is pure — no RNG, no clock. Stochastic
// styling happens inside styled backends, seeded per §8's substream contract
// (see seed.ts).
// ============================================================================

import type { DiagramColors } from '../theme.ts'
import type { SvgSemanticIdentity } from './identity.ts'
import type { SvgSemanticAccessibility } from './accessibility.ts'
import type { PrimitiveRealization } from './capabilities.ts'
import type { LabelDisplay } from '../multiline-utils.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { DisplayRun, LabelContent } from '../shared/display-text.ts'

/** Version of the extension-facing Scene document/part behavioral contract. */
export { SCENE_CONTRACT_VERSION } from './version.ts'
import type { SceneRole } from './roles.ts'

export type {
  BuiltinSceneRole, CoreSceneRole, NamespacedSceneRole, SceneRole,
  SceneRoleTraits, SceneRoleStyleFallback, SceneSketchPolicy,
} from './roles.ts'

/** One canonical closed channel vocabulary shared by Scene types, family
 * descriptors, binding admission, generated census, and terminal projection. */
export const SEMANTIC_CHANNEL_NAMES = Object.freeze([
  'importance', 'value', 'category', 'status', 'progress', 'route', 'emphasis',
] as const)
export type SemanticChannelName = typeof SEMANTIC_CHANNEL_NAMES[number]

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
 *  inlineResolvedColors, exactly like the default backend. */
export type Geometry =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number; ry?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polygon'; points: Array<{ x: number; y: number }> }
  | { kind: 'polyline'; points: Array<{ x: number; y: number }> }
  | { kind: 'path'; d: string }
  | { kind: 'compound'; children: Geometry[] }

/** The resolved paint attached to a part — already cascaded (theme tokens,
 *  classDef, inline style, role defaults) by the family lowering. Internal
 *  scenes may reference a declared typed gradient through `url(#safe-id)`;
 *  arbitrary/external fetching paints remain forbidden. */
export interface MarkPaint {
  fill?: string
  fillOpacity?: string
  stroke?: string
  strokeOpacity?: string
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

export type SceneTransform =
  | { kind: 'rotate'; angle: number; cx: number; cy: number }
  /** SVG affine matrix: x' = a*x + c*y + e, y' = b*x + d*y + f. */
  | { kind: 'matrix'; a: number; b: number; c: number; d: number; e: number; f: number }

/** Semantic subject whose artwork this part contributes. This is an authored
 * identity or an explicit family identity, never a guessed id-prefix parent. */
export interface SceneOwner {
  id: string
  role: SceneRole
}

/** Inert attributes a family adds to a part's SVG element: CSS hook classes
 *  and `data-*` inspection metadata. The SVG writer emits them beside the
 *  attributes it derives from the typed fields; none of them can change what
 *  the part draws, so they are outside paint certification. */
export interface MarkAttributes {
  /** Space-separated CSS class tokens (`[A-Za-z0-9_-]`). */
  className?: string
  /** Emitted as `data-<key>`, in insertion order. Identity, relationship and
   *  marker keys belong to typed fields instead. */
  data?: Readonly<Record<string, string>>
  /** Emitted as `aria-hidden="true"` on artwork with no accessible meaning. */
  ariaHidden?: true
  /** Emitted as `tabindex="0"` on a part that carries a followable link. */
  tabIndex?: 0
  /** Emitted as `aria-label` when the drawn text abbreviates or wraps the
   *  authored name. Relation parts take theirs from typed accessibility. */
  ariaLabel?: string
}

export interface SceneNodeBase {
  /** Stable identifier for seeding and cross-references. Derived from source
   *  semantics (node id, edge endpoints, slice label...), never list position
   *  (§8 seed contract). */
  id: string
  role: SceneRole
  /** Typed DOM identity mirrored as data-id/data-role on rendered SVG elements.
   * An owned shape may omit it only inside its matching semantic group. */
  identity?: SvgSemanticIdentity
  /** Explicit subject, or the nearest enclosing semantic group's identity. */
  owner?: SceneOwner
  /** Artwork shown only in an interactive state, such as a tooltip. */
  visibility?: 'conditional'
  /** Typed accessibility semantics mirrored into ARIA on relation parts. */
  accessibility?: SvgSemanticAccessibility
  channels?: SemanticChannels
  /** Semantic geometry transform applied by every backend. */
  transform?: SceneTransform
  /** Inert SVG hooks; see MarkAttributes. */
  attributes?: MarkAttributes
}

export interface ShapeMark extends SceneNodeBase {
  kind: 'shape'
  geometry: Geometry
  paint: MarkPaint
  /** Paint of each child of compound geometry, in order, when the pieces of
   *  one outline differ (a cylinder's body and caps). Defaults to `paint`. */
  childPaints?: readonly MarkPaint[]
  /** Alternate ink admitted for a declared interactive state. */
  conditionalPaint?: MarkPaint
  /** Internal fill-only piece of an outlined surface. Sketch fill policies still
   * apply to its default surface color after the outline is separated. */
  surfaceFragment?: boolean
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

/** A safe same-document SVG linear gradient. Parts reference this paint through
 * `url(#id)`; the descriptor, not raw `<defs>` markup, remains the resource
 * authority for validation and backend serialization. */
export interface LinearGradientDescriptor {
  id: string
  units: 'userSpaceOnUse' | 'objectBoundingBox'
  x1: number
  y1: number
  x2: number
  y2: number
  stops: readonly {
    offset: number
    color: string
    opacity?: number
  }[]
}

/** One continuous path contour. `closed` is semantic topology: callers must
 * not infer it from a repeated endpoint or reparse SVG `d`. */
export interface ConnectorSubpath {
  points: Array<ScenePoint>
  closed: boolean
}

export type ConnectorGeometry =
  | { kind: 'polyline'; points: Array<ScenePoint> }
  /** Curved path plus its deterministic routed polyline projection. Requiring
   * points keeps bounds, hit-testing, tangents and terminal projection total
   * without asking consumers to reparse SVG path data. Multiple SVG subpaths
   * require explicit contour boundaries so backends never draw across `M`. */
  | {
      kind: 'path'
      d: string
      points: Array<ScenePoint>
      subpaths?: Array<ConnectorSubpath>
      /** Exact SVG marker-mid vertices in document order. Routed points may
       * include curve controls or sampling points, so they are never treated
       * as marker vertices for path geometry. */
      markerMidpoints?: Array<ScenePoint>
    }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }

export type ConnectorDirection = 'forward' | 'reverse' | 'bidirectional' | 'undirected' | 'self'

export interface ConnectorEndpointAnchor {
  /** Semantic node/entity identifier. */
  id?: string
  /** Typed endpoint subject when authored IDs occur in more than one role. */
  owner?: SceneOwner
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
  /** Per-contour endpoint semantics. Multi-subpath connectors must not
   * collapse marker anchors or tangents into one overall start/end pair. */
  contours: readonly ConnectorContourSemantics[]
  startTangent?: ScenePoint
  endTangent?: ScenePoint
  labelAnchors: readonly ScenePoint[]
}

export interface ConnectorContourSemantics {
  start: ScenePoint
  end: ScenePoint
  closed: boolean
  startTangent?: ScenePoint
  endTangent?: ScenePoint
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
  mixBlendMode?: 'normal' | 'multiply'
  nonScaling: boolean
  /** The width is the data (a sankey flow's quantity), so every backend draws
   * it exactly as given and never scales it by a look's pen width. */
  encodesValue?: boolean
}

export interface ConnectorLabelDescriptor {
  id?: string
  text: string
  textContent?: LabelContent
  anchor?: ScenePoint
  bounds?: SceneBox
  halo?: { color?: string; width: number }
  clearance?: number
  /** Resolved visual styling when the connector owns its label artwork. */
  paint?: MarkPaint
  fontSize?: number
  /** Internal typography. External Scene v1 retains its fixed literal policy. */
  fontWeight?: number
  letterSpacing?: number
  display?: LabelDisplay
  block?: PixelTextBlock
  textAnchor?: 'start' | 'middle' | 'end'
  /** `inline` is serialized by the connector constructor; `companion`
   * records the separately emitted TextMark that owns the artwork. */
  visual?: { kind: 'inline' } | { kind: 'companion'; markId: string }
}

export interface ConnectorHitGeometry {
  geometry: ConnectorGeometry
  /** Closes the single contour when geometry has no subpaths. */
  closed: boolean
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
  | 'gradient-paint'
  | 'mix-blend-mode'
  | 'non-scaling-stroke'

export type ConnectorTerminalMarkerProjection = Readonly<MarkerDescriptor>

export interface ConnectorTerminalMarkerPlacement {
  readonly markerId: string
  readonly point: ScenePoint
  readonly contourIndex: number
}

export interface ConnectorTerminalLabelProjection {
  readonly id?: string
  readonly text: string
  readonly textContent?: LabelContent
  readonly anchor?: ScenePoint
  readonly bounds?: SceneBox
  readonly halo?: { readonly color?: string; readonly width: number }
  readonly clearance?: number
  readonly paint?: MarkPaint
  readonly fontSize?: number
  readonly textAnchor?: 'start' | 'middle' | 'end'
  readonly visual?: { readonly kind: 'inline' } | { readonly kind: 'companion'; readonly markId: string }
}

export interface ConnectorTerminalProjection {
  realization: PrimitiveRealization
  topology: 'line' | 'polyline' | 'path'
  geometry: ConnectorGeometry
  direction: ConnectorDirection
  relationship: string
  markers: {
    start?: ConnectorTerminalMarkerProjection
    mid: readonly ConnectorTerminalMarkerProjection[]
    end?: ConnectorTerminalMarkerProjection
  }
  /** Actual SVG attachment sites. Start/end repeat for every subpath. */
  markerPlacements: {
    start: readonly ConnectorTerminalMarkerPlacement[]
    mid: readonly ConnectorTerminalMarkerPlacement[]
    end: readonly ConnectorTerminalMarkerPlacement[]
  }
  endpoints: ConnectorEndpoints
  route: Omit<ConnectorRoute, 'geometry'>
  stroke: ConnectorStroke
  hit: ConnectorHitGeometry
  transform?: SceneTransform
  labels: readonly ConnectorTerminalLabelProjection[]
  lineStyle: ConnectorMark['lineStyle']
  strokeLosses: readonly ConnectorTerminalStrokeLoss[]
  diagnostics: readonly string[]
}

export interface ConnectorMark extends SceneNodeBase {
  kind: 'connector'
  lineStyle: 'solid' | 'dotted' | 'dashed' | 'thick' | 'invisible'
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
  fontWeight?: number
  letterSpacing?: number
  display?: LabelDisplay
  prepared?: boolean
  /** Fitted runs retained for text fidelity and existing consumers. */
  preparedLines?: readonly (readonly DisplayRun[])[]
  /** Exact family-prepared text, including source, typography and measured geometry. */
  block?: PixelTextBlock
  /** Whether layout retained the block or the constructor prepared fallback metrics. */
  measurement?: 'prepared' | 'fallback'
  /** Occupied band and placement offset retained for existing consumers. */
  textLayout?: { width: number; height: number; lineHeight: number; offsetY: number }
  anchor: 'start' | 'middle' | 'end'
  /** First baseline below `y`, in ems; the writer emits it as `dy`. */
  baselineShift?: number
  dominantBaseline?: 'middle' | 'central' | 'hanging'
  fontStyle?: 'italic'
  textDecoration?: 'underline' | 'line-through' | 'underline line-through'
  /** One-line text drawn as differently painted runs (syntax highlighting).
   *  Their concatenation is the displayed line. */
  spans?: readonly { text: string; fill: string }[]
  paint: MarkPaint
  /** Ink the family chose for this text on the page, when `paint.fill` was
   *  instead chosen against the data part the text sits on (a value label
   *  inside a bar). A backend that puts the glyphs back on the page, as the
   *  sketch looks do with their page-colored halo over hatched or washed
   *  fills, paints this ink so the label stays readable. */
  pageFill?: string
}

/** A semantic wrapper (<g ...>...</g>) whose children are Scene parts (SceneNode).
 *  Serialization is reconstructed from open/close/children + per-child indent,
 *  so styled backends can restyle children while keeping wrapper semantics
 *  (classes, data-* attributes, ARIA). */
export interface GroupMark extends SceneNodeBase {
  kind: 'group'
  /** Paint the wrapper cascades to its children: its opacity composites the
   *  whole group, its fill applies to children that set none. The open tag
   *  carries it; nothing else in `open` may paint. */
  paint?: Pick<MarkPaint, 'opacity' | 'fill'>
  open: string
  close: string
  children: Array<{ node: SceneNode; indent: number }>
  /** Joiner between open/children/close segments; '\n' everywhere today. */
  join: string
}

/** One typed element in the ordered SVG document shell. */
export interface DocumentMark extends SceneNodeBase {
  kind: 'document'
  element: 'open' | 'title' | 'description' | 'definitions' | 'content' | 'close'
  text?: string
  domId?: string
  /** Closed non-paint purpose, validated against the actual document elements.
   * Hidden or conditional artwork is not metadata. */
  nonPaint?: 'accessibility' | 'stylesheet' | 'interaction-metadata'
  /** Typed marker resources owned by the definitions part. Backends may
   * reserialize these without inspecting the private SVG definition string. */
  markerResources?: readonly MarkerDescriptor[]
  /** Typed, fragment-local paint resources. External URLs remain forbidden. */
  gradientResources?: readonly LinearGradientDescriptor[]
}

/** A Scene part. Existing *Mark names describe drawing parts, not source nodes. */
export type SceneNode = ShapeMark | ConnectorMark | TextMark | GroupMark | DocumentMark

/** The lowered document: an ordered flat list of top-level Scene parts. */
export interface SceneDoc {
  family: string
  width: number
  height: number
  colors: DiagramColors
  transparent: boolean
  parts: SceneNode[]
}
