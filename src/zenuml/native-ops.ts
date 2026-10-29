import type { OpSpec } from '../agent/op-schema-definitions.ts'

const text = (required = true) => ({ type: 'string' as const, required })
const index = () => ({ type: 'number' as const, required: false })
const record = () => ({ type: 'object-or-null' as const, required: true })

export const ZENUML_OP_SCHEMAS = {
  upsert_participant: { fields: { participant: record(), index: index() } },
  remove_participant: { fields: { id: text() } },
  rename_participant: { fields: { id: text(), newId: text() } },
  insert_statement: { fields: { statement: record(), parentId: text(false), branchIndex: index(), index: index() } },
  remove_statement: { fields: { id: text() } },
  set_statement: { fields: { id: text(), statement: record() } },
  set_title: { fields: { title: text(false) } },
  set_accessibility_title: { fields: { title: text(false) } },
  set_accessibility_description: { fields: { description: text(false) } },
} satisfies Record<string, OpSpec>
