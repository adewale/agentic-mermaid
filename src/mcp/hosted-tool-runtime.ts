// Hosted MCP layout work, shared by the website Worker's inline fallback and
// the Dynamic Worker isolate that runs it under a cpuMs limit (the tool route
// of dynamic-harness.ts). Runtime-neutral: requests and payloads are plain
// JSON, so the isolate path is the inline path with a JSON round trip.

import { runSourceTool, type SourceToolName } from './source-tools.ts'
import { renderPortablePngGraphicalProjection, type PngGraphicalProjection } from '../png-graphical.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import type { PortablePngOutputOptions } from '../png-contract.ts'
import type { RenderOptions } from '../types.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { estimateLayoutCost, layoutCostExceedsThresholds } from '../layout/layout-cost.ts'

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

type EstimatedGraph = { nodes: Map<string, unknown>; edges: Array<{ source: string; target: string }> }
type StateScope = { states?: readonly StateScopeNode[]; transitions?: ReadonlyArray<{ from: string; to: string }>; regions?: readonly StateScope[] }
type StateScopeNode = StateScope & { id: string }

/** Nodes and edges of a family that lays out on ELK, read from the parsed
 * body before any layout runs; other families return undefined. */
function estimatedGraph(source: string): EstimatedGraph | undefined {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) return undefined
  const body = parsed.value.body as { kind: string } & Record<string, unknown>
  const graph: EstimatedGraph = { nodes: new Map(), edges: [] }
  const add = (items: ReadonlyArray<{ id: string }>, links: ReadonlyArray<{ from: string; to: string }>) => {
    for (const item of items) graph.nodes.set(item.id, item)
    for (const link of links) graph.edges.push({ source: link.from, target: link.to })
  }
  switch (body.kind) {
    case 'flowchart': return body.graph as EstimatedGraph
    case 'class': add(body.classes as Array<{ id: string }>, body.relations as Array<{ from: string; to: string }>); return graph
    case 'er': add(body.entities as Array<{ id: string }>, body.relations as Array<{ from: string; to: string }>); return graph
    case 'state': {
      const visit = (scope: StateScope) => {
        add(scope.states ?? [], scope.transitions ?? [])
        for (const node of scope.states ?? []) visit(node)
        for (const region of scope.regions ?? []) visit(region)
      }
      visit(body as StateScope)
      return graph
    }
    default: return undefined
  }
}

/**
 * Whether a call's diagram is heavy enough to need the CPU-bounded isolate:
 * a family that lays out on ELK whose pre-layout cost estimate reaches a
 * layout-cost threshold (the same estimate that relaxes ELK's options). The
 * estimate depends only on the source, so the same call always takes the
 * same path. Everything else runs inline, as it did before the isolate.
 */
export function hostedToolNeedsIsolate(request: HostedToolRequest): boolean {
  const source = request.name === 'png_projection' ? request.source : request.args?.source
  if (typeof source !== 'string') return false
  try {
    const graph = estimatedGraph(source)
    return graph !== undefined && layoutCostExceedsThresholds(estimateLayoutCost(graph))
  } catch {
    return false
  }
}

/** Run heavy calls through `isolate` and every other call inline. Inline
 * calls cost what they did before the isolate existed: no extra request. */
export function isolateHeavyHostedTools(isolate: HostedToolRunner, needsIsolate: (request: HostedToolRequest) => boolean = hostedToolNeedsIsolate): HostedToolRunner {
  return (request, cpuMs, onStart) => needsIsolate(request) ? isolate(request, cpuMs, onStart) : Promise.resolve(runHostedTool(request))
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
