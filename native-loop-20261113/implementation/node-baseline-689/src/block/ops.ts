import type { FieldSpec, RecordShape } from '../agent/op-schema-definitions.ts'

const str = (required = true) => ({ type: 'string' as const, required }),
  num = (required = true) => ({ type: 'number' as const, required }),
  strs = () => ({ type: 'string-array' as const, required: false }),
  nullable = () => ({ type: 'string-or-null' as const, required: true })
// BlockInput: `children` holds records of this same shape.
// Value notes are given once, on the add_block record.
const blockFields = (id: FieldSpec | undefined): Record<string, FieldSpec> => {
  const note = (spec: FieldSpec, text: string): FieldSpec => (id ? { ...spec, note: text } : spec)
  return {
    ...(id ? { id } : {}),
    label: str(false),
    type: note(str(false), 'shape name, composite, space or block_arrow; default: square'),
    widthInColumns: note(num(false), 'integer 1..1000'),
    columns: note(num(false), '-1 (auto) or integer 1..1000'),
    directions: note(strs(), 'block_arrow: right, left, up, down, x, y'),
    classes: strs(),
    styles: strs(),
    width: note(num(false), 'space width, integer 1..10000'),
    children: { type: 'object-array', required: false, note: 'composite only; block records', get shape() { return BLOCK_INPUT } },
  }
}
const BLOCK_INPUT: RecordShape = { fields: blockFields(str()) }
export const BLOCK_OP_SCHEMAS = {
  set_columns: { fields: { columns: num(), parentId: str(false) } },
  add_block: { fields: { block: { type: 'object-or-null' as const, required: true, shape: BLOCK_INPUT }, parentId: str(false), index: num(false) } },
  update_block: { fields: { id: str(), changes: { type: 'object-or-null' as const, required: true, note: 'add_block block fields to change, except id', shape: { fields: blockFields(undefined), byReference: true as const } } } },
  rename_block: { fields: { from: str(), to: str() } },
  remove_block: { fields: { id: str(), cascade: { type: 'boolean' as const, required: false } } },
  move_block: { fields: { id: str(), parentId: str(false), index: num(false) } },
  add_edge: { fields: { from: str(), to: str(), label: str(false), style: { type: 'enum' as const, values: ['solid', 'dotted', 'thick'], required: false }, arrowStart: str(false), arrowEnd: str(false) } },
  remove_edge: { fields: { id: str() } },
  define_class: { fields: { name: str(), style: str() } },
  set_node_class: { fields: { id: str(), className: nullable() } },
  set_node_style: { fields: { id: str(), style: nullable() } },
}
export const BLOCK_OP_KINDS = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.keys(BLOCK_OP_SCHEMAS))
