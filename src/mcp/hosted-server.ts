// Hosted MCP server core — the tool surface served at agentic-mermaid.dev/mcp
// by the Cloudflare website Worker. Runtime-neutral: pure tools run inline;
// `execute` and `render_png` are injected by the host (the Worker backs them
// with a Dynamic Worker isolate and resvg-wasm; tests back them with fakes).
//
// This surface deliberately differs from the local Code Mode server
// (docs/mcp-code-mode-rationale.md): locally, `execute` is free and stays the
// single entry point. Hosted, every `execute` spins a billable isolate, so the
// common render/verify paths get direct pure tools that cost one ordinary
// Worker invocation and are edge-cacheable.

import { parseMermaid } from '../agent/parse.ts'
import { configWarningsForMermaid, verifyMermaid } from '../agent/verify.ts'
import { applyOps } from '../agent/apply.ts'
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'
import { opSignatures, type OpFamily } from '../agent/op-schema.ts'
import { validateStyleSpec } from '../scene/style-registry.ts'
import type { StyleInput } from '../scene/style-registry.ts'
import { describeMermaidSource, describeMermaid } from '../agent/describe.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../agent/core.ts'
import { THEMES } from '../theme.ts'
import { unsupportedCodeReason } from './facade.ts'
import { rpcError, toolResult, type JsonRpcRequest, type JsonRpcResponse } from './protocol.ts'
import { SDK_DECLARATION } from './sdk-decl.ts'
import { PURE_COMPUTE_ANNOTATIONS, createDescribeTool, createExecuteTool, createRenderPngTool, dispatchMcpRequest, type McpServerSurface } from './tool-surface.ts'
import type { ExecuteResult } from './sandbox.ts'
import type { PngRasterResult } from '../shared/png-font-warnings.ts'

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
  renderPng?(source: string, opts: { scale?: number; background?: string; style?: StyleInput | StyleInput[]; seed?: number }): Promise<PngRasterResult>
}

// Streamable HTTP clients negotiate 2025-03-26+; the node transports pin
// 2024-11-05. Echo whichever supported version the client offers.
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
const DEFAULT_PROTOCOL_VERSION = '2025-03-26'

// Hosted server identity, distinct from the local stdio server's
// MCP_SERVER_NAME: registries and clients cache tool lists by server identity,
// and this surface (8 tools) must never shadow the local one (3 tools).
export const HOSTED_MCP_SERVER_NAME = 'agentic-mermaid-hosted'

export const MAX_SOURCE_BYTES = 64 * 1024
export const MAX_CODE_BYTES = 64 * 1024
const MAX_EXECUTE_TIMEOUT_MS = 30_000
const DEFAULT_EXECUTE_TIMEOUT_MS = 5_000
// Rasterization work grows with scale²; clamp so a tiny source cannot demand
// unbounded output (the renderer additionally enforces a total pixel budget).
export const MIN_PNG_SCALE = 0.1
export const MAX_PNG_SCALE = 8

// Shared with the transport's 413 (total-body cap) so every "too big" refusal
// points at the same way out.
export const LOCAL_FALLBACK_HINT = 'run the local agentic-mermaid CLI or stdio MCP server instead (see https://agentic-mermaid.dev/docs/mcp/)'
const TOO_LARGE_HINT = `input exceeds the hosted size cap; ${LOCAL_FALLBACK_HINT}`

// The structured op menu, family → op signatures with field names, embedded in
// the declarative tool descriptions so a caller can fill an op correctly on the
// first try (optional fields carry `?`). Enum vocabularies and exact types are
// left to `am capabilities --json` (`families[].opFields`) and the prescriptive
// INVALID_OP error, so the inline menu stays compact.
const OP_MENU = Object.keys(MUTATION_OPS_BY_FAMILY)
  .map(family => `  ${family}: ${opSignatures(family as OpFamily).join(', ')}`)
  .join('\n')

export const HOSTED_TOOLS = [
  createExecuteTool({ sdkDeclaration: SDK_DECLARATION, hosted: true }),
  {
    name: 'render_svg',
    description: `Render a Mermaid source string to themeable SVG. Returns { ok, svg }.
Layout is deterministic: identical input produces identical geometry.`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        theme: { type: 'string', description: `Named theme (one of: ${Object.keys(THEMES).join(', ')}).` },
        bg: { type: 'string', description: 'Background CSS color (overrides theme).' },
        fg: { type: 'string', description: 'Foreground CSS color (overrides theme).' },
        style: { description: 'Style: a name (hand-drawn, excalidraw, pen-and-ink, freehand, watercolor, blueprint, tufte, accessible-high-contrast, patent-drawing, status-dashboard, ops-schematic, chalkboard, risograph, architectural-plan, publication-figure, or any theme name), an inline style record, or an array stack merged left → right. A colors-only style is a theme.' },
        seed: { type: 'number', description: 'Re-rolls ink wobble of styled looks; never moves layout.' },
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
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        useAscii: { type: 'boolean', description: 'true = ASCII characters, false = Unicode (default).' },
        targetWidth: { type: 'integer', minimum: 1, description: 'Hard maximum line width in terminal display cells.' },
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
Each op is { "kind": <op>, …fields }. Op kinds by family:
${OP_MENU}`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Mermaid source to edit.' },
        ops: { type: 'array', items: { type: 'object' }, description: 'Ordered list of edit ops; each is { kind, ...fields }.' },
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
Op kinds by family:
${OP_MENU}`,
    inputSchema: {
      type: 'object',
      properties: {
        family: { type: 'string', description: `Diagram family to author (one of: ${Object.keys(MUTATION_OPS_BY_FAMILY).join(', ')}).` },
        ops: { type: 'array', items: { type: 'object' }, description: 'Ordered list of ops; each is { kind, ...fields }.' },
      },
      required: ['family', 'ops'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  },
]

const INSTRUCTIONS = `agentic-mermaid hosted MCP server (stateless). Direct tools render_svg, render_ascii, render_png, verify, and describe cover plain render/verify calls cheaply and are edge-cached (layout is deterministic; there is no layout seed — the library's optional style seed only re-rolls ink of styled looks). Declarative mutate/build apply typed op lists and verify before emitting source; prefer them for straightforward structured edits. execute runs synchronous JavaScript against the typed mermaid.* SDK in an isolated on-demand sandbox for logic the ops don't express; async/await and Promise jobs are not supported, and network access is disabled. Inputs are capped at 64KB; for bigger diagrams, Code Mode artifacts, or file/URL PNG output, run the local stdio server (see https://agentic-mermaid.dev/docs/mcp/).`

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
    case 'render_svg': return sourceTool(id, args, 'SVG_RENDER_FAILED', source => ({
      ok: true as const,
      svg: renderMermaidSVG(source, svgOptions(args)),
      warnings: sourceConfigWarnings(source),
    }))
    case 'render_ascii': return sourceTool(id, args, 'ASCII_RENDER_FAILED', source => ({
      ok: true as const,
      text: renderMermaidASCII(source, {
        useAscii: args.useAscii === true,
        targetWidth: args.targetWidth as number | undefined,
      }),
      warnings: sourceConfigWarnings(source),
    }))
    case 'render_png': return handleRenderPng(id, args, context)
    case 'verify': return sourceTool(id, args, 'VERIFY_FAILED', source => {
      const parsed = parseMermaid(source)
      if (!parsed.ok) {
        // Self-describing tool: when the header names a known family, hand back
        // that family's canonical example so a failed authoring attempt gets the
        // correct dialect in the same response — no need to fetch capabilities.json.
        const hint = familyExampleForSource(source)
        return { ok: false as const, errors: parsed.error, ...(hint ?? {}) }
      }
      const v = verifyMermaid(parsed.value)
      // Echo the detected family + a one-line summary so `ok:true` is never a
      // silent pass on the wrong kind of diagram: an agent that asked for an
      // architecture diagram and reads `family:"flowchart"` here sees the
      // mismatch in the same result it was already going to read, without
      // having to know to call `describe` separately.
      return { ok: v.ok, family: parsed.value.kind, summary: describeMermaid(parsed.value), warnings: v.warnings, layout: { bounds: v.layout.bounds, nodes: v.layout.nodes.length, edges: v.layout.edges.length } }
    })
    case 'describe': return sourceTool(id, args, 'DESCRIBE_FAILED', source => describePayload(source, args))
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

function describeFormat(args: Record<string, unknown>): 'text' | 'json' | 'facts' {
  const format = args.format ?? 'text'
  if (format === 'text' || format === 'json' || format === 'facts') return format
  throw new Error('describe format must be one of: text, json, facts')
}

function describePayload(source: string, args: Record<string, unknown>): { ok: boolean } & Record<string, unknown> {
  const format = describeFormat(args)
  if (format === 'text') return { ok: true as const, text: describeMermaidSource(source) }
  const parsed = parseMermaid(source)
  if (!parsed.ok) return { ok: false as const, errors: parsed.error }
  if (format === 'facts') return { ok: true as const, facts: describeMermaidFacts(parsed.value) }
  return { ok: true as const, tree: JSON.parse(describeMermaid(parsed.value, { format: 'json' })) }
}

function svgOptions(args: Record<string, unknown>): Record<string, unknown> {
  const theme = args.theme
  if (theme !== undefined && (typeof theme !== 'string' || !(theme in THEMES))) {
    throw new Error(`unknown theme; expected one of: ${Object.keys(THEMES).join(', ')}`)
  }
  const opts: Record<string, unknown> = typeof theme === 'string' ? { ...THEMES[theme] } as unknown as Record<string, unknown> : {}
  if (typeof args.bg === 'string') opts.bg = args.bg
  if (typeof args.fg === 'string') opts.fg = args.fg
  const style = normalizeStyleArg(args.style)
  if (style !== undefined) opts.style = style
  if (typeof args.seed === 'number' && Number.isFinite(args.seed)) opts.seed = args.seed
  return opts
}

/** Validate an untrusted style argument: names pass through (unknown names
 *  fail loudly inside resolveStyleStack with the known list), inline records
 *  and stacks are checked with validateStyleSpec so junk is a tool error,
 *  not a render throw. */
function normalizeStyleArg(raw: unknown): StyleInput | StyleInput[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const entries = Array.isArray(raw) ? raw : [raw]
  for (const entry of entries) {
    if (typeof entry === 'string') continue
    const problems = validateStyleSpec(entry)
    if (problems.length > 0) throw new Error(`invalid style record: ${problems.join('; ')}`)
  }
  return entries as StyleInput[]
}

// ---- Effective (normalized) arguments -------------------------------------
// The output of each tool depends only on these values. Handlers AND the cache
// key derive from the same helpers so a cached response can never diverge from
// what a recompute would produce.

/** Clamp `scale` into the documented range; undefined when not a finite number. */
export function effectivePngScale(args: Record<string, unknown>): number | undefined {
  return typeof args.scale === 'number' && Number.isFinite(args.scale)
    ? Math.min(Math.max(args.scale, MIN_PNG_SCALE), MAX_PNG_SCALE)
    : undefined
}

/** Known, output-affecting SVG inputs only (string-typed). Theme *validity* is
 * checked in svgOptions at render time — an invalid theme errors (uncacheable),
 * so the key just needs to reflect the requested values, not validate them. */
function effectiveSvgArgs(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof args.theme === 'string') out.theme = args.theme
  if (typeof args.bg === 'string') out.bg = args.bg
  if (typeof args.fg === 'string') out.fg = args.fg
  // Output-affecting style knobs: key on the requested values verbatim
  // (JSON-canonical); validity is checked at render time like theme.
  if (args.style !== undefined) out.style = JSON.stringify(args.style)
  if (typeof args.seed === 'number' && Number.isFinite(args.seed)) out.seed = String(args.seed)
  return out
}

/** The scale the renderer actually uses: the clamped value, or the default 2
 * when absent/non-numeric (png-wasm applies `?? 2`). Keying on the *resolved*
 * value collapses an omitted `scale` and an explicit `scale: 2` — which render
 * identically — into one cache entry. */
export const DEFAULT_PNG_SCALE = 2
function keyPngScale(args: Record<string, unknown>): number {
  return effectivePngScale(args) ?? DEFAULT_PNG_SCALE
}

/**
 * Canonical cache-key inputs for a tools/call: the normalized, output-affecting
 * inputs only. Non-output-affecting ARGUMENTS are dropped or normalized so that
 * semantically identical calls collapse to one cache entry — an extra `nonce`,
 * an out-of-range or omitted `scale`, a differing `timeoutMs` all share a key.
 * Returns null when the call must not be cached (unknown tool, a missing/ill-typed
 * required arg, or a non-base64 render_png output — all of which produce error
 * results, and errors are never cached).
 *
 * Scope of the cost-control guarantee: it covers ARGUMENTS, not the `source`/
 * `code` payload, which is keyed VERBATIM by design. Keying on the raw payload
 * is what makes a cached response provably correspond to what that exact input
 * renders — canonicalizing the payload (e.g. stripping Mermaid comments) is
 * deliberately avoided because two payloads that canonicalize alike are not
 * guaranteed to render byte-identically, and a wrong cached result is far worse
 * than a missed dedup. A caller can therefore still force recompute by varying
 * insignificant payload bytes (comments/whitespace); that residual is bounded
 * by the endpoint's WAF rate limit (the actual abuse backstop; see
 * website/README.md), not by the cache.
 */
export function cacheKeyFor(name: string | undefined, args: Record<string, unknown>): unknown | null {
  switch (name) {
    // timeoutMs is a compute budget, not an input: identical code is one entry.
    // A cached success is the true deterministic result, returned regardless of
    // the requested budget (free and correct); a call that would time out
    // produces an error and is never cached, so it cannot poison this entry.
    // (Code Mode is intended for deterministic SDK workflows; a non-deterministic
    // body — Date/Math.random — has its first result frozen for the cache TTL,
    // as it did before this change, since execute results were always cached.)
    case 'execute':
      return typeof args.code === 'string' ? { t: 'execute', code: args.code } : null
    case 'render_svg':
      return typeof args.source === 'string' ? { t: 'render_svg', source: args.source, ...effectiveSvgArgs(args) } : null
    case 'render_ascii':
      return typeof args.source === 'string' ? {
        t: 'render_ascii',
        source: args.source,
        useAscii: args.useAscii === true,
        targetWidth: typeof args.targetWidth === 'number' ? args.targetWidth : undefined,
      } : null
    case 'render_png': {
      if (typeof args.source !== 'string') return null
      const output = args.output ?? (args as { outputMode?: unknown }).outputMode
      if (output !== undefined && output !== 'base64') return null
      const key: Record<string, unknown> = { t: 'render_png', source: args.source, scale: keyPngScale(args) }
      if (typeof args.background === 'string') key.background = args.background
      if (args.style !== undefined) key.style = JSON.stringify(args.style)
      if (typeof args.seed === 'number' && Number.isFinite(args.seed)) key.seed = args.seed
      return key
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
  if (mode === 'source') {
    if (typeof args.source !== 'string') return rpcError(id, -32602, 'mutate requires `source` (string)')
    if (utf8Bytes(args.source) > MAX_SOURCE_BYTES) {
      return toolResult(id, { ok: false as const, family: null, error: { code: 'SOURCE_TOO_LARGE', message: TOO_LARGE_HINT } }, true)
    }
  } else if (typeof args.family !== 'string') {
    return rpcError(id, -32602, 'build requires `family` (string)')
  }
  if (utf8Bytes(JSON.stringify(ops)) > MAX_SOURCE_BYTES) {
    return toolResult(id, { ok: false as const, family: null, error: { code: 'OPS_TOO_LARGE', message: TOO_LARGE_HINT } }, true)
  }
  const envelope = mode === 'source'
    ? applyOps({ source: args.source as string, ops })
    : applyOps({ family: args.family as string, ops })
  return toolResult(id, envelope, !envelope.ok)
}

/** Shared shape for the pure source→payload tools: validate, cap, run, wrap errors. */
function sourceTool(id: number | string | null, args: Record<string, unknown>, errorCode: string, run: (source: string) => { ok: boolean } & Record<string, unknown>): JsonRpcResponse {
  const source = args.source
  if (typeof source !== 'string') return rpcError(id, -32602, 'tool requires `source` (string)')
  if (utf8Bytes(source) > MAX_SOURCE_BYTES) {
    return toolResult(id, { ok: false as const, error: { code: 'SOURCE_TOO_LARGE', message: TOO_LARGE_HINT } }, true)
  }
  try {
    const payload = run(source)
    return toolResult(id, payload, !payload.ok)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'ASCII_TARGET_WIDTH_IMPOSSIBLE') {
      const widthError = e as { code: string; requestedWidth: number; requiredWidth: number; family: string; reason: string }
      return toolResult(id, { ok: false as const, error: {
        code: widthError.code,
        message: msg,
        requestedWidth: widthError.requestedWidth,
        requiredWidth: widthError.requiredWidth,
        family: widthError.family,
        reason: widthError.reason,
      } }, true)
    }
    return toolResult(id, { ok: false as const, error: { code: errorCode, message: msg } }, true)
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
  if (utf8Bytes(code) > MAX_CODE_BYTES) {
    return toolResult(id, { ok: false as const, error: { code: 'CODE_TOO_LARGE', message: TOO_LARGE_HINT }, logs: [] }, true)
  }
  // Screen sync-only violations before any isolate exists: rejected code costs
  // nothing and the error message matches the local sandbox exactly.
  const reason = unsupportedCodeReason(code)
  if (reason) return toolResult(id, { ok: false as const, error: executeError(reason), logs: [] }, true)
  const requested = args.timeoutMs
  const timeoutMs = typeof requested === 'number' && Number.isFinite(requested)
    ? Math.max(1, Math.min(requested, MAX_EXECUTE_TIMEOUT_MS))
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
  const output = args.output ?? (args as { outputMode?: unknown }).outputMode
  if (output !== undefined && output !== 'base64') {
    return rpcError(id, -32602, 'hosted render_png returns base64 only; file/URL artifacts require the local stdio server')
  }
  if (utf8Bytes(source) > MAX_SOURCE_BYTES) {
    return toolResult(id, { ok: false as const, error: { code: 'SOURCE_TOO_LARGE', message: TOO_LARGE_HINT } }, true)
  }
  if (!context.renderPng) {
    return toolResult(id, { ok: false as const, error: { code: 'PNG_UNAVAILABLE', message: 'PNG rendering is not enabled on this host' } }, true)
  }
  try {
    const scale = effectivePngScale(args)
    const background = typeof args.background === 'string' ? args.background : undefined
    const style = normalizeStyleArg(args.style)
    const seed = typeof args.seed === 'number' && Number.isFinite(args.seed) ? args.seed : undefined
    const result = await context.renderPng(source, { scale, background, style, seed })
    const warnings = [...sourceConfigWarnings(source), ...result.warnings]
      .filter((warning, index, all) => all.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(warning)) === index)
    return toolResult(id, { ok: true as const, png_base64: base64Encode(result.png), warnings }, false)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return toolResult(id, { ok: false as const, error: { code: 'PNG_RENDER_FAILED', message: msg } }, true)
  }
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length
}

// Buffer is unavailable in workerd; btoa takes a byte-string. Chunk to stay
// under argument-length limits for large PNGs.
function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
