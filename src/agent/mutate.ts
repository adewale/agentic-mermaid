// ============================================================================
// mutate: typed structural edits. Overloaded by family.
// ============================================================================

import type {
  FlowchartValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram, JourneyValidDiagram, MutableValidDiagram,
  FlowchartMutationOp, SequenceMutationOp, TimelineMutationOp,
  ClassMutationOp, ErMutationOp, JourneyMutationOp, AnyMutationOp,
  MutationError, Result,
} from './types.ts'
import { ok, err } from './types.ts'
import { renderMeta } from './serialize.ts'
import { getFamily } from './families.ts'
import './families-builtin.ts'  // registers built-in family mutate hooks

export function mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
export function mutate(d: SequenceValidDiagram, op: SequenceMutationOp): Result<SequenceValidDiagram, MutationError>
export function mutate(d: TimelineValidDiagram, op: TimelineMutationOp): Result<TimelineValidDiagram, MutationError>
export function mutate(d: ClassValidDiagram, op: ClassMutationOp): Result<ClassValidDiagram, MutationError>
export function mutate(d: ErValidDiagram, op: ErMutationOp): Result<ErValidDiagram, MutationError>
export function mutate(d: JourneyValidDiagram, op: JourneyMutationOp): Result<JourneyValidDiagram, MutationError>
export function mutate(
  d: MutableValidDiagram,
  op: AnyMutationOp,
): Result<MutableValidDiagram, MutationError> {
  // Every structured family mutates through its FamilyPlugin hook, then
  // rebuilds canonicalSource from the new body so a mutated diagram never
  // carries stale source. Lookup is by DIAGRAM kind, not body kind: state
  // diagrams share the flowchart body but bind the stateDiagram-v2 header
  // through their own plugin registration.
  const plugin = getFamily(d.kind)
  if (plugin?.mutate && plugin.serialize) {
    const r = plugin.mutate(d.body, op)
    if (!r.ok) return r
    const canonicalSource = renderMeta(d.meta) + plugin.serialize(r.value)
    return ok({ ...d, body: r.value, canonicalSource } as MutableValidDiagram)
  }
  return err({ code: 'INVALID_OP', message: `Unsupported mutable diagram kind: ${d.kind}` })
}

// Flowchart graph mutation + helpers live in flowchart-body.ts; edgeIdOf is
// re-exported here for existing consumers (agent/index.ts, eval harness).
export { edgeIdOf } from './flowchart-body.ts'
