import type { OpSpec } from '../agent/op-schema-definitions.ts'

export const AGENTFLOW_EXTRA_OP_SCHEMAS = {
  set_metadata: { fields: { target: { type: 'string', required: true }, metadata: { type: 'object-or-null', required: true } } },
  set_role: { fields: { id: { type: 'string', required: true }, role: { type: 'enum', values: ['task', 'tool', 'action', 'input', 'refdoc', 'decision', 'connector'], required: true } } },
} satisfies Record<string, OpSpec>
