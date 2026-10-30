import { expect, test } from 'bun:test'
import { Resvg } from '@resvg/resvg-js'
import * as marks from '../scene/marks.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { connectorMarkerPaintRegions, nodePaintBounds } from '../scene/bounds.ts'
import { certifyNativePaint, certifyScenePaint, prepareMarkerPolygonInk, compareMarkerStrokeInk } from '../scene/paint-certification.ts'
import type { Geometry, MarkPaint, SceneDoc, SceneNode, SceneTransform, MarkerDescriptor } from '../scene/ir.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { layoutMermaidWithReceipt, verifyMermaid } from '../agent/core.ts'
import { renderMermaidSVGWithReceipt, renderMermaidASCIIWithReceipt } from '../index.ts'
import { lowerPositionedFamilyScene, renderedSvgDigest } from '../graphical-render.ts'
import { resolveRenderRequestForExecution, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { inspectScenePrimitives, scenePrimitiveSource, inspectNativePaintGeometry, paintPrimitiveSource, inspectScenePaintGeometry } from '../scene/inspection.ts'
import { sceneNodeSerialization, createSceneWriteCapture } from '../scene/serialization.ts'
import { serializeMarkerResource, tipAnchoredArrow } from '../scene/marker-resources.ts'
import { drawNative } from '../scene/native-drawing.ts'
import { SaxesParser } from 'saxes'
import { useTestChildren } from './helpers/test-child.ts'
import type { DrawingProducer } from '../scene/drawing.ts'
import { measureQuality } from '../agent/quality.ts'
import { replaceFamilyForTest } from '../agent/families.ts'
import type { PositionedArchitectureDiagram } from '../architecture/types.ts'
import type { PositionedErDiagram } from '../er/types.ts'
import type { PositionedIshikawa } from '../ishikawa/types.ts'
import { classMarkerResources } from '../class/relationship-paint.ts'
import { inlineResolvedColors } from '../theme.ts'
import { projectConnectorPath } from '../scene/connector-geometry.ts'
import { admitSceneDocument } from '../scene/external-data-snapshot.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { createNativePaintEmission, MAX_OCCLUSION_OPERATIONS } from '../scene/native-paint-emission.ts'
import { inspectSvgOnce, withSvgInspectionCache } from '../svg-inspection-cache.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

const scene = (parts: SceneNode[]): SceneDoc => ({ family: 'flowchart', width: 100, height: 80, transparent: false, colors: { bg: '#fff', fg: '#111' }, parts })
const label = () => {
  const block = preparePixelText('Read', { fontSize: 12, fontWeight: 400 })
  return marks.text({ id: 'text', role: 'label', text: 'Read', block, x: 20, y: 30, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
}
const surface = (fill = '#fff') => marks.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 80, height: 60 }, paint: { fill } })

function drawPaintControl(producer: DrawingProducer, context: Parameters<typeof drawNative>[1], execution: 'native' | 'scene', captureOptions: Parameters<typeof createSceneWriteCapture>[1] = {}) {
  if (execution === 'native') {
    const drawing = drawNative(producer, context, 'flowchart')
    return { ...drawing, proof: certifyNativePaint(drawing.header, drawing.paint), admitted: undefined, raw: undefined, receipt: undefined }
  }
  const raw = producer<SceneNode>(marks, context)
  const capture = createSceneWriteCapture(MAX_OCCLUSION_OPERATIONS, captureOptions)
  const admitted = admitSceneDocument(raw, 'internal', true, capture.observe)
  const receipt = capture.finish(admitted)
  const svg = DefaultBackend.render(admitted, { seed: 0 })
  return { svg, header: admitted, paint: inspectScenePaintGeometry(admitted, receipt), proof: certifyScenePaint(admitted, undefined, { sceneWriteReceipt: receipt }), admitted, raw, receipt }
}

test('many ordinary prepared labels retain bounded Native paint proof without markers', () => {
  const width = 200, height = 31000, colors = { bg: '#fff', fg: '#111' }
  const block = preparePixelText('x', { fontSize: 12, fontWeight: 400 })
  const marker = tipAnchoredArrow('decorative-arrow', { width: 8, height: 5 }, 'end', { fill: '#111', stroke: '#111', strokeWidth: '0.75' }, 'userSpaceOnUse')
  const open = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="31000">'
  const context = { positioned: { width, height }, colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ family: 'flowchart', width, height, colors, transparent: false, parts: [
    factory.documentOpen({ id: 'root', width, height, colors, transparent: false, font: 'Inter', hasMonoFont: false }, open),
    factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    ...Array.from({ length: 1500 }, (_, index) => factory.text({ id: `text:${index}`, role: 'label', text: 'x', block, x: 20, y: 1000 + index * 20, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.paint.primitives.filter(primitive => primitive.kind === 'text').map(primitive => primitive.id)).toEqual(Array.from({ length: 1500 }, (_, index) => `text:${index}`))
  const labels: Array<{ attributes: Record<string, string>; text: string }> = []
  let current: typeof labels[number] | undefined
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', tag => {
    if (tag.local === 'text') {
      current = { attributes: Object.fromEntries(Object.entries(tag.attributes).map(([name, value]) => [name, value.value])), text: '' }
      labels.push(current)
    }
  })
  parser.on('text', value => { if (current) current.text += value })
  parser.on('closetag', tag => { if (tag.local === 'text') current = undefined })
  parser.write(drawing.svg).close()
  expect(labels).toHaveLength(1500)
  for (const [index, label] of labels.entries()) {
    const { textLength, ...attributes } = label.attributes
    expect(Number.isFinite(Number(textLength)) && Number(textLength) > 0).toBe(true)
    expect({ text: label.text, attributes }).toEqual({ text: 'x', attributes: {
      x: '20', y: String(1000 + index * 20), 'text-anchor': 'start', 'font-size': '12', 'font-weight': '400', fill: '#111',
      'data-prepared-text': 'true', dy: '4.2', lengthAdjust: 'spacingAndGlyphs', 'data-font-metrics': 'deterministic-fit',
    } })
  }
  expect(drawing.svg.split(open)).toHaveLength(2)
  const tags = drawing.svg.match(/<text\b[^>]*>[^<]*<\/text>/g)!
  expect(tags).toHaveLength(1500)
  const font = { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' }
  for (const index of [0, 1499]) {
    // Crop the actual document to a 20px window; only the raster viewport
    // changes. Removing that actual first/last tag must remove visible ink.
    const cropped = drawing.svg.replace(open, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="20" viewBox="0 ${990 + index * 20} 200 20">`)
    const actual = new Resvg(cropped, { font, background: '#fff' }).render().pixels
    const absent = new Resvg(cropped.replace(tags[index]!, ''), { font, background: '#fff' }).render().pixels
    expect(actual.length).toBe(200 * 20 * 4)
    expect(Buffer.compare(actual, absent)).not.toBe(0)
  }
  const proof = certifyNativePaint(drawing.header, drawing.paint)
  expect(proof.checks.maxOperations).toBe(400000)
  expect(proof.checks.operations).toBeLessThanOrEqual(400000)
  expect(proof.status).toBe('passed')
})

test.each(['LR', 'RL', 'TB', 'BT'] as const)('rounded endpoint contacts retain strict paint proof in %s', direction => {
  const source = `flowchart ${direction}\nN0[n0]\nN1[n1]\nN2([n2])\nN3((n3))\nN2 --> N1\nN1 <==> N2\nN0 --> N2\nN2 --> N3\nN0 --> N2`
  const rendered = renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict', embedFontImport: false })
  expect(rendered.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
})

test.each(['contact', 'rx-only', 'ry-only', 'entering', 'unrelated', 'borderless', 'translucent-border', 'unknown-width'] as const)('rounded supporting lines retain actual marker ink obligations (%s)', mode => {
  // The left semicircle is centred at (58,38), radius18. At y35 its
  // boundary is58-sqrt(18²-3²), inside the rectangle's otherwise empty corner.
  const x = 58 - Math.sqrt(18 * 18 - 3 * 3) + (mode === 'entering' ? 2 : 0)
  const marker = tipAnchoredArrow('rounded-arrow', { width: 8, height: 5 }, 'end', { fill: '#111', stroke: '#111', strokeWidth: '0.75', strokeLinejoin: 'round' }, 'userSpaceOnUse')
  const edge = marks.connector({ id: 'rounded-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 35, x2: x, y2: 35 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: mode === 'unrelated' ? 'another-node' : 'rounded-node' }, markers: { end: marker } })
  const card = marks.shape({ id: 'rounded-node', role: 'node', geometry: { kind: 'rect', x: 40, y: 20, width: 50, height: 36, ...(mode !== 'ry-only' ? { rx: 18 } : {}), ...(mode !== 'rx-only' ? { ry: 18 } : {}) }, paint: { fill: '#fff', stroke: mode === 'borderless' ? 'none' : '#111', strokeWidth: mode === 'unknown-width' ? '1em' : '0.75', ...(mode === 'translucent-border' ? { strokeOpacity: '0.5' } : {}) } })
  const proof = certifyScenePaint(scene([edge, card]))
  if (['contact', 'rx-only', 'ry-only'].includes(mode)) expect(proof.status).toBe('passed')
  else expect(proof.status).not.toBe('passed')
})

test.each(['default-hidden', 'explicit-hidden', 'user-space', 'start', 'reverse-start', 'vertical', 'written-tangent', 'vertical-written-tangent', 'borderless', 'matched-viewbox', 'visible', 'interior-ref', 'entering', 'tiny-entering', 'scale-hint', 'viewbox', 'rotated', 'diagonal', 'written-mismatch', 'written-axial', 'written-collapsed', 'written-width', 'unknown-width', 'unsupported-output'] as const)('a clipped endpoint viewport proves complete marker containment only for %s', mode => {
  const start = mode === 'start' || mode === 'reverse-start', vertical = mode === 'vertical' || mode === 'vertical-written-tangent'
  const marker: MarkerDescriptor = tipAnchoredArrow('viewport-arrow', { width: 8, height: 5 }, start && mode !== 'reverse-start' ? 'start' : 'end', { fill: '#111', stroke: '#111', strokeWidth: '0.75', strokeLinejoin: 'round' }, mode === 'user-space' ? 'userSpaceOnUse' : undefined)
  if (mode === 'reverse-start') marker.orient = 'auto-start-reverse'
  if (mode === 'explicit-hidden') marker.overflow = 'hidden'
  if (mode === 'visible') marker.overflow = 'visible'
  if (mode === 'interior-ref') marker.ref = { x: 7, y: 2.5 }
  if (mode === 'scale-hint') marker.scale = 2
  if (mode === 'viewbox') marker.viewBox = { x: 0, y: 0, width: 16, height: 5 }
  if (mode === 'matched-viewbox') marker.viewBox = { x: 0, y: 0, width: 8, height: 5 }
  if (mode === 'rotated') marker.orient = 90
  const borderless = mode === 'borderless' || mode === 'tiny-entering'
  const anchor = mode === 'entering' ? 61 : mode === 'tiny-entering' ? 60.000000001 : 60
  const points = vertical ? [{ x: 40, y: 20 }, { x: 40, y: anchor }] : start ? [{ x: anchor, y: 40 }, { x: 20, y: 40 }] : [{ x: 20, y: 40 }, { x: anchor, y: 40 }]
  if (mode === 'diagonal') points[0]!.y = 30
  if (mode === 'written-mismatch') points[1]!.y = 40.00000000000001
  if (mode === 'written-axial') points[1]!.x = 60.00000000000001
  if (mode === 'written-collapsed') points[0]!.x = 60.00000000000001
  if (mode === 'written-tangent') for (const point of points) point.y = 40.00000000000001
  if (mode === 'vertical-written-tangent') for (const point of points) point.x = 40.00000000000001
  const edge = marks.connector({ id: 'viewport-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'polyline', points }, paint: { stroke: '#111', strokeWidth: mode === 'unknown-width' ? 'var(--host)' : mode === 'viewbox' ? '4' : mode === 'written-width' ? '2.000000000000001' : '2' }, endpoints: start ? { from: 'viewport-node', to: 'outside' } : { from: 'outside', to: 'viewport-node' }, markers: start ? { start: marker } : { end: marker } })
  const card = marks.shape({ id: 'viewport-node', role: 'node', geometry: vertical ? { kind: 'rect', x: 20, y: 60, width: 40, height: 30 } : { kind: 'rect', x: 60, y: 20, width: 30, height: 40, ...(borderless ? { rx: 5, ry: 5 } : {}) }, paint: { fill: '#fff', stroke: borderless ? 'none' : '#888', strokeWidth: '0.75' } })
  const proof = certifyScenePaint(scene([edge, card]), undefined, { outputSupported: mode !== 'unsupported-output' })
  if (['default-hidden', 'explicit-hidden', 'user-space', 'start', 'reverse-start', 'vertical', 'written-tangent', 'vertical-written-tangent', 'borderless', 'matched-viewbox'].includes(mode)) expect(proof.status).toBe('passed')
  else expect(proof.status).not.toBe('passed')
})

test.each(['horizontal-negative', 'horizontal-positive', 'vertical-negative', 'vertical-positive'] as const)('serialized marker ink, rather than its raw witness, retains %s translation uncertainty', mode => {
  const vertical = mode.startsWith('vertical'), negative = mode.endsWith('negative')
  // These two authored coordinates round in opposite directions by about
  // 5e-8, farther than the witness slack and the complete tiny marker height.
  const raw = negative ? 10000.123456749994 : 10000.123456750007
  const written = negative ? 10000.1234567 : 10000.1234568
  const marker = tipAnchoredArrow('translated-arrow', { width: 8e-9, height: 5e-9 }, 'end', { fill: '#111', stroke: 'none' }, 'userSpaceOnUse')
  const edge = marks.connector({ id: 'translated-edge', role: 'edge', lineStyle: 'solid',
    geometry: vertical ? { kind: 'line', x1: raw, y1: 20, x2: raw, y2: 60 } : { kind: 'line', x1: 20, y1: raw, x2: 60, y2: raw },
    paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'outside', to: 'translated-node' }, markers: { end: marker } })
  const card = marks.shape({ id: 'translated-node', role: 'node',
    geometry: vertical ? { kind: 'rect', x: written - (negative ? 20 : 0), y: 40, width: 20, height: 50 }
      : { kind: 'rect', x: 40, y: written - (negative ? 20 : 0), width: 50, height: 20 },
    paint: { fill: '#fff', stroke: '#111', strokeWidth: '0.00000002' } })
  expect(sceneNodeSerialization(edge)).toContain(vertical ? `x1="${written}"` : `y1="${written}"`)
  // Before serialization this entire marker clears the thin border. The
  // emitted marker lies inside that border, so no exterior raw point may
  // enable the attached-border contact allowance or skip the spatial pair.
  const rawBounds = connectorMarkerPaintRegions(edge)[0]!.bounds!
  const border = nodePaintBounds(card)!
  expect(vertical ? negative ? rawBounds.x0 > border.x1 : rawBounds.x1 < border.x0 : negative ? rawBounds.y0 > border.y1 : rawBounds.y1 < border.y0).toBe(true)
  const proof = certifyScenePaint(scene([edge, card]))
  expect(proof.status).not.toBe('passed')
  expect(proof.issues).toContainEqual(expect.objectContaining({ id: 'translated-edge', by: 'translated-node' }))
})

test.each(['plain', 'transformed', 'cancelled'] as const)('the added axial marker support requires unchanged emitted shape coordinates (%s)', mode => {
  const marker = tipAnchoredArrow('axis-arrow', { width: 8, height: 5 }, 'end', { fill: '#111', stroke: '#111', strokeWidth: '0.75', strokeLinejoin: 'round' })
  const translation = mode === 'cancelled' ? 10000.123456750007 : 1e-13
  const context = { positioned: { width: 120, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...scene([]), width: 120, parts: [
    factory.documentOpen({ id: 'root', width: 120, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">'),
    factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector({ id: 'axis-edge', role: 'edge', lineStyle: 'thick', geometry: { kind: 'line', x1: 110, y1: 38, x2: 90, y2: 38 }, paint: { stroke: '#111', strokeWidth: '2' }, endpoints: { from: 'outside', to: 'axis-node' }, markers: { end: marker } }),
    factory.group({ id: 'axis-node', role: 'node', open: mode === 'cancelled' ? `<g transform="translate(${-translation} 0)">` : '<g>', close: '</g>',
      ...(mode === 'cancelled' ? { transform: { kind: 'matrix' as const, a: 1, b: 0, c: 0, d: 1, e: -translation, f: 0 } } : {}),
      children: [{ node: factory.shape({ id: 'axis-shape', role: 'node', owner: { id: 'axis-node', role: 'node' }, geometry: { kind: 'rect', x: 40, y: 20, width: 50, height: 36, rx: 18, ry: 18 }, paint: { fill: '#fff', stroke: '#111', strokeWidth: '0.75' },
        ...(mode !== 'plain' ? { transform: { kind: 'matrix' as const, a: 1, b: 0, c: 0, d: 1, e: translation, f: 0 } } : {}) }), indent: 0 }] }),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  for (const proof of [certifyScenePaint(producer(marks, context)), certifyNativePaint(drawing.header, drawing.paint)]) {
    if (mode === 'plain') expect(proof.status).toBe('passed')
    else {
      expect(proof.status).not.toBe('passed')
      expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'axis-edge', by: 'axis-shape' }))
    }
  }
  if (mode === 'cancelled') {
    // The authored leaf and group matrices cancel, but the leaf attribute
    // normalizes while the verbatim group transform retains its raw value.
    expect(drawing.svg).toContain('transform="matrix(1 0 0 1 10000.1234568 0)"')
    expect(drawing.svg).toContain('transform="translate(-10000.123456750007 0)"')
  }
})

test.each(['clear', 'covered', 'inherited-separated', 'uncaptured-group-eraser', 'wrong-ref', 'clipped', 'unknown-width', 'dashed', 'mutated', 'css', 'inner-child', 'resource-coordinate', 'resource-width', 'body-width', 'own-white-carrier', 'later-white-carrier', 'same-black-carrier', 'earlier-black-carrier', 'black-backdrop'] as const)('a stroke-only circle retains actual emitted ink authority for %s', mode => {
  const context = { positioned: { width: 100, height: 80 }, colors: mode === 'black-backdrop' ? { bg: '#000', fg: '#000' } : { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  let uncapturedOwnerReads = 0
  const marker: MarkerDescriptor = {
    id: 'ring', shape: 'circle', units: 'userSpaceOnUse', orient: 'auto',
    size: mode === 'clipped' ? { width: 1, height: 1 } : { width: 6, height: 6 },
    ref: { x: mode === 'wrong-ref' ? 3 : 5, y: 3 },
    geometry: { kind: 'circle', cx: mode === 'resource-coordinate' ? 3.00000000000001 : 3, cy: 3, r: 2 },
    paint: { fill: 'none', stroke: mode === 'same-black-carrier' || mode === 'earlier-black-carrier' || mode === 'black-backdrop' ? '#000' : '#111', strokeWidth: mode === 'unknown-width' ? 'var(--host)' : mode === 'resource-width' ? '1.00000000000001' : '1', ...(mode === 'dashed' ? { strokeDasharray: '1 1' } : {}) },
  }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">')
    const definitions = factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(marker)}${mode === 'css' ? '<style>marker circle { stroke: none }</style>' : ''}</defs>`)
    if (mode === 'mutated') marker.paint!.stroke = 'none'
    const earlier = mode === 'earlier-black-carrier' ? [factory.connector({ id: 'earlier-shaft', role: 'chrome', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 60, y2: 40 }, paint: { stroke: '#000', strokeWidth: '20' } })] : []
    const edge = factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', endpoints: { from: 'outside', to: 'card' }, geometry: { kind: 'line', x1: 20, y1: 40, x2: 60, y2: 40 },
      paint: { stroke: mode === 'own-white-carrier' ? '#fff' : mode === 'same-black-carrier' || mode === 'earlier-black-carrier' || mode === 'black-backdrop' ? '#000' : '#111', strokeWidth: mode === 'own-white-carrier' || mode === 'same-black-carrier' ? '20' : '1', ...(mode === 'own-white-carrier' ? { paintOrder: 'markers stroke fill' } : {}) }, markers: { end: marker } })
    const later = mode === 'later-white-carrier' ? [factory.connector({ id: 'later-eraser', role: 'chrome', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 60, y2: 40 }, paint: { stroke: '#fff', strokeWidth: '20' } })] : []
    const card = factory.shape({ id: 'card', role: 'node',
      geometry: mode === 'covered' || mode === 'inherited-separated' ? { kind: 'rect', x: 53, y: 34, width: 14, height: 12 }
        : mode === 'inner-child' ? { kind: 'compound', children: [{ kind: 'rect', x: 60, y: 20, width: 30, height: 40 }, { kind: 'line', x1: 54, y1: 38, x2: 60, y2: 38 }] }
          : { kind: 'rect', x: 60, y: 20, width: 30, height: 40 },
      paint: { fill: '#fff', stroke: '#888', strokeWidth: mode === 'body-width' ? '1.00000000000001' : '1' },
      ...(mode === 'inner-child' ? { childPaints: [{ fill: '#fff', stroke: '#888', strokeWidth: '1' }, { fill: 'none', stroke: '#111', strokeWidth: '2' }] } : {}),
    })
    const unrecorded = mode === 'uncaptured-group-eraser' ? [factory.group({ id: 'uncaptured-shell', role: 'chrome', owner: { get id() { uncapturedOwnerReads++; return 'card' }, role: 'node' }, open: '<g>', close: '<rect x="53" y="34" width="14" height="12" fill="#fff"/></g>', children: [] })] : []
    return { ...scene([]), colors: context.colors, parts: [open, definitions, ...earlier, edge, ...later, card, ...unrecorded, factory.documentClose()] }
  }
  const native = drawNative(producer, context, 'flowchart', mode === 'black-backdrop' ? { colors: { bg: '#000' } } : undefined)
  const drawing = mode === 'black-backdrop' ? { ...native, svg: inlineResolvedColors(native.svg, native.header.colors) } : native
  expect(drawing.svg).toContain('<line x1="20" y1="40" x2="60" y2="40"')
  expect(drawing.svg).toContain('marker-end="url(#ring)"')
  expect(drawing.svg).toContain(mode === 'resource-coordinate' ? '<circle cx="3.00000000000001" cy="3" r="2" fill="none" stroke="#111"' : mode === 'same-black-carrier' || mode === 'earlier-black-carrier' || mode === 'black-backdrop' ? '<circle cx="3" cy="3" r="2" fill="none" stroke="#000"' : '<circle cx="3" cy="3" r="2" fill="none" stroke="#111"')
  if (mode === 'resource-width') expect(drawing.svg).toContain('stroke-width="1.00000000000001"')
  if (mode === 'own-white-carrier' || mode === 'later-white-carrier') expect(drawing.svg).toContain('<line x1="20" y1="40" x2="60" y2="40" stroke="#fff" stroke-width="20"')
  if (mode === 'own-white-carrier') expect(drawing.svg).toContain('paint-order="markers stroke fill"')
  if (mode === 'same-black-carrier' || mode === 'earlier-black-carrier' || mode === 'black-backdrop') {
    if (mode !== 'black-backdrop') expect(drawing.svg).toContain('<line x1="20" y1="40" x2="60" y2="40" stroke="#000" stroke-width="20"')
    if (mode !== 'same-black-carrier') expect(drawing.svg).toContain('<line x1="20" y1="40" x2="60" y2="40" stroke="#000" stroke-width="1" marker-end="url(#ring)"')
    if (mode === 'black-backdrop') expect(drawing.svg).toContain('<rect width="100" height="80" fill="#000" data-backdrop="page" />')
    expect(drawing.svg).not.toContain('paint-order=')
    const markerEnd = ' marker-end="url(#ring)"'
    expect(drawing.svg.split(markerEnd)).toHaveLength(2)
    // Pure black avoids raster rounding noise: the circle has no visible
    // effect when its whole surviving ring lies over existing opaque ink.
    const withMarker = new Resvg(drawing.svg).render().pixels
    const withoutMarker = new Resvg(drawing.svg.replace(markerEnd, '')).render().pixels
    expect(Buffer.compare(withMarker, withoutMarker)).toBe(0)
  }
  if (['clear', 'covered', 'inherited-separated', 'clipped', 'css', 'own-white-carrier', 'later-white-carrier'].includes(mode)) {
    // The top ring point (58,38) is real stroke ink, away from the carrier
    // shaft at y40 and the attached card's leftmost stroke at x59.5.
    const render = new Resvg(drawing.svg).render(), pixels = render.pixels
    let topInk = 0
    for (let y = 37; y < 39; y++) for (let x = 57; x < 59; x++) {
      const index = (y * render.width + x) * 4
      if (pixels[index + 3]! > 0 && pixels[index]! < 96 && pixels[index + 1]! < 96 && pixels[index + 2]! < 96) topInk++
    }
    if (mode === 'clear') expect(topInk).toBeGreaterThan(0)
    else expect(topInk).toBe(0)
  }
  if (mode === 'inherited-separated') {
    // The complete ring [55.5,60.5]x[37.5,42.5] is inside the later
    // opaque card fill. Observe actual output before the host mutation.
    expect(drawing.svg).toContain('<rect x="53" y="34" width="14" height="12" fill="#fff" stroke="#888" stroke-width="1"')
    const reference = ' marker-end="url(#ring)"'
    expect(drawing.svg.split(reference)).toHaveLength(2)
    const actual = new Resvg(drawing.svg).render().pixels
    const absent = new Resvg(drawing.svg.replace(reference, '')).render().pixels
    expect(Buffer.compare(actual, absent)).toBe(0)
  }
  if (mode === 'uncaptured-group-eraser') {
    const elements = rectangleEmissionElements(drawing.svg)
    expect(elements.filter(element => element.name === 'rect' && element.attributes.x === '53')).toEqual([{ name: 'rect', attributes: { x: '53', y: '34', width: '14', height: '12', fill: '#fff' } }])
    expect(elements.find(element => element.attributes['data-id'] === 'card')!.attributes).toMatchObject({ x: '60', y: '20', width: '30', height: '40', fill: '#fff', stroke: '#888', 'stroke-width': '1' })
    expect(uncapturedOwnerReads).toBeGreaterThan(0)
    const reference = ' marker-end="url(#ring)"'
    expect(drawing.svg.split(reference)).toHaveLength(2)
    const actual = new Resvg(drawing.svg).render().pixels
    const absent = new Resvg(drawing.svg.replace(reference, '')).render().pixels
    // Authored ring[55.5,60.5]×[37.5,42.5] is wholly erased by
    // actual unmodeled white fill[53,67]×[34,46], not its typed card.
    expect(Buffer.compare(actual, absent)).toBe(0)
  }
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'separated')
  let proof: ReturnType<typeof certifyNativePaint>
  try {
    if (mode === 'inherited-separated') Object.defineProperty(Object.prototype, 'separated', { configurable: true, value: true })
    proof = certifyNativePaint(drawing.header, drawing.paint)
  } finally {
    if (mode === 'inherited-separated') {
      if (descriptor) Object.defineProperty(Object.prototype, 'separated', descriptor)
      else delete (Object.prototype as { separated?: boolean }).separated
    }
  }
  if (mode === 'inherited-separated') {
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'separated')).toEqual(descriptor)
    expect(proof.status).toBe('unverified')
  }

  if (mode === 'clear') {
    expect(drawing.svg).toContain('markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse"')
    expect(drawing.svg).toContain('<rect x="60" y="20" width="30" height="40" fill="#fff" stroke="#888" stroke-width="1"')
    expect(proof.status).toBe('passed')
    expect(proof.issues).toEqual([])
  } else expect(proof.status).not.toBe('passed')
})

test('an opposite endpoint marker cannot borrow a mutated supplied line tangent to erase visible ink', () => {
  const colors = { bg: '#fff', fg: '#111' }
  const context = { positioned: { width: 160, height: 160 }, colors, resolved: { renderOptions: {} } }
  const start: MarkerDescriptor = { id: 'start-ring', shape: 'circle', units: 'userSpaceOnUse', orient: 'auto', size: { width: 6, height: 6 }, ref: { x: 5, y: 3 }, geometry: { kind: 'circle', cx: 3, cy: 3, r: 2 }, paint: { fill: 'none', stroke: '#111', strokeWidth: '1' } }
  const end: MarkerDescriptor = { id: 'end-eraser', shape: 'diamond', units: 'userSpaceOnUse', orient: 'auto', size: { width: 80, height: 80 }, ref: { x: 60, y: 40 }, geometry: { kind: 'rect', x: 14, y: 34, width: 14, height: 12 }, paint: { fill: '#fff', stroke: 'none' } }
  const endTangent = { x: 1, y: 0 }, trace: string[] = []
  const producer: DrawingProducer = factory => ({ family: 'flowchart', width: 160, height: 160, transparent: false, colors, parts: [
    factory.documentOpen({ id: 'root', width: 160, height: 160, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">'),
    factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(start)}${serializeMarkerResource(end)}</defs>`),
    factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 60, x2: 60, y2: 60 }, paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'outside', to: 'card' }, markers: { start, end }, route: {
      contours: [{ start: { x: 20, y: 60 }, end: { x: 60, y: 60 }, closed: false, startTangent: { x: 1, y: 0 }, endTangent }],
      get labelAnchors() { trace.push('labelAnchors-mutates-endTangent'); endTangent.x = 0; endTangent.y = 1; return [] },
    } }),
    factory.shape({ id: 'card', role: 'node', geometry: { kind: 'rect', x: 60, y: 40, width: 30, height: 40 }, paint: { fill: '#fff', stroke: '#888', strokeWidth: '1' } }),
    factory.documentClose(),
  ] })
  const drawing = drawPaintControl(producer, context, 'native')
  const elements = rectangleEmissionElements(drawing.svg)
  expect(elements.find(element => element.name === 'svg')!.attributes.viewBox).toBe('0 0 160 160')
  expect(elements.find(element => element.attributes['data-id'] === 'edge')!.attributes).toMatchObject({ x1: '20', y1: '60', x2: '60', y2: '60', stroke: '#111', 'stroke-width': '1', 'marker-start': 'url(#start-ring)', 'marker-end': 'url(#end-eraser)' })
  expect(elements.find(element => element.name === 'marker' && element.attributes.id === 'start-ring')!.attributes).toMatchObject({ markerWidth: '6', markerHeight: '6', refX: '5', refY: '3', orient: 'auto', markerUnits: 'userSpaceOnUse' })
  expect(elements.find(element => element.name === 'circle')!.attributes).toMatchObject({ cx: '3', cy: '3', r: '2', fill: 'none', stroke: '#111', 'stroke-width': '1' })
  expect(elements.find(element => element.name === 'marker' && element.attributes.id === 'end-eraser')!.attributes).toMatchObject({ markerWidth: '80', markerHeight: '80', refX: '60', refY: '40', orient: 'auto', markerUnits: 'userSpaceOnUse' })
  expect(elements.find(element => element.name === 'rect' && element.attributes.x === '14')!.attributes).toEqual({ x: '14', y: '34', width: '14', height: '12', fill: '#fff', stroke: 'none' })
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  expect(trace).toContain('labelAnchors-mutates-endTangent')
  expect(endTangent).toEqual({ x: 0, y: 1 })
  // The actual east-facing line places the full start ring at
  // [15.5,20.5]×[57.5,62.5]. The actual opposite marker's white rectangle
  // maps to [14,28]×[54,66], wholly erasing that ring. Supplied tangent
  // metadata cannot rotate this rectangle away from the actual SVG line.
  const startToken = ' marker-start="url(#start-ring)"', endToken = ' marker-end="url(#end-eraser)"'
  expect(drawing.svg.split(startToken)).toHaveLength(2)
  expect(drawing.svg.split(endToken)).toHaveLength(2)
  const pixels = (svg: string) => new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels
  expect(Buffer.compare(pixels(drawing.svg), pixels(drawing.svg.replace(startToken, '')))).toBe(0)
  const withoutEraser = drawing.svg.replace(endToken, '')
  expect(Buffer.compare(pixels(withoutEraser), pixels(withoutEraser.replace(startToken, '')))).not.toBe(0)
  expect(drawing.proof.status).not.toBe('passed')
})

const runRectangleChild = useTestChildren(20_000)
const ownDescriptorSlotProgram = String.raw`
import { drawNative } from './src/scene/native-drawing.ts'
import { certifyNativePaint } from './src/scene/paint-certification.ts'
import { DefaultBackend } from './src/scene/backend.ts'
import * as marks from './src/scene/marks.ts'
const boundary = process.env.AM_DESCRIPTOR_SLOT_BOUNDARY
const colors = { bg: '#fff', fg: '#111' }, context = { positioned: { width: 120, height: 100 }, colors, resolved: { renderOptions: {} } }
if (Object.hasOwn(Object.prototype, 'value')) throw new Error('Expected a clean isolated prototype')
const fixture = () => {
  let reads = 0
  const paint = { fill: '#f00', stroke: '#111', strokeWidth: '1' }
  Object.defineProperty(paint, 'opacity', { enumerable: true, configurable: true, get() { reads++; return '0' } })
  const producer = factory => ({ family: 'flowchart', width: 120, height: 100, colors, transparent: false, parts: [
    factory.documentOpen({ id: 'root', width: 120, height: 100, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100">'),
    factory.shape({ id: 'authored-card', role: 'node', geometry: { kind: 'rect', x: 20, y: 20, width: 80, height: 60, rx: 0, ry: 0 }, paint }),
    factory.documentClose(),
  ] })
  return { producer, document: boundary === 'external' ? producer(marks) : undefined, reads: () => reads }
}
// Accessors, external documents and the null-prototype pollution descriptor
// all exist before any inherited descriptor slot is introduced.
const clean = fixture(), polluted = fixture()
const pollution = Object.assign(Object.create(null), { value: '1', writable: true, configurable: true, enumerable: false })
const run = input => boundary === 'external' ? DefaultBackend.render(input.document, { seed: 0 }) : drawNative(input.producer, context, 'flowchart')
let cleanOutput, pollutedOutput, cleanError, pollutedError
try { cleanOutput = run(clean) } catch (error) { cleanError = error }
try {
  Object.defineProperty(Object.prototype, 'value', pollution)
  pollutedOutput = run(polluted)
} catch (error) { pollutedError = error } finally { delete Object.prototype.value }
const observe = (output, error, input) => ({
  svg: boundary === 'external' ? output : output?.svg,
  proof: boundary === 'native' && output ? certifyNativePaint(output.header, output.paint) : undefined,
  error: error ? { name: error.name, message: error.message } : undefined,
  getterReads: input.reads(),
})
console.log(JSON.stringify({ boundary, prototypeRestored: !Object.hasOwn(Object.prototype, 'value'), clean: observe(cleanOutput, cleanError, clean), polluted: observe(pollutedOutput, pollutedError, polluted) }))
`

test.each(['native', 'external'] as const)('an inherited descriptor value cannot replace authored opacity at the %s boundary', async boundary => {
  const child = await runRectangleChild(process.execPath, ['--eval', ownDescriptorSlotProgram], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, AM_DESCRIPTOR_SLOT_BOUNDARY: boundary },
  })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
  type Observation = { svg?: string; proof?: ReturnType<typeof certifyNativePaint>; error?: { name: string; message: string }; getterReads: number }
  const packet = JSON.parse(child.stdout) as { boundary: string; prototypeRestored: boolean; clean: Observation; polluted: Observation }
  expect(packet.boundary).toBe(boundary)
  expect(packet.prototypeRestored).toBe(true)
  const actual = (observation: Observation) => {
    if (!observation.svg) return undefined
    const elements = rectangleEmissionElements(observation.svg)
    expect(elements.find(element => element.name === 'svg')!.attributes).toMatchObject({ width: '120', height: '100', viewBox: '0 0 120 100' })
    const card = elements.find(element => element.attributes['data-id'] === 'authored-card')!.attributes
    expect(card).toMatchObject({ x: '20', y: '20', width: '80', height: '60', rx: '0', ry: '0', fill: '#f00', stroke: '#111', 'stroke-width': '1' })
    const pixels = new Resvg(observation.svg, { background: '#fff', font: { loadSystemFonts: false } }).render().pixels
    let red = 0
    for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset]! > 200 && pixels[offset + 1]! < 50 && pixels[offset + 2]! < 50 && pixels[offset + 3]! > 200) red++
    return { opacity: card.opacity, red }
  }
  const clean = actual(packet.clean), polluted = actual(packet.polluted)
  if (polluted?.opacity !== '0' && packet.polluted.svg) console.info('inherited descriptor actual authored-opacity violation', JSON.stringify({ boundary, packet, clean, polluted }))
  if (boundary === 'native') {
    expect(packet.clean.error).toBeUndefined()
    expect(clean).toEqual({ opacity: '0', red: 0 })
    expect(packet.clean.getterReads).toBeGreaterThan(0)
    expect(packet.polluted.error).toBeUndefined()
    expect(polluted).toEqual({ opacity: '0', red: 0 })
    expect(packet.polluted.getterReads).toBe(packet.clean.getterReads)
    expect(packet.polluted.svg).toBe(packet.clean.svg)
    expect(packet.polluted.proof?.status).not.toBe('passed')
  } else {
    expect(packet.clean.error).toMatchObject({ name: 'TypeError', message: expect.stringContaining('paint.opacity must be an enumerable data property') })
    expect(packet.clean.getterReads).toBe(0)
    expect(packet.polluted.error).toMatchObject({ name: 'TypeError', message: expect.stringContaining('paint.opacity must be an enumerable data property') })
    expect(packet.polluted.getterReads).toBe(0)
    expect(packet.polluted.svg).toBeUndefined()
  }
})

const publicSharpRectangleProgram = String.raw`
import { getFamily, replaceFamilyForTest } from './src/agent/families.ts'
import { sceneLowering } from './src/scene/drawing.ts'
import { serializeMarkerResource } from './src/scene/marker-resources.ts'
import { renderMermaidSVGWithReceipt } from './src/index.ts'
function publicSharpRectangle(x, width = 30, mode = 'plain') {
  const family = getFamily('flowchart')!
  const marker = {
    id: 'served-ring', shape: 'circle', units: 'userSpaceOnUse', orient: 'auto',
    size: { width: 6, height: 6 },
    ref: { x: 5, y: 3 }, geometry: { kind: 'circle', cx: 3, cy: 3, r: 2 },
    paint: { fill: 'none', stroke: '#111', strokeWidth: '1' },
  }
  if (mode === 'late-inherited-width') {
    marker.size = { width: 10, height: 10 }
    marker.ref = { x: 8, y: 5 }
    marker.geometry = { kind: 'circle', cx: 5, cy: 5, r: 4 }
  }
  let getterReads = 0
  const emissionTrace = []
  const prototypeTrace = []
  const inheritedWidthBefore = Object.getOwnPropertyDescriptor(Object.prototype, 'strokeWidth')
  const producer = (factory, context) => {
    const { width: pageWidth, height } = context.positioned
    const geometry = { kind: 'rect', x, y: 20, width, height: 40 }
    if (mode === 'getter') Object.defineProperty(geometry, 'x', { enumerable: true, get() { getterReads++; return x } })
    if (mode === 'inherited-coordinate') { delete geometry.x; Object.setPrototypeOf(geometry, { x }) }
    if (mode === 'rounded-unmarked') geometry.rx = 3
    const paint = { fill: mode === 'unknown-css' ? 'var(--host,#fff)' : '#fff', stroke: '#888', strokeWidth: mode === 'unstable-width' ? '1.00000000000001' : '1', ...(mode === 'unstable-opacity' ? { opacity: '0.99999999999999' } : {}) }
    const card = () => {
      if (mode === 'transient-inherited-width') {
        delete paint.strokeWidth
        Object.defineProperty(Object.prototype, 'strokeWidth', { configurable: true, get() {
          prototypeTrace.push(prototypeTrace.length + 1)
          if (prototypeTrace.length === 3) delete Object.prototype.strokeWidth
          return '0.25'
        } })
      }
      if (mode === 'late-inherited-width') delete paint.strokeWidth
      emissionTrace.push('body-write-begin')
      const first = factory.shape({ id: 'served-card', role: 'node', geometry, paint, ...(mode === 'transform' ? { transform: { kind: 'matrix', a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } } : {}) })
      emissionTrace.push('body-write-end')
      if (mode === 'late-inherited-width') {
        Object.defineProperty(Object.prototype, 'strokeWidth', { configurable: true, writable: true, value: '4' })
        emissionTrace.push('late-width-installed')
      }
      if (mode !== 'reused-owned-cover') return [first]
      geometry.x = 53.004
      return [first, factory.shape({ id: 'foreign-cover', role: 'node', owner: { id: 'served-card', role: 'node' }, geometry, paint })]
    }
    return { family: 'flowchart', width: pageWidth, height, colors: context.colors, transparent: false, parts: [
      factory.documentOpen({ id: 'root', width: pageWidth, height, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="' + pageWidth + '" height="' + height + '">' ),
      ...(mode === 'rounded-unmarked' ? [] : [
        factory.definitions({ id: 'defs' }, '<defs>' + serializeMarkerResource(marker) + '</defs>'),
        factory.connector({ id: 'served-edge', role: 'edge', lineStyle: 'solid', endpoints: { from: 'outside', to: 'served-card' },
          geometry: { kind: 'line', x1: 20, y1: 40, x2: 60, y2: 40 }, paint: { stroke: '#111', strokeWidth: '1' }, markers: { end: marker } }),
      ]),
      ...card(),
      factory.documentClose(),
    ] }
  }
  const restore = replaceFamilyForTest('flowchart', { ...family, lowerScene: sceneLowering(producer) })
  try {
    return { ...renderMermaidSVGWithReceipt('flowchart LR\nA["Left<br/>upper<br/>lower"] --> B[Right]', { embedFontImport: false, security: 'strict' }), getterReads, prototypeTrace, emissionTrace }
  } finally {
    if (inheritedWidthBefore) Object.defineProperty(Object.prototype, 'strokeWidth', inheritedWidthBefore)
    else delete Object.prototype.strokeWidth
    restore()
  }
}

console.log(JSON.stringify({ integer: process.env.AM_RECT_SINGLE === '1' ? undefined : publicSharpRectangle(60), rounded: publicSharpRectangle(Number(process.env.AM_RECT_X), Number(process.env.AM_RECT_WIDTH), process.env.AM_RECT_MODE), prototypeRestored: !Object.hasOwn(Object.prototype, 'strokeWidth') }))
`

async function publicSharpRectanglePair(x: number, width: number, assertions = '0', mode = 'plain', single = false) {
  const result = await runRectangleChild(process.execPath, ['--eval', publicSharpRectangleProgram], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: assertions, AM_RECT_X: String(x), AM_RECT_WIDTH: String(width), AM_RECT_MODE: mode, AM_RECT_SINGLE: single ? '1' : '0' },
  })
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' })
  return JSON.parse(result.stdout) as { integer: ReturnType<typeof renderMermaidSVGWithReceipt>; rounded: ReturnType<typeof renderMermaidSVGWithReceipt> & { getterReads: number; prototypeTrace: number[]; emissionTrace: string[] }; prototypeRestored: boolean }
}

function rectangleEmissionElements(svg: string) {
  const elements: Array<{ name: string; attributes: Record<string, string> }> = []
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', tag => elements.push({ name: tag.name, attributes: Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, value.value])) }))
  parser.write(svg).close()
  return elements
}

test.each([
  { field: 'x', x: 60.00000000000001, width: 30 },
  { field: 'width', x: 60, width: 30.00000000000001 },
])('public same-emission rectangle $field proof uses the served integer body', async ({ x, width }) => {
  const { integer, rounded } = await publicSharpRectanglePair(x, width)
  expect(rounded.svg).toBe(integer.svg)
  const elements = rectangleEmissionElements(rounded.svg)
  const card = elements.find(element => element.attributes['data-id'] === 'served-card')!
  expect(card).toEqual({ name: 'rect', attributes: { x: '60', y: '20', width: '30', height: '40', fill: '#fff', stroke: '#888', 'stroke-width': '1', 'data-id': 'served-card', 'data-role': 'node' } })
  const resource = elements.find(element => element.name === 'marker')!
  expect(resource.attributes).toMatchObject({ id: 'served-ring', markerWidth: '6', markerHeight: '6', refX: '5', refY: '3', orient: 'auto', markerUnits: 'userSpaceOnUse' })
  const circle = elements.find(element => element.name === 'circle')!.attributes
  expect(circle).toMatchObject({ cx: '3', cy: '3', r: '2', fill: 'none', stroke: '#111', 'stroke-width': '1' })
  expect(resource.attributes.viewBox).toBeUndefined()
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  const outerRadius = Number(circle.r) + Number(circle['stroke-width']) / 2
  const worldCenter = { x: 60 + Number(circle.cx) - Number(resource.attributes.refX), y: 40 + Number(circle.cy) - Number(resource.attributes.refY) }
  expect({ ...worldCenter, outerRadius, ringRight: worldCenter.x + outerRadius, bodyInnerLeft: Number(card.attributes.x) + Number(card.attributes['stroke-width']) / 2 }).toEqual({ x: 58, y: 40, outerRadius: 2.5, ringRight: 60.5, bodyInnerLeft: 60.5 })
  expect(elements.find(element => element.attributes['data-id'] === 'served-edge')!.attributes).toMatchObject({ x1: '20', y1: '40', x2: '60', y2: '40', stroke: '#111', 'stroke-width': '1', 'marker-end': 'url(#served-ring)', 'data-from': 'outside', 'data-to': 'served-card' })
  // The full ring is centered at (58,40), outer radius2.5. Its rightmost
  // x60.5 equals the card's inner border edge60.5: only the owned outline
  // band is touched, never its fill interior. The top witness(58,38) also
  // clears the entire shaft strip y39.5..40.5 and card border x59.5..60.5.
  const rendered = new Resvg(rounded.svg, { font: { loadSystemFonts: false } }).render()
  const removed = rounded.svg.replace(' marker-end="url(#served-ring)"', '')
  expect(removed).not.toBe(rounded.svg)
  const absent = new Resvg(removed, { font: { loadSystemFonts: false } }).render()
  const presentPixels = rendered.pixels, absentPixels = absent.pixels
  let topInk = 0, changed = 0
  for (let y = 37; y < 39; y++) for (let px = 57; px < 59; px++) {
    const index = (y * rendered.width + px) * 4
    if (presentPixels[index]! < 96 && presentPixels[index + 1]! < 96 && presentPixels[index + 2]! < 96 && presentPixels[index + 3]! > 0) topInk++
    if (!presentPixels.subarray(index, index + 4).equals(absentPixels.subarray(index, index + 4))) changed++
  }
  expect(topInk).toBeGreaterThan(0)
  expect(changed).toBeGreaterThan(0)
  expect(integer.receipt.layoutCertification?.status).toBe('passed')
  expect(rounded.receipt.layoutCertification?.status).toBe('passed')
  expect(rounded.receipt.layoutCertification?.outputDigest).toBe(renderedSvgDigest(rounded.svg))
})

test.each([
  { mode: 'plain', x: 60.004, width: 30, served: '60.004', expected: 'passed' as const },
  { mode: 'plain', x: 60, width: 30.004, served: '60', expected: 'passed' as const },
  ...['getter', 'inherited-coordinate', 'reused-owned-cover', 'unknown-css', 'unstable-width', 'unstable-opacity', 'transform'].map(mode => ({ mode, x: 60.00000000000001, width: 30, served: '60', expected: 'unverified' as const })),
])('public same-emission rectangle preserves $expected scope for $mode at $x/$width', async ({ mode, x, width, served, expected }) => {
  const { integer, rounded } = await publicSharpRectanglePair(x, width, '0', mode)
  const elements = rectangleEmissionElements(rounded.svg)
  const card = elements.find(element => element.attributes['data-id'] === 'served-card')!
  expect(card.attributes.x).toBe(served)
  expect(card.attributes.width).toBe(String(width))
  expect(rounded.receipt.layoutCertification?.status).toBe(expected)
  if (expected === 'passed') {
    const circle = elements.find(element => element.name === 'circle')!.attributes
    expect(circle).toMatchObject({ cx: '3', cy: '3', r: '2', fill: 'none', stroke: '#111', 'stroke-width': '1' })
    const ringRight = 60 + Number(circle.cx) - 5 + Number(circle.r) + Number(circle['stroke-width']) / 2
    const inner = Number(card.attributes.x) + Number(card.attributes['stroke-width']) / 2
    expect(ringRight).toBe(60.5)
    expect(inner).toBe(x === 60.004 ? 60.504 : 60.5)
    expect(ringRight).toBeLessThanOrEqual(inner)
    expectRectangleMarkerContributes(rounded.svg)
  }
  expect(integer.receipt.layoutCertification?.status).toBe('passed')
  if (mode === 'getter') expect(rounded.getterReads).toBeGreaterThan(0)
  if (mode === 'reused-owned-cover') {
    // The same mutable geometry supplies two distinct writes with one owner.
    // Its later occurrence at53.004 covers the whole ring; neither the earlier
    // clear x60 body nor endpoint ownership can excuse that filled intrusion.
    const foreign = elements.find(element => element.attributes['data-id'] === 'foreign-cover')!
    expect(foreign.attributes).toMatchObject({ x: '53.004', y: '20', width: '30', height: '40', fill: '#fff' })
    const rendered = new Resvg(rounded.svg, { font: { loadSystemFonts: false } }).render().pixels
    const absent = new Resvg(rounded.svg.replace(' marker-end="url(#served-ring)"', ''), { font: { loadSystemFonts: false } }).render().pixels
    expect(Buffer.compare(rendered, absent)).toBe(0)
  }
  // Final color resolution uses the fallback; caller CSS never supplies new
  // same-emission authority merely because these particular bytes look opaque.
  if (mode === 'unknown-css') expect(card.attributes.fill).toBe('#fff')
  if (mode === 'unstable-width') expect(card.attributes['stroke-width']).toBe('1')
  if (mode === 'unstable-opacity') expect(card.attributes.opacity).toBe('1')
  if (mode === 'transform') expect(card.attributes.transform).toBe('matrix(1 0 0 1 0 0)')
})

function expectRectangleMarkerContributes(svg: string): void {
  const reference = ' marker-end="url(#served-ring)"'
  expect(svg.split(reference)).toHaveLength(2)
  const actual = new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels
  const absent = new Resvg(svg.replace(reference, ''), { font: { loadSystemFonts: false } }).render().pixels
  expect(Buffer.compare(actual, absent)).not.toBe(0)
}

test.each([{ operand: 'rounded', x: 60.00000000000001 }, { operand: 'integer', x: 60 }])('public same-emission rectangle cannot borrow a $operand vanished inherited stroke width', async ({ x }) => {
  const { rounded, prototypeRestored } = await publicSharpRectanglePair(x, 30, '0', 'transient-inherited-width', x === 60)
  const elements = rectangleEmissionElements(rounded.svg)
  const card = elements.find(element => element.attributes['data-id'] === 'served-card')!.attributes
  expect(card).toMatchObject({ x: '60', y: '20', width: '30', height: '40', fill: '#fff', stroke: '#888', 'stroke-width': '0.25' })
  expect(rounded.prototypeTrace).toEqual([1, 2, 3])
  expect(prototypeRestored).toBe(true)
  // The served outline's inner edge is60.125, leaving0.375 of the ring's
  // full x60.5 extent inside actual fill. A later absent property/default1
  // cannot authorize the earlier emitted quarter-pixel border.
  const circle = elements.find(element => element.name === 'circle')!.attributes
  const resource = elements.find(element => element.name === 'marker')!.attributes
  const carrier = elements.find(element => element.attributes['data-id'] === 'served-edge')!.attributes
  expect(circle).toMatchObject({ cx: '3', cy: '3', r: '2', fill: 'none', stroke: '#111', 'stroke-width': '1' })
  expect(resource).toMatchObject({ refX: '5', refY: '3', markerWidth: '6', markerHeight: '6', markerUnits: 'userSpaceOnUse', orient: 'auto' })
  expect(carrier).toMatchObject({ x2: '60', y2: '40', 'marker-end': 'url(#served-ring)' })
  const ringRight = Number(carrier.x2) + Number(circle.cx) - Number(resource.refX) + Number(circle.r) + Number(circle['stroke-width']) / 2
  expect(ringRight).toBe(60.5)
  expect(Number(card.x) + Number(card['stroke-width']) / 2).toBe(60.125)
  expect(ringRight - (Number(card.x) + Number(card['stroke-width']) / 2)).toBe(0.375)
  expectRectangleMarkerContributes(rounded.svg)
  expect(rounded.receipt.layoutCertification?.status).toBe('unverified')
})

test('public same-emission rectangle cannot borrow a late inherited width after its unchanged write', async () => {
  const { rounded, prototypeRestored } = await publicSharpRectanglePair(60, 30, '0', 'late-inherited-width', true)
  const elements = rectangleEmissionElements(rounded.svg)
  const card = elements.find(element => element.attributes['data-id'] === 'served-card')!.attributes
  const circle = elements.find(element => element.name === 'circle')!.attributes
  const marker = elements.find(element => element.name === 'marker')!.attributes
  expect(card).toMatchObject({ x: '60', y: '20', width: '30', height: '40', fill: '#fff', stroke: '#888' })
  expect(card['stroke-width']).toBeUndefined()
  expect(circle).toMatchObject({ cx: '5', cy: '5', r: '4', fill: 'none', stroke: '#111', 'stroke-width': '1' })
  expect(marker).toMatchObject({ markerWidth: '10', markerHeight: '10', refX: '8', refY: '5', orient: 'auto', markerUnits: 'userSpaceOnUse' })
  expect(rounded.emissionTrace).toEqual(['body-write-begin', 'body-write-end', 'late-width-installed'])
  expect(prototypeRestored).toBe(true)
  // SVG's omitted stroke-width is1: innerfillx60.5. The actual circle is
  // centered at57,40 with outerradius4.5, reaching61.5: one whole unit
  // enters fill. A later prototype width4 would invent innerfillx62.
  const carrier = elements.find(element => element.attributes['data-id'] === 'served-edge')!.attributes
  expect(carrier).toMatchObject({ x1: '20', y1: '40', x2: '60', y2: '40', stroke: '#111', 'stroke-width': '1', 'marker-end': 'url(#served-ring)' })
  const ringRight = Number(carrier.x2) + Number(circle.cx) - Number(marker.refX) + Number(circle.r) + Number(circle['stroke-width']) / 2
  expect(ringRight).toBe(61.5)
  expect(ringRight - (Number(card.x) + 0.5)).toBe(1)
  expectRectangleMarkerContributes(rounded.svg)
  expect(rounded.receipt.layoutCertification?.status).toBe('unverified')
})

test('public same-emission rectangle leaves ordinary rounded non-marker proof eligible', async () => {
  const { rounded } = await publicSharpRectanglePair(60.00000000000001, 30, '0', 'rounded-unmarked')
  const elements = rectangleEmissionElements(rounded.svg)
  expect(elements.find(element => element.attributes['data-id'] === 'served-card')!.attributes).toMatchObject({ x: '60', y: '20', width: '30', height: '40', rx: '3', fill: '#fff', stroke: '#888', 'stroke-width': '1' })
  expect(elements.some(element => element.name === 'marker' || element.attributes['marker-end'] !== undefined)).toBe(false)
  expect(rounded.receipt.layoutCertification?.status).toBe('passed')
})

test('public fresh Scene same-emission rectangle retains actual circle authority', async () => {
  const { integer, rounded } = await publicSharpRectanglePair(60.00000000000001, 30, '1')
  expect(rounded.svg).toBe(integer.svg)
  const elements = rectangleEmissionElements(rounded.svg)
  const viewport = elements.find(element => element.name === 'svg')!.attributes
  expect(viewport).toMatchObject({ width: '277.108', height: '150.7' })
  expect(elements.find(element => element.name === 'marker')!.attributes).toMatchObject({ id: 'served-ring', markerWidth: '6', markerHeight: '6', refX: '5', refY: '3', orient: 'auto', markerUnits: 'userSpaceOnUse' })
  expect(elements.find(element => element.name === 'marker')!.attributes.viewBox).toBeUndefined()
  expect(elements.find(element => element.name === 'circle')!.attributes).toMatchObject({ cx: '3', cy: '3', r: '2', fill: 'none', stroke: '#111', 'stroke-width': '1' })
  expect(elements.find(element => element.attributes['data-id'] === 'served-edge')!.attributes).toMatchObject({ x1: '20', y1: '40', x2: '60', y2: '40', stroke: '#111', 'stroke-width': '1', 'marker-end': 'url(#served-ring)' })
  const body = elements.find(element => element.attributes['data-id'] === 'served-card')!.attributes
  expect(body).toMatchObject({ x: '60', y: '20', width: '30', height: '40', fill: '#fff', stroke: '#888', 'stroke-width': '1' })
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  // Complete ring: center(58,40), outer radius2.5, final bounds
  // [55.5,37.5,60.5,42.5], local bounds[.5,.5,5.5,5.5]. Right60.5
  // equals the filled body's inner edge60.5, so only its outline is touched.
  // North ink(58,38) clears both shaft y39.5..40.5 and body outer x59.5.
  expect(Number(body.x) + Number(body['stroke-width']) / 2).toBe(60.5)
  expect(Number(viewport.width)).toBeGreaterThan(60.5)
  expect(Number(viewport.height)).toBeGreaterThan(42.5)
  expectRectangleMarkerContributes(rounded.svg)
  expect(integer.receipt.layoutCertification?.status).toBe('passed')
  expect(rounded.receipt.layoutCertification?.status).toBe('passed')
})

const duplicateMarkerPaintProgram = String.raw`
import { getFamily, replaceFamilyForTest } from './src/agent/families.ts'
import { sceneLowering } from './src/scene/drawing.ts'
import { serializeMarkerResource } from './src/scene/marker-resources.ts'
import { renderMermaidSVGWithReceipt } from './src/index.ts'
const mode = process.env.AM_DUPLICATE_MARKER_MODE
const family = getFamily('flowchart')
const paint = mode === 'literal' ? '#111' : 'context-stroke'
const marker = { id: 'duplicate-resource', shape: 'diamond', units: 'userSpaceOnUse', orient: 'auto-start-reverse',
  size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 },
  geometry: { kind: 'polygon', points: [{ x: 7, y: 1 }, { x: 13, y: 6 }, { x: 7, y: 11 }, { x: 1, y: 6 }] },
  paint: { fill: paint, stroke: paint, strokeWidth: '1.5' } }
const producer = (factory, context) => {
  const { width, height } = context.positioned
  const carrier = (id, stroke) => factory.connector({ id, role: id === 'later' && mode === 'owned-overlay' ? 'chrome' : 'edge',
    owner: { id: id === 'later' && ['same-owner', 'owned-overlay'].includes(mode) ? 'earlier' : id, role: 'edge' },
    lineStyle: 'solid', endpoints: { from: 'shared-source', to: id }, geometry: { kind: 'line', x1: 70, y1: 30, x2: 20, y2: 30 },
    paint: { stroke, strokeWidth: '1' }, markers: { start: marker }, attributes: { className: 'duplicate-' + id } })
  return { family: 'flowchart', width, height, colors: context.colors, transparent: false, parts: [
    factory.documentOpen({ id: 'root', width, height, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">'),
    factory.definitions({ id: 'resources' }, '<defs>' + serializeMarkerResource(marker) + '</defs>'),
    carrier('earlier', '#111'), carrier('later', '#fff'), factory.documentClose(),
  ] }
}
// This synthetic producer actually emits a chrome connector in this arm.
// Declare that test-only capability while retaining the complete role ledger.
const scenePrimitiveEvidence = mode === 'owned-overlay' ? family.scenePrimitiveEvidence.map(cell =>
  cell.role === 'chrome' && cell.primitive === 'connector'
    ? { ...cell, applicability: 'applicable', realization: 'native', evidence: ['src/__tests__/paint-certification.test.ts'], diagnostic: undefined }
    : cell) : family.scenePrimitiveEvidence
const restore = replaceFamilyForTest('flowchart', { ...family, scenePrimitiveEvidence, lowerScene: sceneLowering(producer) })
try { console.log(JSON.stringify(renderMermaidSVGWithReceipt('flowchart LR\nA["Left<br/>upper<br/>lower"] --> B[Right]', { embedFontImport: false, security: 'strict', bg: '#fff' }))) }
finally { restore() }
`

test.each((['literal', 'distinct-owner', 'same-owner', 'owned-overlay'] as const).flatMap(mode =>
  (['native', 'scene'] as const).map(execution => ({ mode, execution })),
))('public duplicate marker paint retains $mode obligations through $execution', async ({ mode, execution }) => {
  const child = await runRectangleChild(process.execPath, ['--eval', duplicateMarkerPaintProgram], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: execution === 'native' ? '0' : '1', AM_DUPLICATE_MARKER_MODE: mode },
  })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
  const result = JSON.parse(child.stdout) as ReturnType<typeof renderMermaidSVGWithReceipt>
  const elements = rectangleEmissionElements(result.svg)
  const resources = elements.filter(element => element.name === 'marker')
  expect(resources).toHaveLength(1)
  expect(resources[0]!.attributes).toMatchObject({ id: 'duplicate-resource', markerWidth: '14', markerHeight: '12', viewBox: '0 0 14 12', refX: '13', refY: '6', orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' })
  const polygon = elements.find(element => element.name === 'polygon')!.attributes
  expect(polygon).toMatchObject({ fill: mode === 'literal' ? '#111' : 'context-stroke', stroke: mode === 'literal' ? '#111' : 'context-stroke', 'stroke-width': '1.5' })
  const vertices = polygon.points!.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)!.map(Number)
  expect(vertices).toEqual([7, 1, 13, 6, 7, 11, 1, 6])
  const carriers = elements.filter(element => ['duplicate-earlier', 'duplicate-later'].includes(element.attributes.class ?? ''))
  expect(carriers).toHaveLength(2)
  expect(carriers.map(element => element.attributes.class)).toEqual(['duplicate-earlier', 'duplicate-later'])
  expect(carriers.map(element => [element.attributes.x1, element.attributes.y1, element.attributes.x2, element.attributes.y2, element.attributes.stroke, element.attributes['stroke-width'], element.attributes['marker-start']])).toEqual([
    ['70', '30', '20', '30', '#111', '1', 'url(#duplicate-resource)'],
    ['70', '30', '20', '30', '#fff', '1', 'url(#duplicate-resource)'],
  ])
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  // Cardinal start + auto-start-reverse maps the diamond to (64,25),
  // (70,30),(64,35),(58,30). Point(64,27) is strict fill interior and
  // three units off the shaft: contextual paint there belongs to the marker.
  // Actual consumer support/erasure is separately observed; this test never
  // replaces context-stroke with a guessed color or infers ink from a P flag.
  expect(result.receipt.layoutCertification?.status).toBe(mode === 'literal' ? 'passed' : 'unverified')
  expect(result.receipt.layoutCertification?.outputDigest).toBe(renderedSvgDigest(result.svg))
})

const publicFractionalCircleProgram = String.raw`
import { renderMermaidSVGWithReceipt } from './src/index.ts'
const original = process.env.AM_FRACTIONAL_MARKER_SOURCE ?? 'flowchart LR\n    A --o B'
const mode = process.env.AM_FRACTIONAL_CIRCLE_MODE
const source = original + (mode === 'thin-border' ? '\nstyle B stroke-width:0.1px' : mode === 'wide-shaft' ? '\nlinkStyle 0 stroke:#000,stroke-width:10px' : '')
try { console.log(JSON.stringify({ source, result: renderMermaidSVGWithReceipt(source, { graphLayout: { backend: process.env.AM_FRACTIONAL_CIRCLE_BACKEND, fallback: 'none' }, embedFontImport: false, ...(process.env.AM_FRACTIONAL_CIRCLE_EXECUTION === 'strict' ? { layoutSafety: 'strict' } : {}) }) })) }
catch (error) { console.log(JSON.stringify({ source, failure: { name: error.name, code: error.code, message: error.message, certification: error.certification } })) }
`

test.each((['original', 'thin-border', 'wide-shaft'] as const).flatMap(mode =>
  (['agentic', 'elk'] as const).flatMap(backend =>
    (['native', 'scene', 'strict'] as const).map(execution => ({ mode, backend, execution })),
  ),
))('stock fractional circle $mode preserves complete emitted obligations under $backend/$execution', async ({ mode, backend, execution }) => {
  const child = await runRectangleChild(process.execPath, ['--eval', publicFractionalCircleProgram], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: execution === 'scene' ? '1' : '0', AM_FRACTIONAL_CIRCLE_MODE: mode, AM_FRACTIONAL_CIRCLE_BACKEND: backend, AM_FRACTIONAL_CIRCLE_EXECUTION: execution },
  })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
  const packet = JSON.parse(child.stdout) as { source: string; result?: ReturnType<typeof renderMermaidSVGWithReceipt>; failure?: { name: string; certification?: { status: string; issues: Array<{ id?: string }> } } }
  expect(packet.source).toBe('flowchart LR\n    A --o B' + (mode === 'thin-border' ? '\nstyle B stroke-width:0.1px' : mode === 'wide-shaft' ? '\nlinkStyle 0 stroke:#000,stroke-width:10px' : ''))
  if (packet.failure) {
    expect(mode).not.toBe('original')
    expect(packet.failure.name).toBe('PaintLayoutCertificationError')
    const status = packet.failure.certification?.status
    if (status === undefined) throw new Error('Expected a typed refusal with a certification status')
    if (execution === 'strict') expect(['failed', 'unverified']).toContain(status)
    else expect(status).toBe('failed')
    expect(packet.failure.certification?.issues.some(issue => issue.id === 'edge:A->B#0')).toBe(true)
    console.info('fractional-circle typed refusal; final SVG/preconditions unavailable', JSON.stringify({ mode, backend, execution, failure: packet.failure }))
    return
  }
  const result = packet.result!
  const elements = rectangleEmissionElements(result.svg)
  expect(elements.filter(element => element.attributes.class === 'node').map(element => element.attributes['data-id'])).toEqual(['A', 'B'])
  // Text spelling is checked from actual XML character data, independently of
  // the product's model/certificate. Namespace expansion does not change it.
  const text: string[] = []
  let inText = false, current = ''
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', tag => { if (tag.local === 'text') { inText = true; current = '' } })
  parser.on('text', value => { if (inText) current += value })
  parser.on('closetag', tag => { if (tag.local === 'text') { text.push(current); inText = false } })
  parser.write(result.svg).close()
  expect(text).toEqual(['A', 'B'])
  const edges = elements.filter(element => element.attributes['data-role'] === 'edge')
  expect(edges).toHaveLength(1)
  const edge = edges[0]!.attributes
  expect(edge).toMatchObject({ 'data-id': 'edge:A->B#0', 'data-from': 'A', 'data-to': 'B', 'data-direction': 'forward', 'data-marker-end': 'circle' })
  expect(edge['marker-start']).toBeUndefined()
  const reference = edge['marker-end']!, id = /^url\(#([^)]*)\)$/.exec(reference)![1]!
  const marker = elements.find(element => element.name === 'marker' && element.attributes.id === id)!.attributes
  const xml = new SaxesParser({ xmlns: true })
  let selected = false
  const resourceChildren: Array<{ name: string; attributes: Record<string, string> }> = []
  xml.on('opentag', tag => {
    if (tag.local === 'marker') selected = Object.values(tag.attributes).some(attribute => attribute.local === 'id' && attribute.value === id)
    else if (selected) resourceChildren.push({ name: tag.local, attributes: Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, value.value])) })
  })
  xml.on('closetag', tag => { if (tag.local === 'marker') selected = false })
  xml.write(result.svg).close()
  expect(resourceChildren).toHaveLength(1)
  expect(resourceChildren[0]!.name).toBe('circle')
  const circle = resourceChildren[0]!.attributes
  expect(circle).toMatchObject({ cx: '4', cy: '4', r: '3.25', fill: 'none', 'stroke-width': '1' })
  expect(marker).toMatchObject({ markerWidth: '8', markerHeight: '8', refX: '7.5', refY: '4', orient: 'auto' })
  expect(marker.viewBox).toBeUndefined()
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  const points = edge.points!.split(/\s+/).map(point => point.split(',').map(Number))
  expect(points).toHaveLength(2)
  expect(points[0]![1]).toBe(points[1]![1]!)
  expect(points[1]![0]!).toBeGreaterThan(points[0]![0]!)
  const body = elements.find(element => element.attributes['data-id'] === 'node-shape:B')!.attributes
  const firstBody = elements.find(element => element.attributes['data-id'] === 'node-shape:A')!.attributes
  const ownWidth = Number.parseFloat(edge['stroke-width']!), bodyWidth = Number.parseFloat(body['stroke-width']!)
  const scale = marker.markerUnits === 'userSpaceOnUse' ? 1 : ownWidth
  const radius = (Number(circle.r) + Number(circle['stroke-width']) / 2) * scale
  const cx = points[1]![0]! + (Number(circle.cx) - Number(marker.refX)) * scale
  const cy = points[1]![1]! + (Number(circle.cy) - Number(marker.refY)) * scale
  const right = cx + radius, inner = Number(body.x) + bodyWidth / 2
  expect(Number(circle.cx) - Number(circle.r) - Number(circle['stroke-width']) / 2).toBe(0.25)
  expect(Number(circle.cx) + Number(circle.r) + Number(circle['stroke-width']) / 2).toBe(7.75)
  const token = ` marker-end="${reference}"`
  expect(result.svg.split(token)).toHaveLength(2)
  const font = { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url)), fileURLToPath(new URL('../../assets/fonts/Inter-Medium.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' }
  const actual = new Resvg(result.svg, { font }).render().pixels
  const absent = new Resvg(result.svg.replace(token, ''), { font }).render().pixels
  const markerChanges = Buffer.compare(actual, absent) !== 0
  if (mode === 'original') {
    expect(edge.points).toBe('100,58.45 148,58.45')
    expect(ownWidth).toBe(1)
    expect(marker.markerUnits).toBeUndefined()
    expect(circle.stroke).toBe('#47474a')
    expect(body).toMatchObject({ x: '148', y: '40', width: '60', height: '36.9', rx: '0', ry: '0', fill: '#f9f9f9', stroke: '#949495', 'stroke-width': '0.75' })
    expect({ cx, cy, radius, right, inner }).toEqual({ cx: 144.5, cy: 58.45, radius: 3.75, right: 148.25, inner: 148.375 })
    expect(inner - right).toBe(0.125)
    expect(Number(firstBody.x) + Number(firstBody.width) + Number.parseFloat(firstBody['stroke-width']!) / 2).toBe(100.375)
    expect(cx - radius).toBeGreaterThan(100.375)
    expect(Number(circle.r) * scale).toBeGreaterThan(ownWidth / 2)
    const root = elements.find(element => element.name === 'svg')!.attributes
    expect(root.viewBox).toBe('0 0 248 116.9')
    expect(cx - radius).toBeGreaterThan(0); expect(cy - radius).toBeGreaterThan(0)
    expect(cx + radius).toBeLessThan(248); expect(cy + radius).toBeLessThan(116.9)
    expect(markerChanges).toBe(true)
    expect(result.receipt.layoutCertification?.status).toBe('passed')
  } else if (mode === 'thin-border') {
    expect(bodyWidth).toBe(0.1)
    const intrusion = right - inner
    if (intrusion > 0) {
      expect(markerChanges).toBe(true)
      expect(result.receipt.layoutCertification?.status).not.toBe('passed')
    } else console.info('fractional-circle adverse precondition unavailable', JSON.stringify({ mode, backend, execution, right, inner, intrusion, status: result.receipt.layoutCertification?.status }))
  } else {
    expect(ownWidth).toBe(10)
    const black = (value: string | undefined): boolean => value === 'black' || /^#(?:000|000000)$/i.test(value ?? '')
    const opaque = (value: string | undefined): boolean => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value ?? '')
    const anchor = points[1]![0]!
    const finiteShaftCoversRing = cx - radius >= points[0]![0]! && cy - radius >= points[1]![1]! - ownWidth / 2 && cy + radius <= points[1]![1]! + ownWidth / 2
    const laterBorderCoversTip = Number(body.x) === anchor && right <= inner && Number(body.y) <= cy - radius && Number(body.y) + Number(body.height) >= cy + radius
      && Number(body.rx ?? 0) === 0 && Number(body.ry ?? 0) === 0 && opaque(body.fill) && opaque(body.stroke)
    const absorbed = marker.markerUnits === 'userSpaceOnUse' && radius <= ownWidth / 2 && black(edge.stroke) && black(circle.stroke)
      && (edge['stroke-linecap'] === undefined || edge['stroke-linecap'] === 'butt') && finiteShaftCoversRing && laterBorderCoversTip
    if (absorbed) {
      expect(markerChanges).toBe(false)
      expect(result.receipt.layoutCertification?.status).not.toBe('passed')
    } else console.info('fractional-circle adverse precondition unavailable', JSON.stringify({ mode, backend, execution, units: marker.markerUnits, ownWidth, radius, edgeColor: edge.stroke, markerColor: circle.stroke, status: result.receipt.layoutCertification?.status }))
  }
  expect(result.receipt.layoutCertification?.outputDigest).toBe(renderedSvgDigest(result.svg))
})

test.each((['cross', 'mixed'] as const).flatMap(kind =>
  (['agentic', 'elk'] as const).flatMap(backend =>
    (['native', 'scene', 'strict'] as const).map(execution => ({ kind, backend, execution })),
  ),
))('stock endpoint $kind preserves complete authored marker ink under $backend/$execution', async ({ kind, backend, execution }) => {
  const source = kind === 'cross' ? 'flowchart LR\n    A --x B' : 'flowchart LR\n    A o--o B\n    B <--> C\n    C x--x D'
  const child = await runRectangleChild(process.execPath, ['--eval', publicFractionalCircleProgram], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: execution === 'scene' ? '1' : '0', AM_FRACTIONAL_CIRCLE_MODE: 'original', AM_FRACTIONAL_CIRCLE_BACKEND: backend, AM_FRACTIONAL_CIRCLE_EXECUTION: execution, AM_FRACTIONAL_MARKER_SOURCE: source },
  })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
  const packet = JSON.parse(child.stdout) as { source: string; result?: ReturnType<typeof renderMermaidSVGWithReceipt>; failure?: { name: string; message: string } }
  expect(packet.source).toBe(source)
  if (packet.failure) console.info('stock endpoint original refusal; final SVG/ink unavailable', JSON.stringify({ kind, backend, execution, failure: packet.failure }))
  expect(packet.failure).toBeUndefined()
  const result = packet.result!
  const elements = rectangleEmissionElements(result.svg)
  const labels = kind === 'cross' ? ['A', 'B'] : ['A', 'B', 'C', 'D']
  expect(elements.filter(element => element.attributes.class === 'node').map(element => element.attributes['data-id'])).toEqual(labels)
  expect(elements.find(element => element.name === 'svg')!.attributes.viewBox).toBe(kind === 'cross' ? '0 0 248 116.9' : '0 0 464 116.9')
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  const resources = new Map<string, { attributes: Record<string, string>; children: Array<{ name: string; attributes: Record<string, string> }> }>()
  const texts: string[] = []
  let resource: ReturnType<typeof resources.get>, inText = false, text = ''
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', tag => {
    const attributes = Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, value.value]))
    if (tag.local === 'marker') { resource = { attributes, children: [] }; resources.set(attributes.id!, resource) }
    else if (resource) resource.children.push({ name: tag.local, attributes })
    if (tag.local === 'text') { inText = true; text = '' }
  })
  parser.on('text', value => { if (inText) text += value })
  parser.on('closetag', tag => { if (tag.local === 'marker') resource = undefined; if (tag.local === 'text') { texts.push(text); inText = false } })
  parser.write(result.svg).close()
  expect(texts).toEqual(labels)
  const edges = elements.filter(element => element.attributes['data-role'] === 'edge')
  const expected = kind === 'cross' ? [['A', 'B', undefined, 'cross']] : [['A', 'B', 'circle', 'circle'], ['B', 'C', 'arrow', 'arrow'], ['C', 'D', 'cross', 'cross']]
  expect(edges.map(element => [element.attributes['data-from'], element.attributes['data-to'], element.attributes['data-marker-start'], element.attributes['data-marker-end']])).toEqual(expected)
  const tags = [...result.svg.matchAll(/<(?:line|polyline|path)\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(' data-role="edge"'))
  expect(tags).toHaveLength(edges.length)
  const font = { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url)), fileURLToPath(new URL('../../assets/fonts/Inter-Medium.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' }
  const rendered = new Resvg(result.svg, { font }).render(), pixels = rendered.pixels
  let occurrences = 0
  for (const [index, element] of edges.entries()) {
    const edge = element.attributes, start = 100 + index * 108, end = 148 + index * 108
    expect(edge).toMatchObject({ points: `${start},58.45 ${end},58.45`, stroke: '#939395', 'stroke-width': '1', 'data-direction': kind === 'cross' ? 'forward' : 'bidirectional' })
    for (const position of ['start', 'end'] as const) {
      const reference = edge[`marker-${position}`]
      if (reference === undefined) continue
      occurrences++
      const id = /^url\(#([^)]*)\)$/.exec(reference)![1]!, marker = resources.get(id)!
      const markerKind = edge[`data-marker-${position}`], isStart = position === 'start'
      expect(marker.attributes).toMatchObject({ markerWidth: '8', markerHeight: markerKind === 'arrow' ? '5' : '8', refY: markerKind === 'arrow' ? '2.5' : '4', orient: 'auto' })
      expect(marker.attributes.markerUnits).toBeUndefined()
      expect(marker.attributes.viewBox).toBeUndefined()
      if (markerKind === 'cross') {
        expect(marker.attributes.refX).toBe(isStart ? '0.625' : '7.375')
        expect(marker.children).toEqual([
          { name: 'line', attributes: { x1: '1.25', y1: '1.25', x2: '6.75', y2: '6.75', stroke: '#47474a', 'stroke-width': '1.25', 'stroke-linecap': 'round' } },
          { name: 'line', attributes: { x1: '1.25', y1: '6.75', x2: '6.75', y2: '1.25', stroke: '#47474a', 'stroke-width': '1.25', 'stroke-linecap': 'round' } },
        ])
        // The complete two round-capped diagonals fit [.625,7.375]^2.
        // End ref7.375 puts their right edge at the target anchor; start
        // ref.625 puts their left edge at the source anchor. Filled bodies
        // begin .375 further inward, never hiding any cross interior.
        const anchor = isStart ? start : end, ref = Number(marker.attributes.refX)
        expect(isStart ? anchor + 0.625 - ref : anchor + 7.375 - ref).toBe(anchor)
      } else if (markerKind === 'circle') {
        expect(marker.attributes.refX).toBe(isStart ? '0.5' : '7.5')
        expect(marker.children).toEqual([{ name: 'circle', attributes: { cx: '4', cy: '4', r: '3.25', fill: 'none', stroke: '#47474a', 'stroke-width': '1' } }])
      } else {
        expect(marker.attributes.refX).toBe(isStart ? '0' : '8')
        expect(marker.children).toEqual([{ name: 'polygon', attributes: { points: isStart ? '8 0, 0 2.5, 8 5' : '0 0, 8 2.5, 0 5', fill: '#47474a', stroke: '#47474a', 'stroke-width': '0.75', 'stroke-linejoin': 'round' } }])
      }
      const token = ` marker-${position}="${reference}"`, tag = tags[index]!
      expect(tag.split(token)).toHaveLength(2)
      const absent = new Resvg(result.svg.replace(tag, tag.replace(token, '')), { font }).render().pixels
      let offSupport = 0
      for (let y = 0; y < rendered.height; y++) if (Math.abs(y + 0.5 - 58.45) > 1.25) for (let x = 0; x < rendered.width; x++) {
        const offset = (y * rendered.width + x) * 4
        if (!pixels.subarray(offset, offset + 4).equals(absent.subarray(offset, offset + 4))) offSupport++
      }
      expect(offSupport).toBeGreaterThan(0)
    }
  }
  expect(occurrences).toBe(kind === 'cross' ? 1 : 6)
  for (const [index, label] of labels.entries()) expect(elements.find(element => element.attributes['data-id'] === `node-shape:${label}`)!.attributes).toMatchObject({ x: String(40 + index * 108), y: '40', width: '60', height: '36.9', rx: '0', ry: '0', fill: '#f9f9f9', stroke: '#949495', 'stroke-width': '0.75' })
  expect(result.receipt.layoutCertification?.outputDigest).toBe(renderedSvgDigest(result.svg))
  expect(result.receipt.layoutCertification?.status).toBe('passed')
})

test.each((['curves', 'cylinder15', 'cylinder9'] as const).flatMap(kind =>
  (['agentic', 'elk'] as const).flatMap(backend =>
    (['native', 'scene', 'strict'] as const).map(execution => ({ kind, backend, execution })),
  ),
))('stock curve and body $kind preserves complete authored final ink under $backend/$execution', async ({ kind, backend, execution }) => {
  const source = kind === 'curves' ? 'flowchart LR\n    A e1@==> B\n    A e2@--> C\n    e1@{ curve: linear }\n    e2@{ curve: natural }'
    : readFileSync(new URL(kind === 'cylinder15' ? '../../eval/layout-compare/fixtures/cyclic-labelled-15.mmd' : '../../eval/layout-compare/fixtures/cyclic-labelled-9-chains.mmd', import.meta.url), 'utf8')
  const child = await runRectangleChild(process.execPath, ['--eval', publicFractionalCircleProgram], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: execution === 'scene' ? '1' : '0', AM_FRACTIONAL_CIRCLE_MODE: 'original', AM_FRACTIONAL_CIRCLE_BACKEND: backend, AM_FRACTIONAL_CIRCLE_EXECUTION: execution, AM_FRACTIONAL_MARKER_SOURCE: source },
  })
  expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
  const packet = JSON.parse(child.stdout) as { source: string; result?: ReturnType<typeof renderMermaidSVGWithReceipt>; failure?: { name: string; message: string } }
  expect(packet.source).toBe(source)
  if (packet.failure) console.info('stock curve/body original refusal; final SVG/ink unavailable', JSON.stringify({ kind, backend, execution, failure: packet.failure }))
  expect(packet.failure).toBeUndefined()
  const result = packet.result!, elements = rectangleEmissionElements(result.svg)
  type Part = { name: string; attributes: Record<string, string> }
  const nodes = new Map<string, { attributes: Record<string, string>; paints: Part[]; depth: number }>()
  const resources = new Map<string, { attributes: Record<string, string>; children: Part[] }>()
  const texts: string[] = []
  let node: ReturnType<typeof nodes.get>, resource: ReturnType<typeof resources.get>, depth = 0, inText = false, text = ''
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', tag => {
    depth++
    const attributes = Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, value.value]))
    if (tag.local === 'g' && attributes.class === 'node') { node = { attributes, paints: [], depth }; nodes.set(attributes['data-id']!, node) }
    else if (node && ['rect', 'line', 'ellipse', 'circle', 'polygon', 'polyline', 'path'].includes(tag.local)) node.paints.push({ name: tag.local, attributes })
    if (tag.local === 'marker') { resource = { attributes, children: [] }; resources.set(attributes.id!, resource) }
    else if (resource) resource.children.push({ name: tag.local, attributes })
    if (tag.local === 'text') { inText = true; text = '' }
  })
  parser.on('text', value => { if (inText) text += value })
  parser.on('closetag', tag => {
    if (node?.depth === depth) node = undefined
    if (tag.local === 'marker') resource = undefined
    if (tag.local === 'text') { texts.push(text); inText = false }
    depth--
  })
  parser.write(result.svg).close()
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  const edges = elements.filter(element => element.attributes['data-role'] === 'edge')
  const tags = [...result.svg.matchAll(/<(?:line|polyline|path)\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(' data-role="edge"'))
  expect(tags).toHaveLength(edges.length)
  const arrow = resources.get('arrowhead')!
  expect(arrow.attributes).toMatchObject({ markerWidth: '8', markerHeight: '5', refX: '8', refY: '2.5', orient: 'auto' })
  expect(arrow.attributes.markerUnits).toBeUndefined()
  expect(arrow.attributes.viewBox).toBeUndefined()
  expect(arrow.children).toEqual([{ name: 'polygon', attributes: { points: '0 0, 8 2.5, 0 5', fill: '#47474a', stroke: '#47474a', 'stroke-width': '0.75', 'stroke-linejoin': 'round' } }])
  const poses = new Map<string, { x: number; y: number; dx: number; dy: number; target: string; index: number }>()
  let selected: string[]
  if (kind === 'curves') {
    expect([...nodes.keys()].sort()).toEqual(['A', 'B', 'C'])
    expect(texts).toEqual(['A', 'B', 'C'])
    expect(edges.map(element => [element.attributes['data-id'], element.attributes['data-from'], element.attributes['data-to'], element.attributes['data-curve'], element.attributes['stroke-width']])).toEqual([['e1', 'A', 'B', 'linear', '2'], ['e2', 'A', 'C', 'natural', '1']])
    expect(elements.find(element => element.name === 'svg')!.attributes.viewBox).toBe('0 0 248 181.8')
    const sourceBody = nodes.get('A')!.paints[0]!.attributes
    expect(sourceBody).toMatchObject({ x: '40', width: '60', height: '36.9', fill: '#f9f9f9', stroke: '#949495', 'stroke-width': '0.75' })
    for (const [index, element] of edges.entries()) {
      const target = index === 0 ? 'B' : 'C', targetBody = nodes.get(target)!.paints[0]!.attributes
      // Authored A fans out in source order from symmetric right-side ports;
      // each arrow enters its own target's left-side centre. Translation of
      // every node and path preserves these contacts, unlike a misplaced tip.
      // This fixture's served node operands are exact hundredths; integer
      // arithmetic keeps its port equality independent of float tails.
      for (const value of [sourceBody.y, sourceBody.height, targetBody.y, targetBody.height]) expect(Number.isSafeInteger(Number(value) * 100)).toBe(true)
      const startY = (Number(sourceBody.y) * 100 + Number(sourceBody.height) * 100 * (index === 0 ? 1 : 2) / 3) / 100
      const endY = (Number(targetBody.y) * 100 + Number(targetBody.height) * 50) / 100
      expect(element.name).toBe('path')
      expect(element.attributes.d!.match(/[A-Za-z]/g)).toEqual(['M', 'C', 'C', 'C'])
      expect(element.attributes.d!.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)!.map(Number)).toEqual([100, startY, 112, startY, 112, startY, 124, startY, 124, startY, 124, endY, 124, endY, 136, endY, 136, endY, 148, endY])
      expect(targetBody).toMatchObject({ x: '148', width: '60', height: '36.9', fill: '#f9f9f9', stroke: '#949495', 'stroke-width': '0.75' })
      // Written last two controls(136,y) and tip(148,y) give an eastward
      // actual terminal derivative. The default-unit clipped marker spans
      // x[132,148],y±5 for thick e1, and x[140,148],y±2.5 for e2.
      poses.set(element.attributes['data-id']!, { x: 148, y: endY, dx: 1, dy: 0, target, index })
    }
    selected = ['e1', 'e2']
  } else {
    // This deliberately small author grammar reads the committed fixture,
    // not our parser/model: preserve each declaration and duplicate relation.
    const authoredNodes = source.split('\n').flatMap(line => {
      const match = /^(n\d+)([\[({].*)$/.exec(line)
      if (!match) return []
      const spelling = match[2]!, label = /Node \d+-\d+/.exec(spelling)![0]
      const shape = spelling.startsWith('[(') ? 'cylinder' : spelling.startsWith('[[') ? 'subroutine' : spelling.startsWith('((') ? 'circle' : spelling.startsWith('(') ? 'rounded' : spelling.startsWith('{') ? 'diamond' : 'rectangle'
      return [{ id: match[1]!, label, shape }]
    })
    const counts = new Map<string, number>()
    const authoredEdges = source.split('\n').flatMap(line => {
      const match = /^(n\d+) -->(?:\|([^|]+)\|)? (n\d+)$/.exec(line)
      if (!match) return []
      const from = match[1]!, to = match[3]!, pair = `${from}->${to}`, occurrence = counts.get(pair) ?? 0
      counts.set(pair, occurrence + 1)
      return [[`edge:${pair}#${occurrence}`, from, to, match[2]]]
    })
    expect(authoredNodes).toHaveLength(kind === 'cylinder15' ? 15 : 9)
    expect(authoredEdges).toHaveLength(kind === 'cylinder15' ? 31 : 23)
    expect([...nodes.keys()].sort()).toEqual(authoredNodes.map(item => item.id).sort())
    for (const item of authoredNodes) {
      expect(nodes.get(item.id)!.attributes).toMatchObject({ 'data-label': item.label, 'data-shape': item.shape })
      expect(texts.filter(text => text === item.label)).toHaveLength(1)
    }
    expect(edges.map(element => [element.attributes['data-id'], element.attributes['data-from'], element.attributes['data-to'], element.attributes['data-label']])).toEqual(authoredEdges)
    for (const edge of authoredEdges) if (edge[3] !== undefined) expect(texts.filter(text => text === edge[3])).toHaveLength(1)
    const cylinders = authoredNodes.filter(item => item.shape === 'cylinder')
    expect(cylinders).toHaveLength(2)
    for (const item of cylinders) {
      const pieces = nodes.get(item.id)!.paints
      expect(pieces.map(piece => piece.name)).toEqual(['rect', 'line', 'line', 'ellipse', 'ellipse'])
      const [rect, left, right, bottom, top] = pieces.map(piece => piece.attributes)
      expect(rect!).toMatchObject({ height: '36.9', fill: '#f9f9f9', stroke: 'none' })
      for (const side of [left!, right!]) { expect(side).toMatchObject({ stroke: '#949495', 'stroke-width': '0.75' }); expect(side.x1).toBe(side.x2); expect(side.y1).toBe(rect!.y) }
      expect(left!.x1).toBe(rect!.x)
      expect(left!.y2).toBe(right!.y2)
      expect(Number(right!.x1)).toBeGreaterThan(Number(left!.x1))
      for (const cap of [bottom!, top!]) { expect(cap).toMatchObject({ ry: '7', fill: '#f9f9f9', stroke: '#949495', 'stroke-width': '0.75' }); expect(Number(cap.rx)).toBeGreaterThan(0) }
      expect(bottom!.cx).toBe(top!.cx); expect(bottom!.rx).toBe(top!.rx)
      expect(top!.cy).toBe(rect!.y); expect(bottom!.cy).toBe(left!.y2)
      // Do not replace the actual five independently rounded pieces with an
      // idealized y+height cylinder. Check contact patches against their union.
      const filled = (x: number, y: number): boolean => pieces.some(piece => {
        const a = piece.attributes
        if (piece.name === 'rect') return x > Number(a.x) && x < Number(a.x) + Number(a.width) && y > Number(a.y) && y < Number(a.y) + Number(a.height)
        return piece.name === 'ellipse' && ((x - Number(a.cx)) / Number(a.rx)) ** 2 + ((y - Number(a.cy)) / Number(a.ry)) ** 2 < 1
      })
      for (const [index, element] of edges.entries()) if (element.attributes['data-to'] === item.id) {
        expect(element.attributes.points).toBeDefined()
        const points = element.attributes.points!.split(/\s+/).map(point => point.split(',').map(Number)), tip = points.at(-1)!
        const previous = points.slice(0, -1).reverse().find(point => point[0] !== tip[0] || point[1] !== tip[1])!
        const dx = Math.sign(tip[0]! - previous[0]!), dy = Math.sign(tip[1]! - previous[1]!)
        expect(Math.abs(dx) + Math.abs(dy)).toBe(1)
        // Local triangle points(4,1.5)/(4,3.5) are strict arrow-fill
        // patches, off a width1 shaft. Neither may enter any actual fill piece.
        for (const sign of [-1, 1]) expect(filled(tip[0]! - 4 * dx - sign * dy, tip[1]! - 4 * dy + sign * dx)).toBe(false)
        poses.set(element.attributes['data-id']!, { x: tip[0]!, y: tip[1]!, dx, dy, target: item.id, index })
      }
    }
    expect(poses.size).toBe(9)
    selected = kind === 'cylinder15' ? ['edge:n6->n4#0', 'edge:n8->n4#0', 'edge:n9->n10#0'] : ['edge:n3->n6#0', 'edge:n4->n0#0', 'edge:n8->n0#0']
  }
  for (const edge of edges) expect(edge.attributes).toMatchObject({ 'data-marker-end': 'arrow', 'marker-end': 'url(#arrowhead)', 'data-direction': 'forward', ...(kind === 'curves' ? {} : { 'stroke-width': '1' }) })
  const font = { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url)), fileURLToPath(new URL('../../assets/fonts/Inter-Medium.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' }
  const rendered = new Resvg(result.svg, { font }).render(), pixels = rendered.pixels
  const observed = new Set<string>()
  for (const id of selected) {
    const pose = poses.get(id)!, key = JSON.stringify([pose.x, pose.y, pose.dx, pose.dy, pose.target])
    if (observed.has(key)) continue
    observed.add(key)
    let without = result.svg
    // Coincident authored occurrences share one visible pose; remove all
    // identical references together, retaining all source relationships above.
    for (const other of poses.values()) if (other.x === pose.x && other.y === pose.y && other.dx === pose.dx && other.dy === pose.dy && other.target === pose.target) {
      const tag = tags[other.index]!, token = ' marker-end="url(#arrowhead)"'
      expect(tag.split(token)).toHaveLength(2)
      without = without.replace(tag, tag.replace(token, ''))
    }
    const absent = new Resvg(without, { font }).render().pixels
    let offSupport = 0
    const halfShaft = Number(edges[pose.index]!.attributes['stroke-width']) / 2
    for (let y = 0; y < rendered.height; y++) for (let x = 0; x < rendered.width; x++) if (Math.abs((x + 0.5 - pose.x) * -pose.dy + (y + 0.5 - pose.y) * pose.dx) > halfShaft + 0.75) {
      const offset = (y * rendered.width + x) * 4
      if (!pixels.subarray(offset, offset + 4).equals(absent.subarray(offset, offset + 4))) offSupport++
    }
    expect(offSupport).toBeGreaterThan(0)
  }
  expect(observed.size).toBeGreaterThanOrEqual(2)
  expect(result.receipt.layoutCertification?.outputDigest).toBe(renderedSvgDigest(result.svg))
  expect(result.receipt.layoutCertification?.status).toBe('passed')
})

test.each((['covered', 'dashed', 'unknown-width', 'scaled', 'mutated'] as const).flatMap(mode => (['native', 'scene'] as const).map(execution => ({ mode, execution }))))('cross marker $mode retains conservative actual-write authority through $execution', ({ mode, execution }) => {
  const colors = { bg: '#fff', fg: '#111' }
  const context = { positioned: { width: 248, height: 116.9 }, colors, resolved: { renderOptions: {} } }
  const marker: MarkerDescriptor = { id: 'controlled-cross', shape: 'cross', orient: 'auto', size: { width: 8, height: 8 }, ref: { x: 7.375, y: 4 }, ...(mode === 'scaled' ? { units: 'strokeWidth' as const } : {}),
    geometry: { kind: 'compound', children: [{ kind: 'line', x1: 1.25, y1: 1.25, x2: 6.75, y2: 6.75 }, { kind: 'line', x1: 1.25, y1: 6.75, x2: 6.75, y2: 1.25 }] },
    paint: { fill: 'none', stroke: '#111', strokeWidth: mode === 'unknown-width' ? 'var(--host)' : '1.25', strokeLinecap: 'round', ...(mode === 'dashed' ? { strokeDasharray: '1 100' } : {}) },
  }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 248, height: 116.9, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="248" height="116.9" viewBox="0 0 248 116.9">')
    const definitions = factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(marker)}</defs>`)
    if (mode === 'mutated') marker.paint!.stroke = 'none'
    return { family: 'flowchart', width: 248, height: 116.9, transparent: false, colors, parts: [open, definitions,
      factory.connector({ id: 'controlled-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'polyline', points: [{ x: 100, y: 58.45 }, { x: 148, y: 58.45 }] }, paint: { stroke: '#111', strokeWidth: mode === 'scaled' ? '2' : '1' }, endpoints: { from: 'A', to: 'B' }, markers: { end: marker } }),
      factory.shape({ id: 'A', role: 'node', geometry: { kind: 'rect', x: 40, y: 40, width: 60, height: 36.9, rx: 0, ry: 0 }, paint: { fill: '#fff', stroke: '#888', strokeWidth: '0.75' } }),
      factory.shape({ id: 'B', role: 'node', geometry: { kind: 'rect', x: 148, y: 40, width: 60, height: 36.9, rx: 0, ry: 0 }, paint: { fill: '#fff', stroke: '#888', strokeWidth: '0.75' } }),
      ...(mode === 'covered' ? [factory.shape({ id: 'cover', role: 'chrome', geometry: { kind: 'rect', x: 138, y: 52, width: 13, height: 13 }, paint: { fill: '#fff', stroke: '#fff', strokeWidth: '1' } })] : []),
      factory.documentClose(),
    ] }
  }
  const drawing = drawPaintControl(producer, context, execution, { fractionalCircleOutput: true })
  const elements = rectangleEmissionElements(drawing.svg)
  expect(elements.find(element => element.name === 'svg')!.attributes.viewBox).toBe('0 0 248 116.9')
  const resource = elements.find(element => element.name === 'marker')!.attributes
  expect(resource).toMatchObject({ id: 'controlled-cross', markerWidth: '8', markerHeight: '8', refX: '7.375', refY: '4', orient: 'auto' })
  expect(resource.markerUnits).toBe(mode === 'scaled' ? 'strokeWidth' : undefined)
  expect(resource.viewBox).toBeUndefined()
  const lines = elements.filter(element => element.name === 'line')
  expect(lines.map(element => [element.attributes.x1, element.attributes.y1, element.attributes.x2, element.attributes.y2])).toEqual([['1.25', '1.25', '6.75', '6.75'], ['1.25', '6.75', '6.75', '1.25']])
  for (const line of lines) expect(line.attributes).toMatchObject({ stroke: '#111', 'stroke-width': mode === 'unknown-width' ? 'var(--host)' : '1.25', 'stroke-linecap': 'round', ...(mode === 'dashed' ? { 'stroke-dasharray': '1 100' } : {}) })
  expect(elements.find(element => element.attributes['data-id'] === 'controlled-edge')!.attributes).toMatchObject({ points: '100,58.45 148,58.45', 'data-from': 'A', 'data-to': 'B', 'stroke-width': mode === 'scaled' ? '2' : '1', 'marker-end': 'url(#controlled-cross)' })
  expect(elements.find(element => element.attributes['data-id'] === 'B')!.attributes).toMatchObject({ x: '148', y: '40', width: '60', height: '36.9', fill: '#fff', stroke: '#888', 'stroke-width': '0.75' })
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  const token = ' marker-end="url(#controlled-cross)"'
  expect(drawing.svg.split(token)).toHaveLength(2)
  const rendered = new Resvg(drawing.svg).render(), pixels = rendered.pixels
  const absent = new Resvg(drawing.svg.replace(token, '')).render().pixels
  const changed = Buffer.compare(pixels, absent) !== 0
  if (mode === 'covered') {
    expect(elements.find(element => element.name === 'rect' && element.attributes.x === '138')!.attributes).toMatchObject({ x: '138', y: '52', width: '13', height: '13', fill: '#fff' })
    // Complete cross bounds[141.25,148]×[55.075,61.825] lie under
    // the actual later opaque cover[138,151]×[52,65].
    expect(changed).toBe(false)
  } else if (mode === 'unknown-width') console.info('cross marker unresolved width retains consumer observation', JSON.stringify({ execution, markerChangesImage: changed }))
  else {
    expect(changed).toBe(true)
    let offSupport = 0
    const halfShaft = mode === 'scaled' ? 1 : 0.5
    for (let y = 0; y < rendered.height; y++) if (Math.abs(y + 0.5 - 58.45) > halfShaft + 0.75) for (let x = 0; x < rendered.width; x++) {
      const offset = (y * rendered.width + x) * 4
      if (!pixels.subarray(offset, offset + 4).equals(absent.subarray(offset, offset + 4))) offSupport++
    }
    expect(offSupport).toBeGreaterThan(0)
  }
  if (mode === 'mutated') expect(marker.paint!.stroke).toBe('none')
  expect(drawing.proof.status).not.toBe('passed')
})

function drawCylinderWriteControl(mode: 'clear' | 'inward' | 'extra-piece' | 'getter' | 'inherited' | 'fallback-fill' | 'fallback-stroke' | 'background-stroke' | 'foreground-stroke' | 'background-stroke4' | 'foreground-stroke4' | 'background-fill-foreground-stroke4' | 'background-fill-background-stroke4' | 'hollow-circle' | 'inherited-prepared-body', execution: 'native' | 'scene', bodyKind: 'cylinder' | 'rectangle' | 'borderless-rectangle' = 'cylinder', rootMarkup?: string, nonPaintContent?: string) {
  const colors = { bg: '#fff', fg: '#111' }, reads: string[] = []
  const wideStroke = mode === 'background-stroke' || mode === 'foreground-stroke' || mode === 'background-stroke4' || mode === 'foreground-stroke4' || mode === 'background-fill-foreground-stroke4' || mode === 'background-fill-background-stroke4' || mode === 'hollow-circle'
  const width = wideStroke ? 800 : 160, height = wideStroke ? 800 : 100, offset = wideStroke ? 240 : 0
  const context = { positioned: { width, height }, colors, resolved: { renderOptions: {} } }
  const marker: MarkerDescriptor = mode === 'hollow-circle'
    ? { id: 'cylinder-tip', shape: 'circle', size: { width: 8, height: 5 }, ref: { x: 8, y: 2.5 }, orient: 'auto', geometry: { kind: 'circle', cx: 4, cy: 2.5, r: 2 }, paint: { fill: '#fff', stroke: '#111', strokeWidth: '0.75' } }
    : tipAnchoredArrow('cylinder-tip', { width: 8, height: 5 }, 'end', wideStroke
    ? { fill: mode === 'background-fill-foreground-stroke4' || mode === 'background-fill-background-stroke4' ? '#fff' : '#111', stroke: mode === 'background-stroke' || mode === 'background-stroke4' || mode === 'background-fill-background-stroke4' ? '#fff' : '#111', strokeWidth: mode.endsWith('stroke4') ? '4' : '64', strokeLinejoin: 'round', paintOrder: 'normal' }
    : { fill: '#111', stroke: 'none' })
  if (wideStroke) marker.overflow = 'hidden'
  const childPaints: MarkPaint[] = [{ fill: '#fff', stroke: 'none' }, { stroke: '#111', strokeWidth: '1' }, { stroke: '#111', strokeWidth: '1' }, { fill: '#fff', stroke: '#111', strokeWidth: '1' }, { fill: '#fff', stroke: '#111', strokeWidth: '1' }]
  // A visible default rendering cannot establish an unbound host variable's
  // opacity; contact authority must preserve that unresolved CSS distinction.
  if (mode === 'fallback-fill') childPaints[0]!.fill = 'var(--host,#fff)'
  if (mode === 'fallback-stroke') childPaints[1]!.stroke = 'var(--host,#111)'
  if (mode === 'getter') Object.defineProperty(childPaints[1], 'strokeWidth', { enumerable: true, get() { reads.push('side-width'); return '1' } })
  if (mode === 'inherited') { delete childPaints[1]!.strokeWidth; Object.setPrototypeOf(childPaints[1], { strokeWidth: '1' }) }
  const children: Geometry[] = [{ kind: 'rect', x: 60 + offset, y: 20 + offset, width: 60, height: 40 }, { kind: 'line', x1: 60 + offset, y1: 20 + offset, x2: 60 + offset, y2: 60 + offset }, { kind: 'line', x1: 120 + offset, y1: 20 + offset, x2: 120 + offset, y2: 60 + offset }, { kind: 'ellipse', cx: 90 + offset, cy: 60 + offset, rx: 30, ry: 7 }, { kind: 'ellipse', cx: 90 + offset, cy: 20 + offset, rx: 30, ry: 7 }]
  if (mode === 'extra-piece') { children.push({ kind: 'rect', x: 51, y: 36, width: 10, height: 8 }); childPaints.push({ fill: '#fff', stroke: 'none' }) }
  const tip = mode === 'inherited-prepared-body' ? 70 : mode === 'inward' ? 61 : 60
  const producer: DrawingProducer = factory => ({ family: 'flowchart', width, height, transparent: false, colors, parts: [
    factory.documentOpen({ id: 'root', width, height, colors, transparent: false, font: 'Inter', hasMonoFont: false }, rootMarkup ?? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`),
    factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector({ id: 'cylinder-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20 + offset, y1: 40 + offset, x2: tip + offset, y2: 40 + offset }, paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'outside', to: 'body' }, markers: { end: marker } }),
    factory.shape({ id: 'body', role: 'node', geometry: bodyKind !== 'cylinder' ? children[0]! : { kind: 'compound', children }, paint: { fill: '#fff', stroke: bodyKind === 'borderless-rectangle' ? 'none' : '#111', strokeWidth: '1' }, ...(bodyKind === 'cylinder' ? { childPaints } : {}) }),
    ...(nonPaintContent === undefined ? [] : [factory.documentContent({ id: 'metadata-cover', role: 'chrome', nonPaint: 'accessibility' }, nonPaintContent)]),
    factory.documentClose(),
  ] })
  return { ...drawPaintControl(producer, context, execution, { fractionalCircleOutput: true }), reads }
}

function expectCylinderWriteInk(drawing: ReturnType<typeof drawCylinderWriteControl>, mode: 'clear' | 'inward' | 'extra-piece' | 'getter' | 'inherited' | 'fallback-fill' | 'fallback-stroke' | 'background-stroke' | 'foreground-stroke' | 'background-stroke4' | 'foreground-stroke4' | 'background-fill-foreground-stroke4' | 'background-fill-background-stroke4' | 'hollow-circle' | 'inherited-prepared-body', bodyKind: 'cylinder' | 'rectangle' | 'borderless-rectangle' = 'cylinder') {
  const elements = rectangleEmissionElements(drawing.svg)
  const wideStroke = mode === 'background-stroke' || mode === 'foreground-stroke' || mode === 'background-stroke4' || mode === 'foreground-stroke4' || mode === 'background-fill-foreground-stroke4' || mode === 'background-fill-background-stroke4' || mode === 'hollow-circle'
  expect(elements.find(element => element.name === 'svg')!.attributes.viewBox).toBe(wideStroke ? '0 0 800 800' : '0 0 160 100')
  expect(elements.find(element => element.name === 'marker')!.attributes).toMatchObject({ markerWidth: '8', markerHeight: '5', refX: '8', refY: '2.5', orient: 'auto' })
  expect(elements.find(element => element.name === 'marker')!.attributes.markerUnits).toBeUndefined()
  if (mode === 'hollow-circle') {
    expect(elements.filter(element => element.name === 'polygon')).toHaveLength(0)
    expect(elements.find(element => element.name === 'circle')!.attributes).toEqual({ cx: '4', cy: '2.5', r: '2', fill: '#fff', stroke: '#111', 'stroke-width': '0.75' })
    // The complete ring lies[293.625,298.375]×[277.625,282.375],
    // outside the actual rectangle and inside the local8×5 clipping viewport.
    expect(298.375).toBeLessThan(300)
  } else expect(elements.find(element => element.name === 'polygon')!.attributes).toMatchObject({ points: '0 0, 8 2.5, 0 5', fill: mode === 'background-fill-foreground-stroke4' || mode === 'background-fill-background-stroke4' ? '#fff' : '#111', ...(wideStroke
      ? { stroke: mode === 'background-stroke' || mode === 'background-stroke4' || mode === 'background-fill-background-stroke4' ? '#fff' : '#111', 'stroke-width': mode.endsWith('stroke4') ? '4' : '64', 'stroke-linejoin': 'round', 'paint-order': 'normal' }
      : { stroke: 'none' }) })
  if (wideStroke) expect(elements.find(element => element.name === 'marker')!.attributes.overflow).toBe('hidden')
  expect(elements.find(element => element.attributes['data-id'] === 'cylinder-edge')!.attributes).toMatchObject({ x1: wideStroke ? '260' : '20', y1: wideStroke ? '280' : '40', x2: wideStroke ? '300' : mode === 'inherited-prepared-body' ? '70' : mode === 'inward' ? '61' : '60', y2: wideStroke ? '280' : '40', 'stroke-width': '1', 'marker-end': 'url(#cylinder-tip)' })
  const index = elements.findIndex(element => element.attributes['data-id'] === 'body')
  const pieces = elements.slice(index, index + (bodyKind !== 'cylinder' ? 1 : mode === 'extra-piece' ? 6 : 5))
  expect(pieces.map(piece => piece.name)).toEqual(bodyKind !== 'cylinder' ? ['rect'] : mode === 'extra-piece' ? ['rect', 'line', 'line', 'ellipse', 'ellipse', 'rect'] : ['rect', 'line', 'line', 'ellipse', 'ellipse'])
  expect(pieces[0]!.attributes).toMatchObject({ x: wideStroke ? '300' : '60', y: wideStroke ? '260' : '20', width: '60', height: '40', fill: mode === 'fallback-fill' ? 'var(--host,#fff)' : '#fff', ...(bodyKind !== 'cylinder' ? { stroke: bodyKind === 'borderless-rectangle' ? 'none' : '#111', 'stroke-width': '1' } : { stroke: 'none' }) })
  if (bodyKind === 'cylinder') {
    expect(pieces[1]!.attributes).toMatchObject({ x1: wideStroke ? '300' : '60', y1: wideStroke ? '260' : '20', x2: wideStroke ? '300' : '60', y2: wideStroke ? '300' : '60', stroke: mode === 'fallback-stroke' ? 'var(--host,#111)' : '#111', 'stroke-width': '1' })
    expect(pieces[2]!.attributes).toMatchObject({ x1: wideStroke ? '360' : '120', y1: wideStroke ? '260' : '20', x2: wideStroke ? '360' : '120', y2: wideStroke ? '300' : '60', stroke: '#111', 'stroke-width': '1' })
    expect(pieces[3]!.attributes).toMatchObject({ cx: wideStroke ? '330' : '90', cy: wideStroke ? '300' : '60', rx: '30', ry: '7', fill: '#fff', stroke: '#111', 'stroke-width': '1' })
    expect(pieces[4]!.attributes).toMatchObject({ cx: wideStroke ? '330' : '90', cy: wideStroke ? '260' : '20', rx: '30', ry: '7', fill: '#fff', stroke: '#111', 'stroke-width': '1' })
  }
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  if (mode === 'inward') {
    // Actual triangle(53,37.5),(61,40),(53,42.5) contains a positive
    // patch about(60.75,40). It lies beyond the side's inner edge60.5,
    // inside the opaque rectangle, and clear of both ellipse stroke bands.
    expect(60.75).toBeGreaterThan(Number(pieces[1]!.attributes.x1) + 0.5)
    expect(60.75).toBeLessThan(61)
    expect(40).toBeGreaterThan(Number(pieces[4]!.attributes.cy) + 7 + 0.5)
    expect(40).toBeLessThan(Number(pieces[3]!.attributes.cy) - 7 - 0.5)
  }
  const token = ' marker-end="url(#cylinder-tip)"'
  expect(drawing.svg.split(token)).toHaveLength(2)
  // The paired wide-stroke observations use the same explicit white viewing
  // backdrop. The original SVG above remains the actual certification source.
  const root = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">'
  if (wideStroke) expect(drawing.svg.split(root)).toHaveLength(2)
  const viewedSvg = wideStroke ? drawing.svg.replace(root, `${root}<rect x="0" y="0" width="800" height="800" fill="#fff" />`) : drawing.svg
  const rendered = new Resvg(viewedSvg).render(), pixels = rendered.pixels
  const absent = new Resvg(viewedSvg.replace(token, '')).render().pixels
  if (wideStroke) {
    // The triangle's area20 and semiperimeter2.5+sqrt(70.25) give inradius
    // <2. Thus even width4's white stroke covers its complete fill after normal
    // painting. Its shaft erasure is distinct from the paired dark marker ink.
    if (mode !== 'hollow-circle') expect(20 / (2.5 + Math.sqrt(70.25))).toBeLessThan(2)
    let contrastingOffSupport = 0, nonOpaque = 0
    const samples: Array<{ x: number; y: number; actual: number[]; absent: number[] }> = []
    for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] !== 255 || absent[offset] !== 255) nonOpaque++
    expect(nonOpaque).toBe(0)
    for (let y = 0; y < rendered.height; y++) if (Math.abs(y + 0.5 - 280) > 1.25) for (let x = 0; x < rendered.width; x++) {
      const offset = (y * rendered.width + x) * 4
      for (let channel = 0; channel < 3; channel++) if (pixels[offset + channel]! < absent[offset + channel]!) {
        contrastingOffSupport++
        if (samples.length < 16) samples.push({ x, y, actual: [...pixels.subarray(offset, offset + 4)], absent: [...absent.subarray(offset, offset + 4)] })
        break
      }
    }
    if (mode === 'background-stroke' || mode === 'background-stroke4' || mode === 'background-fill-background-stroke4') {
      if (contrastingOffSupport !== 0) console.info('background stroke physical precondition unavailable', JSON.stringify({ contrastingOffSupport, samples }))
      expect(contrastingOffSupport).toBe(0)
    } else expect(contrastingOffSupport).toBeGreaterThan(0)
  } else if (mode === 'inherited-prepared-body') {
    // The authored triangle[62,70]×[37.5,42.5] is wholly inside the later
    // opaque body[60,120]×[20,60], away from both cap stroke bands.
    expect(62).toBeGreaterThan(Number(pieces[0]!.attributes.x))
    expect(70).toBeLessThan(Number(pieces[0]!.attributes.x) + Number(pieces[0]!.attributes.width))
    expect(37.5).toBeGreaterThan(Number(pieces[4]!.attributes.cy) + 7 + 0.5)
    expect(42.5).toBeLessThan(Number(pieces[3]!.attributes.cy) - 7 - 0.5)
    const opaquePixels = (svg: string) => new Resvg(svg, { background: '#fff' }).render().pixels
    expect(Buffer.compare(opaquePixels(drawing.svg), opaquePixels(drawing.svg.replace(token, '')))).toBe(0)
    const bodyStart = drawing.svg.indexOf('<rect x="60" y="20" width="60" height="40" fill="#fff" stroke="none" data-id="body" data-role="node" />')
    expect(bodyStart).toBeGreaterThan(drawing.svg.indexOf('marker-end="url(#cylinder-tip)"'))
    const bodyXml = drawing.svg.slice(bodyStart, drawing.svg.indexOf('</svg>'))
    expect(bodyXml.match(/<(?:rect|line|ellipse)\b/g)).toHaveLength(5)
    const exposed = drawing.svg.replace(bodyXml, '')
    expect(Buffer.compare(opaquePixels(exposed), opaquePixels(exposed.replace(token, '')))).not.toBe(0)
  } else if (mode === 'extra-piece') {
    expect(pieces[5]!.attributes).toMatchObject({ x: '51', y: '36', width: '10', height: '8', fill: '#fff', stroke: 'none' })
    expect(Buffer.compare(pixels, absent)).toBe(0)
  } else {
    let offSupport = 0
    for (let y = 0; y < rendered.height; y++) if (Math.abs(y + 0.5 - 40) > 1.25) for (let x = 0; x < rendered.width; x++) {
      const offset = (y * rendered.width + x) * 4
      if (!pixels.subarray(offset, offset + 4).equals(absent.subarray(offset, offset + 4))) offSupport++
    }
    expect(offSupport).toBeGreaterThan(0)
  }
}

test.each([
  ...(['clear', 'inward', 'extra-piece', 'inherited-prepared-body', 'fallback-fill', 'fallback-stroke', 'background-stroke', 'foreground-stroke'] as const).flatMap(mode => (['native', 'scene'] as const).map(execution => ({ mode, execution, bodyKind: 'cylinder' as const }))),
  ...(['background-stroke4', 'foreground-stroke4'] as const).flatMap(mode => (['cylinder', 'rectangle'] as const).flatMap(bodyKind => (['native', 'scene'] as const).map(execution => ({ mode, execution, bodyKind })))),
  ...(['native', 'scene'] as const).map(execution => ({ mode: 'background-fill-foreground-stroke4' as const, execution, bodyKind: 'rectangle' as const })),
  ...(['native', 'scene'] as const).map(execution => ({ mode: 'background-fill-background-stroke4' as const, execution, bodyKind: 'rectangle' as const })),
  ...(['native', 'scene'] as const).map(execution => ({ mode: 'hollow-circle' as const, execution, bodyKind: 'rectangle' as const })),
  ...(['native', 'scene'] as const).map(execution => ({ mode: 'background-stroke4' as const, execution, bodyKind: 'borderless-rectangle' as const })),
  { mode: 'getter' as const, execution: 'native' as const, bodyKind: 'cylinder' as const },
  { mode: 'inherited' as const, execution: 'native' as const, bodyKind: 'cylinder' as const },
])('cylinder write $mode keeps complete actual paint authority through $execution ($bodyKind)', ({ mode, execution, bodyKind }) => {
  const inheritedBody = Object.getOwnPropertyDescriptor(Object.prototype, 'preparedBody')
  let preparedBodyCalls = 0
  let drawing: ReturnType<typeof drawCylinderWriteControl>
  try {
    if (mode === 'inherited-prepared-body') {
      const descriptor = Object.assign(Object.create(null), { configurable: true, writable: true, value: () => { preparedBodyCalls++; return { x: 0, y: 0 } } })
      Object.defineProperty(Object.prototype, 'preparedBody', descriptor)
    }
    drawing = drawCylinderWriteControl(mode, execution, bodyKind)
  } finally {
    if (mode === 'inherited-prepared-body') {
      if (inheritedBody) Object.defineProperty(Object.prototype, 'preparedBody', inheritedBody)
      else delete (Object.prototype as { preparedBody?: unknown }).preparedBody
    }
  }
  if (mode === 'inherited-prepared-body') expect(Object.getOwnPropertyDescriptor(Object.prototype, 'preparedBody')).toEqual(inheritedBody)
  expectCylinderWriteInk(drawing, mode, bodyKind)
  if (mode === 'inherited-prepared-body') {
    if (preparedBodyCalls !== 0 || drawing.proof.status === 'passed') console.info('introduced prepared-body draft physical violation', JSON.stringify({ execution, preparedBodyCalls, svg: drawing.svg, proof: drawing.proof }))
    expect(preparedBodyCalls).toBe(0)
  }
  if (mode === 'getter') expect(drawing.reads.length).toBeGreaterThan(0)
  if (mode === 'clear' || mode === 'foreground-stroke' || mode === 'foreground-stroke4' || mode === 'background-fill-foreground-stroke4' || mode === 'hollow-circle') expect(drawing.proof.status).toBe('passed')
  else expect(drawing.proof.status).not.toBe('passed')
})

test('cylinder write cached replay cannot borrow first-write compound facts', () => {
  const drawing = drawCylinderWriteControl('clear', 'scene')
  expectCylinderWriteInk(drawing, 'clear')
  expect(drawing.proof.status).toBe('passed')
  if (!drawing.admitted) throw new Error('Expected an admitted cylinder Scene')
  const cached = createSceneWriteCapture(MAX_OCCLUSION_OPERATIONS, { fractionalCircleOutput: true })
  expect(admitSceneDocument(drawing.admitted, 'internal', true, cached.observe)).toBe(drawing.admitted)
  expect(DefaultBackend.render(drawing.admitted, { seed: 0 })).toBe(drawing.svg)
  expect(certifyScenePaint(drawing.admitted, undefined, { sceneWriteReceipt: cached.finish(drawing.admitted) }).status).not.toBe('passed')
})

test.each((['opacity', 'viewBox'] as const).flatMap(mode => (['native', 'scene'] as const).map(execution => ({ mode, execution }))))('public cached root $mode values cannot certify hidden actual marker ink through $execution', ({ mode, execution }) => {
  const clear = drawCylinderWriteControl('clear', execution)
  expectCylinderWriteInk(clear, 'clear')
  expect(clear.proof.status).toBe('passed')
  const root = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100">'
  const actualRoot = mode === 'opacity' ? root.replace('>', ' style="opacity:0">') : root.replace('0 0 160 100', '100 0 160 100')
  const tokens = scanSvgStartTags(actualRoot)
  const forged = tokens.map(tag => ({ ...tag, attributes: tag.attributes.map(attribute => ({ ...attribute,
    value: attribute.name === (mode === 'opacity' ? 'style' : 'viewBox') ? mode === 'opacity' ? '' : '0 0 160 100' : attribute.value,
  })) }))
  withSvgInspectionCache(() => {
    // The public cache accepts caller data. Preserve genuine token spans and
    // forge only the value that this transaction must read from actual bytes.
    inspectSvgOnce('start-tags', actualRoot, () => forged)
    const drawing = drawCylinderWriteControl('clear', execution, 'cylinder', actualRoot)
    expect(clear.svg.split(root)).toHaveLength(2)
    expect(drawing.svg).toBe(clear.svg.replace(root, actualRoot))
    const attributes = rectangleEmissionElements(drawing.svg).find(element => element.name === 'svg')!.attributes
    expect(attributes).toMatchObject({ width: '160', height: '100', viewBox: mode === 'viewBox' ? '100 0 160 100' : '0 0 160 100' })
    if (mode === 'opacity') expect(attributes.style).toBe('opacity:0')
    const reference = ' marker-end="url(#cylinder-tip)"'
    expect(drawing.svg.split(reference)).toHaveLength(2)
    // The renderer's white viewing background leaves every served root byte
    // unchanged. Opacity hides everything; the pan hides the marker while
    // retaining part of the body, so a blank raster cannot satisfy that case.
    const pixels = new Resvg(drawing.svg, { background: '#fff' }).render().pixels
    const absent = new Resvg(drawing.svg.replace(reference, ''), { background: '#fff' }).render().pixels
    expect(Buffer.compare(pixels, absent)).toBe(0)
    let nonWhite = 0, nonOpaque = 0, offShaftContrast = 0
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] !== 255 || absent[offset + 3] !== 255) nonOpaque++
      if (pixels[offset] !== 255 || pixels[offset + 1] !== 255 || pixels[offset + 2] !== 255) nonWhite++
      const y = Math.floor(offset / 4 / 160)
      if (Math.abs(y + 0.5 - 40) > 1.25 && (pixels[offset]! < absent[offset]! || pixels[offset + 1]! < absent[offset + 1]! || pixels[offset + 2]! < absent[offset + 2]!)) offShaftContrast++
    }
    expect(nonOpaque).toBe(0)
    expect(offShaftContrast).toBe(0)
    if (mode === 'opacity') expect(nonWhite).toBe(0)
    else {
      // Actual marker ink[52,60]×[37.5,42.5] is wholly left of viewBoxx100.
      // The right body side(worldx120,y40) still paints at viewportx20.
      expect(60).toBeLessThan(Number(attributes.viewBox!.split(' ')[0]))
      expect(nonWhite).toBeGreaterThan(0)
      expect(pixels[(40 * 160 + 19) * 4]).toBeLessThan(255)
    }
    if (drawing.proof.status === 'passed') console.info('public cached root actual false-pass observation', JSON.stringify({ mode, execution, svg: drawing.svg, proof: drawing.proof, nonWhite, offShaftContrast }))
    expect(drawing.proof.status).not.toBe('passed')
  })
})

test.each(['native', 'scene'] as const)('public cached metadata inventory cannot hide actual opaque marker erasure through %s', execution => {
  const clear = drawCylinderWriteControl('clear', execution)
  expectCylinderWriteInk(clear, 'clear')
  expect(clear.proof.status).toBe('passed')
  const cover = '<rect x="51" y="36" width="10" height="8" fill="#fff" />'
  const reference = ' marker-end="url(#cylinder-tip)"'
  expect(clear.svg.split('</svg>')).toHaveLength(2)
  const covered = clear.svg.replace('</svg>', `${cover}\n</svg>`)
  expect(rectangleEmissionElements(covered).find(element => element.name === 'rect' && element.attributes.x === '51')!.attributes).toEqual({ x: '51', y: '36', width: '10', height: '8', fill: '#fff' })
  // This exact authored cover contains the complete triangle[52,60]×[37.5,42.5].
  // The positive's actual marker ink reappears when that later cover is removed.
  const pixels = (svg: string) => new Resvg(svg, { background: '#fff' }).render().pixels
  expect(Buffer.compare(pixels(covered), pixels(covered.replace(reference, '')))).toBe(0)
  const exposed = covered.replace(`${cover}\n`, '')
  expect(exposed).toBe(clear.svg)
  expect(Buffer.compare(pixels(exposed), pixels(exposed.replace(reference, '')))).not.toBe(0)
  withSvgInspectionCache(() => {
    inspectSvgOnce('start-tags', cover, () => [])
    let drawing: ReturnType<typeof drawCylinderWriteControl>
    try { drawing = drawCylinderWriteControl('clear', execution, 'cylinder', undefined, cover) } catch (error) {
      expect(error).toMatchObject({ name: 'SceneValidationError' })
      expect((error as Error).message).toContain('nonPaint')
      console.info('public cached metadata typed admission refusal', JSON.stringify({ execution, name: (error as Error).name, message: (error as Error).message, returnedSvg: false }))
      return
    }
    expect(drawing.svg).toBe(covered)
    if (drawing.proof.status === 'passed') console.info('public cached metadata actual false-pass observation', JSON.stringify({ execution, svg: drawing.svg, proof: drawing.proof }))
    expect(drawing.proof.status).not.toBe('passed')
  })
})

function drawFractionalSceneReceiptControl(alias?: 'shape' | 'text', captureOptions: Parameters<typeof createSceneWriteCapture>[1] = { fractionalCircleOutput: true }, variant: { execution?: 'native' | 'scene'; group?: 'plain' | 'close' | 'join' | 'lost-shell' | 'style'; ownerReads?: string[] } = {}) {
  const colors = { bg: '#fff', fg: '#111' }
  const context = { positioned: { width: 248, height: 116.9 }, colors, resolved: { renderOptions: {} } }
  const marker: MarkerDescriptor = { id: 'receipt-ring', shape: 'circle', orient: 'auto', size: { width: 8, height: 8 }, ref: { x: 7.5, y: 4 }, geometry: { kind: 'circle', cx: 4, cy: 4, r: 3.25 }, paint: { fill: 'none', stroke: '#111', strokeWidth: '1' } }
  const producer: DrawingProducer = factory => {
    const first = factory.shape({ id: 'A', role: 'node', geometry: { kind: 'rect', x: 40, y: 40, width: 60, height: 36.9 }, paint: { fill: '#fff', stroke: '#888', strokeWidth: '0.75' } })
    const text = factory.text({ id: 'receipt-label:A', role: 'label', owner: { id: 'A', role: 'node' }, text: 'A', block: preparePixelText('A', { fontSize: 13, fontWeight: 500 }), x: 70, y: 58.45, fontSize: 13, anchor: 'middle', paint: { fill: '#111' } })
    return { family: 'flowchart', width: 248, height: 116.9, transparent: false, colors, parts: [
      factory.documentOpen({ id: 'root', width: 248, height: 116.9, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="248" height="116.9" viewBox="0 0 248 116.9">'),
      factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
      factory.connector({ id: 'receipt-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'polyline', points: [{ x: 100, y: 58.45 }, { x: 148, y: 58.45 }] }, paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'A', to: 'B' }, markers: { end: marker } }),
      first, ...(alias === 'shape' ? [first] : []),
      factory.shape({ id: 'B', role: 'node', geometry: { kind: 'rect', x: 148, y: 40, width: 60, height: 36.9 }, paint: { fill: '#fff', stroke: '#888', strokeWidth: '0.75' } }),
      text, ...(alias === 'text' ? [text] : []),
      factory.text({ id: 'receipt-label:B', role: 'label', owner: { id: 'B', role: 'node' }, text: 'B', block: preparePixelText('B', { fontSize: 13, fontWeight: 500 }), x: 178, y: 58.45, fontSize: 13, anchor: 'middle', paint: { fill: '#111' } }),
      ...(variant.group ? [factory.group({ id: 'receipt-shell', role: 'chrome', open: variant.group === 'style' ? '<g style="--fg:#fff">' : '<g>',
        ...(variant.group === 'lost-shell' ? { owner: { get id() { variant.ownerReads?.push('owner-id:A'); return 'A' }, role: 'node' as const } } : {}),
        close: variant.group === 'close' || variant.group === 'lost-shell' ? '<rect x="138" y="52" width="13" height="13" fill="#fff"/></g>' : '</g>',
        join: variant.group === 'join' ? '<rect x="138" y="52" width="13" height="13" fill="#fff"/>' : '\n',
        children: variant.group === 'lost-shell' ? [] : [
          { node: factory.shape({ id: 'receipt-safe-left', role: 'chrome', geometry: { kind: 'rect', x: 5, y: 5, width: 2, height: 2, rx: 0, ry: 0 }, paint: { fill: '#fff', stroke: '#888', strokeWidth: '1' } }), indent: 0 },
          { node: factory.shape({ id: 'receipt-safe-right', role: 'chrome', geometry: { kind: 'rect', x: 10, y: 5, width: 2, height: 2, rx: 0, ry: 0 }, paint: { fill: '#fff', stroke: '#888', strokeWidth: '1' } }), indent: 0 },
        ],
      })] : []),
      factory.documentClose(),
    ] }
  }
  return drawPaintControl(producer, context, variant.execution ?? 'scene', captureOptions)
}

function expectFractionalSceneReceiptInk(svg: string, alias?: 'shape' | 'text', group?: 'plain' | 'close' | 'join' | 'lost-shell') {
  const elements = rectangleEmissionElements(svg)
  expect(elements.find(element => element.name === 'svg')!.attributes).toMatchObject({ width: '248', height: '116.9', viewBox: '0 0 248 116.9' })
  const rectangleIds: Array<string | undefined> = alias === 'shape' ? ['A', 'A', 'B'] : ['A', 'B']
  if (group) {
    if (group === 'lost-shell') rectangleIds.push(undefined)
    else {
      rectangleIds.push(...(group === 'join' ? [undefined, undefined, undefined, undefined, undefined] : group === 'close' ? [undefined, undefined, undefined] : [undefined, undefined]))
      for (const x of ['5', '10']) {
        const child = elements.find(element => element.name === 'rect' && element.attributes.x === x)!.attributes
        expect(child).toMatchObject({ y: '5', width: '2', height: '2', rx: '0', ry: '0', fill: '#fff', stroke: '#888', 'stroke-width': '1' })
        expect(child['data-id']).toBeUndefined()
      }
    }
    expect(elements.filter(element => element.name === 'rect').map(element => element.attributes.x)).toEqual(group === 'lost-shell' ? ['40', '148', '138'] : group === 'close' ? ['40', '148', '5', '10', '138'] : group === 'join' ? ['40', '148', '138', '5', '138', '10', '138'] : ['40', '148', '5', '10'])
  }
  expect(elements.filter(element => element.name === 'rect').map(element => element.attributes['data-id'])).toEqual(rectangleIds)
  expect(elements.find(element => element.attributes['data-id'] === 'B')!.attributes).toMatchObject({ x: '148', y: '40', width: '60', height: '36.9', fill: '#fff', stroke: '#888', 'stroke-width': '0.75' })
  const edge = elements.find(element => element.attributes['data-id'] === 'receipt-edge')!.attributes
  expect(edge).toMatchObject({ points: '100,58.45 148,58.45', 'data-from': 'A', 'data-to': 'B', stroke: '#111', 'stroke-width': '1', 'marker-end': 'url(#receipt-ring)' })
  expect(edge['marker-start']).toBeUndefined()
  const marker = elements.find(element => element.name === 'marker')!.attributes
  expect(marker).toMatchObject({ id: 'receipt-ring', markerWidth: '8', markerHeight: '8', refX: '7.5', refY: '4', orient: 'auto' })
  expect(marker.markerUnits).toBeUndefined()
  expect(marker.viewBox).toBeUndefined()
  expect(elements.find(element => element.name === 'circle')!.attributes).toMatchObject({ cx: '4', cy: '4', r: '3.25', fill: 'none', stroke: '#111', 'stroke-width': '1' })
  expect(elements.some(element => element.attributes.transform !== undefined)).toBe(false)
  // Authored cardinal pose gives center(144.5,58.45), outer radius3.75:
  // [140.75,54.7,148.25,62.2] fits the final viewport and local [.25,7.75]
  // marker viewport. Its entire right edge148.25 clears B's fill148.375;
  // A ends100.375. Point(144.5,55.2) is ring ink off the shaft58.45±.5.
  const inner = Number(elements.find(element => element.attributes['data-id'] === 'B')!.attributes.x) + 0.75 / 2
  expect(inner).toBe(148.375)
  expect(inner - 148.25).toBe(0.125)
  const texts: string[] = []
  const parser = new SaxesParser({ xmlns: true })
  let inText = false, current = ''
  parser.on('opentag', tag => { if (tag.local === 'text') { inText = true; current = '' } })
  parser.on('text', value => { if (inText) current += value })
  parser.on('closetag', tag => { if (tag.local === 'text') { texts.push(current); inText = false } })
  parser.write(svg).close()
  expect(texts).toEqual(alias === 'text' ? ['A', 'A', 'B'] : ['A', 'B'])
  for (const text of elements.filter(element => element.name === 'text')) {
    expect(text.attributes).toMatchObject({ y: '58.45', 'text-anchor': 'middle', 'data-prepared-text': 'true', lengthAdjust: 'spacingAndGlyphs' })
    const x = Number(text.attributes.x), width = Number(text.attributes.textLength)
    expect(width).toBeGreaterThan(0)
    if (x === 70) expect(x + width / 2).toBeLessThan(140.75)
    else { expect(x).toBe(178); expect(x - width / 2).toBeGreaterThan(148.25) }
  }
  const token = ' marker-end="url(#receipt-ring)"'
  expect(svg.split(token)).toHaveLength(2)
  const font = { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' }
  const actual = new Resvg(svg, { font }).render().pixels
  const absent = new Resvg(svg.replace(token, ''), { font }).render().pixels
  if (group === 'close' || group === 'join' || group === 'lost-shell') {
    const eraser = { name: 'rect', attributes: { x: '138', y: '52', width: '13', height: '13', fill: '#fff' } }
    expect(elements.filter(element => element.name === 'rect' && element.attributes.x === '138')).toEqual(group === 'join' ? [eraser, eraser, eraser] : [eraser])
    // Actual erased area[138,151]×[52,65] contains the complete ring
    // [140.75,148.25]×[54.7,62.2]; absence of marker changes no pixel.
    expect(Buffer.compare(actual, absent)).toBe(0)
  } else expect(Buffer.compare(actual, absent)).not.toBe(0)
}

test('a fresh Scene fractional circle receipt retains actual shape and text occurrence authority', () => {
  const drawing = drawFractionalSceneReceiptControl()
  expectFractionalSceneReceiptInk(drawing.svg)
  expect(drawing.proof.status).toBe('passed')
})

test.each((['close', 'join'] as const).flatMap(group => (['native', 'scene'] as const).map(execution => ({ group, execution }))))('fractional group $group cannot erase recorded marker ink through $execution', ({ group, execution }) => {
  const plain = drawFractionalSceneReceiptControl(undefined, undefined, { execution, group: 'plain' })
  expectFractionalSceneReceiptInk(plain.svg, undefined, 'plain')
  expect(plain.proof.status).toBe('passed')
  const erased = drawFractionalSceneReceiptControl(undefined, undefined, { execution, group })
  expectFractionalSceneReceiptInk(erased.svg, undefined, group)
  expect(erased.svg).not.toBe(plain.svg)
  expect(erased.proof.status).not.toBe('passed')
})

test('fractional group failed Native shell capture cannot omit an empty painted group', () => {
  const reads: string[] = []
  const drawing = drawFractionalSceneReceiptControl(undefined, undefined, { execution: 'native', group: 'lost-shell', ownerReads: reads })
  expectFractionalSceneReceiptInk(drawing.svg, undefined, 'lost-shell')
  expect(reads.length).toBeGreaterThan(0)
  expect(drawing.proof.status).not.toBe('passed')
})

test.each(['native', 'scene'] as const)('caller-owned cached group tokens cannot erase actual %s group style', execution => {
  const plain = drawFractionalSceneReceiptControl(undefined, undefined, { execution, group: 'plain' })
  expect(plain.proof.status).toBe('passed')
  const styled = drawFractionalSceneReceiptControl(undefined, undefined, { execution, group: 'style' })
  expect(styled.proof.status).not.toBe('passed')
  const start = styled.svg.indexOf('<g '), end = styled.svg.indexOf('>', start) + 1
  expect(start).toBeGreaterThan(0)
  const open = styled.svg.slice(start, end)
  expect(open).toContain('style="--fg:#fff"')
  withSvgInspectionCache(() => {
    const attributes = [{ name: 'style', value: '--fg:#fff', quote: '"' as const, nameStart: 3, valueStart: 10, valueEnd: 19 }]
    inspectSvgOnce('start-tags', open, () => [{ name: 'g', start: 0, end: open.length, attributes, selfClosing: false }])
    // The public cache deliberately retains caller-owned mutable results.
    // Removing its style cannot replace the private actual group parse.
    attributes.length = 0
    const repeated = drawFractionalSceneReceiptControl(undefined, undefined, { execution, group: 'style' })
    expect(repeated.svg).toBe(styled.svg)
    expect(repeated.proof.status).not.toBe('passed')
  })
})

test.each(['inherited', 'accessor'] as const)('Scene fractional capture option %s cannot acquire explicit output authority', mode => {
  const explicit = drawFractionalSceneReceiptControl()
  const reads: string[] = []
  const options: NonNullable<Parameters<typeof createSceneWriteCapture>[1]> = {}
  if (mode === 'accessor') Object.defineProperty(options, 'fractionalCircleOutput', { get() { reads.push('fractionalCircleOutput'); return true } })
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'fractionalCircleOutput')
  const drawing = (() => {
    try {
      if (mode === 'inherited') Object.defineProperty(Object.prototype, 'fractionalCircleOutput', { configurable: true, value: true })
      return drawFractionalSceneReceiptControl(undefined, options)
    } finally {
      if (mode === 'inherited') {
        if (descriptor) Object.defineProperty(Object.prototype, 'fractionalCircleOutput', descriptor)
        else delete (Object.prototype as { fractionalCircleOutput?: boolean }).fractionalCircleOutput
      }
    }
  })()
  expect(Object.getOwnPropertyDescriptor(Object.prototype, 'fractionalCircleOutput')).toEqual(descriptor)
  expect(drawing.svg).toBe(explicit.svg)
  expectFractionalSceneReceiptInk(drawing.svg)
  expect(explicit.proof.status).toBe('passed')
  expect({ status: drawing.proof.status, reads }).toEqual({ status: 'unverified', reads: [] })
})

test('cached Scene replay cannot borrow fresh fractional shape and text writes', () => {
  const drawing = drawFractionalSceneReceiptControl()
  expectFractionalSceneReceiptInk(drawing.svg)
  if (!drawing.admitted) throw new Error('Expected an admitted Scene')
  const cached = createSceneWriteCapture(MAX_OCCLUSION_OPERATIONS, { fractionalCircleOutput: true })
  expect(admitSceneDocument(drawing.admitted, 'internal', true, cached.observe)).toBe(drawing.admitted)
  expect(DefaultBackend.render(drawing.admitted, { seed: 0 })).toBe(drawing.svg)
  expect(certifyScenePaint(drawing.admitted, undefined, { sceneWriteReceipt: cached.finish(drawing.admitted) }).status).toBe('unverified')
})

test('foreign and forged Scene receipts cannot certify byte-identical fractional circle output', () => {
  const drawing = drawFractionalSceneReceiptControl(), foreign = drawFractionalSceneReceiptControl()
  expectFractionalSceneReceiptInk(drawing.svg)
  if (!drawing.admitted || !drawing.receipt || !foreign.receipt) throw new Error('Expected independently issued Scene receipts')
  expect(foreign.svg).toBe(drawing.svg)
  expect(certifyScenePaint(drawing.admitted, undefined, { sceneWriteReceipt: foreign.receipt }).status).toBe('unverified')
  const forged = Object.freeze(Object.create(Object.getPrototypeOf(drawing.receipt), Object.getOwnPropertyDescriptors(drawing.receipt))) as typeof drawing.receipt
  expect(certifyScenePaint(drawing.admitted, undefined, { sceneWriteReceipt: forged }).status).toBe('unverified')
})

test.each(['shape', 'text'] as const)('aliased Scene %s occurrences cannot borrow one fractional write fact', alias => {
  const drawing = drawFractionalSceneReceiptControl(alias)
  expectFractionalSceneReceiptInk(drawing.svg, alias)
  if (!drawing.admitted) throw new Error('Expected an admitted Scene')
  const repeated = drawing.admitted.parts.filter(node => node.id === (alias === 'shape' ? 'A' : 'receipt-label:A'))
  expect(repeated).toHaveLength(2)
  expect(repeated[0]).toBe(repeated[1])
  expect(drawing.proof.status).toBe('unverified')
})

test.each(['agentic', 'elk'] as const)('public %s thick-arrow and borderless-state markers retain clipping and actual meaning', backend => {
  for (const source of ['flowchart LR\nA ==> B', 'stateDiagram-v2\nstate fork_state <<fork>>\n[*] --> fork_state\nfork_state --> State2\nfork_state --> State3\nstate join_state <<join>>\nState2 --> join_state\nState3 --> join_state\njoin_state --> State4\nState4 --> [*]']) {
    const result = renderMermaidSVGWithReceipt(source, { graphLayout: { backend, fallback: 'none' } })
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    expect(result.svg).toContain('marker-end="url(#arrowhead)"')
    expect(result.svg).toContain('refX="8"')
    expect(result.svg).not.toContain('overflow="visible"')
    if (source.startsWith('flowchart')) {
      expect(result.svg).toContain('data-id="edge:A-&gt;B#0"')
      expect(result.svg).toContain('stroke-width="2"')
    } else {
      const authoredPairs = [['_start', 'fork_state'], ['fork_state', 'State2'], ['fork_state', 'State3'], ['State2', 'join_state'], ['State3', 'join_state'], ['join_state', 'State4'], ['State4', '_end']]
      const edgeTags = [...result.svg.matchAll(/<(?:line|polyline|path)\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(' data-role="edge"'))
      expect(edgeTags.map(tag => [tag.match(/ data-from="([^"]*)"/)?.[1], tag.match(/ data-to="([^"]*)"/)?.[1]])).toEqual(authoredPairs)
      expect(edgeTags.map(tag => tag.match(/ data-id="([^"]*)"/)?.[1])).toEqual(authoredPairs.map(([from, to]) => `edge:${from}-&gt;${to}#0`))
      if (backend === 'elk') {
        const font = { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url)), fileURLToPath(new URL('../../assets/fonts/Inter-Medium.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' }
        const actual = new Resvg(result.svg, { font }).render().pixels
        // The two incoming join routes share one terminal pose. Remove both
        // references together; the six distinct poses each retain actual ink.
        for (const indices of [[0], [1], [2], [3, 4], [5], [6]]) {
          let absent = result.svg
          for (const index of indices) {
            const tag = edgeTags[index]!
            const markerEnd = ' marker-end="url(#arrowhead)"'
            expect(tag.split(markerEnd)).toHaveLength(2)
            absent = absent.replace(tag, tag.replace(markerEnd, ''))
          }
          expect(Buffer.compare(actual, new Resvg(absent, { font }).render().pixels)).not.toBe(0)
        }
      }
    }
  }
})

test.each(['ellipse', 'circle'] as const)('a supporting line proves a diagonal marker outside a %s while retaining an entering marker as uncertain', kind => {
  const rx = kind === 'circle' ? 20 : 30, ry = 20, cx = 60, cy = 40
  const point = { x: cx - rx / Math.SQRT2, y: cy - ry / Math.SQRT2 }
  const nx = (point.x - cx) / (rx * rx), ny = (point.y - cy) / (ry * ry), norm = Math.hypot(nx, ny)
  const direction = { x: nx / norm, y: ny / norm }
  const marker = { id: 'arrow', shape: 'arrow' as const, units: 'userSpaceOnUse' as const, ref: { x: 8, y: 2.5 }, geometry: { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 8, y: 2.5 }, { x: 0, y: 5 }] }, paint: { fill: '#111' } }
  const card = marks.shape({ id: 'node', role: 'node', geometry: kind === 'circle' ? { kind, cx, cy, r: rx } : { kind, cx, cy, rx, ry }, paint: { fill: '#fff' } })
  const connector = (inset: number) => marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', endpoints: { from: 'outside', to: 'node' },
    geometry: { kind: 'line', x1: point.x + direction.x * 20, y1: point.y + direction.y * 20, x2: point.x - direction.x * inset, y2: point.y - direction.y * inset },
    paint: { stroke: '#111', strokeWidth: '1' }, markers: { end: marker } })
  expect(certifyScenePaint(scene([connector(0), card])).status).toBe('passed')
  const entering = certifyScenePaint(scene([connector(4), card]))
  expect(entering.status).not.toBe('passed')
  expect(entering.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'edge', by: 'node' }))
})

test('final paint order catches fully hidden text, including artwork with the same owner', () => {
  const text = label(), cover = surface()
  const hidden = certifyScenePaint(scene([text, cover]))
  expect(hidden.status).toBe('failed')
  expect(hidden.issues).toContainEqual(expect.objectContaining({ code: 'TEXT_OCCLUDED', id: 'text', by: 'cover' }))
  expect(certifyScenePaint(scene([cover, text])).status).toBe('passed')
  const composed = marks.group({ id: 'same-owner', role: 'node', open: '<g>', close: '</g>', children: [{ node: text, indent: 0 }, { node: cover, indent: 0 }] })
  expect(certifyScenePaint(scene([composed])).status).toBe('failed')
  expect(certifyScenePaint(scene([text, surface('rgba(255,255,255,0.5)')])).status).toBe('passed')
})

test.each([
  ['var(--fg)', { bg: '#fff', fg: '#111' }, 'failed'],
  ['var(--unknown, #fff)', { bg: '#fff', fg: '#111' }, 'failed'],
  ['color-mix(in srgb, #000 50%, transparent)', { bg: '#fff', fg: '#111' }, 'failed'],
  ['var(--surface)', { bg: '#fff', fg: '#111', surface: '#ffffff80' }, 'unverified'],
  ['var(--host, #fff)', { bg: '#fff', fg: '#111', line: 'var(--host)' }, 'unverified'],
  ['var(--fg)', { bg: 'var(--page)', fg: '#111' }, 'unverified'],
] as const)('paint proof retains concrete and live opacity for %s with %j', (fill, colors, status) => {
  const proof = certifyScenePaint({ ...scene([label(), surface(fill)]), colors })
  expect(proof.status).toBe(status)
  expect(proof.issues[0]?.code).toBe(status === 'failed' ? 'TEXT_OCCLUDED' : 'POTENTIAL_OCCLUSION')
})

test('paint certification observes caller palette getters and mutations on each call', () => {
  let fill = '#fff'
  const colors = { bg: '#fff', fg: '#111', get surface() { return fill } }
  const doc = { ...scene([label(), surface('var(--surface)')]), colors }
  expect(certifyScenePaint(doc).status).toBe('failed')
  fill = '#ffffff80'
  expect(certifyScenePaint(doc).status).toBe('unverified')
  fill = '#fff'
  expect(certifyScenePaint(doc).status).toBe('failed')
})

test('distinct paint resolutions observe the palette supplied for each value', () => {
  const first = label()
  const second = marks.text({ id: 'second', role: 'label', text: 'Read', block: first.block, x: 60, y: 30, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
  const cover = (id: string, x: number, fill: string) => marks.shape({ id, role: 'node', geometry: { kind: 'rect', x, y: 10, width: 40, height: 60 }, paint: { fill } })
  let palettes = 0
  const doc: SceneDoc = {
    ...scene([first, second, cover('first-cover', 10, 'var(--surface)'), cover('second-cover', 55, 'var(--surface, #fff)')]),
    get colors() { return { bg: '#fff', fg: '#111', surface: palettes++ === 0 ? '#fff' : '#ffffff00' } },
  }
  const proof = certifyScenePaint(doc)
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'TEXT_OCCLUDED', id: 'text', by: 'first-cover' }))
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'second', by: 'second-cover' }))
  expect(proof.issues).not.toContainEqual(expect.objectContaining({ code: 'TEXT_OCCLUDED', id: 'second' }))
})

test('path envelopes and affine empty corners never masquerade as solid occluders', () => {
  const path = marks.shape({ id: 'triangle', role: 'node', geometry: { kind: 'path', d: 'M10 10 L90 10 L90 70 Z' }, paint: { fill: '#fff' } })
  expect(certifyScenePaint(scene([label(), path])).issues.some(issue => issue.code === 'TEXT_OCCLUDED')).toBe(false)
  expect(certifyScenePaint(scene([label(), path])).status).toBe('unverified')
})

test('endpoint symbols use final owned repaint order rather than marker counts', () => {
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse')
  const fields = { id: 'relationship', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 20, y1: 30, x2: 30, y2: 30 }, paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } }
  const svg = '<line x1="20" y1="30" x2="30" y2="30" stroke="#111" stroke-width="1" marker-end="url(#arrow)"/>'
  const edge = marks.connector(fields)
  const hidden = certifyScenePaint(scene([edge, surface()]))
  expect(hidden.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'relationship', by: 'cover' }))
  const repaint = marks.connector({ ...fields, id: 'marker-artwork', role: 'chrome', owner: { id: 'relationship', role: 'edge' } })
  const visible = certifyScenePaint(scene([edge, surface(), repaint]))
  expect(visible.status).toBe('passed')
  expect(visible.checks.markers).toBe(1)
  const path = marks.shape({ id: 'path-cover', role: 'node', owner: { id: 'cover', role: 'node' }, geometry: { kind: 'path', d: 'M10 10 L90 10 L90 70 L10 70 Z' }, paint: { fill: '#fff' } })
  const unknown = certifyScenePaint(scene([edge, path]))
  expect(unknown.status).toBe('unverified')
  expect(unknown.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'relationship', by: 'path-cover' }))
  expect(certifyScenePaint(scene([edge, path, repaint])).status).toBe('passed')

})

test('one viewport repair contains negative coordinates, stroke and endpoint artwork without moving identities', () => {
  const marker: MarkerDescriptor = { id: 'arrow', shape: 'arrow', units: 'userSpaceOnUse', size: { width: 10, height: 10 }, ref: { x: 0, y: 0 }, viewBox: { x: -5, y: -5, width: 10, height: 10 }, overflow: 'visible', bounds: { x0: -5, y0: -5, x1: 5, y1: 5 }, geometry: { kind: 'polygon', points: [{ x: -5, y: -5 }, { x: 5, y: 0 }, { x: -5, y: 5 }] }, paint: { fill: '#111', stroke: '#111', strokeWidth: '4', strokeLinejoin: 'round' } }
  const edge = marks.connector({ id: 'authored->edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: -10, y1: 20, x2: 110, y2: 20 }, paint: { stroke: '#111', strokeWidth: '4' }, endpoints: { from: 'authored', to: 'edge' }, markers: { end: marker } })
  const proof = certifyScenePaint(scene([edge]))
  expect(proof.status).toBe('passed')
  expect(proof.attempts).toBe(2)
  expect(proof.repairs).toEqual(['expand-viewport'])
  expect(proof.viewport.width / proof.viewport.height).toBeCloseTo(100 / 80, 10)
  expect(proof.viewport.x).toBeLessThanOrEqual(-12)
  expect(proof.viewport.x + proof.viewport.width).toBeGreaterThanOrEqual(117)
  expect(edge.endpoints).toMatchObject({ from: 'authored', to: 'edge' })
  const boundsOnly = marks.connector({ id: 'bounds-only', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: -10, y1: 20, x2: 110, y2: 20 }, paint: { stroke: '#111', strokeWidth: '4' }, endpoints: { from: 'authored', to: 'edge' }, markers: { end: { id: 'arrow', shape: 'arrow', bounds: marker.bounds, units: 'userSpaceOnUse' } } })
  expect(certifyScenePaint(scene([boundsOnly])).status).toBe('unverified')
  const family = getFamily('flowchart')!
  const restore = replaceFamilyForTest('flowchart', { ...family, lowerScene() {
    return { ...scene([]), parts: [
      marks.documentOpen({ id: 'root', width: 100, height: 80, colors: { bg: '#fff', fg: '#111' }, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80" style="--bg:#fff;--fg:#111">'),
      marks.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(marker)}</defs>`), edge, marks.documentClose(),
    ] }
  } })
  let rendered: ReturnType<typeof renderMermaidSVGWithReceipt>
  try { rendered = renderMermaidSVGWithReceipt('flowchart LR\nauthored --> edge', { layoutSafety: 'strict', embedFontImport: false }) }
  finally { restore() }
  expect(rendered.receipt.layoutCertification).toMatchObject({ status: 'passed', attempts: 2, repairs: ['expand-viewport'] })
  const svg = rendered.svg
  const elements = rectangleEmissionElements(svg)
  const viewport = elements.find(element => element.name === 'svg')!.attributes.viewBox!.split(/\s+/).map(Number)
  expect(viewport[0]).toBeLessThanOrEqual(-12)
  expect(viewport[0]! + viewport[2]!).toBeGreaterThanOrEqual(117)
  expect(elements.find(element => element.name === 'polygon')!.attributes.points).toBe('-5 -5, 5 0, -5 5')
  expect(elements.find(element => element.name === 'line')!.attributes).toMatchObject({ x1: '-10', x2: '110', 'stroke-width': '4', 'data-from': 'authored', 'data-to': 'edge' })
  const raster = new Resvg(svg, { background: '#fff' }).render(), actual = raster.pixels
  const absent = new Resvg(svg.replace(' marker-end="url(#arrow)"', ''), { background: '#fff' }).render().pixels
  expect(Buffer.compare(actual, absent)).not.toBe(0)
  let offShaft = 0
  for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
    const worldY = viewport[1]! + (y + 0.5) * viewport[3]! / raster.height
    if (Math.abs(worldY - 20) <= 2) continue
    const offset = (y * raster.width + x) * 4
    if (actual[offset]! < absent[offset]! || actual[offset + 1]! < absent[offset + 1]! || actual[offset + 2]! < absent[offset + 2]!) offShaft++
  }
  expect(offShaft).toBeGreaterThan(0)

})

test('missing preparation, opaque content and conditional output remain unverified', () => {
  const raw = marks.documentContent({ id: 'raw', role: 'chrome' }, '<path d="M0 0 L20 20"/>')
  const conditional = marks.group({ id: 'hover', role: 'chrome', visibility: 'conditional', open: '<g>', close: '</g>', children: [{ node: label(), indent: 0 }] })
  const proof = certifyScenePaint(scene([raw, conditional]))
  expect(proof.status).toBe('unverified')
  expect(proof.coverage.unmeasured).toBe(1)
  expect(proof.coverage.conditional).toBe(1)
  expect(certifyScenePaint(scene([label()]), undefined, { outputSupported: false }).status).toBe('unverified')
})

test('native families expose request-bound graphical, verification, layout and quality proof', () => {
  for (const family of knownBuiltinFamilies()) {
    const source = getFamily(family)!.example
    const rendered = renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' })
    const proof = rendered.receipt.layoutCertification
    expect(proof?.status, family).toBe('passed')
    expect(proof?.outputDigest, family).toBe(renderedSvgDigest(rendered.svg))
    if (proof?.unit === 'px') {
      const actual = rendered.svg.match(/viewBox="([^"]+)"/)![1]!.split(/\s+/).map(Number)
      const retained = [proof.viewport.x, proof.viewport.y, proof.viewport.width, proof.viewport.height]
      retained.forEach((value, index) => expect(Math.abs(value - actual[index]!), family).toBeLessThanOrEqual(5e-12 * Math.max(Math.abs(value), Number.MIN_VALUE)))
    }
    const layout = layoutMermaidWithReceipt(source, { debug: true, layoutSafety: 'strict' })
    expect(layout.receipt.layoutCertification?.status, family).toBe('passed')
    expect(layout.layout.paintCertification?.status, family).toBe('passed')
    expect(measureQuality(layout.layout).paintCertification?.status, family).toBe('passed')
    expect(verifyMermaid(source, { renderOptions: { layoutSafety: 'strict' } }).layoutCertification?.status, family).toBe('passed')
  }
})

test('strict layout safety rejects unverified graphical states and certifies every native terminal family', () => {
  const source = 'pie\n"A": 4\n"B": 6'
  expect(renderMermaidSVGWithReceipt(source, { interactive: true }).receipt.layoutCertification?.status).toBe('unverified')
  expect(() => renderMermaidSVGWithReceipt(source, { interactive: true, layoutSafety: 'strict' })).toThrow('Final paint certification failed')
  for (const family of knownBuiltinFamilies()) expect(renderMermaidASCIIWithReceipt(getFamily(family)!.example, { layoutSafety: 'strict' }).receipt.layoutCertification?.status, family).toBe('passed')
})

test('palette and crisp role styling retain native proof while shadows remain unverified', () => {
  const source = 'flowchart LR\nA[Visible]-->B[Read]'
  const proof = renderMermaidSVGWithReceipt(source, { style: 'paper', layoutSafety: 'strict' }).receipt.layoutCertification
  expect(proof?.status).toBe('passed')
  expect(renderMermaidSVGWithReceipt(source, { shadow: true }).receipt.layoutCertification?.status).toBe('unverified')
})

test('Sankey thick cubic ribbons retain compact native paint bounds', () => {
  const rendered = renderMermaidSVGWithReceipt('sankey-beta\nA,B,100\nB,C,50\nB,D,50')
  const proof = rendered.receipt.layoutCertification!
  expect(proof.status).toBe('passed')
  if (proof.unit === 'px') {
    expect(proof.viewport.x).toBe(0)
    expect(proof.viewport.width).toBeLessThan(800)
    expect(proof.viewport.height).toBeLessThan(700)
  }
})

test('the production render boundary rejects newly occluded text and verify reports the same failure', () => {
  const family = getFamily('flowchart')!
  let lowerings = 0
  const restore = replaceFamilyForTest('flowchart', { ...family, lowerScene(context) {
    lowerings++
    const original = family.lowerScene!(context)
    const cover = marks.shape({ id: 'late-cover', role: 'chrome', geometry: { kind: 'rect', x: 0, y: 0, width: original.width, height: original.height }, paint: { fill: '#fff' } })
    return { ...original, parts: [...original.parts.slice(0, -1), cover, original.parts.at(-1)!] }
  } })
  try {
    expect(() => renderMermaidSVGWithReceipt('flowchart LR\nA[Visible] --> B[Read]')).toThrow('Final paint certification failed')
    const verification = verifyMermaid('flowchart LR\nA[Visible] --> B[Read]')
    expect(verification.ok).toBe(false)
    expect(verification.layoutCertification?.status).toBe('failed')
    expect(lowerings).toBe(2)
  } finally { restore() }
})


test('inline connector text participates in actual final paint order and prepared-text coverage', () => {
  const block = preparePixelText('Read', { fontSize: 12, fontWeight: 400 })
  const edge = marks.connector({ id: 'relationship', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 5, y1: 5, x2: 95, y2: 5 }, paint: { stroke: '#111' }, labels: [{ id: 'inline-label', text: 'Read', block, anchor: { x: 20, y: 30 }, paint: { fill: '#111' }, fontSize: 12, fontWeight: 400, textAnchor: 'start', visual: { kind: 'inline' } }] })
  const hidden = certifyScenePaint(scene([edge, surface()]))
  expect(hidden.status).toBe('failed')
  expect(hidden.coverage.preparedText).toBe(1)
  expect(hidden.issues).toContainEqual(expect.objectContaining({ code: 'TEXT_OCCLUDED', id: 'inline-label', by: 'cover' }))
  expect(certifyScenePaint(scene([surface(), edge])).status).toBe('passed')
})


test.each(['transparent', 'rgba(0,0,0,0)', '#00000000'])('invisible %s native outlines preserve the final viewport', stroke => {
  const rendered = renderMermaidSVGWithReceipt(`flowchart LR\nA[Visible]\nstyle A stroke:${stroke},stroke-width:1000px`)
  const proof = rendered.receipt.layoutCertification!
  expect(proof.status).toBe('passed')
  if (proof.unit === 'px') {
    expect(proof.repairs).toEqual([])
    expect(proof.viewport.width).toBeLessThan(200)
    expect(proof.viewport.height).toBeLessThan(150)
  }
})

test('repaired non-scaling strokes remain explicitly outside final containment proof', () => {
  const shape = marks.shape({ id: 'border', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 100, height: 80 }, paint: { stroke: '#000', strokeWidth: '10', vectorEffect: 'non-scaling-stroke' } })
  expect(certifyScenePaint(scene([shape]))).toMatchObject({ status: 'unverified', repairs: ['expand-viewport'], issues: [expect.objectContaining({ code: 'OUTPUT_SCOPE' })] })
})

test('a differently scaled marker carrier cannot erase earlier occluded artwork', () => {
  const marker = tipAnchoredArrow('arrow', { width: 2, height: 2 }, 'end', { fill: '#111' })
  const fields = { id: 'relationship', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 20, y1: 30, x2: 30, y2: 30 }, paint: { stroke: '#111', strokeWidth: '10' }, markers: { end: marker } }
  const edge = marks.connector(fields)
  const repaint = marks.connector({ ...fields, id: 'small-carrier', role: 'chrome', owner: { id: 'relationship', role: 'edge' }, paint: { stroke: '#111', strokeWidth: '1' } })
  const proof = certifyScenePaint(scene([edge, surface(), repaint]))
  expect(proof.status).toBe('failed')
  expect(proof.checks.markers).toBe(2)
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'relationship' }))
})

test('a zero-opacity group cannot repaint an earlier occluded endpoint marker', () => {
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse')
  const fields = { id: 'relationship', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 20, y1: 30, x2: 30, y2: 30 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } }
  const edge = marks.connector(fields)
  const repaint = marks.connector({ ...fields, id: 'repaint', role: 'chrome', owner: { id: 'relationship', role: 'edge' } })
  const hidden = marks.group({ id: 'hidden', role: 'chrome', open: '<g>', close: '</g>', paint: { opacity: '0' }, children: [{ node: repaint, indent: 0 }] })
  // The original triangle occupies x=22..30, y=27.5..32.5, fully inside
  // the later white card. The final marker reference paints no pixels.
  expect(sceneNodeSerialization(hidden)).toContain('<g opacity="0">')
  expect(sceneNodeSerialization(hidden)).toContain('marker-end="url(#arrow)"')
  const proof = certifyScenePaint(scene([edge, surface(), hidden]))
  expect(proof.status).toBe('failed')
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'relationship', by: 'cover' }))
  expect(certifyScenePaint(scene([hidden])).checks.markers).toBe(0)
  expect(certifyScenePaint(scene([edge, surface(), repaint])).status).toBe('passed')
})

test('private emission custody cannot be discarded while fresh generic Native inspection remains available', () => {
  const header = scene([])
  const node = marks.shape({ id: 'surface', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#fff' } })
  const generic = inspectNativePaintGeometry(header, [{ node }])
  expect(certifyNativePaint(header, generic).status).toBe('passed')
  const producer: DrawingProducer = factory => ({ ...header, parts: [
    factory.documentOpen({ id: 'root', width: header.width, height: header.height, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
    factory.shape({ id: node.id, role: node.role, geometry: node.geometry, paint: node.paint }),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, { positioned: { width: header.width, height: header.height }, colors: header.colors, resolved: { renderOptions: {} } }, 'flowchart')
  expect(certifyNativePaint(drawing.header, drawing.paint).status).toBe('passed')
  expect(certifyNativePaint(drawing.header, { ...drawing.paint }).status).toBe('unverified')
  expect(certifyNativePaint(drawing.header, { ...drawing.paint, primitives: [...drawing.paint.primitives] }).status).toBe('unverified')
  expect(certifyNativePaint({ ...drawing.header }, drawing.paint).status).toBe('unverified')
})

test.each(['cache-prime', 'finish-reissue'] as const)('malformed Native XML cannot borrow admission through %s', mode => {
  const marker = tipAnchoredArrow('xml-admission-arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse')
  const header = scene([])
  const context = { positioned: { width: 100, height: 80 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...header, parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" data-note="&unbound;">'),
    factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector({ id: 'xml-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#111' }, markers: { end: marker } }),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  expect(() => new Resvg(drawing.svg, { font: { loadSystemFonts: false } })).toThrow()
  const validSvg = drawing.svg.replace(' data-note="&unbound;"', '')
  expect(() => new Resvg(validSvg, { font: { loadSystemFonts: false } })).not.toThrow()
  if (mode === 'cache-prime') {
    withSvgInspectionCache(() => {
      // A caller can populate the generic cache, but its boolean cannot
      // become XML authority for a fresh drawing with the same malformed bytes.
      inspectSvgOnce('xml-envelope', drawing.svg, () => true)
      const repeated = drawNative(producer, context, 'flowchart')
      expect(repeated.svg).toBe(drawing.svg)
      expect(certifyNativePaint(repeated.header, repeated.paint).status).not.toBe('passed')
    })
  } else {
    // An unrelated valid serialization cannot replace the admission belonging
    // to this already emitted inspection, even with the exact retained header.
    createNativePaintEmission(MAX_OCCLUSION_OPERATIONS).finish(drawing.paint, drawing.header, validSvg)
    expect(certifyNativePaint(drawing.header, drawing.paint).status).not.toBe('passed')
  }
})

test.each([
  ...(['line', 'polyline'] as const).flatMap(kind => (['exact', 'rounded', 'fractional'] as const).map(mode => ({ kind, mode }))),
  { kind: 'polyline' as const, mode: 'bent-fractional' as const },
  { kind: 'polyline' as const, mode: 'zero-last' as const },
  { kind: 'polyline' as const, mode: 'long-bent-fractional' as const },
  { kind: 'polyline' as const, mode: 'long-zero-last' as const },
].flatMap(row => (['native', 'scene'] as const).map(execution => ({ ...row, execution }))))('the $mode emitted $kind must retain visible endpoint marker ink through $execution', ({ kind, mode, execution }) => {
  // The tiny northwest line writes as a zero-length line. Its SVG auto
  // orientation is then +x: the triangle (32,37.5),(40,40),(32,42.5)
  // lies wholly under the later white card. The raw northwest tangent instead
  // places that triangle southeast of the card and used to receive a pass.
  const x1 = mode === 'rounded' ? 40.00000000000001 : mode === 'fractional' ? 41.00000000000001 : 41
  const y1 = mode === 'exact' ? 41 : 40.00000000000001
  const long = mode === 'long-bent-fractional' || mode === 'long-zero-last'
  const bent = mode === 'bent-fractional' || mode === 'zero-last' || long
  const zeroLast = mode === 'zero-last' || mode === 'long-zero-last'
  const servedBentPoints = [
    ...(long ? [{ x: 70, y: 70 }, { x: 60, y: 70 }] : []),
    { x: 60, y: 60 }, { x: 60, y: 40 }, { x: zeroLast ? 40 : 41, y: 40 }, { x: 40, y: 40 },
  ]
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse')
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...scene([]), parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
    factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector({ id: 'arrow-edge', role: 'edge', lineStyle: 'solid', geometry: kind === 'line'
      ? { kind: 'line', x1, y1, x2: 40, y2: 40 }
      : { kind: 'polyline', points: bent
        ? [...(long ? [{ x: 70.00000000000001, y: 70.00000000000001 }, { x: 60.00000000000001, y: 70.00000000000001 }] : []), { x: 60.00000000000001, y: 60.00000000000001 }, { x: 60.00000000000001, y: 40.00000000000001 }, { x: zeroLast ? 39.99999999999999 : 41.00000000000001, y: 40.00000000000001 }, { x: 40.00000000000001, y: 40.00000000000001 }]
        : [{ x: x1, y: y1 }, { x: 40, y: 40 }] }, paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'other', to: 'cover' }, markers: { end: marker } }),
    factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 30, y: 35, width: 10, height: 10 }, paint: { fill: '#fff' } }),
    factory.documentClose(),
  ] })
  const drawing = drawPaintControl(producer, context, execution)
  expect(drawing.svg).toContain(kind === 'line'
    ? mode === 'rounded' ? '<line x1="40" y1="40" x2="40" y2="40"' : mode === 'fractional' ? '<line x1="41" y1="40" x2="40" y2="40"' : '<line x1="41" y1="41" x2="40" y2="40"'
    : bent ? `<polyline points="${long ? '70,70 60,70 ' : ''}60,60 60,40 ${zeroLast ? '40' : '41'},40 40,40"` : mode === 'rounded' ? '<polyline points="40,40 40,40"' : mode === 'fractional' ? '<polyline points="41,40 40,40"' : '<polyline points="41,41 40,40"')
  expect(drawing.svg).toContain('marker-end="url(#arrow)"')
  expect(drawing.svg).toContain('points="0 0, 8 2.5, 0 5" fill="#111"')
  const cover = '<rect x="30" y="35" width="10" height="10" fill="#fff" data-id="cover" data-role="node" />'
  expect(drawing.svg).toContain(cover)
  const markerEnd = ' marker-end="url(#arrow)"'
  expect(drawing.svg.split(markerEnd)).toHaveLength(2)
  const fontFiles = [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url))]
  const raster = (svg: string) => new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().pixels
  const darkPixels = (svg: string): number => {
    const pixels = raster(svg)
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3]! > 0 && pixels[index]! < 128) count++
    return count
  }
  const withoutCover = drawing.svg.replace(cover, '')
  expect(Buffer.compare(raster(withoutCover), raster(withoutCover.replace(markerEnd, '')))).not.toBe(0)
  const markerChangesImage = Buffer.compare(raster(drawing.svg), raster(drawing.svg.replace(markerEnd, ''))) !== 0
  const proof = drawing.proof
  if (mode === 'rounded' || zeroLast) {
    if (mode === 'rounded') expect(darkPixels(drawing.svg)).toBe(0)
    else expect(darkPixels(drawing.svg)).toBeGreaterThan(0)
    expect(markerChangesImage).toBe(false)
    expect(proof.status).not.toBe('passed')
    if (drawing.admitted) {
      expect(certifyScenePaint(drawing.admitted).status).not.toBe('passed')
      const cached = createSceneWriteCapture(MAX_OCCLUSION_OPERATIONS)
      expect(admitSceneDocument(drawing.admitted, 'internal', true, cached.observe)).toBe(drawing.admitted)
      expect(DefaultBackend.render(drawing.admitted, { seed: 0 })).toBe(drawing.svg)
      expect(certifyScenePaint(drawing.admitted, undefined, { sceneWriteReceipt: cached.finish(drawing.admitted) }).status).not.toBe('passed')
    }
  } else {
    expect(darkPixels(drawing.svg)).toBeGreaterThan(0)
    expect(markerChangesImage).toBe(true)
    expect(proof.status).toBe('passed')
    expect(proof.issues).toEqual([])
    if (mode === 'fractional' || bent) {
      const source = paintPrimitiveSource(drawing.paint.primitives.find(primitive => primitive.id === 'arrow-edge')!)
      expect(source?.kind).toBe('connector')
      if (source?.kind !== 'connector') throw new Error('Expected retained connector paint')
      expect(source.route.geometry).toEqual(kind === 'line'
        ? { kind: 'line', x1: 41, y1: 40, x2: 40, y2: 40 }
        : bent ? { kind: 'polyline', points: servedBentPoints }
          : { kind: 'polyline', points: [{ x: 41, y: 40 }, { x: 40, y: 40 }] })
      expect(source.route.contours).toEqual(bent
        ? [{ start: long ? { x: 70, y: 70 } : { x: 60, y: 60 }, end: { x: 40, y: 40 }, closed: false, startTangent: long ? { x: -1, y: 0 } : { x: 0, y: -1 }, endTangent: { x: -1, y: 0 } }]
        : [{ start: { x: 41, y: 40 }, end: { x: 40, y: 40 }, closed: false, startTangent: { x: -1, y: 0 }, endTangent: { x: -1, y: 0 } }])
      expect(source.route.startTangent).toEqual(bent && !long ? { x: 0, y: -1 } : { x: -1, y: 0 })
      expect(source.route.endTangent).toEqual({ x: -1, y: 0 })
    }
  }
})

test.each((['chord-only', 'default-unit-chord-only', 'rounded-derivative', 'far-covered', 'far-viewport'] as const).flatMap(mode => (['native', 'scene'] as const).map(execution => ({ mode, execution }))))('a $mode cubic cannot certify hidden or clipped final marker ink through $execution', ({ mode, execution }) => {
  const chordOnly = mode === 'chord-only' || mode === 'default-unit-chord-only'
  const marker = tipAnchoredArrow('terminal', { width: 8, height: 5 }, 'end', { fill: '#000', stroke: 'none' }, mode === 'default-unit-chord-only' ? undefined : 'userSpaceOnUse')
  const rawPath = chordOnly ? 'M20 40 C20 40 60.1 40 60 40'
    : mode === 'rounded-derivative' ? 'M20 40 C20 40 60.00000000000001 40 60 40'
      : mode === 'far-covered' ? 'M20 40 C20 40 91 40 90 40' : 'M20 40 C20 40 96 40 95 40'
  const projection = mode === 'rounded-derivative' ? projectConnectorPath(rawPath, { x: 20, y: 40 }, [
    { kind: 'cubic', control1: { x: 20, y: 40 }, control2: { x: 60.00000000000001, y: 40 }, end: { x: 60, y: 40 } },
  ]) : undefined
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#000' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...scene([]), colors: context.colors, parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
    factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid',
      geometry: projection?.geometry ?? { kind: 'path', d: rawPath, points: [{ x: 20, y: 40 }, { x: 60, y: 40 }] },
      ...(projection ? { route: { contours: projection.contours } } : {}),
      paint: { stroke: '#000', strokeWidth: '1', strokeLinecap: 'butt', strokeLinejoin: 'round' },
      endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } }),
    factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: chordOnly ? 60 : mode === 'far-covered' ? 90 : mode === 'far-viewport' ? 10 : 30, y: mode === 'far-viewport' ? 10 : 20, width: mode === 'far-covered' ? 9 : mode === 'far-viewport' ? 10 : 30, height: mode === 'far-viewport' ? 10 : 40 }, paint: { fill: '#fff', stroke: '#888', strokeWidth: '1' } }),
    factory.documentClose(),
  ] })
  const drawing = drawPaintControl(producer, context, execution)
  expect(drawing.svg).toContain(chordOnly ? 'd="M20 40 C20 40 60.1 40 60 40"'
    : mode === 'rounded-derivative' ? 'd="M20 40 C20 40 60 40 60 40"'
      : mode === 'far-covered' ? 'd="M20 40 C20 40 91 40 90 40"' : 'd="M20 40 C20 40 96 40 95 40"')
  expect(drawing.svg).toContain('points="0 0, 8 2.5, 0 5" fill="#000" stroke="none"')
  const markerEnd = ' marker-end="url(#terminal)"'
  const cover = chordOnly
    ? '<rect x="60" y="20" width="30" height="40" fill="#fff" stroke="#888" stroke-width="1" data-id="cover" data-role="node" />'
    : mode === 'far-covered' ? '<rect x="90" y="20" width="9" height="40" fill="#fff" stroke="#888" stroke-width="1" data-id="cover" data-role="node" />'
      : mode === 'far-viewport' ? '<rect x="10" y="10" width="10" height="10" fill="#fff" stroke="#888" stroke-width="1" data-id="cover" data-role="node" />'
        : '<rect x="30" y="20" width="30" height="40" fill="#fff" stroke="#888" stroke-width="1" data-id="cover" data-role="node" />'
  expect(drawing.svg.split(markerEnd)).toHaveLength(2)
  expect(drawing.svg).toContain(cover)
  if (mode === 'default-unit-chord-only') expect(rectangleEmissionElements(drawing.svg).find(element => element.name === 'marker')!.attributes.markerUnits).toBeUndefined()
  const fontFiles = [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url))]
  const raster = (svg: string) => new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().pixels
  const withoutCover = drawing.svg.replace(cover, '')
  expect(Buffer.compare(raster(withoutCover), raster(withoutCover.replace(markerEnd, '')))).not.toBe(0)
  if (mode === 'far-viewport') {
    // The shaft/control hull ends before x98, but the actual westward arrow
    // at x95 extends to x103. The harmless card stays within x9.5..20.5.
    // A viewport-only diagnostic exposes clipped ink; every comparison still
    // uses the whole image and its own same-size marker-absent companion.
    const markerPixels = (svg: string) => {
      const actual = raster(svg), absent = raster(svg.replace(markerEnd, ''))
      let count = 0
      for (let index = 0; index < actual.length; index += 4) if (actual[index] !== absent[index] || actual[index + 1] !== absent[index + 1] || actual[index + 2] !== absent[index + 2] || actual[index + 3] !== absent[index + 3]) count++
      return count
    }
    const root = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'
    expect(drawing.svg.split(root)).toHaveLength(2)
    const expanded = drawing.svg.replace(root, '<svg xmlns="http://www.w3.org/2000/svg" width="110" height="80">')
    expect(markerPixels(drawing.svg)).toBeGreaterThan(0)
    expect(markerPixels(expanded)).toBeGreaterThan(markerPixels(drawing.svg))
  } else {
    // The later card removes every contribution from the nonempty marker.
    expect(Buffer.compare(raster(drawing.svg), raster(drawing.svg.replace(markerEnd, '')))).toBe(0)
  }
  expect(drawing.proof.status).not.toBe('passed')
  if (drawing.admitted && mode === 'chord-only') {
    const node = drawing.admitted.parts.find(part => part.kind === 'connector')
    if (node?.kind !== 'connector' || node.route.geometry.kind !== 'path') throw new Error('Expected the actual admitted cubic')
    const forged = createSceneWriteCapture(MAX_OCCLUSION_OPERATIONS)
    // An arbitrary caller cannot turn the cached hidden cubic into a claimed
    // eastward line by supplying a fabricated geometry-write event.
    const observer: unknown = Reflect.get(forged, 'observe')
    if (typeof observer === 'function') {
      try {
        Reflect.apply(observer, undefined, [node, node.route.geometry, { ...node.route.geometry, d: 'M20 40 L60 40' }, sceneNodeSerialization(node)])
      } catch {
        // Refusing direct invocation before a receipt exists is also sound.
      }
    }
    expect(certifyScenePaint(drawing.admitted, undefined, { sceneWriteReceipt: forged.finish(drawing.admitted) }).status).not.toBe('passed')
  }
})

test.each(([
  { name: 'cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'default-unit-collapsed-cubic', d: 'M20.00000000000001 40 C20 40 60 40 60 40', start: { x: 20.00000000000001, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'unstable-default-unit-cubic', d: 'M20.00000000000001 40 C20 40 60 40 60 40', start: { x: 20.00000000000001, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'collapsed-last-control', d: 'M20 40 C20 40 60 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'reversed-cubic', d: 'M80 40 C80 40 60 40 40 40', start: { x: 80, y: 40 }, end: { x: 40, y: 40 }, tangent: { x: -1, y: 0 }, cardX: 10, witnessX: 46 },
  { name: 'quadratic', d: 'M20 40 Q40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'smooth-cubic', d: 'M20 40 C20 40 30 40 40 40 S50 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'smooth-quadratic', d: 'M20 40 Q30 40 40 40 T60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'relative-cubic', d: 'M20 40 c0 0 20 0 40 0', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'stylesheet-hidden-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'resource-hidden-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'undefined-root-color-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'custom-root-color-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'custom-root-cover-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'custom-root-unused-resource-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'legacy-unused-resource-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'declared-unused-resource-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'unused-child-id-shadow-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'unused-primitive-id-shadow-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'earlier-title-id-shadow-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'earlier-description-id-shadow-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'distinct-title-id-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'distinct-description-id-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
  { name: 'optional-palette-transparent-cubic', d: 'M20 40 C20 40 40 40 60 40', start: { x: 20, y: 40 }, end: { x: 60, y: 40 }, tangent: { x: 1, y: 0 }, cardX: 60, witnessX: 54 },
] as const).flatMap(row => (['native', 'scene'] as const).map(execution => ({ ...row, execution }))))('a $name binds emitted endpoint certification to actual ink through $execution', ({ name, d, start, end, tangent, cardX, witnessX, execution }) => {
  // These authored open paths all end due east, except the reversed cubic.
  // The exact terminal triangle is (52,37.5),(60,40),(52,42.5), or
  // (48,42.5),(40,40),(48,37.5) when reversed. It lies outside the card.
  const undefinedRootColor = name === 'undefined-root-color-cubic'
  const unusedRootResource = name === 'custom-root-unused-resource-cubic', optionalPaletteTransparent = name === 'optional-palette-transparent-cubic'
  const legacyUnusedResource = name === 'legacy-unused-resource-cubic', declaredUnusedResource = name === 'declared-unused-resource-cubic'
  const unusedResource = unusedRootResource || legacyUnusedResource || declaredUnusedResource
  const shadowPolygon = '<polygon id="visible-terminal" points="0 0, 1 0, 0 1" fill="#000" />'
  const shadow = name === 'unused-child-id-shadow-cubic' ? `<marker id="unused-terminal" markerWidth="1" markerHeight="1" refX="0" refY="0">${shadowPolygon}</marker>`
    : name === 'unused-primitive-id-shadow-cubic' ? shadowPolygon : ''
  const documentElement = name === 'earlier-title-id-shadow-cubic' || name === 'distinct-title-id-cubic' ? 'title' : name === 'earlier-description-id-shadow-cubic' || name === 'distinct-description-id-cubic' ? 'description' : undefined
  const documentIdCollision = name === 'earlier-title-id-shadow-cubic' || name === 'earlier-description-id-shadow-cubic'
  const documentDomId = documentIdCollision ? 'visible-terminal' : 'document-accessibility'
  const documentTag = documentElement === 'title' ? 'title' : 'desc'
  const documentMarkup = documentElement ? `<${documentTag} id="${documentDomId}">Accessible drawing</${documentTag}>` : ''
  const customRootColor = name === 'custom-root-color-cubic' || unusedRootResource, customRootCover = name === 'custom-root-cover-cubic'
  const customRoot = customRootColor || customRootCover
  const defaultUnit = name === 'default-unit-collapsed-cubic' || name === 'unstable-default-unit-cubic'
  const unstableDefaultUnit = name === 'unstable-default-unit-cubic'
  const hidden = name === 'stylesheet-hidden-cubic' || name === 'resource-hidden-cubic' || undefinedRootColor || customRootCover || optionalPaletteTransparent || shadow !== ''
  const stylesheet = '<style>path{marker-end:none !important}</style>'
  const markerFill = customRootColor ? 'var(--ink, #000)' : optionalPaletteTransparent ? 'var(--accent, #000)' : legacyUnusedResource || declaredUnusedResource ? '#f00' : '#000'
  const marker = tipAnchoredArrow('visible-terminal', { width: 8, height: 5 }, 'end', undefinedRootColor ? { fill: 'none', stroke: 'var(--fg)', strokeWidth: '1' } : { fill: markerFill, stroke: 'none' }, defaultUnit ? undefined : 'userSpaceOnUse')
  const unusedMarker = { ...marker, id: 'unused-terminal' }
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#000', ...(optionalPaletteTransparent ? { accent: 'transparent' } : {}) }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...scene([]), colors: context.colors, parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"${customRoot || optionalPaletteTransparent ? ` style="--bg:#fff;--fg:#000;${customRootColor ? '--ink:#f00' : customRootCover ? '--cover:#fff' : '--accent:transparent'}"` : ''}>`),
    ...(documentElement ? [factory.documentText({ id: 'document-accessibility', element: documentElement, text: 'Accessible drawing', domId: documentDomId })] : []),
    factory.definitions({ id: 'defs', ...(declaredUnusedResource ? { markerResources: [marker, unusedMarker] } : {}) }, `<defs>${name === 'resource-hidden-cubic' ? serializeMarkerResource(marker).replace('<polygon ', '<polygon opacity="0" ') : serializeMarkerResource(marker)}${unusedResource ? serializeMarkerResource(unusedMarker) : ''}${shadow}</defs>`),
    ...(name === 'stylesheet-hidden-cubic' ? [factory.documentContent({ id: 'css', role: 'chrome', nonPaint: 'stylesheet' }, stylesheet)] : []),
    factory.connector({ id: 'visible-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'path', d, points: [start, end] },
      paint: { stroke: '#000', strokeWidth: unstableDefaultUnit ? '1.00000000000001' : '1', strokeLinecap: 'butt', strokeLinejoin: 'round' }, endpoints: { from: 'outside', to: 'card' }, markers: { end: marker } }),
    factory.shape({ id: 'card', role: 'node', geometry: { kind: 'rect', x: cardX, y: 20, width: 30, height: 40 }, paint: { fill: '#fff', stroke: '#888', strokeWidth: '1' } }),
    ...(customRootCover ? [factory.shape({ id: 'foreign-cover', role: 'node', geometry: { kind: 'rect', x: 50, y: 34, width: 12, height: 12 }, paint: { fill: 'var(--cover, transparent)' } })] : []),
    factory.documentClose(),
  ] })
  const drawing = drawPaintControl(producer, context, execution)
  expect(drawing.svg).toContain(`d="${defaultUnit ? 'M20 40 C20 40 60 40 60 40' : d}"`)
  if (defaultUnit) {
    const elements = rectangleEmissionElements(drawing.svg)
    expect(elements.find(element => element.name === 'marker')!.attributes.markerUnits).toBeUndefined()
    expect(elements.find(element => element.attributes['data-id'] === 'visible-edge')!.attributes['stroke-width']).toBe('1')
  }
  if (documentMarkup) {
    expect(drawing.svg.split(documentMarkup)).toHaveLength(2)
    expect(drawing.svg.split(' id="visible-terminal"')).toHaveLength(documentIdCollision ? 3 : 2)
    expect(drawing.svg.indexOf(documentMarkup)).toBeLessThan(drawing.svg.indexOf('<defs>'))
  }
  const markerEnd = ' marker-end="url(#visible-terminal)"'
  const markerPolygon = undefinedRootColor ? 'points="0 0, 8 2.5, 0 5" fill="none" stroke="var(--fg)" stroke-width="1"' : `points="0 0, 8 2.5, 0 5" fill="${markerFill}" stroke="none"`
  expect(drawing.svg.split(markerEnd)).toHaveLength(2)
  expect(drawing.svg.split(markerPolygon)).toHaveLength(unusedResource ? 3 : 2)
  if (unusedResource || shadow) {
    if (shadow) expect(drawing.svg.split(shadow)).toHaveLength(2)
    if (name !== 'unused-primitive-id-shadow-cubic') expect(drawing.svg).toContain('<marker id="unused-terminal"')
    expect(drawing.svg).not.toContain('url(#unused-terminal)')
  }
  expect(drawing.svg).toContain(`<rect x="${cardX}" y="20" width="30" height="40" fill="#fff" stroke="#888" stroke-width="1"`)
  if (customRootColor) expect(marker.paint?.fill).toBe('var(--ink, #000)')
  if (customRootCover) expect(drawing.svg).toContain('fill="var(--cover, transparent)"')
  // Public graphical rendering applies this real postpass after certification.
  // Keep typed variables intact while observing the actual served colors.
  const svg = customRoot || optionalPaletteTransparent ? inlineResolvedColors(drawing.svg, context.colors) : drawing.svg
  const font = { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter' }
  const actual = new Resvg(svg, { font }).render()
  const markerRemoved = new Resvg(svg.replace(markerEnd, ''), { font }).render()
  if (hidden) {
    expect(Buffer.compare(actual.pixels, markerRemoved.pixels)).toBe(0)
    const covers = [...svg.matchAll(/<rect\b[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(' data-id="foreign-cover"'))
    if (customRootCover) expect(covers).toHaveLength(1)
    const transparentPolygon = 'points="0 0, 8 2.5, 0 5" fill="transparent" stroke="none"'
    if (optionalPaletteTransparent) expect(svg).toContain(transparentPolygon)
    const exposed = shadow ? svg.replace(shadow, '') : customRootCover ? svg.replace(covers[0]!, '') : optionalPaletteTransparent ? svg.replace(transparentPolygon, 'points="0 0, 8 2.5, 0 5" fill="#000" stroke="none"') : svg.replace(stylesheet, '').replace('<polygon opacity="0" ', '<polygon ').replace('stroke="var(--fg)"', 'stroke="#000"')
    expect(Buffer.compare(new Resvg(exposed, { font }).render().pixels, new Resvg(exposed.replace(markerEnd, ''), { font }).render().pixels)).not.toBe(0)
    if (shadow) {
      const restored = new Resvg(exposed.replace(markerPolygon, 'points="0 0, 8 2.5, 0 5" fill="#f00" stroke="none"'), { font }).render()
      const witness = (40 * restored.width + witnessX) * 4
      expect(restored.pixels[witness]).toBeGreaterThan(128)
      expect(restored.pixels[witness + 1]).toBeLessThan(64)
      expect(restored.pixels[witness + 2]).toBeLessThan(64)
    }
  } else expect(Buffer.compare(actual.pixels, markerRemoved.pixels)).not.toBe(0)
  if (customRootColor || legacyUnusedResource || declaredUnusedResource) {
    const pixels = actual.pixels, witness = (40 * actual.width + witnessX) * 4
    expect(pixels[witness]).toBeGreaterThan(128)
    expect(pixels[witness + 1]).toBeLessThan(64)
    expect(pixels[witness + 2]).toBeLessThan(64)
  } else if (!undefinedRootColor && !optionalPaletteTransparent) {
    const red = new Resvg(svg.replace(markerPolygon, 'points="0 0, 8 2.5, 0 5" fill="#f00" stroke="none"'), { font }).render()
    const pixels = red.pixels
    const witness = (40 * red.width + witnessX) * 4
    if (hidden) {
      let redPixels = 0
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index]! > 128 && pixels[index + 1]! < 64 && pixels[index + 2]! < 64 && pixels[index + 3]! > 0) redPixels++
      expect(redPixels).toBe(0)
    } else {
      expect(pixels[witness]).toBeGreaterThan(128)
      expect(pixels[witness + 1]).toBeLessThan(64)
      expect(pixels[witness + 2]).toBeLessThan(64)
    }
  }
  const source = paintPrimitiveSource(drawing.paint.primitives.find(primitive => primitive.id === 'visible-edge')!)
  if (source?.kind !== 'connector') throw new Error('Expected retained visible connector')
  // Retained metadata must preserve this authored route. Actual served pose
  // is checked independently by full-image marker removal and red ink above.
  expect(source.route.contours[0]?.end).toEqual(end)
  expect(source.route.endTangent).toEqual(tangent)
  const proof = drawing.proof
  if (customRootCover) {
    expect(proof.status).toBe('failed')
    expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'visible-edge', by: 'foreign-cover' }))
  } else if (unusedRootResource || legacyUnusedResource || shadow || documentIdCollision) {
    // Document IDs also own URL lookup: earlier title/desc collisions hide
    // these heads in Chromium, although Resvg retains their visible ink.
    // Declared canonical unused resources retain their own authority.
    expect(proof.status).toBe('unverified')
    expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'OUTPUT_SCOPE' }))
  } else if (hidden || unstableDefaultUnit) expect(proof.status).not.toBe('passed')
  else {
    expect(proof.status).toBe('passed')
    expect(proof.issues).toEqual([])
  }
  if (execution === 'scene' && name === 'cubic') {
    const { admitted, raw, receipt } = drawing
    if (!admitted || !raw || !receipt) throw new Error('Expected an actual admitted Scene write')
    expect(certifyScenePaint(admitted).status).not.toBe('passed')
    expect(certifyScenePaint({ ...admitted, width: 101 }, undefined, { sceneWriteReceipt: receipt }).status).not.toBe('passed')
    const foreign = drawPaintControl(producer, context, 'scene')
    if (!foreign.admitted || !foreign.receipt) throw new Error('Expected an independently admitted Scene write')
    expect(foreign.svg).toBe(drawing.svg)
    expect(certifyScenePaint(admitted, undefined, { sceneWriteReceipt: foreign.receipt }).status).not.toBe('passed')
    expect(certifyScenePaint(foreign.admitted, undefined, { sceneWriteReceipt: receipt }).status).not.toBe('passed')
    const cached = createSceneWriteCapture(MAX_OCCLUSION_OPERATIONS)
    expect(admitSceneDocument(admitted, 'internal', true, cached.observe)).toBe(admitted)
    expect(DefaultBackend.render(admitted, { seed: 0 })).toBe(drawing.svg)
    expect(certifyScenePaint(admitted, undefined, { sceneWriteReceipt: cached.finish(admitted) }).status).not.toBe('passed')
    const mutable = raw.parts.find(node => node.kind === 'connector')
    if (mutable?.kind !== 'connector' || mutable.route.geometry.kind !== 'path') throw new Error('Expected the authored source path')
    mutable.route.geometry.d = 'M20 40 C20 40 60.1 40 60 40'
    expect(DefaultBackend.render(admitted, { seed: 0 })).toBe(drawing.svg)
    expect(certifyScenePaint(admitted, undefined, { sceneWriteReceipt: receipt }).status).toBe('passed')
    expect(certifyScenePaint(raw, undefined, { sceneWriteReceipt: receipt }).status).not.toBe('passed')
  }
})

test('an unsupported arc keeps emitted terminal ink and refuses an unproved path tangent', () => {
  const marker = tipAnchoredArrow('arc-terminal', { width: 8, height: 5 }, 'end', { fill: '#000', stroke: 'none' }, 'userSpaceOnUse')
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#000' }, resolved: { renderOptions: {} } }
  const drawing = drawNative(factory => ({ ...scene([]), colors: context.colors, parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
    factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector({ id: 'arc-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'path', d: 'M20 40 A20 20 0 0 1 60 40', points: [{ x: 20, y: 40 }, { x: 60, y: 40 }] }, paint: { stroke: '#000', strokeWidth: '1' }, markers: { end: marker } }),
    factory.documentClose(),
  ] }), context, 'flowchart')
  expect(drawing.svg).toContain('d="M20 40 A20 20 0 0 1 60 40"')
  const markerEnd = ' marker-end="url(#arc-terminal)"'
  expect(drawing.svg.split(markerEnd)).toHaveLength(2)
  const font = { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter' }
  expect(Buffer.compare(new Resvg(drawing.svg, { font }).render().pixels, new Resvg(drawing.svg.replace(markerEnd, ''), { font }).render().pixels)).not.toBe(0)
  expect(certifyNativePaint(drawing.header, drawing.paint).status).toBe('unverified')
})

test.each(['full', 'compound', 'fill-opacity-zero', 'thin', 'partial', 'repaint', 'dashed', 'translucent', 'unknown-width', 'unknown-opacity', 'non-scaling', 'scaled', 'rotated', 'sheared', 'circle', 'ellipse', 'polygon', 'marker-none', 'marker-unknown'] as const)('%s endpoint stroke cannot hide a fully covered marker behind its contact exemption', mode => {
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: mode === 'marker-none' ? 'none' : mode === 'marker-unknown' ? 'var(--unknown)' : '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const geometry: Geometry = mode === 'circle' ? { kind: 'circle', cx: 60, cy: 40, r: 20 } : mode === 'ellipse' ? { kind: 'ellipse', cx: 70, cy: 40, rx: 30, ry: 20 } : mode === 'polygon' ? { kind: 'polygon', points: [{ x: 40, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 70 }, { x: 40, y: 70 }] } : { kind: 'rect', x: 40, y: 10, width: 50, height: 60 }
  const paint: MarkPaint = { fill: '#fff', stroke: '#fff', strokeWidth: mode === 'thin' ? '1' : mode === 'partial' ? '4' : mode === 'unknown-width' ? 'var(--unknown,20)' : '20',
    ...(mode === 'fill-opacity-zero' ? { fillOpacity: '0' } : {}),
    ...(mode === 'dashed' ? { strokeDasharray: '4 4' } : {}),
    ...(mode === 'translucent' ? { strokeOpacity: '0.5' } : mode === 'unknown-opacity' ? { strokeOpacity: 'var(--unknown,1)' } : {}),
    ...(mode === 'non-scaling' ? { vectorEffect: 'non-scaling-stroke' as const } : {}),
  }
  const transform: SceneTransform | undefined = mode === 'scaled' ? { kind: 'matrix', a: 2, b: 0, c: 0, d: 2, e: -40, f: -40 }
    : mode === 'rotated' ? { kind: 'rotate', angle: 45, cx: 40, cy: 40 }
      : mode === 'sheared' ? { kind: 'matrix', a: 1, b: 0.3, c: 0, d: 1, e: 0, f: -12 } : undefined
  const producer: DrawingProducer = factory => {
    const fields = { id: 'edge', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 20, y1: 40, x2: 40, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'node', end: { owner: { id: 'node', role: 'node' as const }, point: { x: 40, y: 40 } } }, markers: { end: marker } }
    return { ...scene([]), parts: [
      factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
      factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
      factory.connector(fields),
      factory.shape({ id: 'node', role: 'node', geometry: mode === 'compound' ? { kind: 'compound', children: [{ kind: 'rect', x: 80, y: 10, width: 10, height: 10 }, geometry] } : geometry, paint: mode === 'compound' ? { fill: 'none' } : paint, ...(mode === 'compound' ? { childPaints: [{ fill: '#fff' }, paint] } : {}), ...(transform ? { transform } : {}) }),
      ...(mode === 'repaint' ? [factory.connector({ ...fields, id: 'repaint', role: 'chrome', owner: { id: 'edge', role: 'edge' } })] : []),
      factory.documentClose(),
    ] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain('stroke="#fff"')
  // Actual triangle bounds [32,40]×[37.5,42.5] lie entirely within the
  // opaque20px left stroke band [30,50]×[10,70], without being in the fill.
  const expected = mode === 'full' || mode === 'compound' || mode === 'fill-opacity-zero' ? 'failed' : mode === 'thin' || mode === 'partial' || mode === 'repaint' ? 'passed' : 'unverified'
  for (const proof of [certifyScenePaint(producer(marks, context)), certifyNativePaint(drawing.header, drawing.paint)]) {
    expect(proof.status).toBe(expected)
    if (expected === 'failed') expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'edge', by: 'node' }))
  }
})

test.each([
  { markerKind: 'triangle', x: 35, singular: true },
  { markerKind: 'triangle', x: 45, singular: true },
  { markerKind: 'triangle', x: 45, singular: false },
  { markerKind: 'circle', x: 45, singular: false },
  { markerKind: 'cross', x: 45, singular: false },
  { markerKind: 'cross-non-scaling', x: 45, singular: false },
  { markerKind: 'none', x: 55, singular: false },
  { markerKind: 'unknown', x: 55, singular: false },
] as const)('$markerKind marker ancestor singular=$singular at x=$x retains world measurement evidence', ({ markerKind, x, singular }) => {
  const noInkProof = markerKind === 'none' || markerKind === 'unknown'
  const unsupportedInk = noInkProof || markerKind === 'cross-non-scaling'
  const marker: MarkerDescriptor = markerKind === 'triangle' || noInkProof ? tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: markerKind === 'none' ? 'none' : markerKind === 'unknown' ? 'var(--unknown)' : '#000' }, 'userSpaceOnUse')
    : { id: 'arrow', shape: markerKind === 'circle' ? 'circle' : 'cross', size: { width: 4, height: 4 }, ref: { x: 2, y: 2 }, units: 'userSpaceOnUse', orient: 0, overflow: 'visible', geometry: markerKind === 'circle' ? { kind: 'circle', cx: 2, cy: 2, r: 2 } : { kind: 'path', d: 'M0,2 L4,2 M2,0 L2,4' }, paint: markerKind === 'circle' ? { fill: '#000' } : { fill: 'none', stroke: '#000', strokeWidth: '1', ...(markerKind === 'cross-non-scaling' ? { vectorEffect: 'non-scaling-stroke' as const } : {}) } }
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const a = singular ? 0 : 1, e = singular ? x : x - 40
  const producer: DrawingProducer = factory => ({ ...scene([]), parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
    factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.group({ id: 'ancestor', role: 'chrome', transform: { kind: 'matrix', a, b: 0, c: 0, d: 1, e, f: 0 }, open: `<g transform="matrix(${a} 0 0 1 ${e} 0)">`, close: '</g>', children: [{ node: factory.connector({ id: 'edge', role: 'chrome', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 40, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'node' }, markers: { end: marker } }), indent: 0 }] }),
    factory.shape({ id: 'node', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 50, height: 60 }, paint: { fill: '#fff', stroke: '#fff', strokeWidth: '20' } }),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain(`matrix(${a} 0 0 1 ${e} 0)`)
  // A singular ancestor collapses the triangle to x=35 in the stroke band,
  // or x=45 inside the fill. Neither has positive-area marker ink evidence.
  for (const proof of [certifyScenePaint(producer(marks, context)), certifyNativePaint(drawing.header, drawing.paint)]) {
    expect(proof.status).toBe(singular || unsupportedInk ? 'unverified' : 'failed')
    if (singular) {
      expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'UNMEASURED_PAINT', id: 'edge' }))
      expect(proof.issues.some(issue => issue.code === 'MARKER_OCCLUDED')).toBe(false)
    } else if (unsupportedInk) expect(proof.issues.some(issue => issue.code === 'MARKER_OCCLUDED')).toBe(false)
    else expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'edge', by: 'node' }))
  }
})

test.each([
  { opacity: ['1'], status: 'failed' },
  { opacity: ['1', '1'], status: 'failed' },
  { opacity: ['0.5'], status: 'passed' },
  { opacity: ['2', '0.5'], status: 'passed' },
  { opacity: ['-1', '-1'], status: 'passed' },
  { opacity: ['var(--unknown,0.5)'], status: 'unverified' },
  { opacity: ['var(--unknown,0.5)', '0'], status: 'passed' },
] as const)('group opacity $opacity preserves actual occluder certainty', ({ opacity, status }) => {
  const cover = opacity.reduce<SceneNode>((node, value, index) => marks.group({ id: `opacity:${index}`, role: 'chrome', open: '<g>', close: '</g>', paint: { opacity: value }, children: [{ node, indent: 0 }] }), surface())
  expect(sceneNodeSerialization(cover)).toContain(`opacity="${opacity.at(-1)}"`)
  expect(certifyScenePaint(scene([label(), cover])).status).toBe(status)
})

test.each(['1', '0.5', 'var(--unknown,0)', 'conditional', 'conditional-unrelated', '-1'] as const)('a later %s marker carrier preserves repaint certainty in both paint producers', opacity => {
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse')
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const fields = { id: 'relationship', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 20, y1: 30, x2: 30, y2: 30 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } }
    const repaint = factory.connector({ ...fields, id: opacity === 'conditional-unrelated' ? 'unrelated' : 'repaint', role: opacity === 'conditional-unrelated' ? 'edge' : 'chrome', owner: { id: opacity === 'conditional-unrelated' ? 'unrelated' : 'relationship', role: 'edge' } })
    return { ...scene([]), parts: [
      factory.documentOpen({ id: 'root', width: 100, height: 80, colors: { bg: '#fff', fg: '#111' }, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
      factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
      factory.connector(fields),
      factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 80, height: 60 }, paint: { fill: '#fff' } }),
      factory.group({ id: 'repaint-group', role: 'chrome', open: '<g>', close: '</g>', ...(opacity.startsWith('conditional') ? { visibility: 'conditional' as const } : { paint: { opacity } }), children: [{ node: repaint, indent: 0 }] }),
      factory.documentClose(),
    ] }
  }
  const lowered = producer(marks, context)
  const expected = opacity === 'conditional' || opacity.startsWith('var(') ? 'unverified' : opacity === '-1' || opacity === 'conditional-unrelated' ? 'failed' : 'passed'
  expect(certifyScenePaint(lowered).status).toBe(expected)
  // Out-of-range alpha is refused by native admission; the direct inspector
  // above still must follow the SVG clamp semantics for its typed input.
  if (opacity === '-1') return
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain('marker-end="url(#arrow)"')
  expect(certifyNativePaint(drawing.header, drawing.paint).status).toBe(expected)
})

test.each(['1', 'var(--unknown,0.5)'])('native group opacity %s admits only certain opaque occluders', opacity => {
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const cover = factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 80, height: 60 }, paint: { fill: '#fff' } })
    return { ...scene([]), parts: [
      factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
      factory.text({ id: 'text', role: 'label', text: 'Read', block: preparePixelText('Read', { fontSize: 12, fontWeight: 400 }), x: 40, y: 50, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }),
      factory.group({ id: 'cover-group', role: 'chrome', open: '<g>', close: '</g>', paint: { opacity }, children: [{ node: cover, indent: 0 }] }),
      factory.documentClose(),
    ] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain(`opacity="${opacity}"`)
  expect(certifyNativePaint(drawing.header, drawing.paint).status).toBe(opacity === '1' ? 'failed' : 'unverified')
})

test.each([
  { first: { fill: 'rgba(255,255,255,0.5)' }, second: { fill: '#fff' }, status: 'failed' },
  { first: { fill: '#fff', fillOpacity: '0' }, second: { fill: '#fff' }, status: 'failed' },
  { first: { fill: '#fff', opacity: '0' }, second: { fill: '#fff' }, status: 'failed' },
  { first: { fill: 'none' }, second: { fill: '#fff' }, status: 'failed' },
  { first: { fill: '#fff' }, second: { fill: 'rgba(255,255,255,0.5)' }, status: 'passed' },
  { first: { fill: '#fff' }, second: { fill: '#fff', fillOpacity: '0' }, status: 'passed' },
  { first: { fill: '#fff' }, second: { fill: '#fff', fillOpacity: 'var(--unknown,0.5)' }, status: 'unverified' },
  { first: { fill: '#fff' }, second: { fill: '#fff', opacity: 'var(--unknown,0.5)' }, status: 'unverified' },
  { first: { fill: '#fff' }, second: { stroke: 'none' }, status: 'unverified' },
] satisfies Array<{ first: MarkPaint; second: MarkPaint; status: 'passed' | 'failed' | 'unverified' }>)('compound child fills $first / $second retain independent occluder evidence', ({ first, second, status }) => {
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse')
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...scene([]), parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
    factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 30, x2: 30, y2: 30 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } }),
    factory.text({ id: 'text', role: 'label', text: 'Read', block: preparePixelText('Read', { fontSize: 12, fontWeight: 400 }), x: 40, y: 50, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }),
    factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'compound', children: [{ kind: 'rect', x: 80, y: 10, width: 10, height: 10 }, { kind: 'rect', x: 10, y: 10, width: 60, height: 60 }] }, paint: { fill: 'none', opacity: '0' }, childPaints: [first, second] }),
    factory.documentClose(),
  ] })
  const lowered = producer(marks, context)
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain('<rect x="10" y="10" width="60" height="60"')
  for (const proof of [certifyScenePaint(lowered), certifyNativePaint(drawing.header, drawing.paint)]) {
    expect(proof.status).toBe(status)
    // The entire actual triangle and prepared text are inside child1. A
    // translucent or absent sibling cannot erase this opaque child's ink.
    if (status === 'failed') {
      expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'edge', by: 'cover' }))
      expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'TEXT_OCCLUDED', id: 'text', by: 'cover' }))
    }
  }
})

test.each(['unfilled-rect', 'filled-rect', 'unfilled-polygon', 'stroke-only-compound', 'standalone-unfilled-rect', 'standalone-line', 'standalone-clear-line', 'clear-rect'] as const)('%s child strokes retain their full outer ink envelope', mode => {
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse')
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const clear = mode === 'clear-rect' || mode === 'standalone-clear-line'
  const standalone = mode.startsWith('standalone')
  const geometry: Geometry = mode === 'unfilled-polygon' ? { kind: 'polygon', points: [{ x: 40, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 70 }, { x: 40, y: 70 }] } : mode.endsWith('line') ? { kind: 'line', x1: 40, y1: 10, x2: 40, y2: 70 } : { kind: 'rect', x: 40, y: 10, width: 30, height: 60 }
  const strokePaint = { fill: mode === 'filled-rect' ? '#fff' : 'none', stroke: '#111', strokeWidth: '20' }
  const producer: DrawingProducer = factory => ({ ...scene([]), parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
    factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector({ id: 'edge', role: 'chrome', lineStyle: 'solid', geometry: { kind: 'line', x1: 5, y1: 30, x2: clear ? 20 : 39, y2: 30 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'another' }, markers: { end: marker } }),
    factory.shape({ id: 'cover', role: 'node', geometry: standalone ? geometry : { kind: 'compound', children: [{ kind: 'rect', x: 80, y: 10, width: 10, height: 10 }, geometry] }, paint: standalone ? strokePaint : { fill: 'none' }, ...(!standalone ? { childPaints: [{ fill: mode === 'stroke-only-compound' ? 'none' : '#fff' }, strokePaint] } : {}) }),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain('stroke-width="20"')
  // Marker x=31..39 lies wholly in the left stroke band x=30..50,
  // although it is outside the rectangle's fill beginning at x=40. Exact
  // continuous rectangle bands prove coverage; polygon/line bounds alone do not.
  if (mode === 'unfilled-rect') {
    const reference = ' marker-end="url(#arrow)"'
    const cover = '<rect x="40" y="10" width="30" height="60" fill="none" stroke="#111" stroke-width="20" />'
    expect(drawing.svg.split(reference)).toHaveLength(2)
    expect(drawing.svg.split(cover)).toHaveLength(2)
    expect(rectangleEmissionElements(drawing.svg).find(element => element.attributes['marker-end'] === 'url(#arrow)')!.attributes).toMatchObject({ x1: '5', y1: '30', x2: '39', y2: '30', stroke: '#111', 'stroke-width': '1' })
    expect(drawing.paint.primitives.find(primitive => primitive.id === 'edge')!.role).toBe('chrome')
    const pixels = (svg: string) => new Resvg(svg).render().pixels
    expect(Buffer.compare(pixels(drawing.svg), pixels(drawing.svg.replace(reference, '')))).toBe(0)
    const withoutCover = drawing.svg.replace(cover, '')
    expect(Buffer.compare(pixels(withoutCover), pixels(withoutCover.replace(reference, '')))).not.toBe(0)
  }
  const expected = clear ? 'passed' : mode === 'unfilled-polygon' || mode === 'standalone-line' ? 'unverified' : 'failed'
  expect(certifyScenePaint(producer(marks, context)).status).toBe(expected)
  expect(certifyNativePaint(drawing.header, drawing.paint).status).toBe(expected)
})

test('the Ishikawa spine declares its actual effect-head contact', () => {
  const request = resolveRenderRequestForExecution(getFamily('ishikawa')!.example, {}, 'svg')
  const positioned = positionResolvedFamily('ishikawa', request)
  const inspection = inspectScenePrimitives(lowerPositionedFamilyScene(request, positioned))
  const spine = scenePrimitiveSource(inspection.primitives.find(primitive => primitive.id === 'spine')!)!
  const effect = (positioned.positioned as PositionedIshikawa).nodes.find(node => node.depth === 0)!
  if (spine.kind !== 'connector') throw new Error('Expected the native effect spine')
  if (spine.route.geometry.kind !== 'polyline') throw new Error('Expected the native polyline spine')
  const last = spine.route.geometry.points.at(-1)!
  expect(last).toEqual({ x: effect.x, y: effect.y + effect.height / 2 })
  expect(spine.endpoints).toMatchObject({ to: effect.node.id, end: { owner: { id: effect.node.id, role: 'node' }, point: last } })
  const first = spine.route.geometry.points[0]!
  expect(sceneNodeSerialization(spine)).toContain(`points="${first.x},${first.y} ${effect.x},${effect.y + effect.height / 2}"`)
})

test.each(['transparent', 'translucent', 'dashed', 'group-opacity', 'compound-piece'] as const)('%s outlines cannot certify the filled endpoint border band as visible', mode => {
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse')
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 40, x2: 40.4, y2: 40 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'node' }, markers: { end: marker } })
  const geometry = { kind: 'rect' as const, x: 40, y: 10, width: 50, height: 60 }
  const paint: MarkPaint = { fill: '#fff', stroke: '#111', strokeWidth: '10', ...(mode === 'dashed' ? { strokeDasharray: '1 100' } : mode === 'transparent' || mode === 'translucent' ? { strokeOpacity: mode === 'transparent' ? '0' : '0.5' } : {}) }
  const card = marks.shape({ id: 'node', role: 'node', geometry: mode === 'compound-piece' ? { kind: 'compound', children: [geometry] } : geometry, paint: mode === 'group-opacity' ? { fill: '#fff' } : paint, ...(mode === 'compound-piece' ? { childPaints: [{ fill: '#fff', stroke: 'none' }] } : {}) })
  const parts: SceneNode[] = [edge, card]
  if (mode === 'group-opacity') {
    const outline = marks.shape({ id: 'outline', role: 'node', owner: { id: 'node', role: 'node' }, geometry, paint: { ...paint, fill: 'none' } })
    parts.push(marks.group({ id: 'translucent-outline', role: 'chrome', open: '<g>', close: '</g>', paint: { opacity: '0.5' }, children: [{ node: outline, indent: 0 }] }))
  }
  // The triangle tip enters the opaque fill by 0.4px. A transparent,
  // translucent or dashed outline supplies no continuous opaque border band.
  const emitted = parts.map(sceneNodeSerialization).join('\n')
  expect(emitted).toContain(mode === 'dashed' ? 'stroke-dasharray="1 100"' : mode === 'group-opacity' ? '<g opacity="0.5">' : mode === 'compound-piece' ? 'stroke="none"' : `stroke-opacity="${paint.strokeOpacity}"`)
  expect(certifyScenePaint(scene(parts))).toMatchObject({ status: 'unverified', issues: [expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'edge', by: 'node' })] })
})

test('separated leaves cannot evade the final occlusion traversal budget', () => {
  const parts: SceneNode[] = [], count = 2048
  for (let i = 0; i < count; i++) {
    const y = Math.floor(i / 8) % 2 === 0 ? 100 : -100
    parts.push(marks.shape({ id: `surface:${i}`, role: 'node', geometry: { kind: 'rect', x: 0, y, width: 1000, height: 10 }, paint: { fill: '#fff' } }))
  }
  const block = preparePixelText('X', { fontSize: 12, fontWeight: 400 })
  for (let i = 0; i < count; i++) parts.push(marks.text({ id: `text:${i}`, role: 'label', text: 'X', block, x: 500, y: 0, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }))
  const proof = certifyScenePaint({ ...scene(parts), width: 1000, height: 200 })
  expect(proof.status).toBe('unverified')
  expect(proof.checks.occlusionPairs).toBe(0)
  expect(proof.checks.operations).toBeLessThanOrEqual(proof.checks.maxOperations)
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'CHECK_BUDGET' }))
})


test('self-crossing filled polygons cannot prove that an overlapped marker is visible', () => {
  const points = [0, 2, 4, 1, 3].map(i => ({ x: 50 + 45 * Math.cos(-Math.PI / 2 + 2 * Math.PI * i / 5), y: 50 + 45 * Math.sin(-Math.PI / 2 + 2 * Math.PI * i / 5) }))
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 40, y1: 15, x2: 50, y2: 15 }, paint: { stroke: '#111' }, markers: { end: { id: 'arrow', shape: 'arrow', bounds: { x0: -1, y0: -1, x1: 1, y1: 1 }, units: 'userSpaceOnUse' } } })
  const cover = marks.shape({ id: 'star', role: 'node', geometry: { kind: 'polygon', points }, paint: { fill: '#fff' } })
  const proof = certifyScenePaint(scene([edge, cover]))
  expect(proof.status).toBe('unverified')
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', by: 'star' }))
})


test.each(['non-scaling-stroke', 'rgba(0,0,0,0)', '#00000000'] as const)('%s outlines cannot hide a marker inside their endpoint body', mode => {
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 50, x2: 40, y2: 50 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'node' }, markers: { end: tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse') } })
  const cover = marks.shape({ id: 'node', role: 'node', geometry: { kind: 'rect', x: 2, y: 2, width: 6, height: 6 }, paint: { fill: '#fff', stroke: mode === 'non-scaling-stroke' ? '#111' : mode, strokeWidth: '10', ...(mode === 'non-scaling-stroke' ? { vectorEffect: mode } : {}) }, transform: { kind: 'matrix', a: 10, b: 0, c: 0, d: 10, e: 0, f: 0 } })
  expect(certifyScenePaint({ ...scene([edge, cover]), height: 100 })).toMatchObject({ status: 'failed', issues: [expect.objectContaining({ code: 'MARKER_OCCLUDED', by: 'node' })] })
})


test('omitted marker orientation follows the emitted auto tangent', () => {
  const marker = { id: 'arrow', shape: 'arrow' as const, units: 'userSpaceOnUse' as const, ref: { x: 8, y: 2.5 }, geometry: { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 8, y: 2.5 }, { x: 0, y: 5 }] }, paint: { fill: '#111' } }
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 10, x2: 10, y2: 50 }, paint: { stroke: '#111' }, markers: { end: marker } })
  const hull = connectorMarkerPaintRegions(edge)[0]!.hull!
  expect(hull[0]!.x).toBeCloseTo(12.5)
  expect(hull[0]!.y).toBeCloseTo(42)
  expect(hull[1]).toEqual({ x: 10, y: 50 })
  expect(hull[2]!.x).toBeCloseTo(7.5)
  expect(hull[2]!.y).toBeCloseTo(42)
})

test('concurrent State labels retain visible own and neighboring endpoint markers', () => {
  const source = `stateDiagram-v2
    [*] --> Active

    state Active {
        [*] --> NumLockOff
        NumLockOff --> NumLockOn : EvNumLockPressed
        NumLockOn --> NumLockOff : EvNumLockPressed
        --
        [*] --> CapsLockOff
        CapsLockOff --> CapsLockOn : EvCapsLockPressed
        CapsLockOn --> CapsLockOff : EvCapsLockPressed
        --
        [*] --> ScrollLockOff
        ScrollLockOff --> ScrollLockOn : EvScrollLockPressed
        ScrollLockOn --> ScrollLockOff : EvScrollLockPressed
    }`
  const rendered = renderMermaidSVGWithReceipt(source)
  expect(rendered.receipt.layoutCertification?.status).toBe('passed')
  expect(rendered.receipt.layoutCertification?.issues).toEqual([])
  expect(() => renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' })).not.toThrow()
  const request = resolveRenderRequestForExecution(source, {}, 'svg')
  const positioned = positionResolvedFamily(resolvedRenderExecutionPlanOf(request).family.id, request)
  const primitives = inspectScenePrimitives(lowerPositionedFamilyScene(request, positioned)).primitives
  const halos = primitives.filter(part => part.id.endsWith(':halo'))
  const incoming = ['NumLockOff', 'CapsLockOff', 'ScrollLockOff'].flatMap(target => {
    const edges = primitives.filter(part => part.id.startsWith('edge:') && part.id.endsWith(`->${target}#0`))
    expect(edges).toHaveLength(2) // contextual start and the paired authored On state
    return edges
  })
  for (const primitive of incoming) {
    const edge = scenePrimitiveSource(primitive)!
    expect(edge.kind).toBe('connector')
    if (edge.kind !== 'connector') throw new Error('Expected the retained native connector')
    const marker = connectorMarkerPaintRegions(edge).find(region => region.position === 'end')!
    expect(marker.hull).toBeDefined()
    for (const halo of halos) {
      const a = marker.bounds!, b = halo.bounds!
      expect(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0, `${primitive.id} hidden by ${halo.id}`).toBe(false)
    }
  }
})

const SIDE_CONSTRAINED_ARCHITECTURE = `architecture-beta
  group g0(cloud)[Group 0]
  service s0_0(server)[Svc s0_0] in g0
  service s0_1(server)[Svc s0_1] in g0
  service s0_2(server)[Svc s0_2] in g0
  group g1(cloud)[Group 1]
  service s1_0(server)[Svc s1_0] in g1
  service s1_1(server)[Svc s1_1] in g1
  s1_0:L --> L:s0_1
  s1_1:L --> T:s0_0`

test('final Architecture certification preserves authored sides and rejects a later shaft through an unrelated card', () => {
  const positive = layoutMermaidWithReceipt(SIDE_CONSTRAINED_ARCHITECTURE, { debug: true, layoutSafety: 'strict' })
  expect(positive.receipt.layoutCertification?.status).toBe('passed')
  for (const [from, to, targetSide] of [['s1_0', 's0_1', 'L'], ['s1_1', 's0_0', 'T']] as const) {
    const edge = positive.layout.edges.find(edge => edge.from === from && edge.to === to)!
    const source = positive.layout.nodes.find(node => node.id === from)!
    const target = positive.layout.nodes.find(node => node.id === to)!
    expect(edge.route).toMatchObject({ sourceSide: 'L', targetSide, sourceAnchored: true, targetAnchored: true })
    expect(edge.path[0]![0]).toBe(source.x)
    expect(targetSide === 'L' ? edge.path.at(-1)![0] : edge.path.at(-1)![1]).toBe(targetSide === 'L' ? target.x : target.y)
  }
  const family = getFamily('architecture')!
  let layouts = 0
  const restore = replaceFamilyForTest('architecture', { ...family, layout(context) {
    layouts++
    const value = family.layout!(context)
    const positioned = ('positioned' in value ? value.positioned : value) as PositionedArchitectureDiagram
    const edge = positioned.edges.find(edge => edge.source.id === 's1_1' && edge.target.id === 's0_0')!
    const card = positioned.services.find(service => service.id === 's0_1')!
    const first = edge.points[0]!, lead = edge.points[1]!, tail = edge.points.at(-2)!, last = edge.points.at(-1)!
    const cy = card.y + card.height / 2, left = card.x - 10, right = card.x + card.width + 10
    // Preserve both declared contacts and their approach segments, but introduce
    // a real positive-length crossing after all family routing/translations.
    edge.points = [first, lead, { x: lead.x, y: cy }, { x: left, y: cy }, { x: right, y: cy }, { x: right, y: tail.y }, tail, last]
    expect(right - left).toBeGreaterThan(card.width)
    expect(cy).toBeGreaterThan(card.y)
    expect(cy).toBeLessThan(card.y + card.height)
    return value
  } })
  try {
    expect(() => renderMermaidSVGWithReceipt(SIDE_CONSTRAINED_ARCHITECTURE, { layoutSafety: 'strict' })).toThrow('Final paint certification failed')
    const verified = verifyMermaid(SIDE_CONSTRAINED_ARCHITECTURE)
    expect(verified.ok).toBe(false)
    expect(verified.layoutCertification?.status).toBe('failed')
    expect(verified.layoutCertification?.issues).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', by: expect.stringContaining('s0_1') }))
    expect(layouts).toBe(2)
  } finally { restore() }
})

test('shaft checking distinguishes proved straight crossings, uncertain curves and clear routed detours', () => {
  const fields = { id: 'route', role: 'edge' as const, lineStyle: 'solid' as const, paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'A', to: 'B' } }
  const straight = marks.connector({ ...fields, geometry: { kind: 'line', x1: 5, y1: 30, x2: 95, y2: 30 } })
  expect(certifyScenePaint(scene([straight, surface()])).issues).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', id: 'route', by: 'cover' }))
  const path = marks.connector({ ...fields, geometry: { kind: 'path', d: 'M5 30 H95', points: [{ x: 5, y: 30 }, { x: 95, y: 30 }] } })
  expect(certifyScenePaint(scene([path, surface()])).issues).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', id: 'route', by: 'cover' }))
  const curved = marks.connector({ ...fields, geometry: { kind: 'path', d: 'M5 5 C5 75 95 75 95 5', points: [{ x: 5, y: 5 }, { x: 50, y: 57.5 }, { x: 95, y: 5 }] } })
  expect(certifyScenePaint(scene([curved, surface()]))).toMatchObject({ status: 'unverified', issues: [expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'route' })] })
  const detour = marks.connector({ ...fields, geometry: { kind: 'polyline', points: [{ x: 5, y: 5 }, { x: 95, y: 5 }, { x: 95, y: 75 }] } })
  expect(certifyScenePaint(scene([detour, surface()])).status).toBe('passed')
  expect(certifyScenePaint(scene([straight, surface('rgba(255,255,255,0.5)')])).status).toBe('passed')
  expect(certifyScenePaint(scene([straight, surface()]), undefined, { outputSupported: false }).status).toBe('unverified')
  const unknown = marks.connector({ ...fields, endpoints: undefined, geometry: { kind: 'line', x1: 5, y1: 30, x2: 95, y2: 30 } })
  expect(certifyScenePaint(scene([unknown, surface()])).status).toBe('unverified')
})

test('the repaired native Architecture BUG-37 route receives a passed public certificate', () => {
  const source = `${SIDE_CONSTRAINED_ARCHITECTURE.slice(0, SIDE_CONSTRAINED_ARCHITECTURE.indexOf('  s1_0:L'))}  s0_0:L --> L:s1_0
  s0_0:T --> T:s0_1
  s0_2:L --> L:s1_0
  s0_1:L --> L:s1_0`
  const rendered = renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' })
  expect(rendered.receipt.layoutCertification?.status).toBe('passed')
  expect(rendered.receipt.layoutCertification?.outputDigest).toBe(renderedSvgDigest(rendered.svg))
  const verified = verifyMermaid(source)
  expect(verified.ok).toBe(true)
  expect(verified.layoutCertification?.status).toBe('passed')
  expect(verified.layoutCertification?.issues).toEqual([])
})

test.each(['dashed', 'zero-width', 'transparent', 'resolved-transparent', 'zero-opacity'] as const)('%s shaft paint never proves hidden ink from an unpainted crossing', mode => {
  const paint = { stroke: mode === 'transparent' ? 'rgba(0,0,0,0)' : mode === 'resolved-transparent' ? 'var(--surface)' : '#111', strokeWidth: mode === 'zero-width' ? '0' : '1', ...(mode === 'zero-opacity' ? { opacity: '0' } : {}), ...(mode === 'dashed' ? { strokeDasharray: '1 100' } : {}) }
  const edge = marks.connector({ id: 'route', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 5, y1: 30, x2: 95, y2: 30 }, paint, endpoints: { from: 'A', to: 'B' } })
  const proof = certifyScenePaint({ ...scene([edge, surface()]), colors: { bg: '#fff', fg: '#111', surface: '#00000000' } })
  expect(proof.status).toBe(mode === 'dashed' ? 'unverified' : 'passed')
  expect(proof.issues.some(issue => issue.code === 'CONNECTOR_CARD_CROSSING')).toBe(false)
})

test('shaft checks use composed final transforms and preserve only incident card exemptions', () => {
  const edge = marks.connector({ id: 'route', role: 'edge', owner: { id: 'route', role: 'edge' }, lineStyle: 'solid', geometry: { kind: 'line', x1: 5, y1: 30, x2: 95, y2: 30 }, paint: { stroke: '#111' }, endpoints: { from: 'A', to: 'B' } })
  const card = marks.shape({ id: 'unrelated', role: 'node', owner: { id: 'C', role: 'node' }, geometry: { kind: 'rect', x: 10, y: 10, width: 80, height: 60 }, paint: { fill: '#fff' } })
  const group = marks.group({ id: 'translated', role: 'chrome', transform: { kind: 'matrix', a: 2, b: 0, c: 0, d: 3, e: 100, f: 50 }, open: '<g transform="matrix(2 0 0 3 100 50)">', close: '</g>', children: [{ node: edge, indent: 0 }, { node: card, indent: 0 }] })
  expect(certifyScenePaint({ ...scene([group]), width: 400, height: 400 }).issues).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', id: 'route', by: 'unrelated' }))
  const ownCard = marks.shape({ ...card, owner: { id: 'B', role: 'node' } })
  expect(certifyScenePaint(scene([edge, ownCard])).status).toBe('passed')
})

test('typed shaft parsing shares the finite final-check work budget', () => {
  const d = `M5 5${' L95 5 L5 5'.repeat(35_000)}`
  const edge = marks.connector({ id: 'long-route', role: 'edge', lineStyle: 'solid', geometry: { kind: 'path', d, points: [{ x: 5, y: 5 }, { x: 95, y: 5 }, { x: 5, y: 5 }] }, paint: { stroke: '#111' }, endpoints: { from: 'A', to: 'B' } })
  const proof = certifyScenePaint(scene([edge, surface()]))
  expect(proof.status).toBe('unverified')
  expect(proof.checks.operations).toBeLessThanOrEqual(proof.checks.maxOperations)
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'CHECK_BUDGET' }))
})

test('drawing or repainting a semantic shaft above an unrelated card does not excuse the crossing', () => {
  const fields = { id: 'route', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 5, y1: 30, x2: 95, y2: 30 }, paint: { stroke: '#111' }, endpoints: { from: 'A', to: 'B' } }
  const svg = '<line x1="5" y1="30" x2="95" y2="30" stroke="#111"/>'
  const edge = marks.connector(fields)
  const repaint = marks.connector({ ...fields, id: 'repaint', role: 'chrome', owner: { id: 'route', role: 'edge' } })
  for (const parts of [[surface(), edge], [edge, surface(), repaint]]) {
    const proof = certifyScenePaint(scene(parts))
    expect(proof.status).toBe('failed')
    expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', by: 'cover' }))
  }
})

test('downscaled non-scaling shafts retain their world-unit collision envelope', () => {
  const edge = marks.connector({ id: 'scaled', role: 'edge', geometry: { kind: 'line', x1: 100, y1: 100, x2: 900, y2: 100 }, lineStyle: 'solid', paint: { stroke: '#f00', strokeWidth: '10', vectorEffect: 'non-scaling-stroke' }, transform: { kind: 'matrix', a: 0.1, b: 0, c: 0, d: 0.1, e: 0, f: 0 }, endpoints: { from: 'A', to: 'B' } })
  const card = marks.shape({ id: 'C', role: 'node', geometry: { kind: 'rect', x: 30, y: 12, width: 40, height: 30 }, paint: { fill: '#fff' } })
  const proof = certifyScenePaint(scene([edge, card]))
  expect(proof.status).toBe('unverified')
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'scaled', by: 'C' }))
  expect(proof.issues.some(issue => issue.code === 'CONNECTOR_CARD_CROSSING')).toBe(false)
})

test.each(['miter', 'square'] as const)('%s shaft ink outside its centerline remains an uncertain card intersection', mode => {
  const points = mode === 'miter' ? [{ x: 20, y: 80 }, { x: 50, y: 50 }, { x: 35, y: 85 }] : [{ x: 30, y: 30 }, { x: 50, y: 50 }]
  const geometry = mode === 'miter' ? { kind: 'polyline' as const, points } : { kind: 'line' as const, x1: 30, y1: 30, x2: 50, y2: 50 }
  const edge = marks.connector({ id: 'join-or-cap', role: 'edge', geometry, lineStyle: 'solid', paint: { stroke: '#f00', strokeWidth: '10', strokeLinejoin: 'miter', strokeMiterlimit: '10', ...(mode === 'square' ? { strokeLinecap: 'square' } : {}) }, endpoints: { from: 'A', to: 'B' } })
  const cardGeometry = mode === 'miter' ? { kind: 'rect' as const, x: 60, y: 26, width: 10, height: 10 } : { kind: 'rect' as const, x: 55.5, y: 48, width: 1, height: 4 }
  const card = marks.shape({ id: 'C', role: 'node', geometry: cardGeometry, paint: { fill: '#fff' } })
  const proof = certifyScenePaint({ ...scene([edge, card]), height: 100 })
  expect(proof.status).toBe('unverified')
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'join-or-cap', by: 'C' }))
  expect(proof.issues.some(issue => issue.code === 'CONNECTOR_CARD_CROSSING')).toBe(false)
})

test('authored edge and card names do not share an ownership exemption across roles', () => {
  expect(() => renderMermaidSVGWithReceipt('flowchart LR\nA C@--> B\nC[Unrelated]', { layoutSafety: 'strict' })).not.toThrow()
  const edge = marks.connector({ id: 'edge:C', identity: { id: 'C' }, role: 'edge', geometry: { kind: 'line', x1: 10, y1: 30, x2: 90, y2: 30 }, lineStyle: 'solid', paint: { stroke: '#111' }, endpoints: { from: 'A', to: 'B' } })
  const card = marks.shape({ id: 'node:C', identity: { id: 'C' }, role: 'node', geometry: { kind: 'rect', x: 30, y: 10, width: 40, height: 60 }, paint: { fill: '#fff' } })
  expect(certifyScenePaint(scene([edge, card]))).toMatchObject({ status: 'failed', issues: [expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', id: 'edge:C', by: 'node:C' })] })
})

test('native Class note attachments identify their actual class and note subjects', () => {
  const source = 'classDiagram\nclass Account\nnote for Account "Owner"'
  expect(renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' }).receipt.layoutCertification?.status).toBe('passed')
  const request = resolveRenderRequestForExecution(source, {}, 'svg')
  const result = positionResolvedFamily('class', request)
  const inspection = inspectScenePrimitives(lowerPositionedFamilyScene(request, result))
  const primitive = inspection.primitives.find(primitive => primitive.id === 'class-note:0:connector')!
  const connector = scenePrimitiveSource(primitive)!
  expect(connector.kind).toBe('connector')
  if (connector.kind !== 'connector') throw new Error('Expected the native note attachment')
  expect(connector.endpoints).toMatchObject({ from: 'Account', to: 'class-note:0' })
  expect(inspection.primitives.some(primitive => primitive.owner.id === connector.endpoints?.from && primitive.owner.role === 'class-box')).toBe(true)
  expect(inspection.primitives.some(primitive => primitive.owner.id === connector.endpoints?.to && primitive.owner.role === 'note')).toBe(true)
  expect(connector.endpoints).toMatchObject({ start: { owner: { id: 'Account', role: 'class-box' } }, end: { owner: { id: 'class-note:0', role: 'note' } } })
  expect(renderMermaidSVGWithReceipt('classDiagram\nnamespace Account {\nclass Account\n}\nAccount --> Other', { layoutSafety: 'strict' }).receipt.layoutCertification?.status).toBe('passed')
})

test('typed group endpoints do not exempt a same-named entity; ambiguous legacy endpoints remain unverified', () => {
  const card = marks.shape({ id: 'entity:q', role: 'entity', owner: { id: 'q', role: 'entity' }, geometry: { kind: 'rect', x: 30, y: 10, width: 40, height: 60 }, paint: { fill: '#fff' } })
  const frame = marks.shape({ id: 'group:q', role: 'group', owner: { id: 'q', role: 'group' }, geometry: { kind: 'rect', x: 5, y: 5, width: 90, height: 70 }, paint: { fill: 'none', stroke: '#111' } })
  const fields = { id: 'relation', role: 'relationship' as const, geometry: { kind: 'line' as const, x1: 10, y1: 30, x2: 90, y2: 30 }, lineStyle: 'solid' as const, paint: { stroke: '#111' } }
  const svg = '<line x1="10" y1="30" x2="90" y2="30" stroke="#111"/>'
  const typed = marks.connector({ ...fields, endpoints: { from: 'p', to: 'q', end: { owner: { id: 'q', role: 'group' } } } })
  expect(certifyScenePaint(scene([frame, typed, card]))).toMatchObject({ status: 'failed', issues: [expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', by: 'entity:q' })] })
  const legacy = marks.connector({ ...fields, endpoints: { from: 'p', to: 'q' } })
  expect(certifyScenePaint(scene([frame, legacy, card]))).toMatchObject({ status: 'unverified', issues: [expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', by: 'entity:q' })] })
  const attached = marks.connector({ ...fields, endpoints: { from: 'p', to: 'q', end: { owner: { id: 'q', role: 'entity' } } } })
  expect(certifyScenePaint(scene([frame, attached, card])).status).toBe('passed')
})

test('final ER certification rejects a group route corrupted through a same-named sibling entity after layout', () => {
  const source = 'erDiagram\nsubgraph p\nsubgraph q\nX\nend\nq\nend\np ||--|| q : contains'
  const family = getFamily('er')!
  const restore = replaceFamilyForTest('er', { ...family, lowerScene(context) {
    const value = context.positioned
    const positioned = ('positioned' in value ? value.positioned : value) as PositionedErDiagram
    const card = positioned.entities.find(entity => entity.id === 'q')!
    const relationship = positioned.relationships[0]!
    const first = relationship.points[0]!, last = relationship.points.at(-1)!
    const cy = card.y + card.height / 2, left = card.x - 10, right = card.x + card.width + 10
    relationship.points = [first, { x: first.x, y: first.y - 20 }, { x: left, y: first.y - 20 }, { x: left, y: cy }, { x: right, y: cy }, { x: right, y: last.y + 20 }, { x: last.x, y: last.y + 20 }, last]
    const lowered = family.lowerScene!(context)
    const primitive = inspectScenePrimitives(lowered).primitives.find(primitive => primitive.role === 'relationship')!
    const connector = scenePrimitiveSource(primitive)!
    if (connector.kind !== 'connector') throw new Error('Expected the native ER relationship')
    expect(connector.endpoints).toMatchObject({ from: 'p', to: 'q', start: { point: first, owner: { id: 'p', role: 'group' } }, end: { point: last, owner: { id: 'q', role: 'group' } } })
    return lowered
  } })
  try {
    expect(() => renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' })).toThrow('Final connector shaft crosses')
    const verified = verifyMermaid(source)
    expect(verified.layoutCertification?.status).toBe('failed')
    expect(verified.layoutCertification?.issues).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', by: expect.stringContaining('q') }))
  } finally { restore() }
})

test.each(['solid', 'dashed'] as const)('an open two-point %s polyline has the same join-free clearance as a line', lineStyle => {
  const fields = { id: 'near-card', role: 'relationship' as const, lineStyle,
    paint: { stroke: '#111', strokeWidth: '1', ...(lineStyle === 'dashed' ? { strokeDasharray: '6 4' } : {}) }, endpoints: { from: 'A', to: 'B' } }
  const polyline = marks.connector({ ...fields, geometry: { kind: 'polyline', points: [{ x: 10, y: 8 }, { x: 90, y: 8 }] } })
  const line = marks.connector({ ...fields, geometry: { kind: 'line', x1: 10, y1: 8, x2: 90, y2: 8 } })
  const card = marks.shape({ id: 'C', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 10, height: 10 }, paint: { fill: '#fff', stroke: '#111', strokeWidth: '1' } })
  expect(nodePaintBounds(polyline)).toEqual(nodePaintBounds(line))
  expect(certifyScenePaint(scene([line, card])).status).toBe('passed')
  expect(certifyScenePaint(scene([polyline, card])).status).toBe('passed')
})

test.each(['solid', 'dashed'] as const)('a genuinely entering %s two-point polyline keeps the collision guard', lineStyle => {
  const edge = marks.connector({ id: 'entering', role: 'relationship', lineStyle,
    geometry: { kind: 'polyline', points: [{ x: 10, y: 15 }, { x: 90, y: 15 }] },
    paint: { stroke: '#111', strokeWidth: '1', ...(lineStyle === 'dashed' ? { strokeDasharray: '6 4' } : {}) }, endpoints: { from: 'A', to: 'B' } })
  const card = marks.shape({ id: 'C', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 10, height: 10 }, paint: { fill: '#fff' } })
  const proof = certifyScenePaint(scene([edge, card]))
  expect(proof.status).toBe(lineStyle === 'solid' ? 'failed' : 'unverified')
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: lineStyle === 'solid' ? 'CONNECTOR_CARD_CROSSING' : 'POTENTIAL_OCCLUSION', id: 'entering', by: 'C' }))
})

test('closed, bent and path connectors retain conservative painted bounds and card warnings', () => {
  const card = marks.shape({ id: 'C', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 10, height: 10 }, paint: { fill: '#fff', stroke: '#111', strokeWidth: '1' } })
  // Width 1 and miter limit 4 retain a 2 px envelope. The quadratic's control
  // hull reaches y=20; sampled endpoint count never replaces its curve bound.
  const cases = [
    { geometry: { kind: 'path' as const, d: 'M10 8 H90 V2 H10 Z', points: [{ x: 10, y: 8 }, { x: 90, y: 8 }, { x: 90, y: 2 }, { x: 10, y: 2 }] }, closed: true, bounds: { x0: 8, y0: 0, x1: 92, y1: 10 } },
    { geometry: { kind: 'polyline' as const, points: [{ x: 10, y: 8 }, { x: 90, y: 8 }, { x: 90, y: 20 }] }, closed: false, bounds: { x0: 8, y0: 6, x1: 92, y1: 22 } },
    { geometry: { kind: 'path' as const, d: 'M10 8 H90', points: [{ x: 10, y: 8 }, { x: 90, y: 8 }] }, closed: false, bounds: { x0: 8, y0: 6, x1: 92, y1: 10 } },
    { geometry: { kind: 'path' as const, d: 'M10 8 Q50 20 90 8', points: [{ x: 10, y: 8 }, { x: 90, y: 8 }] }, closed: false, bounds: { x0: 8, y0: 6, x1: 92, y1: 22 } },
  ]
  for (const { geometry, closed, bounds } of cases) {
    const edge = marks.connector({ id: 'conservative', role: 'relationship', lineStyle: 'dashed', geometry, route: { closed },
      paint: { stroke: '#111', strokeWidth: '1', strokeDasharray: '6 4' }, endpoints: { from: 'A', to: 'B' } })
    expect(nodePaintBounds(edge)).toEqual(bounds)
    expect(certifyScenePaint(scene([edge, card]))).toMatchObject({ status: 'unverified', issues: [expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'conservative', by: 'C' })] })
  }
})

test.each(['butt', 'round', 'square'] as const)('%s dash caps remain inside the straight polyline envelope', strokeLinecap => {
  const fields = { id: 'capped', role: 'relationship' as const, lineStyle: 'dashed' as const,
    paint: { stroke: '#111', strokeWidth: '2', strokeLinecap, strokeDasharray: '6 4' }, endpoints: { from: 'A', to: 'B' } }
  const line = marks.connector({ ...fields, geometry: { kind: 'line', x1: 10, y1: 8, x2: 90, y2: 8 } })
  const polyline = marks.connector({ ...fields, geometry: { kind: 'polyline', points: [{ x: 10, y: 8 }, { x: 90, y: 8 }] } })
  expect(nodePaintBounds(polyline)).toEqual(nodePaintBounds(line))
})

test('a downscaled non-scaling two-point polyline still reports actual stroke/card overlap', () => {
  const edge = marks.connector({ id: 'scaled-polyline', role: 'edge', geometry: { kind: 'polyline', points: [{ x: 300, y: 100 }, { x: 700, y: 100 }] },
    lineStyle: 'dashed', paint: { stroke: '#f00', strokeWidth: '10', strokeDasharray: '6 4', vectorEffect: 'non-scaling-stroke' },
    transform: { kind: 'matrix', a: 0.1, b: 0, c: 0, d: 0.1, e: 0, f: 20 }, endpoints: { from: 'A', to: 'B' } })
  const card = marks.shape({ id: 'C', role: 'node', geometry: { kind: 'rect', x: 40, y: 32, width: 20, height: 18 }, paint: { fill: '#fff' } })
  expect(certifyScenePaint(scene([edge, card]))).toMatchObject({ status: 'unverified', issues: [expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'scaled-polyline', by: 'C' })] })
})

test('the retained Native Class clearance witness certifies without changing its layout backend', () => {
  const { source } = JSON.parse(readFileSync(new URL('./fixtures/class-native-clearance.json', import.meta.url), 'utf8')) as { source: string }
  const rendered = renderMermaidSVGWithReceipt(source, { class: { hierarchicalNamespaces: true }, graphLayout: { backend: 'agentic' }, layoutSafety: 'strict', idPrefix: 'class-clearance-' })
  expect(rendered.receipt.layoutCertification?.status).toBe('passed')
  expect(rendered.receipt.layoutDecisions).toContainEqual(expect.objectContaining({ requested: 'agentic', selected: 'agentic' }))
})

const cylinderMarker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111', stroke: '#111', strokeWidth: '0.5', strokeLinejoin: 'round' }, 'userSpaceOnUse')
function cylinderWitness(inset = 0, extra?: { geometry: Geometry; paint: MarkPaint }, scale = 1) {
  const local = (value: number) => value / scale
  const geometry: Geometry = { kind: 'compound', children: [
    { kind: 'rect', x: local(20), y: local(27), width: local(60), height: local(26) },
    { kind: 'line', x1: local(20), y1: local(27), x2: local(20), y2: local(53) },
    { kind: 'line', x1: local(80), y1: local(27), x2: local(80), y2: local(53) },
    { kind: 'ellipse', cx: local(50), cy: local(53), rx: local(30), ry: local(7) },
    { kind: 'ellipse', cx: local(50), cy: local(27), rx: local(30), ry: local(7) },
    ...(extra ? [extra.geometry] : []),
  ] }
  const stroke = { stroke: '#111', strokeWidth: String(1 / scale) }
  const childPaints: MarkPaint[] = [{ fill: '#fff', stroke: 'none' }, { ...stroke, fill: 'none' }, { ...stroke, fill: 'none' }, { ...stroke, fill: '#fff' }, { ...stroke, fill: '#fff' }, ...(extra ? [extra.paint] : [])]
  const card = marks.shape({ id: 'cylinder', role: 'node', geometry, paint: { ...stroke, fill: '#fff' }, childPaints, ...(scale !== 1 ? { transform: { kind: 'matrix' as const, a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 } } : {}) })
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 50, y1: 2, x2: 50, y2: 20 + inset }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'cylinder' }, markers: { end: cylinderMarker } })
  return { card, proof: certifyScenePaint(scene([edge, card])) }
}

test('a cap-attached cylinder marker clears both independently stroked side lines', () => {
  const { card, proof } = cylinderWitness()
  // Arrow points downward from (52.5,12),(50,20),(47.5,12). Cap upper
  // boundary is y=20; side strokes occupy x=19.5..20.5 and 79.5..80.5.
  expect(sceneNodeSerialization(card)).toContain('<line x1="20" y1="27" x2="20" y2="53" fill="none" stroke="#111" stroke-width="1"')
  expect(proof.status).toBe('passed')
})

test('a cap-entering marker stays unverified', () => {
  expect(cylinderWitness(2).proof.status).toBe('unverified')
})

test.each(['right-end', 'left-end', 'right-start', 'left-start', 'entering', 'tiny-entering', 'extra-line', 'translucent', 'dashed', 'unknown-width', 'non-scaling', 'transformed', 'covered', 'borrowed-outline', 'borrowed-body-outline', 'reordered'] as const)('a side-attached cylinder marker requires its actual opaque boundary (%s)', mode => {
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const left = mode.startsWith('left'), start = mode.endsWith('start')
    const x = left ? 20 : 80 - (mode === 'entering' ? 1 : mode === 'tiny-entering' ? 1e-9 : 0)
    const sidePaint: MarkPaint = { stroke: '#111', strokeWidth: mode === 'covered' ? '40' : mode === 'unknown-width' ? '1em' : '0.75',
      ...(mode === 'translucent' || mode === 'borrowed-outline' ? { strokeOpacity: '0.5' } : {}), ...(mode === 'dashed' ? { strokeDasharray: '1 100' } : {}), ...(mode === 'non-scaling' ? { vectorEffect: 'non-scaling-stroke' } : {}) }
    const marker = tipAnchoredArrow('side-arrow', { width: 8, height: 5 }, start ? 'start' : 'end', { fill: '#111', stroke: '#111', strokeWidth: '0.75', strokeLinejoin: 'round' }, 'userSpaceOnUse')
    if (mode === 'borrowed-outline' || mode === 'borrowed-body-outline') marker.ref = { x: 7, y: 2.5 }
    const children: Geometry[] = [
      { kind: 'rect', x: 20, y: 27, width: 60, height: 26 },
      { kind: 'line', x1: 20, y1: 27, x2: 20, y2: 53 },
      { kind: 'line', x1: 80, y1: 27, x2: 80, y2: 53 },
      { kind: 'ellipse', cx: 50, cy: 53, rx: 30, ry: 7 },
      { kind: 'ellipse', cx: 50, cy: 27, rx: 30, ry: 7 },
      ...(mode === 'extra-line' ? [{ kind: 'line' as const, x1: 82, y1: 40, x2: 90, y2: 40 }] : []),
    ]
    const childPaints: MarkPaint[] = [
      { fill: '#fff', stroke: 'none' }, sidePaint, sidePaint,
      { fill: '#fff', stroke: '#111', strokeWidth: '0.75' }, { fill: '#fff', stroke: '#111', strokeWidth: '0.75' },
      ...(mode === 'extra-line' ? [{ stroke: '#111', strokeWidth: '4' }] : []),
    ]
    if (mode === 'reordered') {
      children.splice(0, 2, ...children.slice(0, 2).reverse())
      childPaints.splice(0, 2, ...childPaints.slice(0, 2).reverse())
    }
    const card = factory.shape({ id: 'cylinder', role: 'node', geometry: { kind: 'compound', children }, paint: { fill: '#fff', stroke: '#111', strokeWidth: '0.75' }, childPaints,
      ...(mode === 'transformed' ? { transform: { kind: 'matrix' as const, a: 1, b: 0, c: 0, d: 1, e: 0.25, f: 0 } } : {}) })
    const outside = left ? 2 : 98
    const edge = factory.connector({ id: 'side-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: start ? x : outside, y1: 40, x2: start ? outside : x, y2: 40 }, paint: { stroke: '#111', strokeWidth: '1' },
      endpoints: start ? { from: 'cylinder', to: 'outside' } : { from: 'outside', to: 'cylinder' }, markers: start ? { start: marker } : { end: marker } })
    const oldOutline = factory.shape({ id: 'old-outline', role: 'node', owner: { id: 'cylinder', role: 'node' }, geometry: mode === 'borrowed-body-outline' ? { kind: 'rect', x: 20, y: 27, width: 60, height: 26 } : { kind: 'line', x1: 80, y1: 27, x2: 80, y2: 53 }, paint: { fill: 'none', stroke: '#111', strokeWidth: '40' } })

    return { ...scene([]), parts: [
      factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" style="--bg:#fff;--fg:#111">'),
      factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
      ...(mode === 'borrowed-outline' || mode === 'borrowed-body-outline' ? [oldOutline] : []), edge, card, factory.documentClose(),
    ] }
  }
  const positive = mode.endsWith('end') || mode.endsWith('start')
  // Raw typed bodies do not carry the actual five-piece write authority.
  const raw = certifyScenePaint(producer(marks, context))
  if (positive) {
    expect(raw.status).toBe('unverified')
    expect(drawPaintControl(producer, context, 'scene').proof.status).toBe('unverified')
  } else expect(raw.status).not.toBe('passed')
  for (const execution of ['native', 'scene'] as const) {
    if (mode === 'unknown-width') {
      expect(() => drawPaintControl(producer, context, execution, { fractionalCircleOutput: true })).toThrow('strokeWidth: must be a finite number or safe numeric custom-property reference')
      continue
    }
    const drawing = drawPaintControl(producer, context, execution, { fractionalCircleOutput: true })
    if (positive) {
      const elements = rectangleEmissionElements(drawing.svg)
      expect(elements.find(element => element.name === 'marker')!.attributes).toMatchObject({ markerUnits: 'userSpaceOnUse', markerWidth: '8', markerHeight: '5', refX: mode.endsWith('start') ? '0' : '8', refY: '2.5' })
      expect(elements.find(element => element.name === 'polygon')!.attributes).toMatchObject({ fill: '#111', stroke: '#111', 'stroke-width': '0.75' })
      expect(elements.filter(element => element.name === 'line').slice(1).map(element => element.attributes)).toContainEqual(expect.objectContaining({ x1: mode.startsWith('left') ? '20' : '80', y1: '27', y2: '53', stroke: '#111', 'stroke-width': '0.75' }))
      const token = ` marker-${mode.endsWith('start') ? 'start' : 'end'}="url(#side-arrow)"`
      expect(drawing.svg.split(token)).toHaveLength(2)
      const actual = new Resvg(drawing.svg, { background: '#fff', fitTo: { mode: 'zoom', value: 4 } }).render()
      const absent = new Resvg(drawing.svg.replace(token, ''), { background: '#fff', fitTo: { mode: 'zoom', value: 4 } }).render().pixels
      const pixels = actual.pixels
      let offShaft = 0
      for (let y = 0; y < actual.height; y++) for (let x = 0; x < actual.width; x++) {
        if (Math.abs((y + 0.5) / 4 - 40) <= 1) continue
        const offset = (y * actual.width + x) * 4
        if (pixels[offset]! < absent[offset]! || pixels[offset + 1]! < absent[offset + 1]! || pixels[offset + 2]! < absent[offset + 2]!) offShaft++
      }
      expect(offShaft).toBeGreaterThan(0)
      expect(drawing.proof.status).toBe('passed')
    } else expect(drawing.proof.status).not.toBe('passed')
  }

})

test.each(['butt', 'round', 'square'] as const)('%s line-child stroke through marker cannot be excluded with its zero-area fill', strokeLinecap => {
  const { proof } = cylinderWitness(0, { geometry: { kind: 'line', x1: 40, y1: 15, x2: 60, y2: 15 }, paint: { fill: 'none', stroke: '#111', strokeWidth: '4', strokeLinecap } })
  expect(proof.status).toBe('unverified')
})

test('a downscaled non-scaling square-capped line retains its world-space stroke', () => {
  const { proof } = cylinderWitness(0, { geometry: { kind: 'line', x1: 350, y1: 150, x2: 430, y2: 150 }, paint: { fill: 'none', stroke: '#111', strokeWidth: '10', strokeLinecap: 'square', vectorEffect: 'non-scaling-stroke' } }, 0.1)
  expect(proof.status).toBe('unverified')
})

test('unknown line-child stroke units preserve uncertainty', () => {
  const { proof } = cylinderWitness(0, { geometry: { kind: 'line', x1: 40, y1: 15, x2: 60, y2: 15 }, paint: { fill: 'none', stroke: '#111', strokeWidth: '1em' } })
  expect(proof.status).toBe('unverified')
})

test('nested compound paint indices cannot provide an emitted border-band proof', () => {
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse')
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 40, x2: 40.4, y2: 40 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'node' }, markers: { end: marker } })
  const card = marks.shape({ id: 'node', role: 'node', geometry: { kind: 'compound', children: [
    { kind: 'rect', x: 70, y: 70, width: 5, height: 5 },
    { kind: 'compound', children: [{ kind: 'rect', x: 40, y: 10, width: 50, height: 60 }] },
  ] }, paint: { fill: '#fff' }, childPaints: [{ fill: '#fff', stroke: '#111', strokeWidth: '10' }, { fill: '#fff', stroke: 'none' }] })
  expect(() => sceneNodeSerialization(card)).toThrow('nests compound geometry')
  // The nested first piece must not borrow the root sibling's 10px band.
  expect(certifyScenePaint(scene([edge, card])).status).toBe('unverified')
})

test.each(['clear-body', 'body-crossing', 'join-reach', 'square-cap', 'affine', 'non-scaling', 'unsupported-join', 'unknown-color'] as const)('orthogonal stroke union retains exact body/cap/join authority for %s', mode => {
  const context = { positioned: { width: 200, height: 160 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const points = mode === 'square-cap' ? [{ x: 10, y: 40 }, { x: 40, y: 40 }]
      : [{ x: 52, y: 70 }, { x: 52, y: 10 }, { x: 80, y: 10 }]
    const edge = factory.connector({ id: 'route', role: 'edge', lineStyle: 'solid', endpoints: { from: 'A', to: 'B' }, geometry: { kind: 'polyline', points },
      ...(mode === 'affine' ? { transform: { kind: 'matrix' as const, a: 0.99, b: 0, c: 0, d: 0.99, e: 0, f: 0 } } : {}),
      paint: { stroke: mode === 'unknown-color' ? 'var(--host)' : '#111', strokeWidth: mode === 'square-cap' ? '8' : '1', strokeLinecap: mode === 'square-cap' ? 'square' : 'butt',
        strokeLinejoin: mode === 'unsupported-join' ? 'miter-clip' : 'miter', strokeMiterlimit: '4', ...(mode === 'non-scaling' ? { vectorEffect: 'non-scaling-stroke' } : {}) } })
    const geometry: Geometry = mode === 'body-crossing' ? { kind: 'rect', x: 50, y: 30, width: 4, height: 20 }
      : mode === 'join-reach' ? { kind: 'circle', cx: 51.65, cy: 9.65, r: 0.1 }
        : mode === 'square-cap' ? { kind: 'circle', cx: 43, cy: 40, r: 0.5 }
          : { kind: 'circle', cx: 40, cy: 40, r: 10 }
    const card = factory.shape({ id: 'foreign', role: 'node', geometry, paint: { fill: '#fff', stroke: '#111', strokeWidth: '0.75' } })
    const parts = [edge, card]
    return { ...scene([]), width: 200, height: 160, parts }
  }
  const doc = producer(marks, context), drawing = drawNative(producer, context, 'flowchart')
  for (const proof of [certifyScenePaint(doc), certifyNativePaint(drawing.header, drawing.paint)]) {
    expect(proof.status).toBe(mode === 'clear-body' ? 'passed' : mode === 'body-crossing' ? 'failed' : 'unverified')
    if (mode === 'clear-body') expect(proof.issues).toEqual([])
    else expect(proof.issues).toContainEqual(expect.objectContaining({ code: mode === 'body-crossing' ? 'CONNECTOR_CARD_CROSSING' : 'POTENTIAL_OCCLUSION', id: 'route', by: 'foreign' }))
  }
})

test('orthogonal stroke union leaves nonfinite geometry unmeasured', () => {
  const edge = marks.connector({ id: 'nonfinite-route', role: 'edge', lineStyle: 'solid', endpoints: { from: 'A', to: 'B' }, geometry: { kind: 'polyline', points: [{ x: 52, y: 70 }, { x: 52, y: 10 }, { x: 80, y: 10 }] }, paint: { stroke: '#111', strokeWidth: '1' } })
  const raw: SceneNode = { ...edge, route: { ...edge.route, geometry: { kind: 'polyline', points: [{ x: 52, y: Number.POSITIVE_INFINITY }, { x: 52, y: 10 }] } } }
  const proof = certifyScenePaint(scene([raw, surface()]))
  expect(proof.status).toBe('unverified')
  expect(proof.coverage.unmeasured).toBeGreaterThan(0)
})

test.each(['clear-contact', 'centroid-on-line-body', 'all-witnesses-on-stroke', 'opaque-child', 'split-cover'] as const)('an attached line piece retains the same strict marker witness for %s', mode => {
  const marker = tipAnchoredArrow('arrow', { width: 8, height: 5 }, 'end', { fill: '#111', stroke: '#111', strokeWidth: '0.75', strokeLinejoin: 'round' }, 'userSpaceOnUse')
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const body: Geometry = { kind: 'rect', x: 30, y: 30, width: 40, height: 30 }
    const internal: Geometry = mode === 'centroid-on-line-body' ? { kind: 'line', x1: 50, y1: 20, x2: 50, y2: 60 }
      : mode === 'all-witnesses-on-stroke' ? { kind: 'line', x1: 45, y1: 25, x2: 55, y2: 25 }
      : mode === 'split-cover' ? { kind: 'line', x1: 51.25, y1: 20, x2: 51.25, y2: 32 }
        : { kind: 'line', x1: 50, y1: 30, x2: 50, y2: 60 }
    const extra: Geometry[] = mode === 'opaque-child' ? [{ kind: 'rect', x: 45, y: 20, width: 10, height: 12 }]
      : mode === 'split-cover' ? [{ kind: 'rect', x: 45, y: 20, width: 5, height: 12 }] : []
    const bodyPaint = { fill: '#fff', stroke: '#111', strokeWidth: '0.75' }
    const linePaint = { fill: 'none', stroke: '#111', strokeWidth: mode === 'all-witnesses-on-stroke' ? '8' : mode === 'split-cover' ? '2' : '0.75' }
    return { ...scene([]), parts: [
      factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
      factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
      factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', endpoints: { from: 'outside', to: 'target' }, geometry: { kind: 'line', x1: 50, y1: 10, x2: 50, y2: 30 }, paint: { stroke: '#111', strokeWidth: '1' }, markers: { end: marker } }),
      factory.shape({ id: 'target', role: 'node', geometry: { kind: 'compound', children: [body, internal, ...extra] }, paint: bodyPaint, childPaints: [bodyPaint, linePaint, ...extra.map(() => bodyPaint)] }),
      factory.documentClose(),
    ] }
  }
  const doc = producer(marks, context), drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain('<line')
  for (const proof of [certifyScenePaint(doc), certifyNativePaint(drawing.header, drawing.paint)]) {
    expect(proof.status).toBe(mode === 'clear-contact' ? 'passed' : mode === 'opaque-child' ? 'failed' : 'unverified')
    if (mode === 'clear-contact') expect(proof.issues).toEqual([])
    else expect(proof.issues).toContainEqual(expect.objectContaining({ code: mode === 'opaque-child' ? 'MARKER_OCCLUDED' : 'POTENTIAL_OCCLUSION', id: 'edge', by: 'target' }))
  }
})

const opaqueNoteCore = (fill = '#fff') => marks.shape({
  id: 'note:N:body', role: 'note', owner: { id: 'N', role: 'note' },
  geometry: { kind: 'rect', x: 30, y: 20, width: 40, height: 40, rx: 2, ry: 2 }, paint: { fill },
})
const noteSubject = (id: string, x: number) => marks.shape({
  id: `subject:${id}`, role: 'node', owner: { id, role: 'node' },
  geometry: { kind: 'rect', x, y: 30, width: 10, height: 20 }, paint: { fill: '#fff' },
})
const noteCrossing = () => marks.connector({
  id: 'S-to-T', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 15, y1: 40, x2: 85, y2: 40 },
  paint: { stroke: '#111', strokeWidth: '1' },
  endpoints: { from: 'S', to: 'T', start: { owner: { id: 'S', role: 'node' } }, end: { owner: { id: 'T', role: 'node' } } },
})

test.each([false, true])('known semantic shafts cannot cross an unrelated opaque note (note paints later: %s)', later => {
  const note = opaqueNoteCore(), edge = noteCrossing()
  const proof = certifyScenePaint(scene([noteSubject('S', 5), noteSubject('T', 85), ...(later ? [edge, note] : [note, edge])]))
  expect(proof.status).toBe('failed')
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', id: 'S-to-T', by: 'note:N:body' }))
})

test('a typed annotation connector may touch its own opaque note', () => {
  const attachment = marks.connector({
    id: 'S-to-note', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 15, y1: 40, x2: 30, y2: 40 },
    paint: { stroke: '#111', strokeWidth: '1' },
    endpoints: { from: 'S', to: 'N', start: { owner: { id: 'S', role: 'node' } }, end: { owner: { id: 'N', role: 'note' } } },
  })
  expect(certifyScenePaint(scene([noteSubject('S', 5), opaqueNoteCore(), attachment])).status).toBe('passed')
})

test.each(['lifeline', 'edge'])('nonsemantic %s artwork retains an intentional note overlay', role => {
  const lifeline = marks.connector({ id: 'lifeline', role, lineStyle: 'solid', geometry: { kind: 'line', x1: 50, y1: 5, x2: 50, y2: 75 }, paint: { stroke: '#111', strokeWidth: '1' } })
  expect(certifyScenePaint(scene([lifeline, opaqueNoteCore()])).status).toBe('passed')
})

test('an ambiguous legacy note endpoint remains unverified rather than gaining an ownership exemption', () => {
  const legacy = marks.connector({
    id: 'ambiguous-note', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 15, y1: 40, x2: 85, y2: 40 },
    paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'S', to: 'N' },
  })
  const proof = certifyScenePaint(scene([noteSubject('S', 5), noteSubject('N', 85), opaqueNoteCore(), legacy]))
  expect(proof.status).toBe('unverified')
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'ambiguous-note', by: 'note:N:body' }))
  expect(proof.issues.some(issue => issue.code === 'CONNECTOR_CARD_CROSSING')).toBe(false)
})

test('a translucent note has no proved opaque core to reject a semantic shaft', () => {
  expect(certifyScenePaint(scene([noteSubject('S', 5), noteSubject('T', 85), opaqueNoteCore('rgba(255,255,255,0.4)'), noteCrossing()])).status).toBe('passed')
})

// These are ordinary polygon resources: the proof must not depend on a family
// name or marker id. The first midpoint (61,32.5) lies strictly inside the
// second fill, away from its 0.75px outline, at the covered offset.
test.each(['covered', 'separate', 'aabb-corner', 'coincident', 'rounded-tangent', 'rounded-anchor', 'rounded-end', 'rounded-vertical', 'rounded-auto-start', 'written-tangent', 'written-anchor', 'rounded-transform', 'rounded-opacity', 'rounded-dash', 'rounded-width', 'rounded-fill', 'rounded-stroke', 'collapsed-terminal', 'rounded-mid', 'different-coincident', 'owned-repaint', 'same-owner-cover', 'unknown-fill', 'transparent-fill', 'affine', 'clipped', 'nonsemantic', 'no-earlier-stroke', 'unemitted-opacity', 'later-restoration', 'overlay-repaint', 'same-color', 'thick-outline', 'unmeasured-restoration', 'late-open', 'early-open-covered', 'early-open-clear', 'no-closing-stroke', 'string-marker-units', 'vertex-only-cover', 'partial-restoration', 'no-earlier-ink'] as const)('distinct marker stroke/fill proof preserves %s', mode => {
  const first: MarkerDescriptor = { id: 'diamond-resource', shape: 'diamond', units: 'userSpaceOnUse', orient: 'auto-start-reverse',
    size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 },
    geometry: mode === 'no-closing-stroke' ? { kind: 'polyline', points: [{ x: 7, y: 1 }, { x: 13, y: 6 }, { x: 7, y: 11 }] } : ['early-open-covered', 'early-open-clear'].includes(mode) ? { kind: 'polyline', points: [{ x: 7, y: 11 }, { x: 1, y: 6 }, { x: 7, y: 1 }] } : { kind: 'polygon', points: [{ x: 7, y: 1 }, { x: 13, y: 6 }, { x: 7, y: 11 }, { x: 1, y: 6 }] },
    paint: { fill: mode === 'no-earlier-ink' ? 'none' : mode === 'vertex-only-cover' ? '#111' : mode.startsWith('early-open') || mode === 'no-closing-stroke' ? 'none' : '#fff', stroke: ['no-earlier-stroke', 'no-earlier-ink'].includes(mode) ? 'none' : '#111', strokeWidth: mode === 'aabb-corner' ? '0.25' : '1.5' } }
  if (mode === 'rounded-auto-start') first.orient = 'auto'
  const duplicate = mode.startsWith('rounded-') || ['written-tangent', 'written-anchor', 'collapsed-terminal'].includes(mode)
  let later: MarkerDescriptor = duplicate || ['coincident', 'owned-repaint'].includes(mode) ? first : { id: 'triangle-resource', shape: 'arrow', units: 'userSpaceOnUse', orient: 'auto-start-reverse', overflow: mode === 'clipped' ? 'hidden' : 'visible',
    size: { width: mode === 'clipped' ? 6 : 12, height: mode === 'clipped' ? 5 : 10 }, ref: { x: 12, y: 5 },
    geometry: { kind: mode === 'late-open' ? 'polyline' : 'polygon', points: [{ x: 0, y: 0 }, { x: 12, y: 5 }, { x: 0, y: 10 }] },
    paint: { fill: mode === 'late-open' ? 'none' : mode === 'unknown-fill' ? 'var(--host)' : mode === 'transparent-fill' ? 'rgba(255,255,255,0.5)' : mode === 'same-color' ? '#111' : '#fff', stroke: '#111', strokeWidth: mode === 'thick-outline' ? '20' : '1.5', ...(mode === 'unemitted-opacity' ? { fillOpacity: '0', strokeOpacity: '0' } : {}) } }
  if (['rounded-opacity', 'rounded-dash', 'rounded-width', 'rounded-fill', 'rounded-stroke'].includes(mode)) {
    later = { ...later, id: 'changed-resource', paint: { ...later.paint, ...(mode === 'rounded-opacity' ? { opacity: '0.5' } : mode === 'rounded-dash' ? { strokeDasharray: '1 1' } : mode === 'rounded-width' ? { strokeWidth: '4' } : mode === 'rounded-fill' ? { fill: '#f00' } : { stroke: '#fff' }) } }
  }
  if (mode === 'vertex-only-cover') { later.size = { width: 14, height: 12 }; later.ref = { x: 13, y: 6 }; later.viewBox = { x: 0, y: 0, width: 14, height: 12 }; later.geometry = first.geometry }
  if (mode === 'no-closing-stroke') { later.size = { width: 1, height: 1 }; later.ref = { x: 0.5, y: 0.5 }; later.geometry = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }] }; later.paint!.strokeWidth = '0.1' }
  if (mode === 'string-marker-units') { first.units = 'strokeWidth'; later.units = 'strokeWidth' }
  const y = mode === 'vertex-only-cover' ? 38 : ['separate', 'early-open-clear'].includes(mode) ? 55 : mode === 'aabb-corner' ? 39.5 : duplicate || ['coincident', 'different-coincident', 'owned-repaint', 'no-closing-stroke'].includes(mode) ? 30 : 33.865217391
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const connector = (id: string, marker: MarkerDescriptor, cy: number, overlay = false) => {
      const changed = id === 'later' && duplicate
      const noise = mode.startsWith('written-') ? 1e-8 : 1e-13
      const anchorNoise = changed && ['rounded-anchor', 'written-anchor', 'rounded-end'].includes(mode) ? noise : 0
      const tangentNoise = changed ? noise : 0
      const a = { x: mode === 'no-closing-stroke' && id === 'later' ? 64 : 70, y: cy + (mode === 'rounded-end' ? tangentNoise : anchorNoise) }
      const b = { x: mode === 'collapsed-terminal' && changed ? 70 + noise : 20, y: cy + (mode === 'rounded-end' ? anchorNoise : tangentNoise) }
      if (mode === 'rounded-vertical') for (const point of [a, b]) [point.x, point.y] = [point.y, point.x]
      const geometry = mode === 'rounded-mid' ? { kind: 'polyline' as const, points: [a, { x: 45, y: cy }, b] } : { kind: 'line' as const, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
      return factory.connector({ id, role: mode === 'nonsemantic' || overlay ? 'chrome' : 'edge', owner: { id: ['owned-repaint', 'same-owner-cover'].includes(mode) ? 'earlier' : overlay ? id.replace('overlay:', '') : id, role: mode === 'nonsemantic' ? 'chrome' : 'edge' },
        lineStyle: 'solid', endpoints: { from: 'shared-source', to: id }, geometry,
        ...(['affine', 'rounded-transform'].includes(mode) ? { transform: { kind: 'matrix' as const, a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 } } : {}),
        paint: { stroke: '#111', strokeWidth: mode === 'string-marker-units' ? ' 1.004000000000001px ' : '1' }, ...(overlay ? { stroke: { opacity: 0 } } : {}), markers: mode === 'rounded-mid' ? { mid: [marker] } : mode === 'rounded-end' ? { end: marker } : { start: marker } })
    }
    return { ...scene([]), parts: [
      factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
      factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(first)}${later === first ? '' : serializeMarkerResource(later)}</defs>`),
      connector('earlier', first, 30), connector('later', later, y),
      ...(mode === 'overlay-repaint' ? [connector('overlay:earlier', first, 30, true), connector('overlay:later', later, y, true)] : []),
      ...(mode === 'later-restoration' ? [factory.connector({ id: 'restorer', role: 'chrome', lineStyle: 'solid', geometry: { kind: 'polyline', points: [{ x: 64, y: 25 }, { x: 70, y: 30 }, { x: 64, y: 35 }, { x: 58, y: 30 }, { x: 64, y: 25 }] }, paint: { stroke: '#111', strokeWidth: '1' } })] : []), ...(mode === 'partial-restoration' ? [factory.connector({ id: 'partial-restorer', role: 'chrome', lineStyle: 'solid', geometry: { kind: 'polyline', points: [{ x: 60, y: 31.35 }, { x: 65.5, y: 31.35 }, { x: 65.5, y: 38.5 }, { x: 60, y: 38.5 }] }, paint: { stroke: '#111', strokeWidth: '0.1' } })] : []), ...(mode === 'unmeasured-restoration' ? [factory.shape({ id: 'unmeasured-restorer', role: 'chrome', geometry: { kind: 'rect', x: 58, y: 30, width: 10, height: 6 }, paint: { fill: 'none', stroke: '#111', strokeWidth: 'var(--host)' } })] : []), factory.documentClose(),
    ] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain(mode === 'rounded-end' ? 'marker-end' : mode === 'rounded-mid' ? 'marker-mid' : 'marker-start')
  if (mode === 'string-marker-units') expect(drawing.svg).toContain('stroke-width=" 1.004000000000001px "')
  if (mode === 'transparent-fill' || mode === 'late-open') {
    // The narrower opaque-fill loss API still proves no opaque fill loss.
    // The complete semantic pair has overlapping visible strokes, so the
    // scene's stronger all-paint separation contract must retain uncertainty.
    const connectors = producer(marks, context).parts.filter((node): node is Extract<SceneNode, { kind: 'connector' }> => node.kind === 'connector')
    expect(compareMarkerStrokeInk(prepareMarkerPolygonInk({ colors: context.colors }, connectors[0]!, first, 'start', () => true), prepareMarkerPolygonInk({ colors: context.colors }, connectors[1]!, later, 'start', () => true), () => true)).toBe('clear')
  }
  const expected = ['covered', 'different-coincident', 'same-owner-cover', 'unemitted-opacity', 'overlay-repaint', 'early-open-covered', 'string-marker-units', 'vertex-only-cover', 'partial-restoration'].includes(mode) ? 'failed' : ['unknown-fill', 'affine', 'clipped', 'later-restoration', 'same-color', 'thick-outline', 'unmeasured-restoration', 'no-closing-stroke', 'no-earlier-stroke', 'transparent-fill', 'late-open', 'written-tangent', 'written-anchor', 'rounded-transform', 'rounded-opacity', 'rounded-dash', 'rounded-width', 'rounded-fill', 'rounded-stroke', 'collapsed-terminal', 'rounded-mid'].includes(mode) ? 'unverified' : 'passed'
  for (const [execution, proof] of [certifyScenePaint(producer(marks, context)), certifyNativePaint(drawing.header, drawing.paint)].entries()) {
    expect(proof.status).toBe(expected)
    if (expected === 'failed') expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: mode === 'overlay-repaint' ? 'overlay:earlier' : 'earlier', by: mode === 'overlay-repaint' ? 'overlay:later' : 'later' }))
    else if (expected === 'unverified' && execution === 1 && ['rounded-transform', 'collapsed-terminal', 'rounded-mid'].includes(mode)) expect(proof.issues).toEqual([{ code: 'CONDITIONAL_PAINT', message: '1 primitives depend on unresolved paint or interaction state' }])
    else if (expected === 'unverified') expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'earlier', by: 'later' }))
    else expect(proof.issues).toEqual([])
  }
})

test.each(['covered-white', 'covered-same-black', 'separate', 'unknown-fill'] as const)('filled-only marker visibility retains uncertainty for %s', mode => {
  const black: MarkerDescriptor = { id: 'small-filled-marker', shape: 'diamond', units: 'userSpaceOnUse', orient: 'auto-start-reverse',
    size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 },
    geometry: { kind: 'polygon', points: [{ x: 4, y: 8 }, { x: 5, y: 9 }, { x: 4, y: 10 }, { x: 3, y: 9 }] }, paint: { fill: mode === 'unknown-fill' ? 'var(--host)' : '#000', stroke: 'none' } }
  const white: MarkerDescriptor = { id: 'large-white-marker', shape: 'arrow', units: 'userSpaceOnUse', orient: 'auto-start-reverse', overflow: 'visible',
    size: { width: 12, height: 10 }, ref: { x: 12, y: 5 }, geometry: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 12, y: 5 }, { x: 0, y: 10 }] },
    paint: { fill: mode === 'covered-same-black' ? '#000' : '#fff', stroke: '#111', strokeWidth: '1.5' } }
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...scene([]), parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
    factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(black)}${serializeMarkerResource(white)}</defs>`),
    factory.connector({ id: 'black-relation', role: 'edge', lineStyle: 'solid', endpoints: { from: 'A', to: 'B' }, geometry: { kind: 'line', x1: 70, y1: 30, x2: 20, y2: 30 }, paint: { stroke: '#111', strokeWidth: '1' }, markers: { start: black } }),
    factory.connector({ id: 'white-relation', role: 'edge', lineStyle: 'solid', endpoints: { from: 'C', to: 'D' }, geometry: { kind: 'line', x1: 70, y1: mode === 'separate' ? 55 : 33.865217391, x2: 20, y2: mode === 'separate' ? 55 : 33.865217391 }, paint: { stroke: '#111', strokeWidth: '1' }, markers: { start: white } }),
    factory.documentClose(),
  ] })
  const doc = producer(marks, context), drawing = drawNative(producer, context, 'flowchart')
  const proofs = [certifyScenePaint(doc), certifyNativePaint(drawing.header, drawing.paint)]
  for (const proof of proofs) {
    expect(proof.status).toBe(mode === 'separate' ? 'passed' : 'unverified')
    if (mode !== 'separate') expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'black-relation', by: 'white-relation' }))
  }
})


test.each(['foreign', 'owned', 'separated', 'nonpainting', 'transparent', 'same-paint', 'before', 'owned-repaint', 'empty-marker'] as const)('prepared text and canonical marker visibility retain uncertainty for %s', mode => {
  const canonical = classMarkerResources({ lineWidth: 1, edgeStrokeColor: '#47474a' } as any).find(marker => marker.id === 'cls-inherit')!
  const marker: MarkerDescriptor = mode === 'empty-marker' ? { ...canonical, paint: { fill: 'none', stroke: 'none' } } : canonical
  const block = preparePixelText('0..1', { fontSize: 11, fontWeight: 400 })
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producerWithRoot = (bindRoot: boolean): DrawingProducer => factory => {
    const carrier = () => factory.connector({ id: 'relation', role: 'relationship', endpoints: { from: 'A', to: 'B' }, lineStyle: 'solid', geometry: { kind: 'line', x1: 70, y1: 40, x2: 20, y2: 40 }, paint: { stroke: '#47474a', strokeWidth: '1' }, markers: { start: marker } })
    const label = () => factory.text({ id: 'count', role: 'cardinality', ...(mode === 'owned' || mode === 'owned-repaint' ? { owner: { id: 'relation', role: 'relationship' } } : {}), text: '0..1', block, x: 61, y: mode === 'separated' ? 65 : 40, fontSize: 11, anchor: 'middle', paint: { fill: mode === 'nonpainting' ? 'none' : mode === 'same-paint' ? '#47474a' : '#69696c', stroke: mode === 'nonpainting' ? 'none' : mode === 'same-paint' ? '#47474a' : '#fff', strokeWidth: '3', strokeLinejoin: 'round', paintOrder: 'stroke', ...(mode === 'transparent' ? { opacity: '0' } : {}) } })
    const parts = [factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"${bindRoot ? ' style="--bg:#fff;--fg:#111"' : ''}>`), factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(marker)}</defs>`), ...(mode === 'before' ? [label(), carrier()] : [carrier(), label()])]
    if (mode === 'owned-repaint') parts.push(factory.connector({ id: 'repaint', role: 'chrome', owner: { id: 'relation', role: 'relationship' }, lineStyle: 'solid', geometry: { kind: 'line', x1: 70, y1: 40, x2: 20, y2: 40 }, paint: { stroke: '#47474a', strokeWidth: '1' }, stroke: { opacity: 0 }, markers: { start: marker } }))
    parts.push(factory.documentClose())
    return { ...scene([]), parts }
  }
  const producer = producerWithRoot(false)
  const drawing = drawNative(producer, context, 'class')
  const boundDrawing = drawNative(producerWithRoot(true), context, 'class')
  expect(boundDrawing.svg.replace(' style="--bg:#fff;--fg:#111"', '')).toBe(drawing.svg)
  expect(drawing.svg).toContain('marker-start="url(#cls-inherit)"')
  const clear = ['separated', 'nonpainting', 'transparent', 'empty-marker'].includes(mode)
  const bareProof = certifyNativePaint(drawing.header, drawing.paint)
  expect(bareProof.status).toBe(mode === 'empty-marker' ? 'passed' : 'unverified')
  if (mode !== 'empty-marker') expect(bareProof.issues).toContainEqual(expect.objectContaining({ code: 'OUTPUT_SCOPE' }))
  for (const proof of [certifyScenePaint(producer(marks, context)), certifyNativePaint(boundDrawing.header, boundDrawing.paint)]) {
    expect(proof.status).toBe(clear ? 'passed' : 'unverified')
    if (clear) expect(proof.issues).toEqual([])
    else {
      const inverse = mode === 'before' || mode === 'owned-repaint'
      expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: inverse ? 'count' : 'relation', by: inverse ? mode === 'owned-repaint' ? 'repaint' : 'relation' : 'count' }))
      expect(proof.issues.some(issue => issue.code === 'MARKER_OCCLUDED' || issue.code === 'TEXT_OCCLUDED')).toBe(false)
      if (mode === 'owned-repaint') expect(proof.issues).toHaveLength(1)
    }
  }
})

test.each(['clear', 'later-stroke', 'round-join', 'affine', 'clipped', 'unknown-width', 'filled-open'] as const)('marker paint-piece separation preserves %s', mode => {
  // Literal final Class37 resource/pose pair, with no family/id exemption.
  // Independent emitted-piece readback gives0.241519px minimum all-ink gap.
  const earlier: MarkerDescriptor = {
    id: 'open-resource',
    shape: 'open-arrow',
    orient: 'auto-start-reverse',
    overflow: mode === 'clipped' ? 'hidden' : 'visible',
    size: { width: 8, height: 6 },
    ref: { x: 8, y: 3 },
    geometry: {
      kind: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 3 },
        { x: 0, y: 6 },
      ],
    },
    paint: { fill: mode === 'filled-open' ? '#111' : 'none', stroke: '#111', strokeWidth: mode === 'unknown-width' ? 'var(--host)' : '1.5', ...(mode === 'round-join' ? { strokeLinejoin: 'round' as const } : {}) },
  }
  const later: MarkerDescriptor = {
    id: 'filled-resource',
    shape: 'arrow',
    orient: 'auto-start-reverse',
    overflow: 'visible',
    size: { width: 12, height: 10 },
    ref: { x: 12, y: 5 },
    geometry: {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 12, y: 5 },
        { x: 0, y: 10 },
      ],
    },
    paint: { fill: '#fff', stroke: mode === 'later-stroke' ? '#fff' : '#111', strokeWidth: mode === 'later-stroke' ? '20' : '1.5' },
  }
  const context = { positioned: { width: 280, height: 750 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({
    ...scene([]),
    width: 280,
    height: 750,
    parts: [
      factory.documentOpen({ id: 'root', width: 280, height: 750, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="750">'),
      factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(earlier)}${serializeMarkerResource(later)}</defs>`),
      factory.connector({
        id: 'earlier',
        role: 'edge',
        owner: { id: 'earlier', role: 'edge' },
        endpoints: { from: 'A', to: 'B' },
        lineStyle: 'solid',
        geometry: { kind: 'line', x1: 196, y1: 705.9, x2: 196, y2: 645.9 },
        paint: { stroke: '#111', strokeWidth: '1' },
        stroke: { opacity: 0 },
        markers: { end: earlier },
        ...(mode === 'affine' ? { transform: { kind: 'matrix' as const, a: 1, b: 0, c: 0, d: 1, e: 0.001, f: 0 } } : {}),
      }),
      factory.connector({ id: 'later', role: 'edge', owner: { id: 'later', role: 'edge' }, endpoints: { from: 'C', to: 'D' }, lineStyle: 'solid', geometry: { kind: 'line', x1: 204, y1: 645.9, x2: 204, y2: 699.9 }, paint: { stroke: '#111', strokeWidth: '1' }, stroke: { opacity: 0 }, markers: { start: later } }),
      factory.documentClose(),
    ],
  })
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain('marker-end="url(#open-resource)"')
  expect(drawing.svg).toContain('marker-start="url(#filled-resource)"')
  if (mode === 'clear') {
    const connectors = producer(marks, context).parts.filter((node): node is Extract<SceneNode, { kind: 'connector' }> => node.kind === 'connector')
    const first = prepareMarkerPolygonInk({ colors: context.colors }, connectors[0]!, earlier, 'end', () => true)
    const second = prepareMarkerPolygonInk({ colors: context.colors }, connectors[1]!, later, 'start', () => true)
    let completeWork = 0
    expect(compareMarkerStrokeInk(first, second, () => { completeWork++; return true })).toBe('clear')
    let remaining = completeWork - 1, stopped = false
    expect(compareMarkerStrokeInk(first, second, () => {
      if (stopped) throw new Error('geometry work continued after exhaustion')
      if (--remaining < 0) { stopped = true; return false }
      return true
    })).toBe('unknown')
    expect(stopped).toBe(true)
  }
  for (const proof of [certifyScenePaint(producer(marks, context)), certifyNativePaint(drawing.header, drawing.paint)]) {
    expect(proof.status).toBe(['clear', 'round-join'].includes(mode) ? 'passed' : 'unverified')
    if (['clear', 'round-join'].includes(mode)) expect(proof.issues).toEqual([])
    else expect(proof.issues.some(issue => issue.code === 'POTENTIAL_OCCLUSION' || issue.code === 'UNMEASURED_PAINT')).toBe(true)
  }
})

test.each(['overlap', 'separated', 'empty', 'sharing', 'unknown'] as const)('stroke-only semantic marker pairs retain %s paint evidence', mode => {
  // Literal returned Native14 resources and contacts. Its lower diamond stroke
  // and later open arrow intersect near(2091.9712,163.7273); neither same RGB
  // nor the arrow's absent fill proves two distinct marker meanings visible.
  const resources = classMarkerResources({ lineWidth: 1, edgeStrokeColor: '#47474a' } as any)
  const earlier = { ...resources.find(marker => marker.id === 'cls-aggregation')!, id: 'earlier-resource' }
  const later: MarkerDescriptor = mode === 'sharing' ? earlier : {
    ...resources.find(marker => marker.id === 'cls-arrow')!, id: 'later-resource',
    paint: { fill: 'none', stroke: mode === 'empty' ? 'none' : '#47474a', strokeWidth: '1.5', ...(mode === 'unknown' ? { strokeLinecap: 'round' as const } : {}) },
  }
  const context = { positioned: { width: 2300, height: 300 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const sharing = mode === 'sharing', y = mode === 'separated' ? 186.9 : 166.9
  const producerWithRoot = (bindRoot: boolean): DrawingProducer => factory => ({
    ...scene([]), width: 2300, height: 300,
    parts: [
      factory.documentOpen({ id: 'root', width: 2300, height: 300, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, `<svg xmlns="http://www.w3.org/2000/svg" width="2300" height="300"${bindRoot ? ' style="--bg:#fff;--fg:#111"' : ''}>`),
      factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(earlier)}${sharing ? '' : serializeMarkerResource(later)}</defs>`),
      factory.connector({ id: 'earlier', role: 'relationship', owner: { id: 'earlier', role: 'relationship' }, endpoints: { from: 'A', to: 'B' }, lineStyle: 'solid', geometry: { kind: 'line', x1: 2098.968, y1: 158.9, x2: 2083.968, y2: 158.9 }, paint: { stroke: '#939395', strokeWidth: '1' }, stroke: { opacity: 0 }, markers: { start: earlier } }),
      factory.connector({ id: 'later', role: 'relationship', owner: { id: 'later', role: 'relationship' }, endpoints: { from: 'C', to: 'D' }, lineStyle: 'solid', geometry: sharing ? { kind: 'line', x1: 2098.968, y1: 158.9, x2: 2083.968, y2: 158.9 } : { kind: 'line', x1: 2083.968, y1: y, x2: 2098.968, y2: y }, paint: { stroke: '#939395', strokeWidth: '1' }, stroke: { opacity: 0 }, markers: sharing ? { start: later } : { end: later } }),
      factory.documentClose(),
    ],
  })
  const producer = producerWithRoot(false)
  const drawing = drawNative(producer, context, 'class')
  const boundDrawing = drawNative(producerWithRoot(true), context, 'class')
  expect(boundDrawing.svg.replace(' style="--bg:#fff;--fg:#111"', '')).toBe(drawing.svg)
  expect(drawing.svg).toContain(sharing ? 'marker-start="url(#earlier-resource)"' : 'marker-end="url(#later-resource)"')
  const bareProof = certifyNativePaint(drawing.header, drawing.paint)
  expect(bareProof.status).toBe('unverified')
  expect(bareProof.issues).toContainEqual(expect.objectContaining({ code: 'OUTPUT_SCOPE' }))
  for (const proof of [certifyScenePaint(producer(marks, context)), certifyNativePaint(boundDrawing.header, boundDrawing.paint)]) {
    const clear = mode === 'separated' || mode === 'empty' || sharing
    expect(proof.status).toBe(clear ? 'passed' : 'unverified')
    if (clear) expect(proof.issues).toEqual([])
    else {
      expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'earlier', by: 'later' }))
      expect(proof.issues.some(issue => issue.code === 'MARKER_OCCLUDED')).toBe(false)
    }
  }
})

test.each(['clear', 'hidden-overlap', 'unknown-view', 'aspect-mismatch', 'round-join-separated', 'opaque-covered'] as const)('hidden marker superset separation preserves %s', mode => {
  // Actual retained capacity14 marker10/11 poses; all original resource and
  // paint attributes remain unchanged in the Scene and emitted SVG.
  const resources = classMarkerResources({ lineWidth: 1, edgeStrokeColor: '#47474a' } as any)
  const earlier: MarkerDescriptor = { ...resources.find(marker => marker.id === 'cls-aggregation')!, id: 'hidden-diamond',
    ...(mode === 'unknown-view' ? { viewBox: undefined } : {}),
    ...(mode === 'aspect-mismatch' ? { size: { width: 14, height: 24 } } : {}),
    ...(mode === 'round-join-separated' ? { paint: { fill: '#fff', stroke: '#47474a', strokeWidth: '1.5', strokeLinejoin: 'round' } } : {}),
  }
  const covered = mode === 'opaque-covered'
  const later: MarkerDescriptor = { ...resources.find(marker => marker.id === (covered ? 'cls-inherit' : 'cls-arrow'))!, id: 'later-resource' }
  const y = covered ? 167.315217391 : mode === 'hidden-overlap' ? 171.45 : 176.294264046
  const context = { positioned: { width: 2300, height: 300 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producerWithRoot = (bindRoot: boolean): DrawingProducer => factory => ({ ...scene([]), width: 2300, height: 300, parts: [
    factory.documentOpen({ id: 'root', width: 2300, height: 300, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, `<svg xmlns="http://www.w3.org/2000/svg" width="2300" height="300"${bindRoot ? ' style="--bg:#fff;--fg:#111"' : ''}>`),
    factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(earlier)}${serializeMarkerResource(later)}</defs>`),
    factory.connector({ id: 'earlier', role: 'relationship', owner: { id: 'earlier', role: 'relationship' }, endpoints: { from: 'A', to: 'B' }, lineStyle: 'solid', geometry: { kind: 'line', x1: 2098.968, y1: 163.45, x2: 2083.968, y2: 163.45 }, paint: { stroke: '#939395', strokeWidth: '1' }, stroke: { opacity: 0 }, markers: { start: earlier } }),
    factory.connector({ id: 'later', role: 'relationship', owner: { id: 'later', role: 'relationship' }, endpoints: { from: 'C', to: 'D' }, lineStyle: 'solid', geometry: covered ? { kind: 'line', x1: 2098.968, y1: y, x2: 2083.968, y2: y } : { kind: 'line', x1: 2083.968, y1: y, x2: 2098.968, y2: y }, paint: { stroke: '#939395', strokeWidth: '1' }, stroke: { opacity: 0 }, markers: covered ? { start: later } : { end: later } }),
    factory.documentClose(),
  ] })
  const producer = producerWithRoot(false)
  const originalResource = JSON.stringify(earlier)
  const drawing = drawNative(producer, context, 'class')
  const boundDrawing = drawNative(producerWithRoot(true), context, 'class')
  expect(boundDrawing.svg.replace(' style="--bg:#fff;--fg:#111"', '')).toBe(drawing.svg)
  expect(drawing.svg).toContain('overflow="hidden"')
  expect(drawing.svg).toContain('markerWidth="14"')
  if (mode === 'clear') {
    expect(drawing.svg).toContain('viewBox="0 0 14 12" overflow="hidden"')
    const before = JSON.stringify(earlier)
    const connector = producer(marks, context).parts.find((node): node is Extract<SceneNode, { kind: 'connector' }> => node.kind === 'connector')!
    let calls = 0
    expect(prepareMarkerPolygonInk({ colors: context.colors }, connector, earlier, 'start', () => { calls++; return false })).toBeUndefined()
    expect(calls).toBe(1)
    expect(JSON.stringify(earlier)).toBe(before)
  }
  const bareProof = certifyNativePaint(drawing.header, drawing.paint)
  expect(bareProof.status).toBe(mode === 'round-join-separated' ? 'passed' : covered ? 'failed' : 'unverified')
  if (mode !== 'round-join-separated') expect(bareProof.issues).toContainEqual(expect.objectContaining({ code: 'OUTPUT_SCOPE' }))
  for (const proof of [certifyScenePaint(producer(marks, context)), certifyNativePaint(boundDrawing.header, boundDrawing.paint)]) {
    // Round-join padding already proves these particular envelopes separate;
    // unsupported extra stencil proof must not erase that earlier authority.
    const clear = mode === 'clear' || mode === 'round-join-separated'
    expect(proof.status).toBe(clear ? 'passed' : covered ? 'failed' : 'unverified')
    if (clear) expect(proof.issues).toEqual([])
    else expect(proof.issues).toContainEqual(expect.objectContaining({ code: covered ? 'MARKER_OCCLUDED' : 'POTENTIAL_OCCLUSION', id: 'earlier', by: 'later' }))
    if (!covered) expect(proof.issues.some(issue => issue.code === 'MARKER_OCCLUDED')).toBe(false)
  }
  expect(JSON.stringify(earlier)).toBe(originalResource)
})

test.each(['LR', 'RL'] as const)('ELK cyclic15 uses the serialized terminal pose for shared markers in %s', direction => {
  const source = readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-15.mmd', import.meta.url), 'utf8').replace(/^flowchart LR/, `flowchart ${direction}`)
  const result = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' }, security: 'strict', embedFontImport: false })
  expect(result.receipt.layoutCertification?.status).toBe('passed')
  expect(result.receipt.layoutCertification?.issues).toEqual([])
  expect(result.svg.match(/data-role="edge"/g)).toHaveLength(31)
  expect(result.svg.match(/data-marker-end="arrow"/g)).toHaveLength(31)
  expect(result.svg).toContain('data-from="n6" data-to="n11"')
  expect(result.svg).toContain('data-from="n4" data-to="n11"')
})


test.each(['exact', 'rounded'].flatMap(pose => ['known', 'known-vars', 'known-transform', 'context-stroke', 'context-fill', 'currentColor', 'inherited', 'unknown-var', 'mixed-fill', 'mixed-stroke', 'omitted-fill', 'omitted-stroke', 'opacity-var', 'width-var', 'offset-var'].map(paint => [pose, paint] as const)))('shared marker repaint keeps %s pose and %s paint distinct', (pose, mode) => {
  const paint: MarkPaint = { fill: '#fff', stroke: '#111', strokeWidth: '1.5' }
  if (['context-stroke', 'context-fill', 'currentColor', 'inherited', 'unknown-var'].includes(mode)) paint.fill = paint.stroke = mode === 'inherited' ? 'inherit' : mode === 'unknown-var' ? 'var(--host)' : mode
  if (mode === 'known-vars') { paint.fill = 'var(--bg)'; paint.stroke = 'var(--fg)' }
  if (mode === 'mixed-fill') paint.fill = 'context-stroke'
  if (mode === 'mixed-stroke') paint.stroke = 'context-stroke'
  if (mode === 'omitted-fill') delete paint.fill
  if (mode === 'omitted-stroke') delete paint.stroke
  if (mode === 'opacity-var') paint.opacity = 'var(--host)'
  if (mode === 'width-var') paint.strokeWidth = 'var(--host)'
  if (mode === 'offset-var') paint.strokeDashoffset = 'var(--host)'
  const marker: MarkerDescriptor = { id: 'shared-resource', shape: 'diamond', units: 'userSpaceOnUse', orient: 'auto-start-reverse', overflow: 'visible', size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 }, geometry: { kind: 'polygon', points: [{ x: 7, y: 1 }, { x: 13, y: 6 }, { x: 7, y: 11 }, { x: 1, y: 6 }] }, paint }
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...scene([]), parts: [
    factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"${mode === 'known-vars' ? ' style="--bg:#fff;--fg:#111"' : ''}>`),
    factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    ...['earlier', 'later'].map(id => factory.connector({ id, role: 'edge', owner: { id, role: 'edge' }, lineStyle: 'solid', endpoints: { from: 'shared-source', to: id }, geometry: { kind: 'line', x1: 70, y1: 30, x2: 20, y2: pose === 'rounded' && id === 'later' ? 30 + 1e-13 : 30 }, paint: { stroke: id === 'earlier' ? '#111' : '#fff', strokeWidth: '1' }, ...(mode === 'known-transform' ? { transform: { kind: 'matrix' as const, a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 } } : {}), markers: { start: marker } })),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg.match(/id="shared-resource"/g)).toHaveLength(1)
  expect(drawing.svg.match(/<line x1="70" y1="30" x2="20" y2="30"/g)).toHaveLength(2)
  const expected = ['known', 'known-vars'].includes(mode) || mode === 'known-transform' && pose === 'exact' ? 'passed' : 'unverified'
  for (const [execution, proof] of [certifyScenePaint(producer(marks, context)), certifyNativePaint(drawing.header, drawing.paint)].entries()) {
    expect(proof.status).toBe(expected)
    if (expected === 'unverified' && execution === 1 && mode === 'known-transform' && pose === 'rounded') expect(proof.issues).toEqual([{ code: 'CONDITIONAL_PAINT', message: '1 primitives depend on unresolved paint or interaction state' }])
    else if (expected === 'unverified') expect(proof.issues.some(issue => issue.code === 'POTENTIAL_OCCLUSION' || issue.code === 'UNMEASURED_PAINT')).toBe(true)
    else expect(proof.issues).toEqual([])
  }
  if (mode === 'known-vars') {
    const unbound: DrawingProducer = (factory, ctx) => producer({ ...factory, documentOpen: (fields, svg) => factory.documentOpen(fields, svg.replace(' style="--bg:#fff;--fg:#111"', '')) }, ctx)
    const absent = drawNative(unbound, context, 'flowchart')
    expect(absent.svg).toBe(drawing.svg.replace(' style="--bg:#fff;--fg:#111"', ''))
    const proof = certifyNativePaint(absent.header, absent.paint)
    expect(proof.status).toBe('unverified')
    expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'OUTPUT_SCOPE' }))
  }
  if (mode === 'omitted-stroke') for (const served of [drawing, drawPaintControl(producer, context, 'scene')]) {
    const polygon = rectangleEmissionElements(served.svg).find(element => element.name === 'polygon')!.attributes
    expect(polygon.fill).toBe('#fff')
    expect(polygon.stroke).toBeUndefined()
    const removed = served.svg.replace(/ marker-start="url\(#shared-resource\)"/g, '')
    const foreground = served.svg.replace('fill="#fff" stroke-width="1.5"', 'fill="#fff" stroke="#111" stroke-width="1.5"')
    const raster = (svg: string) => new Resvg(svg, { background: '#fff', fitTo: { mode: 'zoom', value: 4 } }).render()
    const actual = raster(served.svg), absent = raster(removed).pixels, contrasting = raster(foreground).pixels
    const pixels = actual.pixels
    let offShaft = 0, positive = 0
    for (let y = 22 * 4; y < 38 * 4; y++) for (let x = 54 * 4; x < 75 * 4; x++) {
      if (Math.abs((y + 0.5) / 4 - 30) <= 1.5) continue
      const offset = (y * actual.width + x) * 4
      if (!pixels.subarray(offset, offset + 4).equals(absent.subarray(offset, offset + 4))) offShaft++
      if (contrasting[offset]! < absent[offset]! || contrasting[offset + 1]! < absent[offset + 1]! || contrasting[offset + 2]! < absent[offset + 2]!) positive++
    }
    expect(offShaft).toBe(0)
    expect(positive).toBeGreaterThan(0)
    const proof = 'proof' in served ? served.proof : certifyNativePaint(served.header, served.paint)
    expect(proof.status).toBe('unverified')
  }

})
