import { describe, expect, test } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { isIndexedForestGraph as admitted, indexedForestLayout as lazyLayout } from '../experimental/indexed-forest.lazy.ts'
import { indexedForestLayout as canonicalLayout } from '../experimental/indexed-forest.ts'
import { loadForest, readyForest } from '../layout/forest-loader.lazy.ts'
import { layoutAgenticGraph as lazyNative } from '../layout/agentic-layered.lazy.ts'
import { layoutAgenticGraph as canonicalNative, type MeasuredGraph } from '../layout/agentic-layered.ts'
import { DeferredDependencyError } from '../layout/certification-error.ts'
import type { Direction } from '../types.ts'

const source = 'flowchart TD\nA[Wide root] --> B\nA --> C\nD[Disconnected]'

describe('shared lazy forest boundary', () => {
  test('rejects ineligible graphs before loading and shares admitted forest/native acquisition', async () => {
    expect(admitted(parseMermaid('flowchart TD\nA --> B\nB --> A'))).toBe(false)
    expect(admitted(parseMermaid('flowchart TD\nA -- label --> B'))).toBe(false)
    let forest: unknown, native: unknown
    try { admitted(parseMermaid(source)) } catch (value) { forest = value }
    const measured: MeasuredGraph = {
      nodes: [{ id: 'a', width: 80, height: 32 }, { id: 'b', width: 80, height: 32 }],
      edges: [{ source: 0, target: 1, minSpan: 1 }],
      direction: 'TB', padding: 20, nodeSpacing: 40, layerSpacing: 50,
    }
    try { lazyNative(measured) } catch (value) { native = value }
    expect(forest).toBeInstanceOf(DeferredDependencyError)
    expect(native).toBeInstanceOf(DeferredDependencyError)
    expect((forest as DeferredDependencyError).dependency).toBe('Forest layout')
    expect((native as DeferredDependencyError).dependency).toBe('Agentic layout')
    await Promise.all([loadForest(), (forest as DeferredDependencyError).load(), (native as DeferredDependencyError).load()])
    expect(admitted(parseMermaid(source))).toBe(true)
    expect(readyForest().indexedForestLayout).toBe(canonicalLayout)
    expect(lazyNative(measured)).toEqual(canonicalNative(measured))
    const actual = lazyNative(measured)
    actual.nodes[0]!.x = -1000
    expect(lazyNative(measured)).toEqual(canonicalNative(measured))
  })

  for (const direction of ['TD', 'BT', 'LR', 'RL'] satisfies Direction[]) {
    test(`forwards canonical forest geometry with fresh ownership in ${direction}`, async () => {
      await loadForest()
      const graph = parseMermaid(source.replace('TD', direction))
      const input = { id: 'root', children: [...graph.nodes.keys()].map((id, index) => ({ id, width: 40 + index * 7, height: 30 + index * 3 })) }
      const before = structuredClone(input)
      const expected = canonicalLayout(graph, input, 20, 40, 50)
      const actual = lazyLayout(graph, input, 20, 40, 50)
      expect(actual).toEqual(expected)
      expect(input).toEqual(before)
      expect(actual).not.toBe(expected)
      expect(actual!.children![0]).not.toBe(input.children[0])
      actual!.children![0]!.x = -1000
      expect(lazyLayout(graph, input, 20, 40, 50)).toEqual(expected)
      expect(lazyLayout(graph, input, 20, 0, 50)).toBeUndefined()
    })
  }
})
