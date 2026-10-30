import { ZENUML_OP_SCHEMAS } from '../zenuml/native-ops.ts'
import { EVENTMODELING_OP_SCHEMAS } from '../eventmodeling/ops.ts'
import { KANBAN_OP_SCHEMAS } from '../kanban/ops.ts'
import { PACKET_OP_SCHEMAS } from '../packet/ops.ts'
import { BLOCK_OP_SCHEMAS } from '../block/ops.ts'
import { ISHIKAWA_OP_SCHEMAS } from '../ishikawa/ops.ts'
import { REQUIREMENT_OP_SCHEMAS } from '../requirement/ops.ts'
import { TREEMAP_OP_SCHEMAS } from '../treemap/ops.ts'
import { flowchartV11ShapeNames } from '../flowchart-shapes.ts'
import { MAX_RADAR_TICKS } from '../radar/parser.ts'
import type { EdgeStyle, NodeShape } from '../types.ts'
import type { ArchitectureEndpointBoundary, ArchitectureSide, ClassRelationKind, DiagramKind, ErCardinality, SequenceMessageStyle } from './types.ts'

// Pure schema records own discovery and admission shapes. They have no mutator dependency.
/** Primitive kinds a field may hold. `enum` carries an explicit value list;
 *  `nullable` lets an enum/primitive also accept `null` (e.g. set_task_status). */
export type FieldType =
  | { type: 'string' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'number-or-null' }
  | { type: 'boolean-or-null' }
  | { type: 'string-or-null' }
  | { type: 'enum'; values: readonly string[]; nullable?: boolean }
  | { type: 'string-array' }
  | { type: 'number-array' }
  // Nested records. With a `shape`, the shape layer validates the record's
  // keys, required fields and primitive types like an op's own fields, so a
  // stray key is rejected instead of silently dropped. Without one, the
  // record is free-form here and its deep shape is the mutator's to check.
  | { type: 'object'; shape?: RecordShape }
  | { type: 'object-or-null'; shape?: RecordShape }
  | { type: 'object-array'; shape?: RecordShape }

/** The fields of a nested record, validated and discovered like an op's own. */
export interface RecordShape {
  fields: Record<string, FieldSpec>
  requireOneOf?: readonly string[]
  /** Discovery names this record in its field's note instead of listing its
   *  fields again (an update record whose fields are its add record's). It
   *  is validated in full either way. */
  byReference?: true
}

/** A field type plus its required flag. Intersection (not `extends`) because
 *  FieldType is a union — an interface cannot extend a union. */
export type FieldSpec = FieldType & {
  /** required = must be present and non-undefined. Optional fields may be omitted. */
  required: boolean
  /** Optional human note surfaced in discovery: a value constraint the MUTATOR
   *  (not this shape layer) enforces (e.g. "1..5"), or the default applied when
   *  an optional field is omitted (e.g. "default: rectangle"). Descriptive only
   *  — the mutator remains the single enforcement point. */
  note?: string
}

export interface OpSpec {
  /** field-name -> spec. `kind` is implicit and never listed. */
  fields: Record<string, FieldSpec>
  /** Optional cross-field rule: at least one of these must be present (e.g.
   *  architecture remove_edge accepts `index` OR `id`). */
  requireOneOf?: readonly string[]
}

// Enum value lists, kept in sync with the type aliases they mirror.
const NODE_SHAPES: readonly NodeShape[] = ['rectangle', 'service', 'rounded', 'diamond', 'stadium', 'circle', 'ellipse', 'subroutine', 'doublecircle', 'hexagon', 'cylinder', 'asymmetric', 'trapezoid', 'trapezoid-alt', 'lean-r', 'lean-l', 'state-start', 'state-end']
const EDGE_STYLES: readonly EdgeStyle[] = ['solid', 'dotted', 'thick', 'invisible']
const SEQUENCE_MESSAGE_STYLES: readonly SequenceMessageStyle[] = ['sync', 'reply', 'line', 'line-dashed', 'async', 'async-dashed', 'lost', 'lost-dashed', 'bidirectional', 'bidirectional-dashed']
const PARTICIPANT_KINDS = ['participant', 'actor'] as const
const SEQUENCE_FRAGMENT_KINDS = ['alt', 'opt', 'loop', 'par', 'par_over'] as const
const CLASS_REL_KINDS: readonly ClassRelationKind[] = ['inheritance', 'composition', 'aggregation', 'association', 'dependency', 'realization', 'link-solid', 'link-dashed', 'lollipop']
const ER_CARDINALITIES: readonly ErCardinality[] = ['one-only', 'zero-or-one', 'zero-or-many', 'one-or-many', 'parent']
const ARCH_SIDES: readonly ArchitectureSide[] = ['L', 'R', 'T', 'B']
const ARCH_BOUNDARIES: readonly ArchitectureEndpointBoundary[] = ['item', 'group']
const SERIES_KINDS = ['bar', 'line'] as const
const AXIS_KINDS = ['x', 'y'] as const
const GANTT_STATUSES = ['active', 'done', 'crit'] as const
const MINDMAP_SHAPES = ['default', 'rect', 'rounded', 'circle', 'cloud', 'bang', 'hexagon'] as const
const GIT_COMMIT_TYPES = ['NORMAL', 'REVERSE', 'HIGHLIGHT'] as const
const GRATICULE_KINDS = ['circle', 'polygon'] as const

// Field-spec shorthands.
const str = (required = true): FieldSpec => ({ type: 'string', required })
const num = (required = true): FieldSpec => ({ type: 'number', required })
const bool = (required = true): FieldSpec => ({ type: 'boolean', required })
const numOrNull = (required = true): FieldSpec => ({ type: 'number-or-null', required })
const boolOrNull = (required = true): FieldSpec => ({ type: 'boolean-or-null', required })
const strOrNull = (required = true): FieldSpec => ({ type: 'string-or-null', required })
const strArr = (required = true): FieldSpec => ({ type: 'string-array', required })
const numArr = (required = true): FieldSpec => ({ type: 'number-array', required })
const objOrNull = (required = true, shape?: RecordShape): FieldSpec => ({ type: 'object-or-null', required, ...(shape ? { shape } : {}) })
const objArr = (required = true): FieldSpec => ({ type: 'object-array', required })
const obj = (shape: RecordShape, required = true): FieldSpec => ({ type: 'object', required, shape })
const oneOf = (values: readonly string[], required = true, nullable = false): FieldSpec => ({ type: 'enum', values, nullable, required })
/** Attach a discovery note (mutator-enforced constraint or omit-default) to a
 *  field spec without changing its shape validation. */
const withNote = (spec: FieldSpec, note: string): FieldSpec => ({ ...spec, note })

// ---- Per-op schemas (transcribed from the *MutationOp unions in types.ts) ---

// set_shape/add_node accept the geometry names PLUS every documented Mermaid
// v11 @{ shape } short name and alias — one vocabulary, sourced from the
// normalization table (src/flowchart-shapes.ts).
const FLOWCHART_SHAPE_VALUES: readonly string[] = [...NODE_SHAPES, ...flowchartV11ShapeNames().filter(name => !(NODE_SHAPES as readonly string[]).includes(name))]
const FLOWCHART_DIRECTIONS = ['TD', 'TB', 'LR', 'BT', 'RL'] as const

const FLOWCHART_SCHEMA: Record<string, OpSpec> = {
  add_node: { fields: { id: str(), label: str(), shape: withNote(oneOf(FLOWCHART_SHAPE_VALUES, false), 'default: rectangle; also accepts Mermaid v11 @{ shape } names/aliases (e.g. manual-input)'), parent: str(false) } },
  remove_node: { fields: { id: str() } },
  rename_node: { fields: { from: str(), to: str() } },
  set_label: { fields: { target: withNote(str(), 'a node id, an authored edge ID (e1), or "from->to"/"from->to#k"; an id a node and an edge share names the node'), label: str() } },
  add_edge: { fields: { from: str(), to: str(), label: str(false), style: withNote(oneOf(EDGE_STYLES, false), 'default: solid') } },
  remove_edge: { fields: { id: withNote(str(), 'an authored edge ID (e1), or "from->to"/"from->to#k" for the k-th parallel edge') } },
  set_shape: { fields: { id: str(), shape: withNote(oneOf(FLOWCHART_SHAPE_VALUES), 'a geometry name or a Mermaid v11 @{ shape } name/alias; v11 names render with the documented geometry mapping and serialize with the authored spelling') } },
  set_direction: { fields: { direction: oneOf(FLOWCHART_DIRECTIONS), subgraph: withNote(str(false), "omit to set the diagram direction; a subgraph id sets that subgraph's direction override") } },
  add_subgraph: { fields: { id: str(), label: str(false), parent: withNote(str(false), 'nest inside this subgraph'), members: withNote(strArr(false), 'existing node ids MOVED into the new subgraph') } },
  remove_subgraph: { fields: { id: str(), removeMembers: withNote(bool(false), 'default false: dissolve — members move to the parent scope; true also removes member nodes and their edges') } },
  move_node: { fields: { id: str(), subgraph: withNote(strOrNull(), 'target subgraph id; null moves the node to the top level') } },
  define_class: { fields: { name: str(), style: withNote(str(), 'CSS-like pairs, e.g. "fill:#f96,stroke:#333,stroke-width:2px"') } },
  set_node_class: { fields: { id: str(), className: withNote(strOrNull(), 'assigns a classDef name (define_class or source classDef); null removes the assignment') } },
  set_node_style: { fields: { id: str(), style: withNote(strOrNull(), 'inline style pairs, e.g. "fill:#bbf"; null clears') } },
}

const STATE_DIRECTIONS = ['TD', 'TB', 'LR', 'BT', 'RL'] as const
const STATE_NOTE_SIDES = ['left', 'right'] as const

const STATE_SCHEMA: Record<string, OpSpec> = {
  add_state: { fields: { id: str(), label: strOrNull(false), parent: strOrNull(false), region: num(false) } },
  remove_state: { fields: { id: str(), recursive: withNote(bool(false), 'default false: refuse a non-empty composite; true removes the whole subtree (transitions + notes cascade)') } },
  rename_state: { fields: { from: str(), to: str() } },
  set_state_label: { fields: { id: str(), label: strOrNull() } },
  add_transition: { fields: { from: withNote(str(), 'a state id, "[*]", or a history ref like "X[H]"'), to: withNote(str(), 'a state id, "[*]", or a history ref like "X[H]"'), label: strOrNull(false), parent: strOrNull(false), region: num(false) } },
  remove_transition: { fields: { index: num(false), from: str(false), to: str(false), parent: strOrNull(false), region: num(false) }, requireOneOf: ['index', 'from', 'to'] },
  set_transition_label: { fields: { index: num(false), from: str(false), to: str(false), label: strOrNull(), parent: strOrNull(false), region: num(false) }, requireOneOf: ['index', 'from', 'to'] },
  make_composite: { fields: { id: str(), members: strArr(), label: strOrNull(false) } },
  set_direction: { fields: { direction: oneOf(STATE_DIRECTIONS), state: withNote(strOrNull(false), "omit to set the diagram direction; a composite id sets that composite's direction override") } },
  move_state: { fields: { id: str(), parent: withNote(strOrNull(), 'target composite id; null moves the state to the top level'), region: num(false) } },
  dissolve_composite: { fields: { id: withNote(str(), 'children and inner transitions hoist into the parent scope; rejects while transitions/notes still reference the composite') } },
  add_note: { fields: { target: str(), side: withNote(oneOf(STATE_NOTE_SIDES, false), 'default: right'), text: withNote(str(), 'multi-line text serializes as a block note') } },
  remove_note: { fields: { index: num() } },
  set_note_text: { fields: { index: num(), text: str() } },
  add_floating_note: { fields: { id: str(), text: str(), parent: strOrNull(false), region: num(false) } },
  remove_floating_note: { fields: { id: str() } },
  set_floating_note_text: { fields: { id: str(), text: str() } },
  define_class: { fields: { name: str(), style: withNote(str(), 'CSS-like pairs, e.g. "fill:#f96,stroke:#333"') } },
  set_state_class: { fields: { id: str(), className: strOrNull() } },
  set_state_style: { fields: { id: str(), style: withNote(strOrNull(), 'inline style pairs; null clears') } },
  set_transition_style: { fields: { index: num(false), default: bool(false), style: strOrNull(), parent: strOrNull(false), region: num(false) }, requireOneOf: ['index', 'default'] },
}

const SEQUENCE_SCHEMA: Record<string, OpSpec> = {
  add_participant: { fields: { id: str(), label: str(false), participantKind: oneOf(PARTICIPANT_KINDS, false) } },
  remove_participant: { fields: { id: str() } },
  add_message: { fields: { from: str(), to: str(), text: str(), wrap: bool(false), style: withNote(oneOf(SEQUENCE_MESSAGE_STYLES, false), 'default: sync'), index: withNote(num(false), 'top-level insert position; default: append') } },
  remove_message: { fields: { index: num() } },
  set_message_text: { fields: { index: num(), text: str() } },
  set_message_wrap: { fields: { index: num(), wrap: withNote(boolOrNull(), 'null inherits the diagram configuration') } },
  move_message: { fields: { from: withNote(num(), 'top-level message index'), to: withNote(num(), 'top-level target position') } },
  set_participant_label: { fields: { id: str(), label: str() } },
  add_fragment: { fields: { fragmentKind: oneOf(SEQUENCE_FRAGMENT_KINDS), label: str(false), index: withNote(num(false), 'fragment insert position; default: append') } },
  remove_fragment: { fields: { index: num() } },
  set_fragment_label: { fields: { index: num(), label: strOrNull() } },
  add_fragment_branch: { fields: { fragmentIndex: num(), label: str(false) } },
  set_fragment_branch_label: { fields: { fragmentIndex: num(), branchIndex: num(), label: strOrNull() } },
  add_fragment_message: { fields: { fragmentIndex: num(), branchIndex: withNote(num(false), 'default: 0'), from: str(), to: str(), text: str(), wrap: bool(false), style: withNote(oneOf(SEQUENCE_MESSAGE_STYLES, false), 'default: sync'), index: withNote(num(false), 'message insert position; default: append') } },
  remove_fragment_message: { fields: { fragmentIndex: num(), branchIndex: withNote(num(false), 'default: 0'), index: num() } },
  set_fragment_message_text: { fields: { fragmentIndex: num(), branchIndex: withNote(num(false), 'default: 0'), index: num(), text: str() } },
  set_fragment_message_wrap: { fields: { fragmentIndex: num(), branchIndex: withNote(num(false), 'default: 0'), index: num(), wrap: withNote(boolOrNull(), 'null inherits the diagram configuration') } },
}

const TIMELINE_SCHEMA: Record<string, OpSpec> = {
  set_title: { fields: { title: strOrNull() } },
  add_section: { fields: { label: str(), index: withNote(num(false), 'insert position; omit to append') } },
  remove_section: { fields: { index: num() } },
  set_section_label: { fields: { index: num(), label: str() } },
  add_period: { fields: { sectionIndex: num(), label: str(), events: strArr(false), index: withNote(num(false), 'insert position; omit to append') } },
  remove_period: { fields: { sectionIndex: num(), periodIndex: num() } },
  set_period_label: { fields: { sectionIndex: num(), periodIndex: num(), label: str() } },
  add_event: { fields: { sectionIndex: num(), periodIndex: num(), text: str(), index: withNote(num(false), 'insert position; omit to append') } },
  remove_event: { fields: { sectionIndex: num(), periodIndex: num(), eventIndex: num() } },
  set_event_text: { fields: { sectionIndex: num(), periodIndex: num(), eventIndex: num(), text: str() } },
  move_period: { fields: { fromSection: num(), fromIndex: num(), toSection: num(), toIndex: withNote(num(), 'insert position in the target section, applied after removal') } },
  move_event: { fields: { fromSection: num(), fromPeriod: num(), fromIndex: num(), toSection: num(), toPeriod: num(), toIndex: withNote(num(), 'insert position in the target period, applied after removal') } },
  move_section: { fields: { from: num(), to: num() } },
  set_accessibility_title: { fields: { title: strOrNull() } },
  set_accessibility_description: { fields: { description: strOrNull() } },
}

const CLASS_SCHEMA: Record<string, OpSpec> = {
  set_title: { fields: { title: strOrNull() } },
  add_class: { fields: { id: str(), label: str(false), generic: withNote(str(false), 'Mermaid generic parameter text without surrounding ~ delimiters'), members: strArr(false), namespace: withNote(str(false), 'dot path, e.g. "Platform.Auth"; declared on demand') } },
  remove_class: { fields: { id: str() } },
  rename_class: { fields: { from: str(), to: str() } },
  set_class_generic: { fields: { class: str(), generic: withNote(strOrNull(), 'parameter text without ~ delimiters; null removes it') } },
  add_member: { fields: { class: str(), text: str() } },
  remove_member: { fields: { class: str(), index: num() } },
  add_interface: {
    fields: {
      class: withNote(str(), 'existing ordinary class; the interface is a new distinct occurrence'),
      label: withNote(str(), 'non-empty portable interface endpoint name; repeated labels remain independent'),
      side: withNote(oneOf(['from', 'to'], false), 'default: to — Class --() Interface; from writes Interface ()-- Class'),
      relationLabel: withNote(str(false), 'optional connector label, separate from the interface name'),
      lineStyle: withNote(oneOf(['solid', 'dashed'], false), 'default: solid'),
    },
  },
  add_relation: {
    fields: {
      from: str(),
      to: str(),
      relKind: withNote(oneOf(CLASS_REL_KINDS), 'class endpoint relationship; use add_interface for a lone lollipop, which creates a distinct interface occurrence'),
      label: str(false),
      markerAt: withNote(oneOf(['from', 'to', 'both', 'none'], false), 'marker endpoints; omit for the relation kind default'),
      fromKind: oneOf(CLASS_REL_KINDS, false),
      toKind: oneOf(CLASS_REL_KINDS, false),
      lineStyle: withNote(oneOf(['solid', 'dashed'], false), 'independent shaft style; must agree with style-specific endpoint kinds'),
    },
  },
  remove_relation: { fields: { index: num() } },
  add_note: { fields: { text: str(), for: str(false) } },
  remove_note: { fields: { index: num() } },
  set_class_namespace: { fields: { class: str(), namespace: withNote(strOrNull(), 'dot path moves the class into that namespace (declared on demand); null moves it to the top level') } },
  define_class: { fields: { name: str(), style: withNote(str(), 'CSS-like pairs, e.g. "fill:#f96,stroke:#333"') } },
  set_css_class: { fields: { class: str(), className: strOrNull() } },
  set_class_style: { fields: { class: str(), style: strOrNull() } },
}

const ER_SCHEMA: Record<string, OpSpec> = {
  add_entity: { fields: { id: str(), label: str(false), attributes: strArr(false) } },
  remove_entity: { fields: { id: str() } },
  rename_entity: { fields: { from: str(), to: str() } },
  set_entity_label: { fields: { entity: str(), label: strOrNull() } },
  add_attribute: { fields: { entity: str(), text: str() } },
  remove_attribute: { fields: { entity: str(), index: num() } },
  add_relation: { fields: { from: str(), to: str(), leftCard: oneOf(ER_CARDINALITIES), rightCard: oneOf(ER_CARDINALITIES.filter(card => card !== 'parent')), dashed: bool(false), label: str(false) } },
  remove_relation: { fields: { index: num() } },
  set_direction: { fields: { direction: oneOf(STATE_DIRECTIONS) } },
  define_class: { fields: { name: str(), style: str() } },
  set_entity_class: { fields: { entity: str(), className: strOrNull() } },
  set_entity_style: { fields: { entity: str(), style: strOrNull() } },
}

const JOURNEY_SCHEMA: Record<string, OpSpec> = {
  set_title: { fields: { title: strOrNull() } },
  add_section: { fields: { label: str(), index: withNote(num(false), 'insert position; omit to append') } },
  remove_section: { fields: { index: num() } },
  set_section_label: { fields: { index: num(), label: str() } },
  add_task: { fields: { sectionIndex: num(), text: str(), score: withNote(num(), 'finite number 1..5'), actors: strArr(false), index: withNote(num(false), 'insert position; omit to append') } },
  remove_task: { fields: { sectionIndex: num(), taskIndex: num() } },
  set_task_text: { fields: { sectionIndex: num(), taskIndex: num(), text: str() } },
  set_task_score: { fields: { sectionIndex: num(), taskIndex: num(), score: withNote(num(), 'finite number 1..5') } },
  set_task_actors: { fields: { sectionIndex: num(), taskIndex: num(), actors: strArr() } },
  rename_actor: { fields: { from: str(), to: str() } },
  move_task: { fields: { fromSection: num(), fromIndex: num(), toSection: num(), toIndex: withNote(num(), 'insert position in the target section, applied after removal') } },
  move_section: { fields: { from: num(), to: num() } },
  set_accessibility_title: { fields: { title: strOrNull() } },
  set_accessibility_description: { fields: { description: strOrNull() } },
}

const ARCHITECTURE_SCHEMA: Record<string, OpSpec> = {
  set_title: { fields: { title: strOrNull() } },
  set_accessibility_title: { fields: { title: strOrNull() } },
  set_accessibility_description: { fields: { description: strOrNull() } },
  add_service: { fields: { id: str(), label: str(false), icon: strOrNull(false), iconText: strOrNull(false), group: strOrNull(false) } },
  remove_service: { fields: { id: str() } },
  rename_service: { fields: { from: str(), to: str() } },
  set_service_label: { fields: { id: str(), label: str() } },
  set_service_icon: { fields: { id: str(), icon: strOrNull() } },
  set_service_icon_text: { fields: { id: str(), text: strOrNull() } },
  move_service: { fields: { id: str(), group: strOrNull() } },
  add_junction: { fields: { id: str(), group: strOrNull(false) } },
  remove_junction: { fields: { id: str() } },
  rename_junction: { fields: { from: str(), to: str() } },
  move_junction: { fields: { id: str(), group: strOrNull() } },
  add_group: { fields: { id: str(), label: str(false), icon: strOrNull(false), parent: strOrNull(false) } },
  set_group_label: { fields: { id: str(), label: str() } },
  remove_group: { fields: { id: str() } },
  add_edge: { fields: { from: str(), to: str(), fromSide: oneOf(ARCH_SIDES), toSide: oneOf(ARCH_SIDES), fromBoundary: oneOf(ARCH_BOUNDARIES, false), toBoundary: oneOf(ARCH_BOUNDARIES, false), label: strOrNull(false), hasArrowStart: bool(false), hasArrowEnd: bool(false) } },
  update_edge: { fields: { index: num(), from: str(false), to: str(false), fromSide: oneOf(ARCH_SIDES, false), toSide: oneOf(ARCH_SIDES, false), fromBoundary: oneOf(ARCH_BOUNDARIES, false), toBoundary: oneOf(ARCH_BOUNDARIES, false), label: strOrNull(false), hasArrowStart: bool(false), hasArrowEnd: bool(false) } },
  remove_edge: { fields: { index: num(false), id: str(false) }, requireOneOf: ['index', 'id'] },
}

// XyChartAxisSpec. The op replaces the whole axis: a field left out is cleared.
const XY_AXIS: RecordShape = {
  fields: {
    name: strOrNull(false),
    categories: withNote(strArr(false), 'x-axis only'),
    range: obj({ fields: { min: num(), max: num() } }, false),
  },
}
const xyAxis = (axis: 'x' | 'y'): FieldSpec =>
  withNote(objOrNull(true, XY_AXIS), `replaces the whole ${axis}-axis: an omitted field is cleared; null removes it`)

const XYCHART_SCHEMA: Record<string, OpSpec> = {
  set_title: { fields: { title: strOrNull() } },
  set_x_axis: { fields: { axis: xyAxis('x') } },
  set_y_axis: { fields: { axis: xyAxis('y') } },
  add_series: { fields: { kind2: withNote(oneOf(SERIES_KINDS), 'series type — the field is named kind2, not kind'), name: strOrNull(false), values: numArr() } },
  remove_series: { fields: { index: num() } },
  set_series_values: { fields: { index: num(), values: numArr() } },
  set_series_name: { fields: { index: num(), name: strOrNull() } },
  reorder_series: { fields: { from: num(), to: num() } },
  set_orientation: { fields: { horizontal: withNote(bool(), 'true = horizontal, false = vertical (the default)') } },
  set_data_point: { fields: { seriesIndex: num(), index: withNote(num(), '0-based position within the series values'), value: withNote(num(), 'finite') } },
}

const PIE_SCHEMA: Record<string, OpSpec> = {
  set_title: { fields: { title: strOrNull() } },
  set_show_data: { fields: { showData: bool() } },
  add_slice: { fields: { label: str(), value: withNote(num(), '> 0, finite') } },
  remove_slice: { fields: { label: str() } },
  rename_slice: { fields: { from: str(), to: str() } },
  set_slice_value: { fields: { label: str(), value: withNote(num(), '> 0, finite') } },
  reorder_slice: { fields: { from: num(), to: num() } },
}

// A repeated point label is another point; its later points are numbered in
// document order (quadrantPointIds).
const QUADRANT_POINT_ID = 'a repeated label reads as A, A#2, … in document order'
const QUADRANT_SCHEMA: Record<string, OpSpec> = {
  set_title: { fields: { title: strOrNull() } },
  set_axis_labels: { fields: { axis: oneOf(AXIS_KINDS), near: strOrNull(), far: strOrNull(false) } },
  set_quadrant_label: { fields: { quadrant: num(), label: strOrNull() } },
  add_point: { fields: { label: str(), x: withNote(num(), '0..1'), y: withNote(num(), '0..1') } },
  remove_point: { fields: { label: withNote(str(), QUADRANT_POINT_ID) } },
  move_point: { fields: { label: withNote(str(), QUADRANT_POINT_ID), x: withNote(num(), '0..1'), y: withNote(num(), '0..1') } },
  rename_point: { fields: { from: withNote(str(), QUADRANT_POINT_ID), to: str() } },
}

const GANTT_SCHEMA: Record<string, OpSpec> = {
  set_title: { fields: { title: strOrNull() } },
  add_section: { fields: { label: str() } },
  rename_section: { fields: { index: num(), label: str() } },
  remove_section: { fields: { index: num() } },
  add_task: {
    fields: {
      sectionIndex: num(),
      label: str(),
      taskId: str(false),
      tags: strArr(false),
      start: withNote(str(false), 'date, or "after <taskId>"'),
      end: withNote(str(), 'date, a duration like "3d", or "until <taskId>"'),
      index: withNote(num(false), 'insert position; omit to append — inserting into an implicit-start chain re-chains the follower onto the new task'),
    },
  },
  remove_task: { fields: { sectionIndex: num(), taskIndex: num() } },
  rename_task: { fields: { sectionIndex: num(), taskIndex: num(), label: str() } },
  set_task_status: { fields: { sectionIndex: num(), taskIndex: num(), status: oneOf(GANTT_STATUSES, true, true) } },
  set_task_dates: { fields: { sectionIndex: num(), taskIndex: num(), start: strOrNull(false), end: str(false) } },
  set_task_flags: { fields: { sectionIndex: num(), taskIndex: num(), milestone: bool(false), vert: bool(false) } },
  set_task_id: { fields: { sectionIndex: num(), taskIndex: num(), taskId: withNote(strOrNull(), 'renames rewrite after/until references; null clears (rejected while referenced)') } },
  move_task: { fields: { fromSection: num(), fromIndex: num(), toSection: num(), toIndex: withNote(num(), "insert position in the target section, applied after removal — rejected if the move would change an implicit-start task's predecessor") } },
  move_section: { fields: { from: num(), to: num() } },
}

// Mindmap identity: a default-shaped node's text is its id; a repeated
// identity's later nodes are numbered in document order (X, X#2, …).
const MINDMAP_SCHEMA: Record<string, OpSpec> = {
  add_node: {
    fields: {
      id: withNote(str(), 'must equal label for the default shape; repeated text reads as X, X#2, … in document order'),
      label: str(),
      parent: withNote(str(), "a new mindmap already has its one root, 'root'"),
      shape: withNote(oneOf(MINDMAP_SHAPES, false), 'default: default; a bordered shape allows id != label'),
      index: num(false),
    },
  },
  remove_node: { fields: { id: str(), recursive: bool(false) } },
  rename_node: { fields: { from: str(), to: str() } },
  set_label: { fields: { id: str(), label: withNote(str(), 'renames a default-shaped node: its id becomes the label') } },
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

const RADAR_SCHEMA: Record<string, OpSpec> = {
  set_title: { fields: { title: strOrNull() } },
  add_axis: { fields: { id: str(), label: strOrNull(false), index: withNote(num(false), 'insert position; omit to append'), fill: withNote(num(false), 'value written to every existing curve for the new axis; default: min') } },
  remove_axis: { fields: { id: str() } },
  rename_axis: { fields: { from: str(), to: str() } },
  set_axis_label: { fields: { id: str(), label: strOrNull() } },
  reorder_axis: { fields: { from: num(), to: withNote(num(), "permutes every curve's value vector identically") } },
  add_curve: { fields: { id: str(), label: strOrNull(false), values: withNote(numArr(), 'one value per axis, in axis order'), index: num(false) } },
  remove_curve: { fields: { id: str() } },
  set_curve_values: { fields: { id: str(), values: withNote(numArr(), 'length must equal the axis count') } },
  set_curve_value: { fields: { curve: str(), axis: str(), value: withNote(num(), 'non-negative, finite') } },
  set_curve_label: { fields: { id: str(), label: strOrNull() } },
  rename_curve: { fields: { from: str(), to: str() } },
  reorder_curve: { fields: { from: num(), to: num() } },
  set_config: {
    fields: {
      max: withNote(numOrNull(false), '> min; null resets auto-max'),
      min: withNote(numOrNull(false), 'null resets 0'),
      ticks: withNote(numOrNull(false), `integer 1..${MAX_RADAR_TICKS}; null resets 5`),
      graticule: oneOf(GRATICULE_KINDS, false, true),
      showLegend: withNote(boolOrNull(false), 'null resets true'),
    },
  },
}

const SANKEY_SCHEMA: Record<string, OpSpec> = {
  add_link: { fields: { source: str(), target: str(), value: withNote(num(), 'non-negative, finite'), index: withNote(num(false), 'insert position; omit to append') } },
  remove_link: { fields: { source: str(), target: str(), occurrence: withNote(num(false), 'disambiguates parallel duplicate rows; default 0') } },
  set_link_value: { fields: { source: str(), target: str(), value: withNote(num(), 'non-negative, finite'), occurrence: num(false) } },
  rename_node: { fields: { from: str(), to: withNote(str(), 'rejects an existing label — renaming must not merge nodes') } },
}

const C4_SCHEMA: Record<string, OpSpec> = {
  add_element: { fields: { element: withNote(objOrNull(), 'required record: id, label; optional macro, kind (person/system/container/component), shape (person/rectangle/database/queue), external, technology, description, parentId, tags, link, sprite; null is refused') } },
  update_element: { fields: { id: str(), changes: withNote(objOrNull(), 'element fields to change; use rename_element/reparent_element for identity or containment') } },
  rename_element: { fields: { from: str(), to: str() } },
  reparent_element: { fields: { id: str(), parentId: strOrNull() } },
  remove_element: { fields: { id: str(), cascade: withNote(bool(false), 'default false: refuse referenced elements; true also removes referencing relationships') } },
  add_boundary: { fields: { boundary: withNote(objOrNull(), 'required record: id, label; optional macro, kind (boundary/enterprise/system/container/deployment), type, description, parentId, tags, link, sprite; null is refused') } },
  update_boundary: { fields: { id: str(), changes: objOrNull() } },
  rename_boundary: { fields: { from: str(), to: str() } },
  reparent_boundary: { fields: { id: str(), parentId: strOrNull() } },
  remove_boundary: { fields: { id: str(), cascade: withNote(bool(false), 'default false: refuse nonempty/referenced boundaries; true removes subtree and referencing relationships') } },
  add_relationship: { fields: { relationship: withNote(objOrNull(), 'required record: from, to, label; optional macro (Rel/BiRel/Rel_Back/Rel_U/Rel_D/Rel_L/Rel_R/RelIndex), technology, description, index, tags, link, sprite; parallel relationships remain distinct') } },
  update_relationship: { fields: { id: str(), changes: withNote(objOrNull(), 'relationship fields to change, addressed by the unique interaction id, not an endpoint pair') } },
  remove_relationship: { fields: { id: str() } },
  set_title: { fields: { title: strOrNull() } },
  set_variant: { fields: { variant: oneOf(['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']) } },
  add_directive: { fields: { name: withNote(str(), 'portable Mermaid UpdateElementStyle, UpdateRelStyle or UpdateLayoutConfig'), args: withNote(objArr(), 'ordered records {value:string,name?:string}; named arguments omit the $ prefix') } },
  update_directive: { fields: { id: str(), args: objArr() } },
  remove_directive: { fields: { id: str() } },
}

export const OP_SCHEMAS: Record<DiagramKind, Record<string, OpSpec>> = {
  zenuml: ZENUML_OP_SCHEMAS,
  eventmodeling: EVENTMODELING_OP_SCHEMAS,
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
  radar: RADAR_SCHEMA,
  sankey: SANKEY_SCHEMA,
  c4: C4_SCHEMA,
  packet: PACKET_OP_SCHEMAS,
  kanban: KANBAN_OP_SCHEMAS,
  requirement: REQUIREMENT_OP_SCHEMAS,
  treemap: TREEMAP_OP_SCHEMAS,
  ishikawa: ISHIKAWA_OP_SCHEMAS,
  block: BLOCK_OP_SCHEMAS,
}
