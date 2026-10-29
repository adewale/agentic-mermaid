const str = (required = true) => ({ type: 'string' as const, required }),
  num = (required = true) => ({ type: 'number' as const, required }),
  obj = () => ({ type: 'object-or-null' as const, required: true }),
  nullable = () => ({ type: 'string-or-null' as const, required: true })
export const BLOCK_OP_SCHEMAS = {
  set_columns: { fields: { columns: num(), parentId: str(false) } },
  add_block: { fields: { block: obj(), parentId: str(false), index: num(false) } },
  update_block: { fields: { id: str(), changes: obj() } },
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
