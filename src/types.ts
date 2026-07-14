import type { MermaidRuntimeConfig } from './mermaid-source.ts'
import type { DiagramColors } from './theme.ts'
import type { ArchitectureVisualOverrides } from './architecture/config.ts'
import type { InternalStyleFace, StyleInput } from './scene/style-registry.ts'

// ============================================================================
// Parsed graph — logical structure extracted from Mermaid text
// ============================================================================

export interface MermaidGraph {
  direction: Direction
  nodes: Map<string, MermaidNode>
  edges: MermaidEdge[]
  subgraphs: MermaidSubgraph[]
  classDefs: Map<string, Record<string, string>>
  /** Maps node IDs to their class names (from `class X className` or `:::className` shorthand) */
  classAssignments: Map<string, string>
  /** Maps node IDs to inline styles (from `style X fill:#f00,stroke:#333`) */
  nodeStyles: Map<string, Record<string, string>>
  /** Maps edge indices (or 'default') to inline styles from `linkStyle` directives */
  linkStyles: Map<number | 'default', Record<string, string>>
  /** State diagrams only: `note left|right of X` annotations, in source order.
   *  Placed by a post-layout pass (layout-engine placeStateNotes); flowcharts
   *  never populate this. */
  stateNotes?: StateNoteSpec[]
}

/** A state-diagram note (`note left of X : text` / block form). ONE grammar
 *  models these for the render parser and the agent body alike —
 *  src/state/parse-core.ts (plan §State 1, repo #118). */
export interface StateNoteSpec {
  /** Stable id (`note#<i>` in source order). */
  id: string
  /** The state (or composite) the note is anchored to. */
  target: string
  /** Declared side — the placement invariant is that the note box sits on
   *  this side of its target's box (upstream's own placement bug: #3782). */
  side: 'left' | 'right'
  /** Note text; block-note body lines are joined with '\n'. */
  text: string
}

export type Direction = 'TD' | 'TB' | 'LR' | 'BT' | 'RL'

export interface MermaidNode {
  id: string
  label: string
  shape: NodeShape
  /** Mermaid v11 `@{ shape: ... }` semantic shape, normalized to the canonical
   *  short name (e.g. 'sl-rect' for `manual-input`). Set only for
   *  metadata-declared nodes; `shape` stays the rendering geometry
   *  (src/flowchart-shapes.ts is the one mapping table). */
  semanticShape?: string
  /** The authored v11 shape spelling (alias preserved verbatim, e.g.
   *  'manual-input') — the serializer re-emits exactly this. */
  authoredShape?: string
  /** True when the label came from a Mermaid markdown string. */
  markdownLabel?: true
  /** Safe local icon token from v11 node metadata. */
  icon?: string
  /** Authored image URL retained as inert data; the renderer never fetches it. */
  image?: string
  iconForm?: 'square' | 'circle' | 'rounded'
  /** Safe inert interaction metadata; callbacks and unsafe schemes never enter SVG. */
  href?: string
}

export type NodeShape =
  | 'rectangle'
  | 'service'
  | 'rounded'
  | 'diamond'
  | 'stadium'
  | 'circle'
  // Batch 1 additions
  | 'subroutine'     // [[text]]  — double-bordered rectangle
  | 'doublecircle'   // (((text))) — concentric circles
  | 'hexagon'        // {{text}}  — six-sided polygon
  // Batch 2 additions
  | 'cylinder'       // [(text)]  — database cylinder
  | 'asymmetric'     // >text]    — flag/banner shape
  | 'trapezoid'      // [/text\]  — wider bottom
  | 'trapezoid-alt'  // [\text/]  — wider top
  // Parallelograms (Mermaid lean_right / lean_left — the flowchart I/O symbol)
  | 'lean-r'         // [/text/]  — leans right
  | 'lean-l'         // [\text\]  — leans left
  // Batch 3 state diagram pseudostates
  | 'state-start'    // filled circle (start pseudostate)
  | 'state-end'      // bullseye circle (end pseudostate)
  // Batch 4 state pseudostates (plan §State 2; upstream #2514 / PR #5700).
  // State-parser-only: the flowchart grammar and op menu never produce these.
  | 'state-fork'     // <<fork>> — filled bar perpendicular to the flow
  | 'state-join'     // <<join>> — filled bar (same geometry as fork)
  | 'state-choice'   // <<choice>> — small unlabeled diamond
  | 'state-history'  // [H] / <<history>> — circle containing H (H* when deep)

export interface MermaidEdge {
  source: string
  target: string
  /** Authored Mermaid v11.6 edge ID (`e1@-->`): stable edge identity.
   *  Round-trips verbatim, emitted as the SVG edge's data-id, and accepted
   *  by remove_edge/set_label as a target selector. */
  id?: string
  label?: string
  style: EdgeStyle
  /** Whether to render a marker at the start (source end) of the edge */
  hasArrowStart: boolean
  /** Whether to render a marker at the end (target end) of the edge */
  hasArrowEnd: boolean
  /** Marker shape at start when hasArrowStart=true. Defaults to 'arrow' if undefined. */
  startMarker?: EdgeMarker
  /** Marker shape at end when hasArrowEnd=true. Defaults to 'arrow' if undefined. */
  endMarker?: EdgeMarker
  /** Authored v11 edge presentation metadata. */
  curve?: string
  animate?: boolean
  animation?: 'fast' | 'slow'
  /** Mermaid link length (rank-distance intent): 1 = base operator, 2 = one
   *  extra shaft unit (`--->`, `-..->`, `====>`, `~~~~`), etc. Undefined ≡ 1,
   *  so base-form edges serialize byte-identically. Preserved through
   *  round-trip; layout honors this conservatively for simple primary-forward
   *  no-subgraph DAGs and leaves grouped/cyclic cases to ELK. */
  length?: number
}

/** 'invisible' is Mermaid's `~~~` link: it participates in layout ordering
 *  but draws no stroke. */
export type EdgeStyle = 'solid' | 'dotted' | 'thick' | 'invisible'
export type EdgeMarker = 'arrow' | 'circle' | 'cross'

export interface MermaidSubgraph {
  id: string
  label: string
  nodeIds: string[]
  children: MermaidSubgraph[]
  /** Optional direction override for this subgraph's internal layout */
  direction?: Direction
  /** State diagrams only: this subgraph is one concurrency region of its
   *  parent composite (`--` separators, plan §State 2c). Regions draw no box
   *  of their own; the renderer draws dashed separators between siblings. */
  concurrencyRegion?: true
}

// ============================================================================
// Positioned graph — after ELK layout, ready for SVG rendering
// ============================================================================

export interface PositionedDiagram {
  width: number
  height: number
}

/** Explicit request-boundary data consumed by family layout/render code. */
export interface ResolvedFamilyRenderContext {
  readonly renderOptions: Readonly<RenderOptions>
  readonly styleFace?: Readonly<InternalStyleFace>
  readonly familyConfig?: Readonly<Record<string, unknown>>
  readonly familyAppearance?: Readonly<Record<string, unknown>>
}

export interface RenderContext<TPositioned extends PositionedDiagram = PositionedDiagram> {
  positioned: TPositioned
  colors: DiagramColors
  resolved: ResolvedFamilyRenderContext
}

export interface PositionedGraph extends PositionedDiagram {
  width: number
  height: number
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  groups: PositionedGroup[]
  /** State-diagram notes with final placement (present only when the source
   *  graph carried stateNotes). Invariants enforced by construction in
   *  placeStateNotes: the box sits on the declared side of its target and
   *  overlaps no node/group box. */
  notes?: PositionedStateNote[]
}

/** A placed state-diagram note box. */
export interface PositionedStateNote {
  id: string
  target: string
  side: 'left' | 'right'
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface PositionedNode {
  id: string
  label: string
  shape: NodeShape
  /** Mermaid v11 semantic shape id when the node was declared via
   *  `@{ shape: ... }` metadata — emitted as the SVG data-semantic-shape. */
  semanticShape?: string
  x: number
  y: number
  width: number
  height: number
  /** Inline styles resolved from classDef + explicit `style` statements — override theme defaults */
  inlineStyle?: Record<string, string>
  /** User-assigned Mermaid class names (from `class X myClass` / `:::myClass`). Emitted as SVG CSS classes so external stylesheets can target them. */
  classNames?: string[]
  icon?: string
  image?: string
  iconForm?: 'square' | 'circle' | 'rounded'
  href?: string
}

export interface PositionedEdge {
  source: string
  target: string
  /** Authored Mermaid v11.6 edge ID (`e1@-->`) — SVG identity (data-id). */
  id?: string
  label?: string
  style: EdgeStyle
  hasArrowStart: boolean
  hasArrowEnd: boolean
  /** Marker shape at start when hasArrowStart=true. Defaults to 'arrow' if undefined. */
  startMarker?: EdgeMarker
  /** Marker shape at end when hasArrowEnd=true. Defaults to 'arrow' if undefined. */
  endMarker?: EdgeMarker
  /** Full path including bends — array of {x, y} points */
  points: Point[]
  /** Layout-computed label center position (avoids label-label collisions) */
  labelPosition?: Point
  /** Inline styles resolved from `linkStyle` directives — override theme defaults */
  inlineStyle?: Record<string, string>
  /** Index into MermaidGraph.edges this positioned edge was extracted from */
  edgeIndex?: number
  /** Authored edge presentation metadata. */
  curve?: string
  animate?: boolean
  animation?: 'fast' | 'slow'
  /** Route contract certificate attached by the layout pipeline (docs/design/system/route-contracts.md) */
  routeCertificate?: RouteCertificate
}

// ============================================================================
// Route contracts — semantic routing intent and per-edge certificates
// (docs/design/system/route-contracts.md)
// ============================================================================

export type RouteClass =
  | 'primary-forward' // added in author order without creating a cycle; owns the straight lane
  | 'feedback'        // would create a cycle; may straighten onto its own reverse lane, never the forward edge's lane
  | 'self-loop'
  | 'container'       // endpoint is a subgraph id
  | 'cross-hierarchy' // endpoints live in different subgraph scopes

export type LayoutRouteClass = RouteClass | 'family-layout'

/** The four canonical connection points of a shape (Visio connection-point /
 *  yFiles port-candidate model). For every Mermaid shape these lie at the
 *  bbox side midpoints: the diamond's vertices, the rectangle's side
 *  midpoints, and the boundary extremes of circles, stadiums, hexagons and
 *  cylinders are the same four points, because each shape is symmetric and
 *  inscribed in its bbox. */
export type PortSide = 'N' | 'E' | 'S' | 'W'

/** Diamond facet-midpoints: the four points halfway along each slanted edge
 *  (NE/SE/SW/NW). They lie exactly on the diamond outline and serve as
 *  designated attachment points alongside the four cardinal vertices, but are
 *  diamond-only — shapePorts() stays four-cardinal for every shape. */
export type DiamondFacet = 'NE' | 'SE' | 'SW' | 'NW'

/** A port an endpoint may sit on: a cardinal vertex/side-midpoint, or — on a
 *  diamond — a facet-midpoint. */
export type AnyPort = PortSide | DiamondFacet

export type PortSemanticRole =
  | 'flow-source'
  | 'flow-target'
  | 'feedback-source'
  | 'feedback-target'
  | 'self-loop-source'
  | 'self-loop-target'
  | 'container-source'
  | 'container-target'
  | 'cross-hierarchy-source'
  | 'cross-hierarchy-target'

/** Dynamic port allocation metadata: which side an endpoint semantically uses,
 *  its deterministic order among the endpoints on that side, and why it is
 *  there. This extends `sourcePort`/`targetPort` without changing their V1
 *  vocabulary: exact endpoint ports remain `AnyPort`, while the allocation
 *  records side-level slot/role intent for pre-layout and debugging. */
export interface RoutePortAssignment {
  side: PortSide
  /** 0-based deterministic order along the side (N/S: left→right; E/W: top→bottom). */
  slotIndex: number
  /** Number of endpoints allocated to this node side. */
  slotCount: number
  role: PortSemanticRole
  /** Exact designated port when the final endpoint landed on one. */
  port?: AnyPort
}

export interface RouteBlocker {
  kind: 'node' | 'label' | 'channel' | 'span' | 'crossing' | 'port'
  id: string
}

export type RouteInvariant =
  | 'straight'          // exactly two points, axis-aligned with the flow
  | 'explained-detour'  // bends, and directLaneBlockedBy says why
  | 'bundle'            // path owned by the fan-out/fan-in bundler
  | 'outer-feedback'    // feedback routed around the nodes through an outer channel (ELK feedbackEdges)
  | 'feedback-detour'   // feedback that neither straightened nor reached an outer channel
  | 'self-loop'
  | 'container-attach'
  | 'unverified-shape'  // endpoint shape has no straight attachment side

interface RouteCertificateBase {
  /** Index into MermaidGraph.edges */
  edgeIndex: number
  routeClass: RouteClass
  bendCount: number
  directLaneClear?: boolean
  directLaneBlockedBy?: RouteBlocker[]
  /** Set when the endpoint sits exactly on a port: a cardinal side-midpoint
   *  for every shape, or a diamond facet-midpoint (NE/SE/SW/NW). */
  sourcePort?: AnyPort
  /** Set when the endpoint sits exactly on a port: a cardinal side-midpoint
   *  for every shape, or a diamond facet-midpoint (NE/SE/SW/NW). */
  targetPort?: AnyPort
  /** Dynamic side/slot/role allocation for the source endpoint. */
  sourcePortAssignment?: RoutePortAssignment
  /** Dynamic side/slot/role allocation for the target endpoint. */
  targetPortAssignment?: RoutePortAssignment
  /** Self-loop routes only: the node side the loop departs from and returns
   *  to. Part of the self-loop certificate vocabulary (plan §State 6) — the
   *  arc leaves and re-enters this side at distinct boundary points. */
  loopSide?: PortSide
}

export type StraightRouteCertificate = RouteCertificateBase & {
  invariant: 'straight'
  /** True when the certifying straightener collapsed this route */
  straightened?: true
}

export type NonStraightRouteCertificate = RouteCertificateBase & {
  invariant: Exclude<RouteInvariant, 'straight'>
  /** Non-straight certificates cannot claim a straightening happened. */
  straightened?: never
}

export type RouteCertificate = StraightRouteCertificate | NonStraightRouteCertificate

export type FamilyEdgeRouteCertificate =
  | {
    family: 'class' | 'er'
    edgeIndex: number
    routeClass: 'family-layout'
    invariant: 'orthogonal-box' | 'unverified-family-route'
    bendCount: number
    orthogonal: boolean
    sourceBoundary: boolean
    targetBoundary: boolean
  }
  | {
    family: 'architecture'
    edgeIndex: number
    routeClass: 'family-layout'
    invariant: 'side-anchored' | 'unverified-family-route'
    bendCount: number
    orthogonal: boolean
    sourceSide: 'L' | 'R' | 'T' | 'B'
    targetSide: 'L' | 'R' | 'T' | 'B'
    sourceBoundary: 'item' | 'group'
    targetBoundary: 'item' | 'group'
    sourceAnchored: boolean
    targetAnchored: boolean
    /** Authored endpoint half-plane constraints after deterministic placement. */
    placement: 'satisfied' | 'conflicted'
    sourceFacesTarget: boolean
    targetFacesSource: boolean
    /** Every route segment clears non-incident service, junction, and group interiors. */
    obstacleFree: boolean
  }
  | {
    family: 'sequence'
    edgeIndex: number
    routeClass: 'family-layout'
    invariant: 'lifeline-message' | 'self-message' | 'unverified-family-route'
    bendCount: number
    horizontal: boolean
    sourceLifeline: boolean
    targetLifeline: boolean
    selfMessage: boolean
  }

export type RegionContainmentCertificate = {
  family: 'timeline' | 'xychart' | 'pie' | 'quadrant' | 'gantt'
  elementId: string
  routeClass: 'family-layout'
  invariant: 'timeline-interval' | 'plot-contained' | 'legend-contained' | 'section-contained' | 'unverified-family-layout'
  /** Node/mark box in layout coordinates; included so cert consumers do not have to join back to nodes. */
  bounds: { x: number; y: number; w: number; h: number }
  /** Center point used by plot/region-mark containment certs. */
  center: { x: number; y: number }
  /** Whether the cert proves the full box or the semantic mark center is contained. */
  containment: 'bounds' | 'center'
  withinBounds: boolean
  groupId?: string
  withinGroup?: boolean
}

export type EdgeRouteCertificate = RouteCertificate | FamilyEdgeRouteCertificate
export type FamilyRouteCertificate = FamilyEdgeRouteCertificate | RegionContainmentCertificate
export type LayoutRouteCertificate = EdgeRouteCertificate | RegionContainmentCertificate

export interface Point {
  x: number
  y: number
}

export interface PositionedGroup {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  children: PositionedGroup[]
  /** State diagrams only: this group is a concurrency region (drawn as dashed
   *  separators between siblings instead of its own box). */
  concurrencyRegion?: true
}

// ============================================================================
// Render options — user-facing configuration
//
// Color theming uses CSS custom properties: --bg and --fg are required,
// optional enrichment variables (--line, --accent, --muted, --surface,
// --border) add richer color from Shiki themes or custom palettes.
// See src/theme.ts for the full variable system.
// ============================================================================

export type TextTransform = 'uppercase' | 'lowercase' | 'capitalize'

/** A deterministic warning for accepted configuration that cannot affect output. */
export interface ConfigDiagnostic {
  code: 'INEFFECTIVE_CONFIG'
  /** Fully-qualified config path, for example `state.titleTopMargin`. */
  field: string
  message: string
}

export interface RenderOptions {
  /** Background color → CSS variable --bg. Default: '#FFFFFF' */
  bg?: string
  /** Foreground / primary text color → CSS variable --fg. Default: '#27272A' */
  fg?: string

  // -- Optional enrichment colors (fall back to color-mix from bg/fg) --

  /** Edge/connector color → CSS variable --line */
  line?: string
  /** Arrow heads, highlights → CSS variable --accent */
  accent?: string
  /** Secondary text, edge labels → CSS variable --muted */
  muted?: string
  /** Node/box fill tint → CSS variable --surface */
  surface?: string
  /** Node/group stroke color → CSS variable --border */
  border?: string

  /** Font family for all text. Default: 'Inter' */
  font?: string

  /**
   * How the diagram looks: a registered style name ('hand-drawn',
   * 'look:tufte', 'palette:tufte', or any THEMES palette name like 'dracula'),
   * an inline StyleSpec, or a STACK
   * of either merged left-to-right ({ style: ['hand-drawn', 'dracula'] } is
   * hand-drawn geometry with the dracula palette). A colors-only style is a
   * palette.
   * Precedence: defaults < style stack < themeVariables < explicit color
   * options. Unknown names throw. Unset (or 'crisp') = the default renderer,
   * byte-identical to previous releases.
   */
  style?: StyleInput | StyleInput[]

  /** Canvas padding in px. Default: 40 */
  padding?: number
  /** Horizontal spacing between sibling nodes. Default: 24 */
  nodeSpacing?: number
  /** Vertical spacing between layers. Default: 40 */
  layerSpacing?: number
  /**
   * Flowchart-only: measured-pixel auto-wrap budget for node labels (mermaid's
   * `flowchart.wrappingWidth`). Unset = no wrapping for regular labels;
   * markdown-string labels always wrap at the upstream default of 200.
   * Explicit option wins over frontmatter config. Other families ignore it.
   */
  wrappingWidth?: number
  /** Spacing between disconnected components. Default: nodeSpacing (24) */
  componentSpacing?: number
  /** Render with transparent background (no background style on SVG). Default: false */
  transparent?: boolean
  /** Enable hover tooltips on chart data points (xychart, quadrant, and pie). Default: false */
  interactive?: boolean
  /** Optional explicit drop shadows on node shapes. Default: false */
  shadow?: boolean
  /** Family-specific class-diagram options. */
  class?: {
    /** Nest namespace compounds (default true); false lays them out compactly as siblings. */
    hierarchicalNamespaces?: boolean
  }
  /** Family-specific SVG renderer options for architecture-beta diagrams. */
  architecture?: {
    visual?: ArchitectureVisualOverrides
  }
  /** Family-specific layout options for timeline diagrams. */
  timeline?: {
    /**
     * Best-effort width budget (px) for HORIZONTAL timelines: when the chart
     * would exceed it, the per-column wrap caps compress proportionally so
     * labels wrap tighter instead of the canvas growing (13 periods stop
     * rendering 2,400+px wide). No-op when the chart already fits — the
     * default layout stays byte-identical — and ignored in `timeline TD`
     * mode (vertical timelines are inherently narrow). Unbreakable tokens
     * and extra-wide section headers can still exceed the budget.
     */
    maxWidth?: number
  }
  /** Family-specific SVG renderer options for user-journey diagrams. */
  journey?: {
    /**
     * Draw the experience-curve line connecting score markers in task order.
     * Default: `true`. Set `false` for the marker-only Mermaid-classic look.
     */
    experienceCurve?: boolean
  }
  /** Family-specific SVG renderer options for gantt diagrams. */
  gantt?: {
    /**
     * Draw dependency connectors — deterministic elbow arrows from each
     * predecessor bar's end to its successor bar's start — for every
     * `after`/`until` reference. No new Mermaid syntax: the edges come from
     * the scheduler's dependency graph. Default: `false` (output without it
     * is byte-identical to previous releases).
     */
    dependencyArrows?: boolean
    /**
     * Emphasize the critical path from the scheduler's analysis
     * (GanttScheduleAnalysis.criticalPathTaskIds): stronger stroke on
     * critical-path bars/milestones and, when `dependencyArrows` is also on,
     * on the connectors along the path. Default: `false`.
     */
    criticalPath?: boolean
  }
  /** Optional Mermaid-style runtime config (analogous to initialize/frontmatter config). */
  mermaidConfig?: MermaidRuntimeConfig
  /**
   * Receives warnings for explicit config that cannot affect output. Installing
   * a collector never changes SVG bytes. Without one, explicit ineffective
   * config is reported through `console.warn` rather than accepted silently.
   */
  onConfigDiagnostic?: (diagnostic: ConfigDiagnostic) => void
  /**
   * Whether to embed the Google Fonts `@import` line in the SVG `<style>` block.
   * Default: `true` (preserves wire compatibility with all existing consumers).
   *
   * CLI / PNG paths set `false` explicitly to render offline / CSP-friendly.
   * The CSS variable `--font` is always emitted on the SVG root regardless,
   * so the family stays overridable post-render even when the @import is gone.
   */
  embedFontImport?: boolean

  /**
   * Compact SVG output. Default `false`. When true:
   *  - Formatting newlines between structural SVG elements are collapsed.
   *  - Geometry, authored text, accessibility content, attribute boundaries,
   *    and whitespace inside `<style>` are preserved exactly.
   *  - `data-*` and `class=` attributes are preserved (agent inspection hooks).
   *
   * Useful for the PNG render path (no need for human-readable indentation)
   * and for bandwidth-sensitive consumers without changing diagram semantics.
   */
  compact?: boolean
  /**
   * Namespace prefix for all generated SVG def ids (markers, filters) and
   * their `url(#…)` references. Default '' = current behavior (back-compat,
   * zero snapshot churn). Set a distinct prefix per diagram when rendering
   * multiple diagrams onto one HTML page so their `<defs>` don't collide
   * (e.g. two `arrowhead` markers — the browser dedupes by id and the second
   * diagram's arrows break). `am batch` auto-assigns per-line prefixes.
   * Must be deterministic per call site to preserve render determinism.
   */
  idPrefix?: string

  /**
   * Security posture for the rendered output. Default `'default'`.
   * `'strict'` (agent / untrusted-diagram mode): guarantees no external-fetch
   * references in the SVG — forces `embedFontImport` off (no Google Fonts
   * `@import`), so the SVG renders with no network calls. The `--font` CSS
   * variable still declares the family. Use `verifyNoExternalRefs(svg)` to
   * assert the guarantee. Agent/untrusted SVG callers should opt into strict
   * mode explicitly. See SECURITY.md.
   */
  security?: 'default' | 'strict'

  /**
   * Explicit "today" for the Gantt `todayMarker` (a date in the diagram's
   * `dateFormat`, or ISO `YYYY-MM-DD`). Gantt rendering never reads the wall
   * clock; without this value the today marker is simply not drawn, and
   * `todayMarker off` disables it even when a clock is supplied.
   */
  ganttToday?: string

  /**
   * Deterministic re-roll seed for stochastic styles.
   * The same source + options + seed always produces identical bytes; it
   * re-rolls ink wobble only — layout never moves. The crisp path ignores
   * it. Default 0.
   */
  seed?: number
}
