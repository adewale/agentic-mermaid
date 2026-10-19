import { expect, test } from 'bun:test'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import { renderMermaidSVG } from '../index.ts'
import * as marks from '../scene/marks.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { inspectScenePrimitives, scenePrimitiveMatrix } from '../scene/inspection.ts'
import { admitSceneDocument, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, freezeBoundedFirstPartyData } from '../scene/external-data-snapshot.ts'
import { certifyScenePaint } from '../scene/paint-certification.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { retainedSvgInspection, withSvgInspectionCache } from '../svg-inspection-cache.ts'
import { scanSvgStartTags, transformSvgAttributes, transformSvgCssValues } from '../svg-structure.ts'
import { scopeSvgStyles } from '../svg-style-scope.ts'
import { applyOutputSecurityPolicy } from '../output-security.ts'

const scene = (parts: SceneNode[]): SceneDoc => ({ family: 'flowchart', width: 1600, height: 1000, transparent: false, colors: { bg: '#fff', fg: '#111' }, parts })
const text = (id: string, x = 20, y = 30) => marks.text({ id, role: 'label', text: 'Read 界', block: preparePixelText('Read 界', { fontSize: 12, fontWeight: 400 }), x, y, fontSize: 12, anchor: 'start', paint: { fill: '#111' } }, `<text x="${x}" y="${y}" font-size="12" fill="#111">Read 界</text>`)
const cover = (index: number, x: number, y: number) => marks.shape({ id: `card-${index}`, role: 'node', geometry: { kind: 'rect', x, y, width: 90, height: 60 }, paint: { fill: '#fff' } }, `<rect x="${x}" y="${y}" width="90" height="60" fill="#fff"/>`)

test('inspection arena shares frozen subjects and ancestor vectors without losing affine paint facts', () => {
  const group = marks.group({ id: 'group', role: 'node', transform: { kind: 'matrix', a: 2, b: 0, c: 0, d: 2, e: 50, f: 10 }, open: '<g transform="matrix(2 0 0 2 50 10)">', close: '</g>', children: [{ node: text('one'), indent: 0 }, { node: text('two', 100), indent: 0 }] })
  const document = admitSceneDocument(scene([group]), 'internal', false)
  const baseline = withPerformanceExperiments([], () => inspectScenePrimitives(document))
  withPerformanceExperiments(['scene-arena'], () => {
    const compact = inspectScenePrimitives(document)
    expect(compact).toEqual(baseline)
    expect(compact.primitives[0]!.owner).toBe(compact.primitives[1]!.owner)
    expect(compact.primitives[0]!.ancestors).toBe(compact.primitives[1]!.ancestors)
    expect(Object.isFrozen(compact.primitives[0]!.ancestors)).toBe(true)
    expect(scenePrimitiveMatrix(compact.primitives[0]!)).toEqual([2, 0, 0, 2, 50, 10])
    expect(inspectScenePrimitives(document)).toBe(compact)
  })
})

test('inspection does not retain a frozen outer object with mutable caller-owned descendants', () => {
  const shape = cover(0, 0, 0)
  const document = Object.freeze(scene([shape]))
  withPerformanceExperiments(['scene-arena'], () => {
    expect(inspectScenePrimitives(document).primitives[0]!.bounds!.x0).toBe(0)
    if (shape.geometry.kind === 'rect') shape.geometry.x = 50
    expect(inspectScenePrimitives(document).primitives[0]!.bounds!.x0).toBe(50)
  })
})

test('compact admission retains aggregate key/text budgets and exact lazy diagnostic paths', () => {
  const cases = [
    { build: () => ({ parts: [{ same: 'one' }, { same: 'two' }] }), limits: { maxAggregatePropertyKeyBytes: 11 } },
    { build: () => ({ parts: [{ same: 'one' }, { same: 'two' }] }), limits: { maxTextBytes: 5 } },
    { build: () => ({ parts: [{ nested: new Date(0) }] }), limits: {} },
    { build: () => ({ parts: [{ nested: Symbol('bad') }] }), limits: {} },
  ]
  for (const value of cases) {
    const error = (enabled: boolean): string => withPerformanceExperiments(enabled ? ['scene-arena'] : [], () => {
      try { freezeBoundedFirstPartyData(value.build(), { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, ...value.limits }, 'scene') }
      catch (cause) { return (cause as Error).message }
      throw new Error('Expected invalid admission input')
    })
    expect(error(true)).toBe(error(false))
  }
})

test.each(['grid', 'overlap', 'ties'] as const)('packed paint BVH retains %s occlusion order, endpoint ownership and exact proof budgets', layout => {
  const surfaces = Array.from({ length: 96 }, (_, index) => cover(index,
    layout === 'overlap' ? 10 : layout === 'ties' ? index % 2 * 100 : index % 12 * 100,
    layout === 'overlap' ? 10 : Math.floor(index / 12) * 80))
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 0, y1: 30, x2: 800, y2: 30 }, endpoints: { from: 'card-0', to: 'card-8' }, paint: { stroke: '#111', strokeWidth: '1' }, markers: { end: { id: 'arrow', shape: 'arrow', bounds: { x0: -2, y0: -2, x1: 2, y1: 2 }, units: 'userSpaceOnUse' } } }, '<line x1="0" y1="30" x2="800" y2="30" stroke="#111" stroke-width="1" marker-end="url(#arrow)"/>')
  const document = scene([text('under'), edge, ...surfaces, text('above', 520, 50)])
  const baseline = withPerformanceExperiments([], () => certifyScenePaint(document))
  expect(withPerformanceExperiments(['paint-bvh'], () => certifyScenePaint(document))).toEqual(baseline)
})

test('retained SVG ranges survive empty values, CSS insertions, quote styles and successive rewrites', () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" data-empty=""><style></style><g fill='red' data-note="a &gt; b"><rect fill="blue"/></g></svg>`
  const rewritten = withPerformanceExperiments(['svg-passes'], () => withSvgInspectionCache(() => {
    const attributes = transformSvgAttributes(source, attribute => attribute.name === 'fill' ? 'rgb(1, 2, 3)' : attribute.name === 'data-empty' ? '界' : undefined)
    expect(retainedSvgInspection('start-tags', attributes)).toBeDefined()
    const css = transformSvgCssValues(attributes, value => value === '' ? '.node{fill:red}' : value)
    const retained = retainedSvgInspection('start-tags', css)
    expect(retained).toBeDefined()
    return { source: css, tags: retained }
  }))
  expect(rewritten.tags).toEqual(withSvgInspectionCache(() => scanSvgStartTags(rewritten.source)))
  expect(applyOutputSecurityPolicy(rewritten.source).svg).toBe(rewritten.source)
})

test('markup-changing SVG edits never inherit stale lexical or security evidence', () => {
  withPerformanceExperiments(['svg-passes'], () => withSvgInspectionCache(() => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>'
    const malicious = transformSvgAttributes(source, attribute => attribute.name === 'fill' ? 'red" onload="alert(1)' : undefined)
    expect(retainedSvgInspection('start-tags', malicious)).toBeUndefined()
    expect(() => applyOutputSecurityPolicy(malicious)).toThrow('active content')
    const style = '<svg xmlns="http://www.w3.org/2000/svg"><style>text{fill:red}</style></svg>'
    const changed = transformSvgCssValues(style, () => '</style><script>alert(1)</script><style>')
    expect(retainedSvgInspection('start-tags', changed)).toBeUndefined()
    expect(() => applyOutputSecurityPolicy(changed)).toThrow('active content')
  }))
})

test('single-pass style assembly preserves selectors and exact scoped bytes across multiple blocks', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" class="existing"><style>text,a{fill:red}</style><g><style>@media print{svg text{fill:blue}}</style></g></svg>'
  expect(withPerformanceExperiments(['svg-passes'], () => scopeSvgStyles(source))).toBe(withPerformanceExperiments([], () => scopeSvgStyles(source)))
  const cdata = '<svg><style><![CDATA[.x{content:"<g fill=\'red\'>"}]]></style></svg>'
  const rewrite = () => transformSvgCssValues(cdata, css => css === 'red' ? 'blue' : css)
  expect(withPerformanceExperiments(['svg-passes'], rewrite)).toBe(withPerformanceExperiments([], rewrite))
})

test.each([
  'flowchart LR\nsubgraph Outer\nA[Wide 界]-->B[Read]\nend\nB-->A',
  'sequenceDiagram\nAlice->>Bob: Hello 界\nBob-->>Alice: Read',
  'classDiagram\nclass A {\n +String name\n}\nA --> B',
])('combined scene experiments preserve final secured SVG: %s', source => {
  const baseline = withPerformanceExperiments([], () => renderMermaidSVG(source))
  expect(withPerformanceExperiments(['scene-arena', 'paint-bvh', 'svg-passes'], () => renderMermaidSVG(source))).toBe(baseline)
})
