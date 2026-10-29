import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { Resvg } from '@resvg/resvg-js'
import { SaxesParser } from 'saxes'
import * as marks from '../scene/marks.ts'
import type { DrawingProducer } from '../scene/drawing.ts'
import { drawNative } from '../scene/native-drawing.ts'
import { certifyNativePaint, certifyScenePaint } from '../scene/paint-certification.ts'
import { createSceneWriteCapture } from '../scene/serialization.ts'
import { admitSceneDocument } from '../scene/external-data-snapshot.ts'
import { MAX_OCCLUSION_OPERATIONS } from '../scene/native-paint-emission.ts'
import { serializeMarkerResource, tipAnchoredArrow } from '../scene/marker-resources.ts'
import { prepareWrittenCompoundShape, observeWrittenCompoundShape, completeWrittenCompoundShape } from '../scene/written-geometry.ts'
import { writeShapeSvg } from '../scene/svg-writer.ts'
import { inspectSvgOnce, withSvgInspectionCache } from '../svg-inspection-cache.ts'
import { describe, expect, test } from 'bun:test'
import { DefaultBackend, getFamily, validateSceneDoc } from '../agent/index.ts'
import { resolveRenderRequest, resolvedFamilyRenderContextOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import type { Geometry, MarkPaint, SceneNode, ShapeMark } from '../scene/ir.ts'

function fixture(shapeSource: string) {
  const request = resolveRenderRequest(`flowchart LR\n${shapeSource}`, { embedFontImport: false }, 'svg')
  const family = getFamily('flowchart')!
  const layout = positionResolvedFamily('flowchart', request)
  const scene = family.lowerScene!({ positioned: layout.positioned, colors: request.appearance.colors,
    resolved: resolvedFamilyRenderContextOf(request) })
  let shape: ShapeMark | undefined
  const visit = (node: SceneNode): void => {
    if (node.kind === 'shape' && node.geometry.kind === 'compound') shape = node
    if (node.kind === 'group') for (const child of node.children) visit(child.node)
  }
  scene.parts.forEach(visit)
  if (!shape?.childPaints) throw new Error('Expected actual native compound child paints')
  return { scene, shape, paints: shape.childPaints }
}

describe('compound child paint compatibility', () => {
  test.each(['A[[Subroutine]]', 'A[(Database)]'])('%s uses complete child paint instead of parent defaults', source => {
    const { scene, shape, paints } = fixture(source)
    shape.paint.stroke = '#f00'
    shape.paint.strokeWidth = '9'
    delete paints[1]!.stroke
    delete paints[1]!.strokeWidth
    expect(validateSceneDoc(scene).valid).toBe(true)
    const svg = DefaultBackend.render(scene, { seed: 0 })
    const lines = scanSvgStartTags(svg).filter(tag => tag.name === 'line')
    expect(lines).toHaveLength(2)
    const first = new Map(lines[0]!.attributes.map(attribute => [attribute.name, attribute.value]))
    const second = new Map(lines[1]!.attributes.map(attribute => [attribute.name, attribute.value]))
    expect(first.has('stroke')).toBe(false)
    expect(first.has('stroke-width')).toBe(false)
    expect(second.get('stroke')).toBe('var(--_node-stroke)')
    expect(second.get('stroke-width')).toBe('0.75')
    expect(Object.isFrozen(paints[1])).toBe(false)
  })

  test.each([
    ['A[[Subroutine]]', [0]],
    ['A[(Database)]', [3, 4]],
  ] as const)('%s keeps parent and child surface paints independent', (source, indices) => {
    const { scene, shape, paints } = fixture(source)
    for (const index of indices) expect(paints[index]).not.toBe(shape.paint)
    if (indices.length === 2) expect(paints[indices[0]!]).not.toBe(paints[indices[1]!])
    shape.paint.strokeWidth = '9'
    for (const index of indices) expect(paints[index]!.strokeWidth).toBe('0.75')
    expect(validateSceneDoc(scene).valid).toBe(true)
    const svg = DefaultBackend.render(scene, { seed: 0 })
    const surfaces = scanSvgStartTags(svg).filter(tag => source.includes('Subroutine') ? tag.name === 'rect' : tag.name === 'ellipse')
    expect(surfaces).toHaveLength(indices.length)
    for (const surface of surfaces) {
      expect(new Map(surface.attributes.map(attribute => [attribute.name, attribute.value])).get('stroke-width')).toBe('0.75')
    }
  })
})

// The authored card has an opaque outer rectangle and two separate vertical
// bars. A head at a bar/outer-face intersection must retain visible ink; a bar
// that extends into that head or a later cover must not borrow that contact.
test.each(['native', 'scene'] as const)('actual three-piece writes preserve top/bottom head ink and reject full-union occlusion (%s)', execution => {
  for (const mode of ['top', 'bottom', 'inward', 'extended-bar', 'extra-piece', 'foreign-cover'] as const) {
    const colors = { bg: '#fff', fg: '#111' }, width = 180, height = 140
    const context = { positioned: { width, height }, colors, resolved: { renderOptions: {} } }
    const marker = tipAnchoredArrow('three-piece-head', { width: 8, height: 5 }, 'end', { fill: '#111', stroke: '#111', strokeWidth: '0.75', strokeLinejoin: 'round' })
    const bottom = mode === 'bottom', face = bottom ? 77.115 : 40.215
    const tip = mode === 'inward' ? face + 1 : face
    const producer: DrawingProducer = factory => {
      const children: Geometry[] = [
        { kind: 'rect', x: 30.125, y: 40.215, width: 100.23, height: 36.9, rx: 0, ry: 0 },
        { kind: 'line', x1: 38.125, y1: 40.215, x2: 38.125, y2: 77.115 },
        { kind: 'line', x1: 122.355, y1: mode === 'extended-bar' ? 25 : 40.215, x2: 122.355, y2: 77.115 },
      ]
      const childPaints: MarkPaint[] = [{ fill: '#fff', stroke: '#111', strokeWidth: '0.75' }, { stroke: '#111', strokeWidth: '0.75' }, { stroke: '#111', strokeWidth: mode === 'extended-bar' ? '20' : '0.75', strokeLinecap: 'round' }]
      if (mode === 'extra-piece') { children.push({ kind: 'rect', x: 112, y: 28, width: 22, height: 15 }); childPaints.push({ fill: '#fff', stroke: 'none' }) }
      return { family: 'flowchart', width, height, colors, transparent: false, parts: [
        factory.documentOpen({ id: 'root', width, height, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="140" viewBox="0 0 180 140">'),
        factory.definitions({ id: 'defs' }, `<defs>${serializeMarkerResource(marker)}</defs>`),
        factory.connector({ id: 'incoming', role: 'edge', lineStyle: 'solid', endpoints: { from: 'outside', to: 'card' }, geometry: { kind: 'line', x1: 122.355, y1: bottom ? 110 : 10, x2: 122.355, y2: tip }, paint: { stroke: '#111', strokeWidth: '1' }, markers: { end: marker } }),
        factory.shape({ id: 'card', role: 'node', geometry: { kind: 'compound', children }, paint: { fill: '#fff' }, childPaints }),
        ...(mode === 'foreign-cover' ? [factory.shape({ id: 'unrelated', role: 'chrome', geometry: { kind: 'rect', x: 112, y: 28, width: 22, height: 15 }, paint: { fill: '#fff', stroke: 'none' } })] : []),
        factory.documentClose(),
      ] }
    }
    let svg: string, proof: ReturnType<typeof certifyNativePaint>
    if (execution === 'native') {
      const drawing = drawNative(producer, context, 'flowchart'); svg = drawing.svg; proof = certifyNativePaint(drawing.header, drawing.paint)
    } else {
      const capture = createSceneWriteCapture(MAX_OCCLUSION_OPERATIONS, { fractionalCircleOutput: true })
      const admitted = admitSceneDocument(producer(marks, context), 'internal', true, capture.observe)
      const receipt = capture.finish(admitted); svg = DefaultBackend.render(admitted, { seed: 0 }); proof = certifyScenePaint(admitted, undefined, { sceneWriteReceipt: receipt })
    }
    // Independently read the actual XML, with literal authored coordinates.
    const elements: Array<{ name: string; attrs: Record<string, string> }> = [], parser = new SaxesParser({ xmlns: false })
    parser.on('opentag', tag => elements.push({ name: tag.name, attrs: tag.attributes as Record<string, string> })); parser.write(svg).close()
    const card = elements.find(e => e.name === 'rect' && e.attrs['data-id'] === 'card')
    expect(card?.attrs).toMatchObject({ x: '30.125', y: '40.215', width: '100.23', height: '36.9', 'stroke-width': '0.75' })
    const route = elements.find(e => e.attrs['data-id'] === 'incoming')!
    expect(route.attrs['marker-end']).toBe('url(#three-piece-head)')
    expect(route.attrs.y2).toBe(String(tip))
    const token = ' marker-end="url(#three-piece-head)"'
    expect(svg.split(token)).toHaveLength(2)
    const image = new Resvg(svg).render(), original = image.pixels, absent = new Resvg(svg.replace(token, '')).render().pixels
    let changed = 0
    for (let i = 0; i < original.length; i += 4) if (original[i] !== absent[i] || original[i + 1] !== absent[i + 1] || original[i + 2] !== absent[i + 2] || original[i + 3] !== absent[i + 3]) changed++
    if (mode === 'top' || mode === 'bottom') { expect(changed).toBeGreaterThan(0); expect(proof.status).toBe('passed'); expect(proof.issues).toEqual([]) }
    else { expect(proof.status).not.toBe('passed'); if (mode !== 'inward') expect(changed).toBe(0) }
  }
})

test('three-piece write authority consumes actual fresh fragment tokens rather than caller-primed public cache', () => {
  const node = marks.shape({ id: 'fresh-card', role: 'node', geometry: { kind: 'compound', children: [
    { kind: 'rect', x: 30.125, y: 40.215, width: 100.23, height: 36.9, rx: 0, ry: 0 },
    { kind: 'line', x1: 38.125, y1: 40.215, x2: 38.125, y2: 77.115 },
    { kind: 'line', x1: 122.355, y1: 40.215, x2: 122.355, y2: 77.115 },
  ] }, paint: { fill: '#fff' }, childPaints: [{ fill: '#fff', stroke: '#111', strokeWidth: '0.75' }, { stroke: '#111', strokeWidth: '0.75' }, { stroke: '#111', strokeWidth: '0.75' }] })
  const pay = () => true
  const write = () => {
    const token = prepareWrittenCompoundShape(node, pay)
    if (!token) throw Error('Expected structural three-piece capture')
    const svg = writeShapeSvg(node, (source, written) => observeWrittenCompoundShape(token, source, written, pay))
    return { token, svg }
  }
  const first = write()
  expect(completeWrittenCompoundShape(first.token, node.geometry, first.svg, pay)?.geometry.children).toHaveLength(3)
  const second = write(), forged = second.svg.replace('fill="#fff"', 'fill="none"')
  expect(forged).not.toBe(second.svg)
  withSvgInspectionCache(() => {
    inspectSvgOnce('start-tags', forged, () => scanSvgStartTags(second.svg))
    expect(completeWrittenCompoundShape(second.token, node.geometry, forged, pay)).toBeUndefined()
  })
  expect(completeWrittenCompoundShape(first.token, node.geometry, first.svg, pay)).toBeUndefined()
})


// These existing development sources originally retained six conservative
// marker warnings at subroutine bar/outer-face intersections. Source meaning
// and actual rendered geometry remain separate from the receipt assertion.
test.each([
  ['cyclic-labelled-10.mmd', 10, 20, ['edge:n0->n6#0', 'edge:n2->n0#0']],
  ['cyclic-labelled-11.mmd', 11, 24, ['edge:n5->n0#0']],
  ['cyclic-labelled-13.mmd', 13, 31, ['edge:n2->n4#0', 'edge:n8->n10#0']],
  ['cyclic-labelled-9.mmd', 9, 21, ['edge:n2->n4#0']],
] as const)('actual subroutine face heads in %s retain source meaning and visible target glyphs', (name, nodes, relationships, heads) => {
  const source = readFileSync(new URL('../../eval/layout-compare/fixtures/' + name, import.meta.url), 'utf8')
  const result = renderMermaidSVGWithReceipt(source, { embedFontImport: false, graphLayout: { backend: 'agentic', fallback: 'none' } })
  const elements: Array<{ name: string; attrs: Record<string, string> }> = [], parser = new SaxesParser({ xmlns: false })
  parser.on('opentag', tag => elements.push({ name: tag.name, attrs: tag.attributes as Record<string, string> })); parser.write(result.svg).close()
  expect(elements.filter(e => e.name === 'g' && e.attrs.class === 'node')).toHaveLength(nodes)
  expect(elements.filter(e => e.attrs['data-role'] === 'edge')).toHaveLength(relationships)
  const originalImage = new Resvg(result.svg).render(), original = originalImage.pixels
  for (const id of heads) {
    const e = elements.find(e => e.attrs['data-id'] === id)!
    expect(e.attrs).toMatchObject({ 'data-role': 'edge', 'data-marker-end': 'arrow', 'marker-end': 'url(#arrowhead)' })
    const pair = id.match(/^edge:(.+)->(.+)#0$/)!
    expect(e.attrs['data-from']).toBe(pair[1]); expect(e.attrs['data-to']).toBe(pair[2])
    // All retained fixtures use canonical, untransformed cardinal polylines.
    // Group every exact same-resource/endpoint/tangent/width repaint before
    // removal: a coincident surviving copy must not imply a missing head.
    const pose = (attrs: Record<string, string>) => {
      if (!attrs.points || attrs.transform || attrs['marker-end'] !== 'url(#arrowhead)') return undefined
      const points = attrs.points.trim().split(/\s+/).map(value => value.split(','))
      const end = points.at(-1)!, prior = [...points].reverse().find(point => point[0] !== end[0] || point[1] !== end[1])
      if (!prior || end.length !== 2 || prior.length !== 2) return undefined
      const vertical = prior[0] === end[0], horizontal = prior[1] === end[1]
      if (vertical === horizontal) return undefined
      const axis = vertical ? 1 : 0, sign = Math.sign(Number(end[axis]) - Number(prior[axis]))
      return JSON.stringify([end, axis, sign, attrs['stroke-width'] ?? '1', attrs['marker-end']])
    }
    const key = pose(e.attrs)
    expect(key).toBeDefined()
    const repaints = elements.filter(item => item.name === 'polyline' && pose(item.attrs) === key).map(item => item.attrs['data-id']!)
    const escaped = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const without = result.svg.replace(/<polyline\b[^>]*\/?>/g, fragment => repaints.some(repaint => fragment.includes('data-id="' + escaped(repaint) + '"')) ? fragment.replace(' marker-end="url(#arrowhead)"', '') : fragment)
    expect(without).not.toBe(result.svg)
    const absent = new Resvg(without).render().pixels
    let changed = 0
    for (let i = 0; i < original.length; i += 4) if (original[i] !== absent[i] || original[i + 1] !== absent[i + 1] || original[i + 2] !== absent[i + 2] || original[i + 3] !== absent[i + 3]) changed++
    expect(changed).toBeGreaterThan(0)
  }
  expect(result.receipt.layoutCertification?.issues).toEqual([])
  expect(result.receipt.layoutCertification?.status).toBe('passed')
})
