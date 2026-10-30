import { withBodyTitleMeta } from './body-title-meta.ts'
import { eventModelingMeta } from '../eventmodeling/body.ts'
import type { EventModelingValidDiagram, EventModelingMutationOp } from './types.ts'
import { rebaseBodyComments, restoreBodyComments, snapshotBodyCommentAnchors } from './body-comments.ts'
import { beginMutationDraft, type MutationDraft } from './mutation-draft.ts'
import type { PacketMutationOp, PacketValidDiagram, KanbanMutationOp, KanbanValidDiagram, RequirementMutationOp, RequirementValidDiagram, TreemapMutationOp, TreemapValidDiagram, IshikawaMutationOp, IshikawaValidDiagram, BlockMutationOp, BlockValidDiagram } from './types.ts'
import type { C4MutationOp, C4ValidDiagram } from './types.ts'
// ============================================================================
// mutate: typed structural edits. Overloaded by family.
// ============================================================================

import type {
  FlowchartValidDiagram,
  StateValidDiagram,
  SequenceValidDiagram,
  TimelineValidDiagram,
  ClassValidDiagram,
  ErValidDiagram,
  JourneyValidDiagram,
  ArchitectureValidDiagram,
  XyChartValidDiagram,
  PieValidDiagram,
  QuadrantValidDiagram,
  GanttValidDiagram,
  RadarValidDiagram,
  SankeyValidDiagram,
  MutableValidDiagram,
  ParsedDiagram,
  FlowchartMutationOp,
  StateMutationOp,
  SequenceMutationOp,
  TimelineMutationOp,
  ClassMutationOp,
  ErMutationOp,
  JourneyMutationOp,
  ArchitectureMutationOp,
  XyChartMutationOp,
  PieMutationOp,
  QuadrantMutationOp,
  GanttMutationOp,
  RadarMutationOp,
  SankeyMutationOp,
  AnyMutationOp,
  MutationError,
  Result,
} from './types.ts'
import { ok, err } from './types.ts'
import { wrapperPrefix } from './serialize.ts'
import { logToolInvocation } from './trace-log.ts'
import { getFamily } from './families.ts'
import { admitOpRecord, validateOp, hasOpSchema } from './op-schema.ts'
import { AccessibilityTextError, accessibilityFromBody, ensureAccessibilityLines, normalizeBodyAccessibility } from './accessibility-envelope.ts'
import { parseRegisteredMermaid as parseMermaid } from './parse.ts'
import { applySourceEdits, sameSourceMeaning } from './source-mutation.ts'
import { serializationDrift } from './serialization-closure.ts'

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
export function mutate(d: C4ValidDiagram, op: C4MutationOp): Result<C4ValidDiagram, MutationError>
export function mutate(d: SankeyValidDiagram, op: SankeyMutationOp): Result<SankeyValidDiagram, MutationError>
export function mutate(d: PacketValidDiagram, op: PacketMutationOp): Result<PacketValidDiagram, MutationError>
export function mutate(d: KanbanValidDiagram, op: KanbanMutationOp): Result<KanbanValidDiagram, MutationError>
export function mutate(d: RequirementValidDiagram, op: RequirementMutationOp): Result<RequirementValidDiagram, MutationError>
export function mutate(d: TreemapValidDiagram, op: TreemapMutationOp): Result<TreemapValidDiagram, MutationError>
export function mutate(d: EventModelingValidDiagram, op: EventModelingMutationOp): Result<EventModelingValidDiagram, MutationError>
export function mutate(d: IshikawaValidDiagram, op: IshikawaMutationOp): Result<IshikawaValidDiagram, MutationError>
export function mutate(d: BlockValidDiagram, op: BlockMutationOp): Result<BlockValidDiagram, MutationError>
// General form for callers holding the union (e.g. the CLI): dispatch is by
// registry at runtime either way, so kind-agnostic call sites don't need a
// per-family narrowing cascade.
export function mutate(d: MutableValidDiagram, op: AnyMutationOp): Result<MutableValidDiagram, MutationError>
export function mutate(d: ParsedDiagram, op: AnyMutationOp): Result<ParsedDiagram, MutationError>
export function mutate(d: ParsedDiagram, op: AnyMutationOp): Result<ParsedDiagram, MutationError> {
  // Log the OUTCOME (not just the call): an `{ok:false}` trace line records a
  // failed op attempt — the observable signal the agent-usage eval reads to
  // measure a run's op-error rate directly, rather than inferring retries from
  // excess mutate-call counts.
  const r = applyOneMutation(d, op)
  logToolInvocation('mutate', r.ok)
  return r
}

interface BatchDraft {
  mutator?: NonNullable<ReturnType<typeof getFamily>>['mutate']
  body?: ParsedDiagram['body']
  apply?: MutationDraft
}

function applyOneMutation(d: ParsedDiagram, op: AnyMutationOp, deferSerialization = false, draft?: BatchDraft): Result<ParsedDiagram, MutationError> {
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
    if (draft && (draft.mutator !== plugin.mutate || draft.body !== d.body)) {
      draft.mutator = plugin.mutate
      draft.body = d.body
      draft.apply = beginMutationDraft(plugin.mutate, d.body)
    }
    const before = draft?.apply ? snapshotBodyCommentAnchors(d) : d
    const r = draft?.apply ? draft.apply(op) : plugin.mutate(d.body, op)
    if (!r.ok) return r
    try {
      r.value = normalizeBodyAccessibility(r.value)
    } catch (error) {
      if (!(error instanceof AccessibilityTextError)) throw error
      return err({ code: 'INVALID_OP', message: error.message })
    }
    if (draft) draft.body = r.value
    d = rebaseBodyComments(before, r.value, op)
    return deferSerialization ? ok({ ...d, body: r.value } as ParsedDiagram) : commitMutation(d, r.value)
  }

  return err({ code: 'INVALID_OP', message: `Unsupported mutable diagram kind: ${d.kind}` })
}

/** Commit one private transaction: serialize, rebuild spans, and check parser closure once. */
function commitMutation(d: ParsedDiagram, body: ParsedDiagram['body']): Result<ParsedDiagram, MutationError> {
  if (body.kind === 'preserved' || body.kind === 'extension') return err({ code: 'INVALID_OP', message: 'This source has no typed mutation contract' })
  const plugin = getFamily(d.kind)!
  // 1C wrapper policy: a mutated diagram keeps its leading wrapper
  // (frontmatter/directives/comments) byte-verbatim; only the body changes.
  const bodyAccessibility = accessibilityFromBody(body)
  const accessibilityMeta = bodyAccessibility === undefined ? d.meta : { ...d.meta, accessibility: bodyAccessibility }
  let meta = accessibilityMeta
  try {
    if (body.kind === 'eventmodeling') meta = eventModelingMeta(body, accessibilityMeta)
    if (body.kind === 'zenuml') meta = withBodyTitleMeta(body.title, accessibilityMeta, d.body.kind === 'zenuml' && body.title === d.body.title)
    if (body.kind === 'class') meta = withBodyTitleMeta(body.title, accessibilityMeta, d.body.kind === 'class' && body.title === d.body.title)
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
  const bodySource = restoreBodyComments(ensureAccessibilityLines(plugin.serialize!(body, meta), meta.accessibility), d.kind, body, meta)
  const canonicalSource = wrapperPrefix(meta, 'verbatim', bodySource, d.kind) + bodySource
  // Source locations, exact authored spans, and wrapper ownership describe a
  // particular source artifact. Rebuild all three from the mutated
  // serialization; retaining pre-mutation metadata can make wrapperSource
  // disagree with the source map after a body-authored directive is moved.
  const reparsed = parseMermaid(canonicalSource)
  if (!reparsed.ok) {
    return err({
      code: 'INVALID_OP',
      message: `Mutation produced source that could not be reparsed: ${reparsed.error.map(error => error.message).join('; ')}`,
    })
  }
  const sameFamily = reparsed.value.kind === d.kind
  const sameRepresentation = reparsed.value.body.kind === body.kind
  // Blank-slate builders deliberately admit a narrow intermediate state:
  // the typed body may remain structured while it is still below the
  // family's source grammar floor (for example, a Sankey diagram before its
  // first link, which Mermaid rejects). Keep that exception family-owned and structural. A descriptor
  // must identify the candidate as EMPTY_DIAGRAM; every non-empty mutation
  // must close back through the shared parser to the same representation.
  const verifiedEmptyScaffold = !sameRepresentation && reparsed.value.body.kind === 'opaque' && plugin.verify?.(body, {}).some(warning => warning.code === 'EMPTY_DIAGRAM') === true
  if (!sameFamily || (!sameRepresentation && !verifiedEmptyScaffold)) {
    return err({
      code: 'INVALID_OP',
      message: `Mutation changed semantic family while reparsing: expected ${d.kind}/${body.kind}, got ${reparsed.value.kind}/${reparsed.value.body.kind}`,
    })
  }
  if (bodyAccessibility && (bodyAccessibility.title !== reparsed.value.meta.accessibility.title || bodyAccessibility.descr !== reparsed.value.meta.accessibility.descr)) {
    return err({
      code: 'INVALID_OP',
      message: 'Accessibility text cannot be serialized by this family without changing its value; remove directive openers or description block delimiters',
    })
  }
  // The same representation is not the same meaning: a value the writer
  // cannot hold (a `%%` comment, a statement separator, an id that reads as
  // shape syntax) parses back as different content. Refuse it, naming what
  // would change, instead of publishing a silently altered diagram.
  const drift = sameRepresentation ? serializationDrift({ ...d, meta, body } as ParsedDiagram, reparsed.value) : undefined
  if (drift) return err({ code: 'INVALID_OP', message: `The edit cannot be written faithfully: ${drift}` })
  return ok({
    ...d,
    body,
    meta: {
      ...reparsed.value.meta,
      // This receipt describes loss from the originally parsed artifact.
      // Reparsing the already-canonical mutation output cannot rediscover a
      // comment that structured serialization intentionally omitted.
      ...(d.meta.droppedComments ? { droppedComments: d.meta.droppedComments } : {}),
    },
    canonicalSource,
    source: reparsed.value.source,
  } as ParsedDiagram)
}

export type MutationBatchError = MutationError & { opIndex: number }

/** Intermediate bodies stay private; public source/maps are rebuilt only at commit. */
export function applyMutationBatch(d: ParsedDiagram, ops: readonly unknown[]): Result<ParsedDiagram, MutationBatchError> {
  let current = d
  const draft: BatchDraft = {}
  for (let index = 0; index < ops.length; index++) {
    const next = checkedMutation(current, ops[index], true, draft)
    if (!next.ok) return err({ ...next.error, opIndex: index })
    current = next.value
  }
  if (!ops.length) return ok(d)
  const committed = commitMutation(current, current.body)
  return committed.ok ? committed : err({ ...committed.error, opIndex: ops.length - 1 })
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
  return checkedMutation(d, op, false)
}

export interface SourceMutationResult {
  /** Save these exact bytes. Unsupported syntax remains source-preserved;
   * this artifact is not promised to be portable Mermaid. */
  readonly source: string
  readonly diagram: ParsedDiagram
}

/** Explicit source-level edits for opaque bodies. Family hooks admit only
 * operations whose complete native read-back changes by the requested delta.
 * Ordinary mutate, checked batches and canonical writers retain their contracts. */
export function mutatePreservingSource(d: ParsedDiagram, op: unknown): Result<SourceMutationResult, MutationError> {
  const result = editPreservedSource(d, op)
  logToolInvocation('mutate', result.ok)
  return result
}

function editPreservedSource(d: ParsedDiagram, op: unknown): Result<SourceMutationResult, MutationError> {
  if (d.body.kind !== 'opaque' || d.body.family !== d.kind) return err({ code: 'INVALID_OP', message: 'Source-preserving mutation requires an opaque body of its parsed family; use mutate for structured bodies' })
  const plugin = getFamily(d.kind)
  if (!plugin?.mutateSource || !hasOpSchema(d.kind)) return err({ code: 'UNSUPPORTED_FAMILY', message: `${d.kind} has no source-preserving mutation contract` })
  const admitted = admitOpRecord(op)
  const invalid = validateOp(d.kind, admitted.ok ? admitted.value : op)
  if (invalid) return err(invalid)
  // The opaque body and captured wrapper own the original bytes. The ordinary
  // serializer may normalize the final newline, so it is not this authority.
  const source = (d.meta.wrapperSource ?? '') + d.body.source
  try {
    const next = plugin.mutateSource(source, (admitted.ok ? admitted.value : op) as AnyMutationOp)
    if (!next.ok) return next
    const editedSource = applySourceEdits(source, next.value)
    if (editedSource === source) return ok({ source, diagram: d })
    const parsed = parseMermaid(editedSource)
    if (!parsed.ok) return err({ code: 'INVALID_OP', message: `Source-preserving mutation could not be reparsed: ${parsed.error.map(error => error.message).join('; ')}` })
    if (parsed.value.kind !== d.kind || parsed.value.body.kind !== 'opaque') return err({ code: 'INVALID_OP', message: 'Source-preserving mutation changed family or source-preserved representation' })
    // Source coordinates are rebuilt after a removal or rename. Comment text
    // and order remain meaning; their old physical row numbers do not.
    const metadata = (value: ParsedDiagram['meta']) => ({ ...value, comments: value.comments.map(comment => comment.text) })
    if (!sameSourceMeaning(metadata(d.meta), metadata(parsed.value.meta))) return err({ code: 'INVALID_OP', message: 'Source-preserving mutation changed configuration, accessibility or comment metadata' })
    return ok({ source: editedSource, diagram: parsed.value })
  } catch (error) {
    return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) })
  }
}

function checkedMutation(d: ParsedDiagram, op: unknown, deferSerialization: boolean, draft?: BatchDraft): Result<ParsedDiagram, MutationError> {
  if (hasOpSchema(d.kind)) {
    const admitted = admitOpRecord(op)
    const checkedOp = admitted.ok ? admitted.value : op
    const invalid = validateOp(d.kind, checkedOp)
    // A shape rejection short-circuits before `mutate`, so record the failed
    // attempt here — otherwise checked-path errors (e.g. the op-array slip)
    // would go uncounted in the op-error rate.
    if (invalid) {
      logToolInvocation('mutate', false)
      return err(invalid)
    }
    const result = applyOneMutation(d, checkedOp as AnyMutationOp, deferSerialization, draft)
    logToolInvocation('mutate', result.ok)
    return result
  }
  const result = applyOneMutation(d, op as AnyMutationOp, deferSerialization, draft)
  logToolInvocation('mutate', result.ok)
  return result
}

// Flowchart graph mutation + helpers live in flowchart-body.ts; edgeIdOf is
// re-exported here for existing consumers (agent/index.ts, eval harness).
export { edgeIdOf } from './flowchart-body.ts'
