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

  test('renders labelled reciprocal cycles without ELK and preserves graph certification', () => {
    const source = 'flowchart LR\nA[Send] -->|request| B[Process]\nB -->|retry| A\nB --> C[Commit]\nC --> A'
    const stages: string[] = []
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, AGENTIC))
    expect(stages).not.toContain('elk')
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
    expect(layoutGraphSync(parseFlowchart(source), AGENTIC).certification).toMatchObject({ status: 'passed', hardViolations: 0 })
    for (const label of ['Send', 'Process', 'Commit', 'request', 'retry']) expect(result.svg).toContain(label)
    JSON.stringify(result.receipt)
  })

  test('retains separate label corridors beside a disconnected fan-out', () => {
    // Reduced from the labelled mesh: generic trunk bundling moved a foreign
    // fan-out route through label 37 despite initially clear native channels.
    const source = 'flowchart TD\nn58 --> n66\nn58 --> n70\nn29 -->|label 37| n16\nn113 -->|label 38| n16'
    const result = layoutMermaidWithReceipt(source, { ...AGENTIC, debug: true })
    const quality = measureQuality(result.layout)
    expect(quality.nodeCount).toBe(6)
    expect(quality.edgeCount).toBe(4)
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.labelConflicts?.total).toBe(0)
    JSON.stringify(result.receipt)
  })

  test('declines compounds explicitly and attributes a requested ELK fallback consistently across cache states', () => {
    const compound = 'flowchart TD\nsubgraph G[Group]\n A --> B\nend'
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
    ['state', 'stateDiagram-v2\n A --> B'],
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
