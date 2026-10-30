import type { FieldSpec, RecordShape } from '../agent/op-schema-definitions.ts'

const str = (required = true) => ({ type: 'string' as const, required }),
  strs = () => ({ type: 'string-array' as const, required: false }),
  record = (shape: RecordShape) => ({ type: 'object-or-null' as const, required: true, shape })
// RequirementInput / RequirementElementInput; `name` is the identity, changed only by rename_node.
// Value notes are given once, on the add_* record.
const requirementFields = (name: boolean): Record<string, FieldSpec> => ({
  ...(name ? { name: str() } : {}),
  type: name ? { ...str(false), note: 'Requirement (default), Functional/Interface/Performance/Physical Requirement or Design Constraint' } : str(false),
  requirementId: str(false),
  text: str(false),
  risk: name ? { ...str(false), note: 'Low, Medium or High' } : str(false),
  verifyMethod: name ? { ...str(false), note: 'Analysis, Demonstration, Inspection or Test' } : str(false),
  classes: strs(),
  directStyles: strs(),
})
const elementFields = (name: boolean): Record<string, FieldSpec> => ({
  ...(name ? { name: str() } : {}),
  type: str(false),
  docRef: str(false),
  classes: strs(),
  directStyles: strs(),
})
export const REQUIREMENT_OP_SCHEMAS = {
  set_direction: { fields: { direction: { type: 'enum' as const, values: ['TB', 'BT', 'LR', 'RL'], required: true } } },
  add_requirement: { fields: { requirement: record({ fields: requirementFields(true) }) } },
  update_requirement: { fields: { id: str(), changes: record({ fields: requirementFields(false) }) } },
  add_element: { fields: { element: record({ fields: elementFields(true) }) } },
  update_element: { fields: { id: str(), changes: record({ fields: elementFields(false) }) } },
  rename_node: { fields: { from: str(), to: str() } },
  remove_node: { fields: { id: str(), cascade: { type: 'boolean' as const, required: false } } },
  add_relation: { fields: { relation: record({ fields: { type: { ...str(), note: 'contains, copies, derives, satisfies, verifies, refines or traces' }, src: str(), dst: str(), id: str(false) } }) } },
  remove_relation: { fields: { id: str() } },
  define_class: { fields: { name: str(), style: str() } },
  set_node_class: { fields: { id: str(), className: { type: 'string-or-null' as const, required: true } } },
  set_node_style: { fields: { id: str(), style: { type: 'string-or-null' as const, required: true } } },
}
export const REQUIREMENT_OP_KINDS = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.keys(REQUIREMENT_OP_SCHEMAS))
