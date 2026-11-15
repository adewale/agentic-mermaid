const string = { type: 'string', required: true } as const
const nullable = { type: 'string-or-null', required: true } as const
export const ISHIKAWA_OP_SCHEMAS = {
  set_effect: { fields: { label: string } },
  add_cause: { fields: { label: string, parentId: { type: 'string', required: false } } },
  remove_cause: { fields: { id: string } },
  set_label: { fields: { id: string, label: string } },
  move_cause: { fields: { id: string, parentId: string, index: { type: 'number', required: false } } },
  set_accessibility_title: { fields: { title: nullable } },
  set_accessibility_description: { fields: { description: nullable } },
} as const
export const ISHIKAWA_OP_KINDS = /* @__PURE__ */ Object.keys(ISHIKAWA_OP_SCHEMAS)
