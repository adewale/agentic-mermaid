// Hosted MCP server core — the tool surface served at agentic-mermaid.dev/mcp
// by the Cloudflare website Worker. Runtime-neutral: pure tools run inline;
// `execute` and `render_png` are injected by the host (the Worker backs them
// with a Dynamic Worker isolate and resvg-wasm; tests back them with fakes).
//
// This surface deliberately differs from the local Code Mode server
// (docs/mcp-code-mode-rationale.md): locally, `execute` is free and stays the
// single entry point. Hosted, every `execute` spins a billable isolate, so the
// common render/verify paths get direct pure tools that cost one ordinary
// Worker invocation and are eligible for the private compute cache.

import { parseRegisteredMermaid } from '../agent/parse.ts'
import { configWarningsForMermaid, verifyMermaid } from '../agent/verify.ts'
import { applyOps } from '../agent/apply.ts'
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'
import { knownStyleDescriptors } from '../scene/style-registry.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { renderMermaidSVGWithReceipt, renderMermaidASCIIWithReceipt } from '../agent/core.ts'
import { verifyNoExternalRefs } from '../index.ts'
import { unsupportedCodeReason } from './facade.ts'
import { rpcError, toolResult, type JsonRpcRequest, type JsonRpcResponse } from './protocol.ts'
import {
  EXECUTE_TIMEOUT_ERROR,
  PURE_COMPUTE_ANNOTATIONS,
  createDescribeTool,
  createExecuteTool,
  createRenderPngTool,
  dispatchMcpRequest,
  isValidExecuteTimeout,
  mcpRenderOptionSchemaProperties,
  projectMcpRenderOptions,
  validateMcpToolArguments,
  withClosedMcpInputSchema,
  type McpServerSurface,
} from './tool-surface.ts'
import { SDK_CORE_DECLARATION, createDescribeSdkTool, describeSdkPayload } from './sdk-discovery.ts'
import { mcpDescribePayload, mcpVerificationSummary } from './describe-payload.ts'
import type { ExecuteResult } from './sandbox.ts'
import type { PngRasterResult } from '../shared/png-font-warnings.ts'
import type { RenderOptions } from '../types.ts'
import { HOSTED_RENDER_OPTIONS } from '../render-host-policy.ts'
import {
  MAX_HOSTED_PNG_BYTES,
  projectPortablePngOutputOptions,
  resolvePortablePngOutputPolicy,
  type PortablePngOutputOptions,
} from '../png-contract.ts'
import {
  familyDetectionDiagnosticFromPreservedBody,
  MermaidFamilyDetectionError,
} from '../family-detection.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import { boundedUtf8ByteLength } from '../shared/utf8.ts'

export type { ExecuteResult }

/** Internal execution facts for the request log. This never reaches an MCP
 * client: the hosted transport consumes it through the optional callback. */
export interface HostedExecuteTelemetry {
  loaderAttempts: 1 | 2
}

export interface HostedMcpContext {
  /** Run Code Mode JavaScript. Hosted: a Dynamic Worker isolate. */
  execute(code: string, timeoutMs: number, onTelemetry?: (telemetry: HostedExecuteTelemetry) => void): Promise<ExecuteResult>
  /** Rasterize SVG to PNG bytes. Hosted: resvg-wasm. Absent → render_png reports unavailable. */
  renderPng?(source: string, opts: RenderOptions & import('../png-contract.ts').PortablePngOutputOptions): Promise<PngRasterResult>
}

// Streamable HTTP clients negotiate 2025-03-26+; the node transports pin
// 2024-11-05. Echo whichever supported version the client offers.
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
const DEFAULT_PROTOCOL_VERSION = '2025-03-26'

// Hosted server identity, distinct from the local stdio server's
// MCP_SERVER_NAME: registries and clients cache tool lists by server identity,
// and this surface (9 tools) must never shadow the local one (4 tools).
export const HOSTED_MCP_SERVER_NAME = 'agentic-mermaid-hosted'

export const MAX_SOURCE_BYTES = 64 * 1024
export const MAX_CODE_BYTES = 64 * 1024
const MAX_EXECUTE_TIMEOUT_MS = 30_000
const DEFAULT_EXECUTE_TIMEOUT_MS = 5_000

// Shared with the transport's 413 (total-body cap) so every "too big" refusal
// points at the same way out.
export const LOCAL_FALLBACK_HINT = 'run the local agentic-mermaid CLI or stdio MCP server instead (see https://agentic-mermaid.dev/docs/mcp/)'
const TOO_LARGE_HINT = `input exceeds the hosted size cap; ${LOCAL_FALLBACK_HINT}`

// Keep hosted discovery aligned with the style registry. This description is
// the only built-in look menu available to clients that do not call execute.
const BUILTIN_LOOK_NAMES = knownStyleDescriptors()
  .filter(descriptor => descriptor.kind === 'look')
  .map(descriptor => descriptor.inputName)
const BUILTIN_PALETTE_NAMES = knownStyleDescriptors()
  .filter(descriptor => descriptor.kind === 'palette')
  .map(descriptor => descriptor.inputName)

export const HOSTED_TOOLS = [
  createExecuteTool({ sdkDeclaration: SDK_CORE_DECLARATION, hosted: true }),
  withClosedMcpInputSchema(createDescribeSdkTool()),
  {
    name: 'render_svg',
    description: `Render a Mermaid source string to themeable SVG. Returns { ok, svg }.
Layout is deterministic: identical input produces identical geometry. The hosted
boundary forces security:'strict' and embedFontImport:false.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        ...mcpRenderOptionSchemaProperties(
          `Shared advanced RenderOptions object. Styles accept a registered Look (${BUILTIN_LOOK_NAMES.join(', ')}), Palette (${BUILTIN_PALETTE_NAMES.join(', ')}), inline record, or left-to-right stack.`,
        ),
      },
      required: ['source'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
  {
    name: 'render_ascii',
    description: `Render a Mermaid source string to text. Returns { ok, text }.
useAscii true → plain ASCII (+,-,|); false/absent → Unicode box drawing (┌,─,│).
targetWidth sets a hard terminal display-cell bound; impossible bounds return a typed error.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        useAscii: { type: 'boolean', description: 'true = ASCII characters, false = Unicode (default).' },
        targetWidth: { type: 'integer', minimum: 1, description: 'Hard maximum line width in terminal display cells.' },
        ...mcpRenderOptionSchemaProperties('Shared advanced RenderOptions object, including style/palette/config/security.'),
      },
      required: ['source'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
  createRenderPngTool('hosted'),
  {
    name: 'verify',
    description: `Parse and verify a Mermaid diagram without rendering it. Returns
{ ok, family, summary, warnings, layout: { bounds, nodes, edges } } for valid
diagrams and { ok: false, errors } for parse failures. \`family\` is the detected
diagram family and \`summary\` a one-line description — check them: ok:true only
means the diagram is structurally valid, not that it is the kind you intended.
Warnings use the layout-rubric codes.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
      },
      required: ['source'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
  createDescribeTool(),
  {
    name: 'mutate',
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
field types, enum values, defaults, and constraints.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: { type: 'string', description: 'Mermaid source to edit.' },
        ops: { type: 'array', minItems: 1, items: { type: 'object' }, description: 'Non-empty ordered list of edit ops; each is { kind, ...fields }.' },
      },
      required: ['source', 'ops'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
  {
    name: 'build',
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
        ops: { type: 'array', minItems: 1, items: { type: 'object' }, description: 'Non-empty ordered list of ops; each is { kind, ...fields }.' },
      },
      required: ['family', 'ops'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
]

const INSTRUCTIONS = `agentic-mermaid hosted MCP server (stateless). Direct tools render_svg, render_ascii, render_png, verify, and describe cover plain render/verify calls cheaply. Successful deterministic pure-tool results may be reused by a private server-side compute cache for up to 24 hours; execute, mutate, and build bypass it. HTTP /mcp responses themselves are cache-control: no-store, so clients must not infer response freshness from CDN headers. The x-agentic-mermaid-compute-cache response header reports hit, miss, mixed, bypass, or disabled. There is no layout seed — the library's optional style seed only re-rolls ink of styled looks. describe_sdk progressively discloses one family's version-matched mutation schema. Declarative mutate/build apply typed op lists and verify before emitting source; prefer them for straightforward structured edits. execute runs synchronous JavaScript against the typed mermaid.* SDK in an isolated on-demand sandbox for logic the ops don't express; async/await and Promise jobs are not supported, and network access is disabled. Inputs are capped at 64KB; for bigger diagrams, Code Mode artifacts, or file/URL PNG output, run the local stdio server (see https://agentic-mermaid.dev/docs/mcp/).`

function hostedProtocolVersion(params: unknown): string {
  const offered = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion
  return typeof offered === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(offered) ? offered : DEFAULT_PROTOCOL_VERSION
}

const HOSTED_SURFACE: McpServerSurface<HostedMcpContext> = {
  protocolVersion: hostedProtocolVersion,
  serverName: HOSTED_MCP_SERVER_NAME,
  tools: HOSTED_TOOLS,
  instructions: INSTRUCTIONS,
  handleToolCall,
}

export async function handleHostedRequest(req: JsonRpcRequest, context: HostedMcpContext): Promise<JsonRpcResponse | null> {
  return dispatchMcpRequest(req, context, HOSTED_SURFACE)
}


async function handleToolCall(id: number | string | null, params: unknown, context: HostedMcpContext): Promise<JsonRpcResponse> {
  const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined
  const name = p?.name
  const args = p?.arguments ?? {}
  switch (name) {
    case 'execute': return handleExecute(id, args, context)
    case 'describe_sdk': {
      try {
        return toolResult(id, describeSdkPayload(args), false)
      } catch (e) {
        return rpcError(id, -32602, e instanceof Error ? e.message : String(e))
      }
    }
    case 'render_svg': return sourceTool(id, args, source => {
      const rendered = renderMermaidSVGWithReceipt(source, svgOptions(args))
      const safety = verifyNoExternalRefs(rendered.svg)
      if (!safety.ok) throw new Error(`strict SVG safety invariant failed: ${safety.refs.join(', ')}`)
      return {
        ok: true as const,
        svg: rendered.svg,
        receipt: rendered.receipt,
        warnings: sourceConfigWarnings(source),
      }
    })
    case 'render_ascii': return sourceTool(id, args, source => {
      const projectionWarnings: unknown[] = []
      const rendered = renderMermaidASCIIWithReceipt(source, {
        ...projectMcpRenderOptions(args),
        ...HOSTED_RENDER_OPTIONS,
        useAscii: args.useAscii === true,
        targetWidth: args.targetWidth as number | undefined,
        colorMode: 'none',
        onProjectionDiagnostic: diagnostic => projectionWarnings.push(diagnostic),
      })
      return {
        ok: true as const,
        text: rendered.text,
        receipt: rendered.receipt,
        warnings: [...sourceConfigWarnings(source), ...projectionWarnings],
      }
    })
    case 'render_png': return handleRenderPng(id, args, context)
    case 'verify': return sourceTool(id, args, source => {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) {
        // Self-describing tool: when the header names a known family, hand back
        // that family's canonical example so a failed authoring attempt gets the
        // correct dialect in the same response — no need to fetch capabilities.json.
        const hint = familyExampleForSource(source)
        return { ok: false as const, errors: parsed.error, ...(hint ?? {}) }
      }
      if (parsed.value.body.kind === 'preserved') {
        throw new MermaidFamilyDetectionError(
          familyDetectionDiagnosticFromPreservedBody(parsed.value.body),
        )
      }
      const v = verifyMermaid(parsed.value)
      const summary = mcpVerificationSummary(parsed.value)
      // Echo the detected family + a one-line summary so `ok:true` is never a
      // silent pass on the wrong kind of diagram: an agent that asked for an
      // architecture diagram and reads `family:"flowchart"` here sees the
      // mismatch in the same result it was already going to read, without
      // having to know to call `describe` separately.
      return { ok: v.ok, family: parsed.value.kind, summary, warnings: v.warnings, layout: { bounds: v.layout.bounds, nodes: v.layout.nodes.length, edges: v.layout.edges.length } }
    })
    case 'describe': return sourceTool(id, args, source => mcpDescribePayload(source, args))
    case 'mutate': return handleApplyOps(id, args, 'source')
    case 'build': return handleApplyOps(id, args, 'family')
    default: return rpcError(id, -32602, `Unknown tool: ${name ?? '<none>'}`)
  }
}

/**
 * When a source's header names a known family, return that family's id and its
 * canonical (verified) example so a parse failure can hand back the correct
 * dialect in the same response. Matched by the family's own header keyword, so a
 * `graph`/`flowchart`/`architecture-beta`/… first line resolves deterministically.
 */
function sourceConfigWarnings(source: string) {
  return configWarningsForMermaid(source)
}

function familyExampleForSource(source: string): { family: string; example: string } | undefined {
  const first = source.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? ''
  const header = first.split(/\s+/)[0] ?? ''
  for (const f of BUILTIN_FAMILY_METADATA) {
    if (f.headers.some(h => header === h)) return { family: f.id, example: f.example }
  }
  return undefined
}

function svgOptions(args: Record<string, unknown>): RenderOptions {
  // Public MCP SVG is commonly embedded by downstream agent UIs. It must
  // never carry active tags/event handlers or external fetches from Mermaid
  // init/config payloads; unlike the local library, this direct tool exposes no
  // caller-selectable security mode.
  const opts = projectMcpRenderOptions(args)
  // The hosted boundary owns this policy. An advanced options object cannot
  // weaken it even though the same canonical request fields are accepted.
  return { ...opts, ...HOSTED_RENDER_OPTIONS }
}

// ---- Effective (normalized) arguments -------------------------------------

interface NormalizedHostedPngRequest {
  readonly output: PortablePngOutputOptions
  readonly render: RenderOptions
}

/** One normalized request projection shared by execution and cache identity. */
function normalizedHostedPngRequest(args: Record<string, unknown>): NormalizedHostedPngRequest {
  const requestedOutput = projectPortablePngOutputOptions(args)
  const policy = resolvePortablePngOutputPolicy(requestedOutput)
  const output: PortablePngOutputOptions = {
    scale: policy.scale,
    ...(policy.background.mode === 'explicit' ? { background: policy.background.value } : {}),
    ...(policy.fitTo.mode === 'width'
      ? { fitTo: { width: policy.fitTo.value } }
      : policy.fitTo.mode === 'height'
        ? { fitTo: { height: policy.fitTo.value } }
        : {}),
  }
  return {
    output,
    render: {
      ...projectMcpRenderOptions(args),
      ...HOSTED_RENDER_OPTIONS,
    },
  }
}

/** Cache identity is the normalized request projection, not another copied
 * list of shared fields. */
function effectiveSvgArgs(args: Record<string, unknown>): Record<string, unknown> {
  return { render: svgOptions(args) }
}

/**
 * Canonical cache-key inputs for a tools/call: validated, normalized,
 * output-affecting inputs only. Validation against the exact advertised schema
 * happens before any key is returned, so an invalid request cannot collide with
 * a cached valid response and bypass dispatch. Semantically identical valid
 * calls may then share an entry. Non-idempotent execute is never cached.
 *
 * Source payloads are likewise keyed verbatim. Canonicalizing source or
 * arguments is deliberately avoided because a wrong cached result is worse
 * than a missed dedup.
 */
export function cacheKeyFor(name: string | undefined, args: Record<string, unknown>): unknown | null {
  const tool = HOSTED_TOOLS.find(candidate => candidate.name === name)
  if (!tool || validateMcpToolArguments(tool, args).length > 0) return null
  switch (name) {
    // Code Mode intentionally exposes time and randomness and is annotated
    // non-idempotent. Never freeze its first result in the shared compute cache.
    case 'execute':
      return null
    case 'render_svg':
      return typeof args.source === 'string' ? { t: 'render_svg', source: args.source, ...effectiveSvgArgs(args) } : null
    case 'render_ascii':
      return typeof args.source === 'string' ? {
        t: 'render_ascii',
        source: args.source,
        useAscii: args.useAscii === true,
        targetWidth: typeof args.targetWidth === 'number' ? args.targetWidth : undefined,
        render: { ...projectMcpRenderOptions(args), ...HOSTED_RENDER_OPTIONS },
      } : null
    case 'render_png': {
      if (typeof args.source !== 'string') return null
      try {
        const normalized = normalizedHostedPngRequest(args)
        return {
          t: 'render_png',
          source: args.source,
          output: normalized.output,
          render: normalized.render,
        }
      } catch {
        return null
      }
    }
    case 'verify':
      return typeof args.source === 'string' ? { t: 'verify', source: args.source } : null
    case 'describe': {
      if (typeof args.source !== 'string') return null
      const format = args.format ?? 'text'
      return format === 'text' || format === 'json' || format === 'facts'
        ? { t: 'describe', source: args.source, format }
        : null
    }
    case 'describe_sdk': {
      try {
        const payload = describeSdkPayload(args) as { family: string; detail: string }
        return { t: 'describe_sdk', family: payload.family, detail: payload.detail }
      } catch {
        return null
      }
    }
    default:
      return null
  }
}

/** Declarative structured-edit tools (`mutate`, `build`): validate the required
 *  argument + the ops array, cap payload size, then hand off to the ONE checked
 *  core (applyOps) that the Code Mode facade also funnels through. The canonical
 *  OpEnvelope is returned verbatim; `isError` mirrors `!envelope.ok`. */
function handleApplyOps(id: number | string | null, args: Record<string, unknown>, mode: 'source' | 'family'): JsonRpcResponse {
  const ops = args.ops
  if (!Array.isArray(ops)) return rpcError(id, -32602, `${mode === 'source' ? 'mutate' : 'build'} requires \`ops\` (array)`)
  if (ops.length === 0) return rpcError(id, -32602, `${mode === 'source' ? 'mutate' : 'build'} requires at least one op`)
  if (mode === 'source') {
    if (typeof args.source !== 'string') return rpcError(id, -32602, 'mutate requires `source` (string)')
    if (boundedUtf8ByteLength(args.source, MAX_SOURCE_BYTES) > MAX_SOURCE_BYTES) {
      return toolResult(id, { ok: false as const, family: null, error: { code: 'SOURCE_TOO_LARGE', message: TOO_LARGE_HINT } }, true)
    }
  } else if (typeof args.family !== 'string') {
    return rpcError(id, -32602, 'build requires `family` (string)')
  }
  if (boundedUtf8ByteLength(JSON.stringify(ops), MAX_SOURCE_BYTES) > MAX_SOURCE_BYTES) {
    return toolResult(id, { ok: false as const, family: null, error: { code: 'OPS_TOO_LARGE', message: TOO_LARGE_HINT } }, true)
  }
  const envelope = mode === 'source'
    ? applyOps({ source: args.source as string, ops })
    : applyOps({ family: args.family as string, ops })
  return toolResult(id, envelope, !envelope.ok)
}

/** Shared shape for the pure source→payload tools: validate, cap, run, wrap errors. */
function sourceTool(id: number | string | null, args: Record<string, unknown>, run: (source: string) => { ok: boolean } & Record<string, unknown>): JsonRpcResponse {
  const source = args.source
  if (typeof source !== 'string') return rpcError(id, -32602, 'tool requires `source` (string)')
  if (boundedUtf8ByteLength(source, MAX_SOURCE_BYTES) > MAX_SOURCE_BYTES) {
    return toolResult(id, { ok: false as const, error: { code: 'SOURCE_TOO_LARGE', message: TOO_LARGE_HINT } }, true)
  }
  try {
    const payload = run(source)
    return toolResult(id, payload, !payload.ok)
  } catch (e) {
    return toolResult(id, {
      ok: false as const,
      error: projectRenderErrorDiagnostic(e),
    }, true)
  }
}

/** Hosted execute errors share the { code, message } envelope of every other
 *  hosted tool. The sandbox's message is kept verbatim and only classified:
 *  a CPU-budget overrun (see failure() in website/src/execute-loader.ts) is
 *  EXECUTE_TIMEOUT; everything else — user exceptions, syntax errors, loader
 *  failures — is EXECUTE_FAILED. */
function executeError(message: string): { code: 'EXECUTE_FAILED' | 'EXECUTE_TIMEOUT'; message: string } {
  return { code: /exceeded its \d+ms CPU budget/.test(message) ? 'EXECUTE_TIMEOUT' : 'EXECUTE_FAILED', message }
}

async function handleExecute(id: number | string | null, args: Record<string, unknown>, context: HostedMcpContext): Promise<JsonRpcResponse> {
  const code = args.code
  if (typeof code !== 'string') return rpcError(id, -32602, 'execute requires `code` (string)')
  if (boundedUtf8ByteLength(code, MAX_CODE_BYTES) > MAX_CODE_BYTES) {
    return toolResult(id, { ok: false as const, error: { code: 'CODE_TOO_LARGE', message: TOO_LARGE_HINT }, logs: [] }, true)
  }
  // Screen sync-only violations before any isolate exists: rejected code costs
  // nothing and the error message matches the local sandbox exactly.
  const reason = unsupportedCodeReason(code)
  if (reason) return toolResult(id, { ok: false as const, error: executeError(reason), logs: [] }, true)
  const requested = args.timeoutMs
  if (requested !== undefined && !isValidExecuteTimeout(requested)) {
    return rpcError(id, -32602, EXECUTE_TIMEOUT_ERROR)
  }
  const timeoutMs = typeof requested === 'number' && Number.isFinite(requested)
    ? Math.min(requested, MAX_EXECUTE_TIMEOUT_MS)
    : DEFAULT_EXECUTE_TIMEOUT_MS
  try {
    const r = await context.execute(code, timeoutMs)
    if (r.ok) return toolResult(id, r, false)
    return toolResult(id, { ok: false as const, error: executeError(r.error ?? 'sandbox returned no error message'), logs: r.logs ?? [] }, true)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return toolResult(id, { ok: false as const, error: executeError(msg), logs: [] }, true)
  }
}

async function handleRenderPng(id: number | string | null, args: Record<string, unknown>, context: HostedMcpContext): Promise<JsonRpcResponse> {
  const source = args.source
  if (typeof source !== 'string') return rpcError(id, -32602, 'render_png requires `source` (string)')
  if (boundedUtf8ByteLength(source, MAX_SOURCE_BYTES) > MAX_SOURCE_BYTES) {
    return toolResult(id, { ok: false as const, error: { code: 'SOURCE_TOO_LARGE', message: TOO_LARGE_HINT } }, true)
  }
  if (!context.renderPng) {
    return toolResult(id, { ok: false as const, error: { code: 'PNG_UNAVAILABLE', message: 'PNG rendering is not enabled on this host' } }, true)
  }
  try {
    const normalized = normalizedHostedPngRequest(args)
    const result = await context.renderPng(source, {
      ...normalized.render,
      ...normalized.output,
    })
    if (!(result.png instanceof Uint8Array)) throw new TypeError('hosted PNG rasterizer must return Uint8Array bytes')
    if (result.png.byteLength > MAX_HOSTED_PNG_BYTES) {
      return toolResult(id, { ok: false as const, error: {
        code: 'PNG_OUTPUT_TOO_LARGE',
        message: `hosted PNG output exceeds the ${MAX_HOSTED_PNG_BYTES}-byte response cap; ${LOCAL_FALLBACK_HINT}`,
      } }, true)
    }
    const warnings = [...sourceConfigWarnings(source), ...result.warnings]
      .filter((warning, index, all) => all.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(warning)) === index)
    return toolResult(id, {
      ok: true as const,
      png_base64: base64Encode(result.png),
      receipt: result.receipt,
      runtime: result.runtime,
      warnings,
    }, false)
  } catch (e) {
    return toolResult(id, {
      ok: false as const,
      error: projectRenderErrorDiagnostic(e),
    }, true)
  }
}

// Buffer is unavailable in workerd; btoa takes a byte-string. Chunk to stay
// under argument-length limits for large PNGs.
function base64Encode(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_HOSTED_PNG_BYTES) throw new RangeError('hosted PNG exceeds the base64 response cap')
  const encoded: string[] = []
  // A multiple of three keeps independently encoded chunks concatenable.
  const CHUNK = 0x6000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const binary = String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    encoded.push(btoa(binary))
  }
  return encoded.join('')
}
