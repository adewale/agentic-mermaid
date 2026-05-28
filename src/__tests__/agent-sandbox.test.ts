// Tests for the Code Mode sandbox.

import { describe, test, expect } from 'bun:test'
import { executeInSandbox } from '../mcp/sandbox.ts'

describe('executeInSandbox — happy path', () => {
  test('returns the value from a parse → mutate → serialize chain', async () => {
    const code = `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      if (!r0.ok) return { error: r0.error }
      const r1 = mermaid.mutate(r0.value, { kind: 'add_node', id: 'C', label: 'Cache' })
      if (!r1.ok) return { error: r1.error }
      return { source: mermaid.serializeMermaid(r1.value) }
    `
    const r = await executeInSandbox(code)
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ source: expect.stringContaining('Cache') })
  })

  test('executes an async-arrow body', async () => {
    const code = `async () => {
      const v = mermaid.verifyMermaid('flowchart TD\\n  A --> B')
      return { ok: v.ok, nodeCount: v.layout.nodes.length }
    }`
    const r = await executeInSandbox(code)
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ ok: true, nodeCount: 2 })
  })

  test('captures console.log into the logs array', async () => {
    const code = `
      console.log('hi')
      console.log('with', 'multiple', 'args')
      return 1
    `
    const r = await executeInSandbox(code)
    expect(r.ok).toBe(true)
    expect(r.logs).toEqual(['hi', 'with multiple args'])
  })
})

describe('executeInSandbox — isolation', () => {
  test('blocks access to process', async () => {
    const r = await executeInSandbox(`return typeof process`)
    expect(r.ok).toBe(true)
    expect(r.value).toBe('undefined')
  })

  test('blocks access to require/import', async () => {
    const r = await executeInSandbox(`return typeof require`)
    expect(r.ok).toBe(true)
    expect(r.value).toBe('undefined')
  })

  test('blocks access to fetch', async () => {
    const r = await executeInSandbox(`return typeof fetch`)
    expect(r.ok).toBe(true)
    expect(r.value).toBe('undefined')
  })

  test('blocks access to filesystem (fs is not reachable)', async () => {
    const r = await executeInSandbox(`return typeof globalThis.fs`)
    expect(r.ok).toBe(true)
    expect(r.value).toBe('undefined')
  })

  test('exposes only mermaid plus the safe-globals allowlist', async () => {
    const r = await executeInSandbox(`
      const has = (name) => typeof globalThis[name] !== 'undefined'
      return {
        mermaid: has('mermaid'),
        json: has('JSON'),
        math: has('Math'),
        process: has('process'),
        require: has('require'),
        fetch: has('fetch'),
        Function: has('Function'),
        eval: has('eval'),
      }
    `)
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({
      mermaid: true,
      json: true,
      math: true,
      process: false,
      require: false,
      fetch: false,
    })
  })
})

describe('executeInSandbox — errors and timeouts', () => {
  test('returns ok:false on a thrown error', async () => {
    const r = await executeInSandbox(`throw new Error('boom')`)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
  })

  test('returns ok:false on a syntax error', async () => {
    const r = await executeInSandbox(`this is ::: not valid`)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/syntax|unexpected|compile/i)
  })

  test('respects timeoutMs for runaway code', async () => {
    const r = await executeInSandbox(`while (true) {}`, { timeoutMs: 200 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/timeout|Execution timed out/i)
  })
})

describe('executeInSandbox — multi-step agent workflow', () => {
  test('verify → mutate-batch → re-verify in one execute()', async () => {
    const code = `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      if (!r0.ok) return { phase: 'parse', err: r0.error }
      const ops = [
        { kind: 'add_node', id: 'Cache', label: 'Cache' },
        { kind: 'add_edge', from: 'B', to: 'Cache' },
      ]
      let cur = r0.value
      for (const op of ops) {
        const next = mermaid.mutate(cur, op)
        if (!next.ok) return { phase: 'mutate', op, err: next.error }
        cur = next.value
      }
      const v = mermaid.verifyMermaid(cur)
      return {
        ok: v.ok,
        warnings: v.warnings.length,
        source: mermaid.serializeMermaid(cur),
      }
    `
    const r = await executeInSandbox(code)
    expect(r.ok).toBe(true)
    const out = r.value as { ok: boolean; warnings: number; source: string }
    expect(out.ok).toBe(true)
    expect(out.source).toContain('Cache')
  })
})
