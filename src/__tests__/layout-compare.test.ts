// BUILD-13: layout before/after comparison harness smoke tests.
// The harness is the evidence tool for layout work (fan-out trunks, fan-in
// grouping, subgraph direction); these tests pin its comparison semantics.

import { describe, test, expect } from 'bun:test'
import { snapshotSample, compareSample, buildReportHtml, collectSamples, type Snapshot, type SampleResult } from '../../eval/layout-compare/run.ts'
import type { QualityMetrics } from '../agent/index.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

const FLOW = { id: 'probe/flow', family: 'flowchart', source: 'flowchart TD\n  A --> B\n  A --> C' }

/** Build a synthetic ok SampleResult with the given metrics (svg/ascii equal so
 *  only metric movement drives the verdict). */
function sampleWith(id: string, family: string, m: Partial<QualityMetrics>): SampleResult {
  const metrics: QualityMetrics = {
    edgeCrossings: 0, labelLegibility: 1, whitespaceBalance: 0, labelEdgeProximity: Infinity,
    minimumNodeSpacing: Infinity, elementDensity: 0, minimumTextContrast: 21,
    aspectRatio: 1, nodeCount: 0, edgeCount: 0, ...m,
  }
  return { id, family, source: `${family} src`, ok: true, metrics, svg: 'SVG', ascii: 'ASCII' }
}

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

  // QUAL-1: families that previously had an EMPTY layout (nodeCount 0) gaining
  // real geometry is an improvement, not a faithfulness regression.
  test('empty→measured transition is an improvement, not a regression', () => {
    // before: the empty-layout baseline (no nodes/edges, trivial derived metrics).
    const before = sampleWith('probe/pie', 'pie', { nodeCount: 0, edgeCount: 0, labelLegibility: 1, whitespaceBalance: 0 })
    // after: the family now has real geometry; derived metrics moved off their
    // trivial baselines (legibility dropped, whitespace rose) — that's expected.
    const after = sampleWith('probe/pie', 'pie', { nodeCount: 3, edgeCount: 0, labelLegibility: 0.5, whitespaceBalance: 0.2 })
    const c = compareSample(before, after)
    expect(c.verdict).toBe('improvement')
    expect(c.notes.join(' ')).toContain('empty→measured')
  })

  test('node-count drift on an already-measured family stays a regression', () => {
    // before already had geometry — a real count drop is a genuine regression.
    const before = sampleWith('probe/cls', 'class', { nodeCount: 4, edgeCount: 3 })
    const after = sampleWith('probe/cls', 'class', { nodeCount: 3, edgeCount: 3 })
    const c = compareSample(before, after)
    expect(c.verdict).toBe('regression')
    expect(c.notes.join(' ')).toContain('nodeCount: 4 → 3')
  })

  test('empty→empty (still no nodes) is not a spurious improvement', () => {
    const before = sampleWith('probe/empty', 'pie', { nodeCount: 0, edgeCount: 0 })
    const after = sampleWith('probe/empty', 'pie', { nodeCount: 0, edgeCount: 0 })
    expect(compareSample(before, after).verdict).toBe('unchanged')
  })

  test('sample set includes the corpus and the layout fixtures', () => {
    const samples = collectSamples()
    expect(samples.length).toBeGreaterThanOrEqual(258)
    const ids = samples.map(s => s.id)
    // QUAL-1: every renderable family now has at least one fixture so the
    // harness exercises its adapter.
    const familyFixtures = BUILTIN_FAMILY_METADATA.map(f => `fixture/${f.id}-basic.mmd`)
    for (const f of [
      'fixture/fan-in.mmd', 'fixture/fan-out-trunk.mmd', 'fixture/fan-in-fan-out.mmd', 'fixture/subgraph-direction.mmd',
      ...familyFixtures,
    ]) {
      expect(ids).toContain(f)
    }
  })

  test('every family fixture yields a non-empty measured layout', () => {
    // Harness-integration proof: each fixture's metrics.nodeCount > 0 (no family
    // falls through to the empty layout any more).
    const samples = collectSamples().filter(s => s.id.startsWith('fixture/'))
    for (const s of samples) {
      const r = snapshotSample(s, 'fx-')
      expect(r.ok).toBe(true)
      expect(r.metrics!.nodeCount).toBeGreaterThan(0)
    }
  })
})
