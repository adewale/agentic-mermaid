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
import { verifyMermaid } from '../agent/verify.ts'
import { describeMermaidSource } from '../agent/describe.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../agent/core.ts'
import { THEMES } from '../theme.ts'
import { unsupportedCodeReason } from './facade.ts'
import { reply, rpcError, toolResult, type JsonRpcRequest, type JsonRpcResponse } from './protocol.ts'
import { SDK_DECLARATION } from './sdk-decl.ts'
import type { ExecuteResult } from './sandbox.ts'
import pkg from '../../package.json'

export type { ExecuteResult }

export interface HostedMcpContext {
  /** Run Code Mode JavaScript. Hosted: a Dynamic Worker isolate. */
  execute(code: string, timeoutMs: number): Promise<ExecuteResult>
  /** Rasterize SVG to PNG bytes. Hosted: resvg-wasm. Absent → render_png reports unavailable. */
  renderPng?(source: string, opts: { scale?: number; background?: string }): Promise<Uint8Array>
}

const SERVER_NAME = 'agentic-mermaid-mcp'
const SERVER_VERSION = pkg.version
// Streamable HTTP clients negotiate 2025-03-26+; the node transports pin
// 2024-11-05. Echo whichever supported version the client offers.
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
const DEFAULT_PROTOCOL_VERSION = '2025-03-26'

export const MAX_SOURCE_BYTES = 64 * 1024
export const MAX_CODE_BYTES = 64 * 1024
const MAX_EXECUTE_TIMEOUT_MS = 30_000
const DEFAULT_EXECUTE_TIMEOUT_MS = 5_000
// Rasterization work grows with scale²; clamp so a tiny source cannot demand
// unbounded output (the renderer additionally enforces a total pixel budget).
export const MIN_PNG_SCALE = 0.1
export const MAX_PNG_SCALE = 8

const TOO_LARGE_HINT = 'input exceeds the hosted size cap; run the local agentic-mermaid CLI or stdio MCP server instead (see https://agentic-mermaid.dev/docs/mcp/)'

export const HOSTED_TOOLS = [
  {
    name: 'execute',
    description: `Run synchronous JavaScript against the mermaid SDK in an isolated sandbox.
Code runs as an expression or statement body — return the final value. Promise jobs,
async/await, and dynamic import are not supported.
Multi-step diagram edits should be one execute() call. The SDK declaration is
TypeScript-shaped for guidance; the sandbox does not transpile type annotations.
Hosted note: execute runs in an on-demand isolate and costs more than the direct
render_svg/render_ascii/render_png/verify/describe tools — prefer those for plain
render/verify calls and reserve execute for parse→narrow→mutate workflows.

SDK declaration:
${SDK_DECLARATION}`,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript to execute; mermaid.* SDK is global.' },
        timeoutMs: { type: 'number', description: 'Optional CPU-time budget (default 5000ms, max 30000ms).' },
      },
      required: ['code'],
    },
  },
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
      },
      required: ['source'],
    },
  },
  {
    name: 'render_ascii',
    description: `Render a Mermaid source string to text. Returns { ok, text }.
useAscii true → plain ASCII (+,-,|); false/absent → Unicode box drawing (┌,─,│).`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        useAscii: { type: 'boolean', description: 'true = ASCII characters, false = Unicode (default).' },
      },
      required: ['source'],
    },
  },
  {
    name: 'render_png',
    description: `Rasterize a Mermaid source string to PNG. Returns { ok, png_base64 }.
Hosted rendering uses resvg-wasm with bundled DejaVu Sans; bytes may differ from the
local napi renderer, so hosted PNG is a convenience surface, not part of the
byte-determinism contract. For file/URL artifacts use the local stdio server.`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
        scale: { type: 'number', description: 'Output scale multiplier (default 2 — retina; clamped to 0.1–8).' },
        background: { type: 'string', description: "CSS color string (default 'white')." },
      },
      required: ['source'],
    },
  },
  {
    name: 'verify',
    description: `Parse and verify a Mermaid diagram without rendering it. Returns
{ ok, warnings, layout: { bounds, nodes, edges } } for valid diagrams and
{ ok: false, errors } for parse failures. Warnings use the layout-rubric codes.`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
      },
      required: ['source'],
    },
  },
  {
    name: 'describe',
    description: `Produce a natural-language summary of a Mermaid diagram. Returns
{ ok, text } with one or two sentences per family covering entities, edges,
and notable structure. Intended for screen-reader output, doc generation, and
LLM context compaction without re-parsing.`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Mermaid source.' },
      },
      required: ['source'],
    },
  },
]

const INSTRUCTIONS = `agentic-mermaid hosted MCP server (stateless). Direct tools render_svg, render_ascii, render_png, verify, and describe cover plain render/verify calls cheaply and are edge-cached (layout is deterministic; there is no seed). execute runs synchronous JavaScript against the typed mermaid.* SDK in an isolated on-demand sandbox for parse→narrow→mutate workflows; async/await and Promise jobs are not supported, and network access is disabled. Inputs are capped at 64KB; for bigger diagrams, Code Mode artifacts, or file/URL PNG output, run the local stdio server (see https://agentic-mermaid.dev/docs/mcp/).`

export async function handleHostedRequest(req: JsonRpcRequest, context: HostedMcpContext): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null
  switch (req.method) {
    case 'initialize': {
      const offered = (req.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
      const protocolVersion = typeof offered === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(offered) ? offered : DEFAULT_PROTOCOL_VERSION
      return reply(id, {
        protocolVersion,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
      })
    }
    case 'notifications/initialized': return null
    case 'ping': return reply(id, {})
    case 'tools/list': return reply(id, { tools: HOSTED_TOOLS })
    case 'tools/call': return await handleToolCall(id, req.params, context)
    case 'prompts/list': return reply(id, { prompts: [] })
    case 'resources/list': return reply(id, { resources: [] })
    default: return rpcError(id, -32601, `Method not found: ${req.method}`)
  }
}

async function handleToolCall(id: number | string | null, params: unknown, context: HostedMcpContext): Promise<JsonRpcResponse> {
  const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined
  const name = p?.name
  const args = p?.arguments ?? {}
  switch (name) {
    case 'execute': return handleExecute(id, args, context)
    case 'render_svg': return sourceTool(id, args, 'SVG_RENDER_FAILED', source => ({ ok: true as const, svg: renderMermaidSVG(source, svgOptions(args)) }))
    case 'render_ascii': return sourceTool(id, args, 'ASCII_RENDER_FAILED', source => ({ ok: true as const, text: renderMermaidASCII(source, { useAscii: args.useAscii === true }) }))
    case 'render_png': return handleRenderPng(id, args, context)
    case 'verify': return sourceTool(id, args, 'VERIFY_FAILED', source => {
      const parsed = parseMermaid(source)
      if (!parsed.ok) return { ok: false as const, errors: parsed.error }
      const v = verifyMermaid(parsed.value)
      return { ok: v.ok, warnings: v.warnings, layout: { bounds: v.layout.bounds, nodes: v.layout.nodes.length, edges: v.layout.edges.length } }
    })
    case 'describe': return sourceTool(id, args, 'DESCRIBE_FAILED', source => ({ ok: true as const, text: describeMermaidSource(source) }))
    default: return rpcError(id, -32602, `Unknown tool: ${name ?? '<none>'}`)
  }
}

function svgOptions(args: Record<string, unknown>): Record<string, string> {
  const theme = args.theme
  if (theme !== undefined && (typeof theme !== 'string' || !(theme in THEMES))) {
    throw new Error(`unknown theme; expected one of: ${Object.keys(THEMES).join(', ')}`)
  }
  const opts: Record<string, string> = typeof theme === 'string' ? { ...THEMES[theme] } as unknown as Record<string, string> : {}
  if (typeof args.bg === 'string') opts.bg = args.bg
  if (typeof args.fg === 'string') opts.fg = args.fg
  return opts
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
      return typeof args.source === 'string' ? { t: 'render_ascii', source: args.source, useAscii: args.useAscii === true } : null
    case 'render_png': {
      if (typeof args.source !== 'string') return null
      const output = args.output ?? (args as { outputMode?: unknown }).outputMode
      if (output !== undefined && output !== 'base64') return null
      const key: Record<string, unknown> = { t: 'render_png', source: args.source, scale: keyPngScale(args) }
      if (typeof args.background === 'string') key.background = args.background
      return key
    }
    case 'verify':
      return typeof args.source === 'string' ? { t: 'verify', source: args.source } : null
    case 'describe':
      return typeof args.source === 'string' ? { t: 'describe', source: args.source } : null
    default:
      return null
  }
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
    return toolResult(id, { ok: false as const, error: { code: errorCode, message: msg } }, true)
  }
}

async function handleExecute(id: number | string | null, args: Record<string, unknown>, context: HostedMcpContext): Promise<JsonRpcResponse> {
  const code = args.code
  if (typeof code !== 'string') return rpcError(id, -32602, 'execute requires `code` (string)')
  if (utf8Bytes(code) > MAX_CODE_BYTES) {
    return toolResult(id, { ok: false, error: `CODE_TOO_LARGE: ${TOO_LARGE_HINT}`, logs: [] }, true)
  }
  // Screen sync-only violations before any isolate exists: rejected code costs
  // nothing and the error text matches the local sandbox exactly.
  const reason = unsupportedCodeReason(code)
  if (reason) return toolResult(id, { ok: false, error: reason, logs: [] }, true)
  const requested = args.timeoutMs
  const timeoutMs = typeof requested === 'number' && Number.isFinite(requested)
    ? Math.max(1, Math.min(requested, MAX_EXECUTE_TIMEOUT_MS))
    : DEFAULT_EXECUTE_TIMEOUT_MS
  try {
    const r = await context.execute(code, timeoutMs)
    return toolResult(id, r, !r.ok)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return toolResult(id, { ok: false, error: `execute failed: ${msg}`, logs: [] }, true)
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
    const png = await context.renderPng(source, { scale, background })
    return toolResult(id, { ok: true as const, png_base64: base64Encode(png) }, false)
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
