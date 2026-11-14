// Hosted MCP layout work, shared by the website Worker's inline fallback and
// the Dynamic Worker isolate that runs it under a cpuMs limit (the tool route
// of dynamic-harness.ts). Runtime-neutral: requests and payloads are plain
// JSON, so the isolate path is the inline path with a JSON round trip.

import { runSourceTool, type SourceToolName } from './source-tools.ts'
import { renderPortablePngGraphicalProjection, type PngGraphicalProjection } from '../png-graphical.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import type { PortablePngOutputOptions } from '../png-contract.ts'
import type { RenderOptions } from '../types.ts'

/** One hosted call's layout work. PNG lays out in the isolate and rasterizes
 * in the parent Worker, which holds the wasm rasterizer and fonts. */
export type HostedToolRequest =
  | { readonly name: SourceToolName; readonly args: Record<string, unknown> }
  | { readonly name: 'png_projection'; readonly source: string; readonly renderOptions: RenderOptions; readonly outputOptions: PortablePngOutputOptions }

export type HostedToolPayload = { ok: boolean } & Record<string, unknown>

/** Successful png_projection payload. */
export interface HostedPngProjectionPayload { ok: true; projection: PngGraphicalProjection }

/** Layout runs synchronously; a host that must bound it runs this in an
 * isolate it can stop (hosted: a Dynamic Worker with a cpuMs limit).
 * `onStart` reports the budget of an isolate call that actually started. */
export type HostedToolRunner = (request: HostedToolRequest, cpuMs: number, onStart?: (cpuMs: number) => void) => Promise<HostedToolPayload>

/** CPU budget for one hosted call that lays out a diagram. */
export const HOSTED_TOOL_CPU_MS = 10_000
/** CPU allowance shared by every such call in one HTTP request (a batch runs
 * its calls one at a time against it). Matches the Workers per-invocation
 * CPU default that bounded the old inline path. */
export const HOSTED_REQUEST_CPU_MS = 30_000

export function hostedToolTimeout(cpuMs: number): HostedToolPayload {
  return { ok: false, error: { code: 'RENDER_TIMEOUT', message: `Operation exceeded its ${cpuMs}ms CPU budget` } }
}

/** Run one request in this isolate. Every failure becomes a structured
 * payload; nothing throws across the isolate boundary. */
export function runHostedTool(request: HostedToolRequest): HostedToolPayload {
  const source = request.name === 'png_projection'
    ? request.source
    : typeof request.args?.source === 'string' ? request.args.source : undefined
  try {
    if (request.name === 'png_projection') {
      return { ok: true, projection: renderPortablePngGraphicalProjection(request.source, request.renderOptions, request.outputOptions) }
    }
    return runSourceTool(request.name, request.args)
  } catch (error) {
    return { ok: false, error: projectRenderErrorDiagnostic(error, { source }) }
  }
}

/**
 * Serialize one HTTP request's isolate calls against a shared allowance.
 * Each call's budget is the smaller of its own and what remains; elapsed wall
 * time (an upper bound on the CPU an isolate used) is charged afterwards.
 * Once spent, further calls return RENDER_TIMEOUT without starting.
 */
export function withRequestCpuAllowance(run: HostedToolRunner, allowanceMs = HOSTED_REQUEST_CPU_MS, now: () => number = Date.now): HostedToolRunner {
  let remaining = allowanceMs
  let tail: Promise<unknown> = Promise.resolve()
  return (request, cpuMs, onStart) => {
    const turn = tail.then(async (): Promise<HostedToolPayload> => {
      const budget = Math.floor(Math.min(cpuMs, remaining))
      if (budget < 1) {
        return { ok: false, error: { code: 'RENDER_TIMEOUT', message: `This request's ${allowanceMs}ms CPU allowance is spent; send the remaining calls as separate requests` } }
      }
      const started = now()
      try { return await run(request, budget, onStart) }
      finally { remaining -= Math.max(0, now() - started) }
    })
    tail = turn.catch(() => {})
    return turn
  }
}
