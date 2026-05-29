import { executeInSandbox } from '../../src/mcp/sandbox.ts'
import { parseMermaid } from '../../src/agent/parse.ts'
import { asFlowchart } from '../../src/agent/types.ts'
import { lintAgentTrace, type SdkCall, type AntiPattern } from './harness.ts'

export interface AgentUsageEvalCase {
  id: string
  prompt: string
  script: string
}

export interface AgentUsageEvalResult {
  id: string
  ok: boolean
  taskOk: boolean
  traceOk: boolean
  findings: AntiPattern[]
  error?: string
}

export interface AgentUsageEvalSummary {
  ok: boolean
  total: number
  passed: number
  structuredPathRate: number
  results: AgentUsageEvalResult[]
}

export const DEFAULT_CASES: AgentUsageEvalCase[] = [
  {
    id: 'cache_between_api_and_db',
    prompt: 'Given flowchart TD API --> DB, insert Cache between API and DB using structured mutation, verify, then serialize.',
    script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      if (!r0.ok) return { error: 'parse' }
      const flow = mermaid.asFlowchart(r0.value)
      if (!flow) return { error: 'not-flowchart' }
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      if (!r1.ok) return { error: r1.error }
      const r2 = mermaid.mutate(r1.value, { kind: 'remove_edge', id: 'API->DB' })
      if (!r2.ok) return { error: r2.error }
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
      if (!r3.ok) return { error: r3.error }
      const r4 = mermaid.mutate(r3.value, { kind: 'add_edge', from: 'Cache', to: 'DB' })
      if (!r4.ok) return { error: r4.error }
      const verify = mermaid.verifyMermaid(r4.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r4.value) }
    `,
  },
  {
    id: 'sequence_alt_refuses_mutation',
    prompt: 'Given a sequence diagram with an alt block, detect that structured sequence mutation is unavailable and preserve source.',
    script: `
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  alt ok\\n    B-->>A: yes\\n  end')
      if (!r0.ok) return { error: 'parse' }
      return { refused: mermaid.asSequence(r0.value) === null, source: r0.value.canonicalSource }
    `,
  },
]

export async function runAgentUsageEval(cases: AgentUsageEvalCase[] = DEFAULT_CASES): Promise<AgentUsageEvalSummary> {
  const results: AgentUsageEvalResult[] = []
  for (const c of cases) {
    const exec = await executeInSandbox(c.script, { trace: true })
    const trace = (exec.trace ?? []) as SdkCall[]
    const findings = lintAgentTrace(trace)
    const taskOk = exec.ok ? checkTask(c.id, exec.value, trace) : false
    const traceOk = findings.length === 0 && checkTrace(c.id, trace)
    results.push({ id: c.id, ok: Boolean(exec.ok && taskOk && traceOk), taskOk, traceOk, findings, error: exec.ok ? undefined : exec.error })
  }
  const passed = results.filter(r => r.ok).length
  return { ok: passed === results.length, total: results.length, passed, structuredPathRate: results.filter(r => r.traceOk).length / Math.max(1, results.length), results }
}

function checkTrace(id: string, trace: SdkCall[]): boolean {
  if (id === 'cache_between_api_and_db') {
    const serializes = trace.filter((c): c is Extract<SdkCall, { verb: 'serialize' }> => c.verb === 'serialize')
    if (serializes.length !== 1) return false
    const finalDiagram = serializes[0]!.diagram
    if (finalDiagram === undefined) return false
    const mutates = trace.filter((c): c is Extract<SdkCall, { verb: 'mutate' }> => c.verb === 'mutate')
    if (mutates.length === 0 || !mutates.some(m => m.output === finalDiagram)) return false
    return trace.some(c => c.verb === 'parse') && trace.some(c => c.verb === 'narrow' && c.family === 'flowchart' && c.ok === true) && trace.some(c => c.verb === 'verify' && c.diagram === finalDiagram && c.ok === true && c.inspected !== false)
  }
  if (id === 'sequence_alt_refuses_mutation') {
    return trace.some(c => c.verb === 'parse') && trace.some(c => c.verb === 'narrow' && c.family === 'sequence' && c.ok === false) && !trace.some(c => c.verb === 'mutate')
  }
  return false
}

function lastSerializedSource(trace: SdkCall[]): string | undefined {
  for (let i = trace.length - 1; i >= 0; i--) {
    const c = trace[i]!
    if (c.verb === 'serialize') return c.source
  }
  return undefined
}

function checkTask(id: string, value: unknown, trace: SdkCall[]): boolean {
  if (id === 'cache_between_api_and_db') {
    const source = (value as { source?: unknown } | undefined)?.source
    const serialized = lastSerializedSource(trace)
    if (typeof source !== 'string' || source !== serialized) return false
    const parsed = parseMermaid(source)
    if (!parsed.ok) return false
    const graph = asFlowchart(parsed.value)?.body.graph
    if (!graph?.nodes.has('Cache')) return false
    const edges = new Set(graph.edges.map(e => `${e.source}->${e.target}`))
    return edges.has('API->Cache') && edges.has('Cache->DB') && !edges.has('API->DB')
  }
  if (id === 'sequence_alt_refuses_mutation') {
    const source = (value as { source?: unknown } | undefined)?.source
    const parsedSource = trace.find((c): c is Extract<SdkCall, { verb: 'parse' }> => c.verb === 'parse')?.source
    return (value as { refused?: unknown } | undefined)?.refused === true && typeof source === 'string' && source === parsedSource
  }
  return false
}

if (import.meta.main) {
  const summary = await runAgentUsageEval()
  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.ok ? 0 : 1)
}
