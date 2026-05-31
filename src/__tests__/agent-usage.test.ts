// Loop 13 M6: agent-usage validation harness — scenarios + anti-pattern linter.

import { describe, test, expect } from 'bun:test'
import { runAllScenarios, lintAgentTrace, type SdkCall } from '../../eval/agent-usage/harness.ts'
import { runAgentUsageEval } from '../../eval/agent-usage/run.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest } from '../mcp/server.ts'

describe('agent-usage scenarios (the structured loop works)', () => {
  test('all scripted scenarios pass', () => {
    for (const r of runAllScenarios()) {
      expect({ name: r.name, ok: r.ok, detail: r.detail }).toEqual({ name: r.name, ok: true, detail: r.detail })
    }
  })

  test('serialized scenarios take clean structured paths', () => {
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

describe('stored agent-usage eval', () => {
  test('default Code Mode transcripts pass task and trace checks', async () => {
    const summary = await runAgentUsageEval()
    expect(summary.ok).toBe(true)
    expect(summary.passed).toBe(summary.total)
    expect(summary.safePathRate).toBe(1)
    expect(summary.structuredPathRate).toBe(1)
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

  test('opaque-refusal output must actually call the sequence narrower and preserve parsed source', async () => {
    const summary = await runAgentUsageEval([{ id: 'sequence_alt_refuses_mutation', prompt: 'bad', script: `return { refused: true, source: 'sequenceDiagram\\n  A->>B: hi' }` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('opaque-refusal decoy trace must return the preserved body.source', async () => {
    const summary = await runAgentUsageEval([{ id: 'sequence_alt_refuses_mutation', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  alt ok\\n    B-->>A: yes\\n  end')
      mermaid.asSequence(r0.value)
      return { refused: true, source: 'sequenceDiagram\\n  A->>B: hi' }
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
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  alt ok\\n    B-->>A: yes\\n  end')
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
