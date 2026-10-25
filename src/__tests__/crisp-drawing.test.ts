import { expect, test } from 'bun:test'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

// Run with production admission: the ordinary test preload intentionally asks
// for full Scene cross-checks, which must keep exercising the Scene adapter.
test('ordinary native crisp rendering constructs no populated Scene groups and retains paint safety', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import { spyOn } from 'bun:test'
    import { renderMermaidSVGWithReceipt } from './src/index.ts'
    import { knownBuiltinFamilies, getFamily } from './src/agent/families.ts'
    import { getBackendDescriptor } from './src/scene/backend.ts'
    import * as marks from './src/scene/marks.ts'
    import { withRenderStageObserver } from './src/render-stages.ts'
    import { resolveRenderRequest, resolvedFamilyRenderContextOf } from './src/render-contract.ts'
    import { positionResolvedFamily } from './src/positioning.ts'
    void getBackendDescriptor('default').conformance
    const group = marks.group
    let groups = 0
    const spy = spyOn(marks, 'group').mockImplementation(fields => {
      if (fields.children.length) throw new Error('constructed a populated Scene group: ' + fields.id)
      groups++
      return group(fields)
    })
    for (const id of knownBuiltinFamilies()) for (const options of [{}, { style: 'tokyo-night' }, { style: 'paper', transparent: true }, { style: { formatVersion: 1, roles: { label: { fontWeight: 600 } } } }]) {
      const stages = []
      const result = withRenderStageObserver(sample => stages.push(sample.stage),
        () => renderMermaidSVGWithReceipt(getFamily(id).example, options))
      if (!result.svg.startsWith('<svg') || !result.receipt.layoutCertification) throw new Error('missing drawing/proof: ' + id)
      if (stages.includes('scene') || !stages.includes('drawing')) throw new Error('missing native drawing: ' + id)
    }
    if (!groups) throw new Error('no groups exercised')
    spy.mockRestore()
    const er = getFamily('er')
    const expected = renderMermaidSVGWithReceipt(er.example).svg
    for (const [id, field] of [['er', 'entities'], ['class', 'classes']]) {
      const family = getFamily(id)
      const request = resolveRenderRequest(family.example)
      const layout = positionResolvedFamily(id, request)
      const values = layout.positioned[field]
      let entered = false
      Object.defineProperty(layout.positioned, field, { get() {
        if (!entered) {
          entered = true
          if (renderMermaidSVGWithReceipt(er.example).svg !== expected)
            throw new Error('native rendering inherited public lowering scope: ' + id)
        }
        return values
      } })
      family.lowerScene({ positioned: layout.positioned, colors: request.appearance.colors,
        resolved: resolvedFamilyRenderContextOf(request) })
      if (!entered) throw new Error('nested render was not exercised: ' + id)
    }
    const chart = renderMermaidSVGWithReceipt('---\\nconfig:\\n  xyChart:\\n    showDataLabel: true\\n---\\nxychart\\n x-axis [A, B]\\n y-axis 0 --> 30\\n bar [12, 2]').svg
    const labels = [...chart.matchAll(/<text\\b[^>]*class="xychart-data-label"[^>]*>/g)]
    if (labels.length !== 2 || labels.some(([tag]) => !tag.includes('data-font-metrics="deterministic-fit"')))
      throw new Error('native XY data labels skipped deterministic text fitting')
    for (const options of [{ layoutSafety: 'strict' }, { style: 'excalidraw' }]) {
      const stages = []
      withRenderStageObserver(sample => stages.push(sample.stage),
        () => renderMermaidSVGWithReceipt('sequenceDiagram\\nAlice->>Bob: Hello', options))
      if (!stages.includes('scene')) throw new Error('Scene consumer bypassed its adapter')
    }
    console.log('native crisp and Scene consumers passed')
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
  expect(child.stdout).toContain('native crisp and Scene consumers passed')
}, 30_000)

test('native fragment reuse cannot exceed the emitted node budget', async () => {
  const { drawNative } = await import('../scene/native-drawing.ts')
  const { SCENE_VALIDATION_LIMITS } = await import('../scene/scene-validation.ts')
  expect(() => drawNative(factory => {
    const fragment = factory.shape({ id: 'reused', role: 'icon', geometry: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 }, paint: {} })
    return { family: 'flowchart', width: 10, height: 10, transparent: false, colors: { bg: '#fff', fg: '#111' }, parts: Array(SCENE_VALIDATION_LIMITS.maxNodes + 1).fill(fragment) }
  }, { positioned: { width: 10, height: 10 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }, 'flowchart')).toThrow('too many emitted nodes')
})

test('native crisp rendering refuses a failed default writer conformance report', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import { spyOn } from 'bun:test'
    import * as conformance from './src/scene/backend-conformance.ts'
    import { renderMermaidSVG } from './src/index.ts'
    spyOn(conformance, 'runBackendConformance').mockReturnValue({ passed: false,
      checks: [{ id: 'draw-node-semantics', passed: false, diagnostic: 'forced failure' }] })
    for (const options of [{}, { layoutSafety: 'strict' }]) {
      let failure
      try { renderMermaidSVG('flowchart LR\\nA-->B', options) } catch (error) { failure = error }
      if (!failure?.message.includes('failed SVG conformance: draw-node-semantics: forced failure'))
        throw new Error('unproven writer produced output')
    }
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
})

test('first backend proof uses default measurements under a custom caller profile', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import './src/scene/default-backend.ts'
    import { getBackendDescriptor } from './src/scene/backend.ts'
    import { createTextMeasurementExecution, withTextMeasurementExecution } from './src/text-measurement-profile.ts'
    import { measureTextWidth } from './src/text-metrics.ts'
    const profile = createTextMeasurementExecution({ id: 'must-not-seed-proof', version: '1.0.0',
      measure(input) {
        if (input.text === 'Fixture label') throw new Error('backend fixture used caller measurements')
        return measureTextWidth(input.text, input.fontSize, input.fontWeight, input.fontStyle, input.fontFamily)
      }
    }, 'Inter')
    const report = withTextMeasurementExecution(profile, () => getBackendDescriptor('default').conformance)
    assert.equal(report.passed, true)
    assert.equal(getBackendDescriptor('default').conformance, report)
    assert.equal(Object.isFrozen(report), true)
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
  expect(child.stderr).toBe('')
  expect(child.status).toBe(0)
})

test('a replaced default drawer cannot hide later fixture mutation behind prior admission', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { DefaultBackend, getBackendDescriptor } from './src/scene/backend.ts'
    import { attachSceneNodeSerialization, sceneNodeSerialization } from './src/scene/serialization.ts'
    const draw = DefaultBackend.drawNode
    const visits = new WeakMap()
    let root, poisoned = false
    DefaultBackend.drawNode = function(node, context) {
      if (node.kind === 'document' && node.element === 'open') root = node
      const count = (visits.get(node) ?? 0) + 1
      visits.set(node, count)
      // Initial identical text probes pass. A later claim changes opaque
      // document metadata, which object freezing alone does not protect.
      if (!poisoned && node.kind === 'text' && count > 2) {
        attachSceneNodeSerialization(root, sceneNodeSerialization(root) + '<script>late()</script>')
        poisoned = true
      }
      return draw.call(this, node, context)
    }
    await import('./src/scene/default-backend.ts')
    const report = getBackendDescriptor('default').conformance
    assert.equal(poisoned, true)
    assert.equal(report.passed, false)
    assert.ok(report.claims.some(claim => claim.status === 'failed' && claim.diagnostic?.includes('active content')))
    assert.throws(() => DefaultBackend.drawNode(undefined, undefined), /failed SVG conformance/)
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
})

test.each(['accessor', 'proxy'])('built-in fixture reuse leaves %s backend observations unchanged', async mode => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { DefaultBackend, getBackendDescriptor, registerBuiltInBackend } from './src/scene/backend.ts'
    const events = []
    if (${JSON.stringify(mode)} === 'accessor') {
      const draw = DefaultBackend.drawNode
      let method = function(node, context) { events.push('call'); assert.equal(this, DefaultBackend); return draw.call(this, node, context) }
      Object.defineProperty(DefaultBackend, 'drawNode', {
        enumerable: true, configurable: true,
        get() { events.push('get'); return method },
        set(value) { events.push('set'); method = value },
      })
      await import('./src/scene/default-backend.ts')
      assert.deepEqual(events, ['get', 'set'])
      assert.equal(getBackendDescriptor('default').conformance.passed, true)
      const calls = events.slice(2)
      assert.ok(calls.length > 2)
      for (let index = 0; index < calls.length; index += 2) assert.deepEqual(calls.slice(index, index + 2), ['get', 'call'])
    } else {
      const target = { ...DefaultBackend, id: 'test-proxy', capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: 'backend:test-proxy' })) }
      const proxy = new Proxy(target, {
        get(object, key, receiver) { events.push('get:' + String(key)); return Reflect.get(object, key, receiver) },
        getOwnPropertyDescriptor(object, key) { events.push('descriptor:' + String(key)); return Reflect.getOwnPropertyDescriptor(object, key) },
      })
      registerBuiltInBackend(proxy)
      // Eligibility checks must not inspect a custom/proxy property surface.
      assert.deepEqual(events.slice(0, 2), ['get:id', 'get:capabilities'])
      assert.equal(getBackendDescriptor('test-proxy').backend, proxy)
      assert.equal(getBackendDescriptor('test-proxy').conformance.passed, true)
    }
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
})

test('Sequence layout and drawing stay sibling stages through reentry and observer failure', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { renderMermaidSVGWithReceipt } from './src/index.ts'
    import { withRenderStageObserver } from './src/render-stages.ts'
    const source = 'sequenceDiagram\\nA->>B: Forward\\nB->>A: Back'
    const expected = JSON.stringify(renderMermaidSVGWithReceipt(source))
    const stages = []
    let entered = false, nested
    const result = withRenderStageObserver(sample => {
      stages.push({ stage: sample.stage, depth: sample.depth, parent: sample.parent })
      if (sample.stage === 'layout' && !entered) {
        entered = true
        nested = JSON.stringify(renderMermaidSVGWithReceipt(source))
      }
    }, () => renderMermaidSVGWithReceipt(source))
    assert.equal(JSON.stringify(result), expected)
    assert.equal(nested, expected)
    assert.deepEqual(stages.map(sample => sample.stage), [
      'request', 'layout', 'request', 'layout', 'drawing', 'paint-certification', 'svg-security',
      'drawing', 'paint-certification', 'svg-security',
    ])
    assert.ok(stages.every(sample => sample.depth === 0 && sample.parent === undefined))
    const fault = new Error('drawing observation stopped this call')
    assert.throws(() => withRenderStageObserver(sample => {
      if (sample.stage === 'drawing') throw fault
    }, () => renderMermaidSVGWithReceipt(source)), error => error === fault)
    assert.equal(JSON.stringify(renderMermaidSVGWithReceipt(source)), expected)
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', AGENTIC_MERMAID_ELK_CACHE: '0' } })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
})

test('ordinary Sequence messages retain complete SVG and paint receipts across the private drawing adapter', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { renderMermaidSVGWithReceipt } from './src/index.ts'
    import { getFamily, replaceFamilyForTest } from './src/agent/families.ts'
    import { releaseBenchCases } from './eval/benchmark/release-bench-cases.ts'
    const source = releaseBenchCases().find(value => value.id === 'sequence:20-participants-300-messages').source
    const original = getFamily('sequence')
    for (const cache of ['0', '1']) {
      process.env.AGENTIC_MERMAID_ELK_CACHE = cache
      const compact = renderMermaidSVGWithReceipt(source)
      const restore = replaceFamilyForTest('sequence', { ...original })
      try {
        assert.deepEqual(compact, renderMermaidSVGWithReceipt(source))
      } finally { restore() }
      assert.equal(JSON.stringify(renderMermaidSVGWithReceipt(source)), JSON.stringify(compact))
      assert.equal([...compact.svg.matchAll(/data-relationship="sequence-message"/g)].length, 300)
      assert.equal([...compact.svg.matchAll(/data-relationship="lifeline"/g)].length, 110)
    }
  `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
})
