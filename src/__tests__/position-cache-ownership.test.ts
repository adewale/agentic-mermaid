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
