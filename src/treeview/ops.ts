const string = { type: 'string', required: true } as const
const optional = { type: 'string', required: false } as const
const nullable = { type: 'string-or-null', required: true } as const
const nodeType = { type: 'string', required: true, enum: ['file', 'directory'] } as const
export const TREEVIEW_OP_SCHEMAS = {
  add_node: { fields: { label: string, parentId: optional, nodeType: { ...nodeType, required: false }, icon: optional, description: optional, className: optional } },
  remove_node: { fields: { id: string } },
  set_label: { fields: { id: string, label: string } },
  set_description: { fields: { id: string, description: nullable } },
  set_icon: { fields: { id: string, icon: nullable } },
  set_class: { fields: { id: string, className: nullable } },
  set_node_type: { fields: { id: string, nodeType } },
  move_node: { fields: { id: string, parentId: optional, index: { type: 'number', required: false } } },
  set_title: { fields: { title: nullable } },
  set_accessibility_title: { fields: { title: nullable } },
  set_accessibility_description: { fields: { description: nullable } },
} as const
export const TREEVIEW_OP_KINDS = /* @__PURE__ */ Object.keys(TREEVIEW_OP_SCHEMAS)
