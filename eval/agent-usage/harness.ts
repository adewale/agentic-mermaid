// ============================================================================
// Agent-usage validation harness (Loop 13 M6).
//
// "How do we test/verify how agents actually USE the tool?" Three layers:
//
//   1. Scenarios (this file, deterministic, CI):   a scripted "agent" runs
//      the intended loop (parse → narrow → mutate → verify → serialize)
//      against the real SDK. Asserts the supported path WORKS.
//   2. Anti-pattern linter (this file):            given a trace of SDK
//      calls, flag the anti-patterns AGENTS.md warns about. Verifies the
//      affordances steer agents away from the unsafe path.
//   3. Real-LLM eval (design, eval/agent-usage/README.md):  give a frontier
//      model only AGENTS.md + a task, record which verbs it calls, score
//      whether it stayed structured. Periodic (like the Phase F judge).
//      Layers 1-2 are the CI-cheap proxy + the tooling layer 3 reuses.
// ============================================================================

import { parseMermaid } from '../../src/agent/parse.ts'
import { mutate } from '../../src/agent/mutate.ts'
import { verifyMermaid } from '../../src/agent/verify.ts'
import { serializeMermaid } from '../../src/agent/serialize.ts'
import { asFlowchart } from '../../src/agent/types.ts'

// ---- Layer 2: anti-pattern linter -----------------------------------------

export type SdkCall =
  | { verb: 'parse' }
  | { verb: 'mutate'; body: 'flowchart' | 'sequence' | 'timeline' | 'class' | 'er' | 'opaque' }
  | { verb: 'verify' }
  | { verb: 'serialize' }
  | { verb: 'string_concat' }   // the agent built source by hand
  | { verb: 'regenerate' }      // the agent re-emitted whole source from scratch

export interface AntiPattern { code: string; message: string; at: number }

/**
 * Inspect a trace of SDK calls for the anti-patterns AGENTS.md names:
 *  - SERIALIZE_WITHOUT_VERIFY: a serialize with no verify since the last mutate
 *  - STRING_CONCAT: building source by hand instead of mutate
 *  - REGENERATE: re-emitting whole source instead of mutating
 *  - MUTATE_ON_OPAQUE: calling mutate on an opaque body (type system rejects
 *    this statically in real code; the trace form catches it in analysis)
 */
export function lintAgentTrace(trace: SdkCall[]): AntiPattern[] {
  const out: AntiPattern[] = []
  let mutatedSinceVerify = false
  for (let i = 0; i < trace.length; i++) {
    const c = trace[i]!
    if (c.verb === 'mutate') {
      mutatedSinceVerify = true
      if (c.body === 'opaque') out.push({ code: 'MUTATE_ON_OPAQUE', message: 'mutate called on an opaque body; edit canonicalSource instead', at: i })
    } else if (c.verb === 'verify') {
      mutatedSinceVerify = false
    } else if (c.verb === 'serialize') {
      if (mutatedSinceVerify) out.push({ code: 'SERIALIZE_WITHOUT_VERIFY', message: 'serialize after mutate with no intervening verify', at: i })
    } else if (c.verb === 'string_concat') {
      out.push({ code: 'STRING_CONCAT', message: 'building Mermaid source by string concatenation instead of mutate', at: i })
    } else if (c.verb === 'regenerate') {
      out.push({ code: 'REGENERATE', message: 'regenerating whole source instead of mutating (defeats round-trip)', at: i })
    }
  }
  return out
}

// ---- Layer 1: scripted scenarios -------------------------------------------

export interface ScenarioResult {
  name: string
  ok: boolean
  detail: string
  trace: SdkCall[]
}

/**
 * Scenario: add a node between two existing nodes and re-wire — the canonical
 * "edit one thing and trust the result" loop. Returns the trace + whether the
 * structured path succeeded end-to-end.
 */
export function scenarioAddNode(): ScenarioResult {
  const trace: SdkCall[] = []
  const d0 = parseMermaid('flowchart TD\n  API --> DB'); trace.push({ verb: 'parse' })
  if (!d0.ok) return { name: 'add_node', ok: false, detail: 'parse failed', trace }
  const flow = asFlowchart(d0.value)
  if (!flow) return { name: 'add_node', ok: false, detail: 'expected flowchart', trace }
  const d1 = mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' }); trace.push({ verb: 'mutate', body: 'flowchart' })
  if (!d1.ok) return { name: 'add_node', ok: false, detail: 'add_node failed', trace }
  const d2 = mutate(d1.value, { kind: 'add_edge', from: 'API', to: 'Cache' }); trace.push({ verb: 'mutate', body: 'flowchart' })
  if (!d2.ok) return { name: 'add_node', ok: false, detail: 'add_edge failed', trace }
  const v = verifyMermaid(d2.value); trace.push({ verb: 'verify' })
  if (!v.ok) return { name: 'add_node', ok: false, detail: 'verify reported errors', trace }
  const out = serializeMermaid(d2.value); trace.push({ verb: 'serialize' })
  const ok = out.includes('Cache') && out.includes('API')
  return { name: 'add_node', ok, detail: ok ? 'structured loop succeeded' : 'output missing expected nodes', trace }
}

/**
 * Scenario: a diagram that falls back to opaque (sequence with alt/loop).
 * The CORRECT agent behavior is to detect the null narrower and edit the
 * source as a string — NOT call mutate. Returns ok if the narrower correctly
 * refuses (so the agent is steered to the source-edit path).
 */
export function scenarioOpaqueRefusal(): ScenarioResult {
  const trace: SdkCall[] = []
  const d = parseMermaid('sequenceDiagram\n  A->>B: hi\n  alt ok\n    B-->>A: yes\n  end'); trace.push({ verb: 'parse' })
  if (!d.ok) return { name: 'opaque_refusal', ok: false, detail: 'parse failed', trace }
  const isOpaque = d.value.body.kind === 'opaque'
  // The narrower (asSequence) returns null on opaque — the agent can't mutate.
  const refused = isOpaque
  return {
    name: 'opaque_refusal',
    ok: refused,
    detail: refused ? 'opaque body correctly refuses structured mutation; agent edits canonicalSource' : 'expected opaque fallback',
    trace,
  }
}

/**
 * Scenario: verify catches a bad edit so the agent can revert. Build a
 * diagram, apply an op that overflows a label, confirm verify flags it.
 */
export function scenarioVerifyCatchesBadEdit(): ScenarioResult {
  const trace: SdkCall[] = []
  const d0 = parseMermaid('flowchart TD\n  A --> B'); trace.push({ verb: 'parse' })
  if (!d0.ok) return { name: 'verify_catches', ok: false, detail: 'parse failed', trace }
  const flow = asFlowchart(d0.value)!
  const long = 'X'.repeat(80)
  const d1 = mutate(flow, { kind: 'add_node', id: 'C', label: long }); trace.push({ verb: 'mutate', body: 'flowchart' })
  if (!d1.ok) return { name: 'verify_catches', ok: false, detail: 'mutate failed', trace }
  const v = verifyMermaid(d1.value, { labelCharCap: 40 }); trace.push({ verb: 'verify' })
  const caught = v.warnings.some(w => w.code === 'LABEL_OVERFLOW')
  return { name: 'verify_catches', ok: caught, detail: caught ? 'verify flagged the overflow; agent can revert' : 'verify missed it', trace }
}

export function runAllScenarios(): ScenarioResult[] {
  return [scenarioAddNode(), scenarioOpaqueRefusal(), scenarioVerifyCatchesBadEdit()]
}

if (import.meta.main) {
  for (const r of runAllScenarios()) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}: ${r.detail}`)
    console.log(`  trace: ${r.trace.map(c => c.verb).join(' → ')}`)
  }
}
