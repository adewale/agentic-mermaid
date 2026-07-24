import { type CheckMermaidSpec, checkMermaidSource } from '../../src/agent/facts.ts'
import { parseRegisteredMermaid as parseMermaid } from '../../src/agent/parse.ts'
import { serializeMermaid } from '../../src/agent/serialize.ts'
import { asArchitecture, asClass, asEr, asFlowchart, asGantt, asGitGraph, asJourney, asMindmap, asPie, asQuadrant, asRadar, asSankey, asSequence, asState, asTimeline, asXyChart, type DiagramKind, type ParsedDiagram } from '../../src/agent/types.ts'
import { executeInSandbox } from '../../src/mcp/sandbox.ts'
import { type AntiPattern, lintAgentTrace, type SdkCall } from './harness.ts'
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
  /** PRIMARY: diagrams the task oracle accepts (correctness, independent of how
   *  tool use was narrated). Trace here is the replayed sandbox trace, so the
   *  two axes are separable rather than merged into one pass/fail. */
  taskPassed: number
  taskOkRate: number
  /** Composite (taskOk && traceOk) count — the strict gate for stored scripts. */
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
    prompt: promptTask('Insert Cache between API and DB using structured mutation, verify, then serialize.', 'Existing flowchart has API connected directly to DB. Preserve both existing node labels and replace the direct edge with API → Cache → DB.', 'flowchart TD\n  API --> DB'),
    input: 'flowchart TD\n  API --> DB',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('flowchart TD\\n  API --> DB')
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
    prompt: promptTask('Add a done transition from Processing to [*] using structured mutation, verify, then serialize.', 'The state diagram already has a start state and Processing state. Add the completion path without changing existing transitions.', 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start'),
    input: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('stateDiagram-v2\\n  [*] --> Idle\\n  Idle --> Processing : start')
      if (!r0.ok) return { error: 'parse' }
      const state = mermaid.asState(r0.value)
      if (!state) return { error: 'not-state' }
      const r1 = mermaid.mutate(state, { kind: 'add_transition', from: 'Processing', to: '[*]', label: 'done' })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      const semantic = mermaid.checkMermaid(r1.value, ['edge Processing -> [*] : done'])
      if (!semantic.ok) return { error: 'semantic', missing: semantic.missing, unexpected: semantic.unexpected }
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
      const r0 = mermaid.parseRegisteredMermaid('sequenceDiagram\\n  A->>B: hi\\n  alt ok\\n    B-->>A: yes\\n  end')
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
    prompt: promptTask('Add event Beta to the 2024 period using structured mutation, verify, then serialize.', 'The timeline has a title and one period. Keep Alpha and append Beta in the same period.', 'timeline\n  title Plan\n  2024 : Alpha'),
    input: 'timeline\n  title Plan\n  2024 : Alpha',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('timeline\\n  title Plan\\n  2024 : Alpha')
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
    prompt: promptTask('Add a Duck class with +quack() using structured mutation, verify, then serialize.', 'The class diagram already contains Animal. Add Duck as its own class with one public quack member.', 'classDiagram\n  class Animal'),
    input: 'classDiagram\n  class Animal',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('classDiagram\\n  class Animal')
      if (!r0.ok) return { error: 'parse' }
      const klass = mermaid.asClass(r0.value)
      if (!klass) return { error: 'not-class' }
      const r1 = mermaid.mutate(klass, { kind: 'add_class', id: 'Duck', members: ['+quack()'] })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      const semantic = mermaid.checkMermaid(r1.value, ['class Duck', 'member Duck +quack()'])
      if (!semantic.ok) return { error: 'semantic', missing: semantic.missing, unexpected: semantic.unexpected }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'er_add_order',
    family: 'er',
    prompt: promptTask('Add an ORDER entity with string id using structured mutation, verify, then serialize.', 'The ER diagram has CUSTOMER. Add ORDER with a string id attribute; no relation is needed for this task.', 'erDiagram\n  CUSTOMER {\n    string id\n  }'),
    input: 'erDiagram\n  CUSTOMER {\n    string id\n  }',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('erDiagram\\n  CUSTOMER {\\n    string id\\n  }')
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
    prompt: promptTask('Add a Review task scored 4 for Agent to the Build section using structured mutation, verify, then serialize.', 'The journey has one section named Build and one task named Draft. Append Review in the same section.', 'journey\n  section Build\n    Draft: 3: Agent'),
    input: 'journey\n  section Build\n    Draft: 3: Agent',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('journey\\n  section Build\\n    Draft: 3: Agent')
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
      const r0 = mermaid.parseRegisteredMermaid('architecture-beta\\n  service api(server)[API]\\n  service db(database)[DB]\\n  api:R --> L:db')
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
    prompt: promptTask('Add a Forecast line series [2, 3] using structured mutation, verify, then serialize.', 'The chart has two quarters and one Revenue bar series. Add a second series as a line named Forecast.', 'xychart-beta\n  x-axis [Q1, Q2]\n  bar Revenue [1, 2]'),
    input: 'xychart-beta\n  x-axis [Q1, Q2]\n  bar Revenue [1, 2]',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('xychart-beta\\n  x-axis [Q1, Q2]\\n  bar Revenue [1, 2]')
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
    prompt: promptTask('Add a Docs slice with value 3 using structured mutation, verify, then serialize.', 'The pie chart has Build and Test slices. Add Docs without renaming existing slices.', 'pie\n  "Build" : 5\n  "Test" : 2'),
    input: 'pie\n  "Build" : 5\n  "Test" : 2',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('pie\\n  "Build" : 5\\n  "Test" : 2')
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
    prompt: promptTask('Add a Docs point at [0.8, 0.2] using structured mutation, verify, then serialize.', 'The quadrant chart has one API point. Add Docs as a distinct point and preserve axis labels.', 'quadrantChart\n  x-axis Low --> High\n  y-axis Easy --> Hard\n  API: [0.4, 0.7]'),
    input: 'quadrantChart\n  x-axis Low --> High\n  y-axis Easy --> Hard\n  API: [0.4, 0.7]',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('quadrantChart\\n  x-axis Low --> High\\n  y-axis Easy --> Hard\\n  API: [0.4, 0.7]')
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
    prompt: promptTask('Add a Docs task after Core using structured mutation, verify, then serialize.', 'The Gantt chart has one Build section and a Core task with id core. Add Docs with task id docs, start after core, duration 2d.', 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Core :core, 2024-01-01, 2d'),
    input: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Core :core, 2024-01-01, 2d',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('gantt\\n  dateFormat YYYY-MM-DD\\n  section Build\\n    Core :core, 2024-01-01, 2d')
      if (!r0.ok) return { error: 'parse' }
      const gantt = mermaid.asGantt(r0.value)
      if (!gantt) return { error: 'not-gantt' }
      const r1 = mermaid.mutate(gantt, { kind: 'add_task', sectionIndex: 0, label: 'Docs', taskId: 'docs', start: 'after core', end: '2d' })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      const semantic = mermaid.checkMermaid(r1.value, ['task Docs id docs', 'task Docs start after core', 'task Docs end 2d'])
      if (!semantic.ok) return { error: 'semantic', missing: semantic.missing, unexpected: semantic.unexpected }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'mindmap_add_evidence_node',
    family: 'mindmap',
    prompt: promptTask('Add an Evidence child under Research using structured mutation, verify, then serialize.', 'The mindmap has a Product root and Research child. Preserve both and add Evidence directly under Research.', 'mindmap\n  Product\n    Research'),
    input: 'mindmap\n  Product\n    Research',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('mindmap\\n  Product\\n    Research')
      if (!r0.ok) return { error: 'parse' }
      const mindmap = mermaid.asMindmap(r0.value)
      if (!mindmap) return { error: 'not-mindmap' }
      const r1 = mermaid.mutate(mindmap, { kind: 'add_node', id: 'Evidence', label: 'Evidence', parent: 'Research' })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      const semantic = mermaid.checkMermaid(r1.value, ['edge Research -> Evidence'])
      if (!semantic.ok) return { error: 'semantic', missing: semantic.missing }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'gitgraph_add_release_commit',
    family: 'gitgraph',
    prompt: promptTask('Create a release branch and append a tagged RC commit using structured mutation, verify, then serialize.', 'The GitGraph has one ROOT commit on main. Create branch release with order 2, then append commit RC tagged rc.1 on that branch.', 'gitGraph\n  commit id:"ROOT" msg:"Foundation"'),
    input: 'gitGraph\n  commit id:"ROOT" msg:"Foundation"',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('gitGraph\\n  commit id:"ROOT" msg:"Foundation"')
      if (!r0.ok) return { error: 'parse' }
      const gitgraph = mermaid.asGitGraph(r0.value)
      if (!gitgraph) return { error: 'not-gitgraph' }
      const r1 = mermaid.mutate(gitgraph, { kind: 'create_branch', name: 'release', order: 2 })
      if (!r1.ok) return { error: r1.error }
      const r2 = mermaid.mutate(r1.value, { kind: 'append_commit', id: 'RC', message: 'Release candidate', type: 'HIGHLIGHT', tags: ['rc.1'] })
      if (!r2.ok) return { error: r2.error }
      const verify = mermaid.verifyMermaid(r2.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      const semantic = mermaid.checkMermaid(r2.value, ['commit RC branch release', 'commit RC tag rc.1'])
      if (!semantic.ok) return { error: 'semantic', missing: semantic.missing }
      return { source: mermaid.serializeMermaid(r2.value) }
    `,
  },
  {
    id: 'radar_add_beta_curve',
    family: 'radar',
    prompt: promptTask(
      'Add a Beta curve with values 3, 5, 4 using structured mutation, verify, then serialize.',
      'The radar has Speed, Power, Range axes and an Alpha curve. Add Beta with one value per axis and preserve the existing axes and Alpha curve.',
      'radar-beta\n  axis Speed, Power, Range\n  curve alpha["Alpha"]{4, 3, 5}\n  max 5',
    ),
    input: 'radar-beta\n  axis Speed, Power, Range\n  curve alpha["Alpha"]{4, 3, 5}\n  max 5',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('radar-beta\\n  axis Speed, Power, Range\\n  curve alpha["Alpha"]{4, 3, 5}\\n  max 5')
      if (!r0.ok) return { error: 'parse' }
      const radar = mermaid.asRadar(r0.value)
      if (!radar) return { error: 'not-radar' }
      const r1 = mermaid.mutate(radar, { kind: 'add_curve', id: 'beta', label: 'Beta', values: [3, 5, 4] })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `,
  },
  {
    id: 'sankey_add_losses_flow',
    family: 'sankey',
    prompt: promptTask(
      'Add an Electricity,Losses,56.69 flow using structured mutation, verify, then serialize.',
      'The sankey has Coal and Gas flowing into Electricity, and Electricity flowing into Homes. Add the Losses flow and preserve every existing row.',
      'sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,151.89\n  Electricity,Homes,223.13',
    ),
    input: 'sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,151.89\n  Electricity,Homes,223.13',
    script: `
      const r0 = mermaid.parseRegisteredMermaid('sankey-beta\\n  Coal,Electricity,127.93\\n  Gas,Electricity,151.89\\n  Electricity,Homes,223.13')
      if (!r0.ok) return { error: 'parse' }
      const sankey = mermaid.asSankey(r0.value)
      if (!sankey) return { error: 'not-sankey' }
      const r1 = mermaid.mutate(sankey, { kind: 'add_link', source: 'Electricity', target: 'Losses', value: 56.69 })
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
      'Diagram this login flow with one node per described step. Nodes: User; Login Page; a "Valid Credentials?" decision; an "MFA Enabled?" decision; Enter MFA Code; a "Code Valid?" decision; Create Session; Dashboard. Edges: User to Login Page; Login Page to Valid Credentials?; Valid Credentials? on No back to Login Page; Valid Credentials? on Yes to MFA Enabled?; MFA Enabled? on Yes to Enter MFA Code; Enter MFA Code to Code Valid?; Code Valid? on No back to Enter MFA Code; MFA Enabled? on No to Create Session; Code Valid? on Yes to Create Session; Create Session to Dashboard.',
    ),
    script: `
      const source = '---\\ntitle: Auth Flow\\n---\\nflowchart LR\\n  A[User] --> B[Login Page]\\n  B --> C{Valid Credentials?}\\n  C -->|No| B\\n  C -->|Yes| D{MFA Enabled?}\\n  D -->|Yes| E[Enter MFA Code]\\n  E --> F{Code Valid?}\\n  F -->|No| E\\n  D -->|No| G[Create Session]\\n  F -->|Yes| G\\n  G --> H[Dashboard]'
      const parsed = mermaid.parseRegisteredMermaid(source)
      if (!parsed.ok) return { error: parsed.error }
      const verify = mermaid.verifyMermaid(parsed.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source }
    `,
  },
  {
    id: 'author_api_sequence_source',
    family: 'sequence',
    prompt: promptTask('Create a new sequence diagram from the context, parse it, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.', 'Diagram this flow: User asks App to export; App asks API to render SVG; API returns SVG string; App gives User a download.'),
    script: `
      const source = 'sequenceDiagram\\n  participant User\\n  participant App\\n  participant API\\n  User->>App: Export diagram\\n  App->>API: Render SVG\\n  API-->>App: SVG string\\n  App-->>User: Download'
      const parsed = mermaid.parseRegisteredMermaid(source)
      if (!parsed.ok) return { error: parsed.error }
      const verify = mermaid.verifyMermaid(parsed.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source }
    `,
  },
]

// Knowledge-proof cases: the correct output depends on facts only the
// Agentic Mermaid docs/tooling carry (canonical serialization rules, the
// opaque-fallback contract), so a no-docs agent fails on taskOk. The stored
// DEFAULT_CASES saturate — every arm including the isolated no-docs baseline
// passes them on model knowledge (claude-subagent-2026-07-04-none-iso-*) —
// so surface comparisons need these to rank surfaces by task outcome.
// Not part of DEFAULT_CASES: the render-quality and family-coverage suites
// iterate DEFAULT_CASES, and these two exist for surface comparison only.
const KNOWLEDGE_MESSY_FLOWCHART = 'flowchart TD\n    api["API"]   -->    db["DB"]\n    api --> logs["Log store\\nretention: 30 days"]'
const KNOWLEDGE_STRAY_END_SEQUENCE = 'sequenceDiagram\n  A->>B: hi\n  end\n  B-->>A: yo'

// New-diagram authoring, one per family: given only the prompt, author valid
// Mermaid source directly (no mutation ceremony), parse, verify, return it.
// Together with the structured mutate cases in DEFAULT_CASES (plus the two
// author_* cases there for flowchart/sequence), these cover every registered
// family. Kept OUT of DEFAULT_CASES so the deterministic baseline and the
// committed all-family transcript still pin DEFAULT_CASES exactly; the subagent
// eval pool includes them so live models can be graded on authoring.
function authorCase(id: string, family: DiagramKind, task: string, context: string, source: string): AgentUsageEvalCase {
  return {
    id,
    family,
    prompt: promptTask(task, context),
    script: `
      const source = ${JSON.stringify(source)}
      const parsed = mermaid.parseRegisteredMermaid(source)
      if (!parsed.ok) return { error: parsed.error }
      const verify = mermaid.verifyMermaid(parsed.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source }
    `,
  }
}

export const CREATE_CASES: AgentUsageEvalCase[] = [
  authorCase(
    'author_state_source',
    'state',
    'Create a new state diagram from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'Diagram a traffic light: start in Red; Red goes to Green; Green goes to Yellow; Yellow goes back to Red.',
    'stateDiagram-v2\n  [*] --> Red\n  Red --> Green\n  Green --> Yellow\n  Yellow --> Red',
  ),
  authorCase(
    'author_class_source',
    'class',
    'Create a new class diagram from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'Model an Animal class with a name field and a speak() method, and a Dog class that inherits from Animal.',
    'classDiagram\n  class Animal {\n    +String name\n    +speak()\n  }\n  class Dog\n  Animal <|-- Dog',
  ),
  authorCase(
    'author_er_source',
    'er',
    'Create a new entity-relationship diagram from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'Model these entities: a CUSTOMER places many ORDERs; each ORDER contains one PRODUCT.',
    'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|| PRODUCT : contains',
  ),
  authorCase(
    'author_journey_source',
    'journey',
    'Create a new user-journey diagram from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'A Checkout journey with a Shopping section containing two tasks by actor Me: Browse (score 5) and Pay (score 3).',
    'journey\n  title Checkout\n  section Shopping\n    Browse: 5: Me\n    Pay: 3: Me',
  ),
  authorCase(
    'author_timeline_source',
    'timeline',
    'Create a new timeline diagram from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'A product timeline: in 2023, Launch; in 2024, Growth.',
    'timeline\n  title Product\n  2023 : Launch\n  2024 : Growth',
  ),
  authorCase(
    'author_gantt_source',
    'gantt',
    'Create a new gantt chart from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'A project with a Build section: Design takes 2 days starting 2024-01-01, then Code takes 3 days after Design.',
    'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  Design :d1, 2024-01-01, 2d\n  Code :after d1, 3d',
  ),
  authorCase(
    'author_pie_source',
    'pie',
    'Create a new pie chart from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'A pie chart titled Traffic with three slices: Direct 40, Search 35, Social 25.',
    'pie title Traffic\n  "Direct" : 40\n  "Search" : 35\n  "Social" : 25',
  ),
  authorCase(
    'author_quadrant_source',
    'quadrant',
    'Create a new quadrant chart from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'A Priorities quadrant chart: x-axis Low Effort to High Effort, y-axis Low Value to High Value; place Feature A at (0.3, 0.8) and Feature B at (0.7, 0.2).',
    'quadrantChart\n  title Priorities\n  x-axis Low Effort --> High Effort\n  y-axis Low Value --> High Value\n  "Feature A": [0.3, 0.8]\n  "Feature B": [0.7, 0.2]',
  ),
  authorCase(
    'author_xychart_source',
    'xychart',
    'Create a new xy chart from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'A monthly revenue bar chart across Jan, Feb, Mar with a Revenue bar series of 100, 150, 200.',
    'xychart-beta\n  x-axis [Jan, Feb, Mar]\n  bar Revenue [100, 150, 200]',
  ),
  authorCase(
    'author_architecture_source',
    'architecture',
    'Create a new architecture diagram from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'An architecture with an API server and a database, with the API connected to the DB.',
    'architecture-beta\n  service api(server)[API]\n  service db(database)[DB]\n  api:R --> L:db',
  ),
  authorCase(
    'author_mindmap_source',
    'mindmap',
    'Create a new mindmap from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'A Product root with Research and Delivery children; Research has an Evidence child.',
    'mindmap\n  Product\n    Research\n      Evidence\n    Delivery',
  ),
  authorCase(
    'author_gitgraph_source',
    'gitgraph',
    'Create a new GitGraph from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'A ROOT commit on main, then a release branch with an RC commit tagged rc.1.',
    'gitGraph\n  commit id:"ROOT" msg:"Foundation"\n  branch release order:2\n  commit id:"RC" tag:"rc.1" msg:"Release candidate"',
  ),
  authorCase(
    'author_radar_source',
    'radar',
    'Create a new radar chart from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'A team-skills radar with axes Design, Code, Comms; one curve Alice with values 4, 5, 3 (one per axis).',
    'radar-beta\n  axis Design, Code, Comms\n  curve alice["Alice"]{4, 5, 3}\n  max 5',
  ),
  authorCase(
    'author_sankey_source',
    'sankey',
    'Create a new sankey diagram from the context as Mermaid source, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.',
    'An energy sankey: Coal flows 127.93 into Electricity; Gas flows 151.89 into Electricity; Electricity flows 223.13 into Homes and 56.69 into Losses.',
    'sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,151.89\n  Electricity,Homes,223.13\n  Electricity,Losses,56.69',
  ),
]

export const KNOWLEDGE_CASES: AgentUsageEvalCase[] = [
  {
    id: 'canonical_add_cache_messy',
    family: 'flowchart',
    prompt: promptTask(
      'Insert Cache between api and db (api → Cache → db, removing the direct api → db edge) and return the CANONICAL Agentic Mermaid serialization of the result — the exact bytes serializeMermaid emits.',
      'The existing flowchart uses irregular spacing, quoted labels, and a \\n line break inside the logs label. Keep the logs node and its full label text. The returned source must be byte-identical to the canonical Agentic Mermaid serialization of the edited diagram.',
      KNOWLEDGE_MESSY_FLOWCHART,
    ),
    input: KNOWLEDGE_MESSY_FLOWCHART,
    script: `
      const r0 = mermaid.parseRegisteredMermaid(${JSON.stringify(KNOWLEDGE_MESSY_FLOWCHART)})
      if (!r0.ok) return { error: 'parse' }
      const flow = mermaid.asFlowchart(r0.value)
      if (!flow) return { error: 'not-flowchart' }
      const r1 = mermaid.mutate(flow, { kind: 'remove_edge', id: 'api->db' })
      if (!r1.ok) return { error: r1.error }
      const r2 = mermaid.mutate(r1.value, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      if (!r2.ok) return { error: r2.error }
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'api', to: 'Cache' })
      if (!r3.ok) return { error: r3.error }
      const r4 = mermaid.mutate(r3.value, { kind: 'add_edge', from: 'Cache', to: 'db' })
      if (!r4.ok) return { error: r4.error }
      const verify = mermaid.verifyMermaid(r4.value)
      if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r4.value) }
    `,
  },
  {
    id: 'stray_end_source_fallback',
    family: 'sequence',
    prompt: promptTask(
      'Append the message B-->>A: ok as the final top-level message, preserving every existing line exactly as written.',
      'This sequence diagram contains a stray end line with no opening block — keep it: it is part of the diagram as the user maintains it. Use structured mutation if the tooling supports it on this input; otherwise make the smallest source-level edit and say so.',
      KNOWLEDGE_STRAY_END_SEQUENCE,
    ),
    input: KNOWLEDGE_STRAY_END_SEQUENCE,
    script: `
      const src = ${JSON.stringify(KNOWLEDGE_STRAY_END_SEQUENCE)}
      const r0 = mermaid.parseRegisteredMermaid(src)
      if (!r0.ok) return { error: 'parse' }
      if (mermaid.asSequence(r0.value)) return { error: 'expected opaque fallback for the stray end' }
      const edited = src + '\\n  B-->>A: ok'
      const r1 = mermaid.parseRegisteredMermaid(edited)
      if (!r1.ok) return { error: 'reparse' }
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
    const taskOk = exec.ok ? checkTask(c.id, input, exec.value, trace) : false
    const traceOk = findings.length === 0 && checkTrace(c.id, input, trace)
    results.push({ id: c.id, ok: Boolean(exec.ok && taskOk && traceOk), taskOk, traceOk, findings, error: exec.ok ? undefined : exec.error })
  }
  const passed = results.filter(r => r.ok).length
  const taskPassed = results.filter(r => r.taskOk).length
  const safePathRate = results.filter(r => r.traceOk).length / Math.max(1, results.length)
  const structuredCases = results.filter(r => requiresStructuredMutation(r.id))
  const structuredPathRate = structuredCases.filter(r => r.traceOk).length / Math.max(1, structuredCases.length)
  return { ok: passed === results.length, total: results.length, taskPassed, taskOkRate: taskPassed / Math.max(1, results.length), passed, safePathRate, structuredPathRate, results }
}

export function requiresStructuredMutation(id: string): boolean {
  return STRUCTURED_CASES.has(id)
}

const STRUCTURED_CASES = new Set([
  'cache_between_api_and_db',
  'canonical_add_cache_messy',
  'stray_end_source_fallback',
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
  'mindmap_add_evidence_node',
  'gitgraph_add_release_commit',
  'radar_add_beta_curve',
  'sankey_add_losses_flow',
])

type MutableFamily = Extract<SdkCall, { verb: 'narrow' }>['family']

function defaultInput(id: string): string | undefined {
  return [...DEFAULT_CASES, ...KNOWLEDGE_CASES].find(c => c.id === id)?.input
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
  return trace.some(c => c.verb === 'narrow' && c.family === family && c.ok === true && reachesDiagram(trace, inputDiagram, c.input)) && trace.some(c => c.verb === 'verify' && c.diagram === finalDiagram && c.ok === true) && trace.some(c => c.verb === 'verify_inspect' && c.diagram === finalDiagram)
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
  const actual = trace
    .filter((c): c is Extract<SdkCall, { verb: 'mutate' }> => c.verb === 'mutate')
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
  return !trace.some(c => c.verb === 'mutate' || c.verb === 'serialize') && trace.some(c => c.verb === 'verify' && c.diagram === diagram && c.ok === true) && trace.some(c => c.verb === 'verify_inspect' && c.diagram === diagram)
}

function checkOpaqueFallbackTrace(trace: SdkCall[]): boolean {
  // Source-level fallback on an opaque body: no structured mutation may run;
  // the edited source must be re-parsed and that diagram's verify result
  // inspected before returning. Serialize is allowed — opaque serialization
  // is the preserved source.
  if (trace.some(c => c.verb === 'mutate')) return false
  const parses = trace.filter((c): c is Extract<SdkCall, { verb: 'parse' }> => c.verb === 'parse')
  const last = parses[parses.length - 1]
  if (!last || last.diagram === undefined) return false
  return trace.some(c => c.verb === 'verify' && c.diagram === last.diagram && c.ok === true) && trace.some(c => c.verb === 'verify_inspect' && c.diagram === last.diagram)
}

function checkTrace(id: string, input: string | undefined, trace: SdkCall[]): boolean {
  if (id.startsWith('author_')) return checkSourceAuthoringTrace(trace)
  if (!input) return false
  if (id === 'cache_between_api_and_db') return checkMutationTrace(id, input, 'flowchart', trace) && hasMutationOps(trace, input, ['add_node', 'remove_edge', 'add_edge', 'add_edge'])
  if (id === 'canonical_add_cache_messy') return checkMutationTrace(id, input, 'flowchart', trace) && hasMutationOps(trace, input, ['remove_edge', 'add_node', 'add_edge', 'add_edge'])
  if (id === 'stray_end_source_fallback') return checkOpaqueFallbackTrace(trace)
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
  if (id === 'mindmap_add_evidence_node') return checkMutationTrace(id, input, 'mindmap', trace) && hasMutationOps(trace, input, ['add_node'])
  if (id === 'gitgraph_add_release_commit') return checkMutationTrace(id, input, 'gitgraph', trace) && hasMutationOps(trace, input, ['create_branch', 'append_commit'])
  if (id === 'sequence_alt_add_message') return checkMutationTrace(id, input, 'sequence', trace) && hasMutationOps(trace, input, ['add_message'])
  if (id === 'radar_add_beta_curve') return checkMutationTrace(id, input, 'radar', trace) && hasMutationOps(trace, input, ['add_curve'])
  if (id === 'sankey_add_losses_flow') return checkMutationTrace(id, input, 'sankey', trace) && hasMutationOps(trace, input, ['add_link'])
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
  const credentials = idMatching(/Valid Credentials\?|Credentials Valid\?/i)
  const mfa = idMatching(/MFA Enabled\?/i)
  const enterMfa = idMatching(/^Enter MFA Code$/i)
  const code = idMatching(/Code Valid\?|Valid Code\?/i)
  const session = idMatching(/^Create Session$/i)
  const dashboard = idMatching(/^Dashboard$/i)
  if (!user || !login || !credentials || !mfa || !enterMfa || !code || !session || !dashboard) return false
  const edges = new Set(graph.edges.map(e => `${e.source}->${e.target}`))
  return (
    edges.has(`${user}->${login}`) &&
    edges.has(`${login}->${credentials}`) &&
    edges.has(`${credentials}->${login}`) &&
    edges.has(`${credentials}->${mfa}`) &&
    edges.has(`${mfa}->${enterMfa}`) &&
    edges.has(`${enterMfa}->${code}`) &&
    edges.has(`${code}->${enterMfa}`) &&
    edges.has(`${mfa}->${session}`) &&
    edges.has(`${code}->${session}`) &&
    edges.has(`${session}->${dashboard}`)
  )
}

function checkApiSequenceSourceTask(value: unknown): boolean {
  const source = (value as { source?: unknown } | undefined)?.source
  if (typeof source !== 'string') return false
  const parsed = parseMermaid(source)
  const body = parsed.ok ? asSequence(parsed.value)?.body : undefined
  if (!body) return false
  const participants = new Set(body.participants.map(p => p.id))
  return (
    participants.has('User') &&
    participants.has('App') &&
    participants.has('API') &&
    // Context describes the flow in lowercase prose ("render SVG … a download").
    // Match each message by its key phrase on the correctly-directed edge, case-
    // insensitively and by containment — as the User->App `export` check already
    // does. Requiring an exact Title-case label rejected diagrams faithful to the
    // Context whose agents kept the prose casing ("render SVG") or phrasing
    // ("returns SVG string"); the from/to direction plus the phrase is the signal.
    body.messages.some(m => m.from === 'User' && m.to === 'App' && /\bexport\b/i.test(m.text)) &&
    body.messages.some(m => m.from === 'App' && m.to === 'API' && /render\s+svg/i.test(m.text)) &&
    body.messages.some(m => m.from === 'API' && m.to === 'App' && /svg\s+string/i.test(m.text)) &&
    body.messages.some(m => m.from === 'App' && m.to === 'User' && /\bdownload\b/i.test(m.text))
  )
}

function serializedSource(value: unknown, trace: SdkCall[]): string | undefined {
  return returnedSerializedSource(value, trace)
}

function sourceSatisfiesFacts(source: string, spec: CheckMermaidSpec): boolean {
  const checked = checkMermaidSource(source, spec)
  return checked.ok && checked.value.ok
}

export function checkAgentUsageTaskSource(id: string, source: string): boolean {
  const fakeSerializeTrace = [{ verb: 'serialize', diagram: 'final', source }] as SdkCall[]
  return checkTask(id, defaultInput(id), { source }, fakeSerializeTrace)
}

// Per-family authoring oracles: the returned source must model the described
// entities/relationships. Structural (not byte-exact), matching the spirit of
// the two flowchart/sequence author oracles.
function narrow<T>(source: string, as: (d: ParsedDiagram) => T | null): T | null {
  const parsed = parseMermaid(source)
  return parsed.ok ? as(parsed.value) : null
}
const dequote = (s: string) => s.replace(/^"|"$/g, '')
const CREATE_ORACLES: Record<string, (source: string) => boolean> = {
  author_state_source: s => {
    const t = new Set(narrow(s, asState)?.body.transitions.map(x => `${x.from}->${x.to}`))
    return ['Red->Green', 'Green->Yellow', 'Yellow->Red'].every(e => t.has(e))
  },
  author_class_source: s => {
    const b = narrow(s, asClass)?.body
    const animal = b?.classes.find(c => c.id === 'Animal')
    // A `speak()` method, however the model formatted it — `+speak()`,
    // `+speak() void`, `+speak(): void`. An exact `+speak()` match false-rejects
    // a correct diagram that annotated a return type.
    return Boolean(animal?.members.some(m => /\bspeak\s*\(/i.test(m)) && b!.classes.some(c => c.id === 'Dog'))
  },
  author_er_source: s => {
    const ids = new Set(narrow(s, asEr)?.body.entities.map(e => e.id))
    return ['CUSTOMER', 'ORDER', 'PRODUCT'].every(x => ids.has(x))
  },
  author_journey_source: s => {
    const section = narrow(s, asJourney)?.body.sections.find(x => x.label === 'Shopping')
    const tasks = new Set(section?.tasks.map(t => t.text))
    return Boolean(section && ['Browse', 'Pay'].every(x => tasks.has(x)))
  },
  author_timeline_source: s => {
    const events = new Set(narrow(s, asTimeline)?.body.sections.flatMap(x => x.periods.flatMap(p => p.events.map(e => e.text))))
    return ['Launch', 'Growth'].every(x => events.has(x))
  },
  author_gantt_source: s => {
    const tasks = new Set(narrow(s, asGantt)?.body.sections.flatMap(x => x.tasks.map(t => t.label)))
    return ['Design', 'Code'].every(x => tasks.has(x))
  },
  author_pie_source: s => {
    const slices = new Map(narrow(s, asPie)?.body.slices.map(x => [x.label, x.value]))
    return slices.get('Direct') === 40 && slices.get('Search') === 35 && slices.get('Social') === 25
  },
  author_quadrant_source: s => {
    const labels = new Set(narrow(s, asQuadrant)?.body.points.map(p => dequote(p.label)))
    return ['Feature A', 'Feature B'].every(x => labels.has(x))
  },
  author_xychart_source: s => {
    const series = narrow(s, asXyChart)?.body.series
    return Boolean(series?.some(x => x.values.length === 3 && x.values[0] === 100 && x.values[2] === 200))
  },
  author_architecture_source: s => {
    const b = narrow(s, asArchitecture)?.body
    const ids = new Set(b?.services.map(x => x.id))
    return ids.has('api') && ids.has('db') && Boolean(b?.edges.some(e => e.source.id === 'api' && e.target.id === 'db'))
  },
  author_mindmap_source: s => sourceSatisfiesFacts(s, ['edge Product -> Research', 'edge Research -> Evidence', 'edge Product -> Delivery']),
  author_gitgraph_source: s => sourceSatisfiesFacts(s, ['commit ROOT branch main', 'commit RC branch release', 'commit RC tag rc.1']),
  author_radar_source: s => {
    const b = narrow(s, asRadar)?.body
    const axes = new Set(b?.axes.map(a => a.id))
    const alice = b?.curves.find(c => c.id === 'alice')
    return Boolean(['Design', 'Code', 'Comms'].every(x => axes.has(x)) && alice && alice.values.join(',') === '4,5,3')
  },
  author_sankey_source: s => {
    const b = narrow(s, asSankey)?.body
    const rows = new Set(b?.links.map(l => `${l.source}->${l.target}:${l.value}`))
    return Boolean(['Coal->Electricity:127.93', 'Gas->Electricity:151.89', 'Electricity->Homes:223.13', 'Electricity->Losses:56.69'].every(row => rows.has(row)))
  },
}

function checkTask(id: string, input: string | undefined, value: unknown, trace: SdkCall[]): boolean {
  const createOracle = CREATE_ORACLES[id]
  if (createOracle) {
    const source = (value as { source?: unknown } | undefined)?.source
    return typeof source === 'string' && parseMermaid(source).ok && createOracle(source)
  }
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
    return Boolean(source && sourceSatisfiesFacts(source, ['edge Processing -> [*] : done']))
  }
  if (id === 'canonical_add_cache_messy') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    if (!parsed.ok) return false
    const graph = asFlowchart(parsed.value)?.body.graph
    if (!graph?.nodes.has('Cache')) return false
    const edges = new Set(graph.edges.map(e => `${e.source}->${e.target}`))
    if (!edges.has('api->Cache') || !edges.has('Cache->db') || edges.has('api->db')) return false
    if (graph.nodes.get('logs')?.label !== 'Log store\nretention: 30 days') return false
    // Canonical fixed point: the returned bytes are exactly what
    // serializeMermaid emits for this diagram (unquoted-where-possible
    // labels, <br> line breaks, two-space indent). This is the knowledge
    // component — the structural checks above pass on model knowledge alone.
    return serializeMermaid(parsed.value).trim() === source.trim()
  }
  if (id === 'stray_end_source_fallback') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const lines = source
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
    const expected = ['sequenceDiagram', 'A->>B: hi', 'end', 'B-->>A: yo', 'B-->>A: ok']
    // Every original line preserved verbatim and in order — including the
    // stray `end` a regenerating agent would "fix" — plus the appended
    // message, and nothing else.
    if (lines.length !== expected.length || !expected.every((l, i) => lines[i] === l)) return false
    return parseMermaid(source).ok
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
    return Boolean(source && sourceSatisfiesFacts(source, ['class Duck', 'member Duck +quack()']))
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
    return Boolean(body?.services.some(s => s.id === 'cache' && s.label === 'Cache' && s.icon === 'disk') && body.edges.some(e => e.source.id === 'api' && e.target.id === 'cache' && e.label === 'cache'))
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
    return Boolean(source && sourceSatisfiesFacts(source, ['task Docs id docs', 'task Docs start after core', 'task Docs end 2d']))
  }
  if (id === 'mindmap_add_evidence_node') {
    const source = serializedSource(value, trace)
    return Boolean(source && sourceSatisfiesFacts(source, ['edge Research -> Evidence']))
  }
  if (id === 'gitgraph_add_release_commit') {
    const source = serializedSource(value, trace)
    return Boolean(source && sourceSatisfiesFacts(source, ['commit RC branch release', 'commit RC tag rc.1']))
  }
  if (id === 'radar_add_beta_curve') {
    const source = serializedSource(value, trace)
    const body = source ? narrow(source, asRadar)?.body : undefined
    const beta = body?.curves.find(c => c.id === 'beta')
    // The Beta curve landed with one value per axis and Alpha survives.
    return Boolean(beta && beta.values.join(',') === '3,5,4' && body!.curves.some(c => c.id === 'alpha'))
  }
  if (id === 'sankey_add_losses_flow') {
    const source = serializedSource(value, trace)
    const body = source ? narrow(source, asSankey)?.body : undefined
    const rows = new Set(body?.links.map(l => `${l.source}->${l.target}:${l.value}`))
    // The Losses flow landed and every existing row survives.
    return Boolean(body && rows.has('Electricity->Losses:56.69') && rows.has('Coal->Electricity:127.93') && rows.has('Gas->Electricity:151.89') && rows.has('Electricity->Homes:223.13'))
  }
  if (id === 'sequence_alt_add_message') {
    const source = serializedSource(value, trace)
    if (!source) return false
    const parsed = parseMermaid(source)
    if (!parsed.ok) return false
    const body = asSequence(parsed.value)?.body
    if (!body) return false
    // The new top-level message landed, and the alt block survives verbatim.
    return body.messages.some(m => m.from === 'A' && m.to === 'B' && m.text === 'bye') && source.includes('alt ok') && source.includes('B-->>A: yes') && source.includes('  end')
  }
  return false
}

if (import.meta.main) {
  const summary = await runAgentUsageEval()
  console.log(JSON.stringify(summary, null, 2))
  process.exit(summary.ok ? 0 : 1)
}
