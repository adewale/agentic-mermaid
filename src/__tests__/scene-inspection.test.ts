import { expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { inspectScenePrimitives, inspectScenePaintGeometry, inspectNativePaintGeometry, createOwnedNativePaintRecorder, nativePaintAncestors, scenePrimitiveMatrix } from '../scene/inspection.ts'
import { drawNative } from '../scene/native-drawing.ts'
import type { DrawingProducer } from '../scene/drawing.ts'
import { nodePaintBounds } from '../scene/bounds.ts'
import { sceneFidelityProblems } from '../scene/fidelity.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { sceneDocument } from '../shared/scene-document.ts'

const scene = (parts: SceneNode[]): SceneDoc => ({ family: 'flowchart', transparent: false, width: 200, height: 100, colors: { bg: '#fff', fg: '#111' }, parts })

test.each(['ordinary', 'overridden-map'])('native occurrence snapshots %s caller ancestry and matrices cannot poison another primitive', variant => {
  const parent = { id: 'parent', role: 'group' as const }
  const parents = [parent]
  if (variant === 'overridden-map') Object.defineProperty(parents, 'map', { value: () => parents })
  const ancestors = nativePaintAncestors(parents, { id: 'child', role: 'group' })
  const node = marks.shape({ id: 'surface', role: 'node', geometry: { kind: 'rect', x: 1, y: 2, width: 3, height: 4 }, paint: { fill: '#111' } })
  const inspect = () => inspectNativePaintGeometry({ family: 'flowchart', width: 20, height: 20 }, [{ node, ancestors, owner: parent }, { node, ancestors: parents, owner: parent }, { node }])
  const first = inspect()
  const recorder = createOwnedNativePaintRecorder({ family: 'flowchart', width: 20, height: 20 })
  const forged = Object.freeze([Object.freeze({ ...parent })])
  expect(() => recorder.leaf(node, 'forged', undefined, forged)).toThrow(/owned snapshots/)
  recorder.leaf(node, 'native.0', undefined, ancestors, false, 1, parent)
  recorder.leaf(node, 'native.1', undefined, nativePaintAncestors(undefined, parent), false, 1, parent)
  recorder.leaf(node, 'native.2')
  expect(recorder.finish()).toEqual(first)
  parent.id = 'changed'
  expect(first.primitives[0]!.ancestors).toEqual([{ id: 'parent', role: 'group' }, { id: 'child', role: 'group' }])
  expect(first.primitives[1]!.ancestors).toEqual([{ id: 'parent', role: 'group' }])
  for (const primitive of first.primitives.slice(0, 2)) {
    expect(primitive.owner).toEqual({ id: 'parent', role: 'group' })
    expect(Object.isFrozen(primitive.owner)).toBe(true)
    expect(primitive.owner).not.toBe(parent)
  }
  const matrix = scenePrimitiveMatrix(first.primitives[0]!)!
  Reflect.set(matrix, 0, 99)
  expect(scenePrimitiveMatrix(first.primitives[1]!)).toEqual([1, 0, 0, 1, 0, 0])
  expect(scenePrimitiveMatrix(inspect().primitives[0]!)).toEqual([1, 0, 0, 1, 0, 0])
})

test('native reused fragments retain occurrence ownership and bottom-up affine paint geometry', () => {
  const colors = { bg: '#fff', fg: '#111', embedFontImport: false }
  const context = { positioned: { width: 200000, height: 2000 }, colors, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const shape = factory.shape({ id: 'surface', role: 'node', owner: { id: 'sibling', role: 'group' }, geometry: { kind: 'rect', x: 3.2, y: 5.1, width: 11.7, height: 7.9 }, paint: { fill: '#111' } })
    const label = factory.text({ id: 'label', role: 'label', text: 'Reusable', x: 15, y: 25, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
    const children = [{ node: shape, indent: 2 }, { node: label, indent: 1 }]
    const wrap = (id: string, values: [number, number, number, number, number, number], children: Parameters<typeof factory.group>[0]['children'], opacity: string, extra: Pick<Parameters<typeof factory.group>[0], 'owner' | 'visibility'> = {}) => factory.group({
      id, role: 'group', open: `<g transform="matrix(${values.join(' ')})">`, close: '</g>',
      transform: { kind: 'matrix', a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] },
      paint: { opacity }, children, ...extra,
    })
    const inner = wrap('inner', [-.6, .2, .3, .7, -1.7, 4.4], children, '.7')
    children.length = 0
    const middle = wrap('middle', [.8, -.7, .4, 1.2, 7.3, 99.9], [{ node: inner, indent: 3 }], '.3', { visibility: 'conditional' })
    const outer = wrap('outer', [1.1, .3, -.2, .9, 100000.1, -13.25], [{ node: middle, indent: 2 }], '.2', { owner: { id: 'sibling', role: 'group' } })
    const sibling = factory.group({ id: 'sibling', role: 'group', open: '<g>', close: '</g>', children: [{ node: shape, indent: 0 }, { node: label, indent: 2 }], paint: { opacity: '.5' } })
    return { family: 'flowchart', ...context.positioned, colors, transparent: false, parts: [
      factory.documentOpen({ id: 'root', ...context.positioned, colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="200000" height="2000">'),
      outer, sibling, factory.documentClose(),
    ] }
  }
  // Directly exercise the native path even when the suite requests full Scene assertions.
  const drawing = drawNative(producer, context, 'flowchart')
  const [surface, label, repeatedSurface, repeatedLabel] = drawing.paint.primitives.filter(value => value.kind !== 'document')
  expect([surface!.key, label!.key, repeatedSurface!.key, repeatedLabel!.key]).toEqual(['scene.1.0.0.0', 'scene.1.0.0.1', 'scene.2.0', 'scene.2.1'])
  expect([surface!.owner.id, label!.owner.id, repeatedSurface!.owner.id, repeatedLabel!.owner.id]).toEqual(['sibling', 'inner', 'sibling', 'sibling'])
  expect(label!.ancestors.map(value => value.id)).toEqual(['outer', 'middle', 'inner'])
  expect(surface!.groupOpacity).toBe(0.042)
  expect(surface!.visibility).toBe('conditional')
  expect(repeatedSurface!.groupOpacity).toBe(0.5)
  expect(repeatedSurface!.visibility).toBeUndefined()
  expect(scenePrimitiveMatrix(surface!)).toEqual([-0.572, 0.474, 0.44600000000000006, 0.7230000000000001, 99987.296, 84.793])
  expect(surface!.bounds).toEqual({ x0: 99981.0478, y0: 89.9971, x1: 99991.2636, y1: 101.25460000000001 })
  expect(drawing.paint.coverage).toEqual({ measured: 4, unmeasured: 0, nonPainting: 2, preparedText: 0, fallbackText: 2 })
})

test('native composition rejects conflicting artwork enclosures even on unused groups', () => {
  const colors = { bg: '#fff', fg: '#111' }
  const producer: DrawingProducer = factory => {
    const artwork = factory.shape({ id: 'artwork', role: 'node', identity: false, owner: { id: 'A', role: 'node' }, geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } })
    for (const id of ['A', 'B']) factory.group({ id, role: 'node', open: '<g>', close: '</g>', children: [{ node: artwork, indent: 0 }] })
    return { family: 'flowchart', width: 100, height: 100, colors, transparent: false, parts: [] }
  }
  expect(() => drawNative(producer, { positioned: { width: 100, height: 100 }, colors, resolved: { renderOptions: {} } }, 'flowchart')).toThrow('conflicting semantic enclosures')
})

test('owned surface artwork suppresses only its enclosing semantic identity, never a primary or unrelated subject', () => {
  const surface = () => marks.shape({ id: 'frame:A', role: 'node', identity: false, owner: { id: 'A', role: 'node' }, geometry: { kind: 'rect', x: 10, y: 10, width: 80, height: 40 }, paint: { fill: '#fff', stroke: '#111' } }),
    wrap = (node: SceneNode, id = 'A', role: 'node' | 'group' = 'node') => marks.group({ id: `wrapper:${id}`, role, open: `<g data-id="${id}">`, close: '</g>', children: [{ node, indent: 2 }] }),
    document = (parts: SceneNode[]) => sceneDocument('flowchart', { width: 200, height: 100 }, { bg: '#fff', fg: '#111', embedFontImport: false }, false, parts),
    artwork = surface(),
    valid = document([wrap(artwork)])
  expect(artwork.identity).toBeUndefined()
  expect(validateSceneDoc(valid, { mode: 'internal' }).diagnostics).toEqual([])
  expect(sceneFidelityProblems(valid)).toEqual([])
  expect(() => marks.shape({ id: 'orphan', role: 'node', identity: false, geometry: artwork.geometry, paint: artwork.paint })).toThrow(/owner/)
  for (const invalid of [document([surface()]), document([wrap(surface(), 'B')]), document([wrap(surface(), 'A', 'group')]), document([wrap(marks.shape({ id: 'sibling', role: 'chrome', geometry: artwork.geometry, paint: {} })), wrap(surface(), 'B')])]) {
    expect(validateSceneDoc(invalid, { mode: 'internal' }).diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_FIDELITY', path: expect.stringContaining('.identity') }))
    expect(sceneFidelityProblems(invalid)).toContainEqual(expect.stringContaining('missing typed identity'))
  }
  const primary = marks.shape({ id: 'primary', role: 'node', geometry: artwork.geometry, paint: artwork.paint })
  delete primary.identity
  expect(sceneFidelityProblems(scene([primary]))).toContainEqual(expect.stringContaining('missing typed identity'))
})

test('inspection preserves semantic subjects, paint order and exact layout text under affine artwork', () => {
  const block = preparePixelText('Hello', { fontSize: 12, fontWeight: 400 })
  const label = marks.text({ id: 'label', role: 'label', text: 'Hello', block, x: 10, y: 20, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
  const group = marks.group({ id: 'authored:A', role: 'node', open: '<g transform="translate(50 10) scale(2)">', close: '</g>', transform: { kind: 'matrix', a: 2, b: 0, c: 0, d: 2, e: 50, f: 10 }, children: [{ node: label, indent: 0 }] })
  const inspection = inspectScenePrimitives(scene([group]))
  expect(inspection.coverage).toEqual({ measured: 1, unmeasured: 0, nonPainting: 0, preparedText: 1, fallbackText: 0 })
  const primitive = inspection.primitives[0]!
  expect(primitive.owner).toEqual({ id: 'authored:A', role: 'node' })
  expect(primitive.bounds!.x0).toBe(70)
  expect(primitive.text).toMatchObject({ source: 'Hello', displayed: 'Hello', measurement: 'prepared' })
  expect(label.owner).toBeUndefined()
  expect(sceneFidelityProblems(scene([group]))).toEqual([])
})

test('opaque content, fallback metrics and conditional states remain explicit evidence', () => {
  const fallback = marks.text({ id: 'legacy', role: 'label', text: 'Legacy', x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} })
  const tooltip = marks.group({ id: 'tooltip', role: 'chrome', visibility: 'conditional', open: '<g>', close: '</g>', children: [{ node: fallback, indent: 0 }] })
  const inspection = inspectScenePrimitives(scene([marks.documentContent({ id: 'unknown', role: 'chrome' }, '<path d="M0 0 L20 20"/>'), tooltip]))
  expect(inspection.primitives[0]).toMatchObject({ coverage: 'unmeasured', reason: 'opaque-visible-content' })
  expect(inspection.primitives[1]).toMatchObject({ visibility: 'conditional', text: { measurement: 'fallback' } })
  expect(inspection.coverage.unmeasured).toBe(1)
  expect(inspection.coverage.fallbackText).toBe(1)
})

test('nested semantic groups retain their own subject and full ancestor chain', () => {
  const shape = marks.shape({ id: 'body', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 }, paint: { fill: '#111' } })
  const child = marks.group({ id: 'inner', role: 'node', open: '<g>', close: '</g>', children: [{ node: shape, indent: 0 }] })
  const parent = marks.group({ id: 'outer', role: 'group', open: '<g>', close: '</g>', children: [{ node: child, indent: 0 }] })
  const primitive = inspectScenePrimitives(scene([parent])).primitives[0]!
  expect(primitive.owner).toEqual({ id: 'inner', role: 'node' })
  expect(primitive.ancestors).toEqual([{ id: 'outer', role: 'group' }, { id: 'inner', role: 'node' }])
})

test('admission rejects false non-painting and prepared-text claims', () => {
  const visible = marks.documentContent({ id: 'false-metadata', role: 'chrome', nonPaint: 'accessibility' }, '<rect x="0" y="0" width="10" height="10"/>')
  expect(validateSceneDoc(scene([visible]), { mode: 'internal' }).diagnostics.some(d => d.path.endsWith('.nonPaint'))).toBe(true)
  const text = marks.text({ id: 'missing', role: 'label', text: 'Lost', x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} })
  const missing = validateSceneDoc(scene([{ ...text, measurement: 'prepared', block: undefined }]), { mode: 'internal' })
  expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_DOCUMENT', path: 'scene.parts[0].block' }))
  const forged = preparePixelText('Forged', { fontSize: 12, fontWeight: 400 })
  const sourceOnly = { ...text, block: { ...text.block!, prepared: { ...text.block!.prepared, source: 'Forged' } } }
  expect(validateSceneDoc(scene([sourceOnly]), { mode: 'internal' }).diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_FIDELITY', path: 'scene.parts[0].block' }))

  expect(() => marks.text({ id: 'mismatch', role: 'label', text: 'Forged', block: forged, x: 10, y: 20, fontSize: 13, anchor: 'start', paint: {} })).toThrow('retained prepared block')
})

test('transparent hit targets paint nothing, and singular composed transforms supply no paint or hit evidence', () => {
  const target = marks.shape({ id: 'hit', role: 'chrome', geometry: { kind: 'rect', x: 0, y: 0, width: 100, height: 80 }, paint: { fill: 'transparent' } })
  expect(inspectScenePrimitives(scene([target])).primitives[0]?.coverage).toBe('non-painting')
})


test('text bounds follow the dominant baseline the writer draws', () => {
  const block = preparePixelText('Label', { fontSize: 16, fontWeight: 400 })
  const at = (dominantBaseline?: 'middle' | 'hanging') => nodePaintBounds(marks.text({
    id: 't', role: 'label', text: 'Label', block, x: 10, y: 100, fontSize: 16, anchor: 'start', paint: { fill: '#111' }, baselineShift: 0,
    ...(dominantBaseline ? { dominantBaseline } : {}),
  }))!
  expect(at('hanging').y0).toBeCloseTo(100)
  const middle = at('middle')
  expect((middle.y0 + middle.y1) / 2).toBeCloseTo(100)
  const alphabetic = at()
  expect((alphabetic.y0 + alphabetic.y1) / 2).toBeCloseTo(100 - 16 * 0.35)
})

test('a compound shape is bounded by its widest piece stroke', () => {
  const node = marks.shape({
    id: 'glyph', role: 'node', paint: { stroke: '#000', strokeWidth: '1' },
    geometry: { kind: 'compound', children: [{ kind: 'rect', x: 10, y: 10, width: 10, height: 10 }, { kind: 'circle', cx: 15, cy: 15, r: 2 }] },
    childPaints: [{ stroke: '#000', strokeWidth: '20' }, { fill: '#000' }],
  })
  expect(nodePaintBounds(node)!.x0).toBeLessThanOrEqual(0)
})

test('overflowing current and conditional strokes remain unmeasured', () => {
  const polygon = marks.shape({ id: 'overflow', role: 'node', geometry: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }, paint: { stroke: '#000', strokeWidth: '1e308', strokeLinejoin: 'miter', strokeMiterlimit: '4' } })
  const conditional = marks.shape({ id: 'alternate', role: 'chrome', visibility: 'conditional', transform: { kind: 'matrix', a: 10, b: 0, c: 0, d: 10, e: 0, f: 0 }, geometry: { kind: 'rect', x: 0, y: 0, width: 10, height: 10 }, paint: { fill: 'transparent' }, conditionalPaint: { stroke: '#000', strokeWidth: '1e308' } })
  for (const node of [polygon, conditional]) {
    expect(nodePaintBounds(node)).toBeUndefined()
    expect(inspectScenePrimitives(scene([node])).primitives[0]?.coverage).toBe('unmeasured')
  }
})


test('inline connector labels expose their actual retained text, owner, order and final bounds', () => {
  const block = preparePixelText('Read', { fontSize: 12, fontWeight: 400 })
  const edge = marks.connector({ id: 'relationship', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 5, y1: 5, x2: 95, y2: 5 }, paint: { stroke: '#111' }, labels: [{ id: 'inline-label', text: 'Read', block, anchor: { x: 20, y: 30 }, paint: { fill: '#111' }, fontSize: 12, fontWeight: 400, textAnchor: 'start', visual: { kind: 'inline' } }] })
  const primitive = inspectScenePrimitives(scene([edge])).primitives[1]!
  expect(primitive).toMatchObject({ id: 'inline-label', kind: 'text', owner: { id: 'relationship', role: 'edge' }, order: 1, coverage: 'measured', text: { source: 'Read', measurement: 'prepared' } })
  expect(primitive.bounds?.x0).toBe(20)
  expect(primitive.bounds?.x1).toBe(20 + block.width)
})


test.each(['transparent', 'rgba(0,0,0,0)', '#00000000'])('invisible %s strokes cannot enlarge visible paint', stroke => {
  const node = marks.shape({ id: 'filled', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 10, height: 20 }, paint: { fill: '#fff', stroke, strokeWidth: '1000' } })
  expect(nodePaintBounds(node)).toEqual({ x0: 0, y0: 0, x1: 10, y1: 20 })
})


test.each([
  ['visible', 'invisible', '#111', undefined, 'measured'],
  ['no-fill', 'solid', 'none', undefined, 'non-painting'],
  ['alpha-zero', 'solid', 'rgba(0,0,0,0)', undefined, 'non-painting'],
  ['opacity-zero', 'solid', '#111', '0', 'non-painting'],
] as const)('inline %s text visibility is independent of its route', (_name, lineStyle, fill, opacity, coverage) => {
  const block = preparePixelText('Read', { fontSize: 12, fontWeight: 400 })
  const edge = marks.connector({ id: 'relationship', role: 'edge', lineStyle, geometry: { kind: 'line', x1: 5, y1: 5, x2: 95, y2: 5 }, paint: { stroke: '#111' }, labels: [{ id: 'inline-label', text: 'Read', block, anchor: { x: 20, y: 30 }, paint: { fill, opacity }, fontSize: 12, fontWeight: 400, textAnchor: 'start', visual: { kind: 'inline' } }] })
  const inspection = inspectScenePrimitives(scene([edge]))
  expect(inspection.primitives[1]).toMatchObject({ id: 'inline-label', coverage })
  expect(inspection.coverage.preparedText).toBe(coverage === 'measured' ? 1 : 0)
  Reflect.set(scenePrimitiveMatrix(inspection.primitives[0]!)!, 0, 99)
  expect(scenePrimitiveMatrix(inspection.primitives[1]!)).toEqual([1, 0, 0, 1, 0, 0])
})


test('mandatory paint geometry omits retained text read-back while explicit inspection preserves it', () => {
  const text = 'Wide 中 labels'
  const block = preparePixelText(text, { fontSize: 12, fontWeight: 400 })
  const mark = marks.text({ id: 'label:A', role: 'label', text, block, x: 20, y: 40, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
  const doc = scene([marks.group({ id: 'A', role: 'node', open: '<g>', close: '</g>', children: [{ node: mark, indent: 0 }] })])
  const geometry = inspectScenePaintGeometry(doc).primitives[0]!
  expect(geometry).toMatchObject({ id: 'label:A', owner: { id: 'A', role: 'node' }, coverage: 'measured', text: { measurement: 'prepared' } })
  expect(geometry.text).not.toHaveProperty('source')
  expect(geometry.text).not.toHaveProperty('displayed')
  expect(geometry.bounds!.x1).toBeGreaterThan(geometry.bounds!.x0)
  const inspection = inspectScenePrimitives(doc).primitives[0]!
  expect(inspection.text).toMatchObject({ source: text, displayed: text, measurement: 'prepared' })
  expect(inspection.ancestors).toEqual([{ id: 'A', role: 'node' }])
  expect(Object.isFrozen(inspection.ancestors)).toBe(true)
  expect(Object.isFrozen(inspection.ancestors[0])).toBe(true)
})
