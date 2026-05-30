import { executeInSandbox } from '../../src/mcp/sandbox.ts'
import { parseMermaid } from '../../src/agent/parse.ts'
import { asFlowchart, asTimeline, asClass, asEr } from '../../src/agent/types.ts'
import { lintAgentTrace, type SdkCall, type AntiPattern } from './harness.ts'

export interface AgentUsageEvalCase {
  id: string
  prompt: string
  /** Exact task input diagram; final serialized output must descend from this parsed diagram. */
  input?: string
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
    input: 'flowchart TD\n  API --> DB',
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
    input: 'sequenceDiagram\n  A->>B: hi\n  alt ok\n    B-->>A: yes\n  end',
    script: `
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  alt ok\\n    B-->>A: yes\\n  end')
      if (!r0.ok) return { error: 'parse' }
      return { refused: mermaid.asSequence(r0.value) === null, source: r0.value.body.source }
    `,
  },
  {
    id: 'timeline_add_event',
    prompt: 'Add event Beta to a timeline using structured mutation, verify, then serialize.',
    input: 'timeline\n  title Plan\n  2024 : Alpha',
    script: `
      const r0 = mermaid.parseMermaid('timeline\\n  title Plan\\n  2024 : Alpha')
      if (!r0.ok) return { error: 'parse' }
      const timeline = mermaid.asTimeline(r0.value)
      if (!timeline) return { error: 'not-timeline' }
      const r1 = mermaid.mutate(timeline, { kind: 'add_event', sectionIndex: 0, periodIndex: 0, text: 'Beta' })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'class_add_duck',
    prompt: 'Add a Duck class with +quack() using structured mutation, verify, then serialize.',
    input: 'classDiagram\n  class Animal',
    script: `
      const r0 = mermaid.parseMermaid('classDiagram\\n  class Animal')
      if (!r0.ok) return { error: 'parse' }
      const klass = mermaid.asClass(r0.value)
      if (!klass) return { error: 'not-class' }
      const r1 = mermaid.mutate(klass, { kind: 'add_class', id: 'Duck', members: ['+quack()'] })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'er_add_order',
    prompt: 'Add an ORDER entity with string id using structured mutation, verify, then serialize.',
    input: 'erDiagram\n  CUSTOMER {\n    string id\n  }',
    script: `
      const r0 = mermaid.parseMermaid('erDiagram\\n  CUSTOMER {\\n    string id\\n  }')
      if (!r0.ok) return { error: 'parse' }
      const er = mermaid.asEr(r0.value)
      if (!er) return { error: 'not-er' }
      const r1 = mermaid.mutate(er, { kind: 'add_entity', id: 'ORDER', attributes: ['string id'] })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
]

export async function runAgentUsageEval(cases: AgentUsageEvalCase[] = DEFAULT_CASES): Promise<AgentUsageEvalSummary> {
  const results: AgentUsageEvalResult[] = []
  for (const c of cases) {
    const input = c.input ?? defaultInput(c.id)
    const exec = await executeInSandbox(c.script, { trace: true })
    const trace = (exec.trace ?? []) as SdkCall[]
    const findings = lintAgentTrace(trace)
    const taskOk = exec.ok && input ? checkTask(c.id, input, exec.value, trace) : false
    const traceOk = input ? findings.length === 0 && checkTrace(c.id, input, trace) : false
    results.push({ id: c.id, ok: Boolean(exec.ok && taskOk && traceOk), taskOk, traceOk, findings, error: exec.ok ? undefined : exec.error })
  }
  const passed = results.filter(r => r.ok).length
  return { ok: passed === results.length, total: results.length, passed, structuredPathRate: results.filter(r => r.traceOk).length / Math.max(1, results.length), results }
}

type MutableFamily = 'flowchart' | 'timeline' | 'class' | 'er'

function defaultInput(id: string): string | undefined {
  return DEFAULT_CASES.find(c => c.id === id)?.input
}

function canonicalInput(input: string): string {
  const parsed = parseMermaid(input)
  return parsed.ok ? parsed.value.canonicalSource : input
}

function preservedInputSource(input: string): string {
  const parsed = parseMermaid(input)
  return parsed.ok && parsed.value.body.kind === 'opaque' ? parsed.value.body.source : canonicalInput(input)
}

function parsedInputDiagram(trace: SdkCall[], input: string): number | string | undefined {
  const canonical = canonicalInput(input)
  return trace.find((c): c is Extract<SdkCall, { verb: 'parse' }> => c.verb === 'parse' && (c.source === input || c.source === canonical))?.diagram
}

function reachesDiagram(trace: SdkCall[], start: number | string | undefined, final: number | string | undefined): boolean {
  if (start === undefined || final === undefined) return false
  const reachable = new Set<number | string>([start])
  for (const c of trace) {
    if (c.verb === 'mutate' && c.input !== undefined && c.output !== undefined && reachable.has(c.input)) reachable.add(c.output)
  }
  return reachable.has(final)
}

function checkMutationTrace(id: string, input: string, family: MutableFamily, trace: SdkCall[]): boolean {
  const serializes = trace.filter((c): c is Extract<SdkCall, { verb: 'serialize' }> => c.verb === 'serialize')
  if (serializes.length !== 1) return false
  const finalDiagram = serializes[0]!.diagram
  const inputDiagram = parsedInputDiagram(trace, input)
  if (!reachesDiagram(trace, inputDiagram, finalDiagram)) return false
  const mutates = trace.filter((c): c is Extract<SdkCall, { verb: 'mutate' }> => c.verb === 'mutate')
  if (mutates.length === 0 || !mutates.some(m => m.output === finalDiagram)) return false
  return trace.some(c => c.verb === 'narrow' && c.family === family && c.ok === true && reachesDiagram(trace, inputDiagram, c.input))
    && trace.some(c => c.verb === 'verify' && c.diagram === finalDiagram && c.ok === true)
    && trace.some(c => c.verb === 'verify_inspect' && c.diagram === finalDiagram)
}

function lastSerializedDiagram(trace: SdkCall[]): number | string | undefined {
  for (let i = trace.length - 1; i >= 0; i--) {
    const c = trace[i]!
    if (c.verb === 'serialize') return c.diagram
  }
  return undefined
}

function hasMutationOps(trace: SdkCall[], input: string, required: string[]): boolean {
  const finalDiagram = lastSerializedDiagram(trace)
  const inputDiagram = parsedInputDiagram(trace, input)
  const actual = trace.filter((c): c is Extract<SdkCall, { verb: 'mutate' }> => c.verb === 'mutate')
    .filter(c => c.opKind && c.input !== undefined && c.output !== undefined)
    .filter(c => reachesDiagram(trace, inputDiagram, c.input) && reachesDiagram(trace, c.output, finalDiagram))
    .map(c => c.opKind!)
  const counts = new Map<string, number>()
  for (const op of actual) counts.set(op, (counts.get(op) ?? 0) + 1)
  for (const op of required) {
    const next = (counts.get(op) ?? 0) - 1
    if (next < 0) return false
    counts.set(op, next)
  }
  return true
}

function checkTrace(id: string, input: string, trace: SdkCall[]): boolean {
  if (id === 'cache_between_api_and_db') return checkMutationTrace(id, input, 'flowchart', trace) && hasMutationOps(trace, input, ['add_node', 'remove_edge', 'add_edge', 'add_edge'])
  if (id === 'timeline_add_event') return checkMutationTrace(id, input, 'timeline', trace) && hasMutationOps(trace, input, ['add_event'])
  if (id === 'class_add_duck') return checkMutationTrace(id, input, 'class', trace) && hasMutationOps(trace, input, ['add_class'])
  if (id === 'er_add_order') return checkMutationTrace(id, input, 'er', trace) && hasMutationOps(trace, input, ['add_entity'])
  if (id === 'sequence_alt_refuses_mutation') {
    const inputDiagram = parsedInputDiagram(trace, input)
    return inputDiagram !== undefined && trace.some(c => c.verb === 'narrow' && c.family === 'sequence' && c.ok === false && c.input === inputDiagram) && !trace.some(c => c.verb === 'mutate')
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

function returnedSerializedSource(value: unknown, trace: SdkCall[]): string | undefined {
  const source = (value as { source?: unknown } | undefined)?.source
  const serialized = lastSerializedSource(trace)
  return typeof source === 'string' && source === serialized ? source : undefined
}

function checkTask(id: string, input: string, value: unknown, trace: SdkCall[]): boolean {
  if (id === 'cache_between_api_and_db') {
    const source = returnedSerializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    if (!parsed.ok) return false
    const graph = asFlowchart(parsed.value)?.body.graph
    if (!graph?.nodes.has('Cache')) return false
    const edges = new Set(graph.edges.map(e => `${e.source}->${e.target}`))
    return edges.has('API->Cache') && edges.has('Cache->DB') && !edges.has('API->DB')
  }
  if (id === 'timeline_add_event') {
    const source = returnedSerializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asTimeline(parsed.value)?.body : undefined
    return Boolean(body?.sections.some(s => s.periods.some(p => p.events.some(e => e.text === 'Beta'))))
  }
  if (id === 'class_add_duck') {
    const source = returnedSerializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asClass(parsed.value)?.body : undefined
    const duck = body?.classes.find(c => c.id === 'Duck')
    return Boolean(duck?.members.includes('+quack()'))
  }
  if (id === 'er_add_order') {
    const source = returnedSerializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asEr(parsed.value)?.body : undefined
    const order = body?.entities.find(e => e.id === 'ORDER')
    return Boolean(order?.attributes.some(a => a.text === 'string id'))
  }
  if (id === 'sequence_alt_refuses_mutation') {
    const source = (value as { source?: unknown } | undefined)?.source
    return (value as { refused?: unknown } | undefined)?.refused === true && typeof source === 'string' && source === preservedInputSource(input)
  }
  return false
}

if (import.meta.main) {
  const summary = await runAgentUsageEval()
  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.ok ? 0 : 1)
}
