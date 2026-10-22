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
