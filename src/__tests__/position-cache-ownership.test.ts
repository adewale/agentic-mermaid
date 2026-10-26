import { expect, test } from 'bun:test'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

test('a held render request cannot pin evicted private geometry through a drawing proof', async () => {
  const child = await runChild('node', ['--expose-gc', '--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { setImmediate } from 'node:timers/promises'
    import { borrowedPositioned, cachedNativeDrawing, retainNativeDrawing, retainOwnedNativeSvgPositioned, retainPositioned } from './src/experimental/position-cache.ts'
    const family = {}, heldRequest = { live: true }
    const tracked = (key, enroll) => {
      const value = { positioned: { width: 1, height: 1 } }
      retainOwnedNativeSvgPositioned(family, key, value)
      if (enroll) {
        const borrowed = borrowedPositioned(family, key, heldRequest).result
        cachedNativeDrawing(heldRequest, borrowed, true)
        retainNativeDrawing(heldRequest, borrowed, { svg: '<svg/>', header: {}, paint: { geometry: value.positioned }, preparedText: true }, () => value.positioned)
      }
      return new WeakRef(value.positioned)
    }
    const control = tracked('lifetime-control', false)
    const held = tracked('lifetime-held', true)
    for (let index = 0; index < 512; index++) {
      retainPositioned(family, 'lifetime-churn-' + index, { positioned: { width: 1, height: 1 } })
    }
    for (let index = 0; index < 8; index++) { await setImmediate(); globalThis.gc() }
    assert.equal(control.deref(), undefined, 'unbound control must be collected')
    assert.equal(heldRequest.live, true)
    assert.equal(held.deref(), undefined, 'a retained drawing and held request must not extend evicted geometry lifetime')
  `], { cwd: `${import.meta.dir}/../..` })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
})

test('native drawing cache admission accounts for hidden evidence without burdening fresh or public layouts', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { borrowedPositioned, cachedNativeDrawing, retainNativeDrawing, retainOwnedNativeSvgPositioned, retainPositioned } from './src/experimental/position-cache.ts'
    const family = {}, layout = { positioned: { width: 1, height: 1 } }
    const drawing = { svg: '<svg/>', header: {}, paint: { primitives: [] }, preparedText: true }
    const fresh = {}, publicRequest = {}, repeated = {}, events = []
    const symbol = Symbol.for('agentic-mermaid.performance-observer.v1')
    globalThis[symbol] = event => events.push(event)
    retainOwnedNativeSvgPositioned(family, 'private', layout)
    const unexpected = () => { throw Error('fresh/public requests must not walk drawing residency') }
    retainNativeDrawing(fresh, layout, drawing, unexpected)
    retainPositioned(family, 'public', layout)
    const publicLayout = borrowedPositioned(family, 'public', publicRequest).result
    retainNativeDrawing(publicRequest, publicLayout, drawing, unexpected)
    const repeatedLayout = borrowedPositioned(family, 'private', repeated).result
    assert.equal(repeatedLayout.positioned, layout.positioned)
    let walks = 0
    retainNativeDrawing(repeated, repeatedLayout, drawing, () => { walks++; return 'x'.repeat(17 * 1024 * 1024) })
    assert.equal(walks, 1)
    assert.ok(events.some(event => event.owner === 'native-drawing' && event.outcome === 'store-skipped' && event.reason === 'weight-limit'))
    const next = {}
    const nextLayout = borrowedPositioned(family, 'private', next).result
    assert.equal(nextLayout.positioned, layout.positioned)
    assert.equal(cachedNativeDrawing(next, nextLayout, true), undefined)
    delete globalThis[symbol]
  `], { cwd: `${import.meta.dir}/../..` })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
})

test('drawing pressure preserves geometry and cyclic admission avoids repeated residency walks', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { borrowedPositioned, cachedNativeDrawing, retainNativeDrawing, retainOwnedNativeSvgPositioned } from './src/experimental/position-cache.ts'
    const family = {}, sources = Array.from({ length: 10 }, (_, i) => 'pressure-' + i)
    const drawing = { svg: 'x'.repeat(600_000), header: {}, paint: { primitives: [] }, preparedText: true }
    for (const key of sources) retainOwnedNativeSvgPositioned(family, key, { positioned: { key } })
    let walks = 0
    const visit = key => {
      const request = {}, borrowed = borrowedPositioned(family, key, request)
      assert.ok(borrowed, 'drawing admission must preserve every resident layout')
      const hit = cachedNativeDrawing(request, borrowed.result, true)
      if (!hit) retainNativeDrawing(request, borrowed.result, drawing, () => { walks++; return {} })
      return hit
    }
    for (const key of sources) visit(key)
    assert.equal(walks, 3, 'only spare drawing capacity should be walked and filled')
    for (let round = 0; round < 3; round++) for (const key of sources) visit(key)
    assert.equal(walks, 3, 'cyclic misses must not repeatedly walk or evict drawings')
    visit(sources[8])
    visit(sources[8])
    assert.equal(visit(sources[8]), drawing, 'consecutive reuse can replace an older drawing')
    assert.equal(walks, 4)
    for (const key of sources) assert.ok(borrowedPositioned(family, key))
  `], { cwd: `${import.meta.dir}/../..` })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
})

test('an interleaved drawing working set replaces stale drawings without adjacent repeats', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { borrowedPositioned, cachedNativeDrawing, retainNativeDrawing, retainOwnedNativeSvgPositioned } from './src/experimental/position-cache.ts'
    const family = {}, established = ['old-a', 'old-b', 'old-c'], replacements = ['new-a', 'new-b']
    const sources = [...established, ...replacements]
    const drawing = { svg: 'x'.repeat(600_000), header: {}, paint: { primitives: [] }, preparedText: true }
    const identities = new Map()
    for (const key of sources) {
      const positioned = { key }
      identities.set(key, positioned)
      retainOwnedNativeSvgPositioned(family, key, { positioned })
    }
    let walks = 0
    const visit = key => {
      const request = {}, borrowed = borrowedPositioned(family, key, request)
      assert.ok(borrowed, 'drawing replacement must preserve resident geometry')
      assert.equal(borrowed.result.positioned, identities.get(key), 'drawing pressure must not replace geometry')
      const hit = cachedNativeDrawing(request, borrowed.result, true)
      if (!hit) retainNativeDrawing(request, borrowed.result, drawing, () => { walks++; return {} })
      return hit
    }
    for (const key of established) visit(key)
    assert.equal(walks, 3, 'the established set must fill the drawing budget')
    for (let round = 0; round < 300; round++) {
      visit(replacements[0])
      visit(replacements[1])
    }
    assert.equal(walks, 5, 'each replacement should be measured and admitted exactly once')
    assert.equal(visit(replacements[0]), drawing)
    assert.equal(visit(replacements[1]), drawing)
    assert.equal(walks, 5, 'reusable replacements must not repeat evidence walks')
    for (const key of sources) {
      const borrowed = borrowedPositioned(family, key)
      assert.ok(borrowed)
      assert.equal(borrowed.result.positioned, identities.get(key))
    }
  `], { cwd: `${import.meta.dir}/../..` })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
})

test('repeated private native drawings preserve receipts, policy and final security with bounded derived retention', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { createMermaidRenderer } from './src/index.ts'
    import { PERFORMANCE_EXPERIMENTS, withPerformanceExperiments } from './src/experimental-performance.ts'
    const events = []
    const symbol = Symbol.for('agentic-mermaid.performance-observer.v1')
    globalThis[symbol] = event => events.push(event)
    let policies = 0
    const renderer = createMermaidRenderer({ backendPolicy: { selectBackend() { policies++; return undefined } } })
    const withoutPositionCache = callback => withPerformanceExperiments(
      PERFORMANCE_EXPERIMENTS.filter(name => name !== 'position-cache'), callback)
    for (const source of [
      'sequenceDiagram\\n NativeOwnerA->>NativeOwnerB: retained message',
      'flowchart LR\\n NativeOwnerA["wide 界"] --> NativeOwnerB',
      'stateDiagram-v2\\n NativeOwnerA --> NativeOwnerB: retained transition',
    ]) {
      const reference = withoutPositionCache(() => renderer.renderMermaidSVGWithReceipt(source))
      const reuse = []
      for (let index = 0; index < 3; index++) {
        const start = events.length, priorPolicies = policies
        const actual = renderer.renderMermaidSVGWithReceipt(source)
        assert.deepEqual(actual, reference)
        assert.equal(policies, priorPolicies + 1)
        const observed = events.slice(start)
        reuse.push(observed.filter(event => event.kind === 'cache' && event.owner === 'native-drawing' && event.detail === 'positioned-owner').length)
        assert.equal(observed.filter(event => event.kind === 'cache' && event.owner === 'svg-inspection' && event.detail === 'final-security').length, 1)
        assert.ok(observed.some(event => event.kind === 'cache' && event.owner === 'paint-certification' && event.outcome === 'miss'))
      }
      assert.deepEqual(reuse, [0, 0, 1])
      for (const options of [{ fg: '#334455' }, { compact: true }, { security: 'strict' }]) {
        const expected = withoutPositionCache(() => renderer.renderMermaidSVGWithReceipt(source, options))
        const start = events.length
        assert.deepEqual(renderer.renderMermaidSVGWithReceipt(source, options), expected)
        assert.equal(events.slice(start).filter(event => event.detail === 'positioned-owner').length, 0)
      }
      const start = events.length
      assert.deepEqual(withoutPositionCache(() => renderer.renderMermaidSVGWithReceipt(source)), reference)
      assert.equal(events.slice(start).filter(event => event.detail === 'positioned-owner').length, 0)
    }
    delete globalThis[symbol]
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', AGENTIC_MERMAID_ELK_CACHE: '1' } })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
}, 30_000)


test('family ownership follows constructed identities and backend ownership follows successful original enrollment', async () => {
  for (const mode of ['original', 'changed-before-enrollment', 'failed-enrollment']) {
    const child = await runChild(process.execPath, ['-e', `
      import assert from 'node:assert/strict'
      import { isOwnedFamily } from './src/experimental/owned-family.ts'
      import { DefaultBackend, isOriginalEnrolledDefaultBackend, registerBackend, registerBuiltInBackend } from './src/scene/backend.ts'
      const mode = ${JSON.stringify(mode)}
      const fail = () => { throw new Error('backend query touched a proxy') }
      const proxy = new Proxy(DefaultBackend, { get: fail, getOwnPropertyDescriptor: fail, ownKeys: fail, isExtensible: fail })
      assert.equal(isOriginalEnrolledDefaultBackend(undefined), false)
      assert.equal(isOriginalEnrolledDefaultBackend(DefaultBackend), false)
      assert.equal(isOriginalEnrolledDefaultBackend(proxy), false)
      if (mode === 'changed-before-enrollment') DefaultBackend.drawNode = () => { throw new Error('unexpected rendering') }
      if (mode === 'failed-enrollment') {
        registerBackend({ ...DefaultBackend, id: 'backend:default' }, { compatibility: { core: '^0.4.0', scene: '^2.0.0' } })
        assert.throws(() => registerBuiltInBackend(DefaultBackend), { name: 'ExtensionCollisionError' })
        assert.equal(Object.isFrozen(DefaultBackend), true)
        assert.equal(isOriginalEnrolledDefaultBackend(DefaultBackend), false)
      } else {
        registerBuiltInBackend(DefaultBackend)
        assert.equal(Object.isFrozen(DefaultBackend), true)
        assert.equal(isOriginalEnrolledDefaultBackend(DefaultBackend), mode === 'original')
      }
      assert.equal(isOriginalEnrolledDefaultBackend(undefined), false)
      assert.equal(isOriginalEnrolledDefaultBackend(proxy), false)
      assert.equal(isOriginalEnrolledDefaultBackend({ ...DefaultBackend }), false)
      if (mode === 'original') {
        const { getFamily, replaceFamilyForTest } = await import('./src/agent/families.ts')
        const { createBrowserFamilyDescriptor } = await import('./src/browser-lazy/family.ts')
        const original = getFamily('sequence')
        assert.equal(Object.isFrozen(original), true)
        assert.equal(isOwnedFamily(original), true)
        assert.equal(Reflect.set(original, 'layout', () => undefined), false)
        assert.equal(isOwnedFamily(Object.freeze({ ...original })), false)
        const fail = () => { throw new Error('unowned family query touched a proxy') }
        const familyProxy = new Proxy(original, { get: fail, getOwnPropertyDescriptor: fail, ownKeys: fail, isExtensible: fail, getPrototypeOf: fail })
        for (const unowned of [familyProxy, {}, Object.freeze({ id: undefined }), undefined]) {
          assert.equal(isOwnedFamily(unowned), false)
        }
        let idReads = 0, layoutReads = 0
        const data = new Proxy({ ...original }, { get(target, key, receiver) {
          if (key === 'id') idReads++
          return Reflect.get(target, key, receiver)
        } })
        const hooks = { get layout() { layoutReads++; return original.layout }, projectPositioned: original.projectPositioned, lowerScene: original.lowerScene }
        const browser = createBrowserFamilyDescriptor(data, hooks)
        assert.equal(idReads, 1)
        assert.equal(layoutReads, 1)
        assert.equal(isOwnedFamily(data), false)
        assert.equal(isOwnedFamily(browser), true)
        assert.equal(Object.isFrozen(browser), true)
        assert.equal(Reflect.set(browser, 'layout', () => undefined), false)
        Object.defineProperty(hooks, 'layout', { get: fail })
        assert.equal(browser.layout, original.layout)
        assert.equal(isOwnedFamily(browser), true)
        assert.equal(idReads, 1)
        assert.equal(layoutReads, 1)
        let replacementReads = 0
        const restore = replaceFamilyForTest('sequence', { ...original, get layout() { replacementReads++; return original.layout } })
        try {
          const replacement = getFamily('sequence')
          assert.equal(Object.isFrozen(replacement), true)
          assert.equal(isOwnedFamily(replacement), false)
          assert.equal(replacement.layout, original.layout)
          assert.equal(replacementReads, 1)
        } finally { restore() }
        assert.equal(getFamily('sequence'), original)
        assert.equal(isOwnedFamily(original), true)
      }
      console.log('immutable enrollment proof passed')
    `], { cwd: `${import.meta.dir}/../..` })
    expect(child.stderr).toBe('')
    expect(child.status).toBe(0)
    expect(child.stdout).toContain('immutable enrollment proof passed')
  }
})

for (const family of ['flowchart', 'state'] as const) {
  test(`native ${family} geometry stays isolated across private/public/PNG order and replacement hooks`, async () => {
    const child = await runChild(process.execPath, ['-e', `
      import assert from 'node:assert/strict'
      import { renderMermaidSVGWithReceipt } from './src/index.ts'
      import { renderMermaidPNGWithReceipt } from './src/agent/index.ts'
      import { resolveRenderRequestForExecution } from './src/render-contract.ts'
      import { positionResolvedFamily, retainedFamilyProjection } from './src/positioning.ts'
      import { getFamily, replaceFamilyForTest } from './src/agent/families.ts'
      import { PERFORMANCE_EXPERIMENTS, withPerformanceExperiments } from './src/experimental-performance.ts'
      const family = ${JSON.stringify(family)}
      const source = family === 'flowchart'
        ? 'flowchart LR\\nsubgraph CacheOwnerGroup["Group"]\\nCacheOwnerA["wide 界 #35; text"] -->|first| CacheOwnerB["Tail"]\\nCacheOwnerA -->|second| CacheOwnerB\\nCacheOwnerB -->|return| CacheOwnerA\\nend'
        : 'stateDiagram-v2\\nstate CacheOwnerGroup {\\nstate "wide 界 #35; text" as CacheOwnerA\\nstate "Tail" as CacheOwnerB\\nCacheOwnerA --> CacheOwnerB: first\\nCacheOwnerA --> CacheOwnerB: second\\nCacheOwnerB --> CacheOwnerA: return\\n}\\n[*] --> CacheOwnerGroup'
      const options = { embedFontImport: false, seed: 7 }
      const withoutPositionCache = callback => withPerformanceExperiments(
        PERFORMANCE_EXPERIMENTS.filter(name => name !== 'position-cache'), callback)
      const reference = withoutPositionCache(() => renderMermaidSVGWithReceipt(source, options))
      const first = renderMermaidSVGWithReceipt(source, options)
      assert.deepEqual(first, reference)
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
      const poison = result => {
        result.positioned.width = NaN
        result.positioned.nodes[0].label = 'poisoned public node'
        result.positioned.edges[0].points[0].x = NaN
        result.positioned.groups[0].children.length = 0
        const projection = retainedFamilyProjection(result)
        projection.edges[0].path[0][0] = NaN
        projection.groups[0].members.push('poisoned')
        projection.nodes.length = 0
      }
      for (const debug of [false, true]) {
        const request = resolveRenderRequestForExecution(source, options, 'svg')
        poison(positionResolvedFamily(family, request, request.source, debug ? { debug: true } : {}))
        assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
      }
      const publicFirstSource = source.replaceAll('CacheOwner', 'PublicFirst')
      const publicFirstReference = withoutPositionCache(() => renderMermaidSVGWithReceipt(publicFirstSource, options))
      poison(positionResolvedFamily(family, resolveRenderRequestForExecution(publicFirstSource, options, 'svg')))
      assert.deepEqual(renderMermaidSVGWithReceipt(publicFirstSource, options), publicFirstReference)
      assert.deepEqual(renderMermaidSVGWithReceipt(publicFirstSource, options), publicFirstReference)

      const pngOptions = { ...options, scale: 0.1, loadSystemFonts: false, onWarning: () => {} }
      const pngReference = withoutPositionCache(() => renderMermaidPNGWithReceipt(source, pngOptions))
      assert.deepEqual(renderMermaidPNGWithReceipt(source, pngOptions), pngReference)
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
      for (const style of ['paper', 'excalidraw']) {
        const expected = withoutPositionCache(() => renderMermaidSVGWithReceipt(source, { ...options, style }))
        assert.deepEqual(renderMermaidSVGWithReceipt(source, { ...options, style }), expected)
        assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
      }

      const original = getFamily(family)
      let callerOwned, invalid = false, projections = 0
      const restore = replaceFamilyForTest(family, { ...original,
        layout(ctx) { return callerOwned ??= original.layout(ctx) },
        projectPositioned(ctx) {
          projections++
          const view = original.projectPositioned(ctx)
          return invalid ? { ...view, bounds: { ...view.bounds, w: NaN } } : view
        }
      })
      try {
        assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
        callerOwned.positioned.nodes[0].label = 'poisoned replacement node'
        callerOwned.positioned.edges[0].points[0].x = NaN
        assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
        assert.equal(projections, 2)
        invalid = true
        assert.throws(() => renderMermaidSVGWithReceipt(source, options), { code: 'LAYOUT_CERTIFICATION_FAILED' })
      } finally { restore() }
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
    `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', AGENTIC_MERMAID_ELK_CACHE: '1' } })
    expect(child.stderr).toBe('')
    expect(child.status).toBe(0)
  }, 30_000)
}

test('native cached rendering stays isolated from public geometry and replacement projectors', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { createMermaidRenderer, parseRegisteredMermaid, renderMermaidSVGWithReceipt } from './src/index.ts'
    import { resolveRenderRequestForExecution } from './src/render-contract.ts'
    import { positionResolvedFamily, retainedFamilyProjection } from './src/positioning.ts'
    import { getFamily, replaceFamilyForTest } from './src/agent/families.ts'
    import { PERFORMANCE_EXPERIMENTS, withPerformanceExperiments } from './src/experimental-performance.ts'
    const source = [
      'sequenceDiagram',
      'participant CacheOwnerA',
      'participant CacheOwnerB',
      'link CacheOwnerA: Docs @ https://example.test/docs',
      'CacheOwnerA->>CacheOwnerB: isolated 界 text',
      'Note over CacheOwnerA,CacheOwnerB: retained note'
    ].join('\\n')
    const options = { embedFontImport: false }
    const withoutPositionCache = callback => withPerformanceExperiments(
      PERFORMANCE_EXPERIMENTS.filter(name => name !== 'position-cache'), callback)
    const reference = withoutPositionCache(() => renderMermaidSVGWithReceipt(source, options))
    const first = renderMermaidSVGWithReceipt(source, options)
    assert.deepEqual(first, reference)
    const poison = publicResult => {
      publicResult.positioned.width = NaN
      publicResult.positioned.actors[0].label = 'poisoned'
      publicResult.positioned.actors[0].links.Docs = 'https://poisoned.test'
      publicResult.positioned.notes[0].actors[0] = 'poisoned'
      publicResult.positioned.messages[0].points[0].x = NaN
      const projection = retainedFamilyProjection(publicResult)
      projection.edges[0].path[0][0] = NaN
      projection.nodes.length = 0
    }
    // A private miss and hit precede these public hits. None of their mutable
    // geometry, note identities, links or prepared-text copies may poison SVG.
    assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
    for (let i = 0; i < 3; i++) {
      const request = resolveRenderRequestForExecution(source, options, 'svg')
      const publicResult = positionResolvedFamily('sequence', request, request.source, i > 0 ? { debug: true } : {})
      poison(publicResult)
      if (i === 0) publicResult.positioned.notes[0].block.text = 'poisoned prepared text'
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
    }
    // The opposite order must also keep the public miss outside cache ownership.
    const publicFirstSource = source.replaceAll('CacheOwner', 'PublicFirst')
    const publicFirstReference = withoutPositionCache(() => renderMermaidSVGWithReceipt(publicFirstSource, options))
    const publicRequest = resolveRenderRequestForExecution(publicFirstSource, options, 'svg')
    poison(positionResolvedFamily('sequence', publicRequest))
    assert.deepEqual(renderMermaidSVGWithReceipt(publicFirstSource, options), publicFirstReference)
    assert.deepEqual(renderMermaidSVGWithReceipt(publicFirstSource, options), publicFirstReference)

    const parsed = parseRegisteredMermaid(source)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.value.body.kind, 'sequence')
    assert.equal(renderMermaidSVGWithReceipt(parsed.value, options).svg, first.svg)
    parsed.value.body.participants[0].label = 'poisoned parsed participant'
    parsed.value.body.messages[0].text = 'poisoned parsed message'
    parsed.value.body.statements.length = 0
    assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)

    for (const changed of [{ font: 'Arial' }, { style: 'paper' }, { layoutSafety: 'strict' }, { style: 'excalidraw' }]) {
      const rendered = renderMermaidSVGWithReceipt(source, { ...options, ...changed })
      assert.deepEqual(renderMermaidSVGWithReceipt(source, { ...options, ...changed }), rendered)
    }
    const original = getFamily('sequence')
    let invalid = false, projections = 0, callerOwned
    const restore = replaceFamilyForTest('sequence', { ...original,
      layout(ctx) { return callerOwned ??= original.layout(ctx) },
      projectPositioned(ctx) {
        projections++
        const view = original.projectPositioned(ctx)
        return invalid ? { ...view, bounds: { ...view.bounds, w: NaN } } : view
      }
    })
    try {
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
      callerOwned.positioned.actors[0].label = 'poisoned replacement-owned participant'
      callerOwned.positioned.notes[0].actors[0] = 'poisoned'
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
      assert.equal(projections, 2)
      invalid = true
      assert.throws(() => renderMermaidSVGWithReceipt(source, options), { code: 'LAYOUT_CERTIFICATION_FAILED' })
    } finally { restore() }
    assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)

    let nested
    const measured = createMermaidRenderer({ textMeasurement: {
      id: 'test:sequence-cache-ownership', version: '1.0.0',
      measure(input) {
        nested = renderMermaidSVGWithReceipt(source, options)
        return [...input.text].length * 25
      }
    } })
    const profiled = measured.renderMermaidSVGWithReceipt(source, options)
    assert.notEqual(profiled.svg, first.svg)
    assert.deepEqual(nested, first)
    assert.deepEqual(measured.renderMermaidSVGWithReceipt(source, options), profiled)
    assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', AGENTIC_MERMAID_ELK_CACHE: '1' } })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
}, 30_000)

test('Architecture cached rings stay isolated from mutable public layouts across radius changes', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { renderMermaidSVGWithReceipt, layoutMermaidWithReceipt } from './src/agent/index.ts'
    import { scanSvgStartTags } from './src/svg-structure.ts'
    import { architectureSvgMetrics } from './eval/endpoint-marker/architecture-metrics.ts'
    // Existing #465 nested/aligned/titled junction fixture. Only its public
    // radius option changes; expectations below come from authored meaning.
    const source = '---\\ntitle: Junction connections\\n---\\narchitecture-beta\\ngroup outer(cloud)[Outer]\\ngroup g(cloud)[Group] in outer\\njunction j in g\\nservice b(database)[B] in g\\nj:R<-->L:b\\nalign row j b'
    const references = new Map()
    const assertMeaning = (layout, radius) => {
      assert.equal(layout.kind, 'architecture')
      assert.deepEqual(layout.nodes.map(node => node.id).sort(), ['b', 'j'])
      const ring = layout.nodes.find(node => node.id === 'j')
      assert.equal(ring.shape, 'circle')
      assert.equal(ring.role, 'mark')
      assert.equal(ring.w, radius * 2)
      assert.equal(ring.h, radius * 2)
      assert.equal(layout.nodes.find(node => node.id === 'b').label, 'B')
      assert.equal(layout.edges.length, 1)
      assert.equal(layout.edges[0].from, 'j')
      assert.equal(layout.edges[0].to, 'b')
      assert.deepEqual(layout.groups.map(group => group.id).sort(), ['g', 'outer'])
      const group = layout.groups.find(group => group.id === 'g')
      assert.equal(group.parentId, 'outer')
      assert.deepEqual([...group.members].sort(), ['b', 'j'])
      return ring
    }
    const poison = layout => {
      const ring = layout.nodes.find(node => node.id === 'j')
      ring.x = NaN
      ring.w = NaN
      layout.edges[0].path[0][0] = NaN
      layout.edges[0].from = 'poisoned'
      layout.groups.find(group => group.id === 'g').members.push('poisoned')
      layout.nodes.length = 0
      layout.bounds.w = NaN
    }
    for (const radius of [8, 20, 40, 8]) {
      const options = { embedFontImport: false, seed: 7,
        architecture: { visual: { junctionOuterRadius: radius, edgeLineWidth: 3 } } }
      const warm = renderMermaidSVGWithReceipt(source, options)
      if (references.has(radius)) assert.deepEqual(warm, references.get(radius))
      else references.set(radius, warm)
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), warm)

      // Default public geometry uses the same rendering options as the warm
      // SVG. Poison only public return values, never private positioning data.
      const plain = layoutMermaidWithReceipt(source, options).layout
      assertMeaning(plain, radius)
      poison(plain)
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), warm)

      const debug = layoutMermaidWithReceipt(source, { ...options, debug: true }).layout
      const ring = assertMeaning(debug, radius)
      const route = debug.edges[0].route
      assert.equal(route.family, 'architecture')
      assert.equal(route.sourceSide, 'R')
      assert.equal(route.targetSide, 'L')
      assert.equal(route.sourceAnchored, true)
      assert.equal(route.targetAnchored, true)
      const circles = scanSvgStartTags(warm.svg).filter(tag => tag.name === 'circle'
        && tag.attributes.some(attr => attr.name === 'data-id' && attr.value === 'junction-ring:j'))
      assert.equal(circles.length, 1)
      const attributes = Object.fromEntries(circles[0].attributes.map(attr => [attr.name, attr.value]))
      assert.equal(Number(attributes.r), radius)
      assert.ok(Math.abs(Number(attributes.cx) - (ring.x + radius)) <= 0.5)
      assert.ok(Math.abs(Number(attributes.cy) - (ring.y + radius)) <= 0.5)

      // Reuse #465's independent final-SVG auditor, not the producer's port
      // calculation. Fixed counts and zero errors are authored expectations.
      const measured = architectureSvgMetrics(warm.svg, debug, warm.receipt.layoutCertification)
      assert.equal(measured.metrics.routes, 1)
      assert.equal(measured.metrics.endpointChecks, 2)
      assert.equal(measured.metrics.markerChecks, 2)
      assert.equal(measured.metrics.offOutlineEndpoints, 0)
      assert.equal(measured.metrics.offOutlineMarkers, 0)
      assert.equal(measured.metrics.unverifiedMarkerBodies, 0)
      assert.equal(measured.metrics.routeCertificateFindings, 0)
      poison(debug)
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), warm)
      assertMeaning(layoutMermaidWithReceipt(source, options).layout, radius)
    }
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', AGENTIC_MERMAID_ELK_CACHE: '1' } })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
}, 30_000)
