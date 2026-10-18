import { expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { connectorMarkerPaintRegions } from '../scene/bounds.ts'
import { certifyScenePaint } from '../scene/paint-certification.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { layoutMermaidWithReceipt, verifyMermaid } from '../agent/core.ts'
import { renderMermaidSVGWithReceipt, renderMermaidASCIIWithReceipt } from '../index.ts'
import { renderedSvgDigest } from '../graphical-render.ts'
import { measureQuality } from '../agent/quality.ts'
import { replaceFamilyForTest } from '../agent/families.ts'

const scene = (parts: SceneNode[]): SceneDoc => ({ family: 'flowchart', width: 100, height: 80, transparent: false, colors: { bg: '#fff', fg: '#111' }, parts })
const label = () => {
  const block = preparePixelText('Read', { fontSize: 12, fontWeight: 400 })
  return marks.text({ id: 'text', role: 'label', text: 'Read', block, x: 20, y: 30, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }, '<text x="20" y="30" font-size="12">Read</text>')
}
const surface = (fill = '#fff') => marks.shape({ id: 'cover', role: 'node', geometry: { kind: 'rect', x: 10, y: 10, width: 80, height: 60 }, paint: { fill } }, `<rect x="10" y="10" width="80" height="60" fill="${fill}"/>`)

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
  const path = marks.shape({ id: 'triangle', role: 'node', geometry: { kind: 'path', d: 'M10 10 L90 10 L90 70 Z' }, paint: { fill: '#fff' } }, '<path d="M10 10 L90 10 L90 70 Z" fill="#fff"/>')
  expect(certifyScenePaint(scene([label(), path])).issues.some(issue => issue.code === 'TEXT_OCCLUDED')).toBe(false)
  expect(certifyScenePaint(scene([label(), path])).status).toBe('unverified')
})

test('endpoint symbols use final owned repaint order rather than marker counts', () => {
  const marker = { id: 'arrow', shape: 'arrow' as const, bounds: { x0: -1, y0: -1, x1: 1, y1: 1 }, units: 'userSpaceOnUse' as const }
  const fields = { id: 'relationship', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 20, y1: 30, x2: 30, y2: 30 }, paint: { stroke: '#111', strokeWidth: '1' }, markers: { end: marker } }
  const svg = '<line x1="20" y1="30" x2="30" y2="30" stroke="#111" stroke-width="1" marker-end="url(#arrow)"/>'
  const edge = marks.connector(fields, svg)
  const hidden = certifyScenePaint(scene([edge, surface()]))
  expect(hidden.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'relationship', by: 'cover' }))
  const repaint = marks.connector({ ...fields, id: 'marker-artwork', role: 'chrome', owner: { id: 'relationship', role: 'edge' } }, svg)
  const visible = certifyScenePaint(scene([edge, surface(), repaint]))
  expect(visible.status).toBe('passed')
  expect(visible.checks.markers).toBe(1)
  const path = marks.shape({ id: 'path-cover', role: 'node', geometry: { kind: 'path', d: 'M10 10 L90 10 L90 70 L10 70 Z' }, paint: { fill: '#fff' } }, '<path d="M10 10 L90 10 L90 70 L10 70 Z" fill="#fff"/>')
  const unknown = certifyScenePaint(scene([edge, path]))
  expect(unknown.status).toBe('unverified')
  expect(unknown.issues).toContainEqual(expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', id: 'relationship', by: 'path-cover' }))
  expect(certifyScenePaint(scene([edge, path, repaint])).status).toBe('passed')

})

test('one viewport repair contains negative coordinates, stroke and endpoint artwork without moving identities', () => {
  const edge = marks.connector({ id: 'authored->edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: -10, y1: 20, x2: 110, y2: 20 }, paint: { stroke: '#111', strokeWidth: '4' }, endpoints: { from: 'authored', to: 'edge' }, markers: { end: { id: 'arrow', shape: 'arrow', bounds: { x0: -5, y0: -5, x1: 5, y1: 5 }, units: 'userSpaceOnUse' } } }, '<line x1="-10" y1="20" x2="110" y2="20" stroke="#111" stroke-width="4" marker-end="url(#arrow)"/>')
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
    const cover = marks.shape({ id: 'late-cover', role: 'chrome', geometry: { kind: 'rect', x: 0, y: 0, width: original.width, height: original.height }, paint: { fill: '#fff' } }, `<rect x="0" y="0" width="${original.width}" height="${original.height}" fill="#fff"/>`)
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
  const edge = marks.connector({ id: 'relationship', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 5, y1: 5, x2: 95, y2: 5 }, paint: { stroke: '#111' }, labels: [{ id: 'inline-label', text: 'Read', block, anchor: { x: 20, y: 30 }, paint: { fill: '#111' }, fontSize: 12, fontWeight: 400, textAnchor: 'start', visual: { kind: 'inline' } }] }, '<line x1="5" y1="5" x2="95" y2="5" stroke="#111"/>')
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
  const shape = marks.shape({ id: 'border', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 100, height: 80 }, paint: { stroke: '#000', strokeWidth: '10', vectorEffect: 'non-scaling-stroke' } }, '<rect x="0" y="0" width="100" height="80" stroke="#000" stroke-width="10" vector-effect="non-scaling-stroke"/>')
  expect(certifyScenePaint(scene([shape]))).toMatchObject({ status: 'unverified', repairs: ['expand-viewport'], issues: [expect.objectContaining({ code: 'OUTPUT_SCOPE' })] })
})

test('a differently scaled marker carrier cannot erase earlier occluded artwork', () => {
  const marker = { id: 'arrow', shape: 'arrow' as const, bounds: { x0: -1, y0: -1, x1: 1, y1: 1 } }
  const fields = { id: 'relationship', role: 'edge' as const, lineStyle: 'solid' as const, geometry: { kind: 'line' as const, x1: 20, y1: 30, x2: 30, y2: 30 }, paint: { stroke: '#111', strokeWidth: '10' }, markers: { end: marker } }
  const edge = marks.connector(fields, '<line x1="20" y1="30" x2="30" y2="30" stroke="#111" stroke-width="10" marker-end="url(#arrow)"/>')
  const repaint = marks.connector({ ...fields, id: 'small-carrier', role: 'chrome', owner: { id: 'relationship', role: 'edge' }, paint: { stroke: '#111', strokeWidth: '1' } }, '<line x1="20" y1="30" x2="30" y2="30" stroke="#111" stroke-width="1" marker-end="url(#arrow)"/>')
  const proof = certifyScenePaint(scene([edge, surface(), repaint]))
  expect(proof.status).toBe('failed')
  expect(proof.checks.markers).toBe(2)
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'MARKER_OCCLUDED', id: 'relationship' }))
})

test('separated leaves cannot evade the final occlusion traversal budget', () => {
  const parts: SceneNode[] = [], count = 2048
  for (let i = 0; i < count; i++) {
    const y = Math.floor(i / 8) % 2 === 0 ? 100 : -100
    parts.push(marks.shape({ id: `surface:${i}`, role: 'node', geometry: { kind: 'rect', x: 0, y, width: 1000, height: 10 }, paint: { fill: '#fff' } }, `<rect x="0" y="${y}" width="1000" height="10" fill="#fff"/>`))
  }
  const block = preparePixelText('X', { fontSize: 12, fontWeight: 400 })
  for (let i = 0; i < count; i++) parts.push(marks.text({ id: `text:${i}`, role: 'label', text: 'X', block, x: 500, y: 0, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }, '<text x="500" y="0" font-size="12">X</text>'))
  const proof = certifyScenePaint({ ...scene(parts), width: 1000, height: 200 })
  expect(proof.status).toBe('unverified')
  expect(proof.checks.occlusionPairs).toBe(0)
  expect(proof.checks.operations).toBeLessThanOrEqual(proof.checks.maxOperations)
  expect(proof.issues).toContainEqual(expect.objectContaining({ code: 'CHECK_BUDGET' }))
})


test('self-crossing filled polygons cannot prove that an overlapped marker is visible', () => {
  const points = [0, 2, 4, 1, 3].map(i => ({ x: 50 + 45 * Math.cos(-Math.PI / 2 + 2 * Math.PI * i / 5), y: 50 + 45 * Math.sin(-Math.PI / 2 + 2 * Math.PI * i / 5) }))
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 40, y1: 15, x2: 50, y2: 15 }, paint: { stroke: '#111' }, markers: { end: { id: 'arrow', shape: 'arrow', bounds: { x0: -1, y0: -1, x1: 1, y1: 1 }, units: 'userSpaceOnUse' } } }, '<line x1="40" y1="15" x2="50" y2="15" stroke="#111" marker-end="url(#arrow)"/>')
  const cover = marks.shape({ id: 'star', role: 'node', geometry: { kind: 'polygon', points }, paint: { fill: '#fff' } }, `<polygon points="${points.map(p => `${p.x},${p.y}`).join(' ')}" fill="#fff"/>`)
  expect(certifyScenePaint(scene([edge, cover]))).toMatchObject({ status: 'unverified', issues: [expect.objectContaining({ code: 'POTENTIAL_OCCLUSION', by: 'star' })] })
})


test.each(['non-scaling-stroke', 'rgba(0,0,0,0)', '#00000000'] as const)('%s outlines cannot hide a marker inside their endpoint body', mode => {
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 50, x2: 40, y2: 50 }, paint: { stroke: '#111' }, endpoints: { from: 'outside', to: 'node' }, markers: { end: { id: 'arrow', shape: 'arrow', bounds: { x0: -1, y0: -1, x1: 1, y1: 1 }, units: 'userSpaceOnUse' } } }, '<line x1="10" y1="50" x2="40" y2="50" stroke="#111" marker-end="url(#arrow)"/>')
  const cover = marks.shape({ id: 'node', role: 'node', geometry: { kind: 'rect', x: 2, y: 2, width: 6, height: 6 }, paint: { fill: '#fff', stroke: mode === 'non-scaling-stroke' ? '#111' : mode, strokeWidth: '10', ...(mode === 'non-scaling-stroke' ? { vectorEffect: mode } : {}) }, transform: { kind: 'matrix', a: 10, b: 0, c: 0, d: 10, e: 0, f: 0 } }, '<rect x="2" y="2" width="6" height="6" fill="#fff" stroke="#111" stroke-width="10" vector-effect="non-scaling-stroke" transform="matrix(10 0 0 10 0 0)"/>')
  expect(certifyScenePaint({ ...scene([edge, cover]), height: 100 })).toMatchObject({ status: 'failed', issues: [expect.objectContaining({ code: 'MARKER_OCCLUDED', by: 'node' })] })
})


test('omitted marker orientation follows the emitted auto tangent', () => {
  const marker = { id: 'arrow', shape: 'arrow' as const, units: 'userSpaceOnUse' as const, ref: { x: 8, y: 2.5 }, geometry: { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 8, y: 2.5 }, { x: 0, y: 5 }] }, paint: { fill: '#111' } }
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 10, y1: 10, x2: 10, y2: 50 }, paint: { stroke: '#111' }, markers: { end: marker } }, '<line x1="10" y1="10" x2="10" y2="50" stroke="#111" marker-end="url(#arrow)"/>')
  const hull = connectorMarkerPaintRegions(edge)[0]!.hull!
  expect(hull[0]!.x).toBeCloseTo(12.5)
  expect(hull[0]!.y).toBeCloseTo(42)
  expect(hull[1]).toEqual({ x: 10, y: 50 })
  expect(hull[2]!.x).toBeCloseTo(7.5)
  expect(hull[2]!.y).toBeCloseTo(42)
})
