import { readFileSync } from 'node:fs'
import { createMermaidRenderer, renderMermaidSVGWithReceipt } from '../index.ts'
import { withPerformanceExperiments } from '../experimental-performance.ts'
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
    assert.equal(receipt.layoutDecisions[0].requested, 'elk')
    assert.equal(receipt.layoutDecisions[0].selected, selected)
    assert.equal(receipt.layoutDecisions[0].role, role)
    return receipt.layoutDecisions[0]
  }
`

for (const family of ['flowchart', 'state'] as const) test(`ELK ${family} snapshot hits retain producer decisions, replay current roles and isolate public mutation`, async () => {
  const child = await runChild(process.execPath, ['-e', `${prelude}
    withPerformanceExperiments(['text-spans', 'position-cache'], () => {
      const family = ${JSON.stringify(family)}
      const source = (family === 'flowchart'
        ? ['flowchart TD', 'subgraph NativeCacheFrame[Stable frame]',
          ' NativeCacheA[Start] -->|kept label| NativeCacheB[Finish]', 'end']
        : ['stateDiagram-v2', 'state NativeCacheFrame {',
          ' NativeCacheA --> NativeCacheB: kept label', '}']).join(String.fromCharCode(10))
      const options = { graphLayout: { backend: 'elk' } }
      const request = output => resolveRenderRequestForExecution(source, options, output)
      const firstRequest = request('svg')
      const first = observe(() => positionFamilyForNativeRender(firstRequest))
      assert.ok(first.stages.includes('elk'))
      decision(firstRequest, 'elk', 'primary')

      const hitRequest = request('svg')
      const hit = observe(() => positionFamilyForNativeRender(hitRequest))
      assert.deepEqual(hit.stages, [])
      assert.deepEqual(hit.value, first.value)
      assert.equal(graphLayoutDecisionsOf(hit.value).length, 1)
      decision(hitRequest, 'elk', 'primary')
      const again = observe(() => positionFamilyForNativeRender(request('svg')))
      assert.deepEqual(again.stages, [])
      assert.notStrictEqual(again.value, hit.value)
      assert.strictEqual(again.value.positioned, hit.value.positioned)
      assert.equal(Object.isFrozen(again.value), true)
      assert.strictEqual(retainedFamilyProjection(again.value), retainedFamilyProjection(hit.value))

      const companionRequest = request('ascii')
      const companion = observe(() => positionResolvedFamily(family, companionRequest))
      assert.deepEqual(companion.stages, [])
      assert.notStrictEqual(companion.value, hit.value)
      decision(companionRequest, 'elk', 'companion')
      // The producer result is output-neutral; role belongs to this request.
      assert.equal(graphLayoutDecisionsOf(companion.value)[0].role, undefined)

      // A public hit shares the finished graph, which the cache froze: no
      // render can edit it, so renders from one entry cannot affect each other.
      const publicRequest = request('svg')
      const exposed = observe(() => positionResolvedFamily(family, publicRequest))
      assert.deepEqual(exposed.stages, [])
      assert.strictEqual(exposed.value.positioned, hit.value.positioned)
      assert.equal(graphLayoutDecisionsOf(exposed.value).length, 1)
      decision(publicRequest, 'elk', 'primary')
      const reference = renderMermaidSVGWithReceipt(source, options)
      for (const edit of [
        () => { exposed.value.positioned.nodes[0].label = 'poisoned public label' },
        () => { exposed.value.positioned.nodes[0].x = NaN },
        () => { exposed.value.positioned.edges[0].points[0].x = NaN },
        () => { exposed.value.positioned.groups[0].width = NaN },
      ]) assert.throws(edit, TypeError)
      const projection = retainedFamilyProjection(exposed.value)
      projection.edges[0].path[0][0] = NaN
      projection.nodes.length = 0
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), reference)
      assert.equal(Object.isFrozen(graphLayoutDecisionsOf(exposed.value)), true)
      assert.equal(Object.isFrozen(graphLayoutDecisionsOf(exposed.value)[0].attempts[0]), true)
    })
    console.log('ELK cache integration passed')
  `], childOptions)
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
  expect(child.stdout.trim()).toBe('ELK cache integration passed')
}, 30_000)

test('snapshot cloning preserves prepared-text Map keys and values alongside result-bound evidence', () => {
  const key = preparePixelText('prepared key', { fontSize: 12, fontWeight: 400 })
  const block = preparePixelText('prepared value', { fontSize: 12, fontWeight: 400 })
  // The key has no other reference: visiting values alone cannot restore it.
  const value = { positioned: { width: 20, height: 20 }, references: new Map([[key, { block, sameBlock: block }]]) }
  const family = {}
  const cacheKey = 'graph-layout-integration-prepared-map'
  retainGraphLayoutDecision(value, { requested: 'elk', fallback: 'none', selected: 'elk',
    attempts: [{ backend: 'elk', outcome: 'selected' }], implementation: 'elk-layered@1' })
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

test('Class cached producer admission remains bound to the actually selected paint backend', async () => {
  const child = await runChild(
    process.execPath,
    [
      '-e',
      `${prelude}
    import './src/agent/families.ts'
    import './src/scene/builtin-backends.ts'
    import { spyOn } from 'bun:test'
    import * as elk from './src/elk-instance.ts'
    import { DefaultBackend, registerBackend } from './src/scene/backend.ts'
    import { LayoutCertificationError } from './src/layout/backend.ts'
    const id = 'backend:test/class-marker-admission-cache'
    const unregister = registerBackend({ ...DefaultBackend, id,
      capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })) },
      { compatibility: { core: '^0.5.0', scene: '^2.0.0' } })
    let elkCalls = 0, policyCalls = 0
    const source = 'classDiagram\\nclass S\\nclass T\\nS o-- T\\nS <|-- T'
    const paths = [
      [{x:200,y:120},{x:180,y:120},{x:180,y:80},{x:580,y:80},{x:580,y:120},{x:600,y:120}],
      [{x:200,y:123.865},{x:170,y:123.865},{x:170,y:60},{x:560,y:60},{x:560,y:130},{x:600,y:130}],
    ]
    const producer = spyOn(elk, 'elkLayoutSync').mockImplementation(graph => {
      elkCalls++
      return { ...graph, width: 900, height: 300,
        children: graph.children.map((child, index) => ({ ...child, x: index ? 600 : 200, y: 100 })),
        edges: graph.edges.map((edge, index) => ({ ...edge, sections: [{ id: 'section',
          startPoint: paths[index][0], bendPoints: paths[index].slice(1, -1), endPoint: paths[index].at(-1) }] })) }
    })
    try { withPerformanceExperiments(['text-spans', 'position-cache'], () => {
      const options = { graphLayout: { backend: 'elk', fallback: 'none' } }
      const host = () => resolveRenderRequestForExecution(source, options, 'svg', undefined,
        { backendPolicy: { selectBackend: () => { policyCalls++; return id } } })
      const first = host(), firstResult = positionFamilyForNativeRender(first)
      assert.equal(firstResult.positioned.relationships.length, 2)
      decision(first, 'elk', 'primary')
      assert.equal(elkCalls, 1)
      const normal = resolveRenderRequestForExecution(source, options, 'svg')
      assert.throws(() => positionFamilyForNativeRender(normal), LayoutCertificationError)
      assert.equal(elkCalls, 2)
      assert.equal(receiptOf(normal).layoutDecisions?.length ?? 0, 0)
      const hit = host(), hitResult = positionFamilyForNativeRender(hit)
      assert.deepEqual(hitResult.positioned, firstResult.positioned)
      assert.equal(elkCalls, 2)
      assert.equal(policyCalls, 2)
      decision(hit, 'elk', 'primary')
    }) } finally { producer.mockRestore(); unregister() }
    console.log('Class backend-bound admission cache passed')
  `,
    ],
    childOptions,
  )
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
  expect(child.stdout.trim()).toBe('Class backend-bound admission cache passed')
}, 30_000)


test('ELK reuse preserves comment edits and rechecks current style maps and host metrics', () => {
  const source = readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-15.mmd', import.meta.url), 'utf8')
  const options = { graphLayout: { backend: 'elk' as const }, nodeSpacing: 73 }
  const render = (value: string) => withPerformanceExperiments(['text-spans', 'position-cache'], () => renderMermaidSVGWithReceipt(value, options))
  const first = render(source), edited = render(source + '\n%% reviewed')
  expect(edited.svg).toBe(first.svg)
  expect(edited.receipt.layoutDecisions).toEqual(first.receipt.layoutDecisions)
  expect(edited.receipt.layoutCertification).toEqual(first.receipt.layoutCertification)
  expect(edited.receipt.requestDigest).not.toBe(first.receipt.requestDigest)
  for (const style of ['style n0 stroke-width:4px', 'linkStyle default stroke-width:4px']) {
    const changed = source + '\n' + style
    const cold = withPerformanceExperiments([], () => renderMermaidSVGWithReceipt(changed, options))
    expect(render(changed)).toEqual(cold)
    expect(render(changed + '\n%% reviewed').svg).toBe(cold.svg)
    expect(cold.svg).not.toBe(first.svg)
  }
  let measurements = 0, scale = .55
  const host = createMermaidRenderer({ textMeasurement: { id: 'test:elk-reuse-current-metrics', version: '1.0.0',
    measure: ({ text, fontSize }) => { measurements++; return text.length * fontSize * scale } } })
  const hostFirst = host.renderMermaidSVGWithReceipt(source, options), firstCalls = measurements
  expect(firstCalls).toBeGreaterThan(0)
  expect(host.renderMermaidSVGWithReceipt(source + '\n%% profiled', options).svg).toBe(hostFirst.svg)
  expect(measurements).toBeGreaterThan(firstCalls)
  const repeatedCalls = measurements
  scale = .7
  expect(host.renderMermaidSVGWithReceipt(source, options).svg).not.toBe(hostFirst.svg)
  expect(measurements).toBeGreaterThan(repeatedCalls)
})

test('ELK reuse reattaches current authored text and execution receipts after equal-size card edits', () => {
  const options = { graphLayout: { backend: 'elk' as const } }
  const first = renderMermaidSVGWithReceipt('flowchart TB\n A[Cat] --> B[Pet]', options)
  const edited = renderMermaidSVGWithReceipt('flowchart TB\n A[Dog] --> B[Pet]', options)
  expect(first.svg).toContain('Cat')
  expect(edited.svg).toContain('Dog')
  expect(edited.svg).not.toContain('Cat')
  expect(edited.receipt.layoutDecisions).toEqual(first.receipt.layoutDecisions)
  expect(edited.receipt.layoutDecisions?.[0]?.selected).toBe('elk')
})
