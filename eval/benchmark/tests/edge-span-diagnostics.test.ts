import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diagnosticInputs } from '../edge-span-diagnostics.ts'
import { instrumentExpansionSource, instrumentedModules } from '../edge-span-diagnostics-transform.ts'
import { begin, expansion, normalized, end, summarizeExpansionTrace, withExpansionTrace } from '../edge-span-diagnostics-collector.ts'

test('all owned transforms are exact, replayable and fail on source drift', () => {
  for (const name of instrumentedModules) {
    const path = join(import.meta.dir, '../../../src/layout', name), source = readFileSync(path, 'utf8')
    const record = instrumentExpansionSource(path, source, '/unpublished/evaluator.ts')
    expect(record.originalSha256).not.toBe(record.transformedSha256)
    expect(record.after).toContain('/unpublished/evaluator.ts')
    expect(record.after).toBe(instrumentExpansionSource(path, source, '/unpublished/evaluator.ts').after)
    expect(() => instrumentExpansionSource(path, source.replace(record.edits[0]!.anchor, ''), '/unpublished/evaluator.ts')).toThrow('exactly once')
  }
})

test('counter algebra separates physical normalization from authored graph', () => {
  const graph = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 0, target: 1, minSpan: 1, label: {} }], direction: 'TB' }
  const { trace } = withExpansionTrace({ id: 'calibration' }, () => {
    const frame = begin('layered', graph, { routingWork: { pairs: 10 } })
    expansion(frame, graph, new Uint32Array([0, 4]), 5)
    normalized(frame, 2, 5, 1, [[0, 2, 3, 4, 1]])
    end(frame)
  })
  const summary = summarizeExpansionTrace(trace)
  expect(summary.physicalPrivateVertices).toBe(3)
  expect(summary.physicalExpandedVertices).toBe(5)
  expect(summary.physicalExpandedArcs).toBe(4)
  expect(summary.physicalLabelVertices).toBe(1)
  expect(trace.frames[0]!.ended).toBeDefined()
  expect(trace.frames[0]!.work).toEqual({})
})

test('cohort retains every bad cyclic case, all Architecture source cases and stress/decline controls', () => {
  const inputs = diagnosticInputs(), ids = new Set(inputs.map(input => input.id))
  for (const suffix of ['11', '15', '19', '9', '13', '18-cuts']) expect(ids.has(`flowchart:cyclic-labelled-${suffix}`)).toBe(true)
  for (const index of [0, 1, 2, 3, 4, 5]) expect(ids.has(`corpus/architecture/${index}`)).toBe(true)
  expect(ids.has('calibration/invalid-endpoint')).toBe(true)
  expect(ids.has('calibration/rank-limit')).toBe(true)
  expect(ids.has('stress/all-labels/compact-true')).toBe(true)
  expect(ids.size).toBe(inputs.length)
})

test('exclusive work subtracts shared identities and does not confuse optional routing budgets', () => {
  const graph = { nodes: [], edges: [], direction: 'TB' }, primary = { pairs: 10 }, optional = { pairs: 10 }
  const { trace } = withExpansionTrace({}, () => {
    const parent = begin('parent', graph, { routingWork: primary, search: { routing: optional } })
    const child = begin('child', graph, { routingWork: optional })
    optional.pairs -= 2
    end(child); end(parent)
  })
  const phase = summarizeExpansionTrace(trace).phases.find(p => p.kind === 'parent')!
  expect(phase.inclusiveWorkUsed['routingWork.pairs']).toBe(0)
  expect(phase.inclusiveWorkUsed['search.routing.pairs']).toBe(2)
  expect(phase.exclusiveWorkUsed['routingWork.pairs']).toBe(0)
  expect(phase.exclusiveWorkUsed['search.routing.pairs']).toBe(0)
})


test('route-emission transform preserves placement-only branching and reports its skipped points', () => {
  const path = join(import.meta.dir, '../../../src/layout/agentic-layered-core.ts'), source = readFileSync(path, 'utf8')
  const record = instrumentExpansionSource(path, source, '/unpublished/evaluator.ts')
  const declaration = '  const positionedEdges = input.placementOnly && !input.cycleOriented && !input.loopPorts?.length'
  expect(record.after.split(declaration).length).toBe(2)
  expect(record.after).toContain('? edges.map(() => ({ points: [] as Point[] })) : edges.map((_, edgeIndex) => {')
  expect(record.after).toContain('skippedForPlacement: !!(input.placementOnly && !input.cycleOriented && !input.loopPorts?.length)')
  expect(() => instrumentExpansionSource(path, source.replace(declaration, '  const positionedEdges = edges.map'), '/unpublished/evaluator.ts')).toThrow('exactly once')
})
