import { expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { readFileSync } from 'node:fs'
import { connectorMarkerPaintRegions, nodePaintBounds } from '../scene/bounds.ts'
import { certifyNativePaint, certifyScenePaint } from '../scene/paint-certification.ts'
import type { Geometry, MarkPaint, SceneDoc, SceneNode, SceneTransform, MarkerDescriptor } from '../scene/ir.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { layoutMermaidWithReceipt, verifyMermaid } from '../agent/core.ts'
import { renderMermaidSVGWithReceipt, renderMermaidASCIIWithReceipt } from '../index.ts'
import { lowerPositionedFamilyScene, renderedSvgDigest } from '../graphical-render.ts'
import { resolveRenderRequestForExecution, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { inspectScenePrimitives, scenePrimitiveSource } from '../scene/inspection.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { serializeMarkerResource, tipAnchoredArrow } from '../scene/marker-resources.ts'
import { drawNative } from '../scene/native-drawing.ts'
import type { DrawingProducer } from '../scene/drawing.ts'
import { measureQuality } from '../agent/quality.ts'
import { replaceFamilyForTest } from '../agent/families.ts'
import type { PositionedArchitectureDiagram } from '../architecture/types.ts'
import type { PositionedErDiagram } from '../er/types.ts'
import type { PositionedIshikawa } from '../ishikawa/types.ts'

const scene = (parts: SceneNode[]): SceneDoc => ({ family: 'flowchart', width: 100, height: 80, transparent: false, colors: { bg: '#fff', fg: '#111' }, parts })
const label = () => {
  const block = preparePixelText('Read', { fontSize: 12, fontWeight: 400 })
  return marks.text({ id: 'text', role: 'label', text: 'Read', block, x: 20, y: 30, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
}
const surface = (fill = '#fff') => marks.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 80, height: 60 }, paint: { fill } })

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
  const edge = marks.connector({ id: 'authored->edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: -10, y1: 20, x2: 110, y2: 20 }, paint: { stroke: '#111', strokeWidth: '4' }, endpoints: { from: 'authored', to: 'edge' }, markers: { end: { id: 'arrow', shape: 'arrow', bounds: { x0: -5, y0: -5, x1: 5, y1: 5 }, units: 'userSpaceOnUse' } } })
  const proof = certifyScenePaint(scene([edge]))
  expect(proof.status).toBe('passed')
  expect(proof.attempts).toBe(2)
  expect(proof.repairs).toEqual(['expand-viewport'])
  expect(proof.viewport.width / proof.viewport.height).toBeCloseTo(100 / 80, 10)
  expect(proof.viewport.x).toBeLessThanOrEqual(-12)
  expect(proof.viewport.x + proof.viewport.width).toBeGreaterThanOrEqual(117)
  expect(edge.endpoints).toMatchObject({ from: 'authored', to: 'edge' })
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
      factory.text({ id: 'text', role: 'label', text: 'Read', block: preparePixelText('Read', { fontSize: 12, fontWeight: 400 }), x: 20, y: 30, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }),
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
    factory.text({ id: 'text', role: 'label', text: 'Read', block: preparePixelText('Read', { fontSize: 12, fontWeight: 400 }), x: 20, y: 30, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }),
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
test.each(['covered', 'separate', 'aabb-corner', 'coincident', 'different-coincident', 'owned-repaint', 'same-owner-cover', 'unknown-fill', 'transparent-fill', 'affine', 'clipped', 'nonsemantic', 'no-earlier-stroke', 'unemitted-opacity', 'later-restoration', 'overlay-repaint', 'same-color', 'thick-outline', 'unmeasured-restoration', 'late-open', 'early-open-covered', 'early-open-clear', 'no-closing-stroke', 'string-marker-units'] as const)('distinct marker stroke/fill proof preserves %s', mode => {
  const first: MarkerDescriptor = { id: 'diamond-resource', shape: 'diamond', units: 'userSpaceOnUse', orient: 'auto-start-reverse',
    size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 },
    geometry: mode === 'no-closing-stroke' ? { kind: 'polyline', points: [{ x: 7, y: 1 }, { x: 13, y: 6 }, { x: 7, y: 11 }] } : ['early-open-covered', 'early-open-clear'].includes(mode) ? { kind: 'polyline', points: [{ x: 7, y: 11 }, { x: 1, y: 6 }, { x: 7, y: 1 }] } : { kind: 'polygon', points: [{ x: 7, y: 1 }, { x: 13, y: 6 }, { x: 7, y: 11 }, { x: 1, y: 6 }] },
    paint: { fill: mode.startsWith('early-open') || mode === 'no-closing-stroke' ? 'none' : '#fff', stroke: mode === 'no-earlier-stroke' ? 'none' : '#111', strokeWidth: mode === 'aabb-corner' ? '0.25' : '1.5' } }
  const later: MarkerDescriptor = ['coincident', 'owned-repaint'].includes(mode) ? first : { id: 'triangle-resource', shape: 'arrow', units: 'userSpaceOnUse', orient: 'auto-start-reverse', overflow: mode === 'clipped' ? 'hidden' : 'visible',
    size: { width: mode === 'clipped' ? 6 : 12, height: mode === 'clipped' ? 5 : 10 }, ref: { x: 12, y: 5 },
    geometry: { kind: mode === 'late-open' ? 'polyline' : 'polygon', points: [{ x: 0, y: 0 }, { x: 12, y: 5 }, { x: 0, y: 10 }] },
    paint: { fill: mode === 'late-open' ? 'none' : mode === 'unknown-fill' ? 'var(--host)' : mode === 'transparent-fill' ? 'rgba(255,255,255,0.5)' : mode === 'same-color' ? '#111' : '#fff', stroke: '#111', strokeWidth: mode === 'thick-outline' ? '20' : '1.5', ...(mode === 'unemitted-opacity' ? { fillOpacity: '0', strokeOpacity: '0' } : {}) } }
  if (mode === 'no-closing-stroke') { later.size = { width: 1, height: 1 }; later.ref = { x: 0.5, y: 0.5 }; later.geometry = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }] }; later.paint!.strokeWidth = '0.1' }
  if (mode === 'string-marker-units') { first.units = 'strokeWidth'; later.units = 'strokeWidth' }
  const y = ['separate', 'early-open-clear'].includes(mode) ? 55 : mode === 'aabb-corner' ? 39.5 : ['coincident', 'different-coincident', 'owned-repaint', 'no-closing-stroke'].includes(mode) ? 30 : 33.865217391
  const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
  const producer: DrawingProducer = factory => {
    const connector = (id: string, marker: MarkerDescriptor, cy: number, overlay = false) => factory.connector({ id, role: mode === 'nonsemantic' || overlay ? 'chrome' : 'edge', owner: { id: ['owned-repaint', 'same-owner-cover'].includes(mode) ? 'earlier' : overlay ? id.replace('overlay:', '') : id, role: mode === 'nonsemantic' ? 'chrome' : 'edge' },
      lineStyle: 'solid', endpoints: { from: 'shared-source', to: id }, geometry: { kind: 'line', x1: mode === 'no-closing-stroke' && id === 'later' ? 64 : 70, y1: cy, x2: 20, y2: cy },
      ...(mode === 'affine' ? { transform: { kind: 'matrix' as const, a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 } } : {}),
      paint: { stroke: '#111', strokeWidth: mode === 'string-marker-units' ? ' 1.004000000000001px ' : '1' }, ...(overlay ? { stroke: { opacity: 0 } } : {}), markers: { start: marker } })
    return { ...scene([]), parts: [
      factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80">'),
      factory.definitions({ id: 'resources' }, `<defs>${serializeMarkerResource(first)}${later === first ? '' : serializeMarkerResource(later)}</defs>`),
      connector('earlier', first, 30), connector('later', later, y),
      ...(mode === 'overlay-repaint' ? [connector('overlay:earlier', first, 30, true), connector('overlay:later', later, y, true)] : []),
      ...(mode === 'later-restoration' ? [factory.connector({ id: 'restorer', role: 'chrome', lineStyle: 'solid', geometry: { kind: 'line', x1: 60, y1: 32.5, x2: 62, y2: 32.5 }, paint: { stroke: '#111', strokeWidth: '1' } })] : []), ...(mode === 'unmeasured-restoration' ? [factory.shape({ id: 'unmeasured-restorer', role: 'chrome', geometry: { kind: 'rect', x: 58, y: 30, width: 10, height: 6 }, paint: { fill: 'none', stroke: '#111', strokeWidth: 'var(--host)' } })] : []), factory.documentClose(),
    ] }
  }
  const drawing = drawNative(producer, context, 'flowchart')
  expect(drawing.svg).toContain('marker-start')
  if (mode === 'string-marker-units') expect(drawing.svg).toContain('stroke-width=" 1.004000000000001px "')
  const expected = ['covered', 'different-coincident', 'same-owner-cover', 'unemitted-opacity', 'overlay-repaint', 'early-open-covered', 'string-marker-units'].includes(mode) ? 'failed' : ['unknown-fill', 'affine', 'clipped', 'later-restoration', 'same-color', 'thick-outline', 'unmeasured-restoration', 'no-closing-stroke'].includes(mode) ? 'unverified' : 'passed'
  for (const proof of [certifyScenePaint(producer(marks, context)), certifyNativePaint(drawing.header, drawing.paint)]) {
    expect(proof.status).toBe(expected)
    if (expected === 'failed') expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: mode === 'overlay-repaint' ? 'overlay:earlier' : 'earlier', by: mode === 'overlay-repaint' ? 'overlay:later' : 'later' }))
    else if (expected === 'unverified') expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'earlier', by: 'later' }))
    else expect(proof.issues).toEqual([])
  }
})
