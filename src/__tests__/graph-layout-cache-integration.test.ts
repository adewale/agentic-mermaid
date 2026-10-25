import { expect, test } from 'bun:test'
import { borrowedPositioned, cachedPositioned, retainPositioned } from '../experimental/position-cache.ts'
import { graphLayoutDecisionsOf, retainGraphLayoutDecision } from '../layout/backend.ts'
import { isRetainedPixelText, preparePixelText } from '../shared/prepared-text.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)
const childOptions = {
  cwd: `${import.meta.dir}/../..`,
  env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', AGENTIC_MERMAID_ELK_CACHE: '1' },
}
const prelude = `
  import assert from 'node:assert/strict'
  import { renderMermaidSVGWithReceipt } from './src/index.ts'
  import { positionFamilyForNativeRender, positionResolvedFamily, retainedFamilyProjection } from './src/positioning.ts'
  import { receiptOf, resolveRenderRequestForExecution } from './src/render-contract.ts'
  import { graphLayoutDecisionsOf } from './src/layout/backend.ts'
  import { withPerformanceExperiments } from './src/experimental-performance.ts'
  import { withRenderStageObserver } from './src/render-stages.ts'
  const observe = run => {
    const stages = []
    const value = withRenderStageObserver(sample => stages.push(sample.stage), run)
    return { value, stages }
  }
  const decision = (request, selected, role) => {
    const receipt = receiptOf(request)
    assert.equal(receipt.layoutDecisions.length, 1)
    assert.equal(receipt.layoutDecisions[0].requested, 'agentic')
    assert.equal(receipt.layoutDecisions[0].selected, selected)
    assert.equal(receipt.layoutDecisions[0].role, role)
    return receipt.layoutDecisions[0]
  }
`

for (const family of ['flowchart', 'state'] as const) test(`native ${family} snapshot hits retain producer decisions, replay current roles and isolate public mutation`, async () => {
  const child = await runChild(process.execPath, ['-e', `${prelude}
    withPerformanceExperiments(['text-spans', 'position-cache'], () => {
      const family = ${JSON.stringify(family)}
      const source = (family === 'flowchart'
        ? ['flowchart TD', 'subgraph NativeCacheFrame[Stable frame]',
          ' NativeCacheA[Start] -->|kept label| NativeCacheB[Finish]', 'end']
        : ['stateDiagram-v2', 'state NativeCacheFrame {',
          ' NativeCacheA --> NativeCacheB: kept label', '}']).join(String.fromCharCode(10))
      const options = { graphLayout: { backend: 'agentic' } }
      const request = output => resolveRenderRequestForExecution(source, options, output)
      const firstRequest = request('svg')
      const first = observe(() => positionFamilyForNativeRender(firstRequest))
      assert.ok(first.stages.includes('agentic'))
      decision(firstRequest, 'agentic', 'primary')

      const hitRequest = request('svg')
      const hit = observe(() => positionFamilyForNativeRender(hitRequest))
      assert.deepEqual(hit.stages, [])
      assert.deepEqual(hit.value, first.value)
      assert.equal(graphLayoutDecisionsOf(hit.value).length, 1)
      decision(hitRequest, 'agentic', 'primary')
      const again = observe(() => positionFamilyForNativeRender(request('svg')))
      assert.deepEqual(again.stages, [])
      assert.strictEqual(again.value, hit.value)
      assert.strictEqual(retainedFamilyProjection(again.value), retainedFamilyProjection(hit.value))

      const companionRequest = request('ascii')
      const companion = observe(() => positionResolvedFamily(family, companionRequest))
      assert.deepEqual(companion.stages, [])
      assert.notStrictEqual(companion.value, hit.value)
      decision(companionRequest, 'agentic', 'companion')
      // The producer result is output-neutral; role belongs to this request.
      assert.equal(graphLayoutDecisionsOf(companion.value)[0].role, undefined)

      const publicRequest = request('svg')
      const exposed = observe(() => positionResolvedFamily(family, publicRequest))
      assert.deepEqual(exposed.stages, [])
      assert.notStrictEqual(exposed.value.positioned, hit.value.positioned)
      assert.equal(graphLayoutDecisionsOf(exposed.value).length, 1)
      decision(publicRequest, 'agentic', 'primary')
      const reference = renderMermaidSVGWithReceipt(source, options)
      exposed.value.positioned.nodes[0].label = 'poisoned public label'
      exposed.value.positioned.nodes[0].x = NaN
      exposed.value.positioned.edges[0].points[0].x = NaN
      exposed.value.positioned.groups[0].width = NaN
      const projection = retainedFamilyProjection(exposed.value)
      projection.edges[0].path[0][0] = NaN
      projection.nodes.length = 0
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), reference)
      assert.equal(Object.isFrozen(graphLayoutDecisionsOf(exposed.value)), true)
      assert.equal(Object.isFrozen(graphLayoutDecisionsOf(exposed.value)[0].attempts[0]), true)
    })
    console.log('native cache integration passed')
  `], childOptions)
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
  expect(child.stdout.trim()).toBe('native cache integration passed')
}, 30_000)

test('borrowed and public fallback hits notify each current request once and retain strict refusal', async () => {
  const child = await runChild(process.execPath, ['-e', `${prelude}
    withPerformanceExperiments(['text-spans', 'position-cache'], () => {
      const source = ['flowchart LR', 'subgraph FallbackCacheOuter', ' FallbackCacheA[Leaf]', 'end',
        'FallbackCacheOuter ' + '-'.repeat(2049) + '> FallbackCacheA'].join(String.fromCharCode(10))
      const calls = { miss: [], borrowed: [], public: [], companion: [], rendered: [] }
      const options = name => ({ graphLayout: { backend: 'agentic', fallback: 'elk' },
        onConfigDiagnostic: value => calls[name].push(value) })
      const request = (name, output = 'svg') => resolveRenderRequestForExecution(source, options(name), output)
      const missRequest = request('miss')
      const miss = observe(() => positionResolvedFamily('flowchart', missRequest))
      assert.ok(miss.stages.includes('elk'))
      decision(missRequest, 'elk', 'primary')
      assert.equal(calls.miss.length, 1)

      const borrowedRequest = request('borrowed')
      const borrowed = observe(() => positionFamilyForNativeRender(borrowedRequest))
      assert.deepEqual(borrowed.stages, [])
      assert.notStrictEqual(borrowed.value, miss.value)
      assert.equal(graphLayoutDecisionsOf(borrowed.value).length, 1)
      const selected = decision(borrowedRequest, 'elk', 'primary')
      assert.equal(selected.fallback, 'elk')
      assert.deepEqual(selected.attempts.map(value => [value.backend, value.outcome]),
        [['agentic', 'unsupported'], ['elk', 'selected']])
      assert.equal(selected.attempts[0].reason, 'agentic local rank-expansion limit')
      const repeated = observe(() => positionFamilyForNativeRender(borrowedRequest))
      assert.deepEqual(repeated.stages, [])
      assert.strictEqual(repeated.value, borrowed.value)
      assert.equal(calls.borrowed.length, 1)

      const publicRequest = request('public')
      const exposed = observe(() => positionResolvedFamily('flowchart', publicRequest))
      assert.deepEqual(exposed.stages, [])
      assert.notStrictEqual(exposed.value, borrowed.value)
      decision(publicRequest, 'elk', 'primary')
      assert.equal(calls.public.length, 1)
      const companionRequest = request('companion', 'ascii')
      const companion = observe(() => positionResolvedFamily('flowchart', companionRequest))
      assert.deepEqual(companion.stages, [])
      decision(companionRequest, 'elk', 'companion')
      assert.equal(calls.companion.length, 1)
      assert.equal(calls.miss.length, 1)
      for (const values of Object.values(calls).filter(values => values.length)) {
        assert.equal(values[0].code, 'INEFFECTIVE_CONFIG')
        assert.equal(values[0].field, 'graphLayout.backend')
      }
      const rendered = renderMermaidSVGWithReceipt(source, options('rendered'))
      assert.equal(calls.rendered.length, 1)
      assert.equal(rendered.receipt.layoutDecisions[0].selected, 'elk')
      assert.equal(rendered.receipt.layoutDecisions[0].role, 'primary')
      assert.equal(rendered.receipt.diagnostics.filter(value => value.code === 'GRAPH_LAYOUT_FALLBACK').length, 1)
      const strict = resolveRenderRequestForExecution(source, { graphLayout: { backend: 'agentic' } }, 'svg')
      assert.throws(() => positionFamilyForNativeRender(strict), error => error.code === 'GRAPH_LAYOUT_UNSUPPORTED')
    })
    console.log('fallback cache integration passed')
  `], childOptions)
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
  expect(child.stdout.trim()).toBe('fallback cache integration passed')
}, 30_000)

test('snapshot cloning preserves prepared-text Map keys and values alongside result-bound evidence', () => {
  const key = preparePixelText('prepared key', { fontSize: 12, fontWeight: 400 })
  const block = preparePixelText('prepared value', { fontSize: 12, fontWeight: 400 })
  // The key has no other reference: visiting values alone cannot restore it.
  const value = { positioned: { width: 20, height: 20 }, references: new Map([[key, { block, sameBlock: block }]]) }
  const family = {}
  const cacheKey = 'graph-layout-integration-prepared-map'
  retainGraphLayoutDecision(value, { requested: 'agentic', fallback: 'none', selected: 'agentic',
    attempts: [{ backend: 'agentic', outcome: 'selected' }], implementation: 'agentic-layered@26' })
  retainPositioned(family, cacheKey, value)
  const borrowed = borrowedPositioned(family, cacheKey)!.result as typeof value
  expect(graphLayoutDecisionsOf(borrowed)).toEqual(graphLayoutDecisionsOf(value))
  const exposed = cachedPositioned(family, cacheKey)! as typeof value
  expect(graphLayoutDecisionsOf(exposed)).toEqual(graphLayoutDecisionsOf(value))
  const [copiedKey, copiedValue] = [...exposed.references][0]!
  expect(copiedKey).not.toBe(key)
  expect(copiedValue.sameBlock).toBe(copiedValue.block)
  expect(isRetainedPixelText(copiedKey)).toBe(true)
  expect(isRetainedPixelText(copiedValue.block)).toBe(true)
  copiedValue.block.lines[0] = 'poisoned public prepared text'
  exposed.references.clear()
  exposed.positioned.width = NaN
  const next = cachedPositioned(family, cacheKey)! as typeof value
  expect(next.positioned.width).toBe(20)
  expect([...next.references][0]![1].block.lines[0]).toBe('prepared value')
  expect(graphLayoutDecisionsOf(next)).toEqual(graphLayoutDecisionsOf(value))
})
