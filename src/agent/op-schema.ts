// ============================================================================
// op-schema: shape validation for every family's structured mutation ops.
//
// The typed `mutate` surface is guaranteed by the compiler — but the MCP and
// CLI boundaries hand it ops as untyped JSON, where those guarantees evaporate:
// a model that writes `{kind:'add_class', name:'Duck'}` (using `name` where
// `id` is expected) slips a shapeless object past the type system, and the
// mutator silently produces `class undefined`. This layer restores the missing
// check at the one place untyped ops arrive: it validates op SHAPE (field
// presence, primitive type, enum membership) BEFORE the mutator runs, and
// rejects a malformed op with a PRESCRIPTIVE INVALID_OP error that names the
// offending field and lists the valid ones (with a nearest-match suggestion
// for an obvious typo).
//
// Scope: shape only. Semantic checks — does the referenced class exist, is the
// id already taken, is the index in range — stay in the existing mutators. The
// two layers compose: shape first (here), semantics second (the mutator). The
// field lists below are transcribed from the *MutationOp union types in
// types.ts, so a valid typed op always passes; the whole unit suite exercising
// the mutators through the checked core is the proof (see apply.ts).
// ============================================================================

import type { NodeShape, EdgeStyle } from '../types.ts'
import { flowchartV11ShapeNames } from '../flowchart-shapes.ts'
import type {
  SequenceMessageStyle, ClassRelationKind, ErCardinality, ArchitectureSide, ArchitectureEndpointBoundary, GanttBodyTaskTag,
} from './types.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import type { MutableFamilyId } from './mutation-ops.ts'

export type OpFamily = MutableFamilyId

/** Primitive kinds a field may hold. `enum` carries an explicit value list;
 *  `nullable` lets an enum/primitive also accept `null` (e.g. set_task_status). */
type FieldType =
  | { type: 'string' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'string-or-null' }
  | { type: 'enum'; values: readonly string[]; nullable?: boolean }
  | { type: 'string-array' }
  | { type: 'number-array' }
  | { type: 'object-or-null' } // a nested record (deep shape validated by the mutator)

/** A field type plus its required flag. Intersection (not `extends`) because
 *  FieldType is a union — an interface cannot extend a union. */
type FieldSpec = FieldType & {
  /** required = must be present and non-undefined. Optional fields may be omitted. */
  required: boolean
  /** Optional human note surfaced in discovery: a value constraint the MUTATOR
   *  (not this shape layer) enforces (e.g. "1..5"), or the default applied when
   *  an optional field is omitted (e.g. "default: rectangle"). Descriptive only
   *  — the mutator remains the single enforcement point. */
  note?: string
}

interface OpSpec {
  /** field-name -> spec. `kind` is implicit and never listed. */
  fields: Record<string, FieldSpec>
  /** Optional cross-field rule: at least one of these must be present (e.g.
   *  architecture remove_edge accepts `index` OR `id`). */
  requireOneOf?: readonly string[]
}

// Enum value lists, kept in sync with the type aliases they mirror.
const NODE_SHAPES: readonly NodeShape[] = [
  'rectangle', 'service', 'rounded', 'diamond', 'stadium', 'circle', 'subroutine',
  'doublecircle', 'hexagon', 'cylinder', 'asymmetric', 'trapezoid', 'trapezoid-alt',
  'lean-r', 'lean-l', 'state-start', 'state-end',
]
const EDGE_STYLES: readonly EdgeStyle[] = ['solid', 'dotted', 'thick', 'invisible']
const SEQUENCE_MESSAGE_STYLES: readonly SequenceMessageStyle[] = ['sync', 'reply', 'async', 'async-dashed', 'lost', 'lost-dashed']
const PARTICIPANT_KINDS = ['participant', 'actor'] as const
const CLASS_REL_KINDS: readonly ClassRelationKind[] = ['inheritance', 'composition', 'aggregation', 'association', 'dependency', 'realization', 'link-solid', 'link-dashed']
const ER_CARDINALITIES: readonly ErCardinality[] = ['one-only', 'zero-or-one', 'zero-or-many', 'one-or-many']
const ARCH_SIDES: readonly ArchitectureSide[] = ['L', 'R', 'T', 'B']
const ARCH_BOUNDARIES: readonly ArchitectureEndpointBoundary[] = ['item', 'group']
const SERIES_KINDS = ['bar', 'line'] as const
const AXIS_KINDS = ['x', 'y'] as const
const GANTT_STATUSES = ['active', 'done', 'crit'] as const
const MINDMAP_SHAPES = ['default', 'rect', 'rounded', 'circle', 'cloud', 'bang', 'hexagon'] as const
const GIT_COMMIT_TYPES = ['NORMAL', 'REVERSE', 'HIGHLIGHT'] as const
const _GANTT_TAGS: readonly GanttBodyTaskTag[] = ['active', 'done', 'crit', 'milestone', 'vert'] // tags are shape-checked as string[]; deep enum check stays in the mutator

// Field-spec shorthands.
const str = (required = true): FieldSpec => ({ type: 'string', required })
const num = (required = true): FieldSpec => ({ type: 'number', required })
const bool = (required = true): FieldSpec => ({ type: 'boolean', required })
const strOrNull = (required = true): FieldSpec => ({ type: 'string-or-null', required })
const strArr = (required = true): FieldSpec => ({ type: 'string-array', required })
const numArr = (required = true): FieldSpec => ({ type: 'number-array', required })
const objOrNull = (required = true): FieldSpec => ({ type: 'object-or-null', required })
const oneOf = (values: readonly string[], required = true, nullable = false): FieldSpec => ({ type: 'enum', values, nullable, required })
/** Attach a discovery note (mutator-enforced constraint or omit-default) to a
 *  field spec without changing its shape validation. */
const withNote = (spec: FieldSpec, note: string): FieldSpec => ({ ...spec, note })

// ---- Per-op schemas (transcribed from the *MutationOp unions in types.ts) ---

// set_shape/add_node accept the geometry names PLUS every documented Mermaid
// v11 @{ shape } short name and alias — one vocabulary, sourced from the
// normalization table (src/flowchart-shapes.ts).
const FLOWCHART_SHAPE_VALUES: readonly string[] = [
  ...NODE_SHAPES,
  ...flowchartV11ShapeNames().filter(name => !(NODE_SHAPES as readonly string[]).includes(name)),
]
const FLOWCHART_DIRECTIONS = ['TD', 'TB', 'LR', 'BT', 'RL'] as const

const FLOWCHART_SCHEMA: Record<string, OpSpec> = {
  add_node:    { fields: { id: str(), label: str(), shape: withNote(oneOf(FLOWCHART_SHAPE_VALUES, false), 'default: rectangle; also accepts Mermaid v11 @{ shape } names/aliases (e.g. manual-input)'), parent: str(false) } },
  remove_node: { fields: { id: str() } },
  rename_node: { fields: { from: str(), to: str() } },
  set_label:   { fields: { target: withNote(str(), 'a node id, an authored edge ID (e1), or "from->to"/"from->to#k"'), label: str() } },
  add_edge:    { fields: { from: str(), to: str(), label: str(false), style: withNote(oneOf(EDGE_STYLES, false), 'default: solid') } },
  remove_edge: { fields: { id: withNote(str(), 'an authored edge ID (e1), or "from->to"/"from->to#k" for the k-th parallel edge') } },
  set_shape:   { fields: { id: str(), shape: withNote(oneOf(FLOWCHART_SHAPE_VALUES), 'a geometry name or a Mermaid v11 @{ shape } name/alias; v11 names render with the documented geometry mapping and serialize with the authored spelling') } },
  set_direction: { fields: { direction: oneOf(FLOWCHART_DIRECTIONS), subgraph: withNote(str(false), 'omit to set the diagram direction; a subgraph id sets that subgraph\'s direction override') } },
  add_subgraph: { fields: { id: str(), label: str(false), parent: withNote(str(false), 'nest inside this subgraph'), members: withNote(strArr(false), 'existing node ids MOVED into the new subgraph') } },
  remove_subgraph: { fields: { id: str(), removeMembers: withNote(bool(false), 'default false: dissolve — members move to the parent scope; true also removes member nodes and their edges') } },
  move_node:   { fields: { id: str(), subgraph: withNote(strOrNull(), 'target subgraph id; null moves the node to the top level') } },
  define_class: { fields: { name: str(), style: withNote(str(), 'CSS-like pairs, e.g. "fill:#f96,stroke:#333,stroke-width:2px"') } },
  set_node_class: { fields: { id: str(), className: withNote(strOrNull(), 'assigns a classDef name (define_class or source classDef); null removes the assignment') } },
  set_node_style: { fields: { id: str(), style: withNote(strOrNull(), 'inline style pairs, e.g. "fill:#bbf"; null clears') } },
}

const STATE_DIRECTIONS = ['TD', 'TB', 'LR', 'BT', 'RL'] as const
const STATE_NOTE_SIDES = ['left', 'right'] as const

const STATE_SCHEMA: Record<string, OpSpec> = {
  add_state:            { fields: { id: str(), label: strOrNull(false), parent: strOrNull(false), region: num(false) } },
  remove_state:         { fields: { id: str(), recursive: withNote(bool(false), 'default false: refuse a non-empty composite; true removes the whole subtree (transitions + notes cascade)') } },
  rename_state:         { fields: { from: str(), to: str() } },
  set_state_label:      { fields: { id: str(), label: strOrNull() } },
  add_transition:       { fields: { from: withNote(str(), 'a state id, "[*]", or a history ref like "X[H]"'), to: withNote(str(), 'a state id, "[*]", or a history ref like "X[H]"'), label: strOrNull(false), parent: strOrNull(false), region: num(false) } },
  remove_transition:    { fields: { index: num(false), from: str(false), to: str(false), parent: strOrNull(false), region: num(false) }, requireOneOf: ['index', 'from', 'to'] },
  set_transition_label: { fields: { index: num(false), from: str(false), to: str(false), label: strOrNull(), parent: strOrNull(false), region: num(false) }, requireOneOf: ['index', 'from', 'to'] },
  make_composite:       { fields: { id: str(), members: strArr(), label: strOrNull(false) } },
  set_direction:        { fields: { direction: oneOf(STATE_DIRECTIONS), state: withNote(strOrNull(false), 'omit to set the diagram direction; a composite id sets that composite\'s direction override') } },
  move_state:           { fields: { id: str(), parent: withNote(strOrNull(), 'target composite id; null moves the state to the top level'), region: num(false) } },
  dissolve_composite:   { fields: { id: withNote(str(), 'children and inner transitions hoist into the parent scope; rejects while transitions/notes still reference the composite') } },
  add_note:             { fields: { target: str(), side: withNote(oneOf(STATE_NOTE_SIDES, false), 'default: right'), text: withNote(str(), 'multi-line text serializes as a block note') } },
  remove_note:          { fields: { index: num() } },
  set_note_text:        { fields: { index: num(), text: str() } },
  define_class:         { fields: { name: str(), style: withNote(str(), 'CSS-like pairs, e.g. "fill:#f96,stroke:#333"') } },
  set_state_class:      { fields: { id: str(), className: strOrNull() } },
  set_state_style:      { fields: { id: str(), style: withNote(strOrNull(), 'inline style pairs; null clears') } },
  set_transition_style: { fields: { index: num(false), default: bool(false), style: strOrNull(), parent: strOrNull(false), region: num(false) }, requireOneOf: ['index', 'default'] },
}

const SEQUENCE_SCHEMA: Record<string, OpSpec> = {
  add_participant:  { fields: { id: str(), label: str(false), participantKind: oneOf(PARTICIPANT_KINDS, false) } },
  remove_participant: { fields: { id: str() } },
  add_message:      { fields: { from: str(), to: str(), text: str(), style: withNote(oneOf(SEQUENCE_MESSAGE_STYLES, false), 'default: sync'), index: withNote(num(false), 'top-level insert position; default: append') } },
  remove_message:   { fields: { index: num() } },
  set_message_text: { fields: { index: num(), text: str() } },
  move_message:     { fields: { from: withNote(num(), 'top-level message index'), to: withNote(num(), 'top-level target position') } },
  set_participant_label: { fields: { id: str(), label: str() } },
}

const TIMELINE_SCHEMA: Record<string, OpSpec> = {
  set_title:         { fields: { title: strOrNull() } },
  add_section:       { fields: { label: str(), index: withNote(num(false), 'insert position; omit to append') } },
  remove_section:    { fields: { index: num() } },
  set_section_label: { fields: { index: num(), label: str() } },
  add_period:        { fields: { sectionIndex: num(), label: str(), events: strArr(false), index: withNote(num(false), 'insert position; omit to append') } },
  remove_period:     { fields: { sectionIndex: num(), periodIndex: num() } },
  set_period_label:  { fields: { sectionIndex: num(), periodIndex: num(), label: str() } },
  add_event:         { fields: { sectionIndex: num(), periodIndex: num(), text: str(), index: withNote(num(false), 'insert position; omit to append') } },
  remove_event:      { fields: { sectionIndex: num(), periodIndex: num(), eventIndex: num() } },
  set_event_text:    { fields: { sectionIndex: num(), periodIndex: num(), eventIndex: num(), text: str() } },
  move_period:       { fields: { fromSection: num(), fromIndex: num(), toSection: num(), toIndex: withNote(num(), 'insert position in the target section, applied after removal') } },
  move_event:        { fields: { fromSection: num(), fromPeriod: num(), fromIndex: num(), toSection: num(), toPeriod: num(), toIndex: withNote(num(), 'insert position in the target period, applied after removal') } },
  move_section:      { fields: { from: num(), to: num() } },
  set_accessibility_title:       { fields: { title: strOrNull() } },
  set_accessibility_description: { fields: { description: strOrNull() } },
}

const CLASS_SCHEMA: Record<string, OpSpec> = {
  set_title:       { fields: { title: strOrNull() } },
  add_class:       { fields: { id: str(), label: str(false), generic: withNote(str(false), 'Mermaid generic parameter text without surrounding ~ delimiters'), members: strArr(false), namespace: withNote(str(false), 'dot path, e.g. "Platform.Auth"; declared on demand') } },
  remove_class:    { fields: { id: str() } },
  rename_class:    { fields: { from: str(), to: str() } },
  set_class_generic: { fields: { class: str(), generic: withNote(strOrNull(), 'parameter text without ~ delimiters; null removes it') } },
  add_member:      { fields: { class: str(), text: str() } },
  remove_member:   { fields: { class: str(), index: num() } },
  add_relation:    { fields: { from: str(), to: str(), relKind: oneOf(CLASS_REL_KINDS), label: str(false) } },
  remove_relation: { fields: { index: num() } },
  add_note:        { fields: { text: str(), for: str(false) } },
  remove_note:     { fields: { index: num() } },
  set_class_namespace: { fields: { class: str(), namespace: withNote(strOrNull(), 'dot path moves the class into that namespace (declared on demand); null moves it to the top level') } },
  define_class:     { fields: { name: str(), style: withNote(str(), 'CSS-like pairs, e.g. "fill:#f96,stroke:#333"') } },
  set_css_class:    { fields: { class: str(), className: strOrNull() } },
  set_class_style:  { fields: { class: str(), style: strOrNull() } },
}

const ER_SCHEMA: Record<string, OpSpec> = {
  add_entity:       { fields: { id: str(), label: str(false), attributes: strArr(false) } },
  remove_entity:    { fields: { id: str() } },
  rename_entity:    { fields: { from: str(), to: str() } },
  set_entity_label: { fields: { entity: str(), label: strOrNull() } },
  add_attribute:    { fields: { entity: str(), text: str() } },
  remove_attribute: { fields: { entity: str(), index: num() } },
  add_relation:     { fields: { from: str(), to: str(), leftCard: oneOf(ER_CARDINALITIES), rightCard: oneOf(ER_CARDINALITIES), dashed: bool(false), label: str(false) } },
  remove_relation:  { fields: { index: num() } },
  set_direction:    { fields: { direction: oneOf(STATE_DIRECTIONS) } },
  define_class:     { fields: { name: str(), style: str() } },
  set_entity_class: { fields: { entity: str(), className: strOrNull() } },
  set_entity_style: { fields: { entity: str(), style: strOrNull() } },
}

const JOURNEY_SCHEMA: Record<string, OpSpec> = {
  set_title:         { fields: { title: strOrNull() } },
  add_section:       { fields: { label: str(), index: withNote(num(false), 'insert position; omit to append') } },
  remove_section:    { fields: { index: num() } },
  set_section_label: { fields: { index: num(), label: str() } },
  add_task:          { fields: { sectionIndex: num(), text: str(), score: withNote(num(), 'integer 1..5'), actors: strArr(false), index: withNote(num(false), 'insert position; omit to append') } },
  remove_task:       { fields: { sectionIndex: num(), taskIndex: num() } },
  set_task_text:     { fields: { sectionIndex: num(), taskIndex: num(), text: str() } },
  set_task_score:    { fields: { sectionIndex: num(), taskIndex: num(), score: withNote(num(), 'integer 1..5') } },
  set_task_actors:   { fields: { sectionIndex: num(), taskIndex: num(), actors: strArr() } },
  rename_actor:      { fields: { from: str(), to: str() } },
  move_task:         { fields: { fromSection: num(), fromIndex: num(), toSection: num(), toIndex: withNote(num(), 'insert position in the target section, applied after removal') } },
  move_section:      { fields: { from: num(), to: num() } },
  set_accessibility_title:       { fields: { title: strOrNull() } },
  set_accessibility_description: { fields: { description: strOrNull() } },
}

const ARCHITECTURE_SCHEMA: Record<string, OpSpec> = {
  set_title:                     { fields: { title: strOrNull() } },
  set_accessibility_title:       { fields: { title: strOrNull() } },
  set_accessibility_description: { fields: { description: strOrNull() } },
  add_service:       { fields: { id: str(), label: str(false), icon: strOrNull(false), group: strOrNull(false) } },
  remove_service:    { fields: { id: str() } },
  rename_service:    { fields: { from: str(), to: str() } },
  set_service_label: { fields: { id: str(), label: str() } },
  set_service_icon:  { fields: { id: str(), icon: strOrNull() } },
  move_service:      { fields: { id: str(), group: strOrNull() } },
  add_junction:      { fields: { id: str(), group: strOrNull(false) } },
  remove_junction:   { fields: { id: str() } },
  rename_junction:   { fields: { from: str(), to: str() } },
  move_junction:     { fields: { id: str(), group: strOrNull() } },
  add_group:         { fields: { id: str(), label: str(false), icon: strOrNull(false), parent: strOrNull(false) } },
  set_group_label:   { fields: { id: str(), label: str() } },
  remove_group:      { fields: { id: str() } },
  add_edge:          { fields: { from: str(), to: str(), fromSide: oneOf(ARCH_SIDES), toSide: oneOf(ARCH_SIDES), fromBoundary: oneOf(ARCH_BOUNDARIES, false), toBoundary: oneOf(ARCH_BOUNDARIES, false), label: strOrNull(false), hasArrowStart: bool(false), hasArrowEnd: bool(false) } },
  update_edge:       { fields: { index: num(), from: str(false), to: str(false), fromSide: oneOf(ARCH_SIDES, false), toSide: oneOf(ARCH_SIDES, false), fromBoundary: oneOf(ARCH_BOUNDARIES, false), toBoundary: oneOf(ARCH_BOUNDARIES, false), label: strOrNull(false), hasArrowStart: bool(false), hasArrowEnd: bool(false) } },
  remove_edge:       { fields: { index: num(false), id: str(false) }, requireOneOf: ['index', 'id'] },
}

const XYCHART_SCHEMA: Record<string, OpSpec> = {
  set_title:         { fields: { title: strOrNull() } },
  set_x_axis:        { fields: { axis: objOrNull() } },
  set_y_axis:        { fields: { axis: objOrNull() } },
  add_series:        { fields: { kind2: withNote(oneOf(SERIES_KINDS), 'series type — the field is named kind2, not kind'), name: strOrNull(false), values: numArr() } },
  remove_series:     { fields: { index: num() } },
  set_series_values: { fields: { index: num(), values: numArr() } },
  set_series_name:   { fields: { index: num(), name: strOrNull() } },
  reorder_series:    { fields: { from: num(), to: num() } },
  set_orientation:   { fields: { horizontal: withNote(bool(), 'true = horizontal, false = vertical (the default)') } },
  set_data_point:    { fields: { seriesIndex: num(), index: withNote(num(), '0-based position within the series values'), value: withNote(num(), 'finite') } },
}

const PIE_SCHEMA: Record<string, OpSpec> = {
  set_title:       { fields: { title: strOrNull() } },
  set_show_data:   { fields: { showData: bool() } },
  add_slice:       { fields: { label: str(), value: withNote(num(), '> 0, finite') } },
  remove_slice:    { fields: { label: str() } },
  rename_slice:    { fields: { from: str(), to: str() } },
  set_slice_value: { fields: { label: str(), value: withNote(num(), '> 0, finite') } },
  reorder_slice:   { fields: { from: num(), to: num() } },
}

const QUADRANT_SCHEMA: Record<string, OpSpec> = {
  set_title:           { fields: { title: strOrNull() } },
  set_axis_labels:     { fields: { axis: oneOf(AXIS_KINDS), near: strOrNull(), far: strOrNull(false) } },
  set_quadrant_label:  { fields: { quadrant: num(), label: strOrNull() } },
  add_point:           { fields: { label: str(), x: withNote(num(), '0..1'), y: withNote(num(), '0..1') } },
  remove_point:        { fields: { label: str() } },
  move_point:          { fields: { label: str(), x: withNote(num(), '0..1'), y: withNote(num(), '0..1') } },
  rename_point:        { fields: { from: str(), to: str() } },
}

const GANTT_SCHEMA: Record<string, OpSpec> = {
  set_title:       { fields: { title: strOrNull() } },
  add_section:     { fields: { label: str() } },
  rename_section:  { fields: { index: num(), label: str() } },
  remove_section:  { fields: { index: num() } },
  add_task:        { fields: { sectionIndex: num(), label: str(), taskId: str(false), tags: strArr(false), start: withNote(str(false), 'date, or "after <taskId>"'), end: withNote(str(), 'date, a duration like "3d", or "until <taskId>"'), index: withNote(num(false), 'insert position; omit to append — inserting into an implicit-start chain re-chains the follower onto the new task') } },
  remove_task:     { fields: { sectionIndex: num(), taskIndex: num() } },
  rename_task:     { fields: { sectionIndex: num(), taskIndex: num(), label: str() } },
  set_task_status: { fields: { sectionIndex: num(), taskIndex: num(), status: oneOf(GANTT_STATUSES, true, true) } },
  set_task_dates:  { fields: { sectionIndex: num(), taskIndex: num(), start: strOrNull(false), end: str(false) } },
  set_task_flags:  { fields: { sectionIndex: num(), taskIndex: num(), milestone: bool(false), vert: bool(false) } },
  set_task_id:     { fields: { sectionIndex: num(), taskIndex: num(), taskId: withNote(strOrNull(), 'renames rewrite after/until references; null clears (rejected while referenced)') } },
  move_task:       { fields: { fromSection: num(), fromIndex: num(), toSection: num(), toIndex: withNote(num(), 'insert position in the target section, applied after removal — rejected if the move would change an implicit-start task\'s predecessor') } },
  move_section:    { fields: { from: num(), to: num() } },
}

const MINDMAP_SCHEMA: Record<string, OpSpec> = {
  add_node: { fields: { id: str(), label: str(), parent: str(), shape: oneOf(MINDMAP_SHAPES, false), index: num(false) } },
  remove_node: { fields: { id: str(), recursive: bool(false) } },
  rename_node: { fields: { from: str(), to: str() } },
  set_label: { fields: { id: str(), label: str() } },
  move_node: { fields: { id: str(), parent: str(), index: num(false) } },
  set_shape: { fields: { id: str(), shape: oneOf(MINDMAP_SHAPES) } },
  set_icon: { fields: { id: str(), icon: strOrNull() } },
  set_node_class: { fields: { id: str(), className: strOrNull() } },
  set_accessibility_title: { fields: { title: strOrNull() } },
  set_accessibility_description: { fields: { description: strOrNull() } },
}

const GITGRAPH_SCHEMA: Record<string, OpSpec> = {
  append_commit: { fields: { id: str(false), message: str(false), type: oneOf(GIT_COMMIT_TYPES, false), tags: strArr(false) } },
  create_branch: { fields: { name: str(), order: num(false) } },
  checkout_branch: { fields: { name: str() } },
  merge_branch: { fields: { name: str(), id: str(false), type: oneOf(GIT_COMMIT_TYPES, false), tags: strArr(false) } },
  cherry_pick: { fields: { id: str(), parent: str(false), tags: strArr(false) } },
  set_commit_message: { fields: { id: str(), message: strOrNull() } },
  set_commit_type: { fields: { id: str(), type: oneOf(GIT_COMMIT_TYPES) } },
  set_commit_tags: { fields: { id: str(), tags: strArr() } },
  rename_branch: { fields: { from: str(), to: str() } },
  set_accessibility_title: { fields: { title: strOrNull() } },
  set_accessibility_description: { fields: { description: strOrNull() } },
}

const SCHEMAS: Record<OpFamily, Record<string, OpSpec>> = {
  flowchart: FLOWCHART_SCHEMA,
  state: STATE_SCHEMA,
  sequence: SEQUENCE_SCHEMA,
  timeline: TIMELINE_SCHEMA,
  class: CLASS_SCHEMA,
  er: ER_SCHEMA,
  journey: JOURNEY_SCHEMA,
  architecture: ARCHITECTURE_SCHEMA,
  xychart: XYCHART_SCHEMA,
  pie: PIE_SCHEMA,
  quadrant: QUADRANT_SCHEMA,
  gantt: GANTT_SCHEMA,
  mindmap: MINDMAP_SCHEMA,
  gitgraph: GITGRAPH_SCHEMA,
}

/** True when `family` has a shape schema (i.e. is a mutable structured family). */
export function hasOpSchema(family: string): family is OpFamily {
  return family in SCHEMAS
}

// ---- Prescriptive error ---------------------------------------------------

/**
 * Structured, model-actionable validation error. `code` is always INVALID_OP
 * (so it flows through the existing MutationError channel unchanged), but the
 * payload names the exact problem and enumerates the legal fields so a weak
 * model can self-correct in one turn.
 */
export interface OpValidationError {
  code: 'INVALID_OP'
  /** 'expected_single_op' | 'unknown_kind' | 'unknown_field' | 'missing_field' | 'wrong_type' | 'require_one_of' */
  reason: string
  message: string
  family: OpFamily
  opKind?: string
  /** the offending field, when applicable */
  field?: string
  /** valid field names for this op (or valid op kinds, for unknown_kind) */
  validFields?: string[]
  /** nearest valid name to a typo'd field/kind, when an obvious match exists */
  didYouMean?: string
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0]![j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m]![n]!
}

/** Nearest candidate within an edit-distance threshold (typo tolerance). */
function nearest(target: string, candidates: string[]): string | undefined {
  let best: string | undefined
  let bestD = Infinity
  for (const c of candidates) {
    const dist = levenshtein(target.toLowerCase(), c.toLowerCase())
    if (dist < bestD) { bestD = dist; best = c }
  }
  // Only suggest when the match is close (<= ~40% of the longer string).
  return best !== undefined && bestD <= Math.max(2, Math.ceil(best.length * 0.4)) ? best : undefined
}

function typeName(f: FieldType): string {
  switch (f.type) {
    case 'string': return 'string'
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'string-or-null': return 'string | null'
    case 'string-array': return 'string[]'
    case 'number-array': return 'number[]'
    case 'object-or-null': return 'object | null'
    case 'enum': return `one of ${f.values.map(v => JSON.stringify(v)).join(', ')}${f.nullable ? ' | null' : ''}`
  }
}

function matchesType(spec: FieldType, value: unknown): boolean {
  switch (spec.type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'string-or-null': return value === null || typeof value === 'string'
    case 'string-array': return Array.isArray(value) && value.every(v => typeof v === 'string')
    case 'number-array': return Array.isArray(value) && value.every(v => typeof v === 'number' && Number.isFinite(v))
    case 'object-or-null': return value === null || (typeof value === 'object' && !Array.isArray(value))
    case 'enum': return (spec.nullable === true && value === null) || (typeof value === 'string' && spec.values.includes(value))
  }
}

/**
 * Validate one op's SHAPE against its family schema. Returns null when valid.
 * The one and only shape choke point: every untyped edit path (declarative
 * applyOps / buildChecked and the Code Mode facade) calls this — through
 * mutateChecked — before touching a mutator.
 */
export function validateOp(family: OpFamily, op: unknown): OpValidationError | null {
  const schema = SCHEMAS[family]
  // An op array is the common "apply these ops" slip — give it a dedicated
  // reason so a caller can branch on it, and a message that names the batch fix.
  if (Array.isArray(op)) {
    return { code: 'INVALID_OP', reason: 'expected_single_op', family, message: unknownOpMessage(family, op), validFields: Object.keys(schema) }
  }
  if (!op || typeof op !== 'object') {
    return { code: 'INVALID_OP', reason: 'unknown_kind', family, message: unknownOpMessage(family, op), validFields: Object.keys(schema) }
  }
  const rec = op as Record<string, unknown>
  const kind = rec.kind
  if (typeof kind !== 'string' || !(kind in schema)) {
    const validKinds = Object.keys(schema)
    const dym = typeof kind === 'string' ? nearest(kind, validKinds) : undefined
    // Reuse the mutator's own prescriptive phrasing ("valid ops: …") so the
    // message is identical no matter which layer catches the unknown kind; add
    // a typo suggestion on top.
    return {
      code: 'INVALID_OP', reason: 'unknown_kind', family, opKind: typeof kind === 'string' ? kind : undefined,
      message: `${unknownOpMessage(family, op)}${dym ? ` Did you mean "${dym}"?` : ''}`,
      validFields: validKinds, didYouMean: dym,
    }
  }

  const spec = schema[kind]!
  const validFields = Object.keys(spec.fields)

  // 1) Unknown / misnamed fields (this catches the `name`-instead-of-`id` bug).
  for (const key of Object.keys(rec)) {
    if (key === 'kind') continue
    if (!(key in spec.fields)) {
      const dym = nearest(key, validFields)
      return {
        code: 'INVALID_OP', reason: 'unknown_field', family, opKind: kind, field: key,
        message: `Unknown field "${key}" for ${family} op "${kind}".${dym ? ` Did you mean "${dym}"?` : ''} Valid fields: ${validFields.join(', ')}.`,
        validFields, didYouMean: dym,
      }
    }
  }

  // 2) Missing required fields.
  for (const [name, fspec] of Object.entries(spec.fields)) {
    if (!fspec.required) continue
    if (rec[name] === undefined) {
      return {
        code: 'INVALID_OP', reason: 'missing_field', family, opKind: kind, field: name,
        message: `Missing required field "${name}" (${typeName(fspec)}) for ${family} op "${kind}". Fields: ${validFields.join(', ')}.`,
        validFields,
      }
    }
  }

  // 3) requireOneOf (e.g. remove_edge needs index OR id).
  if (spec.requireOneOf && !spec.requireOneOf.some(f => rec[f] !== undefined)) {
    return {
      code: 'INVALID_OP', reason: 'require_one_of', family, opKind: kind,
      message: `${family} op "${kind}" requires at least one of: ${spec.requireOneOf.join(', ')}.`,
      validFields,
    }
  }

  // 4) Present fields must match their declared type.
  for (const [name, fspec] of Object.entries(spec.fields)) {
    if (rec[name] === undefined) continue
    if (!matchesType(fspec, rec[name])) {
      return {
        code: 'INVALID_OP', reason: 'wrong_type', family, opKind: kind, field: name,
        message: `Field "${name}" of ${family} op "${kind}" must be ${typeName(fspec)}, got ${JSON.stringify(rec[name])}.`,
        validFields,
      }
    }
  }

  return null
}

/** Machine-readable op menu for a family — { opKind: [fieldName, …] } — the
 *  basis for tool-discovery output. Optional fields are marked with a trailing
 *  `?`; the op's `kind` is implicit and omitted. */
export function opMenu(family: OpFamily): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [kind, spec] of Object.entries(SCHEMAS[family])) {
    out[kind] = Object.entries(spec.fields).map(([n, f]) => (f.required ? n : `${n}?`))
  }
  return out
}

/** One field of an op, as a model needs it to fill the op correctly: the name,
 *  whether it is required, and a human type that spells out enum values inline
 *  (e.g. `one of "inheritance", "composition", …`). */
export interface OpFieldDoc { name: string; required: boolean; type: string; note?: string }

/** Full field shapes for every op of a family — the thing a model must know to
 *  author a correct op without guessing (which the prescriptive INVALID_OP error
 *  only teaches AFTER a wrong guess). Surfaced in `am capabilities --json` and
 *  the declarative MCP tool descriptions so field names, required-ness, and enum
 *  vocabularies are discoverable up front. */
export function describeOps(family: OpFamily): Record<string, OpFieldDoc[]> {
  const out: Record<string, OpFieldDoc[]> = {}
  for (const [kind, spec] of Object.entries(SCHEMAS[family])) {
    out[kind] = Object.entries(spec.fields).map(([name, f]) => ({ name, required: f.required, type: typeName(f), ...(f.note !== undefined ? { note: f.note } : {}) }))
  }
  return out
}

/** Compact one-line signatures for a family's ops — `add_relation(from, to,
 *  relKind, label?)` — for embedding in a tool description. Optional fields carry
 *  a trailing `?`; enum values are left to `describeOps`/the error to keep the
 *  menu short. */
export function opSignatures(family: OpFamily): string[] {
  const menu = opMenu(family)
  return Object.entries(menu).map(([kind, fields]) => `${kind}(${fields.join(', ')})`)
}
