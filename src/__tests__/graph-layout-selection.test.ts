import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { layoutMermaidWithReceipt, verifyMermaid } from '../agent/core.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/index.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { runCli } from '../cli/index.ts'
import { measureQuality } from '../agent/quality.ts'
import { convertToElkFormat, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid as parseFlowchart } from '../parser.ts'
import { clearElkLayoutCache } from '../elk-instance.ts'
import { renderMermaidSVGWithReceipt, GraphLayoutUnsupportedError } from '../index.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { resolveRenderRequest, validateSerializableRenderOptions } from '../render-contract.ts'
import { captureCli } from './helpers/cli-capture.ts'
import { flowchartMultigraph, flowchartSubgraphs } from '../../eval/shared/graph-fixtures.ts'
import { generatedFlowchartSamples } from '../../eval/layout-compare/generated.ts'

const SOURCE = 'flowchart TD\n A[Start] --> B[Finish]'
const ELK = { graphLayout: { backend: 'elk' as const } }
const FALLBACK = { graphLayout: { backend: 'elk' as const, fallback: 'none' as const } }
// A sibling edge still materializes private ranks; ancestor prefixes do not.
const RANK_CAP_SOURCE = `flowchart LR\n A[Source]\n B[Target]\n A ${'-'.repeat(2049)}> B`
const GROUP_PATHS = ['A0 --> B4', 'A1 --> B2', 'A2 --> B0', 'A3 --> B3', 'A4 --> B1',
  'B0 --> C1', 'B1 --> C3', 'B2 --> C0', 'B3 --> C4', 'B4 --> C2']
const groupPaths = (direction: string, edited = false) => `flowchart ${direction}\n` + ['A', 'B', 'C'].map(group =>
  `subgraph Group${group}[Group ${group}]\n` + Array.from({ length: 5 }, (_, i) => `${group}${i}[${edited && group === 'A' && i === 0 ? 'Edited A0' : group + i}]`).join('\n') + '\nend').join('\n') + '\n' + GROUP_PATHS.join('\n')

describe('checked graph layout selection', () => {
  test.each(['LR', 'RL'].flatMap(direction => [false, true].map(edited => ({ direction, edited }))))('aligns complete paths across flat groups in $direction (edited=$edited)', ({ direction, edited }) => {
    const source = groupPaths(direction, edited)
    const result = layoutMermaidWithReceipt(source, ELK)
    const quality = measureQuality(result.layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.routeGeometry?.bends).toBe(0)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(result.layout.nodes).toHaveLength(15)
    expect(result.layout.edges.map(edge => `${edge.from} --> ${edge.to}`)).toEqual(GROUP_PATHS)
    for (const group of ['A', 'B', 'C']) expect(result.layout.groups.find(scope => scope.id === `Group${group}`)!.members.slice().sort()).toEqual(Array.from({ length: 5 }, (_, i) => group + i))
    expect(renderMermaidSVGWithReceipt(source, ELK).receipt.layoutCertification?.status).toBe('passed')
  })

  test.each(['preserve-order', 'hints', 'local-direction', 'partial', 'labelled', 'cycle', 'scope-cycle'] as const)('retains scoped ordering constraints for %s', mode => {
    let source = groupPaths('LR')
    if (mode === 'local-direction') source = source.replace('subgraph GroupB[Group B]', 'subgraph GroupB[Group B]\ndirection TB')
    if (mode === 'partial') source = source.replace('A0 --> B4', '')
    if (mode === 'labelled') source = source.replace('A0 --> B4', 'A0 -->|keep caption| B4')
    if (mode === 'cycle') source += '\nC0 --> A1'
    if (mode === 'scope-cycle') source = source.replace('A0 --> B4', 'B4 --> A0').replace('B4 --> C2', 'A0 --> C2')
    const graph = parseFlowchart(source), before = structuredClone(graph)
    const options = mode === 'preserve-order' ? { preserveSubgraphChildOrder: true } : mode === 'hints' ? { layoutHints: { adjacent: [['B3', 'B2']] } } : {}
    const result = convertToElkFormat(graph, options)
    expect(result.children!.find(node => node.id === 'GroupB')!.children!.map(node => node.id)).toEqual(mode === 'hints' ? ['B0', 'B1', 'B3', 'B2', 'B4'] : ['B0', 'B1', 'B2', 'B3', 'B4'])
    expect(graph).toEqual(before)
  })

  test('admits only closed, nonredundant selection objects and normalizes fallback', () => {
    for (const graphLayout of [{ backend: 'agentic' }, { backend: 'other' }, { backend: 'elk', fallback: 'elk' }, { backend: 'elk', fallback: 'other' }, { backend: 'elk', hidden: true }]) {
      expect(validateSerializableRenderOptions({ graphLayout }).length).toBeGreaterThan(0)
      expect(() => resolveRenderRequest(SOURCE, { graphLayout } as never)).toThrow()
    }
    const omitted = resolveRenderRequest(SOURCE, ELK)
    const explicit = resolveRenderRequest(SOURCE, { graphLayout: { backend: 'elk', fallback: 'none' } })
    expect(omitted.renderOptions.graphLayout).toEqual({ backend: 'elk', fallback: 'none' })
    expect(omitted.sharedRequestDigest).toBe(explicit.sharedRequestDigest)
    expect(Object.isFrozen(omitted.renderOptions.graphLayout)).toBe(true)
  })

  test('preserves default ELK bytes and exposes the selected kernel across source, parsed and layout calls', () => {
    const baseline = renderMermaidSVGWithReceipt(SOURCE)
    const elk = renderMermaidSVGWithReceipt(SOURCE, { graphLayout: { backend: 'elk' } })
    expect(elk.svg).toBe(baseline.svg)
    expect(baseline.receipt.layoutDecisions).toBeUndefined()
    expect(elk.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'elk', selected: 'elk', fallback: 'none', role: 'primary' })])
    const parsed = parseMermaid(SOURCE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('fixture must parse')
    const stages: string[] = []
    const source = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(SOURCE, ELK))
    const fromParsed = renderMermaidSVGWithReceipt(parsed.value, ELK)
    const layout = layoutMermaidWithReceipt(SOURCE, ELK)
    expect(source.svg).toBe(fromParsed.svg)
    expect(source.receipt.layoutDecisions).toEqual(layout.receipt.layoutDecisions)
    expect(source.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'elk', selected: 'elk', fallback: 'none', role: 'primary', attempts: [{ backend: 'elk', outcome: 'selected' }] })])
    expect(source.svg).toContain('Start')
    expect(source.svg).toContain('Finish')
    const png = renderMermaidPNGWithReceipt(SOURCE, ELK)
    expect(png.receipt.layoutDecisions).toEqual(source.receipt.layoutDecisions)
    expect(png.png.length).toBeGreaterThan(0)
  })

  test.each(['TD', 'LR'] as const)('keeps an incomplete ternary tree crossing-free after all geometry passes in %s', direction => {
    const source = `flowchart ${direction}\n` + Array.from({ length: 299 }, (_, index) => {
      const parent = Math.floor(index / 3)
      return `n${parent}[Node ${parent}] --> n${index + 1}[Node ${index + 1}]`
    }).join('\n')
    const result = layoutMermaidWithReceipt(source, { ...ELK, debug: true })
    const quality = measureQuality(result.layout)
    expect(quality.nodeCount).toBe(300)
    expect(quality.edgeCount).toBe(299)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk' })])
    JSON.stringify(result.receipt)
  })

  test.each([
    { seed: 40, nodes: 9, edges: 23, from: 'n3', to: 'n7', labels: ['edge 4 xxxxxxx', 'edge 8 xxxxxxxxxxx'] },
    { seed: 156, nodes: 8, edges: 18, from: 'n0', to: 'n5', labels: ['edge 0 xxx', 'edge 12 xxxxxxxxxxxxxxx', 'edge 16 xxxxxxxxxxxxxxxxxxx'] },
  ].flatMap(sample => ['TD', 'BT', 'LR', 'RL'].map(direction => ({ ...sample, direction }))))('retains labelled duplicates without displacing safe captions in ELK cycle $seed in $direction', ({ seed, nodes, edges, from, to, labels, direction }) => {
    const source = generatedFlowchartSamples({ start: seed, count: 1 })[0]!.source.replace('flowchart TD', `flowchart ${direction}`)
    const options = { graphLayout: { backend: 'elk' as const }, ...(seed === 40 ? { layoutSafety: 'strict' as const } : {}) }
    const svg = renderMermaidSVGWithReceipt(source, options)
    const result = layoutMermaidWithReceipt(source, { ...options, debug: true })
    expect(result.layout.nodes).toHaveLength(nodes)
    expect(result.layout.edges).toHaveLength(edges)
    const parallel = result.layout.edges.filter(edge => edge.from === from && edge.to === to)
    expect(parallel).toHaveLength(labels.length)
    expect(parallel[0]!.path).not.toEqual(parallel[1]!.path)
    expect(measureQuality(result.layout).labelConflicts?.labelLabel).toBe(0)
    if (seed === 40) {
      expect(measureQuality(result.layout).labelConflicts?.total).toBe(0)
      expect(svg.receipt.layoutCertification?.status).toBe('passed')
    }
    for (const label of labels) expect(svg.svg).toContain(label)
    expect(svg.receipt.layoutCertification?.status).not.toBe('failed')
    expect(svg.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
  })

  test.each(['TD', 'LR', 'BT', 'RL'].flatMap(direction => [
    { direction, links: 'A & B --> C & D', ids: ['A', 'B', 'C', 'D'], facts: ['A->C', 'A->D', 'B->C', 'B->D'] },
    { direction, links: 'A & B --> C', ids: ['A', 'B', 'C'], facts: ['A->C', 'B->C'] },
    { direction, links: 'A --> B & C', ids: ['A', 'B', 'C'], facts: ['A->B', 'A->C'] },
  ]))('routes a complete rectangular fan net $links without extra crossings in $direction', ({ direction, links, ids, facts }) => {
    const source = `---\ntitle: Complete fan\n---\nflowchart ${direction}\n${links}`
    const svg = renderMermaidSVGWithReceipt(source, ELK)
    const layout = layoutMermaidWithReceipt(source, { ...ELK, debug: true })
    const reference = layoutMermaidWithReceipt(source, { graphLayout: { backend: 'elk' }, debug: true })
    expect(layout.layout.nodes.map(node => node.id).sort()).toEqual(ids)
    expect(layout.layout.edges.map(edge => `${edge.from}->${edge.to}`).sort()).toEqual(facts)
    const quality = measureQuality(layout.layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.routeOverlaps).toEqual({ opposing: 0, parallel: 0 })
    expect(quality.labelConflicts?.total).toBe(0)
    expect(svg.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
    JSON.stringify(svg.receipt)
    JSON.stringify(layout.receipt)
  })

  test.each<{ nodes: number; edges: number; source: string; crossings?: number; reducedRoute?: { from: string; to: string; label: string } }>([
    { nodes: 11, edges: 24, crossings: 3, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-11.mmd', import.meta.url), 'utf8') },
    { nodes: 10, edges: 20, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-10.mmd', import.meta.url), 'utf8') },
    { nodes: 15, edges: 31, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-15.mmd', import.meta.url), 'utf8') },
    { nodes: 19, edges: 44, crossings: 37, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-19.mmd', import.meta.url), 'utf8') },
    { nodes: 13, edges: 31, crossings: 7, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-13.mmd', import.meta.url), 'utf8') },
    { nodes: 15, edges: 34, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-15-chains.mmd', import.meta.url), 'utf8') },
    { nodes: 9, edges: 23, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-9-chains.mmd', import.meta.url), 'utf8'), reducedRoute: { from: 'n1', to: 'n8', label: 'edge 0 xxx' } },
  ])('retains authored cyclic $nodes-node labelled multigraph occurrences', ({ source, nodes, edges, crossings, reducedRoute }) => {
    const titledSource = '---\ntitle: Cyclic routes\n---\n' + source
    const svg = renderMermaidSVGWithReceipt(titledSource, ELK)
    const native = layoutMermaidWithReceipt(titledSource, { ...ELK, debug: true })
    const quality = measureQuality(native.layout)
    expect(quality.nodeCount).toBe(nodes)
    expect(quality.edgeCount).toBe(edges)
    if (crossings !== undefined) expect(quality.edgeCrossings).toBeLessThanOrEqual(crossings)
    expect(quality.routeOverlaps?.opposing).toBe(0)
    expect(svg.receipt.layoutCertification?.status).toBe('passed')
    const model = parseFlowchart(source)
    expect(native.layout.nodes.map(node => node.id).sort()).toEqual([...model.nodes.keys()].sort())
    expect(native.layout.edges.map(edge => [edge.from, edge.to, edge.label?.text ?? null])).toEqual(model.edges.map(edge => [edge.source, edge.target, edge.label ?? null]))
    if (reducedRoute) {
      const edge = native.layout.edges.find(edge => edge.from === reducedRoute.from && edge.to === reducedRoute.to && edge.label?.text === reducedRoute.label)!
      const target = native.layout.nodes.find(node => node.id === edge.to)!
      // The label helper's offset needs no extra return step: keep the exact
      // allocated diamond contact and carry the caption on a three-leg route.
      expect(edge.path).toHaveLength(4)
      expect(edge.path.at(-1)![0]).toBeCloseTo(target.x + target.w * 3 / 4, 8)
      expect(edge.path.at(-1)![1]).toBeCloseTo(target.y + target.h / 4, 8)
      expect(edge.route).toMatchObject({ targetPortAssignment: { side: 'E', slotIndex: 0, slotCount: 3, port: 'NE' } })
      expect(Math.abs(edge.label!.y - edge.path.at(-1)![1])).toBeLessThan(edge.label!.bounds!.h / 2)
      const sibling = native.layout.edges.find(peer => peer.from === edge.from && peer.to === edge.to && peer !== edge)!
      expect(edge.path.at(-1)).not.toEqual(sibling.path.at(-1))
    }
    expect(svg.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
    JSON.stringify(svg.receipt)
    JSON.stringify(native.receipt)
  })


  test.each(['TD', 'BT', 'LR', 'RL'] as const)('retains the nine-node labelled graph meaning in %s', direction => {
    const source = readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-9.mmd', import.meta.url), 'utf8').replace(/^flowchart BT/, `flowchart ${direction}`)
    const model = parseFlowchart(source)
    const result = layoutMermaidWithReceipt(source, { ...ELK, debug: true })
    expect(result.layout.nodes).toHaveLength(9)
    expect(result.layout.edges).toHaveLength(21)
    expect(result.layout.nodes.map(node => node.id).sort()).toEqual([...model.nodes.keys()].sort())
    expect(result.layout.edges.map(edge => [edge.from, edge.to, edge.label?.text ?? null])).toEqual(
      model.edges.map(edge => [edge.source, edge.target, edge.label ?? null]),
    )
    if (direction === 'BT') {
      // The narrow route needs a clear channel beside the wide n6→n3 caption.
      // Both relationships must remain traceable. Bundling keeps a fan's
      // separate routes when its trunk would add crossings, and that accepted
      // trade-off costs this graph one crossing (5 → 6).
      const quality = measureQuality(result.layout)
      expect(quality.edgeCrossings).toBeLessThanOrEqual(6)
      expect(quality.labelConflicts?.labelEdge).toBe(0)
    }
    expect(result.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
  })

  test.each([
    ...[171, 217, 228, 296, 319].map(seed => ({ seed, generator: 'lcg-v1' as const })),
    { seed: 22, generator: 'sha256-counter-v1' as const },
  ])('retains authored long-edge occurrences for development $generator seed $seed', ({ seed, generator }) => {
    const source = generatedFlowchartSamples({ start: seed, count: 1 }, generator)[0]!.source
    const rendered = renderMermaidSVGWithReceipt(source, ELK)
    const native = layoutMermaidWithReceipt(source, { ...ELK, debug: true })
    const quality = measureQuality(native.layout)
    expect(quality.nodeCount).toBe(8 + seed % 13)
    expect(quality.edgeCount).toBe(2 * quality.nodeCount + seed % 7)
    const model = parseFlowchart(source)
    expect(native.layout.nodes.map(node => node.id).sort()).toEqual([...model.nodes.keys()].sort())
    expect(native.layout.edges.map(edge => [edge.from, edge.to, edge.label?.text ?? null])).toEqual(model.edges.map(edge => [edge.source, edge.target, edge.label ?? null]))
    expect(rendered.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
    JSON.stringify(rendered.receipt)
    JSON.stringify(native.receipt)
  })

  test.each(['elk'] as const)('contains wide nested headers in %s without changing frame endpoints', async backend => {
    const source = await Bun.file(new URL('../../eval/layout-compare/fixtures/nested-wide-titles.mmd', import.meta.url)).text()
    const options = { graphLayout: { backend } }
    const rendered = renderMermaidSVGWithReceipt(source, options)
    const { layout, receipt } = layoutMermaidWithReceipt(source, { ...options, debug: true })
    expect(layout.groups).toHaveLength(3)
    expect(layout.nodes).toHaveLength(4)
    expect(layout.edges).toHaveLength(3)
    for (const group of layout.groups.filter(group => group.parentId)) {
      const parent = layout.groups.find(parent => parent.id === group.parentId)!
      expect(group.x).toBeGreaterThanOrEqual(parent.x)
      expect(group.y).toBeGreaterThanOrEqual(parent.y)
      expect(group.x + group.w).toBeLessThanOrEqual(parent.x + parent.w)
      expect(group.y + group.h).toBeLessThanOrEqual(parent.y + parent.h)
    }
    expect(layout.edges.some(edge => edge.from === 'entry' && edge.to === 'Inner')).toBe(true)
    expect(layout.edges.some(edge => edge.from === 'Inner' && edge.to === 'done')).toBe(true)
    expect(rendered.svg).toContain('A nested heading much wider than its leaf nodes')
    expect(rendered.svg).toContain('Another heading wider than a and b')
    expect(measureQuality(layout).labelConflicts?.total).toBe(0)
    expect(receipt.layoutDecisions?.[0]?.selected).toBe(backend)
    JSON.stringify(rendered.receipt)
    JSON.stringify(receipt)
  })

  test.each(['TD', 'LR'] as const)('certifies mixed shape outlines, labelled branches and markers in %s', direction => {
    const source = `flowchart ${direction}\nA([Start]) --> B{Choose}\nB -->|yes| C[(Database)]\nB -->|no| D((End))\nD --> E[[Audit]]`
    const stages: string[] = []
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, ELK))

    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk' })])
    expect(layoutGraphSync(parseFlowchart(source), ELK).certification).toMatchObject({ status: 'passed', hardViolations: 0 })
    for (const label of ['Start', 'Choose', 'Database', 'End', 'Audit', 'yes', 'no']) expect(result.svg).toContain(label)
    JSON.stringify(result.receipt)
  })

  test.each([
    { name: 'labelled reciprocal cycles and loops', source: 'flowchart LR\nA[Send] -->|request| B[Process]\nB -->|retry| A\nB --> C[Commit]\nC --> A\nA -->|repeat| A\nA --> A\nC -->|wait| C', nodes: 3, edges: 7, labels: ['Send', 'Process', 'Commit', 'request', 'retry', 'repeat', 'wait'] },
    { name: 'interacting loop and parallel corridors', source: flowchartMultigraph(24), nodes: 24, edges: 75, labels: ['Node 0', 'Node 23', 'transition 0', 'transition 68'] },
  ])('renders $name with ELK and preserves graph certification', ({ source, nodes, edges, labels }) => {
    const stages: string[] = []
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, ELK))

    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', attempts: [{ backend: 'elk', outcome: 'selected' }] })])
    for (const label of labels) expect(result.svg).toContain(label)
    const positioned = layoutMermaidWithReceipt(source, { ...ELK, debug: true })
    const native = measureQuality(positioned.layout)
    const model = parseFlowchart(source)
    expect(positioned.layout.edges.map(edge => [edge.from, edge.to, edge.label?.text ?? null])).toEqual(model.edges.map(edge => [edge.source, edge.target, edge.label ?? null]))
    expect(native.nodeCount).toBe(nodes)
    expect(native.edgeCount).toBe(edges)
    expect(native.routeOverlaps?.opposing).toBe(0)
    JSON.stringify(result.receipt)
  }, 60000)

  test.each(['TD', 'LR', 'BT', 'RL'])('retains State pseudostates, configured bars and notes with ELK in %s', direction => {
    const source = `stateDiagram-v2\ndirection ${direction}\nstate F <<fork>>\nstate J <<join>>\nstate C <<choice>>\n[*] --> F\nF --> A\nF --> B\nA --> J\nB --> J\nJ --> C\nC --> A: retry\nC --> [*]: done\nnote right of A : keep this note`
    const options = { ...ELK, mermaidConfig: { state: { forkWidth: 120, forkHeight: 24, fontSize: 22, noteMargin: 50 } } }
    const stages: string[] = []
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, options))
    const rendered = layoutMermaidWithReceipt(source, { ...options, debug: true })
    const bars = rendered.layout.nodes.filter(node => node.id === 'F' || node.id === 'J')
    expect(bars).toHaveLength(2)
    for (const bar of bars) expect([Number(bar.w), Number(bar.h)]).toEqual(direction === 'LR' || direction === 'RL' ? [24, 120] : [120, 24])

    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', attempts: [{ backend: 'elk', outcome: 'selected' }] })])
    for (const text of ['keep this note', 'retry', 'done', 'font-size="22"']) expect(result.svg).toContain(text)
    const quality = measureQuality(rendered.layout)
    expect(quality.minimumNodeSpacing).toBeGreaterThanOrEqual(0)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(result.svg).toBe(renderMermaidSVGWithReceipt(source, options).svg)
    JSON.stringify(result.receipt)
    JSON.stringify(rendered.receipt)
  })

  test.each([
    { name: 'disconnected fan-out', source: 'flowchart TD\nn58 --> n66\nn58 --> n70\nn29 -->|label 37| n16\nn113 -->|label 38| n16', nodes: 6, edges: 4, parallel: undefined },
    { name: 'duplicate lanes', source: 'flowchart BT\nn0 --> n6\nn0 -->|edge 4 xxxxxxx| n2\nn0 --> n6', nodes: 3, edges: 3, parallel: ['n0', 'n6'] },
  ])('retains separate label corridors beside $name', ({ source, nodes, edges, parallel }) => {
    // Reduced public counterexamples: a shared routing proposal must not
    // replace clear native corridors with crossings through a foreign pill.
    const result = layoutMermaidWithReceipt(source, { ...ELK, debug: true })
    const quality = measureQuality(result.layout)
    expect(quality.nodeCount).toBe(nodes)
    expect(quality.edgeCount).toBe(edges)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.labelConflicts?.total).toBe(0)
    if (parallel) {
      const routes = result.layout.edges.filter(edge => edge.from === parallel[0] && edge.to === parallel[1])
      expect(routes).toHaveLength(2)
      expect(routes[0]!.path).not.toEqual(routes[1]!.path)
    }
    JSON.stringify(result.receipt)
  })

  test.each([
    { name: 'nested frames and directions', source: 'flowchart LR\nsubgraph Outer[A wide outer title]\n direction TB\n subgraph Left[Stage One]\n  direction RL\n  A([Begin]) -->|within| B\n end\n subgraph Right[Stage Two]\n  direction BT\n  C --> D{Finish}\n end\n Left -->|handoff| Right\nend\nStart --> Outer --> Done', nodes: 6, groups: 3, edges: 5, frame: 'Outer' },
    { name: 'State composites and notes', source: 'stateDiagram-v2\ndirection LR\nstate Composite {\n direction BT\n [*] --> A\n A --> [*]: finish\n note right of A : inner note\n}\n[*] --> Composite\nComposite --> Done\nDone --> [*]', nodes: 6, groups: 1, edges: 5, frame: 'Composite' },
    { name: 'concurrent regions with reciprocal labels', source: 'stateDiagram-v2\n[*] --> Active\nstate Active {\n [*] --> NumLockOff\n NumLockOff --> NumLockOn : EvNumLockPressed\n NumLockOn --> NumLockOff : EvNumLockPressed\n note right of NumLockOff : inner note\n --\n [*] --> CapsLockOff\n CapsLockOff --> CapsLockOn : EvCapsLockPressed\n CapsLockOn --> CapsLockOff : EvCapsLockPressed\n --\n [*] --> ScrollLockOff\n ScrollLockOff --> ScrollLockOn : EvScrollLockPressed\n ScrollLockOn --> ScrollLockOff : EvScrollLockPressed\n}', nodes: 10, groups: 4, edges: 10, frame: 'Active' },
  ])('retains $name without flattening frame endpoints', ({ source, nodes, groups, edges, frame: frameId }) => {
    const stages: string[] = []
    const svg = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, ELK))
    const result = layoutMermaidWithReceipt(source, { ...ELK, debug: true })

    expect(result.layout.nodes).toHaveLength(nodes)
    expect(result.layout.groups).toHaveLength(groups)
    expect(result.layout.edges).toHaveLength(edges)
    const frame = result.layout.groups.find(group => group.id === frameId)!
    const entering = result.layout.edges.find(edge => edge.to === frame.id)!
    expect(entering.to).toBe(frame.id)
    const [x, y] = entering.path.at(-1)!
    expect(Math.min(Math.abs(x - frame.x), Math.abs(x - frame.x - frame.w), Math.abs(y - frame.y), Math.abs(y - frame.y - frame.h))).toBeLessThan(0.5)
    expect(x).toBeGreaterThanOrEqual(frame.x - 0.5)
    expect(x).toBeLessThanOrEqual(frame.x + frame.w + 0.5)
    expect(y).toBeGreaterThanOrEqual(frame.y - 0.5)
    expect(y).toBeLessThanOrEqual(frame.y + frame.h + 0.5)
    if (groups === 3) {
      expect(result.layout.groups.find(group => group.id === 'Left')).toMatchObject({ parentId: 'Outer', members: ['A', 'B'] })
      expect(result.layout.groups.find(group => group.id === 'Right')).toMatchObject({ parentId: 'Outer', members: ['C', 'D'] })
      expect(svg.svg).toContain('handoff')
    } else expect(svg.svg).toContain('inner note')
    const quality = measureQuality(result.layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(quality.routeOverlaps?.opposing).toBe(0)
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk' })])
    expect(layoutGraphSync(parseFlowchart(source), ELK).certification).toMatchObject({ status: 'passed', hardViolations: 0 })
    JSON.stringify(svg.receipt)
    JSON.stringify(result.receipt)
  })

  test.each([
    ['Flowchart', 'flowchart TB\nsubgraph One[Team One]\n A[Source] --> B[Review]\nend\nsubgraph Two[Team Two]\n C[Target] --> D[Finish]\nend\nB -->|handoff| C'],
    ['State', 'stateDiagram-v2\nstate One {\nA --> B\n}\nstate Two {\nC --> D\n}\nB --> C : handoff'],
  ])('preserves %s cross-scope leaf relationships across public surfaces', (_family, source) => {
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error('cross-scope example must parse')
    const stages: string[] = []
    const svg = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, ELK))
    const result = layoutMermaidWithReceipt(source, ELK)

    expect(result.layout.nodes.map(node => node.id).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(result.layout.groups.map(group => [group.id, group.members])).toEqual([['One', ['A', 'B']], ['Two', ['C', 'D']]])
    expect(result.layout.edges.map(edge => [edge.from, edge.to]).sort()).toEqual([['A', 'B'], ['C', 'D'], ['B', 'C']].sort())
    expect(svg.svg).toContain('handoff')
    expect(svg.receipt.layoutCertification?.status).toBe('passed')
    expect(renderMermaidSVGWithReceipt(parsed.value, ELK).svg).toBe(svg.svg)
    expect(renderMermaidPNGWithReceipt(source, ELK).receipt.layoutDecisions).toEqual(svg.receipt.layoutDecisions)
    expect(result.receipt.layoutDecisions).toEqual(svg.receipt.layoutDecisions)
    expect(renderMermaidASCIIWithReceipt(source, ELK).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', role: 'companion' })])
    const quality = measureQuality(result.layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(quality.routeOverlaps).toMatchObject({ opposing: 0, parallel: 0 })
  })


  test('retains large grouped graph meaning across ELK and terminal projections', () => {
    const source = flowchartSubgraphs(12, 8)
    const model = parseFlowchart(source)
    const svg = renderMermaidSVGWithReceipt(source, ELK)
    const result = layoutMermaidWithReceipt(source, ELK)
    expect(result.layout.nodes).toHaveLength(96)
    expect(result.layout.nodes.map(node => node.id).sort()).toEqual([...model.nodes.keys()].sort())
    expect(result.layout.groups).toHaveLength(12)
    expect(result.layout.groups.every(group => group.members.length === 8)).toBe(true)
    expect(result.layout.groups.map(group => [group.id, [...group.members].sort()]).sort()).toEqual(
      model.subgraphs.map(group => [group.id, [...group.nodeIds].sort()]).sort(),
    )
    expect(result.layout.edges.map(edge => [edge.from, edge.to, edge.label?.text ?? null]).sort()).toEqual(
      model.edges.map(edge => [edge.source, edge.target, edge.label ?? null]).sort(),
    )
    expect(svg.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', role: 'primary' })])
    expect(result.receipt.layoutDecisions).toEqual(svg.receipt.layoutDecisions)
    const terminal = renderMermaidASCIIWithReceipt(source, ELK)
    expect(terminal.text.length).toBeGreaterThan(0)
    expect(terminal.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', role: 'companion' })])
  })

  test.each(['TB', 'BT', 'LR', 'RL'] as const)('routes to and from a nested frame in %s without substituting a child', direction => {
    for (const [from, to] of [['Outside', 'Inner'], ['Inner', 'Outside']]) {
      const source = `flowchart ${direction}\nsubgraph Outer\n subgraph Inner\n  A --> B\n end\nend\n${from} --> ${to}`
      const rendered = renderMermaidSVGWithReceipt(source, ELK)
      const result = layoutMermaidWithReceipt(source, { ...ELK, debug: true })
      expect(result.layout.edges).toHaveLength(2)
      expect(result.layout.edges.find(edge => edge.from === from && edge.to === to)).toBeDefined()
      expect(result.layout.groups.find(group => group.id === 'Inner')).toMatchObject({ parentId: 'Outer', members: ['A', 'B'] })
      expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk', fallback: 'none' })])
      expect(result.layout.paintCertification?.status).toBe('passed')
    }
  })

  test.each(['flowchart', 'state'].flatMap(family => ['TD', 'LR'].flatMap(direction => [
    { family, direction, from: 'Outer', to: 'A', label: 'enters' },
    { family, direction, from: 'A', to: 'Outer', label: 'returns' },
  ])))('retains an authored containing-frame contact $from->$to in $family $direction', ({ family, direction, from, to, label }) => {
    const source = family === 'flowchart' ? `flowchart ${direction}\nsubgraph Outer\n subgraph Inner\n  A --> B\n end\nend\n${from} -->|${label}| ${to}`
      : `stateDiagram-v2\n direction ${direction === 'TD' ? 'TB' : direction}\nstate Outer {\n state Inner {\n  A --> B\n }\n}\n${from} --> ${to} : ${label}`
    const stages: string[] = []
    const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, ELK))

    expect(rendered.receipt.layoutDecisions?.[0]).toMatchObject({ selected: 'elk', fallback: 'none' })
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.svg).toContain(label)
    expect(renderMermaidSVGWithReceipt(source, ELK).svg).toBe(rendered.svg)
    const result = layoutMermaidWithReceipt(source, { ...ELK, debug: true })
    expect(result.layout.edges.map(edge => [edge.from, edge.to]).sort()).toEqual([['A', 'B'], [from, to]].sort())
    expect(result.layout.groups.find(group => group.id === 'Inner')).toMatchObject({ parentId: 'Outer', members: ['A', 'B'] })
    expect(result.layout.paintCertification?.status).toBe('passed')
  })


  test('rejects retired Native policies and retains the long-link source through ELK', () => {
    for (const graphLayout of [{ backend: 'agentic' }, { backend: 'elk', fallback: 'elk' }]) {
      expect(validateSerializableRenderOptions({ graphLayout }).length).toBeGreaterThan(0)
      expect(() => renderMermaidSVGWithReceipt(SOURCE, { graphLayout } as never)).toThrow()
    }
    const result = layoutMermaidWithReceipt(RANK_CAP_SOURCE, ELK)
    expect(result.layout.nodes.map(node => node.id).sort()).toEqual(['A', 'B'])
    expect(result.layout.edges.map(edge => [edge.from, edge.to])).toEqual([['A', 'B']])
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'elk', selected: 'elk', fallback: 'none', attempts: [{ backend: 'elk', outcome: 'selected' }] })])
  })

  test('keeps terminal-cell layout independent and classifies optional companion execution', () => {
    const source = 'classDiagram\n class Duck'
    const stages: string[] = []
    const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => {
      const value = renderMermaidASCIIWithReceipt(source, ELK)
      expect(value.text).toContain('Duck')
      JSON.stringify(value.receipt)
      return value
    })

    expect(rendered.text).toBe(renderMermaidASCIIWithReceipt(source).text)
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'elk', selected: 'elk', role: 'companion' })])
    const fallback = renderMermaidASCIIWithReceipt(source, FALLBACK)
    expect(fallback.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'elk', selected: 'elk', role: 'companion' })])
    const architecture = 'architecture-beta\ngroup g[Group]\n service a(server)[A] in g'
    const projected = renderMermaidASCIIWithReceipt(architecture, ELK)
    expect(projected.text).toContain('Group')
    expect(projected.receipt.layoutDecisions).toEqual([
      expect.objectContaining({ selected: 'elk', role: 'primary' }),
      expect.objectContaining({ selected: 'elk', role: 'companion' }),
    ])
  })

  test('diagnoses nonapplicable families without claiming graph execution', () => {
    const rendered = renderMermaidSVGWithReceipt('sequenceDiagram\n A->>B: Hello', ELK)
    expect(rendered.receipt.layoutDecisions).toBeUndefined()
    expect(rendered.receipt.diagnostics).toContainEqual(expect.objectContaining({ code: 'RENDER_OPTION_NOT_APPLICABLE', feature: 'render-option:graphLayout' }))
  })

  test('CLI convenience flags use the same checked graph option and receipt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-layout-'))
    const path = join(dir, 'diagram.mmd')
    try {
      writeFileSync(path, SOURCE)
      const result = captureCli(() => runCli(['render', path, '--graph-layout', 'elk', '--json']))
      expect(result.code).toBe(0)
      expect(JSON.parse(result.out).receipt.layoutDecisions[0]).toMatchObject({ requested: 'elk', selected: 'elk' })
      const invalid = captureCli(() => runCli(['render', path, '--graph-layout', 'elk', '--graph-layout-fallback', 'elk']))
      expect(invalid.code).toBe(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
