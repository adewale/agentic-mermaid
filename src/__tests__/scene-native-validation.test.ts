import { expect, test } from 'bun:test'
import { Resvg } from '@resvg/resvg-js'
import { fileURLToPath } from 'node:url'
import { SaxesParser } from 'saxes'
import * as marks from '../scene/marks.ts'
import { assertFinalSvgByteBudget, createNativeSceneValidator, SCENE_VALIDATION_LIMITS, SceneValidationError } from '../scene/scene-validation.ts'
import { inspectSvgOnce, withSvgInspectionCache } from '../svg-inspection-cache.ts'
import { deferredTerminalProjectionInput, withDeferredTerminalProjections } from '../scene/deferred-terminal-projection.ts'
import { serializeLinearGradientResources } from '../scene/gradient-resources.ts'
import type { LinearGradientDescriptor, MarkPaint, SceneDoc, SceneNode } from '../scene/ir.ts'
import { drawNative } from '../scene/native-drawing.ts'
import { certifyNativePaint, certifyScenePaint } from '../scene/paint-certification.ts'
import { serializeMarkerResource, tipAnchoredArrow } from '../scene/marker-resources.ts'
import type { DrawingProducer } from '../scene/drawing.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { admitSceneDocument } from '../scene/external-data-snapshot.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { createSceneWriteCapture, sceneNodeSerialization } from '../scene/serialization.ts'
import { MAX_OCCLUSION_OPERATIONS } from '../scene/paint-work.ts'

const header: Omit<SceneDoc, 'parts'> = { family: 'flowchart', width: 200, height: 100, colors: { bg: '#fff', fg: '#111' }, transparent: false }
const shape = (id = 'A') => marks.shape({ id, role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } })
const label = (text: string, id = 'label') => marks.text({ id, role: 'label', text, x: 10, y: 20, fontSize: 0.1, anchor: 'start', paint: { fill: '#111' } })

test.each(['clear', 'covered', 'non-enumerable-paint', 'mutate-after-emission', 'getter-after-emission', 'same-object-two-writes'] as const)('native paint certifies actual emitted occurrences for %s', mode => {
  const marker = tipAnchoredArrow('occurrence-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const geometry = { kind: 'rect' as const, x: mode === 'clear' ? 90 : 40, y: 10, width: 35, height: 70 }
  let getterX = geometry.x
  if (mode === 'getter-after-emission') Object.defineProperty(geometry, 'x', { enumerable: true, configurable: true, get() { return getterX } })
  const paint = { fill: '#fff' }
  if (mode === 'non-enumerable-paint') Object.defineProperty(paint, 'fill', { value: '#fff', enumerable: false, writable: false, configurable: false })
  const fields = { id: 'cover', role: 'node' as const, geometry, paint }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">')
    const definitions = factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`)
    const edge = factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } })
    const first = factory.shape(fields)
    if (mode === 'mutate-after-emission' || mode === 'same-object-two-writes') geometry.x = 90
    if (mode === 'getter-after-emission') getterX = 90
    // Reuse the SAME fields and geometry objects. The first occurrence remains
    // the opaque rectangle already emitted at x40, even after another write.
    const parts = [open, definitions, edge, first]
    if (mode === 'same-object-two-writes') {
      fields.id = 'later'
      parts.push(factory.shape(fields))
    }
    parts.push(factory.documentClose())
    return { ...header, parts }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  const rectangles = scanSvgStartTags(drawing.svg).filter(tag => tag.name === 'rect').map(tag => Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])))
  const first = rectangles.find(rectangle => rectangle['data-id'] === 'cover')!
  expect(first).toMatchObject({ x: mode === 'clear' ? '90' : '40', y: '10', width: '35', height: '70', fill: '#fff' })
  if (mode === 'same-object-two-writes') expect(rectangles.find(rectangle => rectangle['data-id'] === 'later')).toMatchObject({ x: '90' })
  // The literal user-space arrow fill occupies x42..50, y37.5..42.5.
  // It is entirely inside the EMITTED x40..75 opaque first rectangle in
  // every non-clear case. Later aliases cannot make those pixels visible.
  const proof = certifyNativePaint(drawing.header, drawing.paint)
  if (mode === 'clear') expect(proof.status).toBe('passed')
  else expect(proof.status).not.toBe('passed')
})

test('a geometry kind changing during capture cannot replace emitted polygon ink with a line', () => {
  let kindReads = 0
  const geometry = new Proxy({ kind: 'polygon' as const, points: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 70 }], x1: 10.00000000000001, y1: 10, x2: 90, y2: 10 }, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      return key === 'kind' && ++kindReads === 1 ? { ...descriptor, value: 'line' } : descriptor
    },
  })
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...header, parts: [
    factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'),
    factory.shape({ id: 'polygon', role: 'node', geometry, paint: { fill: '#fff' } }),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain('<polygon points="10,10 90,10 90,70" fill="#fff"')
  expect(drawing.paint.primitives.find(primitive => primitive.id === 'polygon')?.bounds).toEqual({ x0: 10, y0: 10, x1: 90, y1: 70 })
  expect(certifyNativePaint(drawing.header, drawing.paint).status).not.toBe('passed')
})

test.each(['after-connector', 'before-connector'] as const)('native marker paint retains actual resource bytes when its descriptor changes %s', when => {
  const marker = tipAnchoredArrow('resource-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">')
    const definitions = factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`)
    if (when === 'before-connector') marker.paint!.fill = 'none'
    const edge = factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } })
    if (when === 'after-connector') marker.paint!.fill = 'none'
    return { ...header, parts: [open, definitions, edge,
      factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } }),
      factory.documentClose(),
    ] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  const tags = scanSvgStartTags(drawing.svg)
  const polygon = tags.find(tag => tag.name === 'polygon')!
  expect(Object.fromEntries(polygon.attributes.map(attribute => [attribute.name, attribute.value]))).toMatchObject({ points: '0 0, 8 2.5, 0 5', fill: '#000' })
  expect(drawing.svg).toContain('marker-end="url(#resource-arrow)"')
  // The emitted resource remains opaque. Its later descriptor cannot make
  // the fully covered actual arrow disappear from the proof obligation.
  expect(certifyNativePaint(drawing.header, drawing.paint).status).not.toBe('passed')
})

test.each(['matching', 'conflicting'] as const)('a later marker reference preserves %s declared resource custody', mode => {
  const declared = tipAnchoredArrow('shared-arrow', { width: 8, height: 5 }, 'end', { fill: mode === 'matching' ? '#000' : 'none' }, 'userSpaceOnUse')
  const referenced = tipAnchoredArrow('shared-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const resource = '<marker id="shared-arrow" markerWidth="8" markerHeight="5" refX="8" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">\n  <polygon points="0 0, 8 2.5, 0 5" fill="#000" />\n</marker>'
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...header, parts: [
    factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'),
    factory.definitions({ id: 'markers', markerResources: [declared] }, `<defs>${resource}</defs>`),
    factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'card' }, markers: { end: referenced } }),
    factory.shape({ id: 'card', role: 'node', geometry: { kind: 'rect', x: 90, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } }),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg.split(resource)).toHaveLength(2)
  const tags = scanSvgStartTags(drawing.svg)
  const attributes = (name: string) => tags.filter(tag => tag.name === name).map(tag => Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])))
  expect(attributes('marker')).toEqual([{ id: 'shared-arrow', markerWidth: '8', markerHeight: '5', refX: '8', refY: '2.5', orient: 'auto', markerUnits: 'userSpaceOnUse' }])
  expect(attributes('polygon')).toEqual([{ points: '0 0, 8 2.5, 0 5', fill: '#000' }])
  expect(attributes('line')).toEqual([expect.objectContaining({ x1: '20', y1: '40', x2: '50', y2: '40', 'marker-end': 'url(#shared-arrow)' })])
  expect(attributes('rect')).toEqual([expect.objectContaining({ x: '90', width: '35', fill: '#fff' })])
  // Both modes leave the literal black arrow at x42..50 clear. A
  // later matching reference cannot erase an earlier declaration mismatch.
  const proof = certifyNativePaint(drawing.header, drawing.paint)
  expect(proof.status).toBe(mode === 'matching' ? 'passed' : 'unverified')
  if (mode === 'conflicting') expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'OUTPUT_SCOPE' }))
})

test('native emitted group ownership is retained or refused after owner mutation', () => {
  const owner = { id: 'cover', role: 'node' as const }
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">')
    const artwork = factory.shape({ id: 'cover-artwork', role: 'node', identity: false, owner, geometry: { kind: 'rect', x: 90, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } })
    const group = factory.group({ id: 'cover', role: 'node', owner, open: '<g data-id="cover">', close: '</g>', children: [{ node: artwork, indent: 2 }] })
    owner.id = 'different'
    return { ...header, parts: [open, group, factory.documentClose()] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  expect(scanSvgStartTags(drawing.svg).some(tag => tag.name === 'g' && tag.attributes.some(attribute => attribute.name === 'data-id' && attribute.value === 'cover'))).toBe(true)
  const proof = certifyNativePaint(drawing.header, drawing.paint)
  if (proof.status === 'passed') {
    const artwork = drawing.paint.primitives.find(primitive => primitive.id === 'cover-artwork')!
    expect(artwork.owner).toEqual({ id: 'cover', role: 'node' })
  } else expect(proof.status).toBe('unverified')
})

test.each(['after-drawing', 'after-document-open'] as const)('native actual stylesheet cannot be replaced by palette mutation %s', when => {
  const colors = { bg: '#fff', fg: '#111', surface: '#fff' }
  const marker = tipAnchoredArrow('palette-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" style="--bg:#fff;--fg:#111;--surface:#fff">')
    if (when === 'after-document-open') colors.surface = '#ffffff00'
    return { ...header, colors, parts: [open,
      factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
      factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } }),
      factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 35, height: 70 }, paint: { fill: 'var(--surface)' } }),
      factory.documentClose(),
    ] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  if (when === 'after-drawing') colors.surface = '#ffffff00'
  const tags = scanSvgStartTags(drawing.svg)
  const root = tags.find(tag => tag.name === 'svg')!
  expect(root.attributes.find(attribute => attribute.name === 'style')?.value).toBe('--bg:#fff;--fg:#111;--surface:#fff')
  const body = tags.find(tag => tag.name === 'rect' && tag.attributes.some(attribute => attribute.name === 'data-id' && attribute.value === 'cover'))!
  expect(Object.fromEntries(body.attributes.map(attribute => [attribute.name, attribute.value]))).toMatchObject({ x: '40', width: '35', fill: 'var(--surface)' })
  // The SAME emitted stylesheet still makes the covering body opaque white.
  expect(certifyNativePaint(drawing.header, drawing.paint).status).not.toBe('passed')
})

test.each([4_000, 50_000])('a clear admitted immutable native polyline retains final paint certification with %i points', pointCount => {
  const colors = Object.freeze({ bg: '#fff', fg: '#111' })
  const points = Array.from({ length: pointCount }, (_, index) => Object.freeze({ x: index + 40, y: 40 }))
  Object.freeze(points)
  const geometry = Object.freeze({ kind: 'polyline' as const, points })
  const fields = Object.freeze({ id: 'clear-polyline', role: 'chrome' as const, geometry, paint: Object.freeze({ fill: 'none', stroke: '#111', strokeWidth: '1' }) })
  const width = Math.max(5_000, pointCount + 80)
  const context = { positioned: { width, height: 100 }, colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...header, width, colors, parts: [
    factory.documentOpen({ id: 'root', width, height: 100, colors, transparent: false, font: 'Inter', hasMonoFont: false }, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="100">`),
    factory.shape(fields),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  const polyline = scanSvgStartTags(drawing.svg).find(tag => tag.name === 'polyline')!
  const attributes = Object.fromEntries(polyline.attributes.map(attribute => [attribute.name, attribute.value]))
  expect(attributes).toMatchObject({ fill: 'none', stroke: '#111', 'stroke-width': '1' })
  expect(attributes.points!.trim().split(/\s+/)).toHaveLength(pointCount)
  expect(Object.isFrozen(points) && points.every(point => Object.isFrozen(point))).toBe(true)
  const proof = certifyNativePaint(drawing.header, drawing.paint)
  expect(proof.status, JSON.stringify(proof.issues)).toBe('passed')
})

test.each([
  // mode, XML validity, Resvg admission, paint certification
  ['ordinary', true, true, true],
  ['whitespace', true, true, true],
  ['plain-text', true, true, true],
  ['grouped-marker', true, true, true],
  ['spaced-title', true, true, true],
  ['selfclosing-desc', true, true, true],
  ['valid-references-unicode', true, true, true],
  ['unique-metadata', true, true, true],
  ['namespace-distinct-control', true, true, true],
  ['no-marker', true, true, true],
  ['prefix-text', false, false, false],
  ['prefix-angle', false, false, false],
  ['suffix-angle', false, false, false],
  ['early-close-text', false, false, false],
  ['trailing-shape', false, false, false],
  ['trailing-text', false, false, false],
  ['trailing-group', false, false, false],
  ['unknown-reference', false, false, false],
  ['raw-ampersand', false, false, false],
  ['raw-angle', false, false, false],
  ['zero-reference', false, false, false],
  // Resvg accepts this forbidden XML scalar; XML admission remains separate.
  ['surrogate-reference', false, true, false],
  ['control-character', false, false, false],
  ['namespace-three-decode-alias', false, false, false],
  ['namespace-literal-whitespace-alias', false, false, false],
  ['different-viewport', true, true, false],
  ['transparent-root', true, true, false],
] as const)('native paint preserves actual emitted root context for %s', (mode, validXml, validResvg, positive) => {
  const marker = tipAnchoredArrow('viewport-custody-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const root = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'
  const openings: Record<string, string> = {
    whitespace: ` \t\r\n${root}\n\t `,
    'plain-text': `${root}stray`,
    'spaced-title': `${root}<title >x</title >`,
    'selfclosing-desc': `${root}<desc/>`,
    'prefix-text': `stray${root}`,
    'prefix-angle': `<${root}`,
    'suffix-angle': `${root}<`,
    'early-close-text': `${root}</svg>stray`,
    'valid-references-unicode': root.replace('>', ' data-note="&amp;&#x3A9;&#128578; café">'),
    'unknown-reference': root.replace('>', ' data-note="&unknown;">'),
    'raw-ampersand': root.replace('>', ' data-note="A&B">'),
    'raw-angle': root.replace('>', ' data-note="A<B">'),
    'zero-reference': root.replace('>', ' data-note="&#0;">'),
    'surrogate-reference': root.replace('>', ' data-note="&#xD800;">'),
    'control-character': root.replace('>', ' data-note="\u0001">'),
    'different-viewport': '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="100">',
    'transparent-root': '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" opacity="0">',
  }
  const opening = openings[mode] ?? root
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, opening)
    const definitions = factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`)
    const edge = factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, ...(mode === 'no-marker' ? {} : { markers: { end: marker } }) })
    const artwork = mode === 'grouped-marker' ? factory.group({ id: 'edge-group', role: 'chrome', open: '<g>', close: '</g>', children: [{ node: edge, indent: 2 }] }) : edge
    const parts = [open, definitions, artwork,
      factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 90, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } }),
    ]
    if (mode === 'unique-metadata') parts.push(
      factory.documentText({ id: 'title', element: 'title', domId: 'title-unique', text: 'Ω & 🙂' }),
      factory.documentText({ id: 'desc', element: 'description', domId: 'desc-unique', text: 'clear marker' }),
    )
    const namespaceMetadata: Record<string, string> = {
      'namespace-distinct-control': '<title xmlns:p="urn:first" xmlns:q="urn:second" p:a="1" q:a="2">namespace metadata</title>',
      'namespace-three-decode-alias': '<title xmlns:p="urn:&#38;amp;amp;#x61;" xmlns:q="urn:&amp;amp;amp;#x61;" p:a="1" q:a="2">namespace metadata</title>',
      'namespace-literal-whitespace-alias': '<title xmlns:p="urn:\tu" xmlns:q="urn: u" p:a="1" q:a="2">namespace metadata</title>',
    }
    if (namespaceMetadata[mode]) parts.push(factory.documentContent({ id: 'metadata', role: 'chrome', nonPaint: 'accessibility' }, namespaceMetadata[mode]!))
    parts.push(factory.documentClose())
    if (mode === 'trailing-shape') parts.push(factory.shape({ id: 'trailing', role: 'chrome', geometry: { kind: 'rect', x: 150, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } }))
    if (mode === 'trailing-text') parts.push(factory.text({ id: 'trailing', role: 'label', text: 'Outside', block: preparePixelText('Outside', { fontSize: 10, fontWeight: 400 }), x: 150, y: 20, fontSize: 10, anchor: 'start', paint: { fill: '#111' } }))
    if (mode === 'trailing-group') parts.push(factory.group({ id: 'trailing', role: 'chrome', open: '<g>', close: '</g>', children: [{ node: factory.shape({ id: 'group-artwork', role: 'chrome', geometry: { kind: 'rect', x: 150, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } }), indent: 2 }] }))
    return { ...header, parts }
  }
  if (mode === 'namespace-three-decode-alias' || mode === 'namespace-literal-whitespace-alias') {
    // Invalid metadata now fails its own admission before it can be composed
    // with unrelated painting occurrences into a final document.
    expect(() => drawNative(producer, context, 'flowchart')).toThrow(/closed non-painting metadata/)
    return
  }
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg.startsWith(opening)).toBe(true)
  const xml = () => new SaxesParser({ xmlns: true }).write(drawing.svg).close()
  const parse = () => new Resvg(drawing.svg, { font: { loadSystemFonts: false } })
  // Check the complete artifact with an independent XML consumer before
  // inspecting its certificate. Scanner acceptance is not XML validity.
  if (validXml) expect(xml).not.toThrow()
  else expect(xml).toThrow()
  if (validResvg) expect(parse).not.toThrow()
  else expect(parse).toThrow()
  if (positive) {
    const pixels = parse().render().pixels
    let dark = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3]! > 0 && pixels[index]! < 80 && pixels[index + 1]! < 80 && pixels[index + 2]! < 80) dark++
    }
    expect(dark).toBeGreaterThan(0)
    // (42,38) is inside the arrow fill, above the horizontal shaft. The
    // no-marker control keeps the same shaft and clear supporting body.
    const markerPixel = (38 * 200 + 42) * 4
    expect(Array.from(pixels.slice(markerPixel, markerPixel + 4))).toEqual(mode === 'no-marker' ? [0, 0, 0, 0] : [0, 0, 0, 255])
  }
  const emittedRoot = scanSvgStartTags(drawing.svg).find(tag => tag.name === 'svg')!
  expect(Object.fromEntries(emittedRoot.attributes.map(attribute => [attribute.name, attribute.value]))).toMatchObject(mode === 'different-viewport' ? { width: '30', height: '100' } : { width: '200', height: '100' })
  if (mode === 'transparent-root') expect(emittedRoot.attributes.find(attribute => attribute.name === 'opacity')?.value).toBe('0')
  expect(emittedRoot.attributes.some(attribute => attribute.name === 'viewBox')).toBe(false)
  // The narrow standalone viewport clips the marker's x42..50 fill; opacity0
  // instead hides it inside a matching viewport. Neither emitted root is
  // described by the typed 200px opaque canvas used for paint checking.
  const proof = certifyNativePaint(drawing.header, drawing.paint)
  if (positive) expect(proof.status, JSON.stringify(proof.issues)).toBe('passed')
  else expect(proof.status).not.toBe('passed')
  if (!validXml) expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'OUTPUT_SCOPE' }))
})

test.each((['title', 'desc'] as const).flatMap(element => (['native', 'scene'] as const).map(execution => ({ element, execution }))))('$execution admission requires each non-painting $element fragment to close before actual marker ink', ({ element, execution }) => {
  const marker = tipAnchoredArrow('metadata-scope-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer = (split: boolean): DrawingProducer => factory => ({ ...header, parts: [
    factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'),
    factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.shape({ id: 'A', role: 'node', geometry: { kind: 'rect', x: 5, y: 20, width: 10, height: 40 }, paint: { fill: '#fff' } }),
    factory.shape({ id: 'B', role: 'node', geometry: { kind: 'rect', x: 90, y: 20, width: 10, height: 40 }, paint: { fill: '#fff' } }),
    factory.documentContent({ id: 'metadata-before', role: 'chrome', nonPaint: 'accessibility' }, split ? `<${element}>` : `<${element}>Relation metadata</${element}>`),
    factory.connector({ id: 'edge', role: 'edge', endpoints: { from: 'A', to: 'B' }, lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 60, y2: 40 }, paint: { stroke: '#000' }, markers: { end: marker } }),
    factory.documentContent({ id: 'metadata-after', role: 'chrome', nonPaint: 'accessibility' }, split ? `</${element}>` : ''),
    factory.documentClose(),
  ] })
  const raw = producer(true)<SceneNode>(marks, context)
  const hiddenSvg = raw.parts.map(sceneNodeSerialization).join('\n')
  expect(() => new SaxesParser({ xmlns: true }).write(hiddenSvg).close()).not.toThrow()
  expect(hiddenSvg).toContain(`<${element}>\n<line `)
  const reference = ' marker-end="url(#metadata-scope-arrow)"'
  expect(hiddenSvg.split(reference)).toHaveLength(2)
  const exposedSvg = hiddenSvg.replace(`<${element}>\n`, '').replace(`\n</${element}>`, '')
  const pixels = (svg: string) => new Resvg(svg, { background: '#fff', font: { loadSystemFonts: false } }).render().pixels
  const changedPixels = (first: Uint8Array, second: Uint8Array): number => {
    let changed = 0
    for (let index = 0; index < first.length; index += 4) {
      if (first[index] !== second[index] || first[index + 1] !== second[index + 1]
        || first[index + 2] !== second[index + 2] || first[index + 3] !== second[index + 3]) changed++
    }
    return changed
  }
  // Balanced whole-document XML can still place the real carrier inside
  // descriptive metadata. Its declared marker then contributes no pixels.
  expect(changedPixels(pixels(hiddenSvg), pixels(hiddenSvg.replace(reference, '')))).toBe(0)
  expect(changedPixels(pixels(exposedSvg), pixels(exposedSvg.replace(reference, '')))).toBeGreaterThan(0)

  let visibleSvg: string
  if (execution === 'native') {
    const visible = drawNative(producer(false), context, 'flowchart')
    visibleSvg = visible.svg
    expect(certifyNativePaint(visible.header, visible.paint).status).toBe('passed')
  } else {
    const capture = createSceneWriteCapture(MAX_OCCLUSION_OPERATIONS)
    const visible = admitSceneDocument(producer(false)<SceneNode>(marks, context), 'internal', true, capture.observe)
    visibleSvg = DefaultBackend.render(visible, { seed: 0 })
    expect(certifyScenePaint(visible, undefined, { sceneWriteReceipt: capture.finish(visible) }).status).toBe('passed')
  }
  expect(changedPixels(pixels(visibleSvg), pixels(visibleSvg.replace(reference, '')))).toBeGreaterThan(0)
  withSvgInspectionCache(() => {
    const opening = `<${element}>`
    inspectSvgOnce('start-tags', opening, () => [])
    inspectSvgOnce('xml-envelope', `<svg xmlns="http://www.w3.org/2000/svg">${opening}</svg>`, () => true)
    expect(() => execution === 'native' ? drawNative(producer(true), context, 'flowchart') : admitSceneDocument(raw, 'internal', true)).toThrow(SceneValidationError)
  })
})

test('native paint inspects the same document occurrence roster that it emits', () => {
  const marker = tipAnchoredArrow('roster-arrow', { width: 8, height: 5 }, 'end', { fill: '#000' }, 'userSpaceOnUse')
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">')
    const definitions = factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`)
    const edge = factory.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 20, y1: 40, x2: 50, y2: 40 }, paint: { stroke: '#000' }, endpoints: { from: 'outside', to: 'cover' }, markers: { end: marker } })
    const cover = factory.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 40, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } })
    const clear = factory.shape({ id: 'other', role: 'node', geometry: { kind: 'rect', x: 90, y: 10, width: 35, height: 70 }, paint: { fill: '#fff' } })
    const close = factory.documentClose()
    const coveredParts = [open, definitions, edge, cover, close]
    const clearParts = [open, definitions, edge, clear, close]
    let reads = 0
    return { ...header, get parts() { return ++reads <= 2 ? coveredParts : clearParts } }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  const cover = scanSvgStartTags(drawing.svg).find(tag => tag.name === 'rect' && tag.attributes.some(attribute => attribute.name === 'data-id' && attribute.value === 'cover'))!
  expect(cover).toBeDefined()
  expect(Object.fromEntries(cover.attributes.map(attribute => [attribute.name, attribute.value]))).toMatchObject({ x: '40', width: '35', fill: '#fff' })
  // This emitted occurrence covers the complete black marker. Inspecting a
  // different fragment returned by a later roster read cannot certify it.
  expect(certifyNativePaint(drawing.header, drawing.paint).status).not.toBe('passed')
})

test('native admission resolves companion labels and owners submitted after connectors', () => {
  const validator = createNativeSceneValidator(header)
  validator.node(marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 10, x2: 20, y2: 20 }, paint: { stroke: '#111' }, owner: { id: 'A', role: 'node' }, labels: [{ text: 'Hello', visual: { kind: 'companion', markId: 'label' } }] }))
  validator.node(label('Hello'))
  expect(validator.node(shape())).toContain('<rect ')
  const result = validator.finish()
  expect(result).toEqual({ valid: true, diagnostics: [] })
  expect(validator.finish()).toBe(result)
  expect(() => validator.node(shape('late'))).toThrow(/already finished/)

  const missing = createNativeSceneValidator(header)
  missing.node(marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 10, x2: 20, y2: 20 }, paint: { stroke: '#111' }, owner: { id: 'missing-owner', role: 'node' }, labels: [{ text: 'Hello', visual: { kind: 'companion', markId: 'missing-label' } }] }))
  expect(missing.finish().diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'SCENE_REFERENCE', path: expect.stringContaining('.owner') }),
    expect.objectContaining({ code: 'SCENE_REFERENCE', path: expect.stringContaining('.visual.markId') }),
  ]))
})

test('native owned artwork requires its reported matching semantic enclosure', () => {
  for (const enclosing of [undefined, 'A', 'B']) {
    const validator = createNativeSceneValidator(header)
    validator.node(marks.shape({ id: 'frame:A', role: 'node', identity: false, owner: { id: 'A', role: 'node' }, geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } }))
    validator.node(marks.group({ id: 'wrapper:A', role: 'node', open: '<g data-id="A">', close: '</g>', children: [] }))
    if (enclosing) validator.enclosure('frame:A', { id: enclosing, role: 'node' })
    const result = validator.finish()
    expect(result.valid).toBe(enclosing === 'A')
    if (enclosing !== 'A') expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_FIDELITY', path: 'scene.parts[0].identity' }))
  }
})

test('native admission refuses invalid geometry, headers, depth and retained group trees immediately', () => {
  expect(() => createNativeSceneValidator({ ...header, width: Number.NaN })).toThrow(SceneValidationError)
  expect(() => createNativeSceneValidator({ ...header, colors: { ...header.colors, font: 'url(https://example.com/font)' } })).toThrow(SceneValidationError)
  const validator = createNativeSceneValidator(header)
  const invalid = shape()
  if (invalid.geometry.kind !== 'rect') throw new Error('Expected rect')
  invalid.geometry.width = Number.NaN
  expect(() => validator.node(invalid)).toThrow(SceneValidationError)
  expect(validator.finish().diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_FINITE', path: 'scene.parts[0].geometry.width' }))
  expect(() => createNativeSceneValidator(header).depth(SCENE_VALIDATION_LIMITS.maxDepth + 1)).toThrow(SceneValidationError)
  expect(() => createNativeSceneValidator(header).node(shape(), -1)).toThrow(SceneValidationError)
  expect(() => createNativeSceneValidator(header).node(marks.group({ id: 'tree', role: 'group', open: '<g>', close: '</g>', children: [{ node: shape(), indent: 2 }] }))).toThrow(/shallow/)
})

test('native numeric admission retains field reads and ordered diagnostics at finite and extent boundaries', () => {
  const validator = createNativeSceneValidator(header)
  const node = shape()
  const reads: string[] = []
  const values = { x: Number.NaN, y: Infinity, width: -SCENE_VALIDATION_LIMITS.maxExtent - 1, height: SCENE_VALIDATION_LIMITS.maxExtent + 1, rx: -0, ry: 0 }
  for (const [field, value] of Object.entries(values)) {
    Object.defineProperty(node.geometry, field, { configurable: true, get() { reads.push(field); return value } })
  }
  expect(() => validator.node(node)).toThrow(SceneValidationError)
  expect(reads).toEqual(['x', 'y', 'width', 'height', 'rx', 'rx', 'ry', 'ry'])
  expect(validator.finish().diagnostics).toEqual([
    { code: 'SCENE_FINITE', path: 'scene.parts[0].geometry.x', message: 'must be a finite number' },
    { code: 'SCENE_FINITE', path: 'scene.parts[0].geometry.y', message: 'must be a finite number' },
    { code: 'SCENE_BOUNDS', path: 'scene.parts[0].geometry.width', message: 'must be non-negative' },
    { code: 'SCENE_BOUNDS', path: 'scene.parts[0].geometry.width', message: 'must not exceed 1000000 user units' },
    { code: 'SCENE_BOUNDS', path: 'scene.parts[0].geometry.height', message: 'must not exceed 1000000 user units' },
  ])
  const boundary = shape()
  if (boundary.geometry.kind !== 'rect') throw new Error('Expected rect')
  boundary.geometry.x = -SCENE_VALIDATION_LIMITS.maxExtent
  boundary.geometry.width = -0
  boundary.geometry.height = SCENE_VALIDATION_LIMITS.maxExtent
  const accepted = createNativeSceneValidator(header)
  accepted.node(boundary)
  expect(accepted.finish()).toEqual({ valid: true, diagnostics: [] })
  expect(Object.is(boundary.geometry.width, -0)).toBe(true)
})

test('native admission resolves local paint resources and refuses undeclared resources', () => {
  const gradient: LinearGradientDescriptor = { id: 'paint', units: 'userSpaceOnUse', x1: 0, y1: 0, x2: 20, y2: 0, stops: [{ offset: 0, color: '#111' }, { offset: 1, color: '#fff' }] }
  for (const declared of [false, true]) {
    const validator = createNativeSceneValidator(header)
    validator.node(marks.shape({ id: 'gradient', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: 'url(#paint)' } }))
    if (declared) validator.node(marks.definitions({ id: 'definitions', gradientResources: [gradient] }, `<defs>\n${serializeLinearGradientResources([gradient])}\n</defs>`))
    const result = validator.finish()
    expect(result.valid).toBe(declared)
    if (!declared) expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_REFERENCE', path: 'scene.parts[0].paint.fill' }))
  }
})

test('native text and point budgets accumulate across transient leaves', () => {
  const text = createNativeSceneValidator(header)
  const textMark = Object.freeze(label('x'.repeat(40_000)))
  for (let index = 0; index < 50; index++) text.node(textMark)
  expect(() => text.node(textMark)).toThrow(/aggregate 2000000-byte/)

  const points = createNativeSceneValidator(header)
  const line = (id: string, count: number) => marks.shape({ id, role: 'chrome', geometry: { kind: 'polyline', points: Array.from({ length: count }, (_, index) => ({ x: index % 100, y: 10 })) }, paint: { stroke: '#111' } })
  points.node(line('first', 25_000))
  points.node(line('second', 25_000))
  expect(() => points.node(line('third', 2))).toThrow(/aggregate 50000-point/)
})

test('native admission enforces per-fragment and aggregate serialization limits', () => {
  expect(() => createNativeSceneValidator(header).serialization('x'.repeat(SCENE_VALIDATION_LIMITS.maxSerializationBytesPerNode + 1))).toThrow(/oversized SVG serialization/)
  const validator = createNativeSceneValidator(header)
  const chunk = `<metadata>${'x'.repeat(4_100_000)}</metadata>`
  for (let index = 0; index < 3; index++) validator.node(marks.documentContent({ id: `metadata:${index}`, role: 'chrome' }, chunk))
  expect(() => validator.node(marks.documentContent({ id: 'metadata:over', role: 'chrome' }, chunk))).toThrow(/aggregate 16000000-byte/)
  const oversized = 'x'.repeat(SCENE_VALIDATION_LIMITS.maxFinalSvgBytes + 1)
  withSvgInspectionCache(() => {
    // An untyped probe must not corrupt shared accounting so a forged result
    // for otherwise uncacheable oversized output can become budget authority.
    let reads = 0
    const forgedSource = Object.defineProperty({}, 'length', { get() { reads++; return -oversized.length } })
    inspectSvgOnce('probe', forgedSource as unknown as string, () => false)
    inspectSvgOnce('final-svg-budget', oversized, () => true)
    expect(() => assertFinalSvgByteBudget(oversized)).toThrow(/final SVG limit/)
    expect(reads).toBe(0)
  })
})

test('native admission bounds total node count even when each leaf is tiny', () => {
  const validator = createNativeSceneValidator(header)
  const node = marks.documentClose()
  for (let index = 0; index < SCENE_VALIDATION_LIMITS.maxNodes; index++) validator.node(node)
  expect(() => validator.node(node)).toThrow(/too many Scene nodes/)
})


test('native transient connector validation leaves its registered derived projection unevaluated', () => {
  const edge = () => withDeferredTerminalProjections(() => marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 10, x2: 20, y2: 20 }, paint: { stroke: '#111' } }))
  for (const crossChecks of [false, true]) {
    const node = edge()
    expect(deferredTerminalProjectionInput(node)).toBeDefined()
    const validator = createNativeSceneValidator(header, { crossChecks })
    validator.node(node)
    expect(validator.finish().valid).toBe(true)
    expect(deferredTerminalProjectionInput(node) !== undefined).toBe(!crossChecks)
  }
  const invalid = edge()
  invalid.route.bendRadius = Number.NaN
  expect(() => createNativeSceneValidator(header).node(invalid)).toThrow(SceneValidationError)
  expect(deferredTerminalProjectionInput(invalid)).toBeDefined()

  // Only terminal projection copies arbitrary marker metadata by value. Paint
  // capture uses descriptors; a changed scalar line must preserve that laziness.
  let projectionReads = 0
  const marker = new Proxy({ ...tipAnchoredArrow('deferred-arrow', { width: 8, height: 5 }, 'end', { fill: '#111' }, 'userSpaceOnUse'), projectionTrace: 0 }, {
    get(target, key, receiver) {
      if (key === 'projectionTrace') projectionReads++
      return Reflect.get(target, key, receiver)
    },
  })
  const fields = { id: 'fractional-edge', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 10.00000000000001, y1: 10, x2: 20, y2: 10 }, paint: { stroke: '#111' }, markers: { end: marker } }
  const context = { positioned: { width: 200, height: 100 }, colors: header.colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => ({ ...header, parts: [
    factory.documentOpen({ id: 'root', width: 200, height: 100, colors: header.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'),
    factory.definitions({ id: 'markers' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
    factory.connector(fields),
    factory.documentClose(),
  ] })
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain('<line x1="10" y1="10" x2="20" y2="10"')
  expect(certifyNativePaint(drawing.header, drawing.paint).status).toBe('passed')
  expect(projectionReads).toBe(0)
  const terminal = withDeferredTerminalProjections(() => marks.connector(fields))
  void terminal.terminalProjection
  expect(projectionReads).toBeGreaterThan(0)
})


test('native resource limits accumulate across otherwise admissible definitions', () => {
  const validator = createNativeSceneValidator(header)
  const definition = (start: number, count: number) => {
    const gradientResources: LinearGradientDescriptor[] = Array.from({ length: count }, (_, index) => ({ id: `g${start + index}`, units: 'userSpaceOnUse', x1: 0, y1: 0, x2: 20, y2: 0, stops: [{ offset: 0, color: '#111' }, { offset: 1, color: '#fff' }] }))
    return marks.definitions({ id: `definitions:${start}`, gradientResources }, `<defs>\n${serializeLinearGradientResources(gradientResources)}\n</defs>`)
  }
  validator.node(definition(0, 5_000))
  validator.node(definition(5_000, 5_000))
  expect(() => validator.node(definition(10_000, 1))).toThrow(/10000 aggregate gradient resources/)
})

test.each((['circle', 'line'] as const).flatMap(geometry => (['native', 'scene'] as const).map(execution => ({ geometry, execution }))))('$execution paint keeps emitted $geometry occlusion after late inherited optional fields', ({ geometry, execution }) => {
  type Mode = 'covered' | 'late-transform' | 'wrong-id' | 'late-opacity' | 'late-fill-opacity' | 'late-stroke-opacity' | 'late-fill' | 'late-stroke' | 'late-owner' | 'rect-control' | 'explicit-transform' | 'mutable-before-admission'
  const width = 400, height = 160, colors = { bg: '#fff', fg: '#111' }
  const context = { positioned: { width, height }, colors, resolved: { renderOptions: {} } }
  const translated = { kind: 'matrix' as const, a: 1, b: 0, c: 0, d: 1, e: 120, f: 0 }
  const arrow = tipAnchoredArrow('late-field-arrow', { width: 8, height: 5 }, 'end', { fill: '#111', stroke: 'none', opacity: '1', fillOpacity: '1', strokeOpacity: '1' }, 'userSpaceOnUse')
  const draw = (mode: Mode) => {
    const field = mode === 'late-opacity' ? 'opacity' : mode === 'late-fill-opacity' ? 'fillOpacity' : mode === 'late-stroke-opacity' ? 'strokeOpacity' : mode === 'late-fill' ? 'fill' : mode === 'late-stroke' ? 'stroke' : mode === 'late-owner' ? 'owner' : 'transform'
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, field)
    let installed = false, inheritedPaint = '#fff'
    const install = () => {
      Object.defineProperty(Object.prototype, field, { configurable: true, get() {
        if (field === 'opacity' || field === 'fillOpacity' || field === 'strokeOpacity') {
          const fill = Object.getOwnPropertyDescriptor(this, 'fill')
          return fill && Object.hasOwn(fill, 'value') && fill.value === '#fff' ? '0' : undefined
        }
        if (field === 'fill' || field === 'stroke') {
          const width = Object.getOwnPropertyDescriptor(this, 'strokeWidth')
          return width && Object.hasOwn(width, 'value') && width.value === (geometry === 'circle' ? '0' : '28') ? inheritedPaint : undefined
        }
        const target = mode === 'wrong-id' ? 'different-cover' : 'white-cover'
        if ((this as { id?: string }).id !== target) return undefined
        return field === 'owner' ? { id: 'ordinary-edge', role: 'edge' } : translated
      } })
      installed = true
    }
    const producer: DrawingProducer = factory => {
      const open = factory.documentOpen({ id: 'root', width, height, colors, transparent: false, font: 'Inter', hasMonoFont: false }, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`)
      const definitions = factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(arrow)}</defs>`)
      const nodes = [20, 150].map((x, index) => factory.shape({ id: index ? 'B' : 'A', role: 'node', geometry: { kind: 'rect', x, y: 50, width: 30, height: 30 }, paint: { fill: '#fff', stroke: '#111', strokeWidth: '1' } }))
      const edge = factory.connector({ id: 'ordinary-edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 50, y1: 65, x2: 150, y2: 65 }, paint: { stroke: '#111', strokeWidth: '1' }, endpoints: { from: 'A', to: 'B' }, markers: { end: arrow } })
      const labels = ['A', 'B'].map((text, index) => factory.text({ id: `label:${text}`, role: 'label', text, block: preparePixelText(text, { fontSize: 12, fontWeight: 400 }), x: index ? 165 : 35, y: 65, fontSize: 12, anchor: 'middle', paint: { fill: '#111' } }))
      const coverPaint: MarkPaint = geometry === 'line' && mode !== 'rect-control' ? { fill: '#fff', stroke: '#fff', strokeWidth: '28' } : { fill: '#fff', stroke: 'none', strokeWidth: '0' }
      if (mode === 'late-fill' || mode === 'late-stroke') { delete coverPaint[mode === 'late-fill' ? 'fill' : 'stroke']; install() }
      const cover = factory.shape({ id: 'white-cover', role: 'chrome', geometry: mode === 'rect-control' ? { kind: 'rect', x: 132, y: 51, width: 28, height: 28 }
        : geometry === 'circle' ? { kind: 'circle', cx: 146, cy: 65, r: 14 } : { kind: 'line', x1: 146, y1: 45, x2: 146, y2: 85 },
      paint: coverPaint,
      ...(mode === 'explicit-transform' ? { transform: translated } : {}) })
      const close = factory.documentClose()
      // Both actual writes precede the prototype change. These getters must
      // not rewrite absent fields on retained occurrences or proof operands.
      if (mode === 'late-fill' || mode === 'late-stroke') inheritedPaint = 'none'
      else if (['late-transform', 'wrong-id', 'late-opacity', 'late-fill-opacity', 'late-stroke-opacity', 'late-owner', 'rect-control'].includes(mode)) install()
      return { family: 'flowchart', width, height, colors, transparent: false, parts: [open, definitions, ...nodes, edge, ...labels, cover, close] }
    }
    try {
      if (execution === 'native') {
        const drawing = drawNative(producer, context, 'flowchart')
        return { svg: drawing.svg, proof: certifyNativePaint(drawing.header, drawing.paint) }
      }
      const raw = producer<SceneNode>(marks, context)
      if (mode === 'mutable-before-admission') {
        const cover = raw.parts.find(node => node.id === 'white-cover')!
        if (cover.kind === 'shape' && cover.geometry.kind === 'circle') cover.geometry.cx += 120
        else if (cover.kind === 'shape' && cover.geometry.kind === 'line') { cover.geometry.x1 += 120; cover.geometry.x2 += 120 }
      }
      const capture = createSceneWriteCapture(MAX_OCCLUSION_OPERATIONS)
      const admitted = admitSceneDocument(raw, 'internal', true, capture.observe)
      const receipt = capture.finish(admitted)
      return { svg: DefaultBackend.render(admitted, { seed: 0 }), proof: certifyScenePaint(admitted, undefined, { sceneWriteReceipt: receipt }) }
    } finally {
      if (installed) {
        if (previous) Object.defineProperty(Object.prototype, field, previous)
        else delete (Object.prototype as Record<string, unknown>)[field]
      }
    }
  }
  const pixels = (svg: string) => new Resvg(svg, { background: '#fff', font: { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().pixels
  const changed = (a: Uint8Array, b: Uint8Array) => { let count = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) count++; return count }
  const reference = ' marker-end="url(#late-field-arrow)"'
  const clean = draw('covered'), late = draw('late-transform')
  expect(late.svg).toBe(clean.svg)
  const elements: Array<{ name: string; attributes: Record<string, string> }> = []
  const parser = new SaxesParser({ xmlns: false })
  parser.on('opentag', tag => { elements.push({ name: tag.name, attributes: tag.attributes as Record<string, string> }) })
  parser.write(late.svg).close()
  expect(elements.find(element => element.attributes['data-id'] === 'ordinary-edge')?.attributes).toMatchObject({ x1: '50', y1: '65', x2: '150', y2: '65', 'data-from': 'A', 'data-to': 'B', 'marker-end': 'url(#late-field-arrow)' })
  const cover = geometry === 'circle' ? /<circle cx="146" cy="65" r="14"[^>]*\/>/ : /<line x1="146" y1="45" x2="146" y2="85"[^>]*\/>/
  expect(late.svg.match(cover)?.[0]).not.toContain('transform=')
  expect(changed(pixels(late.svg), pixels(late.svg.replace(reference, '')))).toBe(0)
  const exposed = late.svg.replace(cover, '')
  expect(changed(pixels(exposed), pixels(exposed.replace(reference, '')))).toBeGreaterThan(0)
  for (const text of ['A', 'B']) expect(changed(pixels(late.svg), pixels(late.svg.replace(new RegExp('<text\\b[^>]*>' + text + '</text>'), '')))).toBeGreaterThan(0)
  for (const result of [clean, late, ...(['wrong-id', 'late-opacity', 'late-owner', 'rect-control'] as const).map(draw)]) {
    expect(result.proof.checks.operations).toBeLessThan(400_000)
    expect(result.proof.issues.some(issue => issue.code === 'CHECK_BUDGET')).toBe(false)
    expect(result.proof.status).not.toBe('passed')
  }
  for (const mode of ['late-fill-opacity', 'late-stroke-opacity', 'late-fill', 'late-stroke'] as const) {
    const result = draw(mode), headPixels = changed(pixels(result.svg), pixels(result.svg.replace(reference, '')))
    expect(result.proof.checks.operations).toBeLessThan(400_000)
    if (execution === 'scene' && geometry === 'line' && mode === 'late-stroke') {
      // Scene admission copies own fields before its actual write. Its
      // omitted stroke draws no later eraser and keeps the arrow visible.
      expect(headPixels).toBeGreaterThan(0)
      expect(result.proof.status, JSON.stringify(result.proof.issues)).toBe('passed')
    } else {
      expect(headPixels).toBe(0)
      expect(result.proof.status).not.toBe('passed')
    }
  }
  for (const mode of execution === 'scene' ? ['explicit-transform', 'mutable-before-admission'] as const : ['explicit-transform'] as const) {
    const visible = draw(mode)
    expect(changed(pixels(visible.svg), pixels(visible.svg.replace(reference, '')))).toBeGreaterThan(0)
    expect(visible.proof.status, JSON.stringify(visible.proof.issues)).toBe('passed')
  }
})
