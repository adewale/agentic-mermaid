const string = { type: 'string', required: true } as const
const number = { type: 'number', required: true } as const
const nullable = { type: 'string-or-null', required: true } as const
export const WARDLEY_OP_SCHEMAS = {
  set_title: { fields: { title: nullable } },
  add_component: { fields: { id: string, x: number, y: number, anchor: { type: 'boolean', required: false } } },
  set_component_position: { fields: { id: string, x: number, y: number } },
  remove_component: { fields: { id: string } },
  add_dependency: { fields: { source: string, target: string, label: { type: 'string', required: false }, dashed: { type: 'boolean', required: false }, flow: { type: 'string', required: false } } },
  remove_dependency: { fields: { index: number } },
  set_evolution: { fields: { id: string, x: number } },
  add_note: { fields: { text: string, x: number, y: number } },
  set_accessibility_title: { fields: { title: nullable } },
  set_accessibility_description: { fields: { description: nullable } },
} as const
export const WARDLEY_OP_KINDS = Object.keys(WARDLEY_OP_SCHEMAS)
