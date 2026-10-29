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
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid as parseFlowchart } from '../parser.ts'
import { clearElkLayoutCache } from '../elk-instance.ts'
import { renderMermaidSVGWithReceipt, GraphLayoutUnsupportedError } from '../index.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { resolveRenderRequest, validateSerializableRenderOptions } from '../render-contract.ts'
import { captureCli } from './helpers/cli-capture.ts'
import { flowchartMultigraph, flowchartSubgraphs } from '../../eval/shared/graph-fixtures.ts'
import { generatedFlowchartSamples } from '../../eval/layout-compare/generated.ts'

const SOURCE = 'flowchart TD\n A[Start] --> B[Finish]'
const AGENTIC = { graphLayout: { backend: 'agentic' as const } }
const FALLBACK = { graphLayout: { backend: 'agentic' as const, fallback: 'elk' as const } }
// A sibling edge still materializes private ranks; ancestor prefixes do not.
const RANK_CAP_SOURCE = `flowchart LR\n A[Source]\n B[Target]\n A ${'-'.repeat(2049)}> B`

describe('checked graph layout selection', () => {
  test('admits only closed, nonredundant selection objects and normalizes fallback', () => {
    for (const graphLayout of [{}, { backend: 'other' }, { backend: 'elk', fallback: 'elk' }, { backend: 'agentic', fallback: 'other' }, { backend: 'agentic', hidden: true }]) {
      expect(validateSerializableRenderOptions({ graphLayout }).length).toBeGreaterThan(0)
      expect(() => resolveRenderRequest(SOURCE, { graphLayout } as never)).toThrow()
    }
    const omitted = resolveRenderRequest(SOURCE, AGENTIC)
    const explicit = resolveRenderRequest(SOURCE, { graphLayout: { backend: 'agentic', fallback: 'none' } })
    expect(omitted.renderOptions.graphLayout).toEqual({ backend: 'agentic', fallback: 'none' })
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
    const source = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(SOURCE, AGENTIC))
    const fromParsed = renderMermaidSVGWithReceipt(parsed.value, AGENTIC)
    const layout = layoutMermaidWithReceipt(SOURCE, AGENTIC)
    expect(source.svg).toBe(fromParsed.svg)
    expect(source.receipt.layoutDecisions).toEqual(layout.receipt.layoutDecisions)
    expect(source.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'agentic', selected: 'agentic', fallback: 'none', role: 'primary', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
    expect(stages).not.toContain('elk')
    expect(source.svg).toContain('Start')
    expect(source.svg).toContain('Finish')
    const png = renderMermaidPNGWithReceipt(SOURCE, AGENTIC)
    expect(png.receipt.layoutDecisions).toEqual(source.receipt.layoutDecisions)
    expect(png.png.length).toBeGreaterThan(0)
  })

  test.each(['TD', 'LR'] as const)('keeps an incomplete ternary tree crossing-free after all geometry passes in %s', direction => {
    const source = `flowchart ${direction}\n` + Array.from({ length: 299 }, (_, index) => {
      const parent = Math.floor(index / 3)
      return `n${parent}[Node ${parent}] --> n${index + 1}[Node ${index + 1}]`
    }).join('\n')
    const result = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true })
    const quality = measureQuality(result.layout)
    expect(quality.nodeCount).toBe(300)
    expect(quality.edgeCount).toBe(299)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
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
    const svg = renderMermaidSVGWithReceipt(source, AGENTIC)
    const layout = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true })
    const reference = layoutMermaidWithReceipt(source, { graphLayout: { backend: 'elk' }, debug: true })
    expect(layout.layout.nodes.map(node => node.id).sort()).toEqual(ids)
    expect(layout.layout.edges.map(edge => `${edge.from}->${edge.to}`).sort()).toEqual(facts)
    const quality = measureQuality(layout.layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.edgeCrossings).toBeLessThanOrEqual(measureQuality(reference.layout).edgeCrossings)
    expect(quality.routeOverlaps).toEqual({ opposing: 0, parallel: 0 })
    expect(quality.labelConflicts?.total).toBe(0)
    expect(svg.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
    JSON.stringify(svg.receipt)
    JSON.stringify(layout.receipt)
  })

  test.each([
    { nodes: 11, edges: 24, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-11.mmd', import.meta.url), 'utf8') },
    { nodes: 10, edges: 20, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-10.mmd', import.meta.url), 'utf8') },
    { nodes: 15, edges: 31, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-15.mmd', import.meta.url), 'utf8') },
    { nodes: 19, edges: 44, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-19.mmd', import.meta.url), 'utf8') },
    { nodes: 13, edges: 31, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-13.mmd', import.meta.url), 'utf8') },
    { nodes: 15, edges: 34, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-15-chains.mmd', import.meta.url), 'utf8') },
    { nodes: 9, edges: 23, source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-9-chains.mmd', import.meta.url), 'utf8') },
  ])('reduces crossings in a cyclic $nodes-node labelled multigraph without merging routes', ({ source, nodes, edges }) => {
    const titledSource = '---\ntitle: Cyclic routes\n---\n' + source
    const svg = renderMermaidSVGWithReceipt(titledSource, AGENTIC)
    const native = layoutMermaidWithReceipt(titledSource, { ...AGENTIC, debug: true })
    const elk = layoutMermaidWithReceipt(titledSource, { graphLayout: { backend: 'elk' }, debug: true })
    const quality = measureQuality(native.layout)
    expect(quality.nodeCount).toBe(nodes)
    expect(quality.edgeCount).toBe(edges)
    expect(quality.edgeCrossings).toBeLessThanOrEqual(measureQuality(elk.layout).edgeCrossings)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(quality.routeOverlaps).toEqual({ opposing: 0, parallel: 0 })
    expect(svg.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
    JSON.stringify(svg.receipt)
    JSON.stringify(native.receipt)
  })

  test.each(['TD', 'BT', 'LR', 'RL'] as const)('reduces the nine-node crossing case without adding bends or losing native content in %s', direction => {
    const source = readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-9.mmd', import.meta.url), 'utf8').replace(/^flowchart BT/, `flowchart ${direction}`)
    const result = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true }), quality = measureQuality(result.layout)
    expect(quality.nodeCount).toBe(9)
    expect(quality.edgeCount).toBe(21)
    const reference = layoutMermaidWithReceipt(source, { graphLayout: { backend: 'elk' }, debug: true })
    expect(quality.edgeCrossings).toBeLessThanOrEqual(measureQuality(reference.layout).edgeCrossings)
    const bends = (layout: typeof result.layout) => layout.edges.reduce((sum, edge) => sum + Math.max(0, edge.path.length - 2), 0)
    expect(bends(result.layout)).toBeLessThanOrEqual(bends(reference.layout))
    expect(quality.labelConflicts?.total).toBe(0)
    expect(quality.routeOverlaps).toEqual({ opposing: 0, parallel: 0 })
    expect(result.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
  })

  test.each([
    ...[171, 217, 228, 296, 319].map(seed => ({ seed, generator: 'lcg-v1' as const })),
    { seed: 22, generator: 'sha256-counter-v1' as const },
  ])('retains clear long-edge ordering for development $generator seed $seed', ({ seed, generator }) => {
    const source = generatedFlowchartSamples({ start: seed, count: 1 }, generator)[0]!.source
    const rendered = renderMermaidSVGWithReceipt(source, AGENTIC)
    const native = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true })
    const reference = layoutMermaidWithReceipt(source, { graphLayout: { backend: 'elk' }, debug: true })
    const quality = measureQuality(native.layout)
    expect(quality.nodeCount).toBe(8 + seed % 13)
    expect(quality.edgeCount).toBe(2 * quality.nodeCount + seed % 7)
    expect(quality.edgeCrossings).toBeLessThanOrEqual(measureQuality(reference.layout).edgeCrossings)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(quality.routeOverlaps).toEqual({ opposing: 0, parallel: 0 })
    expect(rendered.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
    JSON.stringify(rendered.receipt)
    JSON.stringify(native.receipt)
  })

  test.each(['elk', 'agentic'] as const)('contains wide nested headers in %s without changing frame endpoints', async backend => {
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

  test.each(['TD', 'LR'] as const)('certifies mixed shape outlines, labelled branches and markers natively in %s', direction => {
    const source = `flowchart ${direction}\nA([Start]) --> B{Choose}\nB -->|yes| C[(Database)]\nB -->|no| D((End))\nD --> E[[Audit]]`
    const stages: string[] = []
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, AGENTIC))
    expect(stages).not.toContain('elk')
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
    expect(layoutGraphSync(parseFlowchart(source), AGENTIC).certification).toMatchObject({ status: 'passed', hardViolations: 0 })
    for (const label of ['Start', 'Choose', 'Database', 'End', 'Audit', 'yes', 'no']) expect(result.svg).toContain(label)
    JSON.stringify(result.receipt)
  })

  test.each([
    { name: 'labelled reciprocal cycles and loops', source: 'flowchart LR\nA[Send] -->|request| B[Process]\nB -->|retry| A\nB --> C[Commit]\nC --> A\nA -->|repeat| A\nA --> A\nC -->|wait| C', nodes: 3, edges: 7, labels: ['Send', 'Process', 'Commit', 'request', 'retry', 'repeat', 'wait'] },
    { name: 'interacting loop and parallel corridors', source: flowchartMultigraph(24), nodes: 24, edges: 75, labels: ['Node 0', 'Node 23', 'transition 0', 'transition 68'] },
  ])('renders $name without ELK and preserves graph certification', ({ source, nodes, edges, labels }) => {
    const stages: string[] = []
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, AGENTIC))
    expect(stages).not.toContain('elk')
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
    for (const label of labels) expect(result.svg).toContain(label)
    const native = measureQuality(layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true }).layout)
    const reference = measureQuality(layoutMermaidWithReceipt(source, { graphLayout: { backend: 'elk' }, debug: true }).layout)
    expect(native.nodeCount).toBe(nodes)
    expect(native.edgeCount).toBe(edges)
    expect(native.edgeCrossings).toBeLessThanOrEqual(reference.edgeCrossings)
    expect(native.labelConflicts?.total).toBe(0)
    expect(native.routeOverlaps?.opposing).toBe(0)
    expect(native.routeOverlaps?.parallel).toBeLessThanOrEqual(reference.routeOverlaps!.parallel)
    JSON.stringify(result.receipt)
  }, 60000)

  test.each(['TD', 'LR', 'BT', 'RL'])('retains State pseudostates, configured bars and notes without ELK in %s', direction => {
    const source = `stateDiagram-v2\ndirection ${direction}\nstate F <<fork>>\nstate J <<join>>\nstate C <<choice>>\n[*] --> F\nF --> A\nF --> B\nA --> J\nB --> J\nJ --> C\nC --> A: retry\nC --> [*]: done\nnote right of A : keep this note`
    const options = { ...AGENTIC, mermaidConfig: { state: { forkWidth: 120, forkHeight: 24, fontSize: 22, noteMargin: 50 } } }
    const stages: string[] = []
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, options))
    const rendered = layoutMermaidWithReceipt(source, { ...options, debug: true })
    const bars = rendered.layout.nodes.filter(node => node.id === 'F' || node.id === 'J')
    expect(bars).toHaveLength(2)
    for (const bar of bars) expect([Number(bar.w), Number(bar.h)]).toEqual(direction === 'LR' || direction === 'RL' ? [24, 120] : [120, 24])
    expect(stages).not.toContain('elk')
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
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
    const result = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true })
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
  ])('retains $name natively without flattening frame endpoints', ({ source, nodes, groups, edges, frame: frameId }) => {
    const stages: string[] = []
    const svg = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, AGENTIC))
    const result = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true })
    expect(stages).not.toContain('elk')
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
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
    expect(layoutGraphSync(parseFlowchart(source), AGENTIC).certification).toMatchObject({ status: 'passed', hardViolations: 0 })
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
    const svg = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, AGENTIC))
    const result = layoutMermaidWithReceipt(source, AGENTIC)
    expect(stages).not.toContain('elk')
    expect(result.layout.nodes.map(node => node.id).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(result.layout.groups.map(group => [group.id, group.members])).toEqual([['One', ['A', 'B']], ['Two', ['C', 'D']]])
    expect(result.layout.edges.map(edge => [edge.from, edge.to])).toEqual([['A', 'B'], ['C', 'D'], ['B', 'C']])
    expect(svg.svg).toContain('handoff')
    expect(svg.receipt.layoutCertification?.status).toBe('passed')
    expect(renderMermaidSVGWithReceipt(parsed.value, AGENTIC).svg).toBe(svg.svg)
    expect(renderMermaidPNGWithReceipt(source, AGENTIC).receipt.layoutDecisions).toEqual(svg.receipt.layoutDecisions)
    expect(result.receipt.layoutDecisions).toEqual(svg.receipt.layoutDecisions)
    expect(renderMermaidASCIIWithReceipt(source, AGENTIC).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'companion' })])
    const quality = measureQuality(result.layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(quality.routeOverlaps).toMatchObject({ opposing: 0, parallel: 0 })
  })

  test('routes the large grouped workload without a dense visibility grid or ELK', () => {
    const source = flowchartSubgraphs(12, 8)
    const model = parseFlowchart(source), stages: string[] = []
    const svg = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, AGENTIC))
    expect(stages).not.toContain('elk')
    const result = layoutMermaidWithReceipt(source, AGENTIC)
    expect(result.layout.nodes).toHaveLength(96)
    expect(result.layout.groups).toHaveLength(12)
    expect(result.layout.groups.every(group => group.members.length === 8)).toBe(true)
    expect(result.layout.edges.map(edge => [edge.from, edge.to])).toEqual(model.edges.map(edge => [edge.source, edge.target]))
    expect(svg.receipt.layoutCertification?.status).toBe('passed')
    const quality = measureQuality(result.layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.labelConflicts?.total).toBe(0)
    expect(quality.routeOverlaps).toMatchObject({ opposing: 0, parallel: 0 })
    const terminal = renderMermaidASCIIWithReceipt(source, AGENTIC)
    expect(terminal.text.length).toBeGreaterThan(0)
    expect(terminal.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'companion' })])
  })

  test.each(['TB', 'BT', 'LR', 'RL'] as const)('routes to and from a nested frame in %s without substituting a child', direction => {
    for (const [from, to] of [['Outside', 'Inner'], ['Inner', 'Outside']]) {
      const source = `flowchart ${direction}\nsubgraph Outer\n subgraph Inner\n  A --> B\n end\nend\n${from} --> ${to}`
      const rendered = renderMermaidSVGWithReceipt(source, AGENTIC)
      const result = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true })
      expect(result.layout.edges).toHaveLength(2)
      expect(result.layout.edges.find(edge => edge.from === from && edge.to === to)).toBeDefined()
      expect(result.layout.groups.find(group => group.id === 'Inner')).toMatchObject({ parentId: 'Outer', members: ['A', 'B'] })
      expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', fallback: 'none' })])
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
    const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, AGENTIC))
    expect(stages).not.toContain('elk')
    expect(rendered.receipt.layoutDecisions?.[0]).toMatchObject({ selected: 'agentic', fallback: 'none' })
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.svg).toContain(label)
    expect(renderMermaidSVGWithReceipt(source, AGENTIC).svg).toBe(rendered.svg)
    const result = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true })
    expect(result.layout.edges.map(edge => [edge.from, edge.to])).toEqual([['A', 'B'], [from, to]])
    expect(result.layout.groups.find(group => group.id === 'Inner')).toMatchObject({ parentId: 'Outer', members: ['A', 'B'] })
    expect(result.layout.paintCertification?.status).toBe('passed')
  })

  test('declines the explicit private-rank cap and attributes a requested ELK fallback consistently across cache states', () => {
    const compound = RANK_CAP_SOURCE
    expect(() => renderMermaidSVGWithReceipt(compound, AGENTIC)).toThrow(GraphLayoutUnsupportedError)
    clearElkLayoutCache()
    const diagnostics: unknown[] = []
    const options = { ...FALLBACK, onConfigDiagnostic: (value: unknown) => diagnostics.push(value) }
    const first = renderMermaidSVGWithReceipt(compound, options)
    const again = renderMermaidSVGWithReceipt(compound, options)
    expect(again.svg).toBe(first.svg)
    expect(again.receipt).toEqual(first.receipt)
    expect(first.receipt.layoutDecisions).toEqual([expect.objectContaining({
      requested: 'agentic', selected: 'elk', fallback: 'elk', role: 'primary',
      attempts: [expect.objectContaining({ backend: 'agentic', outcome: 'unsupported', reason: 'agentic local rank-expansion limit' }), { backend: 'elk', outcome: 'selected' }],
    })])
    expect(first.receipt.diagnostics).toContainEqual(expect.objectContaining({ code: 'GRAPH_LAYOUT_FALLBACK' }))
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]).toMatchObject({ field: 'graphLayout.backend', code: 'INEFFECTIVE_CONFIG' })
    const verified = verifyMermaid(compound, { renderOptions: AGENTIC })
    expect(verified.warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED', origin: 'config' }))
    expect(verified.warnings.some(warning => warning.code === 'INTERNAL_ERROR')).toBe(false)
  })

  test.each([
    ['flowchart', RANK_CAP_SOURCE],
  ])('never silently uses ELK for a strict Agentic %s request', (_family, source) => {
    expect(() => renderMermaidSVGWithReceipt(source, AGENTIC)).toThrow(GraphLayoutUnsupportedError)
    const result = renderMermaidSVGWithReceipt(source, FALLBACK)
    expect(result.receipt.layoutDecisions).toHaveLength(1)
    expect(result.receipt.layoutDecisions?.[0]).toMatchObject({ requested: 'agentic', selected: 'elk', fallback: 'elk' })
    expect(result.receipt.layoutDecisions?.[0]?.attempts[0]).toMatchObject({ reason: 'agentic local rank-expansion limit' })
  })

  test('keeps terminal-cell layout independent and classifies optional companion execution', () => {
    const source = 'classDiagram\n class Duck'
    const stages: string[] = []
    const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => {
      const value = renderMermaidASCIIWithReceipt(source, AGENTIC)
      expect(value.text).toContain('Duck')
      JSON.stringify(value.receipt)
      return value
    })
    expect(stages).not.toContain('elk')
    expect(stages).toContain('agentic')
    expect(rendered.text).toBe(renderMermaidASCIIWithReceipt(source).text)
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'agentic', selected: 'agentic', role: 'companion' })])
    const fallback = renderMermaidASCIIWithReceipt(source, FALLBACK)
    expect(fallback.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'agentic', selected: 'agentic', role: 'companion' })])
    const architecture = 'architecture-beta\ngroup g[Group]\n service a(server)[A] in g'
    const projected = renderMermaidASCIIWithReceipt(architecture, AGENTIC)
    expect(projected.text).toContain('Group')
    expect(projected.receipt.layoutDecisions).toEqual([
      expect.objectContaining({ selected: 'agentic', role: 'primary' }),
      expect.objectContaining({ selected: 'agentic', role: 'companion' }),
    ])
  })

  test('diagnoses nonapplicable families without claiming graph execution', () => {
    const rendered = renderMermaidSVGWithReceipt('sequenceDiagram\n A->>B: Hello', AGENTIC)
    expect(rendered.receipt.layoutDecisions).toBeUndefined()
    expect(rendered.receipt.diagnostics).toContainEqual(expect.objectContaining({ code: 'RENDER_OPTION_NOT_APPLICABLE', feature: 'render-option:graphLayout' }))
  })

  test('CLI convenience flags use the same checked graph option and receipt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-layout-'))
    const path = join(dir, 'diagram.mmd')
    try {
      writeFileSync(path, SOURCE)
      const result = captureCli(() => runCli(['render', path, '--graph-layout', 'agentic', '--json']))
      expect(result.code).toBe(0)
      expect(JSON.parse(result.out).receipt.layoutDecisions[0]).toMatchObject({ requested: 'agentic', selected: 'agentic' })
      const invalid = captureCli(() => runCli(['render', path, '--graph-layout', 'elk', '--graph-layout-fallback', 'elk']))
      expect(invalid.code).toBe(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
