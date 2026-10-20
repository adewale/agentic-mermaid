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
import { flowchartMultigraph } from '../../eval/benchmark/release-bench-cases.ts'

const SOURCE = 'flowchart TD\n A[Start] --> B[Finish]'
const AGENTIC = { graphLayout: { backend: 'agentic' as const } }
const FALLBACK = { graphLayout: { backend: 'agentic' as const, fallback: 'elk' as const } }

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

  test.each(['TD', 'LR', 'BT', 'RL'])('routes a complete rectangular fan net without extra crossings in %s', direction => {
    const source = `---\ntitle: Complete fan\n---\nflowchart ${direction}\nA & B --> C & D`
    const svg = renderMermaidSVGWithReceipt(source, AGENTIC)
    const layout = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true })
    const reference = layoutMermaidWithReceipt(source, { graphLayout: { backend: 'elk' }, debug: true })
    expect(layout.layout.nodes.map(node => node.id).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(layout.layout.edges.map(edge => `${edge.from}->${edge.to}`).sort()).toEqual(['A->C', 'A->D', 'B->C', 'B->D'])
    const quality = measureQuality(layout.layout)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.edgeCrossings).toBeLessThanOrEqual(measureQuality(reference.layout).edgeCrossings)
    expect(quality.routeOverlaps).toEqual({ opposing: 0, parallel: 0 })
    expect(quality.labelConflicts?.total).toBe(0)
    expect(svg.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
    JSON.stringify(svg.receipt)
    JSON.stringify(layout.receipt)
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

  test('declines cross-hierarchy leaf routes and attributes a requested ELK fallback consistently across cache states', () => {
    const compound = 'flowchart TD\nOutside --> A\nsubgraph G[Group]\n A --> B\nend'
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
      attempts: [expect.objectContaining({ backend: 'agentic', outcome: 'unsupported' }), { backend: 'elk', outcome: 'selected' }],
    })])
    expect(first.receipt.diagnostics).toContainEqual(expect.objectContaining({ code: 'GRAPH_LAYOUT_FALLBACK' }))
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]).toMatchObject({ field: 'graphLayout.backend', code: 'INEFFECTIVE_CONFIG' })
    const verified = verifyMermaid(compound, { renderOptions: AGENTIC })
    expect(verified.warnings).toContainEqual(expect.objectContaining({ code: 'RENDER_FAILED', origin: 'config' }))
    expect(verified.warnings.some(warning => warning.code === 'INTERNAL_ERROR')).toBe(false)
  })

  test.each([
    ['requirement', 'requirementDiagram\n requirement fast {\n id: 1\n text: Respond quickly\n risk: high\n verifymethod: test\n }\n element benchmark {\n type: "test"\n }\n benchmark - verifies -> fast'],
    ['class', 'classDiagram\n class A\n class B\n A --> B'],
    ['er', 'erDiagram\n A ||--o{ B : owns'],
    ['architecture', 'architecture-beta\n service a(server)[A]\n service b(server)[B]\n a:R --> L:b'],
  ])('never silently uses ELK for a strict Agentic %s request', (_family, source) => {
    expect(() => renderMermaidSVGWithReceipt(source, AGENTIC)).toThrow(GraphLayoutUnsupportedError)
    const result = renderMermaidSVGWithReceipt(source, FALLBACK)
    expect(result.receipt.layoutDecisions).toHaveLength(1)
    expect(result.receipt.layoutDecisions?.[0]).toMatchObject({ requested: 'agentic', selected: 'elk', fallback: 'elk' })
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
    expect(rendered.receipt.layoutDecisions).toBeUndefined()
    const fallback = renderMermaidASCIIWithReceipt(source, FALLBACK)
    expect(fallback.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: 'agentic', selected: 'elk', role: 'companion' })])
    const architecture = 'architecture-beta\n service a(server)[A]'
    expect(() => renderMermaidASCIIWithReceipt(architecture, AGENTIC)).toThrow(GraphLayoutUnsupportedError)
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
