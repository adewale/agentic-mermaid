// ============================================================================
// mutate: typed structural edits. Overloaded by family.
// ============================================================================

import type {
  FlowchartValidDiagram, StateValidDiagram, SequenceValidDiagram, TimelineValidDiagram,
  ClassValidDiagram, ErValidDiagram, JourneyValidDiagram, ArchitectureValidDiagram, XyChartValidDiagram, PieValidDiagram, QuadrantValidDiagram, GanttValidDiagram, RadarValidDiagram, MutableValidDiagram,
  ParsedDiagram,
  FlowchartMutationOp, StateMutationOp, SequenceMutationOp, TimelineMutationOp,
  ClassMutationOp, ErMutationOp, JourneyMutationOp, ArchitectureMutationOp, XyChartMutationOp, PieMutationOp, QuadrantMutationOp, GanttMutationOp, RadarMutationOp, AnyMutationOp,
  MutationError, Result,
} from './types.ts'
import { ok, err } from './types.ts'
import { wrapperPrefix } from './serialize.ts'
import { logToolInvocation } from './trace-log.ts'
import { getFamily } from './families.ts'
import { admitOpRecord, validateOp, hasOpSchema } from './op-schema.ts'
import { accessibilityFromBody, ensureAccessibilityLines } from './accessibility-envelope.ts'
import { parseRegisteredMermaid as parseMermaid } from './parse.ts'

export function mutate(d: FlowchartValidDiagram, op: FlowchartMutationOp): Result<FlowchartValidDiagram, MutationError>
export function mutate(d: StateValidDiagram, op: StateMutationOp): Result<StateValidDiagram, MutationError>
export function mutate(d: SequenceValidDiagram, op: SequenceMutationOp): Result<SequenceValidDiagram, MutationError>
export function mutate(d: TimelineValidDiagram, op: TimelineMutationOp): Result<TimelineValidDiagram, MutationError>
export function mutate(d: ClassValidDiagram, op: ClassMutationOp): Result<ClassValidDiagram, MutationError>
export function mutate(d: ErValidDiagram, op: ErMutationOp): Result<ErValidDiagram, MutationError>
export function mutate(d: JourneyValidDiagram, op: JourneyMutationOp): Result<JourneyValidDiagram, MutationError>
export function mutate(d: ArchitectureValidDiagram, op: ArchitectureMutationOp): Result<ArchitectureValidDiagram, MutationError>
export function mutate(d: XyChartValidDiagram, op: XyChartMutationOp): Result<XyChartValidDiagram, MutationError>
export function mutate(d: PieValidDiagram, op: PieMutationOp): Result<PieValidDiagram, MutationError>
export function mutate(d: QuadrantValidDiagram, op: QuadrantMutationOp): Result<QuadrantValidDiagram, MutationError>
export function mutate(d: GanttValidDiagram, op: GanttMutationOp): Result<GanttValidDiagram, MutationError>
export function mutate(d: RadarValidDiagram, op: RadarMutationOp): Result<RadarValidDiagram, MutationError>
// General form for callers holding the union (e.g. the CLI): dispatch is by
// registry at runtime either way, so kind-agnostic call sites don't need a
// per-family narrowing cascade.
export function mutate(d: MutableValidDiagram, op: AnyMutationOp): Result<MutableValidDiagram, MutationError>
export function mutate(d: ParsedDiagram, op: AnyMutationOp): Result<ParsedDiagram, MutationError>
export function mutate(
  d: ParsedDiagram,
  op: AnyMutationOp,
): Result<ParsedDiagram, MutationError> {
  // Log the OUTCOME (not just the call): an `{ok:false}` trace line records a
  // failed op attempt — the observable signal the agent-usage eval reads to
  // measure a run's op-error rate directly, rather than inferring retries from
  // excess mutate-call counts.
  const r = applyOneMutation(d, op)
  logToolInvocation('mutate', r.ok)
  return r
}

function applyOneMutation(
  d: ParsedDiagram,
  op: AnyMutationOp,
): Result<ParsedDiagram, MutationError> {
  // Every structured family mutates through its FamilyDescriptor hook, then
  // rebuilds canonicalSource from the new body so a mutated diagram never
  // carries stale source. Lookup is by DIAGRAM kind, not body kind. State
  // diagrams (BUILD-19) own a dedicated StateBody and bind the stateDiagram-v2
  // header through their own descriptor registration.
  if (d.body.kind === 'preserved') {
    return err({
      code: d.body.diagnostic.code === 'UNKNOWN_HEADER' ? 'UNKNOWN_HEADER' : 'UNSUPPORTED_FAMILY',
      message: `${d.body.diagnostic.message}; the exact source remains preserved and cannot accept structured mutation`,
    })
  }
  if (d.body.kind === 'extension') {
    return err({
      code: 'INVALID_OP',
      message: `Registered external family "${d.kind}" has no typed mutation contract in FamilyDescriptor v2`,
    })
  }
  const plugin = getFamily(d.kind)
  if (plugin?.mutate && plugin.serialize) {
    const r = plugin.mutate(d.body, op)
    if (!r.ok) return r
    // 1C wrapper policy: a mutated diagram keeps its leading wrapper
    // (frontmatter/directives/comments) byte-verbatim; only the body changes.
    const bodyAccessibility = accessibilityFromBody(r.value)
    const meta = bodyAccessibility === undefined
      ? d.meta
      : { ...d.meta, accessibility: bodyAccessibility }
    const canonicalSource = wrapperPrefix(meta) + ensureAccessibilityLines(
      plugin.serialize(r.value),
      meta.accessibility,
    )
    // Source locations and exact authored spans describe a particular source
    // artifact. Rebuild them from the mutated serialization; retaining the
    // pre-mutation map leaves removed objects addressable and is worse than no
    // provenance at all.
    const reparsed = parseMermaid(canonicalSource)
    if (!reparsed.ok) {
      return err({
        code: 'INVALID_OP',
        message: `Mutation produced source that could not be reparsed: ${reparsed.error.map(error => error.message).join('; ')}`,
      })
    }
    const sameFamily = reparsed.value.kind === d.kind
    const sameRepresentation = reparsed.value.body.kind === r.value.kind
    // Blank-slate builders deliberately admit a narrow intermediate state:
    // the typed body may remain structured while it is still below the
    // family's source grammar floor (for example, an XY title before its first
    // series). Keep that exception family-owned and structural. A descriptor
    // must identify the candidate as EMPTY_DIAGRAM; every non-empty mutation
    // must close back through the shared parser to the same representation.
    const verifiedEmptyScaffold = !sameRepresentation
      && reparsed.value.body.kind === 'opaque'
      && plugin.verify?.(r.value, {}).some(warning => warning.code === 'EMPTY_DIAGRAM') === true
    if (!sameFamily || (!sameRepresentation && !verifiedEmptyScaffold)) {
      return err({
        code: 'INVALID_OP',
        message: `Mutation changed semantic family while reparsing: expected ${d.kind}/${r.value.kind}, got ${reparsed.value.kind}/${reparsed.value.body.kind}`,
      })
    }
    return ok({ ...d, body: r.value, meta, canonicalSource, source: reparsed.value.source } as ParsedDiagram)
  }
  return err({ code: 'INVALID_OP', message: `Unsupported mutable diagram kind: ${d.kind}` })
}

/**
 * mutate with a shape check in front — the one choke point every UNTYPED edit
 * path funnels through: the declarative applyOps/buildChecked entrypoints, the
 * Code Mode facade, and the CLI `--op`/`--ops` path. Typed callers keep using
 * `mutate` directly, where the compiler already guarantees op shape;
 * `mutateChecked` restores that guarantee at the boundaries where ops arrive as
 * raw JSON.
 *
 * `validateOp` proves the op's SHAPE (field names, primitive types, enums)
 * BEFORE the mutator runs, so a malformed op is rejected with a prescriptive
 * INVALID_OP error instead of silently mangling the diagram. Semantics — does
 * the referenced node exist, is the id a duplicate — stay in the mutator, which
 * runs second on a shape-proven op. Result shape is identical to `mutate`, so
 * this is a drop-in wherever the raw mutator was called with untyped ops.
 */
export function mutateChecked(d: MutableValidDiagram, op: unknown): Result<MutableValidDiagram, MutationError>
export function mutateChecked(d: ParsedDiagram, op: unknown): Result<ParsedDiagram, MutationError>
export function mutateChecked(d: ParsedDiagram, op: unknown): Result<ParsedDiagram, MutationError> {
  if (hasOpSchema(d.kind)) {
    const admitted = admitOpRecord(op)
    const checkedOp = admitted.ok ? admitted.value : op
    const invalid = validateOp(d.kind, checkedOp)
    // A shape rejection short-circuits before `mutate`, so record the failed
    // attempt here — otherwise checked-path errors (e.g. the op-array slip)
    // would go uncounted in the op-error rate.
    if (invalid) { logToolInvocation('mutate', false); return err(invalid) }
    return mutate(d, checkedOp as AnyMutationOp)
  }
  return mutate(d, op as AnyMutationOp)
}

// Flowchart graph mutation + helpers live in flowchart-body.ts; edgeIdOf is
// re-exported here for existing consumers (agent/index.ts, eval harness).
export { edgeIdOf } from './flowchart-body.ts'
