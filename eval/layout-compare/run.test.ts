import { expect, test } from 'bun:test'
import { snapshotSample, compareSample, buildReportHtml } from './run.ts'
import { withRenderStageObserver } from '../../src/render-stages.ts'

test('visual snapshots apply the same backend to source rendering and parsed quality, retaining both receipts', () => {
  const input = { id: 'labelled-branch', family: 'flowchart', source: 'flowchart TD\nA([Start]) -->|yes| B{Choose}\nB --> C\nB --> D' }
  const stages: string[] = []
  const sample = withRenderStageObserver(value => stages.push(value.stage), () => snapshotSample(input, 'review-', { graphLayout: { backend: 'agentic' } }))
  expect(sample.ok).toBe(true)
  expect(sample.svg).toContain('Start')
  expect(sample.metrics).toMatchObject({ nodeCount: 4, edgeCount: 3 })
  for (const receipt of [sample.svgReceipt, sample.layoutReceipt]) expect(receipt?.layoutDecisions).toEqual([
    expect.objectContaining({ requested: 'agentic', selected: 'agentic', role: 'primary' }),
  ])
  expect(stages).not.toContain('elk')
  expect(JSON.stringify(sample)).toContain('agentic-layered@')
})

test('visual snapshots preserve typed native declines and attribute requested fallback', () => {
  const input = { id: 'compound', family: 'flowchart', source: 'flowchart TD\nOutside --> A\nsubgraph Group\n A --> B\nend' }
  const declined = snapshotSample(input, 'review-', { graphLayout: { backend: 'agentic' } })
  expect(declined).toMatchObject({ ok: false, errorCode: 'GRAPH_LAYOUT_UNSUPPORTED' })
  expect(declined.svg).toBeUndefined()
  const fallback = snapshotSample(input, 'review-', { graphLayout: { backend: 'agentic', fallback: 'elk' }, onConfigDiagnostic: () => {} })
  expect(fallback.ok).toBe(true)
  for (const receipt of [fallback.svgReceipt, fallback.layoutReceipt]) expect(receipt?.layoutDecisions?.[0]).toMatchObject({ requested: 'agentic', selected: 'elk', fallback: 'elk' })
})

test('a backend change remains reviewable when geometry bytes and metrics agree', () => {
  const sample = snapshotSample({ id: 'pair', family: 'flowchart', source: 'flowchart TD\nA --> B' }, 'review-', { graphLayout: { backend: 'elk' } })
  expect(sample.ok).toBe(true)
  // Hold geometry fixed: only the execution metadata differs in this report.
  const after = { ...sample, svgReceipt: { ...sample.svgReceipt!, layoutDecisions: [{
    requested: 'agentic' as const, selected: 'agentic' as const, fallback: 'none' as const,
    attempts: [{ backend: 'agentic' as const, outcome: 'selected' as const }], implementation: 'test-producer',
  }] } }
  expect(compareSample(sample, after)).toMatchObject({ verdict: 'changed', notes: ['backend execution changed'] })
  const common = { label: 'review', rev: 'a'.repeat(40), createdAt: '2026-10-20T00:00:00Z' }
  const html = buildReportHtml({ ...common, samples: [sample] }, { ...common, samples: [after] })
  expect(html).toContain('Measured quality and backend receipts')
  expect(html).toContain('test-producer')
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1])
  expect(ids.length).toBeGreaterThan(0)
  expect(new Set(ids).size).toBe(ids.length)
})
