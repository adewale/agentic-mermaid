import { expect, test } from 'bun:test'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

test('native cached rendering stays isolated from public geometry and replacement projectors', async () => {
  const child = await runChild(process.execPath, ['-e', `
    import assert from 'node:assert/strict'
    import { renderMermaidSVGWithReceipt } from './src/index.ts'
    import { resolveRenderRequestForExecution } from './src/render-contract.ts'
    import { positionResolvedFamily, retainedFamilyProjection } from './src/positioning.ts'
    import { getFamily, replaceFamilyForTest } from './src/agent/families.ts'
    const source = 'sequenceDiagram\\nCacheOwnerA->>CacheOwnerB: isolated text'
    const options = { embedFontImport: false }
    const first = renderMermaidSVGWithReceipt(source, options)
    for (let i = 0; i < 3; i++) {
      const request = resolveRenderRequestForExecution(source, options, 'svg')
      const publicResult = positionResolvedFamily('sequence', request)
      publicResult.positioned.width = NaN
      publicResult.positioned.actors[0].label = 'poisoned'
      retainedFamilyProjection(publicResult).nodes.length = 0
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
    }
    for (const changed of [{ font: 'Arial' }, { style: 'paper' }, { layoutSafety: 'strict' }, { style: 'excalidraw' }]) {
      const rendered = renderMermaidSVGWithReceipt(source, { ...options, ...changed })
      assert.deepEqual(renderMermaidSVGWithReceipt(source, { ...options, ...changed }), rendered)
    }
    const original = getFamily('sequence')
    let invalid = false, projections = 0
    const restore = replaceFamilyForTest('sequence', { ...original,
      projectPositioned(ctx) {
        projections++
        const view = original.projectPositioned(ctx)
        return invalid ? { ...view, bounds: { ...view.bounds, w: NaN } } : view
      }
    })
    try {
      assert.deepEqual(renderMermaidSVGWithReceipt(source, options), first)
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
