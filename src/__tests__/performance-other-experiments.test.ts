import { expect, test } from 'bun:test'
import { performanceExperimentEnabled, withPerformanceExperiments } from '../experimental-performance.ts'
import { OpenIntervalUnion } from '../experimental/interval-union.ts'
import { AdaptiveTerminalRow } from '../experimental/terminal-row.ts'
import { prepareDisplayText } from '../shared/display-text.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { mutate } from '../agent/mutate.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import type { FlowchartMutationOp } from '../agent/types.ts'

test('performance scope restores nested flags after exceptions', () => {
  withPerformanceExperiments([], () => {
    expect(performanceExperimentEnabled('text-spans')).toBe(false)
    expect(() => withPerformanceExperiments(['text-spans'], () => { expect(performanceExperimentEnabled('text-spans')).toBe(true); throw Error('probe') })).toThrow('probe')
    expect(performanceExperimentEnabled('text-spans')).toBe(false)
  })
})

test('open interval index preserves endpoints, gaps and overlapping unions', () => {
  const spans = [[1, 3], [3, 5], [8, 12], [9, 15], [-3, -1]] as Array<[number, number]>
  const index = new OpenIntervalUnion(spans.map(p => [...p]))
  for (let i = -16; i <= 64; i++) { const x = i / 4; expect(index.contains(x)).toBe(spans.some(([a, b]) => a < x && x < b)) }
})

test('packed terminal rows retain Map insertion order through conversion, retirement and reinsertion', () => {
  const row = new AdaptiveTerminalRow<string>(), reference = new Map<number, string>()
  for (let i = 0; i < 128; i++) { row.set(i, `v${i}`); reference.set(i, `v${i}`) }
  for (let i = 0; i < 1800; i++) {
    const key = i % 17 === 0 ? 10_000_000 + i : i * 37 % 150
    if (i % 3) { row.set(key, String(i)); reference.set(key, String(i)) } else expect(row.delete(key)).toBe(reference.delete(key))
    if (i % 29 === 0) { expect([...row]).toEqual([...reference]); expect(row.size).toBe(reference.size) }
  }
  expect([...row.keys()]).toEqual([...reference.keys()])
})

test('text reuse preserves Unicode, typography, source spans and custom measurer isolation', () => {
  for (const source of ['a **bold** word', '東京 👩‍💻 café\nΩ', '<i>x</i> &lt;span&gt;', '']) {
    const baseline = withPerformanceExperiments([], () => prepareDisplayText(source))
    withPerformanceExperiments(['text-spans'], () => {
      expect(prepareDisplayText(source)).toEqual(baseline)
      expect(prepareDisplayText(source)).toBe(prepareDisplayText(source))
      const options = { fontSize: 16, fontWeight: 500, maxWidth: 72 }
      expect(preparePixelText(source, options)).toEqual(withPerformanceExperiments([], () => preparePixelText(source, options)))
    })
  }
  withPerformanceExperiments(['text-spans'], () => {
    const measured = (width: number) => withTextMeasurementExecution(createTextMeasurementExecution({ id: 'test-measurer', version: '1.0.0', measure: () => width }, 'Inter'), () => preparePixelText('custom', { fontSize: 16, fontWeight: 500 }).width)
    expect(measured(40)).not.toBe(measured(90))
  })
})

test('terminal storage, Gantt intervals and Sankey CSR preserve public output', () => {
  const inputs = ['flowchart LR\n A[Hello 東京] --> B[World]', 'sequenceDiagram\n A->>B: text',
    'gantt\n dateFormat YYYY-MM-DD\n section Phase\n A :a, 2024-01-01, 3d\n B :b, after a, 2d\n C :c, 2024-01-02, 4d',
    'sankey-beta\nA,B,2\nA,C,3\nB,D,2\nC,D,3']
  for (const input of inputs) {
    const svg = withPerformanceExperiments([], () => renderMermaidSVG(input))
    expect(withPerformanceExperiments(['gantt-intervals', 'sankey-csr', 'text-spans'], () => renderMermaidSVG(input))).toBe(svg)
    const ascii = withPerformanceExperiments([], () => renderMermaidASCII(input))
    expect(withPerformanceExperiments(['terminal-tiles', 'text-spans'], () => renderMermaidASCII(input))).toBe(ascii)
  }
})

test('position cache reuses complete layout, respects cache opt-out and keeps prepared evidence', () => {
  const prior = process.env.AGENTIC_MERMAID_ELK_CACHE
  const input = 'flowchart LR\n CacheA[Prepared label] --> CacheB[Other label]'
  try {
    process.env.AGENTIC_MERMAID_ELK_CACHE = '1'
    withPerformanceExperiments(['position-cache'], () => {
      const first = renderMermaidSVG(input); const elk: number[] = []
      const second = withRenderStageObserver(s => { if (s.stage === 'elk') elk.push(s.ms) }, () => renderMermaidSVG(input))
      expect(second).toBe(first); expect(elk).toHaveLength(0)
      expect(renderMermaidSVG(input, { idPrefix: 'different-' })).not.toBe(first)
      process.env.AGENTIC_MERMAID_ELK_CACHE = '0'
      withRenderStageObserver(s => { if (s.stage === 'elk') elk.push(s.ms) }, () => renderMermaidSVG(input))
      expect(elk.length).toBeGreaterThan(0)
    })
  } finally { if (prior === undefined) delete process.env.AGENTIC_MERMAID_ELK_CACHE; else process.env.AGENTIC_MERMAID_ELK_CACHE = prior }
})

test('persistent mutation drafts never leak original records and close over canonical source', () => {
  const parsed = parseRegisteredMermaid('flowchart LR\n A[Before] --> B[After]')
  if (!parsed.ok) throw Error('fixture parse failed')
  const original = serializeMermaid(parsed.value)
  const ops: FlowchartMutationOp[] = [{ kind: 'add_node', id: 'C', label: 'New' }, { kind: 'set_label', target: 'A', label: 'Changed' },
    { kind: 'set_node_style', id: 'A', style: 'fill:#f00' }, { kind: 'add_edge', from: 'B', to: 'C' }, { kind: 'set_direction', direction: 'TD' }]
  for (const op of ops) {
    const baseline = withPerformanceExperiments([], () => mutate(parsed.value, op))
    const changed = withPerformanceExperiments(['persistent-mutations'], () => mutate(parsed.value, op))
    expect(changed.ok).toBe(baseline.ok)
    if (changed.ok && baseline.ok) {
      expect(serializeMermaid(changed.value)).toBe(serializeMermaid(baseline.value))
      if (changed.value.body.kind === 'flowchart') changed.value.body.graph.nodes.get('A')!.label = 'external mutation'
      expect(serializeMermaid(parsed.value)).toBe(original)
    }
  }
})
