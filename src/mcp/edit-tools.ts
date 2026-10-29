// Declarative edit tools shared by local and hosted MCP. Host limits stay at the adapter.
import { applyOps } from '../agent/apply.ts'
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'
import { rpcError, toolResult, type JsonRpcResponse } from './protocol.ts'
import { PURE_COMPUTE_ANNOTATIONS } from './tool-surface.ts'

function mutationBatchSchema(description: string): Record<string, unknown> {
  return { type: 'array', minItems: 1, items: { type: 'object' }, description }
}

export const EDIT_TOOLS = [
  {
    name: 'mutate',
    title: 'Edit Mermaid diagram',
    description: `Apply a list of structured edit ops to an existing Mermaid \`source\` and
return the edited diagram. This is the declarative counterpart to \`execute\`:
plain JSON in, plain JSON out, no sandbox. Prefer it for straightforward edits;
reserve \`execute\` for logic the ops don't express.
Returns { ok, family, source, verify:{ ok, warnings } } on success, or
{ ok:false, family, opIndex, error } — where \`error\` names the offending field
and lists the valid ones — when an op is malformed or cannot apply. Ops apply in
order and are all-or-nothing: the first failing op stops the batch (its position
is \`opIndex\`) and the input is left untouched.
Each op is { "kind": <op>, …fields }. Call \`describe_sdk\` for the detected
family before authoring unfamiliar ops; it returns compact signatures or exact
field types, enum values, defaults, and constraints.
Set mode to source-preserving for supported edits to opaque Class or Flowchart
source. Exact edited bytes and portability warnings are retained; unsupported
operations still fail atomically. This mode does not promise portable export.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source to edit.' },
        ops: mutationBatchSchema('Non-empty ordered list of edit ops; each is { kind, ...fields }.'),
        mode: { type: 'string', enum: ['structured', 'source-preserving'], default: 'structured', description: 'Source-preserving mode edits owned source ranges without regenerating unsupported syntax.' },
      },
      required: ['source', 'ops'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
  {
    name: 'build',
    title: 'Build Mermaid diagram',
    description: `Author a new Mermaid diagram from blank by folding a list of structured ops
over an empty diagram of \`family\`. The declarative counterpart to hand-writing
source. Returns the same envelope as \`mutate\`:
{ ok, family, source, verify } or { ok:false, family, opIndex, error }.
Call \`describe_sdk\` for the family before authoring unfamiliar ops.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        family: { type: 'string', description: `Diagram family to author (one of: ${Object.keys(MUTATION_OPS_BY_FAMILY).join(', ')}).` },
        ops: mutationBatchSchema('Non-empty ordered list of ops; each is { kind, ...fields }.'),
      },
      required: ['family', 'ops'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
]

export function handleEditTool(id: number | string | null, args: Record<string, unknown>, mode: 'source' | 'family', maxBytes = Infinity, tooLargeHint = 'input exceeds the size cap'): JsonRpcResponse {
  if (mode === 'family' && args.mode !== undefined) return rpcError(id, -32602, 'build does not accept an edit mode')
  const ops = args.ops
  if (!Array.isArray(ops)) return rpcError(id, -32602, `${mode === 'source' ? 'mutate' : 'build'} requires \`ops\` (array)`)
  if (ops.length === 0) return rpcError(id, -32602, `${mode === 'source' ? 'mutate' : 'build'} requires at least one op`)
  if (mode === 'source') {
    if (typeof args.source !== 'string') return rpcError(id, -32602, 'mutate requires `source` (string)')
    if (boundedUtf8ByteLength(args.source, maxBytes) > maxBytes) {
      return toolResult(id, { ok: false as const, family: null, error: { code: 'SOURCE_TOO_LARGE', message: tooLargeHint } }, true)
    }
  } else if (typeof args.family !== 'string') {
    return rpcError(id, -32602, 'build requires `family` (string)')
  }
  if (boundedUtf8ByteLength(JSON.stringify(ops), maxBytes) > maxBytes) {
    return toolResult(id, { ok: false as const, family: null, error: { code: 'OPS_TOO_LARGE', message: tooLargeHint } }, true)
  }
  const envelope = mode === 'source'
    ? applyOps({ source: args.source as string, ops, mode: args.mode as 'structured' | 'source-preserving' | undefined })
    : applyOps({ family: args.family as string, ops })
  return toolResult(id, envelope, !envelope.ok)
}
