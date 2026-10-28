import { expect, test } from 'bun:test'
import { snapshotSample, compareSample, buildReportHtml, buildSnapshot, summarizeComparisonsByFamily } from './run.ts'
import { generatedFlowchartSamples } from './generated.ts'
import { parseRegisteredMermaid } from '../../src/agent/index.ts'
import { withRenderStageObserver } from '../../src/render-stages.ts'
import { getFamily, replaceFamilyForTest } from '../../src/agent/families.ts'
import { apiFailure } from './outcomes.ts'

test.each([true, false])('quality capture attempts both public APIs when debug-only failure=%s', failDebug => {
  const family = getFamily('flowchart'), calls: boolean[] = []
  if (!family?.projectPositioned) throw new Error('Flowchart projector is required')
  const projectPositioned = family.projectPositioned
  const message = `distinct hook failure ${'界'.repeat(600)}`
  const restore = replaceFamilyForTest('flowchart', { ...family, projectPositioned(context) {
    calls.push(Boolean(context.options?.debug))
    if (Boolean(context.options?.debug) === failDebug) throw new Error(message)
    return projectPositioned(context)
  } })
  try {
    const sample = snapshotSample({ id: 'independent-api', family: 'flowchart', source: 'flowchart TD\nA-->B' }, 'independent-', {}, { includeAscii: false })
    expect(sample.ok).toBe(false)
    expect(calls).toContain(true)
    expect(calls).toContain(false)
    expect(sample.failures?.[failDebug ? 'layout' : 'svg']?.message).toContain(message)
    expect(sample.failures?.[failDebug ? 'svg' : 'layout']).toBeUndefined()
    if (failDebug) expect(sample.svg).toContain('<svg')
    else {
      expect(sample.layout?.nodes.map(node => node.id)).toEqual(['A', 'B'])
      expect(sample.metrics?.nodeCount).toBe(2)
    }
  } finally { restore() }
})

test('typed failure transport preserves complete causes and certification without stacks', () => {
  const certification = { status: 'failed', issues: [{ message: 'label body overlaps shaft', ids: ['A', 'A#2'] }] }
  const cause = Object.assign(new Error('full cause'), { code: 'PAINT_LAYOUT_CERTIFICATION_FAILED', certification })
  const error = new Error('outer family context', { cause })
  const retained = JSON.parse(JSON.stringify(apiFailure(error)))
  expect(retained).toMatchObject({ name: 'Error', message: 'outer family context', cause: {
    name: 'Error', message: 'full cause', code: cause.code, properties: { certification },
  } })
  expect(retained.stack).toBeUndefined()
  expect(retained.cause.stack).toBeUndefined()
  const record = Object.assign(Object.create(null), { name: 'ProviderRefusal', message: 'plain typed refusal', code: 'DECLINED', certification })
  expect(apiFailure(record)).toMatchObject({ name: record.name, message: record.message, code: record.code, properties: { certification } })
  const withoutMessage = Object.assign(Object.create(null), { code: 'DECLINED' })
  expect(apiFailure(withoutMessage)).toEqual({ name: 'Error', message: 'Thrown object without a string message', code: 'DECLINED', properties: { code: 'DECLINED' } })
  const before = { id: 'refused', family: 'flowchart', source: 'flowchart TD\nA-->B', ok: false,
    error: 'outer family context', failures: { layout: retained } }
  const changed = structuredClone(before)
  changed.failures.layout.cause.properties.certification.issues[0].ids.push('A#3')
  expect(compareSample(before, changed).verdict).toBe('changed')
})

test('newly supported diagrams improve coverage while lost or missing inputs remain adverse', () => {
  const rendered = snapshotSample({ id: 'support', family: 'flowchart', source: 'flowchart TD\nA --> B' }, 'support-')
  expect(rendered.ok).toBe(true)
  const declined = { id: rendered.id, family: rendered.family, source: rendered.source, ok: false, errorCode: 'GRAPH_LAYOUT_UNSUPPORTED', error: 'unsupported' }
  const gain = compareSample(declined, rendered), loss = compareSample(rendered, declined)
  expect(gain.verdict).toBe('improvement')
  expect(loss.verdict).toBe('regression')
  expect(summarizeComparisonsByFamily([gain]).microAdverseRate).toBe(0)
  expect(summarizeComparisonsByFamily([loss]).microAdverseRate).toBe(1)
  expect(summarizeComparisonsByFamily([compareSample(rendered, undefined)]).microAdverseRate).toBe(1)
  expect(compareSample(declined, { ...declined, errorCode: 'INTERNAL_ERROR', error: 'defect' }).verdict).toBe('changed')
})

test('a crossing improvement cannot hide added bends, route length or area', () => {
  const before = snapshotSample({ id: 'tradeoff', family: 'flowchart', source: 'flowchart TD\nA --> B' }, 'tradeoff-')
  expect(before.ok).toBe(true)
  const metrics = { ...before.metrics!, edgeCrossings: 2, routeGeometry: { bends: 0, length: 100, area: 1000 } }
  const after = { ...before, metrics: { ...metrics, edgeCrossings: 1, routeGeometry: { bends: 2, length: 120, area: 1200 } } }
  const comparison = compareSample({ ...before, metrics }, after)
  expect(comparison.verdict).toBe('regression')
  expect(comparison.notes.some(note => note.startsWith('polyline bends:'))).toBe(true)
  expect(comparison.notes.some(note => note.startsWith('canvas area:'))).toBe(true)
})

test.each(['labelConflicts', 'routeOverlaps', 'routeGeometry'] as const)('losing %s measurement stays adverse and gaining it does not claim a geometry win', dimension => {
  const sample = snapshotSample({ id: 'coverage', family: 'flowchart', source: 'flowchart TD\nA --> B' }, 'coverage-')
  expect(sample.ok).toBe(true)
  expect(sample.metrics![dimension]).toBeDefined()
  const unavailable = { ...sample, metrics: { ...sample.metrics!, [dimension]: undefined } }
  expect(compareSample(sample, unavailable)).toMatchObject({ verdict: 'regression', notes: [`${dimension}: measurement lost`] })
  expect(compareSample(unavailable, sample)).toMatchObject({ verdict: 'changed', notes: [`${dimension}: measurement gained; geometry not compared`] })
})

test('generated quality snapshots replay an explicit population and retain fully consumed backend evidence', () => {
  const range = { start: 66, count: 1 }
  expect(generatedFlowchartSamples(range)).toEqual(generatedFlowchartSamples(range))
  expect(generatedFlowchartSamples({ start: 67, count: 1 })[0]!.source).not.toBe(generatedFlowchartSamples(range)[0]!.source)
  const snapshot = buildSnapshot('generated', { generated: range, renderOptions: { graphLayout: { backend: 'agentic' } } })
  expect(snapshot.population).toEqual({ ...range, kind: 'generated-flowchart', terminal: 'not-requested' })
  expect(snapshot.samples).toHaveLength(1)
  const sample = snapshot.samples[0]!
  expect(sample).toMatchObject({ id: 'generated-cyclic:66', ok: true, family: 'flowchart', metrics: { nodeCount: 9, edgeCount: 21 } })
  expect(sample.ascii).toBeUndefined()
  for (const receipt of [sample.svgReceipt, sample.layoutReceipt]) expect(receipt?.layoutDecisions?.[0]).toMatchObject({ requested: 'agentic', selected: 'agentic' })
  expect(buildReportHtml(snapshot, snapshot)).toContain('not-requested')
})

test('generated quality comparisons reject unbounded, empty or implicit-policy populations before rendering', () => {
  for (const range of [{ start: 0, count: 0 }, { start: 0, count: 257 }, { start: -1, count: 1 }, { start: 0, count: 1.5 }, { start: 0xffffffff, count: 2 }]) {
    expect(() => generatedFlowchartSamples(range)).toThrow(RangeError)
  }
  expect(() => buildSnapshot('implicit', { generated: { start: 0, count: 1 } })).toThrow('explicit graphLayout.backend')
})

test('the independent generator preserves graph meaning and admits both source parities', () => {
  const range = { start: 1000, count: 26 }
  const samples = generatedFlowchartSamples(range, 'sha256-counter-v1')
  expect(samples).toEqual(generatedFlowchartSamples(range, 'sha256-counter-v1'))
  for (const [offset, sample] of samples.entries()) {
    const seed = range.start + offset, nodes = 8 + seed % 13, edges = 2 * nodes + seed % 7
    expect(sample.id).toBe(`generated-sha256-counter-v1:${seed}`)
    const parsed = parseRegisteredMermaid(sample.source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.value.body.kind !== 'flowchart') throw new Error('Invalid generated flowchart')
    const graph = parsed.value.body.graph
    expect(graph.nodes.size).toBe(nodes)
    expect(graph.edges).toHaveLength(edges)
    expect(graph.edges.filter(edge => edge.label)).toHaveLength(Math.ceil(edges / 4))
    for (const edge of graph.edges) {
      expect(graph.nodes.has(edge.source) && graph.nodes.has(edge.target)).toBe(true)
      expect(edge.source).not.toBe(edge.target)
    }
    if (nodes % 2 === 0) expect(new Set(graph.edges.map(edge => Number(edge.source.slice(1)) % 2)).size).toBe(2)
  }
  expect(() => generatedFlowchartSamples(range, 'unknown' as never)).toThrow(RangeError)
})

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
  // A sibling long link reaches the bounded private-rank refusal.
  const input = { id: 'local-rank-limit', family: 'flowchart', source: `flowchart LR\n A[Source]\n B[Target]\n A ${'-'.repeat(2049)}> B` }
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
