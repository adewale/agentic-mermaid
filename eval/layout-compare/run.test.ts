import { expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { snapshotSample, compareSample, compareSnapshots, buildReportHtml, buildSnapshot, summarizeComparisonsByFamily, type SampleResult } from './run.ts'
import { generatedFlowchartSamples } from './generated.ts'
import { parseRegisteredMermaid } from '../../src/agent/index.ts'
import { withRenderStageObserver } from '../../src/render-stages.ts'
import { getFamily, replaceFamilyForTest } from '../../src/agent/families.ts'
import { apiFailure } from './outcomes.ts'
import { useTempDirs } from '../../src/__tests__/helpers/temp-dir.ts'

const temporary = useTempDirs('layout-report-admission-')

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

test('coverage changes retain adverse missing inputs and show unchanged failures in reports', () => {
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
  const matchingFailure = { ...declined, id: 'matching-failure<&>', source: 'flowchart TD\nA["Retained & <failure>"] --> B',
    errorCode: 'SCENE_VALIDATION_FAILED', error: 'same refusal <&>',
    failures: { layout: { name: 'SceneValidationError', message: 'owned field <&>', code: 'SCENE_VALIDATION_FAILED', properties: { detail: 'retained context <&>' } } } }
  expect(compareSample(matchingFailure, matchingFailure).verdict).toBe('unchanged')
  const common = { label: 'review', rev: 'a'.repeat(40), createdAt: '2026-10-20T00:00:00Z' }
  const html = buildReportHtml({ ...common, samples: [rendered, matchingFailure, { ...rendered, id: 'support-loss' }] },
    { ...common, samples: [rendered, matchingFailure, { ...declined, id: 'support-loss' }] })
  expect(html).toContain('<h3>matching-failure&lt;&amp;&gt; ')
  expect(html).toContain('same refusal &lt;&amp;&gt;')
  expect(html).toContain('owned field &lt;&amp;&gt;')
  expect(html).toContain('retained context &lt;&amp;&gt;')
  expect(html).toContain('SCENE_VALIDATION_FAILED')
  expect(html).toContain('A["Retained &amp; &lt;failure&gt;"] --&gt; B')
  expect(html).toContain('Errored samples: before <strong>1</strong>; after <strong>2</strong>; failed in both <strong>1</strong>.')
  expect(html).toContain('<strong>0</strong> status-changed (missing population)')
  expect(html).not.toContain('<h3>support ')
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
  const backend = compareSample({ ...before, metrics }, after, 'backend')
  expect(backend.verdict).toBe('improvement')
  expect(backend.notes).toEqual(comparison.notes)
  const conflicting = { ...after, metrics: { ...after.metrics, labelConflicts: { total: 1, labelLabel: 1, labelNode: 0, labelEdge: 0 } } }
  expect(compareSample({ ...before, metrics }, conflicting, 'backend').verdict).toBe('regression')
  expect(compareSample(after, { ...after, metrics: { ...after.metrics, edgeCount: 0 } }, 'backend').verdict).toBe('regression')
  expect(compareSample(after, { ...after, metrics: { ...after.metrics, routeGeometry: undefined } }, 'backend').verdict).toBe('regression')
})

test('backend reports require the same clean revision and authored inputs without hiding missing samples', () => {
  const sample = snapshotSample({ id: 'identity', family: 'flowchart', source: 'flowchart TD\nA --> B' }, 'identity-')
  const common = { label: 'review', rev: 'a'.repeat(40), dirty: false, createdAt: '2026-10-28T00:00:00Z', samples: [sample] }
  const before = { ...common, renderOptions: { graphLayout: { backend: 'elk' as const } } }
  const after = { ...common, renderOptions: { graphLayout: { backend: 'agentic' as const } } }
  expect(compareSnapshots(before, after, 'backend')[0]!.verdict).toBe('unchanged')
  expect(compareSnapshots(before, { ...after, samples: [] }, 'backend')[0]!.verdict).toBe('status-changed')
  expect(() => compareSnapshots(before, { ...after, rev: 'b'.repeat(40) }, 'backend')).toThrow('immutable revision')
  expect(() => compareSnapshots(before, { ...after, dirty: true }, 'backend')).toThrow('immutable revision')
  expect(() => compareSnapshots(before, before, 'backend')).toThrow('different backends')
  expect(() => compareSnapshots(before, { ...after, renderOptions: { ...after.renderOptions, nodeSpacing: 1 } }, 'backend')).toThrow('render options differ')
  expect(() => compareSnapshots(before, { ...after, samples: [sample, sample] }, 'backend')).toThrow('duplicate sample')
  expect(() => compareSnapshots(before, { ...after, samples: [{ ...sample, source: 'flowchart TD\nA --> C' }] }, 'backend')).toThrow('inputs differ')
  expect(buildReportHtml(before, after, 'backend')).toContain('Bends, route length and canvas area remain visible tradeoffs')
})

test('report admission rejects malformed compared metrics before support or tradeoff verdicts', () => {
  const sample = snapshotSample({ id: 'admission', family: 'flowchart', source: 'flowchart TD\nA --> B' }, 'admission-', {}, { includeAscii: false })
  expect(sample.ok).toBe(true)
  const metrics = sample.metrics!
  const malformed = [
    { ...sample, metrics: undefined },
    { ...sample, svg: undefined },
    { ...sample, ok: 'true' },
    ...[null, '0', false, NaN, Infinity, -1, 0.5].map(edgeCrossings => ({ ...sample, metrics: { ...metrics, edgeCrossings } })),
    ...[-0.01, 1.01].map(labelLegibility => ({ ...sample, metrics: { ...metrics, labelLegibility } })),
    { ...sample, metrics: { ...metrics, nodeCount: -1 } },
    { ...sample, metrics: { ...metrics, edgeCount: 0.5 } },
    { ...sample, metrics: { ...metrics, labelConflicts: null } },
    { ...sample, metrics: { ...metrics, labelConflicts: { ...metrics.labelConflicts, total: null } } },
    { ...sample, metrics: { ...metrics, routeOverlaps: { parallel: 0, opposing: null } } },
    { ...sample, metrics: { ...metrics, routeGeometry: { ...metrics.routeGeometry, bends: -1 } } },
    { ...sample, metrics: { ...metrics, routeGeometry: { ...metrics.routeGeometry, length: Infinity } } },
    { ...sample, metrics: { ...metrics, routeGeometry: { ...metrics.routeGeometry, area: -1 } } },
    { ...sample, metrics: { ...metrics, labelMeasurement: { measuredNodes: 2 } } },
  ] as SampleResult[]
  const declined = { ...sample, ok: false, metrics: undefined, error: 'declined' }
  for (const invalid of malformed) for (const mode of ['revision', 'backend'] as const) {
    expect(() => compareSample(sample, invalid, mode)).toThrow('Invalid layout comparison')
    expect(() => compareSample(invalid, declined, mode)).toThrow('Invalid layout comparison')
    expect(() => compareSample(declined, invalid, mode)).toThrow('Invalid layout comparison')
  }
  // These auxiliary measurements legitimately use Infinity (null in JSON),
  // unavailable contrast, or negative overlap spacing. They do not drive this report.
  const serialized = JSON.parse(JSON.stringify({ ...sample, metrics: { ...metrics,
    labelEdgeProximity: Infinity, aspectRatio: Infinity, minimumTextContrast: null, minimumNodeSpacing: -1,
    labelConflicts: undefined, routeOverlaps: undefined, routeGeometry: undefined, labelMeasurement: undefined,
  } })) as SampleResult
  expect(compareSample(serialized, serialized).verdict).toBe('unchanged')
})

test('label measurement loss cannot hide behind unchanged perfect legibility', () => {
  const sample = snapshotSample({ id: 'label-coverage', family: 'flowchart', source: 'flowchart TD\nA --> B' }, 'label-coverage-', {}, { includeAscii: false })
  expect(sample.ok).toBe(true)
  const metrics = sample.metrics!, coverage = metrics.labelMeasurement
  // Older JSON records omit this observation rather than carrying an undefined field.
  const missing = JSON.parse(JSON.stringify({ ...sample, metrics: { ...metrics, labelMeasurement: undefined } })) as SampleResult
  const loss = compareSample(sample, missing, 'backend'), gain = compareSample(missing, sample, 'backend')
  expect({ verdict: loss.verdict, notes: loss.notes }).toEqual({ verdict: 'regression', notes: ['labelMeasurement: measurement lost'] })
  expect({ verdict: gain.verdict, notes: gain.notes }).toEqual({ verdict: 'changed', notes: ['labelMeasurement: measurement gained; geometry not compared'] })
  for (const group of [
    ['measuredNodes', 'unmeasuredNodes'], ['measuredEdges', 'unmeasuredEdges'], ['measuredLabels', 'unmeasuredLabels'],
  ] as const) {
    const beforeCoverage = { ...coverage, [group[0]]: 1, [group[1]]: 0 }
    const before = { ...sample, metrics: { ...metrics, labelMeasurement: beforeCoverage } }
    const after = { ...sample, metrics: { ...metrics, labelMeasurement: { ...beforeCoverage, [group[0]]: 0, [group[1]]: 1 } } }
    expect(compareSample(before, after, 'backend').verdict).toBe('regression')
    expect(compareSample(after, before, 'backend').verdict).toBe('changed')
  }
  for (const visibility of ['hiddenNodes', 'semanticNodes'] as const) {
    const changed = { ...sample, metrics: { ...metrics, labelMeasurement: { ...coverage, measuredNodes: coverage.measuredNodes - 1, [visibility]: 1 } } }
    expect(compareSample(sample, changed, 'backend').verdict).toBe('regression')
  }
})

test('report CLI rejects empty and malformed JSON populations without writing a clean report', () => {
  const sample = snapshotSample({ id: 'cli-admission', family: 'flowchart', source: 'flowchart TD\nA --> B' }, 'cli-admission-', {}, { includeAscii: false })
  expect(sample.ok).toBe(true)
  const common = { label: 'admission', rev: 'a'.repeat(40), dirty: false, createdAt: '2026-10-28T00:00:00Z' }
  const before = { ...common, renderOptions: { graphLayout: { backend: 'elk' } }, samples: [sample] }
  const after = { ...common, renderOptions: { graphLayout: { backend: 'agentic' } }, samples: [sample] }
  const directory = temporary.dir()
  for (const [index, pair] of [
    [{ ...before, samples: [] }, { ...after, samples: [] }],
    [before, { ...after, samples: [{ ...sample, metrics: { ...sample.metrics, edgeCrossings: null } }] }],
  ].entries()) {
    const left = join(directory, `before-${index}.json`), right = join(directory, `after-${index}.json`), out = join(directory, `report-${index}.html`)
    writeFileSync(left, JSON.stringify(pair[0])); writeFileSync(right, JSON.stringify(pair[1]))
    const child = Bun.spawnSync([process.execPath, new URL('./run.ts', import.meta.url).pathname, 'report', '--before', left, '--after', right, '--comparison', 'backend', '--out', out], { timeout: 10_000 })
    expect(child.exitCode).not.toBe(0)
    expect(new TextDecoder().decode(child.stderr)).toContain('Invalid layout comparison')
    expect(existsSync(out)).toBe(false)
  }
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
