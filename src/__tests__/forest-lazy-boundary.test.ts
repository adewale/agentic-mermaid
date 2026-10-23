import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseMermaid } from '../parser.ts'
import { isIndexedForestGraph as admitted, indexedForestLayout as lazyLayout } from '../experimental/indexed-forest.lazy.ts'
import { indexedForestLayout as canonicalLayout } from '../experimental/indexed-forest.ts'
import { loadForest, readyForest } from '../layout/forest-loader.lazy.ts'
import { DeferredDependencyError } from '../layout/backend.ts'
import { renderLoadedFamilySvgWithReceipt } from '../browser-lazy/render-core.ts'
import type { Direction } from '../types.ts'

const source = 'flowchart TD\nA[Wide root] --> B\nA --> C\nD[Disconnected]'

describe('shared lazy forest boundary', () => {
  test('rejects ineligible graphs without a load, and suspends eligible admission before sizing', async () => {
    expect(admitted(parseMermaid('flowchart TD\nA --> B\nB --> A'))).toBe(false)
    expect(admitted(parseMermaid('flowchart TD\nA -- label --> B'))).toBe(false)
    let error: unknown
    try { admitted(parseMermaid(source)) } catch (value) { error = value }
    expect(error).toBeInstanceOf(DeferredDependencyError)
    expect((error as DeferredDependencyError).load).toBe(loadForest)
    await Promise.all([loadForest(), (error as DeferredDependencyError).load()])
    expect(admitted(parseMermaid(source))).toBe(true)
    expect(readyForest().indexedForestLayout).toBe(canonicalLayout)
  })

  for (const direction of ['TD', 'BT', 'LR', 'RL'] satisfies Direction[]) {
    test(`forwards the exact canonical forest geometry and fresh ownership in ${direction}`, async () => {
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

  test('shares pending work, propagates load failure and permits only a later explicit retry', async () => {
    const source = readFileSync(new URL('../layout/forest-loader.lazy.ts', import.meta.url), 'utf8')
      .replace("import { DeferredDependencyError } from './backend.ts'", '')
      .replace("typeof import('./forest-implementation.ts')", '{ token: number }')
      .replace("import('./forest-implementation.ts')", 'acquire()')
      .replaceAll('export ', '')
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
    let calls = 0
    const token = new Error('load failure')
    let rejectFirst: ((error: unknown) => void) | undefined
    const module = { token: 42 }
    const fixture = new Function('DeferredDependencyError', 'acquire', js + '\nreturn { loadForest, readyForest }')(DeferredDependencyError, () => {
      calls++
      return calls === 1 ? new Promise((_resolve, reject) => { rejectFirst = reject }) : Promise.resolve(module)
    }) as { loadForest(): Promise<void>; readyForest(): { token: number } }
    const first = fixture.loadForest(), concurrent = fixture.loadForest()
    expect(calls).toBe(1)
    const failures = Promise.allSettled([first, concurrent])
    rejectFirst!(token)
    expect(await failures).toEqual([{ status: 'rejected', reason: token }, { status: 'rejected', reason: token }])
    expect(() => fixture.readyForest()).toThrow(DeferredDependencyError)
    await fixture.loadForest()
    expect(calls).toBe(2)
    expect(fixture.readyForest()).toBe(module)
    await fixture.loadForest()
    expect(calls).toBe(2)
  })

  test('native readiness waits for the shared forest promise inside its existing dependency event', async () => {
    const source = readFileSync(new URL('../layout/agentic-layered.lazy.ts', import.meta.url), 'utf8')
      .replace("import { loadForest, readyForest } from './forest-loader.lazy.ts'", '')
      .replace("import { GraphLayoutUnsupportedError, DeferredDependencyError } from './backend.ts'", '')
      .replace("Promise.all([import('./agentic-producer-core.ts'),", 'Promise.all([acquireProducer(),')
      .replaceAll('export ', '')
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
    let release: (() => void) | undefined, loaded = false, computations = 0
    const waiting = new Promise<void>(resolve => { release = () => { loaded = true; resolve() } })
    const forest = { layoutMeasuredForest: (value: unknown) => value }
    const module = { createMeasuredLayoutCache: (compute: (value: unknown) => unknown) => { computations++; return compute },
      layoutLayeredGraph: (input: unknown, actualForest: unknown) => { expect(actualForest).toBe(forest.layoutMeasuredForest); return input } }
    const fixture = new Function('loadForest', 'readyForest', 'GraphLayoutUnsupportedError', 'DeferredDependencyError', 'acquireProducer', js + '\nreturn { layoutAgenticGraph }')(
      () => waiting, () => { if (!loaded) throw Error('Forest not loaded'); return forest }, Error, DeferredDependencyError, () => Promise.resolve(module),
    ) as { layoutAgenticGraph(value: unknown): unknown }
    let dependency: unknown
    try { fixture.layoutAgenticGraph({}) } catch (error) { dependency = error }
    expect(dependency).toBeInstanceOf(DeferredDependencyError)
    const pending = (dependency as DeferredDependencyError).load()
    const observed = pending.then(() => ({ ok: true }), error => ({ ok: false, error }))
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    expect(computations).toBe(0)
    release!()
    expect(await observed).toEqual({ ok: true })
    expect(computations).toBe(1)
    const input = { token: 'fresh measured input' }
    expect(fixture.layoutAgenticGraph(input)).toBe(input)
  })

  test('retains three dependency events and rejects a fourth rather than widening retry policy', async () => {
    const { default: descriptor } = await import('../browser-lazy/families/pie.ts')
    const expected = await renderLoadedFamilySvgWithReceipt('pie\n "A" : 1', {}, descriptor)
    let loads = 0, attempts = 0
    const dependencies = Array.from({ length: 4 }, () => new DeferredDependencyError('fixture', async () => { loads++ }))
    const three = { ...descriptor, layout: (context: Parameters<NonNullable<typeof descriptor.layout>>[0]) => {
      if (attempts++ < 3) throw dependencies[attempts - 1]
      return descriptor.layout!(context)
    } }
    expect(await renderLoadedFamilySvgWithReceipt('pie\n "A" : 1', {}, three)).toEqual(expected)
    expect(loads).toBe(3)
    attempts = 0; loads = 0
    const four = { ...descriptor, layout: (context: Parameters<NonNullable<typeof descriptor.layout>>[0]) => {
      if (attempts++ < 4) throw dependencies[attempts - 1]
      return descriptor.layout!(context)
    } }
    await expect(renderLoadedFamilySvgWithReceipt('pie\n "A" : 1', {}, four)).rejects.toBe(dependencies[3])
    expect(loads).toBe(3)
  })
})
