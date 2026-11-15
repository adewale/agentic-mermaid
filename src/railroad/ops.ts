import type { OpSpec } from '../agent/op-schema-definitions.ts'

export const RAILROAD_OP_SCHEMAS = {
  add_rule: { fields: { name: { type: 'string', required: true }, definition: { type: 'object-or-null', required: true }, index: { type: 'number', required: false } } },
  replace_rule: { fields: { index: { type: 'number', required: true }, name: { type: 'string', required: false }, definition: { type: 'object-or-null', required: true } } },
  remove_rule: { fields: { index: { type: 'number', required: true } } },
  set_title: { fields: { title: { type: 'string-or-null', required: true } } },
} satisfies Record<string, OpSpec>
