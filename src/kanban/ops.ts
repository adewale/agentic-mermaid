const string = (required = true) => ({ type: 'string' as const, required })
const number = (required = true) => ({ type: 'number' as const, required })
export const KANBAN_OP_SCHEMAS = {
  add_column: { fields: { id: string(), label: string(), index: number(false) } },
  remove_column: { fields: { id: string(), removeTasks: { type: 'boolean' as const, required: false } } },
  set_column_label: { fields: { id: string(), label: string() } },
  move_column: { fields: { id: string(), index: number() } },
  add_task: { fields: { column: string(), id: string(), label: string(), metadata: { type: 'object-or-null' as const, required: false }, index: number(false) } },
  remove_task: { fields: { id: string() } },
  set_task_label: { fields: { id: string(), label: string() } },
  set_task_metadata: { fields: { id: string(), metadata: { type: 'object-or-null' as const, required: true } } },
  move_task: { fields: { id: string(), column: string(), index: number(false) } },
  set_icon: { fields: { id: string(), icon: string(false) } },
  set_class: { fields: { id: string(), className: string(false) } },
  set_accessibility_title: { fields: { title: string(false) } },
  set_accessibility_description: { fields: { description: string(false) } },
}
export const KANBAN_OP_KINDS = Object.keys(KANBAN_OP_SCHEMAS) as Array<keyof typeof KANBAN_OP_SCHEMAS>
