// Loop 13 M6: agent-usage validation harness — scenarios + anti-pattern linter.

import { describe, test, expect } from 'bun:test'
import { runAllScenarios, lintAgentTrace, type SdkCall } from '../../eval/agent-usage/harness.ts'

describe('agent-usage scenarios (the structured loop works)', () => {
  test('all scripted scenarios pass', () => {
    for (const r of runAllScenarios()) {
      expect({ name: r.name, ok: r.ok, detail: r.detail }).toEqual({ name: r.name, ok: true, detail: r.detail })
    }
  })

  test('add_node scenario takes the parse→mutate→verify→serialize path', () => {
    const add = runAllScenarios().find(r => r.name === 'add_node')!
    const verbs = add.trace.map(c => c.verb)
    expect(verbs[0]).toBe('parse')
    expect(verbs).toContain('mutate')
    // verify precedes serialize
    expect(verbs.indexOf('verify')).toBeLessThan(verbs.indexOf('serialize'))
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

  test('verify between mutate and serialize clears the flag', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart' }, { verb: 'verify' }, { verb: 'serialize' },
    ]
    expect(lintAgentTrace(trace).map(f => f.code)).not.toContain('SERIALIZE_WITHOUT_VERIFY')
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
