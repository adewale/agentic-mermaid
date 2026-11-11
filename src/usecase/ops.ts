const string = { type: 'string', required: true } as const
const optional = { type: 'string', required: false } as const
const nullable = { type: 'string-or-null', required: true } as const
export const USECASE_OP_SCHEMAS = {
  add_actor: { fields: { id: string, label: optional, parentId: optional } },
  add_usecase: { fields: { id: string, label: optional, parentId: optional, shape: optional } },
  add_boundary: { fields: { id: string, label: optional, boundaryType: optional } },
  remove_node: { fields: { id: string, cascade: { type: 'boolean', required: false } } },
  set_label: { fields: { id: string, label: string } },
  move_node: { fields: { id: string, parentId: nullable } },
  add_relationship: { fields: { from: string, to: string, id: optional, relation: optional, label: optional } },
  remove_relationship: { fields: { id: string } },
  set_direction: { fields: { direction: string } },
  set_title: { fields: { title: nullable } },
  set_accessibility_title: { fields: { title: nullable } },
  set_accessibility_description: { fields: { description: nullable } },
} as const
export const USECASE_OP_KINDS = /* @__PURE__ */ Object.keys(USECASE_OP_SCHEMAS)
