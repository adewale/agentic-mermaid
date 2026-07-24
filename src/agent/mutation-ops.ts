import type { BuiltinFamilyId } from './families.ts'
import type { DiagramKind } from './types.ts'

// Single source of truth for each family's structured mutation op `kind`s. It
// lives in the agent layer, next to the mutators, so two consumers read the
// same list: the CLI `capabilities` envelope (re-exported from src/cli/index.ts)
// and the mutators' "unknown op" errors, which name the family's valid ops
// instead of leaving a caller — especially a smaller model — to guess them.
export const MUTATION_OPS_BY_FAMILY = {
  flowchart: ['add_node', 'remove_node', 'rename_node', 'set_label', 'add_edge', 'remove_edge', 'set_shape', 'set_direction', 'add_subgraph', 'remove_subgraph', 'move_node', 'define_class', 'set_node_class', 'set_node_style'],
  state: [
    'add_state',
    'remove_state',
    'rename_state',
    'set_state_label',
    'add_transition',
    'remove_transition',
    'set_transition_label',
    'make_composite',
    'set_direction',
    'move_state',
    'dissolve_composite',
    'add_note',
    'remove_note',
    'set_note_text',
    'define_class',
    'set_state_class',
    'set_state_style',
    'set_transition_style',
  ],
  sequence: [
    'add_participant',
    'remove_participant',
    'add_message',
    'remove_message',
    'set_message_text',
    'move_message',
    'set_participant_label',
    'add_fragment',
    'remove_fragment',
    'set_fragment_label',
    'add_fragment_branch',
    'set_fragment_branch_label',
    'add_fragment_message',
    'remove_fragment_message',
    'set_fragment_message_text',
  ],
  timeline: ['set_title', 'add_section', 'remove_section', 'set_section_label', 'add_period', 'remove_period', 'set_period_label', 'add_event', 'remove_event', 'set_event_text', 'move_period', 'move_event', 'move_section', 'set_accessibility_title', 'set_accessibility_description'],
  class: ['set_title', 'add_class', 'remove_class', 'rename_class', 'set_class_generic', 'add_member', 'remove_member', 'add_relation', 'remove_relation', 'add_note', 'remove_note', 'set_class_namespace', 'define_class', 'set_css_class', 'set_class_style'],
  er: ['add_entity', 'remove_entity', 'rename_entity', 'set_entity_label', 'add_attribute', 'remove_attribute', 'add_relation', 'remove_relation', 'set_direction', 'define_class', 'set_entity_class', 'set_entity_style'],
  journey: ['set_title', 'add_section', 'remove_section', 'set_section_label', 'add_task', 'remove_task', 'set_task_text', 'set_task_score', 'set_task_actors', 'rename_actor', 'move_task', 'move_section', 'set_accessibility_title', 'set_accessibility_description'],
  architecture: [
    'set_title',
    'set_accessibility_title',
    'set_accessibility_description',
    'add_service',
    'remove_service',
    'rename_service',
    'set_service_label',
    'set_service_icon',
    'move_service',
    'add_junction',
    'remove_junction',
    'rename_junction',
    'move_junction',
    'add_group',
    'set_group_label',
    'remove_group',
    'add_edge',
    'update_edge',
    'remove_edge',
  ],
  xychart: ['set_title', 'set_x_axis', 'set_y_axis', 'add_series', 'remove_series', 'set_series_values', 'set_series_name', 'reorder_series', 'set_orientation', 'set_data_point'],
  pie: ['set_title', 'set_show_data', 'add_slice', 'remove_slice', 'rename_slice', 'set_slice_value', 'reorder_slice'],
  quadrant: ['set_title', 'set_axis_labels', 'set_quadrant_label', 'add_point', 'remove_point', 'move_point', 'rename_point'],
  gantt: ['set_title', 'add_section', 'rename_section', 'remove_section', 'add_task', 'remove_task', 'rename_task', 'set_task_status', 'set_task_dates', 'set_task_flags', 'set_task_id', 'move_task', 'move_section'],
  mindmap: ['add_node', 'remove_node', 'rename_node', 'set_label', 'move_node', 'set_shape', 'set_icon', 'set_node_class', 'set_accessibility_title', 'set_accessibility_description'],
  gitgraph: ['append_commit', 'create_branch', 'checkout_branch', 'merge_branch', 'cherry_pick', 'set_commit_message', 'set_commit_type', 'set_commit_tags', 'rename_branch', 'set_accessibility_title', 'set_accessibility_description'],
  radar: ['set_title', 'add_axis', 'remove_axis', 'rename_axis', 'set_axis_label', 'reorder_axis', 'add_curve', 'remove_curve', 'set_curve_values', 'set_curve_value', 'set_curve_label', 'rename_curve', 'reorder_curve', 'set_config'],
  sankey: ['add_link', 'remove_link', 'set_link_value', 'rename_node'],
} as const satisfies Record<BuiltinFamilyId, readonly string[]>

export type MutableFamilyId = keyof typeof MUTATION_OPS_BY_FAMILY

/** The valid mutation-op `kind`s for a family, as a display string — for
 *  prescriptive "unknown op" errors that hand the caller the actual menu. */
export function validOpsFor(family: DiagramKind): string {
  const ops = (MUTATION_OPS_BY_FAMILY as Record<string, readonly string[]>)[family]
  return ops ? ops.join(', ') : '(none — this family has no structured ops)'
}

/** Message for an op whose `kind` a family's mutator does not recognize: names
 *  the offending kind AND the family's valid ops, so the caller can correct it
 *  from the error alone instead of guessing which ops exist. */
export function unknownOpMessage(family: DiagramKind, op: unknown): string {
  // Passing an op ARRAY where one op is expected is the single most common shape
  // slip — it recurs on nearly every case across every model tier in the
  // agent-usage eval (mutate() applies ONE op, but "apply these ops" reads as a
  // list). Hand back the rule and the batch alternatives so the next action is
  // in the message, not left to infer from a dumped array.
  if (Array.isArray(op)) {
    return (
      `Expected a single ${family} op, got an array of ${op.length}. ` + `Ops apply one at a time: call mutate() once per op, or pass the whole list to a batch ` + `entrypoint — applyOps({ source, family, ops }) to edit source, or buildMermaid(kind, ops) ` + `to author — valid ${family} ops: ${validOpsFor(family)}`
    )
  }
  const kind = (op as { kind?: unknown } | null | undefined)?.kind
  const got = typeof kind === 'string' ? `"${kind}"` : JSON.stringify(op)
  return `Unknown ${family} op ${got} — valid ops: ${validOpsFor(family)}`
}
