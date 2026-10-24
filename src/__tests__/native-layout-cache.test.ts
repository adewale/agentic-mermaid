import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createMeasuredLayoutCache, layoutLayeredGraph } from '../layout/agentic-producer-core.ts'
import { layoutMeasuredForest } from '../layout/measured-forest.ts'
import type { AgenticLayout, MeasuredGraph } from '../layout/agentic-layered-core.ts'
import { createMermaidRenderer, renderMermaidSVGWithReceipt } from '../index.ts'
import { withPerformanceExperiments, type PerformanceExperiment } from '../experimental-performance.ts'
import { withRenderStageObserver } from '../render-stages.ts'

const measured = (): MeasuredGraph => ({
  nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, width: 80, height: 32 })),
  edges: [{ source: 0, target: 1, minSpan: 1, label: { width: 50, height: 16 } },
    { source: 1, target: 2, minSpan: 1 }, { source: 2, target: 0, minSpan: 1 }],
  direction: 'TB', padding: 30, nodeSpacing: 40, layerSpacing: 60,
})
const compute = (input: MeasuredGraph): AgenticLayout => layoutLayeredGraph(input, layoutMeasuredForest, reason => { throw new Error(reason) })

describe('native measured geometry reuse', () => {
  test('replays the selected order after a comment edit and rechecks changed style maps and host metrics', () => {
    const source = readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-15.mmd', import.meta.url), 'utf8')
    const options = { graphLayout: { backend: 'agentic' as const }, nodeSpacing: 73 }
    const observe = (value: string, render = renderMermaidSVGWithReceipt, flags: readonly PerformanceExperiment[] = ['text-spans']) => {
      let placements = 0
      const rendered = withPerformanceExperiments(flags, () => withRenderStageObserver(sample => {
        if (sample.stage === 'agentic') placements++
      }, () => render(value, options)))
      return { placements, rendered }
    }
    const first = observe(source), edited = observe(source + '\n%% reviewed')
    expect(first.placements).toBeGreaterThan(1)
    expect(edited.placements).toBe(1)
    expect(edited.rendered.svg).toBe(first.rendered.svg)
    expect(edited.rendered.receipt.layoutDecisions).toEqual(first.rendered.receipt.layoutDecisions)
    expect(edited.rendered.receipt.layoutCertification).toEqual(first.rendered.receipt.layoutCertification)
    expect(edited.rendered.receipt.requestDigest).not.toBe(first.rendered.receipt.requestDigest)
    for (const flags of [[], ['text-spans', 'indexed-layout'], ['text-spans', 'position-cache']] as const) {
      const transparent = observe(source + '\n%% transparent ' + flags.join(','), renderMermaidSVGWithReceipt, flags)
      expect(transparent.placements).toBe(1)
      expect(transparent.rendered.svg).toBe(first.rendered.svg)
    }
    for (const style of ['style n0 stroke-width:4px', 'linkStyle default stroke-width:4px']) {
      const changed = source + '\n' + style
      expect(observe(changed).placements).toBeGreaterThan(1)
      expect(observe(changed + '\n%% reviewed').placements).toBe(1)
    }
    const textMeasurement = { id: 'test:native-order', version: '1.0.0', measure: ({ text, fontSize }: { text: string; fontSize: number }) => text.length * fontSize * .55 }
    const host = createMermaidRenderer({ textMeasurement })
    expect(observe(source, host.renderMermaidSVGWithReceipt).placements).toBeGreaterThan(1)
    expect(observe(source + '\n%% profiled', host.renderMermaidSVGWithReceipt).placements).toBeGreaterThan(1)
  })

  test('reattaches current authored text and execution receipts after an edit of equal-size cards', () => {
    const options = { graphLayout: { backend: 'agentic' as const } }
    const first = renderMermaidSVGWithReceipt('flowchart TB\n A[Cat] --> B[Pet]', options)
    const edited = renderMermaidSVGWithReceipt('flowchart TB\n A[Dog] --> B[Pet]', options)
    expect(first.svg).toContain('Cat')
    expect(edited.svg).toContain('Dog')
    expect(edited.svg).not.toContain('Cat')
    expect(edited.receipt.layoutDecisions).toEqual(first.receipt.layoutDecisions)
    expect(edited.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
  })

  test.each(['cycle', 'compound', 'shared fan'])('isolates cached %s geometry from caller mutations', kind => {
    let calls = 0
    const cached = createMeasuredLayoutCache(input => { calls++; return compute(input) })
    let graph = measured()
    if (kind === 'compound') graph = { ...graph,
      nodes: graph.nodes.map(node => ({ ...node, parent: 0 })),
      groups: [{ id: 'scope', minWidth: 200, padding: { top: 40, right: 20, bottom: 20, left: 20 } }],
    }
    if (kind === 'shared fan') graph = { ...graph, shareCompleteFans: true,
      edges: [0, 1].flatMap(source => [2, 3].map(target => ({ source, target, minSpan: 1 }))),
    }
    const first = cached(graph), expected = structuredClone(first)
    first.nodes[0]!.x = 99999
    first.edges[0]!.points[0]!.y = -99999
    if (first.edges[0]!.labelPosition) first.edges[0]!.labelPosition!.x = 99999
    if (first.groups) first.groups[0]!.width = 99999
    if (first.sharedEdges) (first.sharedEdges as number[]).push(99999)
    const second = cached(structuredClone(graph))
    expect(calls).toBe(1)
    expect(second).toEqual(expected)
    second.edges[0]!.points.push({ x: -1, y: -1 })
    expect(cached(graph)).toEqual(expected)
    expect(calls).toBe(1)
  })

  test('includes measured constraints and private solver options and never retains failed computations', () => {
    let calls = 0
    const cached = createMeasuredLayoutCache(input => { calls++; return compute(input) })
    const graph = measured()
    cached(graph)
    const variants: MeasuredGraph[] = [
      { ...graph, direction: 'LR' }, { ...graph, nodeSpacing: 41 }, { ...graph, layerSpacing: 61 },
      { ...graph, compactPrivateRanks: true }, { ...graph, authoredCycleOrder: true },
      { ...graph, nodes: graph.nodes.map((node, i) => i ? node : { ...node, width: 81 }) },
      { ...graph, edges: graph.edges.map((edge, i) => i ? edge : { ...edge, label: { width: 51, height: 16 } }) },
      { ...graph, edges: graph.edges.map((edge, i) => i ? edge : { ...edge, minSpan: 2 }) },
    ]
    for (const variant of variants) expect(cached(variant)).toEqual(compute(variant))
    expect(calls).toBe(1 + variants.length)
    for (const width of [NaN, Infinity, -Infinity, 0]) {
      const invalid = { ...graph, nodes: graph.nodes.map((node, i) => i ? node : { ...node, width }) }
      expect(() => cached(invalid)).toThrow()
      expect(() => cached(invalid)).toThrow()
    }
    expect(calls).toBe(1 + variants.length + 8)
    expect(cached(graph)).toEqual(compute(graph))
    expect(calls).toBe(1 + variants.length + 8)
  })

  test('evicts old measured graphs while preserving recent caller-owned geometry', () => {
    let calls = 0
    const cached = createMeasuredLayoutCache(input => { calls++; return compute(input) })
    const graphs = Array.from({ length: 65 }, (_, index) => {
      const graph = measured()
      return { ...graph, nodes: graph.nodes.map((node, position) => position ? node : { ...node, id: `item${index}` }) }
    })
    for (const graph of graphs) cached(graph)
    const recent = cached(graphs.at(-1)!)
    expect(calls).toBe(65)
    expect(recent).toEqual(compute(graphs.at(-1)!))
    expect(cached(graphs[0]!)).toEqual(compute(graphs[0]!))
    expect(calls).toBe(66)
  })

  test.each(['0', '1'])('honors the common startup cache switch %s', setting => {
    const child = Bun.spawnSync([process.execPath, '-e', `
      const { createMeasuredLayoutCache } = await import('./src/layout/agentic-producer-core.ts')
      let calls = 0
      const cached = createMeasuredLayoutCache(() => { calls++; return { topology: 'layered', width: 0, height: 0, nodes: [], edges: [] } })
      const graph = { nodes: [], edges: [], direction: 'TB', padding: 0, nodeSpacing: 0, layerSpacing: 0 }
      cached(graph); cached(graph)
      console.log(calls)
    `], { cwd: resolve(import.meta.dir, '../..'), env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: setting }, stdout: 'pipe', stderr: 'pipe' })
    expect(child.exitCode).toBe(0)
    expect(child.stdout.toString().trim()).toBe(setting === '0' ? '2' : '1')
  })
})
