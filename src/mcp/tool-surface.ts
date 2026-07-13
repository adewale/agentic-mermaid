import { reply, rpcError, type JsonRpcRequest, type JsonRpcResponse } from './protocol.ts'
import pkg from '../../package.json'
import { sharedRenderOptionsJsonSchema, styleInputJsonSchema } from '../render-contract.ts'
import { resolveStyleStack } from '../scene/style-registry.ts'
import { safeCssColor, safeCssPaint } from '../shared/css-color.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

/** Adapt independently authored tool definitions to the closed argument
 * contract used by every first-party surface. This keeps progressive tools
 * from silently reopening the interface when they are composed into a server. */
export function withClosedMcpInputSchema(tool: McpToolDefinition): McpToolDefinition {
  return { ...tool, inputSchema: { ...tool.inputSchema, additionalProperties: false } }
}

export interface McpServerSurface<Context> {
  protocolVersion: string | ((params: unknown) => string)
  /** initialize serverInfo.name; defaults to the local MCP_SERVER_NAME. */
  serverName?: string
  tools: McpToolDefinition[]
  instructions: string
  handleToolCall(id: number | string | null, params: unknown, context: Context): JsonRpcResponse | Promise<JsonRpcResponse>
}

// The LOCAL stdio/HTTP server identity. The hosted transport reports its own
// name (HOSTED_MCP_SERVER_NAME in hosted-server.ts): registries and clients
// cache tool lists by server identity, and the two surfaces expose different
// tool sets, so they must not share one.
export const MCP_SERVER_NAME = 'agentic-mermaid-mcp'
// Derived from package.json so every MCP handshake reports the same package
// version as the published npm artifact.
export const MCP_SERVER_VERSION = pkg.version
export const PURE_COMPUTE_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const
const SANDBOX_EXECUTE_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const
const MANAGED_ARTIFACT_ANNOTATIONS = {
  // output=file/url creates a managed file and repeated calls can create
  // different time-addressed artifacts, so the tool as a whole is neither
  // read-only nor idempotent even though output=base64 is pure.
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

export const EXECUTE_TIMEOUT_ERROR = 'execute timeoutMs must be a positive integer'

/** One validation contract shared by hosted and local Code Mode. */
export function isValidExecuteTimeout(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

type JsonSchema = Record<string, unknown>
type SchemaPath = readonly (string | number)[]
interface SchemaProblem { path: SchemaPath; message: string }

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function plainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function schemaRecord(value: unknown): JsonSchema | undefined {
  return plainJsonObject(value) ? value : undefined
}

function dereferenceSchema(schema: JsonSchema, root: JsonSchema): JsonSchema | undefined {
  const reference = schema.$ref
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return undefined
  let cursor: unknown = root
  for (const encoded of reference.slice(2).split('/')) {
    if (!plainJsonObject(cursor)) return undefined
    cursor = cursor[encoded.replaceAll('~1', '/').replaceAll('~0', '~')]
  }
  return schemaRecord(cursor)
}

function validateSchemaValue(
  value: unknown,
  schema: JsonSchema,
  inheritedRoot: JsonSchema,
  path: SchemaPath,
  ancestors: Set<object>,
): SchemaProblem[] {
  // Shared RenderOptions is embedded as a property schema and carries its own
  // local $defs. Treat that fragment as its reference root so recursive
  // Mermaid config values remain checkable after projection into a tool.
  const root = schemaRecord(schema.$defs) ? schema : inheritedRoot
  if (schema.$ref !== undefined) {
    const resolved = dereferenceSchema(schema, root)
    return resolved
      ? validateSchemaValue(value, resolved, root, path, ancestors)
      : [{ path, message: `uses unresolved schema reference ${String(schema.$ref)}` }]
  }

  const anyOf = Array.isArray(schema.anyOf)
    ? schema.anyOf.map(schemaRecord).filter((entry): entry is JsonSchema => entry !== undefined)
    : []
  if (anyOf.length > 0) {
    const alternatives = anyOf.map(candidate =>
      validateSchemaValue(value, candidate, root, path, new Set(ancestors)))
    if (!alternatives.some(problems => problems.length === 0)) {
      const expectation = schema['x-agentic-mermaid-validation-expectation']
      if (typeof expectation === 'string') return [{ path, message: `must be ${expectation}` }]
      return alternatives.sort((left, right) => left.length - right.length)[0]
        ?? [{ path, message: 'must match an allowed shape' }]
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !Object.is(value, schema.const)) {
    return [{ path, message: `must equal ${String(schema.const)}` }]
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => Object.is(candidate, value))) {
    return [{ path, message: `must be one of ${schema.enum.map(String).join(' | ')}` }]
  }

  const type = schema.type
  const typeIsValid = type === undefined
    || (type === 'null' && value === null)
    || (type === 'string' && typeof value === 'string')
    || (type === 'number' && typeof value === 'number' && Number.isFinite(value))
    || (type === 'integer' && typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value))
    || (type === 'boolean' && typeof value === 'boolean')
    || (type === 'array' && Array.isArray(value))
    || (type === 'object' && plainJsonObject(value))
  if (!typeIsValid) {
    const expected = type === 'number' ? 'a finite number'
      : type === 'integer' ? 'a finite integer'
        : type === 'object' ? 'a plain JSON object'
          : type === 'array' ? 'an array'
            : type === 'null' ? 'null'
              : `a ${String(type)}`
    return [{ path, message: `must be ${expected}` }]
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return [{ path, message: `must be at least ${schema.minimum}` }]
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return [{ path, message: `must be greater than ${schema.exclusiveMinimum}` }]
    if (typeof schema.maximum === 'number' && value > schema.maximum) return [{ path, message: `must be at most ${schema.maximum}` }]
  }

  if (Array.isArray(value) && type === 'array') {
    if (ancestors.has(value)) return [{ path, message: 'must be acyclic' }]
    const itemSchema = schemaRecord(schema.items)
    if (itemSchema) {
      ancestors.add(value)
      try {
        const problems = value.flatMap((item, index) =>
          validateSchemaValue(item, itemSchema, root, [...path, index], ancestors))
        if (problems.length > 0) return problems
      } finally {
        ancestors.delete(value)
      }
    }
  }

  if (plainJsonObject(value) && type === 'object') {
    if (ancestors.has(value)) return [{ path, message: 'must be acyclic' }]
    ancestors.add(value)
    try {
      const properties = schemaRecord(schema.properties) ?? {}
      const required = Array.isArray(schema.required)
        ? schema.required.filter((entry): entry is string => typeof entry === 'string')
        : []
      const problems: SchemaProblem[] = []
      for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          problems.push({ path: [...path, key], message: 'is required' })
        }
      }
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_JSON_KEYS.has(key)) {
          problems.push({ path: [...path, key], message: 'uses a forbidden prototype key' })
          continue
        }
        const propertySchema = schemaRecord(properties[key])
        if (propertySchema) {
          problems.push(...validateSchemaValue(child, propertySchema, root, [...path, key], ancestors))
          continue
        }
        if (schema.additionalProperties === false) {
          problems.push({ path: [...path, key], message: 'is not allowed' })
          continue
        }
        const additionalSchema = schemaRecord(schema.additionalProperties)
        if (additionalSchema) {
          problems.push(...validateSchemaValue(child, additionalSchema, root, [...path, key], ancestors))
        }
      }
      if (problems.length > 0) return problems
    } finally {
      ancestors.delete(value)
    }
  }

  const runtimeValidator = schema['x-agentic-mermaid-runtime-validator']
  if (runtimeValidator === 'safeCssColor' && safeCssColor(value) === undefined) {
    return [{ path, message: 'must be a safe, non-fetching CSS color' }]
  }
  if (runtimeValidator === 'safeCssPaint' && safeCssPaint(value) === undefined) {
    return [{ path, message: 'must be a safe, non-fetching CSS paint' }]
  }
  if (runtimeValidator === 'safeCssFontFamily' && safeCssFontFamily(value) === undefined) {
    return [{ path, message: 'must be a safe, non-fetching CSS font family or stack' }]
  }
  if (runtimeValidator === 'styleInput') {
    try {
      resolveStyleStack(value as Parameters<typeof resolveStyleStack>[0])
    } catch (error) {
      return [{ path, message: `is invalid: ${error instanceof Error ? error.message : String(error)}` }]
    }
  }
  return []
}

function formatSchemaPath(path: SchemaPath): string {
  if (path.length === 0) return 'arguments'
  return path.reduce<string>((formatted, part) =>
    typeof part === 'number' ? `${formatted}[${part}]` : `${formatted}.${part}`, 'arguments')
}

/** Runtime-check one tool's arguments against the exact schema advertised by tools/list. */
export function validateMcpToolArguments(tool: McpToolDefinition, value: unknown): string[] {
  if (!plainJsonObject(value)) return ['arguments must be a plain JSON object']
  return validateSchemaValue(value, tool.inputSchema, tool.inputSchema, [], new Set())
    .map(problem => `${formatSchemaPath(problem.path)} ${problem.message}`)
}

export async function dispatchMcpRequest<Context>(req: JsonRpcRequest, context: Context, surface: McpServerSurface<Context>): Promise<JsonRpcResponse | null> {
  const raw = req as unknown as Record<string, unknown> | null
  const hasId = Boolean(raw && Object.prototype.hasOwnProperty.call(raw, 'id'))
  const rawId = raw?.id
  const validId = rawId === undefined || rawId === null || typeof rawId === 'string' || (typeof rawId === 'number' && Number.isFinite(rawId))
  const valid = Boolean(raw && raw.jsonrpc === '2.0' && typeof raw.method === 'string' && validId)
  const id = validId && rawId !== undefined ? rawId as number | string | null : null
  // Only a valid Request object without `id` is a notification. Malformed
  // envelopes still receive the spec's -32600 response with id:null.
  if (!valid) return rpcError(null, -32600, 'invalid JSON-RPC request')
  const notification = !hasId

  let response: JsonRpcResponse | null
  switch (req.method) {
    case 'initialize': {
      const protocolVersion = typeof surface.protocolVersion === 'function'
        ? surface.protocolVersion(req.params)
        : surface.protocolVersion
      response = reply(id, {
        protocolVersion,
        serverInfo: { name: surface.serverName ?? MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        capabilities: { tools: {} },
        instructions: surface.instructions,
      })
      break
    }
    case 'notifications/initialized': response = null; break
    case 'ping': response = reply(id, {}); break
    case 'tools/list': response = reply(id, { tools: surface.tools }); break
    case 'tools/call': {
      if (!plainJsonObject(req.params)) {
        response = rpcError(id, -32602, 'Invalid params: tools/call requires an object')
        break
      }
      const name = req.params.name
      if (typeof name !== 'string') {
        response = rpcError(id, -32602, 'Invalid params: tools/call requires `name` (string)')
        break
      }
      const tool = surface.tools.find(candidate => candidate.name === name)
      if (!tool) {
        response = rpcError(id, -32602, `Unknown tool: ${name}`)
        break
      }
      const args = req.params.arguments ?? {}
      const problems = validateMcpToolArguments(tool, args)
      if (problems.length > 0) {
        response = rpcError(id, -32602, `Invalid arguments for ${name}: ${problems.join('; ')}`)
        break
      }
      response = await surface.handleToolCall(id, { ...req.params, arguments: args }, context)
      break
    }
    case 'prompts/list': response = reply(id, { prompts: [] }); break
    case 'resources/list': response = reply(id, { resources: [] }); break
    default: response = rpcError(id, -32601, `Method not found: ${req.method}`)
  }
  return notification ? null : response
}

export function createExecuteTool(options: { sdkDeclaration: string; hosted?: boolean }): McpToolDefinition {
  const hostedNote = options.hosted
    ? `Hosted note: execute runs in an on-demand isolate and costs more than the direct
render_svg/render_ascii/render_png/verify/describe tools — prefer those for plain
render/verify calls. For straightforward structured edits, prefer the declarative
mutate/build tools; reserve execute for logic the ops don't express.

`
    : ''
  const timeoutDescription = options.hosted
    ? 'Optional CPU-time budget (default 5000ms, max 30000ms).'
    : 'Optional hard timeout (default 5000ms).'
  const runtime = options.hosted ? 'an isolated sandbox' : 'a sandboxed node:vm context'
  return {
    name: 'execute',
    description: `Run synchronous JavaScript against the mermaid SDK in ${runtime}.
Code runs as an expression or statement body — return the final value. Promise jobs,
async/await, and dynamic import are not supported.
Multi-step diagram edits should be one execute() call. The SDK declaration is
TypeScript-shaped for guidance; the sandbox does not transpile type annotations.
${hostedNote}SDK declaration:
${options.sdkDeclaration}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', description: 'JavaScript to execute; mermaid.* SDK is global.' },
        timeoutMs: { type: 'integer', minimum: 1, description: timeoutDescription },
      },
      required: ['code'],
    },
    annotations: SANDBOX_EXECUTE_ANNOTATIONS,
  }
}

export function createRenderPngTool(mode: 'local' | 'hosted'): McpToolDefinition {
  const hosted = mode === 'hosted'
  return {
    name: 'render_png',
    description: hosted
      ? `Rasterize a Mermaid source string to PNG. Returns { ok, png_base64 }.
Hosted rendering uses resvg-wasm with bundled fonts; bytes may differ from the
local napi renderer, so hosted PNG is a convenience surface, not part of the
byte-determinism contract. For file/URL artifacts use the local stdio server.`
      : `Rasterize a Mermaid source string to PNG. By default returns base64-encoded PNG bytes.
Set output to "file" or "url" to write a managed artifact instead; artifact responses include
{path?, url?, mimeType, bytes, sha256}. File/URL artifacts are generated under the MCP server's
artifact directory with safe names, size limits, and TTL cleanup.
Uses bundled resvg + Inter (DejaVu Sans fallback) for same-machine cross-runtime determinism where verified.
Agentic Mermaid outputs SVG, PNG, ASCII, Unicode, and JSON layout. For non-PNG output, use execute() with mermaid.renderMermaidSVG, mermaid.renderMermaidASCII (useAscii true for ASCII, false for Unicode), or verifyMermaid(...).layout — those are streaming text/data and don't need a dedicated tool.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        scale: { type: 'number', ...(hosted ? {} : { exclusiveMinimum: 0 }), description: hosted ? 'Output scale multiplier (default 2 — retina; clamped to 0.1–8).' : 'Output scale multiplier (default 2 — retina).' },
        background: { type: 'string', 'x-agentic-mermaid-runtime-validator': 'safeCssColor', description: 'CSS color override (defaults to the diagram background, then white).' },
        style: styleInputJsonSchema(hosted ? 'Style name | record | stack (same as render_svg). Hosted rasterization bundles the built-in style faces; custom unbundled fonts use Inter with DejaVu per-glyph fallback.' : 'Style: a name (hand-drawn, watercolor, …, or any theme name), an inline style record, or an array stack merged left → right.'),
        seed: { type: 'number', description: hosted ? 'Ink seed for styled looks.' : 'Re-rolls ink wobble of styled looks; never moves layout.' },
        options: { ...sharedRenderOptionsJsonSchema(), description: 'Shared advanced RenderOptions object; convenience fields above override matching values.' },
        ...(hosted ? {} : {
          output: { type: 'string', enum: ['base64', 'file', 'url'], description: 'PNG return mode (default base64).' },
          fontDirs: { type: 'array', items: { type: 'string' }, description: 'Additional local font directories for CJK/emoji glyph coverage.' },
          loadSystemFonts: { type: 'boolean', description: 'Also load operating-system fonts (default false).' },
        }),
      },
      required: ['source'],
    },
    annotations: hosted ? PURE_COMPUTE_ANNOTATIONS : MANAGED_ARTIFACT_ANNOTATIONS,
  }
}

export function createDescribeTool(): McpToolDefinition {
  return {
    name: 'describe',
    description: `Describe a Mermaid diagram. format=text returns { ok, text } with
one or two summary sentences; format=json returns { ok, tree } with the AX tree;
format=facts returns { ok, facts } with deterministic semantic fact lines for
machine checking (for example edge A -> B : label, member Duck +quack()).`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        format: { type: 'string', enum: ['text', 'json', 'facts'], description: 'text (default), json AX tree, or facts semantic read-back.' },
      },
      required: ['source'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  }
}
