import { executeInSandbox } from '../../src/mcp/sandbox.ts'
import { parseMermaid } from '../../src/agent/parse.ts'
import { asFlowchart, asState, asSequence, asTimeline, asClass, asEr, asJourney, asArchitecture, asXyChart, asPie, asQuadrant, asGantt, type DiagramKind } from '../../src/agent/types.ts'
import { lintAgentTrace, type SdkCall, type AntiPattern } from './harness.ts'
import { buildHomepageAgentPromptTask } from './homepage-prompt.ts'

export interface AgentUsageEvalCase {
  id: string
  family?: DiagramKind
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
  /** Any safe route: direct source authoring for new diagrams, refusal for opaque, or structured mutation for editable inputs. */
  safePathRate: number
  /** Structured-mutation success rate for cases where typed mutation is required. */
  structuredPathRate: number
  results: AgentUsageEvalResult[]
}

function promptTask(task: string, context: string, source?: string): string {
  return buildHomepageAgentPromptTask(task, context, source)
}

export const DEFAULT_CASES: AgentUsageEvalCase[] = [
  {
    id: 'cache_between_api_and_db',
    family: 'flowchart',
    prompt: promptTask(
      'Insert Cache between API and DB using structured mutation, verify, then serialize.',
      'Existing flowchart has API connected directly to DB. Preserve both existing node labels and replace the direct edge with API → Cache → DB.',
      'flowchart TD\n  API --> DB',
    ),
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
    id: 'state_add_done_transition',
    family: 'state',
    prompt: promptTask(
      'Add a done transition from Processing to [*] using structured mutation, verify, then serialize.',
      'The state diagram already has a start state and Processing state. Add the completion path without changing existing transitions.',
      'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start',
    ),
    input: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start',
    script: `
      const r0 = mermaid.parseMermaid('stateDiagram-v2\\n  [*] --> Idle\\n  Idle --> Processing : start')
      if (!r0.ok) return { error: 'parse' }
      const state = mermaid.asState(r0.value)
      if (!state) return { error: 'not-state' }
      const r1 = mermaid.mutate(state, { kind: 'add_transition', from: 'Processing', to: '[*]', label: 'done' })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'sequence_alt_add_message',
    family: 'sequence',
    prompt: promptTask(
      'Add a top-level message A->>B: bye using structured mutation, verify, then serialize. Preserve the alt block verbatim.',
      'The sequence diagram contains one top-level message and an alt block. The new message belongs at top level, not inside the alt block.',
      'sequenceDiagram\n  A->>B: hi\n  alt ok\n    B-->>A: yes\n  end',
    ),
    input: 'sequenceDiagram\n  A->>B: hi\n  alt ok\n    B-->>A: yes\n  end',
    script: `
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  alt ok\\n    B-->>A: yes\\n  end')
      if (!r0.ok) return { error: 'parse' }
      const seq = mermaid.asSequence(r0.value)
      if (!seq) return { error: 'not-sequence' }
      const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'A', to: 'B', text: 'bye' })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'timeline_add_event',
    family: 'timeline',
    prompt: promptTask(
      'Add event Beta to the 2024 period using structured mutation, verify, then serialize.',
      'The timeline has a title and one period. Keep Alpha and append Beta in the same period.',
      'timeline\n  title Plan\n  2024 : Alpha',
    ),
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
    family: 'class',
    prompt: promptTask(
      'Add a Duck class with +quack() using structured mutation, verify, then serialize.',
      'The class diagram already contains Animal. Add Duck as its own class with one public quack member.',
      'classDiagram\n  class Animal',
    ),
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
    family: 'er',
    prompt: promptTask(
      'Add an ORDER entity with string id using structured mutation, verify, then serialize.',
      'The ER diagram has CUSTOMER. Add ORDER with a string id attribute; no relation is needed for this task.',
      'erDiagram\n  CUSTOMER {\n    string id\n  }',
    ),
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
  {
    id: 'journey_add_review_task',
    family: 'journey',
    prompt: promptTask(
      'Add a Review task scored 4 for Agent to the Build section using structured mutation, verify, then serialize.',
      'The journey has one section named Build and one task named Draft. Append Review in the same section.',
      'journey\n  section Build\n    Draft: 3: Agent',
    ),
    input: 'journey\n  section Build\n    Draft: 3: Agent',
    script: `
      const r0 = mermaid.parseMermaid('journey\\n  section Build\\n    Draft: 3: Agent')
      if (!r0.ok) return { error: 'parse' }
      const journey = mermaid.asJourney(r0.value)
      if (!journey) return { error: 'not-journey' }
      const r1 = mermaid.mutate(journey, { kind: 'add_task', sectionIndex: 0, text: 'Review', score: 4, actors: ['Agent'] })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'architecture_add_cache',
    family: 'architecture',
    prompt: promptTask(
      'Add a Cache service and connect API to Cache using structured mutation, verify, then serialize.',
      'The architecture diagram has api and db services. Add cache as a disk service and draw API right side to Cache left side with label cache.',
      'architecture-beta\n  service api(server)[API]\n  service db(database)[DB]\n  api:R --> L:db',
    ),
    input: 'architecture-beta\n  service api(server)[API]\n  service db(database)[DB]\n  api:R --> L:db',
    script: `
      const r0 = mermaid.parseMermaid('architecture-beta\\n  service api(server)[API]\\n  service db(database)[DB]\\n  api:R --> L:db')
      if (!r0.ok) return { error: 'parse' }
      const arch = mermaid.asArchitecture(r0.value)
      if (!arch) return { error: 'not-architecture' }
      const r1 = mermaid.mutate(arch, { kind: 'add_service', id: 'cache', label: 'Cache', icon: 'disk' })
      if (!r1.ok) return { error: r1.error }
      const r2 = mermaid.mutate(r1.value, { kind: 'add_edge', from: 'api', to: 'cache', fromSide: 'R', toSide: 'L', label: 'cache' })
      if (!r2.ok) return { error: r2.error }
      const verify = mermaid.verifyMermaid(r2.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r2.value) }
    `,
  },
  {
    id: 'xychart_add_forecast',
    family: 'xychart',
    prompt: promptTask(
      'Add a Forecast line series [2, 3] using structured mutation, verify, then serialize.',
      'The chart has two quarters and one Revenue bar series. Add a second series as a line named Forecast.',
      'xychart-beta\n  x-axis [Q1, Q2]\n  bar Revenue [1, 2]',
    ),
    input: 'xychart-beta\n  x-axis [Q1, Q2]\n  bar Revenue [1, 2]',
    script: `
      const r0 = mermaid.parseMermaid('xychart-beta\\n  x-axis [Q1, Q2]\\n  bar Revenue [1, 2]')
      if (!r0.ok) return { error: 'parse' }
      const xy = mermaid.asXyChart(r0.value)
      if (!xy) return { error: 'not-xychart' }
      const r1 = mermaid.mutate(xy, { kind: 'add_series', kind2: 'line', name: 'Forecast', values: [2, 3] })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'pie_add_docs_slice',
    family: 'pie',
    prompt: promptTask(
      'Add a Docs slice with value 3 using structured mutation, verify, then serialize.',
      'The pie chart has Build and Test slices. Add Docs without renaming existing slices.',
      'pie\n  "Build" : 5\n  "Test" : 2',
    ),
    input: 'pie\n  "Build" : 5\n  "Test" : 2',
    script: `
      const r0 = mermaid.parseMermaid('pie\\n  "Build" : 5\\n  "Test" : 2')
      if (!r0.ok) return { error: 'parse' }
      const pie = mermaid.asPie(r0.value)
      if (!pie) return { error: 'not-pie' }
      const r1 = mermaid.mutate(pie, { kind: 'add_slice', label: 'Docs', value: 3 })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'quadrant_add_docs_point',
    family: 'quadrant',
    prompt: promptTask(
      'Add a Docs point at [0.8, 0.2] using structured mutation, verify, then serialize.',
      'The quadrant chart has one API point. Add Docs as a distinct point and preserve axis labels.',
      'quadrantChart\n  x-axis Low --> High\n  y-axis Easy --> Hard\n  API: [0.4, 0.7]',
    ),
    input: 'quadrantChart\n  x-axis Low --> High\n  y-axis Easy --> Hard\n  API: [0.4, 0.7]',
    script: `
      const r0 = mermaid.parseMermaid('quadrantChart\\n  x-axis Low --> High\\n  y-axis Easy --> Hard\\n  API: [0.4, 0.7]')
      if (!r0.ok) return { error: 'parse' }
      const quad = mermaid.asQuadrant(r0.value)
      if (!quad) return { error: 'not-quadrant' }
      const r1 = mermaid.mutate(quad, { kind: 'add_point', label: 'Docs', x: 0.8, y: 0.2 })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'gantt_add_docs_task',
    family: 'gantt',
    prompt: promptTask(
      'Add a Docs task after Core using structured mutation, verify, then serialize.',
      'The Gantt chart has one Build section and a Core task with id core. Add Docs with task id docs, start after core, duration 2d.',
      'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Core :core, 2024-01-01, 2d',
    ),
    input: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Core :core, 2024-01-01, 2d',
    script: `
      const r0 = mermaid.parseMermaid('gantt\\n  dateFormat YYYY-MM-DD\\n  section Build\\n    Core :core, 2024-01-01, 2d')
      if (!r0.ok) return { error: 'parse' }
      const gantt = mermaid.asGantt(r0.value)
      if (!gantt) return { error: 'not-gantt' }
      const r1 = mermaid.mutate(gantt, { kind: 'add_task', sectionIndex: 0, label: 'Docs', taskId: 'docs', start: 'after core', end: '2d' })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'author_auth_flow_source',
    family: 'flowchart',
    prompt: promptTask(
      'Create a new Auth Flow flowchart as Mermaid source, parse it, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
      'Diagram these facts: User opens Login Page; invalid credentials return to Login Page; valid credentials check MFA; MFA users enter a code; invalid code returns to Enter MFA Code; valid code creates a session; users without MFA create a session; session leads to Dashboard.',
    ),
    script: `
      const source = '---\\ntitle: Auth Flow\\n---\\nflowchart LR\\n  A[User] --> B[Login Page]\\n  B --> C{Valid Credentials?}\\n  C -->|No| B\\n  C -->|Yes| D{MFA Enabled?}\\n  D -->|Yes| E[Enter MFA Code]\\n  E --> F{Code Valid?}\\n  F -->|No| E\\n  D -->|No| G[Create Session]\\n  F -->|Yes| G\\n  G --> H[Dashboard]'
      const parsed = mermaid.parseMermaid(source)
      if (!parsed.ok) return { error: parsed.error }
      const verify = mermaid.verifyMermaid(parsed.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source }
    `,
  },
  {
    id: 'author_api_sequence_source',
    family: 'sequence',
    prompt: promptTask(
      'Create a new sequence diagram from the context, parse it, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
      'Diagram this flow: User asks App to export; App asks API to render SVG; API returns SVG string; App gives User a download.',
    ),
    script: `
      const source = 'sequenceDiagram\\n  participant User\\n  participant App\\n  participant API\\n  User->>App: Export diagram\\n  App->>API: Render SVG\\n  API-->>App: SVG string\\n  App-->>User: Download'
      const parsed = mermaid.parseMermaid(source)
      if (!parsed.ok) return { error: parsed.error }
      const verify = mermaid.verifyMermaid(parsed.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source }
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
    const taskOk = exec.ok ? checkTask(c.id, input, exec.value, trace) : false
    const traceOk = findings.length === 0 && checkTrace(c.id, input, trace)
    results.push({ id: c.id, ok: Boolean(exec.ok && taskOk && traceOk), taskOk, traceOk, findings, error: exec.ok ? undefined : exec.error })
  }
  const passed = results.filter(r => r.ok).length
  const safePathRate = results.filter(r => r.traceOk).length / Math.max(1, results.length)
  const structuredCases = results.filter(r => requiresStructuredMutation(r.id))
  const structuredPathRate = structuredCases.filter(r => r.traceOk).length / Math.max(1, structuredCases.length)
  return { ok: passed === results.length, total: results.length, passed, safePathRate, structuredPathRate, results }
}

export function requiresStructuredMutation(id: string): boolean {
  return STRUCTURED_CASES.has(id)
}

const STRUCTURED_CASES = new Set([
  'cache_between_api_and_db',
  'state_add_done_transition',
  'sequence_alt_add_message',
  'timeline_add_event',
  'class_add_duck',
  'er_add_order',
  'journey_add_review_task',
  'architecture_add_cache',
  'xychart_add_forecast',
  'pie_add_docs_slice',
  'quadrant_add_docs_point',
  'gantt_add_docs_task',
])

type MutableFamily = Extract<SdkCall, { verb: 'narrow' }>['family']

function defaultInput(id: string): string | undefined {
  return DEFAULT_CASES.find(c => c.id === id)?.input
}

function canonicalInput(input: string): string {
  const parsed = parseMermaid(input)
  return parsed.ok ? parsed.value.canonicalSource : input
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

function checkSourceAuthoringTrace(trace: SdkCall[]): boolean {
  const parses = trace.filter((c): c is Extract<SdkCall, { verb: 'parse' }> => c.verb === 'parse')
  if (parses.length !== 1 || parses[0]!.diagram === undefined) return false
  const diagram = parses[0]!.diagram
  return !trace.some(c => c.verb === 'mutate' || c.verb === 'serialize')
    && trace.some(c => c.verb === 'verify' && c.diagram === diagram && c.ok === true)
    && trace.some(c => c.verb === 'verify_inspect' && c.diagram === diagram)
}

function checkTrace(id: string, input: string | undefined, trace: SdkCall[]): boolean {
  if (id.startsWith('author_')) return checkSourceAuthoringTrace(trace)
  if (!input) return false
  if (id === 'cache_between_api_and_db') return checkMutationTrace(id, input, 'flowchart', trace) && hasMutationOps(trace, input, ['add_node', 'remove_edge', 'add_edge', 'add_edge'])
  if (id === 'state_add_done_transition') return checkMutationTrace(id, input, 'state', trace) && hasMutationOps(trace, input, ['add_transition'])
  if (id === 'timeline_add_event') return checkMutationTrace(id, input, 'timeline', trace) && hasMutationOps(trace, input, ['add_event'])
  if (id === 'class_add_duck') return checkMutationTrace(id, input, 'class', trace) && hasMutationOps(trace, input, ['add_class'])
  if (id === 'er_add_order') return checkMutationTrace(id, input, 'er', trace) && hasMutationOps(trace, input, ['add_entity'])
  if (id === 'journey_add_review_task') return checkMutationTrace(id, input, 'journey', trace) && hasMutationOps(trace, input, ['add_task'])
  if (id === 'architecture_add_cache') return checkMutationTrace(id, input, 'architecture', trace) && hasMutationOps(trace, input, ['add_service', 'add_edge'])
  if (id === 'xychart_add_forecast') return checkMutationTrace(id, input, 'xychart', trace) && hasMutationOps(trace, input, ['add_series'])
  if (id === 'pie_add_docs_slice') return checkMutationTrace(id, input, 'pie', trace) && hasMutationOps(trace, input, ['add_slice'])
  if (id === 'quadrant_add_docs_point') return checkMutationTrace(id, input, 'quadrant', trace) && hasMutationOps(trace, input, ['add_point'])
  if (id === 'gantt_add_docs_task') return checkMutationTrace(id, input, 'gantt', trace) && hasMutationOps(trace, input, ['add_task'])
  if (id === 'sequence_alt_add_message') return checkMutationTrace(id, input, 'sequence', trace) && hasMutationOps(trace, input, ['add_message'])
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

function checkAuthFlowSourceTask(value: unknown): boolean {
  const source = (value as { source?: unknown } | undefined)?.source
  if (typeof source !== 'string') return false
  const parsed = parseMermaid(source)
  if (!parsed.ok) return false
  const graph = asFlowchart(parsed.value)?.body.graph
  if (!graph) return false
  const labels = new Map(Array.from(graph.nodes.values()).map(n => [n.id, n.label]))
  const idMatching = (pattern: RegExp) => [...labels.entries()].find(([, label]) => pattern.test(label))?.[0]
  const user = idMatching(/^User$/i)
  const login = idMatching(/^Login Page$/i)
  const credentials = idMatching(/Valid Credentials\?/i)
  const mfa = idMatching(/MFA Enabled\?/i)
  const enterMfa = idMatching(/^Enter MFA Code$/i)
  const code = idMatching(/Code Valid\?|Valid Code\?/i)
  const session = idMatching(/^Create Session$/i)
  const dashboard = idMatching(/^Dashboard$/i)
  if (!user || !login || !credentials || !mfa || !enterMfa || !code || !session || !dashboard) return false
  const edges = new Set(graph.edges.map(e => `${e.source}->${e.target}`))
  return edges.has(`${user}->${login}`)
    && edges.has(`${login}->${credentials}`)
    && edges.has(`${credentials}->${login}`)
    && edges.has(`${credentials}->${mfa}`)
    && edges.has(`${mfa}->${enterMfa}`)
    && edges.has(`${enterMfa}->${code}`)
    && edges.has(`${code}->${enterMfa}`)
    && edges.has(`${mfa}->${session}`)
    && edges.has(`${code}->${session}`)
    && edges.has(`${session}->${dashboard}`)
}

function checkApiSequenceSourceTask(value: unknown): boolean {
  const source = (value as { source?: unknown } | undefined)?.source
  if (typeof source !== 'string') return false
  const parsed = parseMermaid(source)
  const body = parsed.ok ? asSequence(parsed.value)?.body : undefined
  if (!body) return false
  const participants = new Set(body.participants.map(p => p.id))
  return participants.has('User')
    && participants.has('App')
    && participants.has('API')
    && body.messages.some(m => m.from === 'User' && m.to === 'App' && /\bexport\b/i.test(m.text))
    && body.messages.some(m => m.from === 'App' && m.to === 'API' && m.text === 'Render SVG')
    && body.messages.some(m => m.from === 'API' && m.to === 'App' && m.text === 'SVG string')
    && body.messages.some(m => m.from === 'App' && m.to === 'User' && m.text === 'Download')
}

function serializedSource(value: unknown, trace: SdkCall[]): string | undefined {
  return returnedSerializedSource(value, trace)
}

export function checkAgentUsageTaskSource(id: string, source: string): boolean {
  const fakeSerializeTrace = [{ verb: 'serialize', diagram: 'final', source }] as SdkCall[]
  return checkTask(id, defaultInput(id), { source }, fakeSerializeTrace)
}

function checkTask(id: string, input: string | undefined, value: unknown, trace: SdkCall[]): boolean {
  if (id === 'author_auth_flow_source') return checkAuthFlowSourceTask(value)
  if (id === 'author_api_sequence_source') return checkApiSequenceSourceTask(value)
  if (!input) return false
  if (id === 'cache_between_api_and_db') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    if (!parsed.ok) return false
    const graph = asFlowchart(parsed.value)?.body.graph
    if (!graph?.nodes.has('Cache')) return false
    const edges = new Set(graph.edges.map(e => `${e.source}->${e.target}`))
    return edges.has('API->Cache') && edges.has('Cache->DB') && !edges.has('API->DB')
  }
  if (id === 'state_add_done_transition') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asState(parsed.value)?.body : undefined
    return Boolean(body?.transitions.some(t => t.from === 'Processing' && t.to === '[*]' && t.label === 'done'))
  }
  if (id === 'timeline_add_event') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asTimeline(parsed.value)?.body : undefined
    return Boolean(body?.sections.some(s => s.periods.some(p => p.events.some(e => e.text === 'Beta'))))
  }
  if (id === 'class_add_duck') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asClass(parsed.value)?.body : undefined
    const duck = body?.classes.find(c => c.id === 'Duck')
    return Boolean(duck?.members.includes('+quack()'))
  }
  if (id === 'er_add_order') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asEr(parsed.value)?.body : undefined
    const order = body?.entities.find(e => e.id === 'ORDER')
    return Boolean(order?.attributes.some(a => a.text === 'string id'))
  }
  if (id === 'journey_add_review_task') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asJourney(parsed.value)?.body : undefined
    return Boolean(body?.sections[0]?.tasks.some(t => t.text === 'Review' && t.score === 4 && t.actors.includes('Agent')))
  }
  if (id === 'architecture_add_cache') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asArchitecture(parsed.value)?.body : undefined
    return Boolean(body?.services.some(s => s.id === 'cache' && s.label === 'Cache' && s.icon === 'disk')
      && body.edges.some(e => e.source.id === 'api' && e.target.id === 'cache' && e.label === 'cache'))
  }
  if (id === 'xychart_add_forecast') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asXyChart(parsed.value)?.body : undefined
    return Boolean(body?.series.some(s => s.kind === 'line' && s.name === 'Forecast' && s.values.length === 2 && s.values[0] === 2 && s.values[1] === 3))
  }
  if (id === 'pie_add_docs_slice') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asPie(parsed.value)?.body : undefined
    return Boolean(body?.slices.some(s => s.label === 'Docs' && s.value === 3))
  }
  if (id === 'quadrant_add_docs_point') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asQuadrant(parsed.value)?.body : undefined
    return Boolean(body?.points.some(p => p.label === 'Docs' && p.x === 0.8 && p.y === 0.2))
  }
  if (id === 'gantt_add_docs_task') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    const body = parsed.ok ? asGantt(parsed.value)?.body : undefined
    return Boolean(body?.sections[0]?.tasks.some(t => t.label === 'Docs' && t.taskId === 'docs' && t.start === 'after core' && t.end === '2d'))
  }
  if (id === 'sequence_alt_add_message') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    if (!parsed.ok) return false
    const body = asSequence(parsed.value)?.body
    if (!body) return false
    // The new top-level message landed, and the alt block survives verbatim.
    return body.messages.some(m => m.from === 'A' && m.to === 'B' && m.text === 'bye')
      && source.includes('alt ok')
      && source.includes('B-->>A: yes')
      && source.includes('  end')
  }
  return false
}


if (import.meta.main) {
  const summary = await runAgentUsageEval()
  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.ok ? 0 : 1)
}
