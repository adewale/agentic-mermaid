const string = (required = true) => ({ type: 'string' as const, required })
const number = (required = true) => ({ type: 'number' as const, required })
export const PACKET_OP_SCHEMAS = {
  set_title: { fields: { title: string(false) } },
  set_accessibility_title: { fields: { title: string(false) } },
  set_accessibility_description: { fields: { description: string(false) } },
  add_field: { fields: { label: string(), bits: number(), index: number(false) } },
  remove_field: { fields: { index: number() } },
  set_field_label: { fields: { index: number(), label: string() } },
  set_field_bits: { fields: { index: number(), bits: number() } },
  move_field: { fields: { from: number(), to: number() } },
}
export const PACKET_OP_KINDS = Object.keys(PACKET_OP_SCHEMAS) as Array<keyof typeof PACKET_OP_SCHEMAS>
