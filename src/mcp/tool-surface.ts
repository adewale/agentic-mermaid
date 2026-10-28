import { reply, rpcError, toolResult, type JsonRpcRequest, type JsonRpcResponse } from './protocol.ts'
import { DESCRIBE_FORMATS } from '../agent/describe.ts'
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
  renderSchemaProblems,
  type SharedRenderOptionField,
} from '../render-contract.ts'
import { normalizePortablePngBackground, pngOutputOptionsJsonSchema } from '../png-contract.ts'
import {
  limitJsonConfigDiagnostics,
  validateJsonConfigAdmission,
} from '../shared/json-config-admission.ts'
import type { RenderOptions } from '../types.ts'
import { isPlainRecord } from '../shared/plain-data.ts'
import { validateJsonSchema, type SchemaPath, type JsonSchema } from '../shared/schema-validation.ts'

export interface McpToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export const MCP_PNG_OUTPUT_MODES = Object.freeze(['base64', 'file', 'url'] as const)
export type McpPngOutputMode = typeof MCP_PNG_OUTPUT_MODES[number]

export function isMcpPngOutputMode(value: unknown): value is McpPngOutputMode {
  return typeof value === 'string' && MCP_PNG_OUTPUT_MODES.includes(value as McpPngOutputMode)
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
// The product surface is tools-only. Advertising an empty prompt/resource
// namespace makes clients probe methods we do not implement and overstates the
// server's scope; optional MCP features must be claimed only when complete.
const SERVER_CAPABILITIES = { tools: {} } as const
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
  const requested = args.options
  const nested = requested === undefined ? {} : requested
  if (!isPlainRecord(nested)) throw new Error('invalid render options: render options must be a plain JSON object')
  // Capture enumerable top-level values before validation. Validating the live
  // record first could read a different getter value when projecting it.
  const projected: Record<string, unknown> = { ...(nested as RenderOptions) }
  const problems = validateSerializableRenderOptions(projected)
  if (problems.length > 0) throw new Error(`invalid render options: ${problems.join('; ')}`)
  return projected as RenderOptions
}

function formatSchemaPath(path: SchemaPath): string {
  if (path.length === 0) return 'arguments'
  return path.reduce<string>((formatted, part) =>
    typeof part === 'number' ? `${formatted}[${part}]` : `${formatted}.${part}`, 'arguments')
}

/** Runtime-check one tool's arguments against the exact schema advertised by tools/list. */
export function validateMcpToolArguments(tool: McpToolDefinition, value: unknown): string[] {
  if (!isPlainRecord(value)) return ['arguments must be a plain JSON object']
  const admissionProblems = validateJsonConfigAdmission(value)
  if (admissionProblems.length > 0) {
    return limitJsonConfigDiagnostics(admissionProblems.map(problem =>
      `${formatSchemaPath(problem.path)} ${problem.message}`), 'arguments')
  }
  const problems = validateJsonSchema(value, tool.inputSchema, tool.inputSchema, [], {
    patternMismatch: schema => schema['x-agentic-mermaid-runtime-validator'] === 'portablePngBackground'
      ? 'must be a portable basic color keyword or 3, 4, 6, or 8 digit hex color' : undefined,
    validateRuntime: (value, schema, path) => {
      const validator = schema['x-agentic-mermaid-runtime-validator']
      if (validator === 'portablePngBackground') {
        return normalizePortablePngBackground(value) === undefined
          ? [{ path, message: 'must be a portable basic color keyword or 3, 4, 6, or 8 digit hex color', generic: false }] : []
      }
      // Cross-field geometry belongs to the normalized RenderOptions boundary;
      // the advertised wire schema continues to validate its individual fields.
      return validator === 'architectureVisual' ? [] : renderSchemaProblems(value, schema, path)
    },
  })
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
 * reports every revision this exact surface/transport accepts, including
 * legacy revisions a dual-era client may select for its next request. */
function discoverResult<Context>(surface: McpServerSurface<Context>, supportedVersions: readonly string[]) {
  return {
    supportedVersions: [...supportedVersions],
    capabilities: SERVER_CAPABILITIES,
    instructions: surface.instructions,
  }
}

function initializeParamsProblems(params: unknown): string[] {
  if (!isPlainRecord(params)) return ['params is required and must be an object']
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
      if (!isPlainRecord(req.params)) {
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
const CACHEABLE_METHODS = new Set(['server/discover', 'tools/list'])

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
  if (era !== 'modern' || !response || !isPlainRecord(response.result)) return response
  const existingMeta = isPlainRecord(response.result._meta) ? response.result._meta : {}
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
  if (!isPlainRecord(result)) return result
  const { resultType: _resultType, ttlMs: _ttlMs, cacheScope: _cacheScope, _meta, ...neutral } = result
  if (isPlainRecord(_meta)) {
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
    ? `SVG/ASCII/layout enforce
security:'strict', embedFontImport:false.

`
    : ''
  const timeoutDescription = options.hosted
    ? 'Optional CPU-time budget (default 5000ms, max 30000ms).'
    : 'Optional hard timeout (default 5000ms).'
  const runtime = options.hosted ? 'an isolated sandbox' : 'a sandboxed node:vm context'
  return {
    name: 'execute',
    title: 'Execute Mermaid SDK code',
    description: `Run JavaScript in ${runtime}; return a value.
No promises, async/await, dynamic import, or type annotations.
${hostedNote}SDK:
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
    title: 'Render Mermaid as PNG',
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
          output: { type: 'string', enum: [...MCP_PNG_OUTPUT_MODES], description: 'PNG return mode (default base64).' },
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
    title: 'Describe Mermaid diagram',
    description: `Describe a Mermaid diagram. format=text returns { ok, text } with
one or two summary sentences; format=json returns { ok, tree } with the AX tree;
format=facts returns { ok, facts } with deterministic semantic fact lines for
machine checking (for example edge A -> B : label, member Duck +quack()).`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        format: { type: 'string', enum: [...DESCRIBE_FORMATS], description: 'text (default), json AX tree, or facts semantic read-back.' },
      },
      required: ['source'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  }
}
