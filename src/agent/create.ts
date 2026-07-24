// ============================================================================
// createMermaid / buildMermaid: blank-slate authoring through the typed
// surface. Editing an existing diagram already goes parse → narrow → mutate;
// creating one previously meant hand-writing Mermaid source — the fragile
// path the typed ops exist to replace. createMermaid returns an empty
// structured diagram for any built-in family; buildMermaid folds a mutation
// list over that empty diagram so a whole new diagram is one typed call.
// ============================================================================

import type { Direction } from '../types.ts'
import { mutate } from './mutate.ts'
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
export function createMermaid(kind: 'sankey', opts?: CreateMermaidOptions): SankeyValidDiagram
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
export function buildMermaid(kind: 'sankey', ops: SankeyMutationOp[], opts?: CreateMermaidOptions): Result<SankeyValidDiagram, BuildError>
export function buildMermaid(kind: DiagramKind, ops: AnyMutationOp[], opts?: CreateMermaidOptions): Result<MutableValidDiagram, BuildError>
export function buildMermaid(kind: DiagramKind, ops: AnyMutationOp[], opts: CreateMermaidOptions = {}): Result<MutableValidDiagram, BuildError> {
  let d = createMermaid(kind, opts)
  for (let i = 0; i < ops.length; i++) {
    const r = mutate(d, ops[i]!)
    if (!r.ok) return err({ ...r.error, opIndex: i, message: `op[${i}] (${ops[i]!.kind}): ${r.error.message}` })
    d = r.value
  }
  return ok(d)
}
