// BUILD-13: layout before/after comparison harness smoke tests.
// The harness is the evidence tool for layout work (fan-out trunks, fan-in
// grouping, subgraph direction); these tests pin its comparison semantics.

import { describe, test, expect } from 'bun:test'
import { snapshotSample, compareSample, buildReportHtml, collectSamples, type Snapshot } from '../../eval/layout-compare/run.ts'

const FLOW = { id: 'probe/flow', family: 'flowchart', source: 'flowchart TD\n  A --> B\n  A --> C' }

describe('layout-compare harness', () => {
  test('snapshotSample captures metrics, svg, and ascii for a healthy diagram', () => {
    const r = snapshotSample(FLOW, 't0-')
    expect(r.ok).toBe(true)
    expect(r.metrics?.nodeCount).toBe(3)
    expect(r.metrics?.edgeCount).toBe(2)
    expect(r.svg).toContain('<svg')
    expect(r.ascii).toContain('A')
  })

  test('snapshotSample reports parse failures as errors, not throws', () => {
    const r = snapshotSample({ id: 'probe/bad', family: 'unknown', source: 'not a diagram' }, 't1-')
    expect(r.ok).toBe(false)
    expect(r.error).toBeDefined()
  })

  test('identical samples compare as unchanged', () => {
    const r = snapshotSample(FLOW, 'same-')
    expect(compareSample(r, r).verdict).toBe('unchanged')
  })

  test('a dropped edge is flagged as a regression (faithfulness)', () => {
    const before = snapshotSample(FLOW, 'b-')
    const after = snapshotSample({ ...FLOW, source: 'flowchart TD\n  A --> B' }, 'b-')
    const c = compareSample(before, after)
    expect(c.verdict).toBe('regression')
    expect(c.notes.join(' ')).toContain('nodeCount')
  })

  test('ok→error transitions are status-changed', () => {
    const before = snapshotSample(FLOW, 's-')
    const after = snapshotSample({ ...FLOW, source: 'not a diagram' }, 's-')
    expect(compareSample(before, after).verdict).toBe('status-changed')
  })

  test('report HTML embeds both sides and the summary', () => {
    const mk = (label: string, source: string): Snapshot => ({
      label, rev: label, createdAt: 'now',
      samples: [snapshotSample({ ...FLOW, source }, label + '-')],
    })
    const html = buildReportHtml(mk('before', FLOW.source), mk('after', 'flowchart TD\n  A --> B'))
    expect(html).toContain('regression')
    expect(html).toContain('before')
    expect(html).toContain('after')
    expect(html).toContain('<svg')
  })

  test('sample set includes the corpus and the layout fixtures', () => {
    const samples = collectSamples()
    expect(samples.length).toBeGreaterThanOrEqual(247)
    const ids = samples.map(s => s.id)
    for (const f of ['fixture/fan-in.mmd', 'fixture/fan-out-trunk.mmd', 'fixture/fan-in-fan-out.mmd', 'fixture/subgraph-direction.mmd']) {
      expect(ids).toContain(f)
    }
  })
})
