const string = { type: 'string', required: true } as const
const number = { type: 'number', required: true } as const
const nullable = { type: 'string-or-null', required: true } as const
export const CYNEFIN_OP_SCHEMAS = {
  set_title: { fields: { title: nullable } },
  add_item: { fields: { domain: string, label: string } },
  set_item: { fields: { domain: string, index: number, label: string } },
  remove_item: { fields: { domain: string, index: number } },
  add_transition: { fields: { from: string, to: string, label: { type: 'string', required: false } } },
  remove_transition: { fields: { index: number } },
  set_accessibility_title: { fields: { title: nullable } },
  set_accessibility_description: { fields: { description: nullable } },
} as const
export const CYNEFIN_OP_KINDS = Object.keys(CYNEFIN_OP_SCHEMAS)
