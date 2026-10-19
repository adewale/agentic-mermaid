import { expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { connectorMarkerPaintRegions } from '../scene/bounds.ts'
import { certifyScenePaint } from '../scene/paint-certification.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { layoutMermaidWithReceipt, verifyMermaid } from '../agent/core.ts'
import { renderMermaidSVGWithReceipt, renderMermaidASCIIWithReceipt } from '../index.ts'
import { lowerPositionedFamilyScene, renderedSvgDigest } from '../graphical-render.ts'
import { resolveRenderRequestForExecution, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { inspectScenePrimitives, scenePrimitiveSource } from '../scene/inspection.ts'
import { measureQuality } from '../agent/quality.ts'
import { replaceFamilyForTest } from '../agent/families.ts'
import type { PositionedArchitectureDiagram } from '../architecture/types.ts'
import type { PositionedErDiagram } from '../er/types.ts'

const scene = (parts: SceneNode[]): SceneDoc => ({ family: 'flowchart', width: 100, height: 80, transparent: false, colors: { bg: '#fff', fg: '#111' }, parts })
const label = () => {
  const block = preparePixelText('Read', { fontSize: 12, fontWeight: 400 })
  return marks.text({ id: 'text', role: 'label', text: 'Read', block, x: 20, y: 30, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
}
const surface = (fill = '#fff') => marks.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 80, height: 60 }, paint: { fill } })

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

test('path envelopes and affine empty corners never masquerade as solid occluders', () => {
  const path = marks.shape({ id: 'triangle', role: 'node', geometry: { kind: 'path', d: 'M10 10 L90 10 L90 70 Z' }, paint: { fill: '#fff' } })
  expect(certifyScenePaint(scene([label(), path])).issues.some(issue => issue.code === 'TEXT_OCCLUDED')).toBe(false)
  expect(certifyScenePaint(scene([label(), path])).status).toBe('unverified')
})

test('endpoint symbols use final owned repaint order rather than marker counts', () => {
  const marker = { id: 'arrow', shape: 'arrow' as const, bounds: { x0: -1, y0: -1, x1: 1, y1: 1 }, units: 'userSpaceOnUse' as const }
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
      expect([proof.viewport.x, proof.viewport.y, proof.viewport.width, proof.viewport.height], family).toEqual(actual)
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
  const marker = { id: 'arrow', shape: 'arrow' as const, bounds: { x0: -1, y0: -1, x1: 1, y1: 1 } }
  const fields = { id: 'relationship', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 20, y1: 30, x2: 30, y2: 30 }, paint: { stroke: '#111', strokeWidth: '10' }, markers: { end: marker } }
  const edge = marks.connector(fields)
  const repaint = marks.connector({ ...fields, id: 'small-carrier', role: 'chrome', owner: { id: 'relationship', role: 'edge' }, paint: { stroke: '#111', strokeWidth: '1' } })
  const proof = certifyScenePaint(scene([edge, surface(), repaint]))
  expect(proof.status).toBe('failed')
  expect(proof.checks.markers).toBe(2)
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'relationship' }))
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
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 50, x2: 40, y2: 50 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'node' }, markers: { end: { id: 'arrow', shape: 'arrow', bounds: { x0: -1, y0: -1, x1: 1, y1: 1 }, units: 'userSpaceOnUse' } } })
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
  for (const id of ['edge:_start2->NumLockOff#0', 'edge:NumLockOn->NumLockOff#0', 'edge:_start3->CapsLockOff#0', 'edge:CapsLockOn->CapsLockOff#0', 'edge:_start4->ScrollLockOff#0', 'edge:ScrollLockOn->ScrollLockOff#0']) {
    const edge = scenePrimitiveSource(primitives.find(part => part.id === id)!)!
    expect(edge.kind).toBe('connector')
    if (edge.kind !== 'connector') throw new Error('Expected the retained native connector')
    const marker = connectorMarkerPaintRegions(edge).find(region => region.position === 'end')!
    expect(marker.hull).toBeDefined()
    for (const halo of halos) {
      const a = marker.bounds!, b = halo.bounds!
      expect(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0, `${id} hidden by ${halo.id}`).toBe(false)
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

test('the native Architecture BUG-37 route cannot receive a passed public certificate', () => {
  const source = `${SIDE_CONSTRAINED_ARCHITECTURE.slice(0, SIDE_CONSTRAINED_ARCHITECTURE.indexOf('  s1_0:L'))}  s0_0:L --> L:s1_0
  s0_0:T --> T:s0_1
  s0_2:L --> L:s1_0
  s0_1:L --> L:s1_0`
  expect(() => renderMermaidSVGWithReceipt(source, { layoutSafety: 'strict' })).toThrow('Final paint certification failed')
  const verified = verifyMermaid(source)
  expect(verified.ok).toBe(false)
  expect(verified.layoutCertification?.status).toBe('failed')
  expect(verified.layoutCertification?.issues).toContainEqual(expect.objectContaining({ code: 'CONNECTOR_CARD_CROSSING', by: expect.stringContaining('s0_2') }))
})

test.each(['dashed', 'zero-width', 'transparent', 'zero-opacity'] as const)('%s shaft paint never proves hidden ink from an unpainted crossing', mode => {
  const paint = { stroke: mode === 'transparent' ? 'rgba(0,0,0,0)' : '#111', strokeWidth: mode === 'zero-width' ? '0' : '1', ...(mode === 'zero-opacity' ? { opacity: '0' } : {}), ...(mode === 'dashed' ? { strokeDasharray: '1 100' } : {}) }
  const edge = marks.connector({ id: 'route', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 5, y1: 30, x2: 95, y2: 30 }, paint, endpoints: { from: 'A', to: 'B' } })
  const proof = certifyScenePaint(scene([edge, surface()]))
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
