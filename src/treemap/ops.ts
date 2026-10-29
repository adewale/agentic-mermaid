const string = { type: 'string', required: true } as const
const optionalString = { type: 'string', required: false } as const
const nullable = { type: 'string-or-null', required: true } as const
export const TREEMAP_OP_SCHEMAS = {
  set_title: { fields: { title: nullable } },
  add_node: { fields: { label: string, value: { type: 'number', required: false }, parentId: optionalString, className: optionalString } },
  remove_node: { fields: { id: string } },
  set_label: { fields: { id: string, label: string } },
  set_value: { fields: { id: string, value: { type: 'number', required: true } } },
  move_node: { fields: { id: string, parentId: optionalString, index: { type: 'number', required: false } } },
  define_class: { fields: { name: string, style: string } },
  set_node_class: { fields: { id: string, className: nullable } },
  set_accessibility_title: { fields: { title: nullable } },
  set_accessibility_description: { fields: { description: nullable } },
} as const
export const TREEMAP_OP_KINDS = /* @__PURE__ */ Object.keys(TREEMAP_OP_SCHEMAS)
