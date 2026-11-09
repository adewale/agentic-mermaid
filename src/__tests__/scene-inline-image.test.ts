import { drawNative } from '../scene/native-drawing.ts'
import type { DrawingProducer } from '../scene/drawing.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { RoughBackend } from '../scene/rough-backend.ts'
import { HybridBackend } from '../scene/hybrid-backend.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
import { expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { certifyNativePaint, certifyScenePaint } from '../scene/paint-certification.ts'
import { inspectScenePrimitives } from '../scene/inspection.ts'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
const fields = { id: 'image', role: 'icon' as const, href: png, x: 4, y: 8, width: 32, height: 24, fit: 'contain' as const }

test('typed PNG writes its actual resource and viewport without claiming raster paint', () => {
  const image = marks.image(fields)
  expect(sceneNodeSerialization(image)).toContain(`<image href="${png}" x="4" y="8" width="32" height="24" preserveAspectRatio="xMidYMid meet"`)
  const scene = { family: 'flowchart', width: 60, height: 50, colors: { bg: '#fff', fg: '#111' }, transparent: false, parts: [image] }
  const inspection = inspectScenePrimitives(scene)
  expect(inspection.primitives[0]).toMatchObject({ kind: 'image', coverage: 'unmeasured', reason: 'raster-paint-unavailable' })
  expect(inspection.primitives[0]?.bounds).toBeUndefined()
  expect(certifyScenePaint(scene).status).toBe('unverified')
})

test.each(['#raster-resource', 'https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,bm90IGEgcG5n', 'javascript:alert(1)'])('typed raster refuses unsupported resources: %s', href => {
  expect(() => marks.image({ ...fields, href })).toThrow(/PNG/)
})

test('mutable resource and getter-backed viewport are read at actual serialization', () => {
  const image = marks.image(fields)
  let width = 18
  Object.defineProperty(image, 'width', { enumerable: true, configurable: true, get: () => width })
  expect(sceneNodeSerialization(image)).toContain('width="18"')
  width = 23
  image.fit = 'stretch'
  expect(sceneNodeSerialization(image)).toContain('width="23" height="24" preserveAspectRatio="none"')
  image.href = 'https://example.com/changed.png'
  expect(() => sceneNodeSerialization(image)).toThrow(/PNG/)
})

test('native image occurrences retain their own bytes and never borrow vector or definitions paint', () => {
  const header = { family: 'flowchart', width: 100, height: 60, colors: { bg: '#fff', fg: '#111' }, transparent: false }
  const shared = { ...fields, attributes: { data: { occurrence: 'first' } } }
  let actualWidth = 32
  Object.defineProperty(shared, 'width', { enumerable: true, get: () => actualWidth })
  const producer: DrawingProducer = factory => {
    const open = factory.documentOpen({ id: 'root', ...header, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60">')
    const defs = factory.definitions({ id: 'defs' }, '<defs></defs>')
    const first = factory.image(shared)
    actualWidth = 16
    shared.x = 45
    shared.attributes.data.occurrence = 'second'
    const second = factory.image({ ...shared, id: 'second' })
    const card = factory.shape({ id: 'card', role: 'node', geometry: { kind: 'rect', x: 80, y: 10, width: 10, height: 10 }, paint: { fill: '#fff', stroke: '#111', strokeWidth: '1' } })
    return { ...header, parts: [open, defs, first, second, card, factory.documentClose()] }
  }
  const drawing = drawNative(producer, { positioned: { width: 100, height: 60 }, colors: header.colors, resolved: { renderOptions: {} } }, 'flowchart')
  const images = drawing.svg.match(/<image\b[^>]*\/>/g)!
  expect(images).toHaveLength(2)
  expect(images[0]).toContain('x="4" y="8" width="32"')
  expect(images[0]).toContain('data-occurrence="first"')
  expect(images[1]).toContain('x="45" y="8" width="16"')
  expect(images[1]).toContain('data-occurrence="second"')
  expect(drawing.paint.primitives.filter(part => part.kind === 'image').map(part => [part.coverage, part.bounds])).toEqual([['unmeasured', undefined], ['unmeasured', undefined]])
  expect(certifyNativePaint(drawing.header, drawing.paint).status).toBe('unverified')
  expect(certifyScenePaint({ ...header, parts: [marks.shape({ id: 'clear', role: 'node', geometry: { kind: 'rect', x: 80, y: 10, width: 10, height: 10 }, paint: { fill: '#fff', stroke: '#111', strokeWidth: '1' } })] }).status).toBe('passed')
})

test.each([DefaultBackend, RoughBackend, HybridBackend])('$id preserves raster resource and fit as crisp artwork', backend => {
  const image = marks.image({ ...fields, fit: 'stretch', attributes: { data: { media: 'literal' } } })
  expect(backend.drawNode(image, { seed: 17 })).toBe(sceneNodeSerialization(image))
})

test('image viewport validation stays separate from unknown painted bounds', () => {
  const image = marks.image(fields)
  image.width = -1
  expect(() => sceneNodeSerialization(image)).toThrow(/viewport/)
  image.width = 32
  const doc = { family: 'flowchart', width: 12, height: 12, colors: { bg: '#fff', fg: '#111' }, transparent: false, parts: [image] }
  expect(validateSceneDoc(doc).valid).toBe(false)
  expect(inspectScenePrimitives(doc).primitives[0]?.coverage).toBe('unmeasured')
})

