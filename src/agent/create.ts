import type { EventModelingValidDiagram, EventModelingMutationOp } from './types.ts'
import type { PacketMutationOp, PacketValidDiagram, KanbanMutationOp, KanbanValidDiagram, RequirementMutationOp, RequirementValidDiagram, TreemapMutationOp, TreemapValidDiagram, IshikawaMutationOp, IshikawaValidDiagram, BlockMutationOp, BlockValidDiagram } from './types.ts'
import { emptyC4Body } from '../c4/parser.ts'
import type { C4Variant } from '../c4/types.ts'
import type { C4MutationOp, C4ValidDiagram } from './types.ts'
// ============================================================================
// createMermaid / buildMermaid: blank-slate authoring through the typed
// surface. Editing an existing diagram already goes parse → narrow → mutate;
// creating one previously meant hand-writing Mermaid source — the fragile
// path the typed ops exist to replace. createMermaid returns an empty
// structured diagram for any built-in family; buildMermaid folds a mutation
// list over that empty diagram so a whole new diagram is one typed call.
// Saved before it has content, an empty diagram is its bare family header:
// verify reports EMPTY_DIAGRAM, and it re-parses typed wherever Mermaid
// accepts that header. Mermaid rejects a bare Sankey header, so a saved blank
// Sankey re-parses opaque and fails to render until it has a link. Mermaid
// also rejects a bare class header; ours reads it as an empty class diagram,
// and verify says Mermaid rejects it.
// ============================================================================

import type { ZenUMLMutationOp, ZenUMLValidDiagram } from './types.ts'
import type { Direction } from '../types.ts'
import { applyMutationBatch } from './mutate.ts'
import { serializeMermaid } from './serialize.ts'
import { logToolInvocation } from './trace-log.ts'
import type {
  AnyMutationOp,
  ArchitectureMutationOp,
  ArchitectureValidDiagram,
  ClassMutationOp,
  ClassValidDiagram,
  DiagramBody,
  DiagramKind,
  ErMutationOp,
  ErValidDiagram,
  FlowchartMutationOp,
  FlowchartValidDiagram,
  GanttMutationOp,
  GanttValidDiagram,
  GitGraphMutationOp,
  GitGraphValidDiagram,
  JourneyMutationOp,
  JourneyValidDiagram,
  MindmapMutationOp,
  MindmapValidDiagram,
  MutableValidDiagram,
  MutationError,
  PieMutationOp,
  PieValidDiagram,
  QuadrantMutationOp,
  QuadrantValidDiagram,
  RadarMutationOp,
  RadarValidDiagram,
  Result,
  SankeyMutationOp,
  SankeyValidDiagram,
  SequenceMutationOp,
  SequenceValidDiagram,
  StateMutationOp,
  StateValidDiagram,
  TimelineMutationOp,
  TimelineValidDiagram,
  ValidDiagram,
  XyChartMutationOp,
  XyChartValidDiagram,
} from './types.ts'
import { err, ok } from './types.ts'

export interface CreateMermaidOptions {
  /** Legacy C4 dialect for a new diagram (default C4Context). */
  c4Variant?: C4Variant
  /** Layout direction for flowchart/state diagrams (default TD). Ignored elsewhere. */
  direction?: Direction
}

/** A mutation failure annotated with which op in the build list failed. */
export type BuildError = MutationError & { opIndex: number }

function emptyBody(kind: DiagramKind, opts: CreateMermaidOptions): Exclude<DiagramBody, { kind: 'opaque' }> {
  switch (kind) {
    case 'flowchart':
      return {
        kind: 'flowchart',
        graph: {
          direction: opts.direction ?? 'TD',
          nodes: new Map(),
          edges: [],
          subgraphs: [],
          classDefs: new Map(),
          classAssignments: new Map(),
          nodeStyles: new Map(),
          linkStyles: new Map(),
        },
      }
    case 'state':
      return { kind: 'state', states: [], transitions: [], direction: opts.direction }
    case 'sequence':
      return { kind: 'sequence', participants: [], messages: [], statements: [] }
    case 'timeline':
      return { kind: 'timeline', sections: [] }
    case 'class':
      return { kind: 'class', classes: [], relations: [], notes: [] }
    case 'er':
      return { kind: 'er', entities: [], relations: [] }
    case 'journey':
      return { kind: 'journey', sections: [] }
    case 'architecture':
      return { kind: 'architecture', groups: [], services: [], junctions: [], edges: [] }
    case 'xychart':
      return { kind: 'xychart', series: [] }
    case 'pie':
      return { kind: 'pie', showData: false, slices: [] }
    case 'quadrant':
      return { kind: 'quadrant', quadrants: [undefined, undefined, undefined, undefined], points: [] }
    case 'gantt':
      return { kind: 'gantt', sections: [], statements: [] }
    case 'mindmap':
      return { kind: 'mindmap', root: { id: 'root', label: 'root', shape: 'default', children: [] } }
    case 'gitgraph':
      return {
        kind: 'gitgraph',
        direction: 'LR',
        mainBranchName: 'main',
        commits: [],
        branches: [{ name: 'main', order: 0, sequence: 0 }],
        statements: [],
      }
    case 'radar':
      return { kind: 'radar', axes: [], curves: [], min: 0, ticks: 5, graticule: 'circle', showLegend: true }
    case 'sankey':
      return { kind: 'sankey', links: [] }
    case 'c4':
      return emptyC4Body(opts.c4Variant)
    case 'packet':
      return { kind: 'packet', fields: [] }
    case 'kanban':
      return { kind: 'kanban', columns: [] }
    case 'requirement':
      return { kind: 'requirement', direction: 'TB', requirements: [], elements: [], relations: [], classDefs: [] }
    case 'treemap':
      return { kind: 'treemap', nodes: [], classDefs: Object.create(null) }
    case 'zenuml':
      return { kind: 'zenuml', participants: [], statements: [] }
    case 'eventmodeling':
      return { kind: 'eventmodeling', frames: [], entities: [], data: Object.create(null), notes: [], specifications: [] }
    case 'ishikawa':
      return { kind: 'ishikawa', nodes: [] }
    case 'block':
      return { kind: 'block', root: { id: 'root', type: 'composite', children: [] }, edges: [], classDefs: [] }
  }
}

export function createMermaid(kind: 'flowchart', opts?: CreateMermaidOptions): FlowchartValidDiagram
export function createMermaid(kind: 'state', opts?: CreateMermaidOptions): StateValidDiagram
export function createMermaid(kind: 'sequence', opts?: CreateMermaidOptions): SequenceValidDiagram
export function createMermaid(kind: 'timeline', opts?: CreateMermaidOptions): TimelineValidDiagram
export function createMermaid(kind: 'class', opts?: CreateMermaidOptions): ClassValidDiagram
export function createMermaid(kind: 'er', opts?: CreateMermaidOptions): ErValidDiagram
export function createMermaid(kind: 'journey', opts?: CreateMermaidOptions): JourneyValidDiagram
export function createMermaid(kind: 'architecture', opts?: CreateMermaidOptions): ArchitectureValidDiagram
export function createMermaid(kind: 'xychart', opts?: CreateMermaidOptions): XyChartValidDiagram
export function createMermaid(kind: 'pie', opts?: CreateMermaidOptions): PieValidDiagram
export function createMermaid(kind: 'quadrant', opts?: CreateMermaidOptions): QuadrantValidDiagram
export function createMermaid(kind: 'gantt', opts?: CreateMermaidOptions): GanttValidDiagram
export function createMermaid(kind: 'mindmap', opts?: CreateMermaidOptions): MindmapValidDiagram
export function createMermaid(kind: 'gitgraph', opts?: CreateMermaidOptions): GitGraphValidDiagram
export function createMermaid(kind: 'radar', opts?: CreateMermaidOptions): RadarValidDiagram
export function createMermaid(kind: 'c4', opts?: CreateMermaidOptions): C4ValidDiagram
export function createMermaid(kind: 'sankey', opts?: CreateMermaidOptions): SankeyValidDiagram
export function createMermaid(kind: 'packet', opts?: CreateMermaidOptions): PacketValidDiagram
export function createMermaid(kind: 'kanban', opts?: CreateMermaidOptions): KanbanValidDiagram
export function createMermaid(kind: 'requirement', opts?: CreateMermaidOptions): RequirementValidDiagram
export function createMermaid(kind: 'treemap', opts?: CreateMermaidOptions): TreemapValidDiagram
export function createMermaid(kind: 'zenuml', opts?: CreateMermaidOptions): ZenUMLValidDiagram
export function createMermaid(kind: 'eventmodeling', opts?: CreateMermaidOptions): EventModelingValidDiagram
export function createMermaid(kind: 'ishikawa', opts?: CreateMermaidOptions): IshikawaValidDiagram
export function createMermaid(kind: 'block', opts?: CreateMermaidOptions): BlockValidDiagram
export function createMermaid(kind: DiagramKind, opts?: CreateMermaidOptions): MutableValidDiagram
export function createMermaid(kind: DiagramKind, opts: CreateMermaidOptions = {}): MutableValidDiagram {
  logToolInvocation('build') // also covers buildMermaid/buildChecked, which route through here
  const body = emptyBody(kind, opts) as ReturnType<typeof emptyBody> | undefined
  // The switch is TS-exhaustive but callers reach this from untyped surfaces
  // (Code Mode, CLI), so fail loudly on an unknown kind.
  if (!body) throw new Error(`createMermaid: unknown diagram kind "${String(kind)}"`)
  const draft: ValidDiagram = {
    kind,
    body,
    meta: { initDirectives: [], comments: [], accessibility: {} },
    source: { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() },
    canonicalSource: '',
  }
  return { ...draft, canonicalSource: serializeMermaid(draft) } as MutableValidDiagram
}

export function buildMermaid(kind: 'flowchart', ops: FlowchartMutationOp[], opts?: CreateMermaidOptions): Result<FlowchartValidDiagram, BuildError>
export function buildMermaid(kind: 'state', ops: StateMutationOp[], opts?: CreateMermaidOptions): Result<StateValidDiagram, BuildError>
export function buildMermaid(kind: 'sequence', ops: SequenceMutationOp[], opts?: CreateMermaidOptions): Result<SequenceValidDiagram, BuildError>
export function buildMermaid(kind: 'timeline', ops: TimelineMutationOp[], opts?: CreateMermaidOptions): Result<TimelineValidDiagram, BuildError>
export function buildMermaid(kind: 'class', ops: ClassMutationOp[], opts?: CreateMermaidOptions): Result<ClassValidDiagram, BuildError>
export function buildMermaid(kind: 'er', ops: ErMutationOp[], opts?: CreateMermaidOptions): Result<ErValidDiagram, BuildError>
export function buildMermaid(kind: 'journey', ops: JourneyMutationOp[], opts?: CreateMermaidOptions): Result<JourneyValidDiagram, BuildError>
export function buildMermaid(kind: 'architecture', ops: ArchitectureMutationOp[], opts?: CreateMermaidOptions): Result<ArchitectureValidDiagram, BuildError>
export function buildMermaid(kind: 'xychart', ops: XyChartMutationOp[], opts?: CreateMermaidOptions): Result<XyChartValidDiagram, BuildError>
export function buildMermaid(kind: 'pie', ops: PieMutationOp[], opts?: CreateMermaidOptions): Result<PieValidDiagram, BuildError>
export function buildMermaid(kind: 'quadrant', ops: QuadrantMutationOp[], opts?: CreateMermaidOptions): Result<QuadrantValidDiagram, BuildError>
export function buildMermaid(kind: 'gantt', ops: GanttMutationOp[], opts?: CreateMermaidOptions): Result<GanttValidDiagram, BuildError>
export function buildMermaid(kind: 'mindmap', ops: MindmapMutationOp[], opts?: CreateMermaidOptions): Result<MindmapValidDiagram, BuildError>
export function buildMermaid(kind: 'gitgraph', ops: GitGraphMutationOp[], opts?: CreateMermaidOptions): Result<GitGraphValidDiagram, BuildError>
export function buildMermaid(kind: 'radar', ops: RadarMutationOp[], opts?: CreateMermaidOptions): Result<RadarValidDiagram, BuildError>
export function buildMermaid(kind: 'c4', ops: C4MutationOp[], opts?: CreateMermaidOptions): Result<C4ValidDiagram, BuildError>
export function buildMermaid(kind: 'sankey', ops: SankeyMutationOp[], opts?: CreateMermaidOptions): Result<SankeyValidDiagram, BuildError>
export function buildMermaid(kind: 'packet', ops: PacketMutationOp[], opts?: CreateMermaidOptions): Result<PacketValidDiagram, BuildError>
export function buildMermaid(kind: 'kanban', ops: KanbanMutationOp[], opts?: CreateMermaidOptions): Result<KanbanValidDiagram, BuildError>
export function buildMermaid(kind: 'requirement', ops: RequirementMutationOp[], opts?: CreateMermaidOptions): Result<RequirementValidDiagram, BuildError>
export function buildMermaid(kind: 'treemap', ops: TreemapMutationOp[], opts?: CreateMermaidOptions): Result<TreemapValidDiagram, BuildError>
export function buildMermaid(kind: 'zenuml', ops: ZenUMLMutationOp[], opts?: CreateMermaidOptions): Result<ZenUMLValidDiagram, BuildError>
export function buildMermaid(kind: 'eventmodeling', ops: EventModelingMutationOp[], opts?: CreateMermaidOptions): Result<EventModelingValidDiagram, BuildError>
export function buildMermaid(kind: 'ishikawa', ops: IshikawaMutationOp[], opts?: CreateMermaidOptions): Result<IshikawaValidDiagram, BuildError>
export function buildMermaid(kind: 'block', ops: BlockMutationOp[], opts?: CreateMermaidOptions): Result<BlockValidDiagram, BuildError>
export function buildMermaid(kind: DiagramKind, ops: AnyMutationOp[], opts?: CreateMermaidOptions): Result<MutableValidDiagram, BuildError>
export function buildMermaid(kind: DiagramKind, ops: AnyMutationOp[], opts: CreateMermaidOptions = {}): Result<MutableValidDiagram, BuildError> {
  const d = createMermaid(kind, opts)
  return applyMutationBatch(d, ops) as Result<MutableValidDiagram, BuildError>
}
