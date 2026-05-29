// Loop 13 M6: agent-usage validation harness — scenarios + anti-pattern linter.

import { describe, test, expect } from 'bun:test'
import { runAllScenarios, lintAgentTrace, type SdkCall } from '../../eval/agent-usage/harness.ts'
import { runAgentUsageEval } from '../../eval/agent-usage/run.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'

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
    expect(summary.structuredPathRate).toBe(1)
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
    expect(summary.results[0]!.traceOk).toBe(true)
  })

  test('opaque-refusal output must actually call the sequence narrower and preserve parsed source', async () => {
    const summary = await runAgentUsageEval([{ id: 'sequence_alt_refuses_mutation', prompt: 'bad', script: `return { refused: true, source: 'sequenceDiagram\\n  A->>B: hi' }` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('opaque-refusal decoy trace must return the parsed canonicalSource', async () => {
    const summary = await runAgentUsageEval([{ id: 'sequence_alt_refuses_mutation', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  alt ok\\n    B-->>A: yes\\n  end')
      mermaid.asSequence(r0.value)
      return { refused: true, source: 'sequenceDiagram\\n  A->>B: hi' }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(true)
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
})
