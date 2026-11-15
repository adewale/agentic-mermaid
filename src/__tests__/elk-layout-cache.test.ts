import { describe, expect, test } from 'bun:test'
import type { ElkNode } from 'elkjs'
import { clearElkLayoutCache, elkLayoutSync } from '../elk-instance.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

const graph = (): ElkNode => ({
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN' },
  children: [{ id: 'a', width: 40, height: 20 }, { id: 'b', width: 40, height: 20 }, { id: 'c', width: 40, height: 20 }],
  edges: [{ id: 'ab', sources: ['a'], targets: ['b'] }, { id: 'ac', sources: ['a'], targets: ['c'] }],
})
// ELK's GWT runtime stamps objects with a process-wide identity hash.
const geometry = (result: ElkNode) => JSON.stringify(result, (key, value) => key === '$H' ? undefined : value)

describe('ELK layout cache', () => {
  test('a repeated graph gets the cold geometry in a copy its caller may adjust', () => {
    clearElkLayoutCache()
    const cold = elkLayoutSync(graph())
    const expected = geometry(cold)
    // Callers shift what they receive, as ER and class titles do.
    cold.children![0]!.y = 999
    cold.edges![0]!.sections![0]!.startPoint.y = 999
    const first = elkLayoutSync(graph())
    expect(geometry(first)).toBe(expected)
    first.children![1]!.x = -1
    first.edges![1]!.sections![0]!.bendPoints?.push({ x: 0, y: 0 })
    const second = elkLayoutSync(graph())
    expect(second).not.toBe(first)
    expect(geometry(second)).toBe(expected)
  })

  test('graphs that differ only in an option or a node size do not share a result', () => {
    clearElkLayoutCache()
    const down = elkLayoutSync(graph())
    const right = elkLayoutSync({ ...graph(), layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' } })
    expect(geometry(right)).not.toBe(geometry(down))
    const wider = graph()
    wider.children![0]!.width = 90
    expect(geometry(elkLayoutSync(wider))).not.toBe(geometry(down))
  })

  test('owner residency quota rejects large results and preserves key and entry bounds', async () => {
    const child = await runChild(process.execPath, ['-e', `
      import assert from 'node:assert/strict'
      import { spyOn } from 'bun:test'
      import * as constructors from './src/elk-constructor.ts'
      let layouts = 0
      let output = input => ({ ...input, width: 1, height: 1 })
      const raw = { onmessage: null, dispatcher: { saveDispatch({ data }) {
        layouts++
        raw.onmessage({ data: { data: output(data.graph) } })
      } } }
      spyOn(constructors, 'elkConstructor').mockReturnValue(class { worker = { worker: raw } })
      const { elkLayoutSync, clearElkLayoutCache } = await import('./src/elk-instance.ts')
      const request = (id, padding = '') => ({ id, children: [], edges: [], padding })
      const solve = (id, padding) => elkLayoutSync(request(id, padding))
      const reset = () => { clearElkLayoutCache(); layouts = 0 }

      // One output with a short key already exceeds the owner quota. Map
      // contents must count even though JSON serialization would omit them.
      output = input => ({ ...input, payload: new Map([['large', 'x'.repeat(2 * 1024 * 1024)]]) })
      solve('oversized')
      solve('oversized')
      assert.equal(layouts, 2)

      // Three individually admissible results exceed 8 MiB together. Reuse
      // refreshes recency, while the least recently used result is evicted.
      reset()
      output = input => ({ ...input, payload: new Map([['large', 'x'.repeat(700 * 1024)]]) })
      solve('first'); solve('second'); solve('third')
      solve('second')
      assert.equal(layouts, 3)
      solve('first')
      assert.equal(layouts, 4)

      // Large input keys with tiny outputs still obey the original aggregate
      // one-million-code-unit bound, independently of result residency.
      reset()
      output = input => ({ id: input.id, width: 1, height: 1 })
      const padding = 'k'.repeat(300 * 1024)
      for (let index = 0; index < 4; index++) solve('key-' + index, padding)
      solve('key-3', padding)
      assert.equal(layouts, 4)
      solve('key-0', padding)
      assert.equal(layouts, 5)

      reset()
      for (let index = 0; index < 65; index++) solve('entry-' + index)
      solve('entry-64'); solve('entry-1')
      assert.equal(layouts, 65)
      solve('entry-0')
      assert.equal(layouts, 66)
    `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: '1' } })
    expect(child.stderr).toBe('')
    expect(child.status).toBe(0)
  }, 25_000)
})
