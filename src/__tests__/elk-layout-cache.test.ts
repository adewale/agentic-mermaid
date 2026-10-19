import { describe, expect, test } from 'bun:test'
import type { ElkNode } from 'elkjs'
import { clearElkLayoutCache, elkLayoutSync } from '../elk-instance.ts'

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
})
