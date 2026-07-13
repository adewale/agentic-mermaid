export const SDK_DECLARATION = `// Mermaid agent SDK available as the global \`mermaid\`. All calls are
// synchronous and pure. Compose multi-step edits in one execute() call.
// Code Mode is synchronous: async/await, Promise jobs, and dynamic import are not supported.

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
type CheckMermaidSpec = string[] | {
  include?: string[]; expected?: string[]; required?: string[]; require?: string[]
  exclude?: string[]; absent?: string[]; forbidden?: string[]; forbid?: string[]; unexpected?: string[]
  exact?: boolean
}
interface CheckMermaidResult { ok: boolean; missing: string[]; unexpected: string[]; facts: string[] }

type MermaidConfigScalar = string | number | boolean | null
type MermaidConfigValue = MermaidConfigScalar | MermaidConfigValue[] | { [key: string]: MermaidConfigValue | undefined }
type MermaidRuntimeConfig = {
  [key: string]: MermaidConfigValue | undefined
  theme?: string
  fontFamily?: string
  themeVariables?: { [key: string]: MermaidConfigValue | undefined; fontFamily?: string }
  timeline?: { [key: string]: MermaidConfigValue | undefined; disableMulticolor?: boolean; sectionFills?: string[]; sectionColours?: string[] }
  journey?: { [key: string]: MermaidConfigValue | undefined; diagramMarginX?: number; diagramMarginY?: number; leftMargin?: number; maxLabelWidth?: number; taskMargin?: number; actorColours?: string[]; sectionFills?: string[]; sectionColours?: string[]; useMaxWidth?: boolean }
  flowchart?: { [key: string]: MermaidConfigValue | undefined; nodeSpacing?: number; rankSpacing?: number; wrappingWidth?: number }
  // State geometry consumes the faithful ELK/measured-text equivalents;
  // legacy Dagre calibration keys remain typed and emit INEFFECTIVE_CONFIG.
  state?: { [key: string]: MermaidConfigValue | undefined; titleTopMargin?: number; arrowMarkerAbsolute?: boolean; dividerMargin?: number; sizeUnit?: number; padding?: number; textHeight?: number; titleShift?: number; noteMargin?: number; nodeSpacing?: number; rankSpacing?: number; forkWidth?: number; forkHeight?: number; miniPadding?: number; fontSizeFactor?: number; fontSize?: number; labelHeight?: number; edgeLengthFactor?: string; compositTitleSize?: number; radius?: number; defaultRenderer?: 'dagre-d3' | 'dagre-wrapper' | 'elk' }
  class?: { [key: string]: MermaidConfigValue | undefined; nodeSpacing?: number; rankSpacing?: number }
  er?: { [key: string]: MermaidConfigValue | undefined; layoutDirection?: string; nodeSpacing?: number; rankSpacing?: number }
  architecture?: { [key: string]: MermaidConfigValue | undefined; padding?: number; iconSize?: number; fontSize?: number; nodeSeparation?: number; idealEdgeLengthMultiplier?: number }
  xyChart?: { [key: string]: MermaidConfigValue | undefined }
  pie?: { [key: string]: MermaidConfigValue | undefined; textPosition?: number; donutHole?: number; legendPosition?: 'top' | 'bottom' | 'left' | 'right' | 'center' }
  quadrantChart?: { [key: string]: MermaidConfigValue | undefined; chartWidth?: number; chartHeight?: number; pointRadius?: number; useMaxWidth?: boolean }
  gantt?: { [key: string]: MermaidConfigValue | undefined; displayMode?: string }
  mindmap?: { [key: string]: MermaidConfigValue | undefined; padding?: number; maxNodeWidth?: number }
  gitGraph?: { [key: string]: MermaidConfigValue | undefined; showBranches?: boolean; showCommitLabel?: boolean; mainBranchName?: string; mainBranchOrder?: number; parallelCommits?: boolean; rotateCommitLabel?: boolean }
  // Wired sequence keys (unlisted documented keys are accepted and named by
  // verify's INEFFECTIVE_CONFIG lint — see src/sequence/config.ts).
  sequence?: { [key: string]: MermaidConfigValue | undefined; actorMargin?: number; width?: number; height?: number; diagramMarginX?: number; diagramMarginY?: number; messageMargin?: number; noteMargin?: number; activationWidth?: number; showSequenceNumbers?: boolean }
  useMaxWidth?: boolean
  useWidth?: number
  themeCSS?: string
}

type DiagramKind = 'flowchart' | 'state' | 'sequence' | 'class' | 'er'
                 | 'timeline' | 'journey' | 'xychart' | 'architecture' | 'pie' | 'quadrant' | 'gantt' | 'mindmap' | 'gitgraph'

interface ValidDiagram {
  readonly kind: DiagramKind
  readonly meta: {
    frontmatter?: Record<string, unknown>
    initDirectives: { raw: string; parsed: Record<string, unknown> }[]
    comments: { text: string; line: number }[]
    accessibility: { title?: string; descr?: string }
  }
  readonly body:
    | { kind: 'flowchart'; graph: FlowchartGraph }
    | StateBody
    | SequenceBody
    | TimelineBody
    | ClassBody
    | ErBody
    | JourneyBody
    | ArchitectureBody
    | XyChartBody
    | PieBody
    | QuadrantBody
    | GanttBody
    | MindmapBody
    | GitGraphBody
    | { kind: 'opaque'; family: DiagramKind; source: string }
  readonly canonicalSource: string   // normalized renderer input; opaque fidelity uses body.source
}

type FlowchartValidDiagram = ValidDiagram & { body: { kind: 'flowchart'; graph: FlowchartGraph } }
type StateValidDiagram     = ValidDiagram & { body: StateBody }
type SequenceValidDiagram  = ValidDiagram & { body: SequenceBody }
type TimelineValidDiagram  = ValidDiagram & { body: TimelineBody }
type ClassValidDiagram     = ValidDiagram & { body: ClassBody }
type ErValidDiagram        = ValidDiagram & { body: ErBody }
type JourneyValidDiagram   = ValidDiagram & { body: JourneyBody }
type ArchitectureValidDiagram = ValidDiagram & { body: ArchitectureBody }
type XyChartValidDiagram   = ValidDiagram & { body: XyChartBody }
type PieValidDiagram       = ValidDiagram & { body: PieBody }
type QuadrantValidDiagram  = ValidDiagram & { body: QuadrantBody }
type GanttValidDiagram     = ValidDiagram & { body: GanttBody }
type MindmapValidDiagram   = ValidDiagram & { body: MindmapBody }
type GitGraphValidDiagram  = ValidDiagram & { body: GitGraphBody }

interface FlowchartGraph {
  direction: 'TD' | 'TB' | 'LR' | 'BT' | 'RL'
  // semanticShape/authoredShape carry Mermaid v11 @{ shape } metadata: shape
  // stays the drawn geometry, semanticShape the canonical v11 id, and
  // authoredShape the exact spelling that serializes back.
  nodes: Map<string, { id: string; label: string; shape: string; semanticShape?: string; authoredShape?: string }>
  edges: {
    // id = authored v11.6 edge ID ('e1@-->'): round-trips verbatim and is a
    // valid remove_edge/set_label target selector.
    id?: string
    source: string; target: string; label?: string; style: string
    hasArrowStart?: boolean; hasArrowEnd?: boolean; startMarker?: string; endMarker?: string
  }[]
  subgraphs: { id: string; label: string; nodeIds: string[]; children: FlowchartGraph['subgraphs']; direction?: FlowchartGraph['direction'] }[]
}

interface StateNode { id: string; label?: string; stereotype?: 'fork' | 'join' | 'choice' | 'history' | 'deep-history'; states?: StateNode[]; transitions?: StateTransition[]; direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }
interface StateTransition { from: string; to: string; label?: string }   // from/to may be '[*]' or a history ref ('[H]', 'X[H*]')
interface StateNote { target: string; side: 'left' | 'right'; text: string }
interface StateBody { kind: 'state'; states: StateNode[]; transitions: StateTransition[]; notes?: StateNote[]; direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }

type SeqParticipantKind = 'participant' | 'actor' | 'boundary' | 'control' | 'entity' | 'database' | 'collections' | 'queue'
interface SeqParticipant { id: string; label: string; kind: SeqParticipantKind; declaration?: 'participant' | 'actor'; links?: Record<string, string> }
interface SeqMessage { from: string; to: string; text: string; style: string; arrow?: string; centralStart?: boolean; centralEnd?: boolean; activate?: boolean; deactivate?: boolean }
type SeqFragmentKind = 'alt' | 'opt' | 'loop' | 'par'
interface SeqFragmentBranch { label?: string; messages: SeqMessage[] }
interface SeqFragment { fragmentKind: SeqFragmentKind; label?: string; branches: SeqFragmentBranch[]; rawLines?: string[] }
// BUILD-18: ordered statement list. participant/message refs index into the
// participants/messages arrays; direct-message common fragments are typed;
// opaque-block carries all remaining unmodeled lines verbatim.
type SequenceStatement =
  | { kind: 'participant'; ref: number }
  | { kind: 'message'; ref: number }
  | { kind: 'actor-links'; actorId: string; links: Record<string, string> }
  | { kind: 'fragment'; fragment: SeqFragment }
  | { kind: 'opaque-block'; lines: string[] }
interface SequenceBody { kind: 'sequence'; participants: SeqParticipant[]; messages: SeqMessage[]; statements?: SequenceStatement[] }

interface TimelineEvent { id: string; text: string }
interface TimelinePeriod { id: string; label: string; events: TimelineEvent[] }
interface TimelineSection { id: string; label?: string; periods: TimelinePeriod[] }
// direction: explicit \`timeline TD\`/\`timeline LR\` header token (TD = vertical, upstream PR #7270); undefined = LR default.
interface TimelineBody { kind: 'timeline'; direction?: 'LR' | 'TD'; title?: string; accessibilityTitle?: string; accessibilityDescription?: string; sections: TimelineSection[] }

interface ClassNode { id: string; generic?: string; label?: string; members: string[]; namespace?: string; href?: string }
type ClassRelationKind = 'inheritance' | 'composition' | 'aggregation' | 'association' | 'dependency' | 'realization' | 'link-solid' | 'link-dashed' | 'lollipop'
interface ClassRelation { from: string; to: string; kind: ClassRelationKind; label?: string; fromCardinality?: string; toCardinality?: string; markerAt?: 'from' | 'to' | 'both'; fromKind?: ClassRelationKind; toKind?: ClassRelationKind }
interface ClassNote { text: string; for?: string }
// namespace paths are dot-joined (e.g. 'Platform.Auth'); namespaces render as
// compound boxes and serialize to "namespace path { ... }" blocks.
interface ClassNamespaceDecl { name: string; label?: string }
interface ClassBody { kind: 'class'; title?: string; classes: ClassNode[]; relations: ClassRelation[]; notes: ClassNote[]; namespaces?: ClassNamespaceDecl[] }

type ErCardinality = 'one-only' | 'zero-or-one' | 'zero-or-many' | 'one-or-many'
interface ErAttribute { text: string }
interface ErEntity { id: string; label?: string; attributes: ErAttribute[]; groupId?: string }
interface ErGroup { id: string; label: string; parentId?: string; direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }
interface ErRelation { from: string; to: string; leftCard: ErCardinality; rightCard: ErCardinality; dashed: boolean; label?: string }
interface ErBody { kind: 'er'; entities: ErEntity[]; relations: ErRelation[]; groups?: ErGroup[] }

interface JourneyTask { id: string; text: string; score: number; actors: string[] }
interface JourneySection { id: string; label?: string; tasks: JourneyTask[] }
interface JourneyBody { kind: 'journey'; title?: string; accessibilityTitle?: string; accessibilityDescription?: string; sections: JourneySection[] }

type ArchitectureSide = 'L' | 'R' | 'T' | 'B'
type ArchitectureEndpointBoundary = 'item' | 'group'
interface ArchitectureGroup { id: string; label: string; icon?: string; parentId?: string }
interface ArchitectureService { id: string; label: string; icon?: string; parentId?: string }
interface ArchitectureJunction { id: string; parentId?: string }
interface ArchitectureEndpoint { id: string; side: ArchitectureSide }
interface ArchitectureEdge { source: ArchitectureEndpoint; target: ArchitectureEndpoint; label?: string; hasArrowStart: boolean; hasArrowEnd: boolean }
// alignments: upstream v11.16.0 "align row|column" directives, preserved
// losslessly and honored as deterministic center-coordinate constraints.
interface ArchitectureAlignment { axis: 'row' | 'column'; members: string[] }
interface ArchitectureBody { kind: 'architecture'; title?: string; groups: ArchitectureGroup[]; services: ArchitectureService[]; junctions: ArchitectureJunction[]; edges: ArchitectureEdge[]; alignments?: ArchitectureAlignment[] }

interface XyChartAxis { name?: string; categories?: string[]; range?: { min: number; max: number } }
interface XyChartSeries { id: string; kind: 'bar' | 'line'; name?: string; values: number[]; pointLabels?: Array<string | undefined> }
interface XyChartBody { kind: 'xychart'; title?: string; horizontal?: boolean; xAxis?: XyChartAxis; yAxis?: XyChartAxis; series: XyChartSeries[] }

interface PieSlice { id: string; label: string; value: number }   // value > 0
interface PieBody { kind: 'pie'; title?: string; showData: boolean; slices: PieSlice[] }

interface QuadrantAxis { near: string; far?: string }
// Upstream per-point styling (direct \`radius:/color:/stroke-color:/stroke-width:\`
// tails, \`classDef\` tables, \`:::class\` assignments) is structured content:
// preserved by every op and serialized canonically. strokeWidth may carry px.
interface QuadrantPointStyle { radius?: number; color?: string; strokeColor?: string; strokeWidth?: string }
interface QuadrantPoint { label: string; x: number; y: number; className?: string; style?: QuadrantPointStyle }   // x,y in [0,1]
// quadrants indexed 0-based; index n-1 holds Mermaid quadrant-n
// (1=top-right, 2=top-left, 3=bottom-left, 4=bottom-right)
interface QuadrantBody { kind: 'quadrant'; title?: string; xAxis?: QuadrantAxis; yAxis?: QuadrantAxis; quadrants: [string?, string?, string?, string?]; points: QuadrantPoint[]; classDefs?: Record<string, QuadrantPointStyle> }

type GanttTaskTag = 'active' | 'done' | 'crit' | 'milestone' | 'vert'
// start: a date in the diagram's dateFormat or 'after id…'; undefined = previous task's end.
// end: a date, a duration token ('3d', '2w'), or 'until id…'.
interface GanttTask { id: string; taskId?: string; label: string; tags: GanttTaskTag[]; start?: string; end: string }
interface GanttSection { id: string; label?: string; tasks: GanttTask[] }
// Segment-preserving body: calendar directives (dateFormat, excludes, weekend…),
// click lines, and comments ride along VERBATIM as opaque-block segments — they
// are preserved, not typed-editable. Tasks inside opaque segments are invisible
// to mutation ops.
type GanttStatement =
  | { kind: 'title' }
  | { kind: 'section'; ref: number }
  | { kind: 'task'; section: number; ref: number }
  | { kind: 'opaque-block'; lines: string[] }
interface GanttBody { kind: 'gantt'; title?: string; sections: GanttSection[]; statements?: GanttStatement[] }

type MindmapShape = 'default' | 'rect' | 'rounded' | 'circle' | 'cloud' | 'bang' | 'hexagon'
interface MindmapNode { id: string; label: string; shape: MindmapShape; icon?: string; className?: string; children: MindmapNode[] }
interface MindmapBody { kind: 'mindmap'; root: MindmapNode; accessibilityTitle?: string; accessibilityDescription?: string }

type GitGraphCommitType = 'NORMAL' | 'REVERSE' | 'HIGHLIGHT' | 'MERGE' | 'CHERRY_PICK'
interface GitGraphCommit { id: string; message?: string; type: GitGraphCommitType; customType?: 'NORMAL' | 'REVERSE' | 'HIGHLIGHT'; tags: string[]; parents: string[]; branch: string; sequence: number; source: 'commit' | 'merge' | 'cherry-pick'; customId: boolean }
interface GitGraphBranch { name: string; order: number; head?: string }
interface GitGraphBody { kind: 'gitgraph'; direction: 'LR' | 'TB' | 'BT'; mainBranchName: string; commits: GitGraphCommit[]; branches: GitGraphBranch[]; statements: unknown[]; accessibilityTitle?: string; accessibilityDescription?: string }

type FlowchartMutationOp =
  // shape also accepts any Mermaid v11 @{ shape } name/alias (e.g. 'manual-input')
  | { kind: 'add_node'; id: string; label: string; shape?: string; parent?: string }
  | { kind: 'remove_node'; id: string }
  | { kind: 'rename_node'; from: string; to: string }
  | { kind: 'set_label'; target: string; label: string }   // target: node id, authored edge ID (e1), or 'from->to'/'from->to#k'
  | { kind: 'add_edge'; from: string; to: string; label?: string; style?: 'solid' | 'dotted' | 'thick' | 'invisible' }
  | { kind: 'remove_edge'; id: string }                    // id: authored edge ID (e1), or 'from->to'/'from->to#k'
  | { kind: 'set_shape'; id: string; shape: string }       // geometry name or v11 @{ shape } name/alias
  | { kind: 'set_direction'; direction: 'TD' | 'TB' | 'LR' | 'BT' | 'RL'; subgraph?: string }   // omit subgraph = diagram direction
  | { kind: 'add_subgraph'; id: string; label?: string; parent?: string; members?: string[] }   // members MOVE into the new subgraph
  | { kind: 'remove_subgraph'; id: string; removeMembers?: boolean }   // default dissolves; true deletes members + their edges
  | { kind: 'move_node'; id: string; subgraph: string | null }         // null = top level
  | { kind: 'define_class'; name: string; style: string }              // CSS-like pairs 'fill:#f96,stroke:#333'
  | { kind: 'set_node_class'; id: string; className: string | null }   // null removes the assignment
  | { kind: 'set_node_style'; id: string; style: string | null }       // null clears the inline style

type StateMutationOp =
  | { kind: 'add_state'; id: string; label?: string | null; parent?: string | null; region?: number }
  | { kind: 'remove_state'; id: string; recursive?: boolean }   // recursive: true removes a non-empty composite's whole subtree
  | { kind: 'rename_state'; from: string; to: string }
  | { kind: 'set_state_label'; id: string; label: string | null }
  | { kind: 'add_transition'; from: string; to: string; label?: string | null; parent?: string | null; region?: number }   // from/to may be '[*]' or a history ref ('X[H]')
  | { kind: 'remove_transition'; index?: number; from?: string; to?: string; parent?: string | null; region?: number }
  | { kind: 'set_transition_label'; index?: number; from?: string; to?: string; label: string | null; parent?: string | null; region?: number }
  | { kind: 'make_composite'; id: string; members: string[]; label?: string | null }
  | { kind: 'set_direction'; direction: 'TD' | 'TB' | 'LR' | 'BT' | 'RL'; state?: string | null }   // omit state = diagram direction; composite id = its override
  | { kind: 'move_state'; id: string; parent: string | null; region?: number }   // null = top level; region addresses a concurrent composite
  | { kind: 'dissolve_composite'; id: string }                  // hoists children + inner transitions; rejects while referenced
  | { kind: 'add_note'; target: string; side?: 'left' | 'right'; text: string }   // side defaults to 'right'
  | { kind: 'remove_note'; index: number }
  | { kind: 'set_note_text'; index: number; text: string }
  | { kind: 'define_class'; name: string; style: string }
  | { kind: 'set_state_class'; id: string; className: string | null }
  | { kind: 'set_state_style'; id: string; style: string | null }
  | { kind: 'set_transition_style'; index?: number; default?: boolean; style: string | null; parent?: string | null; region?: number }

type SequenceMutationOp =
  | { kind: 'add_participant'; id: string; label?: string; participantKind?: 'participant' | 'actor' }
  | { kind: 'remove_participant'; id: string }
  | { kind: 'add_message'; from: string; to: string; text: string; style?: 'sync' | 'reply' | 'async' | 'async-dashed' | 'lost' | 'lost-dashed'; index?: number }   // index = top-level insert position; omitted = append
  | { kind: 'remove_message'; index: number }
  | { kind: 'set_message_text'; index: number; text: string }
  | { kind: 'move_message'; from: number; to: number }   // top-level indices
  | { kind: 'set_participant_label'; id: string; label: string }
  | { kind: 'add_fragment'; fragmentKind: SeqFragmentKind; label?: string; index?: number }
  | { kind: 'remove_fragment'; index: number }
  | { kind: 'set_fragment_label'; index: number; label: string | null }
  | { kind: 'add_fragment_branch'; fragmentIndex: number; label?: string }
  | { kind: 'set_fragment_branch_label'; fragmentIndex: number; branchIndex: number; label: string | null }
  | { kind: 'add_fragment_message'; fragmentIndex: number; branchIndex?: number; from: string; to: string; text: string; style?: 'sync' | 'reply' | 'async' | 'async-dashed' | 'lost' | 'lost-dashed'; index?: number }
  | { kind: 'remove_fragment_message'; fragmentIndex: number; branchIndex?: number; index: number }
  | { kind: 'set_fragment_message_text'; fragmentIndex: number; branchIndex?: number; index: number; text: string }

type TimelineMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_section'; label: string; index?: number }             // index = insert position; omit to append
  | { kind: 'remove_section'; index: number }
  | { kind: 'set_section_label'; index: number; label: string }
  | { kind: 'add_period'; sectionIndex: number; label: string; events?: string[]; index?: number }
  | { kind: 'remove_period'; sectionIndex: number; periodIndex: number }
  | { kind: 'set_period_label'; sectionIndex: number; periodIndex: number; label: string }
  | { kind: 'add_event'; sectionIndex: number; periodIndex: number; text: string; index?: number }
  | { kind: 'remove_event'; sectionIndex: number; periodIndex: number; eventIndex: number }
  | { kind: 'set_event_text'; sectionIndex: number; periodIndex: number; eventIndex: number; text: string }
  // Chronology reorder (journey move_task/move_section convention): toIndex is
  // the insert position in the target container, applied after removal.
  | { kind: 'move_period'; fromSection: number; fromIndex: number; toSection: number; toIndex: number }
  | { kind: 'move_event'; fromSection: number; fromPeriod: number; fromIndex: number; toSection: number; toPeriod: number; toIndex: number }
  | { kind: 'move_section'; from: number; to: number }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

type ClassMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_class'; id: string; label?: string; generic?: string; members?: string[]; namespace?: string }
  | { kind: 'remove_class'; id: string }
  | { kind: 'rename_class'; from: string; to: string }
  | { kind: 'set_class_generic'; class: string; generic: string | null }
  | { kind: 'add_member'; class: string; text: string }
  | { kind: 'remove_member'; class: string; index: number }
  | { kind: 'add_relation'; from: string; to: string; relKind: ClassRelationKind; label?: string }
  | { kind: 'remove_relation'; index: number }
  | { kind: 'add_note'; text: string; for?: string }
  | { kind: 'remove_note'; index: number }
  | { kind: 'set_class_namespace'; class: string; namespace: string | null }
  | { kind: 'define_class'; name: string; style: string }
  | { kind: 'set_css_class'; class: string; className: string | null }
  | { kind: 'set_class_style'; class: string; style: string | null }

type ErMutationOp =
  | { kind: 'add_entity'; id: string; label?: string; attributes?: string[] }
  | { kind: 'remove_entity'; id: string }
  | { kind: 'rename_entity'; from: string; to: string }
  | { kind: 'set_entity_label'; entity: string; label: string | null }
  | { kind: 'add_attribute'; entity: string; text: string }
  | { kind: 'remove_attribute'; entity: string; index: number }
  | { kind: 'add_relation'; from: string; to: string; leftCard: ErCardinality; rightCard: ErCardinality; dashed?: boolean; label?: string }
  | { kind: 'remove_relation'; index: number }
  | { kind: 'set_direction'; direction: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }
  | { kind: 'define_class'; name: string; style: string }
  | { kind: 'set_entity_class'; entity: string; className: string | null }
  | { kind: 'set_entity_style'; entity: string; style: string | null }

type JourneyMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_section'; label: string; index?: number }
  | { kind: 'remove_section'; index: number }
  | { kind: 'set_section_label'; index: number; label: string }
  | { kind: 'add_task'; sectionIndex: number; text: string; score: number; actors?: string[]; index?: number }
  | { kind: 'remove_task'; sectionIndex: number; taskIndex: number }
  | { kind: 'set_task_text'; sectionIndex: number; taskIndex: number; text: string }
  | { kind: 'set_task_score'; sectionIndex: number; taskIndex: number; score: number }
  | { kind: 'set_task_actors'; sectionIndex: number; taskIndex: number; actors: string[] }
  | { kind: 'rename_actor'; from: string; to: string }
  | { kind: 'move_task'; fromSection: number; fromIndex: number; toSection: number; toIndex: number }
  | { kind: 'move_section'; from: number; to: number }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

type ArchitectureMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }
  | { kind: 'add_service'; id: string; label?: string; icon?: string | null; group?: string | null }
  | { kind: 'remove_service'; id: string }
  | { kind: 'rename_service'; from: string; to: string }
  | { kind: 'set_service_label'; id: string; label: string }
  | { kind: 'set_service_icon'; id: string; icon: string | null }
  | { kind: 'move_service'; id: string; group: string | null }
  | { kind: 'add_junction'; id: string; group?: string | null }
  | { kind: 'remove_junction'; id: string }
  | { kind: 'rename_junction'; from: string; to: string }
  | { kind: 'move_junction'; id: string; group: string | null }
  | { kind: 'add_group'; id: string; label?: string; icon?: string | null; parent?: string | null }
  | { kind: 'set_group_label'; id: string; label: string }
  | { kind: 'remove_group'; id: string }
  | { kind: 'add_edge'; from: string; to: string; fromSide: ArchitectureSide; toSide: ArchitectureSide; fromBoundary?: ArchitectureEndpointBoundary; toBoundary?: ArchitectureEndpointBoundary; label?: string | null; hasArrowStart?: boolean; hasArrowEnd?: boolean }
  | { kind: 'update_edge'; index: number; from?: string; to?: string; fromSide?: ArchitectureSide; toSide?: ArchitectureSide; fromBoundary?: ArchitectureEndpointBoundary; toBoundary?: ArchitectureEndpointBoundary; label?: string | null; hasArrowStart?: boolean; hasArrowEnd?: boolean }
  | { kind: 'remove_edge'; index?: number; id?: string }

type XyChartAxisSpec = { name?: string | null; categories?: string[]; range?: { min: number; max: number } }
type XyChartMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_x_axis'; axis: XyChartAxisSpec | null }
  | { kind: 'set_y_axis'; axis: XyChartAxisSpec | null }
  | { kind: 'add_series'; kind2: 'bar' | 'line'; name?: string | null; values: number[] }
  | { kind: 'remove_series'; index: number }
  | { kind: 'set_series_values'; index: number; values: number[] }
  | { kind: 'set_series_name'; index: number; name: string | null }
  | { kind: 'reorder_series'; from: number; to: number }
  | { kind: 'set_orientation'; horizontal: boolean }
  | { kind: 'set_data_point'; seriesIndex: number; index: number; value: number }

type PieMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_show_data'; showData: boolean }
  | { kind: 'add_slice'; label: string; value: number }   // value > 0
  | { kind: 'remove_slice'; label: string }
  | { kind: 'rename_slice'; from: string; to: string }
  | { kind: 'set_slice_value'; label: string; value: number }
  | { kind: 'reorder_slice'; from: number; to: number }

type QuadrantMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_axis_labels'; axis: 'x' | 'y'; near: string | null; far?: string | null }
  | { kind: 'set_quadrant_label'; quadrant: number; label: string | null }   // quadrant 1..4
  | { kind: 'add_point'; label: string; x: number; y: number }   // x,y in [0,1]
  | { kind: 'remove_point'; label: string }
  | { kind: 'move_point'; label: string; x: number; y: number }
  | { kind: 'rename_point'; from: string; to: string }

type MindmapMutationOp =
  | { kind: 'add_node'; id: string; label: string; parent: string; shape?: MindmapShape; index?: number }
  | { kind: 'remove_node'; id: string; recursive?: boolean }
  | { kind: 'rename_node'; from: string; to: string }
  | { kind: 'set_label'; id: string; label: string }
  | { kind: 'move_node'; id: string; parent: string; index?: number }
  | { kind: 'set_shape'; id: string; shape: MindmapShape }
  | { kind: 'set_icon'; id: string; icon: string | null }
  | { kind: 'set_node_class'; id: string; className: string | null }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

type GitGraphMutationOp =
  | { kind: 'append_commit'; id?: string; message?: string; type?: 'NORMAL' | 'REVERSE' | 'HIGHLIGHT'; tags?: string[] }
  | { kind: 'create_branch'; name: string; order?: number }
  | { kind: 'checkout_branch'; name: string }
  | { kind: 'merge_branch'; name: string; id?: string; type?: 'NORMAL' | 'REVERSE' | 'HIGHLIGHT'; tags?: string[] }
  | { kind: 'cherry_pick'; id: string; parent?: string; tags?: string[] }
  | { kind: 'set_commit_message'; id: string; message: string | null }
  | { kind: 'set_commit_type'; id: string; type: 'NORMAL' | 'REVERSE' | 'HIGHLIGHT' }
  | { kind: 'set_commit_tags'; id: string; tags: string[] }
  | { kind: 'rename_branch'; from: string; to: string }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

type GanttMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_section'; label: string }
  | { kind: 'rename_section'; index: number; label: string }
  | { kind: 'remove_section'; index: number }
  | { kind: 'add_task'; sectionIndex: number; label: string; taskId?: string; tags?: GanttTaskTag[]; start?: string; end: string; index?: number }
  | { kind: 'remove_task'; sectionIndex: number; taskIndex: number }
  | { kind: 'rename_task'; sectionIndex: number; taskIndex: number; label: string }
  | { kind: 'set_task_status'; sectionIndex: number; taskIndex: number; status: 'active' | 'done' | 'crit' | null }
  | { kind: 'set_task_dates'; sectionIndex: number; taskIndex: number; start?: string | null; end?: string }
  | { kind: 'set_task_flags'; sectionIndex: number; taskIndex: number; milestone?: boolean; vert?: boolean }
  // set_task_id rewrites structured after/until references on rename; rejects
  // while referenced from opaque lines (click/comments), and null rejects
  // while referenced at all.
  | { kind: 'set_task_id'; sectionIndex: number; taskIndex: number; taskId: string | null }
  // Source order IS gantt scheduling semantics: moves are rejected with a
  // prescriptive error when they would change an implicit-start task's
  // predecessor (materialize an explicit start via set_task_dates first).
  | { kind: 'move_task'; fromSection: number; fromIndex: number; toSection: number; toIndex: number }
  | { kind: 'move_section'; from: number; to: number }

// Tier 1 (structural, reliable): EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS,
//   GROUP_BREACH, UNKNOWN_SHAPE, LABEL_OVERFLOW (rendered-line char count:
//   <br> splits lines, XML entities decode to one char),
//   UNRESOLVABLE_SCHEDULE (gantt: parses but schedule cannot resolve; render would fail),
//   RENDER_FAILED (strict renderer rejected the canonical source).
// Tier 2 (geometric, advisory): NODE_OVERLAP, ROUTE_SELF_CROSS, and the
// route-contract tripwires ROUTE_HITCH, ROUTE_UNEXPLAINED_BEND,
// ROUTE_LABEL_ON_SHARED_TRUNK, ROUTE_SELF_LOOP_OCCUPANCY, ROUTE_CONTAINER_MISANCHOR,
// ROUTE_SHAPE_MISANCHOR, ROUTE_STALE_AFTER_NODE_MOVE.
// Tier 3 (lint, advisory): DUPLICATE_EDGE, UNREACHABLE_NODE,
// DECISION_BRANCH_UNLABELED, COMMENT_DROPPED, UNSUPPORTED_SYNTAX,
// CONTENT_DROPPED_ON_ROUNDTRIP, INEFFECTIVE_CONFIG.
type WarningCode =
  | 'EMPTY_DIAGRAM' | 'EDGE_MISANCHORED' | 'OFF_CANVAS' | 'GROUP_BREACH'
  | 'UNKNOWN_SHAPE' | 'LABEL_OVERFLOW' | 'UNRESOLVABLE_SCHEDULE' | 'RENDER_FAILED'
  | 'NODE_OVERLAP' | 'ROUTE_SELF_CROSS' | 'ROUTE_HITCH'
  | 'ROUTE_UNEXPLAINED_BEND' | 'ROUTE_LABEL_ON_SHARED_TRUNK' | 'ROUTE_SELF_LOOP_OCCUPANCY' | 'ROUTE_CONTAINER_MISANCHOR'
  | 'ROUTE_SHAPE_MISANCHOR' | 'ROUTE_STALE_AFTER_NODE_MOVE'
  | 'DUPLICATE_EDGE' | 'UNREACHABLE_NODE' | 'DECISION_BRANCH_UNLABELED' | 'COMMENT_DROPPED' | 'UNSUPPORTED_SYNTAX'
  | 'CONTENT_DROPPED_ON_ROUNDTRIP' | 'INEFFECTIVE_CONFIG'

interface VerifyResult {
  ok: boolean
  warnings: { code: WarningCode; [field: string]: unknown }[]
  layout: { version: 1; kind: DiagramKind; nodes: unknown[]; edges: unknown[]; groups: unknown[]; bounds: { w: number; h: number } }
}

interface DiagramAnalysis {
  kind: DiagramKind
  feedbackEdges: Array<{ edgeIndex: number; from: string; to: string; label?: string; routeClass: string }>
  actions: Array<{ id?: string; regionId?: string; family: DiagramKind; target: string; action: 'href' | 'call' | 'callback'; raw: string; line?: number; href?: string; security: 'safe' | 'unsafe' | 'source-only' | 'unsupported'; executable: false; message?: string }>
  gantt?: { criticalPathTaskIds: string[]; slackByTaskId: Record<string, number>; projectStart: number; projectEnd: number; entryTaskIds: string[]; sinkTaskIds: string[] }
}

type AnyMutationOp = FlowchartMutationOp | StateMutationOp | SequenceMutationOp | TimelineMutationOp
                   | ClassMutationOp | ErMutationOp | JourneyMutationOp | ArchitectureMutationOp
                   | XyChartMutationOp | PieMutationOp | QuadrantMutationOp | GanttMutationOp
                   | MindmapMutationOp | GitGraphMutationOp

declare const mermaid: {
  parseMermaid(source: string): Result<ValidDiagram, { code: string; message: string }[]>
  // Blank-slate authoring: createMermaid returns an empty structured diagram
  // for any DiagramKind (already narrowed — pass it straight to mutate).
  // buildMermaid folds a typed op list over that empty diagram; on failure the
  // error carries opIndex of the op that failed. direction applies to
  // flowchart/state only.
  createMermaid(kind: DiagramKind, opts?: { direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }): ValidDiagram
  buildMermaid(kind: DiagramKind, ops: AnyMutationOp[], opts?: { direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }): Result<ValidDiagram, { code: string; message: string; opIndex: number }>
  asFlowchart(d: ValidDiagram): FlowchartValidDiagram | null
  asState(d: ValidDiagram):     StateValidDiagram | null
  asSequence(d: ValidDiagram):  SequenceValidDiagram | null
  asTimeline(d: ValidDiagram):  TimelineValidDiagram | null
  asClass(d: ValidDiagram):     ClassValidDiagram | null
  asEr(d: ValidDiagram):        ErValidDiagram | null
  asJourney(d: ValidDiagram):   JourneyValidDiagram | null
  asArchitecture(d: ValidDiagram): ArchitectureValidDiagram | null
  asXyChart(d: ValidDiagram):   XyChartValidDiagram | null
  asPie(d: ValidDiagram):       PieValidDiagram | null
  asQuadrant(d: ValidDiagram):  QuadrantValidDiagram | null
  asGantt(d: ValidDiagram):     GanttValidDiagram | null
  asMindmap(d: ValidDiagram):   MindmapValidDiagram | null
  asGitGraph(d: ValidDiagram):  GitGraphValidDiagram | null
  mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, { code: string; message: string }>
  mutate(d: StateValidDiagram,     op: StateMutationOp):     Result<StateValidDiagram, { code: string; message: string }>
  mutate(d: SequenceValidDiagram,  op: SequenceMutationOp):  Result<SequenceValidDiagram, { code: string; message: string }>
  mutate(d: TimelineValidDiagram,  op: TimelineMutationOp):  Result<TimelineValidDiagram, { code: string; message: string }>
  mutate(d: ClassValidDiagram,     op: ClassMutationOp):     Result<ClassValidDiagram, { code: string; message: string }>
  mutate(d: ErValidDiagram,        op: ErMutationOp):        Result<ErValidDiagram, { code: string; message: string }>
  mutate(d: JourneyValidDiagram,   op: JourneyMutationOp):   Result<JourneyValidDiagram, { code: string; message: string }>
  mutate(d: ArchitectureValidDiagram, op: ArchitectureMutationOp): Result<ArchitectureValidDiagram, { code: string; message: string }>
  mutate(d: XyChartValidDiagram,   op: XyChartMutationOp):   Result<XyChartValidDiagram, { code: string; message: string }>
  mutate(d: PieValidDiagram,       op: PieMutationOp):       Result<PieValidDiagram, { code: string; message: string }>
  mutate(d: QuadrantValidDiagram,  op: QuadrantMutationOp):  Result<QuadrantValidDiagram, { code: string; message: string }>
  mutate(d: GanttValidDiagram,     op: GanttMutationOp):     Result<GanttValidDiagram, { code: string; message: string }>
  mutate(d: MindmapValidDiagram,   op: MindmapMutationOp):   Result<MindmapValidDiagram, { code: string; message: string }>
  mutate(d: GitGraphValidDiagram,  op: GitGraphMutationOp):  Result<GitGraphValidDiagram, { code: string; message: string }>
  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: WarningCode[]; labelCharCap?: number }): VerifyResult
  analyzeMermaid(d: ValidDiagram): DiagramAnalysis
  analyzeMermaidSource(source: string): Result<DiagramAnalysis, { code: string; message: string }[]>
  describeMermaidFacts(d: ValidDiagram): string[]
  describeMermaidFactsSource(source: string): Result<string[], { code: string; message: string }[]>
  checkMermaid(d: ValidDiagram, spec: CheckMermaidSpec): CheckMermaidResult
  checkMermaidSource(source: string, spec: CheckMermaidSpec): Result<CheckMermaidResult, { code: string; message: string }[]>
  serializeMermaid(d: ValidDiagram): string
  renderMermaidSVG(input: ValidDiagram | string, opts?: { security?: 'default' | 'strict'; idPrefix?: string; ganttToday?: string; mermaidConfig?: MermaidRuntimeConfig; style?: StyleInput | StyleInput[]; seed?: number; onConfigDiagnostic?: (diagnostic: { code: 'INEFFECTIVE_CONFIG'; field: string; message: string }) => void }): string
  renderMermaidASCII(input: ValidDiagram | string, opts?: { useAscii?: boolean; maxWidth?: number; targetWidth?: number; ganttToday?: string; mermaidConfig?: MermaidRuntimeConfig }): string
  // Op discovery — look up exact op shapes at runtime instead of guessing.
  // describeOps returns every op's field names, required-ness, inlined enum
  // values, and constraint/default notes (e.g. score "integer 1..5", shape
  // "default: rectangle"); opSignatures returns compact one-liners like
  // "add_point(label, x, y)". Read these before authoring an unfamiliar op.
  describeOps(family: DiagramKind): Record<string, { name: string; required: boolean; type: string; note?: string }[]>
  opSignatures(family: DiagramKind): string[]
}

// Conventions:
// 1. For new diagrams, use buildMermaid(kind, ops) — or createMermaid(kind)
//    then mutate step by step — and verify/render the result. Hand-author
//    Mermaid source only for syntax the typed ops do not model.
// 2. For existing structured diagrams, use mutate() + verify + serializeMermaid();
//    do not regenerate/concatenate source when a typed op exists.
// 3. mutate works on flowchart, state, simple sequence, timeline, class, ER,
//    journey, architecture, xychart, pie, quadrant, gantt, mindmap, and
//    gitgraph. Narrow via
//    asFlowchart/asState/asSequence/asTimeline/asClass/asEr/asJourney/
//    asArchitecture/asXyChart/asPie/asQuadrant/asGantt/asMindmap/asGitGraph.
//    State owns a dedicated body (BUILD-19); asFlowchart returns null on it.
//    Gantt bodies are segment-preserving: directives/click/comment lines ride
//    along verbatim as opaque-block segments and are edited as source only.
//    Opaque-fallback
//    bodies (unmodeled syntax) are source-level only; if explicitly edited as
//    text, re-parse and verify before returning.
// 4. verify.ok is structural, not a visual-quality score; inspect warnings/layout or render artifacts for layout quality.
//    For semantic task correctness, read back deterministic facts or check them:
//    checkMermaid(d, ['edge Processing -> [*] : done', 'member Duck +quack()']).
// 5. Layout is deterministic and never seeded. The render option seed only
//    re-rolls stochastic ink of styled looks (render option style: a name,
//    an inline style record, or a stack merged left-to-right; a colors-only
//    style is a theme); geometry is identical for identical input. Gantt
//    never reads the wall clock; pass render option ganttToday to draw a
//    deterministic today marker.
`
