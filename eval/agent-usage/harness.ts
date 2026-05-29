// ============================================================================
// Agent-usage validation harness.
//
// "How do we test/verify how agents actually USE the tool?" Three layers:
//
//   1. Scenarios (deterministic, CI): a scripted "agent" runs the intended
//      loop (parse → narrow → mutate → verify → serialize) against the real
//      SDK. Asserts the supported path WORKS and checks task-specific success.
//   2. Anti-pattern linter: given a trace of SDK calls, flag the anti-patterns
//      Instructions_for_agents.md warns about. The MCP sandbox can now emit
//      real traces via executeInSandbox({ trace: true }).
//   3. Real-LLM eval (eval/agent-usage/run.ts): run stored model scripts or
//      captured Code Mode output through the same trace linter and task oracles.
// ============================================================================

import { parseMermaid } from '../../src/agent/parse.ts'
import { mutate, edgeIdOf } from '../../src/agent/mutate.ts'
import { verifyMermaid } from '../../src/agent/verify.ts'
import { serializeMermaid } from '../../src/agent/serialize.ts'
import { asFlowchart, asSequence, asTimeline, asClass, asEr } from '../../src/agent/types.ts'

// ---- Layer 2: anti-pattern linter -----------------------------------------

export type DiagramRef = number | string

export type SdkCall =
  | { verb: 'parse'; diagram?: DiagramRef; source?: string }
  | { verb: 'narrow'; family: 'flowchart' | 'sequence' | 'timeline' | 'class' | 'er'; input?: DiagramRef; ok: boolean }
  | { verb: 'mutate'; body: 'flowchart' | 'sequence' | 'timeline' | 'class' | 'er' | 'opaque'; input?: DiagramRef; output?: DiagramRef; opKind?: string }
  | { verb: 'verify'; diagram?: DiagramRef; ok?: boolean; inspected?: boolean }
  | { verb: 'serialize'; diagram?: DiagramRef; source?: string }
  | { verb: 'string_concat' }   // the agent built source by hand
  | { verb: 'regenerate' }      // the agent re-emitted whole source from scratch

export interface AntiPattern { code: string; message: string; at: number }

/**
 * Inspect a trace of SDK calls for the anti-patterns Instructions_for_agents.md
 * names. Diagram ids are optional for hand-authored traces, but real sandbox
 * traces include them so we can catch verify(d0) → serialize(d1) drift.
 */
export function lintAgentTrace(trace: SdkCall[]): AntiPattern[] {
  const out: AntiPattern[] = []
  let genericMutatedSinceVerify = false
  const dirty = new Set<DiagramRef>()
  const failedVerify = new Set<DiagramRef>()

  const markDirty = (id: DiagramRef | undefined) => {
    genericMutatedSinceVerify = true
    if (id !== undefined) dirty.add(id)
  }
  const markVerified = (id: DiagramRef | undefined) => {
    genericMutatedSinceVerify = false
    if (id !== undefined) dirty.delete(id)
  }

  for (let i = 0; i < trace.length; i++) {
    const c = trace[i]!
    if (c.verb === 'mutate') {
      markDirty(c.output)
      if (c.body === 'opaque') out.push({ code: 'MUTATE_ON_OPAQUE', message: 'mutate called on an opaque body; edit canonicalSource instead', at: i })
    } else if (c.verb === 'verify') {
      if (c.inspected === false) {
        out.push({ code: 'VERIFY_NOT_INSPECTED', message: 'verify result was produced but ok/warnings/layout were not inspected', at: i })
      }
      if (c.ok === false) {
        if (c.diagram !== undefined) failedVerify.add(c.diagram)
        // A failed verify is not a commit clearance.
      } else {
        markVerified(c.diagram)
      }
    } else if (c.verb === 'serialize') {
      if (c.diagram !== undefined && failedVerify.has(c.diagram)) {
        out.push({ code: 'SERIALIZE_AFTER_FAILED_VERIFY', message: 'serialize after verify(ok:false); revert or repair before emitting source', at: i })
      }
      if (genericMutatedSinceVerify || (c.diagram !== undefined && dirty.has(c.diagram))) {
        out.push({ code: 'SERIALIZE_WITHOUT_VERIFY', message: 'serialize after mutate with no inspected successful verify for the same diagram', at: i })
      }
    } else if (c.verb === 'string_concat') {
      out.push({ code: 'STRING_CONCAT', message: 'building Mermaid source by string concatenation instead of mutate', at: i })
    } else if (c.verb === 'regenerate') {
      out.push({ code: 'REGENERATE', message: 'regenerating whole source instead of mutating (defeats round-trip)', at: i })
    }
  }
  return out
}

// ---- Layer 1: scripted scenarios ------------------------------------------

export interface ScenarioResult {
  name: string
  ok: boolean
  detail: string
  trace: SdkCall[]
}

/**
 * Scenario: add Cache between API and DB and re-wire API->DB into
 * API->Cache->DB. The task oracle checks the resulting graph, not substrings.
 */
export function scenarioAddNode(): ScenarioResult {
  const trace: SdkCall[] = []
  const d0 = parseMermaid('flowchart TD\n  API --> DB'); trace.push({ verb: 'parse', diagram: 'd0' })
  if (!d0.ok) return { name: 'add_node', ok: false, detail: 'parse failed', trace }
  const flow = asFlowchart(d0.value)
  if (!flow) return { name: 'add_node', ok: false, detail: 'expected flowchart', trace }
  const d1 = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' }); trace.push({ verb: 'mutate', body: 'flowchart', input: 'd0', output: 'd1', opKind: 'add_node' })
  if (!d1.ok) return { name: 'add_node', ok: false, detail: 'add_node failed', trace }
  const edgeId = edgeIdOf(d1.value.body.graph.edges[0]!)
  const d2 = mutate(d1.value, { kind: 'remove_edge', id: edgeId }); trace.push({ verb: 'mutate', body: 'flowchart', input: 'd1', output: 'd2', opKind: 'remove_edge' })
  if (!d2.ok) return { name: 'add_node', ok: false, detail: 'remove_edge failed', trace }
  const d3 = mutate(d2.value, { kind: 'add_edge', from: 'API', to: 'Cache' }); trace.push({ verb: 'mutate', body: 'flowchart', input: 'd2', output: 'd3', opKind: 'add_edge' })
  if (!d3.ok) return { name: 'add_node', ok: false, detail: 'add_edge API->Cache failed', trace }
  const d4 = mutate(d3.value, { kind: 'add_edge', from: 'Cache', to: 'DB' }); trace.push({ verb: 'mutate', body: 'flowchart', input: 'd3', output: 'd4', opKind: 'add_edge' })
  if (!d4.ok) return { name: 'add_node', ok: false, detail: 'add_edge Cache->DB failed', trace }
  const v = verifyMermaid(d4.value); trace.push({ verb: 'verify', diagram: 'd4', ok: v.ok, inspected: true })
  if (!v.ok) return { name: 'add_node', ok: false, detail: 'verify reported errors', trace }
  const out = serializeMermaid(d4.value); trace.push({ verb: 'serialize', diagram: 'd4' })
  const round = parseMermaid(out)
  const g = round.ok ? asFlowchart(round.value)?.body.graph : undefined
  const edges = new Set((g?.edges ?? []).map(e => `${e.source}->${e.target}`))
  const ok = Boolean(g?.nodes.has('Cache') && edges.has('API->Cache') && edges.has('Cache->DB') && !edges.has('API->DB'))
  return { name: 'add_node', ok, detail: ok ? 'rewired API->Cache->DB with structured mutation' : 'graph diff did not match task', trace }
}

/**
 * Scenario: a sequence with alt/loop falls back to opaque. The CORRECT agent
 * behavior is to see asSequence() return null and edit source directly.
 */
export function scenarioOpaqueRefusal(): ScenarioResult {
  const trace: SdkCall[] = []
  const d = parseMermaid('sequenceDiagram\n  A->>B: hi\n  alt ok\n    B-->>A: yes\n  end'); trace.push({ verb: 'parse', diagram: 'd0' })
  if (!d.ok) return { name: 'opaque_refusal', ok: false, detail: 'parse failed', trace }
  const refused = d.value.body.kind === 'opaque' && asSequence(d.value) === null
  return {
    name: 'opaque_refusal',
    ok: refused,
    detail: refused ? 'opaque body correctly returns null from asSequence; agent edits canonicalSource' : 'expected opaque fallback + null narrower',
    trace,
  }
}

/**
 * Scenario: verify catches a bad edit so the agent can revert before commit.
 */
export function scenarioVerifyCatchesBadEdit(): ScenarioResult {
  const trace: SdkCall[] = []
  const d0 = parseMermaid('flowchart TD\n  A --> B'); trace.push({ verb: 'parse', diagram: 'd0' })
  if (!d0.ok) return { name: 'verify_catches', ok: false, detail: 'parse failed', trace }
  const flow = asFlowchart(d0.value)!
  const long = 'X'.repeat(80)
  const d1 = mutate(flow, { kind: 'add_node', id: 'C', label: long }); trace.push({ verb: 'mutate', body: 'flowchart', input: 'd0', output: 'd1', opKind: 'add_node' })
  if (!d1.ok) return { name: 'verify_catches', ok: false, detail: 'mutate failed', trace }
  const v = verifyMermaid(d1.value, { labelCharCap: 40 }); trace.push({ verb: 'verify', diagram: 'd1', ok: v.ok, inspected: true })
  const caught = v.warnings.some(w => w.code === 'LABEL_OVERFLOW')
  return { name: 'verify_catches', ok: caught, detail: caught ? 'verify flagged the overflow; agent can revert' : 'verify missed it', trace }
}

export function scenarioTimelineMutation(): ScenarioResult {
  const trace: SdkCall[] = []
  const d0 = parseMermaid('timeline\n  title Plan\n  2024 : Alpha'); trace.push({ verb: 'parse', diagram: 'd0' })
  if (!d0.ok) return { name: 'timeline_mutation', ok: false, detail: 'parse failed', trace }
  const timeline = asTimeline(d0.value)
  if (!timeline) return { name: 'timeline_mutation', ok: false, detail: 'expected mutable timeline', trace }
  const d1 = mutate(timeline, { kind: 'add_event', sectionIndex: 0, periodIndex: 0, text: 'Beta' }); trace.push({ verb: 'mutate', body: 'timeline', input: 'd0', output: 'd1', opKind: 'add_event' })
  if (!d1.ok) return { name: 'timeline_mutation', ok: false, detail: 'add_event failed', trace }
  const v = verifyMermaid(d1.value); trace.push({ verb: 'verify', diagram: 'd1', ok: v.ok, inspected: true })
  if (!v.ok) return { name: 'timeline_mutation', ok: false, detail: 'verify reported errors', trace }
  const out = serializeMermaid(d1.value); trace.push({ verb: 'serialize', diagram: 'd1' })
  const ok = out.includes('Beta')
  return { name: 'timeline_mutation', ok, detail: ok ? 'timeline mutation serialized' : 'serialized timeline missing event', trace }
}

export function scenarioClassMutation(): ScenarioResult {
  const trace: SdkCall[] = []
  const d0 = parseMermaid('classDiagram\n  class Animal'); trace.push({ verb: 'parse', diagram: 'd0' })
  if (!d0.ok) return { name: 'class_mutation', ok: false, detail: 'parse failed', trace }
  const klass = asClass(d0.value)
  if (!klass) return { name: 'class_mutation', ok: false, detail: 'expected mutable class diagram', trace }
  const d1 = mutate(klass, { kind: 'add_class', id: 'Duck', members: ['+quack()'] }); trace.push({ verb: 'mutate', body: 'class', input: 'd0', output: 'd1', opKind: 'add_class' })
  if (!d1.ok) return { name: 'class_mutation', ok: false, detail: 'add_class failed', trace }
  const v = verifyMermaid(d1.value); trace.push({ verb: 'verify', diagram: 'd1', ok: v.ok, inspected: true })
  if (!v.ok) return { name: 'class_mutation', ok: false, detail: 'verify reported errors', trace }
  const out = serializeMermaid(d1.value); trace.push({ verb: 'serialize', diagram: 'd1' })
  const ok = out.includes('Duck') && out.includes('+quack()')
  return { name: 'class_mutation', ok, detail: ok ? 'class mutation serialized' : 'serialized class diagram missing class/member', trace }
}

export function scenarioErMutation(): ScenarioResult {
  const trace: SdkCall[] = []
  const d0 = parseMermaid('erDiagram\n  CUSTOMER {\n    string id\n  }'); trace.push({ verb: 'parse', diagram: 'd0' })
  if (!d0.ok) return { name: 'er_mutation', ok: false, detail: 'parse failed', trace }
  const er = asEr(d0.value)
  if (!er) return { name: 'er_mutation', ok: false, detail: 'expected mutable ER diagram', trace }
  const d1 = mutate(er, { kind: 'add_entity', id: 'ORDER', attributes: ['string id'] }); trace.push({ verb: 'mutate', body: 'er', input: 'd0', output: 'd1', opKind: 'add_entity' })
  if (!d1.ok) return { name: 'er_mutation', ok: false, detail: 'add_entity failed', trace }
  const v = verifyMermaid(d1.value); trace.push({ verb: 'verify', diagram: 'd1', ok: v.ok, inspected: true })
  if (!v.ok) return { name: 'er_mutation', ok: false, detail: 'verify reported errors', trace }
  const out = serializeMermaid(d1.value); trace.push({ verb: 'serialize', diagram: 'd1' })
  const ok = out.includes('ORDER') && out.includes('string id')
  return { name: 'er_mutation', ok, detail: ok ? 'ER mutation serialized' : 'serialized ER diagram missing entity/attribute', trace }
}

export function runAllScenarios(): ScenarioResult[] {
  return [
    scenarioAddNode(),
    scenarioOpaqueRefusal(),
    scenarioVerifyCatchesBadEdit(),
    scenarioTimelineMutation(),
    scenarioClassMutation(),
    scenarioErMutation(),
  ]
}

if (import.meta.main) {
  for (const r of runAllScenarios()) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}: ${r.detail}`)
    console.log(`  trace: ${r.trace.map(c => c.verb).join(' → ')}`)
    const findings = lintAgentTrace(r.trace)
    if (findings.length) console.log(`  findings: ${findings.map(f => f.code).join(', ')}`)
  }
}
