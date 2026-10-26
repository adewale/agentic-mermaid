import { describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { consumePeerOutput, finalizeTrackObservation, emptyTrackObservation, inspectPeerSemantics, parsePeerTracks, peerTrackVariant, peerRuntimeDependencyGraph, percentile, peerExecutionEnvironment } from '../peer-tracks.ts'
import * as protocol from '../peer-tracks.ts'
import { measurePeerTrack } from '../peer-track-worker.ts'
import { coldTrackGroups, combineColdTrackRows, pairedColdTrackSchedule } from '../peer-track-schedule.ts'
import { sequence300StudyInput } from '../peer-sequence300-input.ts'
import { releaseBenchCases } from '../release-bench-cases.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(10_000)

const input = { id: 'flow5', source: 'flowchart TD\n A[Start] --> B[End]', expected: ['Start', 'End'] }
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="20" height="20"/><g data-id="A"/><g data-id="B"/><path d="M0 0L10 10" data-from="A" data-to="B"/><text>Start</text><text>End</text></svg>'
const track = { phase: 'exact-repeat', consumer: 'svg-utf8', round: 0, samples: 21, allocationSamples: 3, maxCaseMs: 1000 } as const

async function captureVariantStreams(phase: 'warm-new-source' | 'label-edit', callMs: number, options: { warmCalls: number; warmupMs: number; samples: number; maxCaseMs: number }) {
  let ticks = 0
  const sources: string[] = [], timed: string[] = [], allocations: string[] = []
  let diagnostic: string | undefined
  const clock = spyOn(performance, 'now').mockImplementation(() => ticks)
  try {
    const row = await measurePeerTrack({ peer: 'fake', input, track: { ...track, ...options, phase, allocationSamples: 1 },
      render(source) {
        ticks += callMs
        sources.push(source)
        const nodes = [...source.matchAll(/([A-Za-z_]\w*)\[([^\]]+)\]/g)]
        const [from, to] = nodes.map(match => match[1]!)
        if ((globalThis as Record<symbol, unknown>)[Symbol.for('agentic-mermaid.performance-observer.v1')]) diagnostic = source
        return svg.replaceAll('data-id="A"', `data-id="${from}"`).replaceAll('data-id="B"', `data-id="${to}"`)
          .replace('data-from="A" data-to="B"', `data-from="${from}" data-to="${to}"`).replace('<text>Start</text>', `<text>${nodes[0]![2]}</text>`)
      },
      validate: () => ({ missing: [] }),
      progress() { timed.push(sources.at(-1)!) },
      async allocation(run) { await run(); allocations.push(sources.at(-1)!); return 1000 },
    })
    return { row, sources, timed, allocations, diagnostic }
  } finally { clock.mockRestore() }
}

describe('maintained consumed peer protocol', () => {
  test('explicit Sequence300 stress selection reuses canonical source and labels without entering default cohorts', async () => {
    expect(sequence300StudyInput(new Map())).toBeUndefined()
    for (const args of [
      [['sequence300', 'true']],
      [['sequence300', 'true'], ['tracks', 'warm-new-source']],
      [['sequence300', 'true'], ['tracks', 'warm-new-source'], ['workloads', 'seq20']],
      [['sequence300', 'true'], ['tracks', 'warm-new-source'], ['workloads', 'seq300'], ['corpus', 'true']],
    ]) expect(() => sequence300StudyInput(new Map(args as [string, string][]))).toThrow('--sequence300 requires')
    const study = sequence300StudyInput(new Map([['sequence300', 'true'], ['tracks', 'warm-new-source'], ['workloads', 'seq20,seq300']]))!
    const canonical = releaseBenchCases().find(input => input.id === 'sequence:20-participants-300-messages')!
    expect(study.source).toBe(canonical.source)
    expect(study.expected).toBe(canonical.expectedSvgLabels!)
    expect(study.releaseCaseId).toBe(canonical.id)
    expect(study.reproductionArgs).toEqual(['--sequence300'])
    expect(study.expected).toHaveLength(300)
    expect(study.expected.at(-1)).toBe('message 299')
    const pairs = [...study.source.matchAll(/(P\d+)->>(P\d+):/g)]
    expect(pairs).toHaveLength(300)
    const nodes = [...new Set(pairs.flatMap(pair => [pair[1]!, pair[2]!]))]
    expect(nodes).toHaveLength(20)
    expect(protocol.PEER_EXPECTED_LABELS).not.toHaveProperty('seq300')
    expect(protocol.PEER_FROZEN_COHORT).not.toContain('seq300')
    const edit = peerTrackVariant(study, 'label-edit', 2)
    expect(edit.source).toContain('P0->>P1: q2')
    expect(edit.expected[0]).toBe('q2')
    const fresh = peerTrackVariant(study, 'warm-new-source', 3)
    expect(fresh.source).toContain('v3_P0->>v3_P1: q3')
    expect(fresh.source).not.toMatch(/\bP\d+\b/)
    const rendered = `<svg>${nodes.map(id => `<g data-id="${id}"/>`).join('')}${pairs.map(pair => `<path d="M0 0L10 10" data-from="${pair[1]}" data-to="${pair[2]}"/>`).join('')}</svg>`
    expect(inspectPeerSemantics(rendered, study, true).ok).toBe(true)
    expect(inspectPeerSemantics(rendered.replaceAll('data-to="P1"', 'data-to="P0"'), study, true).ok).toBe(false)
    const child = await runChild(process.execPath, [resolve(import.meta.dir, '../peer-bench.ts'), '--sequence300', '--workloads', 'seq300', '--tracks', 'warm-new-source', '--peers', 'not-a-real-peer'], { cwd: resolve(import.meta.dir, '../../..') })
    expect(child.status).toBe(1)
    expect(child.stderr).toContain('Unknown peer not-a-real-peer')
    expect(child.stdout).toBe('')
  })
  test('records only known runtime selectors while preserving explicit empty experiments', () => {
    expect(peerExecutionEnvironment({})).toEqual({ experiments: null, nodeOptions: null, bunOptions: null, nodeEnv: null, timezone: null })
    const policy = peerExecutionEnvironment({ AGENTIC_MERMAID_EXPERIMENTS: '', NODE_OPTIONS: '--max-old-space-size=4096', UNRELATED_SECRET: 'must-not-appear' })
    expect(policy.experiments).toBe('')
    expect(policy.nodeOptions).toBe('--max-old-space-size=4096')
    expect(policy).not.toHaveProperty('UNRELATED_SECRET')
  })
  test('real label edits preserve IDs; new sources rename IDs consistently', () => {
    const edit = peerTrackVariant(input, 'label-edit', 8)
    expect(edit.source).toBe('flowchart TD\n A[q8] --> B[End]')
    expect(edit.expected).toEqual(['q8', 'End'])
    const fresh = peerTrackVariant(input, 'warm-new-source', 9)
    expect(fresh.source).toBe('flowchart TD\n v9_A[q9] --> v9_B[End]')
    expect(peerTrackVariant(input, 'exact-repeat', 10).source).toBe(input.source)
    expect(parsePeerTracks('label-edit,exact-repeat')).toEqual(['label-edit', 'exact-repeat'])
    expect(() => parsePeerTracks('cold')).toThrow('--tracks')
    expect(protocol.parsePeerConsumers?.('receipt-json-utf8')).toEqual(['receipt-json-utf8'])
    expect(protocol.parsePeerConsumers?.('svg-utf8,receipt-json-utf8')).toEqual(['svg-utf8', 'receipt-json-utf8'])
    expect(() => protocol.parsePeerConsumers('receipt')).toThrow('--track-consumers')
  })
  test.each([
    { id: 'class80', source: 'classDiagram\n C0 <|-- C1', edited: 'classDiagram\n C0 <|-- C1 : q3', fresh: 'classDiagram\n v3_C0 <|-- v3_C1 : q3', from: 'C0', to: 'C1' },
    { id: 'er40', source: 'erDiagram\n E0 ||--o{ E1 : has', edited: 'erDiagram\n E0 ||--o{ E1 : q3', fresh: 'erDiagram\n v3_E0 ||--o{ v3_E1 : q3', from: 'E0', to: 'E1' },
    { id: 'state80', source: 'stateDiagram-v2\n S0 --> S1: e0', edited: 'stateDiagram-v2\n S0 --> S1 : q3', fresh: 'stateDiagram-v2\n v3_S0 --> v3_S1 : q3', from: 'S0', to: 'S1' },
  ])('$id edits a real relationship label while preserving nodes and direction', fixture => {
    const graph = { id: fixture.id, source: fixture.source, expected: [fixture.from, fixture.to] }
    const edit = peerTrackVariant(graph, 'label-edit', 3)
    expect(edit.source).toBe(fixture.edited)
    expect(edit.expected).toEqual([fixture.from, fixture.to, 'q3'])
    const fresh = peerTrackVariant(graph, 'warm-new-source', 3)
    expect(fresh.source).toBe(fixture.fresh)
    expect(fresh.expected).toEqual([`v3_${fixture.from}`, `v3_${fixture.to}`, 'q3'])
    const graphSvg = svg.replaceAll('data-id="A"', `data-id="${fixture.from}"`).replaceAll('data-id="B"', `data-id="${fixture.to}"`).replace('data-from="A" data-to="B"', `data-from="${fixture.from}" data-to="${fixture.to}"`)
    expect(inspectPeerSemantics(graphSvg, edit, true).ok).toBe(true)
    expect(inspectPeerSemantics(graphSvg.replace(`data-to="${fixture.to}"`, `data-to="${fixture.from}"`), edit, true).failures).toContain('1 authored directed endpoint pairs absent')
  })
  test('semantic contract rejects text-only SVG and missing directed endpoints', () => {
    expect(inspectPeerSemantics(svg, input).ok).toBe(true)
    expect(inspectPeerSemantics(svg.replace('data-to="B"', 'data-to="A"'), input).failures).toContain('1 authored directed endpoint pairs absent')
    expect(inspectPeerSemantics(svg.replace(/<path[^>]*\/>/, ''), input, true).failures).toContain('peer does not expose data-from/data-to relations')
    expect(inspectPeerSemantics('<svg><text>Start End</text></svg>', input).failures).toContain('no nonempty drawable geometry')
    const unobservable = inspectPeerSemantics('<svg><rect width="1" height="1"/></svg>', input)
    expect(unobservable.ok).toBe(false)
    expect(unobservable.unsupported).toContain('peer does not expose data-from/data-to relations')
    const er = { id: 'er40', source: 'erDiagram\n E0 ||--o{ E1 : has', expected: ['E0', 'E1'] }
    const erSvg = svg.replaceAll('data-id="A"', 'data-id="E0"').replaceAll('data-id="B"', 'data-id="E1"').replace('data-from="A" data-to="B"', 'data-entity1="E0" data-entity2="E1"')
    expect(inspectPeerSemantics(erSvg, er).ok).toBe(true)
    expect(inspectPeerSemantics(erSvg.replace('data-entity2="E1"', 'data-entity2="E0"'), er).failures).toContain('1 authored directed endpoint pairs absent')
  })
  test.each([
    { id: 'flow5', source: 'flowchart TD\n A_X[Start] --> B[End]\n A_X --> B\n B --> A_X', nodes: ['A_X', 'B'], edges: ['L_A_X_B_0', 'L_A_X_B_2', 'L_B_A_X_0'] },
    { id: 'class80', source: 'classDiagram\n class C_0 {\n +int field0\n +method0()\n }\n C_0 <|-- C1\n C1 <|-- C_0', nodes: ['C_0', 'C1'], edges: ['id_C_0_C1_1', 'id_C1_C_0_2'] },
    { id: 'er40', source: 'erDiagram\n E_0 {\n int id PK\n string name0\n }\n E_0 ||--o{ E1 : has\n E1 ||--o{ E_0 : has', nodes: ['E_0', 'E1'], edges: ['id_entity-E_0-0_entity-E1-1_0', 'id_entity-E1-1_entity-E_0-0_1'] },
  ])('pinned Pele $id adapter observes owned wrapper identities and directed multiplicity', fixture => {
    const graph = { id: fixture.id, source: fixture.source, expected: fixture.nodes }
    const edge = (id: string) => `<g class="pele-edge" data-id="${id}"><path d="M0 0L10 10"/></g>`
    const rendered = `<svg><g class="pele-edges" fill="none" stroke="#111">${fixture.edges.map(edge).join('')}</g>${fixture.nodes.map(id => `<g class="pele-node" data-id="${id}"><rect width="10" height="10"/></g>`).join('')}<g class="pele-edge-label" data-id="${fixture.edges[0]}"><text>has</text></g></svg>`
    const inspect = (value: string, source: string = graph.source) => inspectPeerSemantics(value, { ...graph, source }, false, 'pele-1.9.0-rendered-ids-v1')
    expect(inspect(rendered).ok).toBe(true)
    expect(inspectPeerSemantics(rendered, graph).ok).toBe(false) // frozen generic method is unchanged
    expect(inspect(rendered.replace(edge(fixture.edges[0]!), '')).ok).toBe(false)
    expect(inspect(rendered.replace(edge(fixture.edges[0]!), edge(fixture.edges[1]!))).ok).toBe(false)
    expect(inspect(rendered.replace('d="M0 0L10 10"', 'd="M0 0"')).failures).toContain('Pele edge wrapper has no nonempty owned path')
    for (const shaft of ['<path d="M0 0L0 0"/>', '<path d="M0 0M10 10"/>', '<path d="M0 0L0 0M10 10L10 10"/>', '<defs><path d="M0 0L10 10"/></defs>', '<!--<path d="M0 0L10 10"/>-->', '<![CDATA[<path d="M0 0L10 10"/>]]>', '<path visibility="hidden" d="M0 0L10 10"/>', '<path stroke="none" d="M0 0L10 10"/>', '<path stroke="#0000" d="M0 0L10 10"/>', '<path stroke="rgba(0,0,0,0)" d="M0 0L10 10"/>', '<path stroke-dasharray="0 99999" d="M0 0L10 10"/>']) {
      expect(inspect(rendered.replace('<path d="M0 0L10 10"/>', shaft)).ok).toBe(false)
    }
    expect(inspect(rendered.replace(edge(fixture.edges[0]!), `<text>${edge(fixture.edges[0]!)}</text>`)).ok).toBe(false)
    const variableStroke = rendered.replace('<svg>', '<svg style="--_l:var(--pele-line,#1f1f1f)">').replace('stroke="#111"', 'stroke="var(--_l)"')
    expect(inspect(variableStroke).ok).toBe(true)
    expect(inspect(variableStroke.replace('style="--_l:var(--pele-line,#1f1f1f)"', 'style="--_l:var(--pele-line,#1f1f1f);--_l:#0000"')).ok).toBe(false)
    expect(inspect(rendered.replace(`data-id="${fixture.nodes[0]}"`, `data-id="${fixture.nodes[1]}"`)).ok).toBe(false)
    // Keep every label and identity string: change an actual wrapper endpoint.
    const wrong = fixture.id === 'flow5' ? 'L_A_X_A_X_0' : fixture.id === 'class80' ? 'id_C_0_C_0_1' : 'id_entity-E_0-0_entity-E_0-0_0'
    expect(inspect(rendered.replace(edge(fixture.edges[0]!), edge(wrong))).failures).toContain('Pele rendered directed endpoint multiset differs from authored relations')
    expect(inspect(rendered, graph.source + '\n click A_X "https://example.com"').ok).toBe(false)
    expect(inspectPeerSemantics(rendered, graph, false, 'pele-1.9.1-rendered-ids-v1').ok).toBe(false)
    if (fixture.id !== 'flow5') {
      const declared = graph.source + `\n ${fixture.id === 'class80' ? 'class ' : ''}Isolated {\n ${fixture.id === 'class80' ? '+' : ''}int value\n }`
      expect(inspect(rendered.replace('</svg>', '<text>Isolated</text></svg>'), declared).ok).toBe(false)
      expect(inspect(rendered.replace('</svg>', '<g class="pele-node" data-id="Isolated"><rect width="10" height="10"/></g></svg>'), declared).ok).toBe(true)
    }
  })
  test('Pele leaves ambiguous encodings and Sequence/State endpoints unqualified', () => {
    const graph = { id: 'flow5', source: 'flowchart TD\n A_B --> C\n A --> B_C', expected: [] }
    const rendered = '<svg><g class="pele-edge" data-id="L_A_B_C_0"><path d="M0 0L10 10"/></g><g class="pele-edge" data-id="L_A_B_C_2"><path d="M0 0L10 10"/></g>' + ['A_B', 'C', 'A', 'B_C'].map(id => `<g class="pele-node" data-id="${id}"/>`).join('') + '</svg>'
    const ambiguous = inspectPeerSemantics(rendered, graph, false, 'pele-1.9.0-rendered-ids-v1')
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.unsupported).toContain('ambiguous Pele rendered endpoint identity encoding')
    for (const [id, source, edgeId] of [['seq20', 'sequenceDiagram\n A->>B: unchanged', 'i0'], ['state80', 'stateDiagram-v2\n A --> B: unchanged', 'edge0']]) {
      const unobservable = inspectPeerSemantics(`<svg><g class="pele-edge" data-id="${edgeId}"><path d="M0 0L10 10"/></g></svg>`, { id: id!, source: source!, expected: ['unchanged'] }, false, 'pele-1.9.0-rendered-ids-v1')
      expect(unobservable.ok).toBe(false)
      expect(unobservable.failures).toEqual([])
      expect(unobservable.unsupported).toContain('pele-1.9.0-rendered-ids-v1: rendered endpoints unobservable for this family or source grammar')
    }
  })
  test('consumes complete UTF8 and evaluates serialized receipt getters', () => {
    let reads = 0
    const value = { svg: svg.replace('Start', '東京'), get receipt() { reads++; return { deeply: { bound: '東京', fields: [1, 2, 3] } } } }
    const consumed = consumePeerOutput(value, 'receipt-json-utf8')
    expect(reads).toBeGreaterThan(0)
    expect(consumed.bytes).toBe(Buffer.byteLength(JSON.stringify(value)))
    expect(consumed.checksum).toBeGreaterThan(0)
    expect(() => consumePeerOutput({ svg }, 'receipt-json-utf8')).toThrow('receipt')
  })
  test('preserves the frozen UTF8 byte count and unsigned rolling checksum', () => {
    const document = '<svg>é 👩‍💻 &amp; \ud800</svg>'
    expect(consumePeerOutput(document, 'svg-utf8')).toMatchObject({ bytes: 35, checksum: 1427285939 })
    const complete = { svg: document, receipt: { notes: ['naïve', null, 17], nested: { accepted: true } } }
    expect(consumePeerOutput(complete, 'receipt-json-utf8')).toMatchObject({ bytes: 114, checksum: 1212775879 })
  })
  test('keeps per-call tails, repeated allocation and observer only during replay', async () => {
    const observerKey = Symbol.for('agentic-mermaid.performance-observer.v1')
    const global = globalThis as unknown as Record<symbol, ((event: object) => void) | undefined>
    let diagnostics = 0
    let allocations = 0
    let validations = 0
    const result = await measurePeerTrack({ peer: 'fake', input, track,
      render(source) {
        expect(source).toBe(input.source)
        if (global[observerKey]) { diagnostics++; global[observerKey]!({ version: 1, kind: 'scope', owner: 'graphical' }) }
        return svg
      },
      async allocation(run) { expect(global[observerKey]).toBeUndefined(); allocations++; await run(); return 100 + allocations },
      validate() { validations++; expect(global[observerKey]).toBeUndefined(); return { missing: [] } },
    })
    expect(result.callSamplesMs).toHaveLength(21)
    expect(result.calls).toHaveLength(21)
    expect(result.allocationSamplesBytes).toEqual([101, 102, 103])
    expect(result.insufficientSamples).toBe(false)
    expect(result.status).toBe('ok')
    expect(validations).toBe(28)
    expect(diagnostics).toBe(1)
    expect(result.diagnostics.complete).toBe(true)
    expect(result.diagnostics.counts).toEqual({ 'scope:graphical': 1 })
    expect(global[observerKey]).toBeUndefined()
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100)
  })
  test('warm sampling waits for both minimum calls and elapsed priming time', async () => {
    let ticks = 0, calls = 0, firstTimedCalls = 0
    const clock = spyOn(performance, 'now').mockImplementation(() => ticks)
    try {
      const row = await measurePeerTrack({ peer: 'fake', input, track: { ...track, warmCalls: 2, warmupMs: 5, samples: 2, allocationSamples: 0 },
        render() { calls++; ticks++; return svg }, validate: () => ({ missing: [] }),
        progress(row) { if (row.calls.length === 1) firstTimedCalls = calls },
      })
      expect(firstTimedCalls).toBe(6)
      expect(row.warmup).toEqual({ calls: 5, elapsedMs: 5, complete: true })
      expect(row.callSamplesMs).toEqual([1, 1])
      expect(calls).toBe(8) // five warm, two timed, one diagnostic
    } finally { clock.mockRestore() }
  })
  test('an incomplete warmup fails before any timed or allocation observation', async () => {
    let ticks = 0, calls = 0
    const clock = spyOn(performance, 'now').mockImplementation(() => ticks)
    try {
      const row = await measurePeerTrack({ peer: 'fake', input, track: { ...track, warmCalls: 20, warmupMs: 1000, maxCaseMs: 3 },
        render() { calls++; ticks++; return svg }, validate: () => ({ missing: [] }),
      })
      expect(calls).toBe(3)
      expect(row.status).toBe('error')
      expect(row.warmup).toEqual({ calls: 3, elapsedMs: 3, complete: false })
      expect(row.callSamplesMs).toEqual([])
      expect(row.allocationSamplesBytes).toEqual([])
      expect(row.calls[0]!.detail).toContain('warmup reached its case deadline')
    } finally { clock.mockRestore() }
  })
  test.each(['warm-new-source', 'label-edit'] as const)('%s pairs actual input bytes despite unequal warmup counts', async phase => {
    const options = { warmCalls: 20, warmupMs: 50, samples: 2, maxCaseMs: 100 }
    const fast = await captureVariantStreams(phase, 1, options)
    const slow = await captureVariantStreams(phase, 2, options)
    const expected = phase === 'warm-new-source'
      ? ['flowchart TD\n v1_A[q1] --> v1_B[End]', 'flowchart TD\n v2_A[q2] --> v2_B[End]']
      : ['flowchart TD\n A[q1] --> B[End]', 'flowchart TD\n A[q2] --> B[End]']
    expect(fast.row.warmup!.calls).not.toBe(slow.row.warmup!.calls)
    for (const observed of [fast, slow]) {
      expect(observed.row.status).toBe('ok')
      const priming = observed.sources.slice(0, observed.row.warmup!.calls)
      expect(new Set(priming).size).toBe(observed.row.warmup!.calls)
      expect(priming.at(-1)).toBe(phase === 'warm-new-source'
        ? `flowchart TD\n w${observed.row.warmup!.calls}_A[w${observed.row.warmup!.calls.toString(36)}] --> w${observed.row.warmup!.calls}_B[End]`
        : `flowchart TD\n A[w${observed.row.warmup!.calls.toString(36)}] --> B[End]`)
      expect(observed.timed).toEqual(expected)
      expect(observed.row.calls.map(call => [call.variant, call.domain])).toEqual([[1, 'timing'], [2, 'timing']])
      for (const source of observed.timed) expect(observed.sources.filter(value => value === source)).toHaveLength(1)
      expect(observed.allocations).toEqual([phase === 'warm-new-source' ? 'flowchart TD\n a1_A[a1] --> a1_B[End]' : 'flowchart TD\n A[a1] --> B[End]'])
      expect(observed.diagnostic).toBe(phase === 'warm-new-source' ? 'flowchart TD\n d1_A[d1] --> d1_B[End]' : 'flowchart TD\n A[d1] --> B[End]')
    }
  })
  test('a timing deadline cannot shift allocation or diagnostic source inputs', async () => {
    const options = { warmCalls: 0, warmupMs: 0, samples: 4, maxCaseMs: 100 }
    const complete = await captureVariantStreams('warm-new-source', 1, options)
    const shortened = await captureVariantStreams('warm-new-source', 1, { ...options, maxCaseMs: 2 })
    expect(complete.timed).toHaveLength(4)
    expect(shortened.timed).toHaveLength(3)
    expect(shortened.timed).toEqual(complete.timed.slice(0, 3))
    expect(shortened.allocations).toEqual(complete.allocations)
    expect(shortened.diagnostic).toBe(complete.diagnostic)
    expect(shortened.row.insufficientSamples).toBe(true)
    expect(shortened.row.status).toBe('error')
    expect(shortened.row.detail).toBe('incomplete timing population: expected 4, observed 3')
  })
  test('cold call does not warm first, and unavailable receipts remain explicit', async () => {
    let calls = 0
    const cold = await measurePeerTrack({ peer: 'fake', input, track: { ...track, phase: 'first-use' }, render: () => { calls++; return svg }, validate: () => ({ missing: [] }) })
    expect(calls).toBe(1)
    expect(cold.callSamplesMs).toHaveLength(1)
    expect(cold.insufficientSamples).toBe(true)
    expect(cold.allocationUnsupported).toContain('fresh-process')
    const unavailable = await measurePeerTrack({ peer: 'fake', input, track: { ...track, consumer: 'receipt-json-utf8' }, validate: () => ({ missing: [] }) })
    expect(unavailable.status).toBe('unsupported')
    expect(unavailable.counts).toEqual({ ok: 0, unsupported: 1, lostLabels: 0, errors: 0 })
  })
  test.each(['allocation', 'diagnostic'] as const)('cold %s is the first and only render and cannot supply timing samples', async coldProbe => {
    const key = Symbol.for('agentic-mermaid.performance-observer.v1')
    const global = globalThis as unknown as Record<symbol, ((event: object) => void) | undefined>
    let calls = 0, probes = 0, validations = 0
    const row = await measurePeerTrack({ peer: 'fake', input, track: { ...track, phase: 'first-use', coldProbe },
      render() {
        expect(calls++).toBe(0)
        if (coldProbe === 'diagnostic') {
          expect(global[key]).toBeFunction()
          global[key]!({ version: 1, kind: 'scope', owner: 'graphical' })
          global[key]!({ version: 1, kind: 'cache', owner: 'elk', outcome: 'miss' })
        } else expect(global[key]).toBeUndefined()
        return svg
      },
      async allocation(run) {
        expect(calls).toBe(0)
        expect(validations).toBe(0)
        probes++
        await run()
        expect(validations).toBe(0)
        return 1234
      },
      validate() { validations++; return { missing: [] } },
    })
    expect(calls).toBe(1)
    expect(validations).toBe(1)
    expect(row.callSamplesMs).toEqual([])
    expect(row.calls).toHaveLength(1)
    expect(row.calls[0]!.elapsedMs).toBeUndefined()
    expect(row.semantic.ok).toBe(true)
    expect(probes).toBe(coldProbe === 'allocation' ? 1 : 0)
    expect(row.allocationSamplesBytes).toEqual(coldProbe === 'allocation' ? [1234] : [])
    expect(row.diagnostics.complete).toBe(coldProbe === 'diagnostic')
    if (coldProbe === 'diagnostic') expect(row.diagnostics.counts['cache:elk:miss']).toBe(1)
    expect(global[key]).toBeUndefined()
  })
  test('a failed first-use allocation stays an error with no numeric observation', async () => {
    const row = await measurePeerTrack({ peer: 'fake', input, track: { ...track, phase: 'first-use', coldProbe: 'allocation' },
      render: () => { throw new Error('first render failed') }, allocation: async run => { await run(); return 999 }, validate: () => ({ missing: [] }),
    })
    expect(row.status).toBe('error')
    expect(row.allocationErrors).toEqual(['first render failed'])
    expect(row.allocationSamplesBytes).toEqual([])
    expect(row.callSamplesMs).toEqual([])
  })
  test('scope followed by a failed replay cannot qualify diagnostics', async () => {
    const observerKey = Symbol.for('agentic-mermaid.performance-observer.v1')
    const global = globalThis as unknown as Record<symbol, ((event: object) => void) | undefined>
    const result = await measurePeerTrack({ peer: 'fake', input, track: { ...track, samples: 3, allocationSamples: 0 },
      render() {
        if (global[observerKey]) { global[observerKey]!({ version: 1, kind: 'scope', owner: 'graphical' }); throw new Error('replay failed') }
        return svg
      }, validate: () => ({ missing: [] }),
    })
    expect(result.status).toBe('ok')
    expect(result.diagnostics.status).toBe('observed')
    expect(result.diagnostics.complete).toBe(false)
    expect(result.diagnostics.detail).toBe('replay failed')
  })
  test('bundled worker resolves harness XML parser and retains raw individual calls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'peer-track-owner-'))
    const root = resolve(import.meta.dir, '../../..')
    try {
      const bundle = join(dir, 'worker.mjs'), entry = join(dir, 'renderer.mjs'), job = join(dir, 'job.json'), out = join(dir, 'out.jsonl')
      const built = await runChild(process.execPath, ['build', join(root, 'eval/benchmark/peer-bench.ts'), '--target=node', '--format=esm', '--outfile', bundle], { cwd: root })
      expect({ status: built.status, stderr: built.stderr }).toEqual({ status: 0, stderr: '' })
      writeFileSync(entry, `export const renderMermaidSVG = () => ${JSON.stringify(svg)}; export const renderMermaidSVGWithReceipt = () => ({svg:renderMermaidSVG(), receipt:{complete:[1,2,3]}})`)
      writeFileSync(job, JSON.stringify({ peer: 'agentic-baseline', output: 'svg', entry, timing: { warmCalls: 1, warmupMs: 0, samples: 3, minSampleMs: 0, maxCaseMs: 100 }, track: { ...track, samples: 3, consumer: 'receipt-json-utf8' }, workloads: [input] }))
      writeFileSync(out, '')
      const child = await runChild('node', ['--expose-gc', bundle, '--child', '--job', job, '--out', out], { cwd: root })
      expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
      const rows = readFileSync(out, 'utf8').trim().split('\n').map(line => JSON.parse(line))
      expect(rows.filter(row => row.type === 'progress').every(row => row.observation.consumedBytes > 0)).toBe(true)
      expect(rows.find(row => row.type === 'track').observation).toMatchObject({ peer: 'agentic-baseline', status: 'ok', counts: { ok: 3 }, insufficientSamples: true })
      expect(rows.find(row => row.type === 'track').observation.allocationSamplesBytes).toHaveLength(3)
      writeFileSync(entry, `export const renderMermaidSVG = () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3); return ${JSON.stringify(svg)} }; export const renderMermaidSVGWithReceipt = () => ({svg:renderMermaidSVG(), receipt:{complete:[1,2,3]}})`)
      writeFileSync(job, JSON.stringify({ peer: 'agentic-baseline', output: 'svg', entry, timing: { warmCalls: 0, warmupMs: 0, samples: 3, minSampleMs: 0, maxCaseMs: 1 }, track: { ...track, samples: 3, warmCalls: 0, maxCaseMs: 1, consumer: 'receipt-json-utf8' }, workloads: [input] }))
      writeFileSync(out, '')
      const shortened = await runChild('node', ['--expose-gc', bundle, '--child', '--job', job, '--out', out], { cwd: root })
      expect({ status: shortened.status, stderr: shortened.stderr }).toEqual({ status: 0, stderr: '' })
      const truncated = readFileSync(out, 'utf8').trim().split('\n').map(line => JSON.parse(line)).find(row => row.type === 'track').observation
      expect(truncated).toMatchObject({ status: 'error', detail: 'incomplete timing population: expected 3, observed 1' })
      expect(truncated.callSamplesMs).toHaveLength(1)
      expect(truncated.allocationSamplesBytes).toHaveLength(3)
      writeFileSync(entry, `let calls = 0; export const renderMermaidSVG = () => { if (++calls !== 1) throw new Error('warmed cold worker'); return ${JSON.stringify(svg)} }; export const renderMermaidSVGWithReceipt = () => ({svg:renderMermaidSVG(), receipt:{complete:[1,2,3]}})`)
      for (const coldProbe of ['timing', 'allocation', 'diagnostic']) {
        writeFileSync(job, JSON.stringify({ peer: 'agentic-baseline', output: 'svg', entry, timing: { warmCalls: 1, warmupMs: 0, samples: 3, minSampleMs: 0, maxCaseMs: 100 }, track: { ...track, phase: 'first-use', coldProbe, consumer: 'receipt-json-utf8' }, workloads: [input] }))
        writeFileSync(out, '')
        const cold = await runChild('node', ['--expose-gc', bundle, '--child', '--job', job, '--out', out], { cwd: root })
        expect({ status: cold.status, stderr: cold.stderr }).toEqual({ status: 0, stderr: '' })
        const observation = readFileSync(out, 'utf8').trim().split('\n').map(line => JSON.parse(line)).find(row => row.type === 'track').observation
        expect(observation.status).toBe('ok')
        expect(observation.calls).toHaveLength(1)
        expect(observation.callSamplesMs).toHaveLength(coldProbe === 'timing' ? 1 : 0)
        expect(observation.allocationSamplesBytes).toHaveLength(coldProbe === 'allocation' ? 1 : 0)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  test('runtime provenance excludes archive paths but retains dependency identities', () => {
    const graph = peerRuntimeDependencyGraph({ packages: {
      '': { version: '1.0.0' }, 'node_modules/agentic-mermaid': { version: '9.0.0' },
      'node_modules/z': { version: '2.0.0', integrity: 'sha512-z' }, 'node_modules/a': { version: '1.0.0', link: true },
    } })
    expect(graph).toEqual([{ path: 'node_modules/a', version: '1.0.0', integrity: null, link: true }, { path: 'node_modules/z', version: '2.0.0', integrity: 'sha512-z', link: false }])
    expect(peerRuntimeDependencyGraph({ packages: { 'node_modules/a': { version: '2.0.0', link: true }, 'node_modules/z': { version: '2.0.0', integrity: 'sha512-z' } } })).not.toEqual(graph)
  })
  test('never silently drops errors or missing labels while aggregating tails', () => {
    const row = emptyTrackObservation('fake', 0, 'flow5', 'exact-repeat', 'svg-utf8')
    row.calls.push({ index: 0, variant: 0, status: 'ok', elapsedMs: 1 }, { index: 1, variant: 0, status: 'lost-labels', elapsedMs: 2, missing: 1 }, { index: 2, variant: 0, status: 'error', detail: 'bad XML' })
    finalizeTrackObservation(row)
    expect(row.status).toBe('error')
    expect(row.counts).toEqual({ ok: 1, unsupported: 0, lostLabels: 1, errors: 1 })
    expect(row.calls).toHaveLength(3)
    expect(row.callSamplesMs).toEqual([1])
  })
})
describe('first-use process scheduling', () => {
  test.each([undefined, 'paired-cold-ordinal-v1', 'unknown'] as const)('qualification forwards or rejects schedule %s before launching measurements', async requested => {
    const dir = mkdtempSync(join(tmpdir(), 'peer-qualification-schedule-'))
    const root = resolve(import.meta.dir, '../../..')
    try {
      const baseline = join(dir, 'baseline.tgz'), candidate = join(dir, 'candidate.tgz'), script = join(dir, 'qualification.mjs'), out = join(dir, 'out')
      const executable = join(dir, 'capture-child'), captured = join(dir, 'child-command.json')
      writeFileSync(baseline, 'baseline')
      writeFileSync(candidate, 'candidate')
      writeFileSync(executable, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(captured)}, JSON.stringify(process.argv.slice(2))); process.exit(1)`)
      chmodSync(executable, 0o755)
      writeFileSync(script, `
        import { mock } from 'bun:test'
        import { readFileSync } from 'node:fs'
        let installations = 0, error
        mock.module(${JSON.stringify(join(root, 'eval/benchmark/release-baseline.ts'))}, () => ({
          frozenRuntimePolicy: () => ({}), assertMatchedAgenticRuntimes() {},
          installAgenticRuntime() { installations++; return { runtime: {} } },
        }))
        process.argv = [process.execPath, ${JSON.stringify(join(root, 'eval/benchmark/qualify-peer-performance.ts'))}, ...process.argv.slice(2)]
        process.execPath = ${JSON.stringify(executable)}
        try { await import(${JSON.stringify(join(root, 'eval/benchmark/qualify-peer-performance.ts'))}) }
        catch (caught) { error = caught.message }
        let command
        try { command = JSON.parse(readFileSync(${JSON.stringify(captured)}, 'utf8')) } catch {}
        console.log(JSON.stringify({ command, installations, error }))
      `)
      const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
      const child = await runChild(process.execPath, [script, '--baseline-tarball', baseline, '--candidate-tarball', candidate, '--baseline-sha256', digest(baseline), '--candidate-sha256', digest(candidate), '--out', out, ...(requested === undefined ? [] : ['--track-schedule', requested])], { cwd: root })
      expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
      const result = JSON.parse(child.stdout)
      if (requested === 'unknown') {
        expect(result).toEqual({ installations: 0, error: '--track-schedule must be a known peer schedule' })
      } else {
        const schedule = requested ?? 'peer-block-v1'
        expect(result.installations).toBe(2)
        expect(result.command.slice(result.command.indexOf('--track-schedule'), result.command.indexOf('--track-schedule') + 2)).toEqual(['--track-schedule', schedule])
        expect(result.command.slice(result.command.indexOf('--candidate-tarball'), result.command.indexOf('--candidate-tarball') + 2)).toEqual(['--candidate-tarball', baseline])
        expect(result.error).toContain('aa-1 did not complete')
        const receipt = JSON.parse(readFileSync(join(out, 'qualification-status.json'), 'utf8'))
        expect(receipt).toMatchObject({ schedule, status: 'incomplete', complete: false, steps: [{ name: 'aa-1', command: result.command, exit: 1 }] })
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('comparison sides stay adjacent at each case/probe/ordinal and reverse without changing the population', () => {
    const jobs = pairedColdTrackSchedule(['candidate', 'baseline'], ['flow', 'sequence'], 21, 3, 0)
    expect(jobs).toHaveLength(100)
    const identities = new Set<string>()
    for (let index = 0; index < jobs.length; index += 2) {
      const a = jobs[index]!, b = jobs[index + 1]!
      expect(a.group).toEqual(b.group)
      expect([a.peer, b.peer]).toEqual(index % 4 === 0 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])
      for (const job of [a, b]) identities.add(`${job.peer}/${job.group.ids[0]}/${job.group.probe}/${job.group.sample}`)
    }
    expect(identities.size).toBe(100)
    for (const peer of ['candidate', 'baseline']) for (const id of ['flow', 'sequence']) {
      const groups = jobs.filter(job => job.peer === peer && job.group.ids[0] === id).map(job => job.group)
      expect(groups.filter(group => group.probe === 'timing').map(group => group.sample)).toEqual(Array.from({ length: 21 }, (_, i) => i))
      expect(groups.filter(group => group.probe === 'allocation').map(group => group.sample)).toEqual([0, 1, 2])
      expect(groups.filter(group => group.probe === 'diagnostic')).toHaveLength(1)
    }
    expect(pairedColdTrackSchedule(['candidate', 'baseline'], ['flow'], 21, 3, 1).slice(0, 2).map(job => job.peer)).toEqual(['baseline', 'candidate'])
    expect(coldTrackGroups(['flow', 'sequence'], 21, 3)).toHaveLength(50)
  })

  test('cold aggregation retains timing errors and untimed probes without inventing clocks or discarding failed diagnostics', () => {
    const row = () => emptyTrackObservation('agentic', 0, 'flow5', 'first-use', 'svg-utf8')
    const timed = row()
    timed.calls = [{ index: 0, variant: 0, status: 'ok', elapsedMs: 7, consumedBytes: 42, checksum: 9 }]
    const failed = row()
    failed.calls = [{ index: 0, variant: 0, status: 'error', detail: 'retained failure' }]
    const allocation = row()
    allocation.calls = [{ index: 0, variant: 0, status: 'ok', consumedBytes: 42, checksum: 9 }]
    allocation.allocationSamplesBytes = [123]
    const diagnostic = row()
    diagnostic.diagnostics = { status: 'observed', complete: false, counts: {}, events: [], detail: 'diagnostic failure' }
    const job = { phase: 'first-use', consumer: 'svg-utf8', round: 0, samples: 201, allocationSamples: 3, maxCaseMs: 180000 } as const
    const [combined] = combineColdTrackRows('agentic', ['flow5'], job, [timed, failed, allocation, diagnostic], new Map([['flow5', diagnostic.diagnostics]]))
    expect(combined!.calls.map(call => call.index)).toEqual([0, 1, 2])
    expect(combined!.callSamplesMs).toEqual([7])
    expect(combined!.allocationSamplesBytes).toEqual([123])
    expect(combined!.calls[1]!.detail).toBe('retained failure')
    expect(combined!.diagnostics.detail).toBe('diagnostic failure')
    expect(combined!.diagnostics.complete).toBe(false)
    expect(combined!.status).toBe('error')
    timed.diagnostics.detail = 'timing worker has already rendered'
    const [missing] = combineColdTrackRows('agentic', ['flow5'], job, [timed], new Map())
    expect(missing!.diagnostics).toEqual({ status: 'unobserved', complete: false, counts: {}, events: [] })
  })
})
