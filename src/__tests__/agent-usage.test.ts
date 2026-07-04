// Loop 13 M6: agent-usage validation harness — scenarios + anti-pattern linter.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runAllScenarios, lintAgentTrace, type SdkCall } from '../../eval/agent-usage/harness.ts'
import { DEFAULT_CASES, requiresStructuredMutation, runAgentUsageEval } from '../../eval/agent-usage/run.ts'
import { AGENT_USAGE_SUPPORTED_FAMILIES, scoreAgentUsageRenderedQuality } from '../../eval/agent-usage/render-quality.ts'
import { extractHomepageAgentPrompt, homepagePromptChecklist } from '../../eval/agent-usage/homepage-prompt.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest } from '../mcp/server.ts'
import { parseMermaid, verifyMermaid, serializeMermaid } from '../agent/index.ts'
import { asFlowchart } from '../agent/types.ts'

const REPO = join(import.meta.dir, '..', '..')

type FailureCorpus = {
  cases: FailureCase[]
}

type FailureCase = {
  id: string
  kind: 'raw-response' | 'code-mode'
  source: string
  caseId: string
  prompt: string
  rawResponse: string
  expectedRawFindings?: string[]
  expectedResult?: { ok: boolean; taskOk: boolean; traceOk: boolean; findings: string[] }
}

function loadFailureCorpus(): FailureCorpus {
  return JSON.parse(readFileSync(join(REPO, 'eval/agent-usage/failure-corpus/cases.json'), 'utf8')) as FailureCorpus
}

function classifyRawAgentFailure(text: string): string[] {
  const findings = new Set<string>()
  if (/```mermaid/i.test(text)) findings.add('MERMAID_FENCE_NOT_CODE_MODE')
  if (/`?am\s+(mutate|render|verify|batch|preview)\b/i.test(text)) findings.add('CLI_MISUSE')
  if (!/\bmermaid\.(parseMermaid|asFlowchart|asSequence|asTimeline|asClass|asEr|mutate|verifyMermaid|serializeMermaid)\b/.test(text)) findings.add('NO_SDK_CALLS')
  if (/^\s*```mermaid/i.test(text) && !/\bverifyMermaid\b/.test(text)) findings.add('REGENERATED_SOURCE')
  if (/\n\s*```mermaid/i.test(text) && /Used Agentic Mermaid|Verification result|source-level path/i.test(text)) findings.add('PROSE_NOT_CODE_MODE')
  if (/source-level path/i.test(text) && /alt/i.test(text) && /```mermaid\s*sequenceDiagram/i.test(text)) findings.add('SOURCE_LEVEL_OPAQUE_EDIT')
  return [...findings].sort()
}

describe('agent-usage scenarios (the mutation loop works)', () => {
  test('all scripted scenarios pass', () => {
    for (const r of runAllScenarios()) {
      expect({ name: r.name, ok: r.ok, detail: r.detail }).toEqual({ name: r.name, ok: true, detail: r.detail })
    }
  })

  test('serialized scenarios take clean mutation paths', () => {
    for (const r of runAllScenarios().filter(r => r.trace.some(c => c.verb === 'serialize'))) {
      const verbs = r.trace.map(c => c.verb)
      expect(verbs[0]).toBe('parse')
      expect(verbs).toContain('mutate')
      expect(verbs.indexOf('verify')).toBeGreaterThan(-1)
      expect(verbs.indexOf('verify')).toBeLessThan(verbs.indexOf('serialize'))
      expect(lintAgentTrace(r.trace)).toEqual([])
    }
  })
})

describe('anti-pattern linter (the affordances steer agents right)', () => {
  test('clean loop produces zero findings', () => {
    const trace: SdkCall[] = [
      { verb: 'parse' }, { verb: 'mutate', body: 'flowchart' }, { verb: 'verify' }, { verb: 'serialize' },
    ]
    expect(lintAgentTrace(trace)).toEqual([])
  })

  test('serialize without intervening verify is flagged', () => {
    const trace: SdkCall[] = [
      { verb: 'parse' }, { verb: 'mutate', body: 'flowchart' }, { verb: 'serialize' },
    ]
    const found = lintAgentTrace(trace)
    expect(found.map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('verify between mutate and serialize clears the legacy no-id flag', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart' }, { verb: 'verify' }, { verb: 'serialize' },
    ]
    expect(lintAgentTrace(trace).map(f => f.code)).not.toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('real trace verify_inspect before serialize clears the diagram', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart', output: 'd1' },
      { verb: 'verify', diagram: 'd1', ok: true, inspected: false },
      { verb: 'verify_inspect', diagram: 'd1', property: 'ok' },
      { verb: 'serialize', diagram: 'd1' },
    ]
    expect(lintAgentTrace(trace)).toEqual([])
  })

  test('verify inspected only after serialize does not clear the commit point', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart', output: 'd1' },
      { verb: 'verify', diagram: 'd1', ok: true, inspected: false },
      { verb: 'serialize', diagram: 'd1' },
      { verb: 'verify_inspect', diagram: 'd1', property: 'ok' },
    ]
    expect(lintAgentTrace(trace).map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('verify must clear the same diagram that is serialized', () => {
    const trace: SdkCall[] = [
      { verb: 'parse', diagram: 'd0' },
      { verb: 'mutate', body: 'flowchart', input: 'd0', output: 'd1' },
      { verb: 'verify', diagram: 'd0', ok: true, inspected: true },
      { verb: 'serialize', diagram: 'd1' },
    ]
    expect(lintAgentTrace(trace).map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('failed verify does not clear a diagram for serialize', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart', output: 'd1' },
      { verb: 'verify', diagram: 'd1', ok: false, inspected: true },
      { verb: 'serialize', diagram: 'd1' },
    ]
    const codes = lintAgentTrace(trace).map(f => f.code)
    expect(codes).toContain('SERIALIZE_AFTER_FAILED_VERIFY')
    expect(codes).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('verify result must be inspected', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart', output: 'd1' },
      { verb: 'verify', diagram: 'd1', ok: true, inspected: false },
      { verb: 'serialize', diagram: 'd1' },
    ]
    expect(lintAgentTrace(trace).map(f => f.code)).toContain('VERIFY_NOT_INSPECTED')
  })

  test('string concatenation is flagged', () => {
    expect(lintAgentTrace([{ verb: 'string_concat' }])[0]!.code).toBe('STRING_CONCAT')
  })

  test('regenerate-whole-source is flagged', () => {
    expect(lintAgentTrace([{ verb: 'regenerate' }])[0]!.code).toBe('REGENERATE')
  })

  test('mutate on an opaque body is flagged', () => {
    expect(lintAgentTrace([{ verb: 'mutate', body: 'opaque' }])[0]!.code).toBe('MUTATE_ON_OPAQUE')
  })

  test('findings carry the call index', () => {
    const trace: SdkCall[] = [{ verb: 'parse' }, { verb: 'mutate', body: 'flowchart' }, { verb: 'serialize' }]
    expect(lintAgentTrace(trace)[0]!.at).toBe(2)
  })
})

describe('homepage prompt eval contract', () => {
  test('homepage CTA prompt is the prompt used by default agent eval cases', () => {
    const prompt = extractHomepageAgentPrompt()
    expect(homepagePromptChecklist(prompt)).toEqual([])
    expect(prompt).toContain('Create or edit a Mermaid diagram')
    expect(prompt).toContain('Do not assume this repository is checked out')
    expect(prompt).toContain('one channel available to you')
    expect(prompt).toContain('the hosted MCP at `https://agentic-mermaid.dev/mcp`')
    expect(prompt).toContain('Library imports, when available')
    expect(prompt).toContain('For a new diagram, author Mermaid source directly')
    expect(prompt).toContain('Mutation ops use a `kind` discriminator')
    expect(prompt).toContain('return an object with `{ source }`')
    expect(prompt).toContain('In Trace, name the channel and exact calls/ops used')
    expect(prompt).toContain('For an existing diagram, parse it')
    for (const c of DEFAULT_CASES) {
      expect({ id: c.id, hasPrompt: c.prompt.includes('Create or edit a Mermaid diagram') }).toEqual({ id: c.id, hasPrompt: true })
      expect({ id: c.id, unresolved: /<replace with|<include the facts|<paste existing/.test(c.prompt) }).toEqual({ id: c.id, unresolved: false })
    }
  })

  test('authoring facts stated by the prompt are true', () => {
    // Mirrors the prompt's "Authoring facts" section: each claim below is a
    // fact agents previously burned tokens rediscovering. If a claim stops
    // holding, fix the prompt in website/source/pages/home.html too.
    const workerLabel = 'Cloudflare Worker\nHTTP router, API routes, SPA asset server'
    const src = [
      'flowchart LR',
      '  subgraph edge["Cloudflare edge"]',
      '    worker["Cloudflare Worker\\nHTTP router, API routes, SPA asset server"]',
      '    kv["Cloudflare KV: SESSIONS"]',
      '  end',
      '  debug["Debug tools"]',
      '  worker -- "create session, fallback reads" --> kv',
      '  debug -. "reads diagnostics" .-> worker',
    ].join('\n')

    // Quoted punctuation labels, \n line breaks, subgraphs, and labeled solid/
    // dotted edges all parse into the structured flowchart body (not opaque).
    const parsed = parseMermaid(src)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const flow = asFlowchart(parsed.value)
    expect(flow?.body.kind).toBe('flowchart')
    expect(flow?.body.graph.nodes.get('worker')?.label).toBe(workerLabel)
    expect(flow?.body.graph.edges.map(e => e.label)).toContain('reads diagnostics')

    // LABEL_OVERFLOW counts total label characters (line breaks included) and
    // stays advisory: verify.ok remains true.
    const verified = verifyMermaid(parsed.value)
    expect(verified.ok).toBe(true)
    expect(verified.warnings).toContainEqual({ code: 'LABEL_OVERFLOW', target: 'worker', charCount: workerLabel.length, limit: 40 })

    // labelCharCap is the sanctioned escape hatch for intentionally long labels.
    const capped = verifyMermaid(parsed.value, { labelCharCap: 80 })
    expect(capped.warnings.filter(w => w.code === 'LABEL_OVERFLOW')).toEqual([])

    // \n canonicalizes to <br> on serialize and the result still parses.
    const round = serializeMermaid(parsed.value)
    expect(round).toContain('<br>')
    const reparsed = parseMermaid(round)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(asFlowchart(reparsed.value)?.body.graph.nodes.size).toBe(3)
  })
})

describe('stored agent-usage eval', () => {
  test('structured default cases cover every supported diagram family', () => {
    const covered = new Set(DEFAULT_CASES.filter(c => requiresStructuredMutation(c.id)).map(c => c.family).filter(Boolean))
    expect([...covered].sort()).toEqual([...AGENT_USAGE_SUPPORTED_FAMILIES].sort())
  })

  test('default eval outputs render into safe, non-empty SVGs with expected labels', async () => {
    const summary = await scoreAgentUsageRenderedQuality()
    expect(summary.ok).toBe(true)
    expect(summary.passed).toBe(summary.total)
    expect(summary.total).toBe(DEFAULT_CASES.length)
    expect([...summary.families].sort()).toEqual([...AGENT_USAGE_SUPPORTED_FAMILIES].sort())
    for (const result of summary.results) {
      expect({ id: result.id, ok: result.ok, warnings: result.warnings, error: result.error }).toEqual({ id: result.id, ok: true, warnings: [], error: undefined })
      expect(result.metrics?.width).toBeGreaterThan(0)
      expect(result.metrics?.height).toBeGreaterThan(0)
      expect(result.metrics?.svgBytes).toBeGreaterThan(1000)
    }
  })

  test('default Code Mode transcripts pass task and trace checks', async () => {
    const summary = await runAgentUsageEval()
    expect(summary.ok).toBe(true)
    expect(summary.passed).toBe(summary.total)
    expect(summary.safePathRate).toBe(1)
    expect(summary.structuredPathRate).toBe(1)
  })

  test('baseline.json gates deterministic stored evals', async () => {
    const baseline = JSON.parse(readFileSync(join(REPO, 'eval/agent-usage/baseline.json'), 'utf8')) as {
      total: number
      minPassed: number
      minSafePathRate: number
      minStructuredPathRate: number
    }
    const summary = await runAgentUsageEval()
    expect(summary.total).toBe(baseline.total)
    expect(summary.passed).toBeGreaterThanOrEqual(baseline.minPassed)
    expect(summary.safePathRate).toBeGreaterThanOrEqual(baseline.minSafePathRate)
    expect(summary.structuredPathRate).toBeGreaterThanOrEqual(baseline.minStructuredPathRate)
  })

  test('new-diagram source authoring passes without structured mutation', async () => {
    const summary = await runAgentUsageEval([{ id: 'author_auth_flow_source', prompt: 'author new source', script: `
      const source = '---\\ntitle: Auth Flow\\n---\\nflowchart LR\\n  A[User] --> B[Login Page]\\n  B --> C{Valid Credentials?}\\n  C -->|No| B\\n  C -->|Yes| D{MFA Enabled?}\\n  D -->|Yes| E[Enter MFA Code]\\n  E --> F{Code Valid?}\\n  F -->|No| E\\n  D -->|No| G[Create Session]\\n  F -->|Yes| G\\n  G --> H[Dashboard]'
      const parsed = mermaid.parseMermaid(source)
      if (!parsed.ok) return { error: parsed.error }
      const verify = mermaid.verifyMermaid(parsed.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source }
    ` }])
    expect(summary.ok).toBe(true)
    expect(summary.safePathRate).toBe(1)
    expect(summary.structuredPathRate).toBe(0)
    expect(summary.results[0]!.taskOk).toBe(true)
    expect(summary.results[0]!.traceOk).toBe(true)
  })

  test('task-shaped output without structured trace does not pass', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `return { source: 'flowchart TD\\n  API --> Cache\\n  Cache --> DB' }` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('decoy structured trace with regenerated output does not pass', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: verify.warnings }
      mermaid.serializeMermaid(r1.value)
      return { source: 'flowchart TD\\n  API --> Cache\\n  Cache --> DB' }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('sequence-with-alt structured mutation: regenerated output (no real mutate) does not pass', async () => {
    // BUILD-18: the alt block is now mutable, so a hand-written output that
    // skips structured mutation must still fail the trace + task checks.
    const summary = await runAgentUsageEval([{ id: 'sequence_alt_add_message', prompt: 'bad', script: `return { source: 'sequenceDiagram\\n  A->>B: hi\\n  A->>B: bye' }` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('sequence-with-alt decoy: clean trace but returned hand-built source (alt dropped) fails the task', async () => {
    // Real mutate lineage, verify+inspect, serialize — so the trace is clean
    // (traceOk true). But the returned source is a hand-built string that does
    // not match the serialized output, so the task check rejects it: returning
    // a regenerated source instead of the serialized mutation is unsafe.
    const summary = await runAgentUsageEval([{ id: 'sequence_alt_add_message', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  alt ok\\n    B-->>A: yes\\n  end')
      const seq = mermaid.asSequence(r0.value)
      const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'A', to: 'B', text: 'bye' })
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: verify.warnings }
      mermaid.serializeMermaid(r1.value)
      return { source: 'sequenceDiagram\\n  A->>B: hi\\n  A->>B: bye' }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(true)
  })

  test('manual ValidDiagram clones cannot be used to fake structured mutation lineage', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const clone = JSON.parse(JSON.stringify(r0.value))
      clone.body.graph.nodes.Cache = { id: 'Cache', label: 'Cache' }
      clone.body.graph.edges = [{ source: 'API', target: 'Cache' }, { source: 'Cache', target: 'DB' }]
      return mermaid.mutate(clone, { kind: 'set_label', id: 'Cache', label: 'Cache' })
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
    expect(summary.results[0]!.error).toContain('must come from mermaid.parseMermaid')
  })

  test('forged proxies cannot fake trusted diagram lineage', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const clone = JSON.parse(JSON.stringify(r0.value))
      clone.body.graph.nodes.Cache = { id: 'Cache', label: 'Cache' }
      clone.body.graph.edges = [{ source: 'API', target: 'Cache' }, { source: 'Cache', target: 'DB' }]
      const forged = new Proxy(clone, { has: () => true, get: (target, prop) => target[prop] })
      return mermaid.mutate(forged, { kind: 'set_label', id: 'Cache', label: 'Cache' })
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
    expect(summary.results[0]!.error).toContain('must come from mermaid.parseMermaid')
  })

  test('direct IR edits after verify are rejected by read-only SDK results', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: verify.warnings }
      const first = r1.value.body.graph.edges[0]
      first.target = 'Cache'
      r1.value.body.graph.edges.push({ ...first, source: 'Cache', target: 'DB' })
      return { source: mermaid.serializeMermaid(r1.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
    expect(summary.results[0]!.error).toContain('read-only')
  })

  test('decoy mutations on regenerated already-correct source do not satisfy input lineage', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\n  API --> Cache\n  Cache --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Unused', label: 'Unused' })
      const r2 = mermaid.mutate(r1.value, { kind: 'remove_edge', id: 'API->Cache' })
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
      const r4 = mermaid.mutate(r3.value, { kind: 'add_edge', from: 'Cache', to: 'DB' })
      const verify = mermaid.verifyMermaid(r4.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r4.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('failed required mutation ops do not satisfy trace requirements', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      mermaid.mutate(r1.value, { kind: 'remove_edge', id: 'missing-edge' })
      const r2 = mermaid.mutate(r1.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'Cache', to: 'DB' })
      const verify = mermaid.verifyMermaid(r3.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r3.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('repeating required mutation kinds must satisfy required counts, not just a set', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      const r2 = mermaid.mutate(r1.value, { kind: 'remove_edge', id: 'API->DB' })
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
      const verify = mermaid.verifyMermaid(r3.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r3.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('Proxy ops cannot spoof trace opKind differently from the executed mutation', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const spoof = (fakeKind) => {
        let calls = 0
        return new Proxy({ kind: 'set_label', target: 'API', label: 'API' }, {
          get(target, prop) { if (prop === 'kind') return calls++ === 0 ? fakeKind : target.kind; return target[prop] }
        })
      }
      const r1 = mermaid.mutate(flow, spoof('add_node'))
      if (!r1.ok) return { error: r1.error }
      const r2 = mermaid.mutate(r1.value, spoof('remove_edge'))
      if (!r2.ok) return { error: r2.error }
      const r3 = mermaid.mutate(r2.value, spoof('add_edge'))
      if (!r3.ok) return { error: r3.error }
      const verify = mermaid.verifyMermaid(r3.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r3.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('result getters cannot inspect verify then serialize during output JSON conversion', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      const r2 = mermaid.mutate(r1.value, { kind: 'remove_edge', id: 'API->DB' })
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
      const r4 = mermaid.mutate(r3.value, { kind: 'add_edge', from: 'Cache', to: 'DB' })
      const verify = mermaid.verifyMermaid(r4.value)
      return { verify, get source() { return mermaid.serializeMermaid(r4.value) } }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
    expect(summary.results[0]!.error).toContain('not allowed while returning results')
  })
})

describe('EVAL-2 failure corpus (captured bad-agent paths stay failing)', () => {
  const corpus = loadFailureCorpus()

  test('fixtures have stable unique ids and expectations', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(8)
    expect(new Set(corpus.cases.map(c => c.id)).size).toBe(corpus.cases.length)
    for (const c of corpus.cases) {
      expect(c.source).toMatch(/^(pi-subagent-|curated-from-observed-pattern)/)
      expect(c.rawResponse.length).toBeGreaterThan(20)
      if (c.kind === 'raw-response') expect(c.expectedRawFindings?.length ?? 0).toBeGreaterThan(0)
      if (c.kind === 'code-mode') expect(c.expectedResult).toBeDefined()
    }
  })

  test('raw non-Code-Mode responses are classified as unsafe paths', () => {
    for (const c of corpus.cases.filter(c => c.kind === 'raw-response')) {
      const findings = classifyRawAgentFailure(c.rawResponse)
      for (const expected of c.expectedRawFindings ?? []) expect(findings).toContain(expected)
    }
  })

  test('executable failure cases replay through the eval oracle', async () => {
    for (const c of corpus.cases.filter(c => c.kind === 'code-mode')) {
      const summary = await runAgentUsageEval([{ id: c.caseId, prompt: c.prompt, script: c.rawResponse }])
      const result = summary.results[0]!
      expect({ id: c.id, ok: result.ok, taskOk: result.taskOk, traceOk: result.traceOk }).toEqual({
        id: c.id,
        ok: c.expectedResult!.ok,
        taskOk: c.expectedResult!.taskOk,
        traceOk: c.expectedResult!.traceOk,
      })
      const findings = result.findings.map(f => f.code)
      for (const expected of c.expectedResult!.findings) expect(findings).toContain(expected)
    }
  })
})

describe('real Code Mode trace instrumentation', () => {
  test('safe execute() script produces a clean trace', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { ok: false, warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `, { trace: true })
    expect(r.ok).toBe(true)
    expect(lintAgentTrace(r.trace as SdkCall[])).toEqual([])
  })

  test('opaque mutate attempt is linted even when mutate returns a structured error', async () => {
    // BUILD-18: an alt-block sequence is now structured, so the genuinely
    // opaque case is an un-segmentable one (stray `end`). Mutating it returns
    // a structured error AND the trace flags MUTATE_ON_OPAQUE.
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  end')
      return mermaid.mutate(r0.value, { kind: 'add_message', from: 'A', to: 'B', text: 'bad' })
    `, { trace: true })
    expect(r.ok).toBe(true)
    expect((r as { value?: { ok?: boolean; error?: { code?: string } } }).value?.ok).toBe(false)
    expect((r as { value?: { error?: { code?: string } } }).value?.error?.code).toBe('INVALID_OP')
    expect(lintAgentTrace(r.trace as SdkCall[]).map(f => f.code)).toContain('MUTATE_ON_OPAQUE')
  })

  test('unsafe execute() script is linted from its actual trace', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      return mermaid.serializeMermaid(r1.value)
    `, { trace: true })
    expect(r.ok).toBe(true)
    expect(lintAgentTrace(r.trace as SdkCall[]).map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('returning verify after source does not count as pre-serialize inspection', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      return { source: mermaid.serializeMermaid(r1.value), ok: verify.ok }
    `, { trace: true })
    expect(r.ok).toBe(true)
    expect(lintAgentTrace(r.trace as SdkCall[]).map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('MCP tools/call execute matches traced replay', async () => {
    const code = `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      if (!r0.ok) return { error: 'parse' }
      const flow = mermaid.asFlowchart(r0.value)
      if (!flow) return { error: 'narrow' }
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `
    const res = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute', arguments: { code } } })
    expect(res && 'result' in res).toBe(true)
    const text = ((res as any).result.content[0].text) as string
    const payload = JSON.parse(text)
    expect(payload.ok).toBe(true)

    const replay = await executeInSandbox(code, { trace: true })
    expect(replay.value).toEqual(payload.value)
    expect(lintAgentTrace(replay.trace as SdkCall[])).toEqual([])
  })
})
