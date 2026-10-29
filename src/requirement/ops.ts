const str = (required = true) => ({ type: 'string' as const, required }),
  obj = () => ({ type: 'object-or-null' as const, required: true })
export const REQUIREMENT_OP_SCHEMAS = {
  set_direction: { fields: { direction: { type: 'enum' as const, values: ['TB', 'BT', 'LR', 'RL'], required: true } } },
  add_requirement: { fields: { requirement: obj() } },
  update_requirement: { fields: { id: str(), changes: obj() } },
  add_element: { fields: { element: obj() } },
  update_element: { fields: { id: str(), changes: obj() } },
  rename_node: { fields: { from: str(), to: str() } },
  remove_node: { fields: { id: str(), cascade: { type: 'boolean' as const, required: false } } },
  add_relation: { fields: { relation: obj() } },
  remove_relation: { fields: { id: str() } },
  define_class: { fields: { name: str(), style: str() } },
  set_node_class: { fields: { id: str(), className: { type: 'string-or-null' as const, required: true } } },
  set_node_style: { fields: { id: str(), style: { type: 'string-or-null' as const, required: true } } },
}
export const REQUIREMENT_OP_KINDS = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.keys(REQUIREMENT_OP_SCHEMAS))
