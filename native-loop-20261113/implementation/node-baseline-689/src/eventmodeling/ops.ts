const string = (required = true) => ({ type: 'string' as const, required })
const number = (required = true) => ({ type: 'number' as const, required })
const object = () => ({ type: 'object-or-null' as const, required: true })
export const EVENTMODELING_OP_SCHEMAS = {
  insert_frame: { fields: { frame: object(), index: number(false) } },
  remove_frame: { fields: { id: string() } },
  move_frame: { fields: { id: string(), index: number() } },
  set_frame: { fields: { id: string(), frame: object() } },
  set_entities: { fields: { entities: { type: 'string-array' as const, required: true } } },
  set_notes: { fields: { notes: { type: 'object-array' as const, required: true } } },
  set_specifications: { fields: { specifications: { type: 'object-array' as const, required: true } } },
  set_data: { fields: { id: string(), data: object() } },
  set_title: { fields: { title: string(false) } },
  set_accessibility_title: { fields: { title: string(false) } },
  set_accessibility_description: { fields: { description: string(false) } },
}
