// Structured bodies for the modeled Mermaid families. Runtime operations and verification live separately.
import type { LabelContent } from '../shared/display-text.ts'
import type { GitGraphDiagram } from '../gitgraph/types.ts'
import type { MindmapNode } from '../mindmap/types.ts'
import type { Direction } from '../types.ts'

// ---- Sequence body --------------------------------------------------------

export type SequenceParticipantKind = 'participant' | 'actor' | 'boundary' | 'control' | 'entity' | 'database' | 'collections' | 'queue'

export interface SequenceParticipant {
  wrap?: boolean
  id: string
  label: string
  labelContent?: LabelContent
  kind: SequenceParticipantKind
  /** Declaration keyword remains distinct from the visual metadata type. */
  declaration?: 'participant' | 'actor'
  /** Sanitized inert actor-menu links. */
  links?: Record<string, string>
}

/** One name per Mermaid whole-head arrow, solid then dashed. A half-arrow
 * keeps its exact operator in `arrow` and only its shaft here (sync/reply). */
export type SequenceMessageStyle =
  | 'sync' // ->>
  | 'reply' // -->>
  | 'line' // -> (no head)
  | 'line-dashed' // -->
  | 'async' // -) (open head)
  | 'async-dashed' // --)
  | 'lost' // -x
  | 'lost-dashed' // --x
  | 'bidirectional' // <<->>
  | 'bidirectional-dashed' // <<-->>

export type SequenceMessageArrow =
  | '<<->>'
  | '<<-->>'
  | '->>'
  | '-->>'
  | '->'
  | '-->'
  | '-x'
  | '--x'
  | '-)'
  | '--)'
  | '-|\\'
  | '--|\\'
  | '-|/'
  | '--|/'
  | '-\\\\'
  | '--\\\\'
  | '-//'
  | '--//'
  | '/|-'
  | '/|--'
  | '\\|-'
  | '\\|--'
  | '//-'
  | '//--'
  | '\\\\-'
  | '\\\\--'
  | '-|'
  | '--|'
  | '-/'
  | '--/'
  | '-\\'
  | '--\\'
  | '|-'
  | '|--'
  | '/-'
  | '/--'
  | '\\-'
  | '\\--'

export interface SequenceMessage {
  /** Authored wrap control; absent inherits the diagram configuration. */
  wrap?: boolean
  from: string
  to: string
  text: string
  textContent?: LabelContent
  style: SequenceMessageStyle
  /** Exact official operator as read. Written while it has this `style`;
   * otherwise `style`'s own arrow is written. */
  arrow?: SequenceMessageArrow
  centralStart?: boolean
  centralEnd?: boolean
  activate?: boolean
  deactivate?: boolean
}

export type SequenceFragmentKind = 'alt' | 'opt' | 'loop' | 'par' | 'par_over'
export interface SequenceFragmentBranch {
  wrap?: boolean
  /** `else` / `and` caption. The first branch normally omits it. */
  label?: string
  labelContent?: LabelContent
  messages: SequenceMessage[]
}
export interface SequenceFragment {
  wrap?: boolean
  fragmentKind: SequenceFragmentKind
  label?: string
  labelContent?: LabelContent
  branches: SequenceFragmentBranch[]
  /** Authored spelling retained until a typed fragment op changes the fragment. */
  rawLines?: string[]
}

// Ordered statement list. Refs index into the top-level arrays. The four
// common control fragments are typed so their messages participate in
// describe/facts/verify and can be authored through mutation ops. Constructs
// outside that closed model (notes, critical/break/rect/box, activations…)
// remain lossless opaque segments.
export type SequenceStatement =
  | { kind: 'participant'; ref: number } // index into participants
  | { kind: 'message'; ref: number } // index into messages
  | { kind: 'actor-links'; actorId: string; links: Record<string, string> }
  | { kind: 'fragment'; fragment: SequenceFragment }
  | { kind: 'opaque-block'; lines: string[] }

export interface SequenceBody {
  kind: 'sequence'
  participants: SequenceParticipant[]
  messages: SequenceMessage[]
  statements: SequenceStatement[]
}

// ---- Timeline body --------------------------------------------------------

export interface TimelineEvent {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  text: string
}

export interface TimelinePeriod {
  id: string
  /** The temporal label (e.g., "2020", "Q1 2024"). */
  label: string
  events: TimelineEvent[]
}

export interface TimelineSection {
  id: string
  /** Undefined = implicit/ungrouped section. */
  label?: string
  periods: TimelinePeriod[]
}

export interface TimelineBody {
  kind: 'timeline'
  /** Authored family source when statement spelling cannot be canonicalized safely. */
  source?: string
  /** Explicit header direction token (`timeline TD` / `timeline LR`,
   *  upstream PR #7270). Undefined = bare header (LR default). */
  direction?: 'LR' | 'TD'
  title?: string
  /** Optional accessibility title from Mermaid accTitle. */
  accessibilityTitle?: string
  /** Optional accessibility description from Mermaid accDescr (line or block form). */
  accessibilityDescription?: string
  sections: TimelineSection[]
}

// ---- Journey body ----------------------------------------------------------

export interface JourneyTask {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  text: string
  textContent?: LabelContent
  /** Satisfaction score, finite number 1..5 (Mermaid journey convention). */
  score: number
  actors: string[]
  actorContents?: Array<LabelContent | undefined>
}

export interface JourneySection {
  id: string
  /** Undefined = implicit/ungrouped section. */
  label?: string
  labelContent?: LabelContent
  tasks: JourneyTask[]
}

export interface JourneyBody {
  kind: 'journey'
  title?: string
  titleContent?: LabelContent
  /** Optional accessibility title from Mermaid accTitle. */
  accessibilityTitle?: string
  /** Optional accessibility description from Mermaid accDescr. */
  accessibilityDescription?: string
  sections: JourneySection[]
}

// ---- Class diagram body ---------------------------------------------------

export type ClassRelationKind =
  | 'inheritance' // <|--
  | 'composition' // *--
  | 'aggregation' // o--
  | 'association' // -->
  | 'dependency' // ..>
  | 'realization' // ..|>
  | 'link-solid' // --
  | 'link-dashed' // ..
  | 'lollipop' // ()-- / --()

export interface ClassNode {
  /** A source lollipop occurrence, drawn as an interface endpoint rather than a class compartment. */
  isInterface?: boolean
  /** Stable bare class identity (e.g., `Box` for authored `Box~T~`). */
  id: string
  /** Generic parameter text from Mermaid's `~...~` syntax. */
  generic?: string
  /** Optional display label (e.g., from `class X["My Label"]` or `class X as "..."`). */
  label?: string
  labelContent?: LabelContent
  /** Members, each as the raw source string ('+String name', '+eat()', '<<interface>>'). */
  members: string[]
  /**
   * Dot-joined namespace path the class is declared in (e.g. 'Platform.Auth');
   * undefined = top level. Serialization groups classes into `namespace path {}`
   * blocks the render parser accepts (repo #118).
   */
  namespace?: string
  /** Assigned classDef name (`A:::hot`, class, or cssClass). */
  className?: string
  /** Inline `style A ...` properties. */
  style?: Record<string, string>
  /** Full ordered CSS when repeated properties cannot fit the query record. */
  styleDeclarations?: import('../shared/style-props.ts').StyleDeclaration[]
  /** Sanitized inert class interaction URL. */
  href?: string
  /** Optional authored hover text for a safe inert class link. */
  tooltip?: string
}

/** A declared namespace: dot path + optional display label (`namespace X["L"]`). */
export interface ClassNamespaceDecl {
  /** Dot-joined path, e.g. 'Company.Engineering.Backend'. */
  name: string
  /** Optional display label (upstream v11.15+). */
  label?: string
  labelContent?: LabelContent
}

export interface ClassRelation {
  from: string
  to: string
  kind: ClassRelationKind
  /** Explicit shaft style; omitted values use the endpoint kinds' default. */
  lineStyle?: 'solid' | 'dashed'
  /** Optional relationship label, e.g., from `A --> B : uses`. */
  label?: string
  labelContent?: LabelContent
  /** Optional cardinality on the `from` side (e.g., '"1"'). */
  fromCardinality?: string
  fromCardinalityContent?: LabelContent
  /** Optional cardinality on the `to` side. */
  toCardinality?: string
  toCardinalityContent?: LabelContent
  /** Marker ownership for two-ended and lollipop relations. */
  markerAt?: 'from' | 'to' | 'both' | 'none'
  fromKind?: ClassRelationKind
  toKind?: ClassRelationKind
}

export interface ClassNote {
  text: string
  textContent?: LabelContent
  /** Class id the note is attached to (undefined = freestanding). */
  for?: string
}

export interface ClassBody {
  kind: 'class'
  /** Authored family source retaining unmodeled statements and their block ownership. */
  source?: string
  title?: string
  classes: ClassNode[]
  relations: ClassRelation[]
  notes: ClassNote[]
  /**
   * Declared namespaces in first-seen order (repo #118). Optional so existing
   * constructions stay valid; classes reference entries via `namespace`.
   */
  namespaces?: ClassNamespaceDecl[]
  /** Typed classDef declarations keyed by class name. */
  classDefs?: Record<string, Record<string, string>>
  classDefDeclarations?: Record<string, import('../shared/style-props.ts').StyleDeclaration[]>
}

// ---- ER body --------------------------------------------------------------

export type ErCardinality =
  | 'parent' // u, before a relationship connector
  | 'one-only' // ||
  | 'zero-or-one' // |o or o|
  | 'zero-or-many' // }o or o{
  | 'one-or-many' // }| or |{

export interface ErAttribute {
  /** The full source line (e.g., 'string name PK "comment"'). */
  text: string
}

export interface ErEntity {
  /** Stable source identity. */
  id: string
  /** Optional display label from `ID["Label"]`; identity remains `id`. */
  label?: string
  labelContent?: LabelContent
  attributes: ErAttribute[]
  className?: string
  style?: Record<string, string>
  /** The subgraph that keeps the entity: the first to close among those whose
   * own body names it (upstream 11.17's ER subgraphs; src/er/creation.ts). */
  groupId?: string
}

export interface ErGroup {
  id: string
  label: string
  labelContent?: LabelContent
  parentId?: string
  direction?: import('../types.ts').Direction
}

export interface ErRelation {
  from: string
  to: string
  leftCard: ErCardinality
  rightCard: Exclude<ErCardinality, 'parent'>
  /** Solid (--) or dashed (..) line. */
  dashed: boolean
  label?: string
  labelContent?: LabelContent
}

export type ErStatement = { kind: 'entity'; id: string } | { kind: 'relation'; ref: number } | { kind: 'direction'; groupId?: string } | { kind: 'group-open'; id: string } | { kind: 'group-close'; id: string } | { kind: 'opaque'; lines: string[] }

export interface ErBody {
  kind: 'er'
  entities: ErEntity[]
  relations: ErRelation[]
  groups?: ErGroup[]
  direction?: import('../types.ts').Direction
  classDefs?: Record<string, Record<string, string>>
  /** Ordered typed/opaque source segments; parsed bodies always populate it. */
  statements?: ErStatement[]
}

// ---- Architecture body -----------------------------------------------------

export type ArchitectureSide = 'L' | 'R' | 'T' | 'B'
export type ArchitectureEndpointBoundary = 'item' | 'group'

export interface ArchitectureGroup {
  id: string
  label: string
  icon?: string
  /** Undefined = root (not nested in another group). */
  parentId?: string
}

export interface ArchitectureService {
  id: string
  label: string
  icon?: string
  iconText?: string
  /** Undefined = ungrouped (not inside a group). */
  parentId?: string
}

export interface ArchitectureJunction {
  id: string
  parentId?: string
}

export interface ArchitectureEndpoint {
  id: string
  side: ArchitectureSide
  /** Omitted is the canonical item boundary; `group` emits `{group}`. */
  boundary?: ArchitectureEndpointBoundary
}

export interface ArchitectureEdge {
  source: ArchitectureEndpoint
  target: ArchitectureEndpoint
  label?: string
  hasArrowStart: boolean
  hasArrowEnd: boolean
}

/** `align row|column` directive (upstream v11.16.0): members share a row
 *  (same center y) or column (same center x). Members are declared
 *  services/junctions, ≥2 and unique per directive. */
export interface ArchitectureAlignment {
  axis: 'row' | 'column'
  members: string[]
}

export interface ArchitectureBody {
  kind: 'architecture'
  /** Visible heading from `title ...` (distinct from accessibility metadata). */
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
  groups: ArchitectureGroup[]
  services: ArchitectureService[]
  junctions: ArchitectureJunction[]
  edges: ArchitectureEdge[]
  /** Optional so externally-synthesized bodies stay valid; absent ≡ []. */
  alignments?: ArchitectureAlignment[]
}

// ---- XY chart body ---------------------------------------------------------

/** A single chart axis: an optional bare-text name plus EITHER categorical
 *  labels (x-axis only) OR a numeric range. All three fields are optional;
 *  a structured axis carries at least one of them. */
export interface XyChartAxis {
  /** Optional bare-text axis name/title. */
  name?: string
  /** Categorical labels (x-axis only) — mutually exclusive with range. */
  categories?: string[]
  /** Numeric range — mutually exclusive with categories. */
  range?: { min: number; max: number }
}

export interface XyChartSeries {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  kind: 'bar' | 'line'
  /** Optional bare-text series name. */
  name?: string
  /** Data values; all finite. */
  values: number[]
  /** Mermaid 11.16 line point labels, index-aligned with values. */
  pointLabels?: Array<string | undefined>
}

export interface XyChartBody {
  kind: 'xychart'
  accessibilityTitle?: string
  accessibilityDescription?: string
  title?: string
  /** Header orientation: true = explicit horizontal, false = explicit vertical,
   *  absent = no header override (runtime config decides). */
  horizontal?: boolean
  xAxis?: XyChartAxis
  yAxis?: XyChartAxis
  series: XyChartSeries[]
}

// ---- Pie body ---------------------------------------------------------------

export interface PieSlice {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  /** The slice label (contents of the `"..."` quotes). */
  label: string
  /** The slice value — a positive finite number. */
  value: number
}

export interface PieBody {
  kind: 'pie'
  accessibilityTitle?: string
  accessibilityDescription?: string
  title?: string
  /** When true (`pie showData`), the legend shows each slice's numeric value. */
  showData: boolean
  /** Slices in source order (drawn clockwise). */
  slices: PieSlice[]
}

// ---- Quadrant body ----------------------------------------------------------

/** Axis label pair. The "far" side is optional in the grammar. */
export interface QuadrantAxis {
  /** x-axis: left label / y-axis: bottom label. */
  near: string
  /** x-axis: right label / y-axis: top label. Optional. */
  far?: string
}

/** Per-point styling (upstream mermaid#5173): direct or via classDef + `:::`.
 *  Shares the grammar/validation in src/quadrant/point-style.ts. */
export interface QuadrantPointStyle {
  radius?: number
  color?: string
  strokeColor?: string
  /** May carry a px suffix (upstream form, e.g. "5px"). */
  strokeWidth?: string
  /** Unknown-but-safe `key: value` entries retained by the generous reader.
   * They never render and have no portable Mermaid spelling. */
  extra?: string[]
}

export interface QuadrantPoint {
  label: string
  /** Normalized x in [0, 1] (0 = left, 1 = right). */
  x: number
  /** Normalized y in [0, 1] (0 = bottom, 1 = top). */
  y: number
  /** Optional `:::className` class assignment. */
  className?: string
  /** Optional direct styles (win over class styles). */
  style?: QuadrantPointStyle
}

export interface QuadrantBody {
  kind: 'quadrant'
  accessibilityTitle?: string
  accessibilityDescription?: string
  title?: string
  xAxis?: QuadrantAxis
  yAxis?: QuadrantAxis
  /**
   * Quadrant region labels indexed 1..4 by Mermaid's numbering:
   *   1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
   * Stored 0-based where index `n-1` holds quadrant-`n`.
   */
  quadrants: [string?, string?, string?, string?]
  /** Plotted points in source order. */
  points: QuadrantPoint[]
  /** classDef styles by class name, in source order. Optional for synthesized
   *  payloads; parsed bodies populate it whenever classDefs are present. */
  classDefs?: Record<string, QuadrantPointStyle>
}

// ---- Radar body --------------------------------------------------------------

/** A radial axis (spoke). */
export interface RadarBodyAxis {
  /** Axis identifier (resolves keyed curve entries). */
  id: string
  /** Display label; defaults to `id` when no `["Label"]` was given. */
  label: string
}

/** A plotted curve (series). Values are in axis-declaration order. */
export interface RadarBodyCurve {
  id: string
  label: string
  /** One value per axis, in axis order. Non-negative (grammar has no sign). */
  values: number[]
}

export interface RadarBody {
  kind: 'radar'
  title?: string
  /** Axes (spokes) in declaration order. */
  axes: RadarBodyAxis[]
  /** Curves (series) in declaration order. */
  curves: RadarBodyCurve[]
  /** Lower scale bound (default 0). */
  min: number
  /** Upper scale bound; undefined = auto (max of all curve values). */
  max?: number
  /** Concentric ring count (default 5). */
  ticks: number
  /** Ring + curve-edge style (default 'circle'). */
  graticule: 'circle' | 'polygon'
  /** Whether the legend is drawn (default true). */
  showLegend: boolean
}

// ---- Sankey body -------------------------------------------------------------

/** One flow row (`source,target,value`). Nodes are implied by the labels. */
export interface SankeyBodyLink {
  source: string
  target: string
  /** Flow amount — non-negative and finite. */
  value: number
}

export interface SankeyBody {
  kind: 'sankey'
  /** Flows in authored row order. Parallel duplicates are legal and kept. */
  links: SankeyBodyLink[]
}

// ---- Gantt body --------------------------------------------------------------

export type GanttBodyTaskTag = 'active' | 'done' | 'crit' | 'milestone' | 'vert'

export interface GanttBodyTask {
  /** Stable within one parse; recomputed each parse. Not a durable identifier. */
  id: string
  /** Mermaid task id from `:id, start, end` — referenced by after/until/click. */
  taskId?: string
  label: string
  /** Status/shape tags in canonical order (active/done/crit/milestone/vert). */
  tags: GanttBodyTaskTag[]
  /** Raw start expression: a date in the diagram's dateFormat or `after id…`.
   *  Undefined = starts when the previous task ends (Mermaid default). */
  start?: string
  /** Raw end expression: a date, a duration token (`3d`), or `until id…`. */
  end: string
}

export interface GanttBodySection {
  id: string
  /** Undefined = implicit/ungrouped section. */
  label?: string
  tasks: GanttBodyTask[]
}

/**
 * Segment-preserving statement list (the sequence-body pattern): typed ops see
 * sections/tasks/title; calendar directives (dateFormat, excludes, weekend…),
 * click lines, comments, and markers ride along VERBATIM as opaque-block
 * segments — never dropped, edited at the source level only.
 */
export type GanttStatement =
  | { kind: 'title' }
  | { kind: 'section'; ref: number } // index into sections
  | { kind: 'task'; section: number; ref: number } // section + task index
  | { kind: 'opaque-block'; lines: string[] }

export interface GanttBody {
  kind: 'gantt'
  title?: string
  /** Effective tick format; distinct from literal task labels and date input. */
  axisFormat?: string
  sections: GanttBodySection[]
  /** Optional for synthesized payloads; parsed bodies always populate it. */
  statements?: GanttStatement[]
}

// ---- State diagram body -----------------------------------------------------

/**
 * A state node. Simple states carry an optional display label; composite states
 * additionally carry their own nested `states` + `transitions` (and an optional
 * per-composite `direction`). The reserved pseudostate `[*]` is NOT a StateNode
 * — it is modeled contextually as the endpoint id '[*]' on transitions (source
 * = start pseudostate, target = end pseudostate), scoped per composite level.
 */
export interface StateNode {
  id: string
  /** Optional display label (`state "Label" as id` / `id : Label`), its
   *  Mermaid entity codes (`#35;`) read. */
  label?: string
  /** The label as written, while `label` still holds what it reads. */
  labelContent?: LabelContent
  /** Authored/synthesized standalone declaration; implicit transition endpoints omit it. */
  declaredBare?: true
  /** Standalone declaration boundary among transitions in this owning scope.
   * Contextual [*] nodes are created at their transition, so state-array order
   * alone cannot reconstruct this timing. Omitted on synthetic legacy bodies. */
  declarationBeforeTransition?: number
  /** Pseudostate stereotype (`state id <<fork|join|choice|history|…>>`) —
   *  fork/join render as bars, choice as a diamond, history as an (H)/(H*)
   *  circle. `<<H>>`/`<<H*>>` shorthands normalize to history/deep-history. */
  stereotype?: 'fork' | 'join' | 'choice' | 'history' | 'deep-history'
  /** Composite children — present for a non-concurrent composite. */
  states?: StateNode[]
  /** Composite-internal transitions — present for a non-concurrent composite. */
  transitions?: StateTransition[]
  /** Parallel regions split by `--`; mutually exclusive with states/transitions. */
  regions?: StateRegion[]
  /** Assigned classDef names (`A:::hot` / `class A hot`), space-separated in
   *  assignment order: a state takes every class assigned to it, as in
   *  Mermaid. `set_state_class` replaces them with one class. */
  className?: string
  /** Inline state paint (`style A fill:#...`). */
  style?: Record<string, string>
  /** Full ordered CSS when repeated properties cannot fit the query record. */
  styleDeclarations?: import('../shared/style-props.ts').StyleDeclaration[]
  /** Optional per-composite layout direction. */
  direction?: import('../types.ts').Direction
}

export interface StateRegion {
  states: StateNode[]
  transitions: StateTransition[]
  /** A direction authored after this region's separator. */
  direction?: import('../types.ts').Direction
}

export interface StateTransition {
  /** Source state id, '[*]' for a start pseudostate, or a history reference
   *  (`[H]`, `[H*]`, `Base[H]`, `Base[H*]` — preserved verbatim). */
  from: string
  /** Target state id, '[*]' for an end pseudostate, or a history reference. */
  to: string
  /** classDef name on a `[*]` or history `from` (`[*]:::hot --> A`). Such an
   *  endpoint is not a StateNode and Mermaid has no `class` statement for it,
   *  so its class stays on the transition. */
  fromClass?: string
  /** classDef name on a `[*]` or history `to` (`A --> [*]:::hot`). */
  toClass?: string
  label?: string
  /** The label as written, while `label` still holds what it reads. */
  labelContent?: LabelContent
  /** Inline edge paint represented canonically as a linkStyle directive. */
  style?: Record<string, string>
}

/** A state-diagram note (`note left|right of X`). Part of the structured body
 *  (repo #118): queryable, mutable via add_note/remove_note/set_note_text,
 *  and round-tripping through the render parser. */
export interface StateNote {
  /** The state (or composite) the note is anchored to. */
  target: string
  /** Declared side — the renderer anchors the note box on this side. */
  side: 'left' | 'right'
  /** Note text; multi-line text serializes as the block form (`end note`). */
  text: string
  /** The text as written, while `text` still holds what it reads. */
  textContent?: LabelContent
}

export interface StateBody {
  /** Authored Mermaid layout hints retained through editing; geometry remains renderer-owned. */
  layoutDirectives?: string[]
  /** Class assignments awaiting an actual state declaration; they never create a state. */
  unresolvedClasses?: Array<{ id: string; className: string }>
  /** Inline styles awaiting an actual state declaration. */
  unresolvedStyles?: Array<{ id: string; style: Record<string, string>; styleDeclarations?: import('../shared/style-props.ts').StyleDeclaration[] }>
  kind: 'state'
  states: StateNode[]
  transitions: StateTransition[]
  /** Notes in source order; absent when the diagram has none. */
  notes?: StateNote[]
  /** Named, unattached annotations; scoped independently of state identity. */
  floatingNotes?: StateFloatingNote[]
  /** Optional top-level layout direction. */
  direction?: import('../types.ts').Direction
  /** Typed classDef declarations keyed by class name. */
  classDefs?: Record<string, Record<string, string>>
  classDefDeclarations?: Record<string, import('../shared/style-props.ts').StyleDeclaration[]>
  /** Default edge paint (`linkStyle default ...`). */
  defaultTransitionStyle?: Record<string, string>
}

export type StateFloatingNote = import('../state/types.ts').FloatingStateNote

// ---- Mindmap body ---------------------------------------------------------

export interface MindmapBody {
  kind: 'mindmap'
  root: MindmapNode
  accessibilityTitle?: string
  accessibilityDescription?: string
}

// ---- GitGraph body --------------------------------------------------------

export interface GitGraphBody extends GitGraphDiagram {
  kind: 'gitgraph'
}
