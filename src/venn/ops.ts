import type { FieldSpec, OpSpec } from '../agent/op-schema-definitions.ts'
const string: FieldSpec = { type: 'string', required: true }
const optional: FieldSpec = { type: 'string', required: false }
const strings: FieldSpec = { type: 'string-array', required: true }
const nullable: FieldSpec = { type: 'string-or-null', required: true }
export const VENN_OP_SCHEMAS: Record<string, OpSpec> = {
  set_subset: { fields: { sets: strings, size: { type: 'number', required: true }, label: optional } },
  remove_subset: { fields: { sets: strings, cascade: { type: 'boolean', required: false } } },
  rename_set: { fields: { from: string, to: string } },
  set_text: { fields: { sets: strings, id: string, label: optional } },
  remove_text: { fields: { id: string } },
  set_style: { fields: { targets: strings, styles: { type: 'object-or-null', required: true } } },
  set_title: { fields: { title: nullable } },
  set_accessibility_title: { fields: { title: nullable } },
  set_accessibility_description: { fields: { description: nullable } },
}
export const VENN_OP_KINDS = Object.keys(VENN_OP_SCHEMAS)
