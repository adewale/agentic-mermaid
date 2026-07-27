import { reply, rpcError, toolResult, type JsonRpcRequest, type JsonRpcResponse } from './protocol.ts'
import {
  META_SERVER_INFO,
  isLegacyProtocolVersion,
  isModernProtocolVersion,
  mcpClientCapabilitiesProblems,
  mcpImplementationProblems,
  usesToolErrorForInvalidArguments,
  type ProtocolEra,
} from './protocol-versions.ts'
import { admitMcpMessage, type AdmittedMcpMessage } from './admission.ts'
import { PACKAGE_VERSION } from '../version.ts'
import {
  sharedRenderOptionsJsonSchema,
  validateSerializableRenderOptions,
  type SharedRenderOptionField,
} from '../render-contract.ts'
import { normalizePortablePngBackground, pngOutputOptionsJsonSchema } from '../png-contract.ts'
import { resolveStyleStack } from '../scene/style-registry.ts'
import { safeCssColor, safeCssPaint } from '../shared/css-color.ts'
import { safeCssFontFamily } from '../shared/css-font.ts'
import {
  limitJsonConfigDiagnostics,
  validateJsonConfigAdmission,
} from '../shared/json-config-admission.ts'
import type { RenderOptions } from '../types.ts'

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
  /** Every revision this surface implements, newest-relevant order preserved.
   *  Reported by server/discover and by UnsupportedProtocolVersionError.
   *  Defaults to the single pinned `protocolVersion` when it is a constant. */
  supportedVersions?: readonly string[]
  tools: McpToolDefinition[]
  instructions: string
  handleToolCall(id: number | string | null, params: unknown, context: Context): JsonRpcResponse | Promise<JsonRpcResponse>
}

export interface McpDispatchOptions {
  /** The version negotiated by a stateful transport. Supplies the version for
   *  legacy requests, whose bodies carry none; never overrides modern `_meta`.
   *  HTTP passes its header through admission's distinct `headerVersion` field
   *  so only a real mirror disagreement can become HeaderMismatch. */
  protocolVersion?: string | null
  /** Connection-scoped era selected by a stateful transport. Hosted HTTP leaves
   *  this unset because its dual-era endpoint classifies each independent POST;
   *  stdio sets it after the client opens with initialize or modern metadata. */
  protocolEra?: ProtocolEra
  /**
   * Revisions THIS TRANSPORT serves, when they are narrower than the surface's.
   *
   * One dispatcher can sit behind several transports whose obligations differ:
   * the local server answers over stdio and over a 2024-11-05-era HTTP+SSE
   * transport, and a revision the dispatcher implements is not thereby served
   * over a transport that cannot carry it. `server/discover` must answer for
   * the transport the request actually arrived on, so this NARROWS the surface
   * list — it never widens it, because a transport cannot add a capability the
   * dispatcher lacks.
   */
  supportedVersions?: readonly string[]
}

// The LOCAL stdio/HTTP server identity. The hosted transport reports its own
// name (HOSTED_MCP_SERVER_NAME in hosted-server.ts): registries and clients
// cache tool lists by server identity, and the two surfaces expose different
// tools (4 local vs 9 hosted), so they must not share one.
export const MCP_SERVER_NAME = 'agentic-mermaid-mcp'
// The release identity gate keeps this runtime-safe constant synchronized with
// package.json so every MCP handshake reports the published package version.
export const MCP_SERVER_VERSION = PACKAGE_VERSION
const SERVER_CAPABILITIES = { tools: {}, prompts: {}, resources: {} } as const
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

export function mcpRenderOptionSchemaProperties(
  optionsDescription: string,
): Record<string, unknown> {
  return {
    options: { ...sharedRenderOptionsJsonSchema(), description: optionsDescription },
  }
}

export function projectMcpRenderOptions(
  args: Readonly<Record<string, unknown>>,
): RenderOptions {
  const nested = args.options === undefined ? {} : args.options
  const nestedProblems = validateSerializableRenderOptions(nested)
  if (nestedProblems.length > 0) throw new Error(`invalid render options: ${nestedProblems.join('; ')}`)
  const projected: Record<string, unknown> = { ...(nested as RenderOptions) }
  const problems = validateSerializableRenderOptions(projected)
  if (problems.length > 0) throw new Error(`invalid render options: ${problems.join('; ')}`)
  return projected as RenderOptions
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

  const oneOf = Array.isArray(schema.oneOf)
    ? schema.oneOf.map(schemaRecord).filter((entry): entry is JsonSchema => entry !== undefined)
    : []
  if (oneOf.length > 0) {
    const matching = oneOf.filter(candidate =>
      validateSchemaValue(value, candidate, root, path, new Set(ancestors)).length === 0)
    if (matching.length !== 1) {
      return [{ path, message: `must match exactly one allowed shape (matched ${matching.length})` }]
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


  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      return [{ path, message: `must contain at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}` }]
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern, 'u').test(value)) {
          if (schema['x-agentic-mermaid-runtime-validator'] === 'portablePngBackground') {
            return [{ path, message: 'must be a portable basic color keyword or 3, 4, 6, or 8 digit hex color' }]
          }
          return [{ path, message: `must match ${schema.pattern}` }]
        }
      } catch {
        return [{ path, message: 'uses an invalid schema pattern' }]
      }
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      return [{ path, message: `must contain at most ${schema.maxLength} characters` }]
    }
  }

  if (Array.isArray(value) && type === 'array') {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      return [{ path, message: `must contain at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}` }]
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      return [{ path, message: `must contain at most ${schema.maxItems} items` }]
    }
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

  if (plainJsonObject(value) && (type === 'object'
    || schema.properties !== undefined
    || schema.required !== undefined
    || schema.additionalProperties !== undefined)) {
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
  if (runtimeValidator === 'portablePngBackground' && normalizePortablePngBackground(value) === undefined) {
    return [{ path, message: 'must be a portable basic color keyword or 3, 4, 6, or 8 digit hex color' }]
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
  const admissionProblems = validateJsonConfigAdmission(value)
  if (admissionProblems.length > 0) {
    return limitJsonConfigDiagnostics(admissionProblems.map(problem =>
      `${formatSchemaPath(problem.path)} ${problem.message}`), 'arguments')
  }
  const problems = validateSchemaValue(value, tool.inputSchema, tool.inputSchema, [], new Set())
    .map(problem => `${formatSchemaPath(problem.path)} ${problem.message}`)
  return limitJsonConfigDiagnostics(problems, 'arguments')
}

/** The versions a surface implements: its explicit list, else its pinned constant. */
export function surfaceSupportedVersions<Context>(surface: McpServerSurface<Context>, options: McpDispatchOptions = {}): readonly string[] {
  const surfaceVersions = surface.supportedVersions
    ?? (typeof surface.protocolVersion === 'string' ? [surface.protocolVersion] : [])
  if (!options.supportedVersions) return surfaceVersions
  // Intersect rather than replace: a transport narrows what the dispatcher can
  // do, so a transport list may not introduce a revision the surface lacks.
  return surfaceVersions.filter(version => options.supportedVersions!.includes(version))
}

/** server/discover is the modern replacement for initialize. Its version list
 * is deliberately modern-only: legacy revisions are negotiated by initialize
 * and do not belong in this method's stateless contract. */
function discoverResult<Context>(surface: McpServerSurface<Context>, supportedVersions: readonly string[]) {
  return {
    supportedVersions: supportedVersions.filter(isModernProtocolVersion),
    capabilities: SERVER_CAPABILITIES,
    instructions: surface.instructions,
  }
}

function initializeParamsProblems(params: unknown): string[] {
  if (!plainJsonObject(params)) return ['params is required and must be an object']
  const problems: string[] = []
  if (typeof params.protocolVersion !== 'string') {
    problems.push('params.protocolVersion is required and must be a string')
  }
  problems.push(...mcpClientCapabilitiesProblems(params.capabilities, 'params.capabilities'))
  problems.push(...mcpImplementationProblems(params.clientInfo, 'params.clientInfo'))
  return problems
}

export async function dispatchMcpRequest<Context>(req: JsonRpcRequest, context: Context, surface: McpServerSurface<Context>, options: McpDispatchOptions = {}): Promise<JsonRpcResponse | null> {
  const servedVersions = surfaceSupportedVersions(surface, options)
  const admission = admitMcpMessage(req, {
    supportedVersions: servedVersions,
    negotiatedVersion: options.protocolVersion,
    protocolEra: options.protocolEra,
  })
  if (!admission.ok) return admission.response
  return dispatchAdmittedMcpRequest(admission.message, context, surface)
}

/** Execute a message that has crossed the sole raw/protocol admission boundary.
 * Cache and transport code call this form so dispatch cannot reclassify it. */
export async function dispatchAdmittedMcpRequest<Context>(message: AdmittedMcpMessage, context: Context, surface: McpServerSurface<Context>): Promise<JsonRpcResponse | null> {
  const { request: req, id, notification, protocol } = message
  const { era, version, supportedVersions: servedVersions } = protocol

  let response: JsonRpcResponse | null
  switch (req.method) {
    // initialize / notifications/initialized / ping are REMOVED in the modern
    // era. Under a modern request they are simply unknown methods; a legacy
    // request keeps the handshake it depends on.
    case 'initialize': {
      if (era === 'modern') { response = unknownMethod(id, req.method); break }
      const problems = initializeParamsProblems(req.params)
      if (problems.length > 0) {
        response = rpcError(id, -32602, `Invalid params: ${problems.join('; ')}`)
        break
      }
      // Echo the client's version when this transport serves it. Advertising a
      // revision in server/discover and then refusing to negotiate it would
      // reproduce, inside one server, the exact mismatch per-transport
      // reporting exists to remove.
      const offered = (req.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
      const legacyServedVersions = servedVersions.filter(isLegacyProtocolVersion)
      const fallbackLegacyVersion = legacyServedVersions.at(-1)
        ?? (typeof surface.protocolVersion === 'function' ? surface.protocolVersion(req.params) : surface.protocolVersion)
      const protocolVersion = isLegacyProtocolVersion(offered) && legacyServedVersions.includes(offered)
        ? offered
        : fallbackLegacyVersion
      response = reply(id, {
        protocolVersion,
        serverInfo: { name: surface.serverName ?? MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        capabilities: SERVER_CAPABILITIES,
        instructions: surface.instructions,
      })
      break
    }
    case 'notifications/initialized': response = era === 'modern' ? unknownMethod(id, req.method) : null; break
    case 'ping': response = era === 'modern' ? unknownMethod(id, req.method) : reply(id, {}); break
    case 'server/discover': response = era === 'modern'
      ? reply(id, discoverResult(surface, servedVersions))
      : unknownMethod(id, req.method); break
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
        const message = `Invalid arguments for ${name}: ${problems.join('; ')}`
        // SEP-1303 (2025-11-25): an input-validation failure is a TOOL
        // execution error, not a protocol error, so the model can read it and
        // self-correct instead of seeing a transport fault. The diagnostic text
        // is identical either way — only the envelope changes.
        response = usesToolErrorForInvalidArguments(version)
          ? toolResult(id, { ok: false, error: { code: 'INVALID_ARGUMENTS', message } }, true)
          : rpcError(id, -32602, message)
        break
      }
      response = await surface.handleToolCall(id, { ...req.params, arguments: args }, context)
      break
    }
    case 'prompts/list': response = reply(id, { prompts: [] }); break
    case 'resources/list': response = reply(id, { resources: [] }); break
    default: response = unknownMethod(id, req.method)
  }
  return notification ? null : decorateMcpResult(response, req.method, era, surface.serverName ?? MCP_SERVER_NAME)
}

/**
 * How long a client may treat a list result as fresh. The tool surface is fixed
 * at build time and changes only when a deploy changes it, so the only staleness
 * this can cause is a client holding a previous deploy's list for up to this
 * long. Five minutes bounds that while removing essentially all repeat listing
 * traffic, and is the value the spec's own example uses.
 */
export const LIST_RESULT_TTL_MS = 300_000

/** The operations the spec requires caching hints on, intersected with ours. */
const CACHEABLE_METHODS = new Set(['server/discover', 'tools/list', 'prompts/list', 'resources/list'])

/**
 * Result fields this revision requires, applied on the MODERN path only.
 *
 * `resultType` is a MUST — "The `result` MUST include a `resultType` field to
 * indicate the type of the result" — and legacy results must NOT grow it: "For
 * backward compatibility with servers implementing earlier protocol versions,
 * which do not include `resultType`, clients MUST treat an absent `resultType`
 * as `complete`". Every result we return is terminal, since no tool of ours asks
 * the client for more input, so `complete` is the only value we can produce.
 *
 * Caching hints are a MUST too, not the optional nicety the migration plan
 * recorded them as: "Servers MUST include caching hints on results with
 * `resultType: 'complete'` returned by the following operations: server/discover,
 * tools/list, …". Ours are identical for every caller and carry no user data, so
 * `public` is the honest scope — and the spec is explicit that a public result
 * may be shared across authorization contexts, which is true of a static tool
 * list by construction.
 *
 * Errors are left alone: caching hints and `resultType` live on results.
 */
export function decorateMcpResult(response: JsonRpcResponse | null, method: string, era: ProtocolEra, serverName: string): JsonRpcResponse | null {
  if (era !== 'modern' || !response || !plainJsonObject(response.result)) return response
  const existingMeta = plainJsonObject(response.result._meta) ? response.result._meta : {}
  const result: Record<string, unknown> = {
    resultType: 'complete',
    ...response.result,
    _meta: {
      ...existingMeta,
      [META_SERVER_INFO]: { name: serverName, version: MCP_SERVER_VERSION },
    },
  }
  if (CACHEABLE_METHODS.has(method)) {
    result.ttlMs = LIST_RESULT_TTL_MS
    result.cacheScope = 'public'
  }
  return { ...response, result }
}

/** Strip response-era fields before a deterministic tool result enters the
 * shared compute cache. Cache hits are decorated again for the current request,
 * so a legacy fill can never dictate a modern envelope (or vice versa). */
export function protocolNeutralMcpResult(result: unknown): unknown {
  if (!plainJsonObject(result)) return result
  const { resultType: _resultType, ttlMs: _ttlMs, cacheScope: _cacheScope, _meta, ...neutral } = result
  if (plainJsonObject(_meta)) {
    const { [META_SERVER_INFO]: _serverInfo, ...retainedMeta } = _meta
    if (Object.keys(retainedMeta).length > 0) neutral._meta = retainedMeta
  }
  return neutral
}

/** -32601, which the HTTP transport maps to 404 for modern requests. */
function unknownMethod(id: number | string | null, method: string): JsonRpcResponse {
  return rpcError(id, -32601, `Method not found: ${method}`)
}

export function createExecuteTool(options: { sdkDeclaration: string; hosted?: boolean }): McpToolDefinition {
  const hostedNote = options.hosted
    ? `Hosted note: execute runs in an on-demand isolate and costs more than the direct
render_svg/render_ascii/render_png/verify/describe tools — prefer those for plain
render/verify calls. For straightforward structured edits, prefer the declarative
mutate/build tools; reserve execute for logic the ops don't express.
Hosted mermaid.renderMermaidSVG*, renderMermaidASCII*, and
layoutMermaidWithReceipt calls force security:'strict' and
embedFontImport:false; caller code cannot weaken that host policy.

`
    : ''
  const timeoutDescription = options.hosted
    ? 'Optional CPU-time budget (default 5000ms, max 30000ms).'
    : 'Optional hard timeout (default 5000ms).'
  const runtime = options.hosted ? 'an isolated sandbox' : 'a sandboxed node:vm context'
  return {
    name: 'execute',
    description: `Run JavaScript in ${runtime}; return a value.
One call composes edits. Submit JavaScript; declaration types are guidance.
No promises, async/await, dynamic import, or type annotations.
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
  const pngSchema = pngOutputOptionsJsonSchema(hosted ? 'portable' : 'native')
  const pngProperties = pngSchema.properties as Record<string, JsonSchema>
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
        ...pngProperties,
        ...mcpRenderOptionSchemaProperties('Shared advanced RenderOptions object.'),
        ...(hosted ? {} : {
          output: { type: 'string', enum: ['base64', 'file', 'url'], description: 'PNG return mode (default base64).' },
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
