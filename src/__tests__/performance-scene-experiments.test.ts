import { expect, test } from 'bun:test'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import * as marks from '../scene/marks.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { inspectScenePrimitives } from '../scene/inspection.ts'
import { admitSceneDocument } from '../scene/external-data-snapshot.ts'
import { certifyScenePaint } from '../scene/paint-certification.ts'
import { preparePixelText } from '../shared/prepared-text.ts'

const scene = (parts: SceneNode[]): SceneDoc => ({ family: 'flowchart', width: 1600, height: 1000, transparent: false, colors: { bg: '#fff', fg: '#111' }, parts })
const text = (id: string, x = 20, y = 30) => marks.text({ id, role: 'label', text: 'Read 界', block: preparePixelText('Read 界', { fontSize: 12, fontWeight: 400 }), x, y, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
const cover = (index: number, x: number, y: number) => marks.shape({ id: `card-${index}`, role: 'node', geometry: { kind: 'rect', x, y, width: 90, height: 60 }, paint: { fill: '#fff' } })

test.each(['0', '0.5'])('nested group opacity %s applies equally to ordinary and inline text', opacity => {
  const block = preparePixelText('Read 界', { fontSize: 12, fontWeight: 400 })
  const edge = marks.connector({ id: 'edge', role: 'edge', lineStyle: 'solid', geometry: { kind: 'line', x1: 5, y1: 5, x2: 95, y2: 5 }, paint: { stroke: '#111' },
    labels: [{ id: 'inline', text: 'Read 界', block, anchor: { x: 20, y: 30 }, paint: { fill: '#111' }, fontSize: 12, fontWeight: 400, textAnchor: 'start', visual: { kind: 'inline' } }] })
  const inner = marks.group({ id: 'inner', role: 'group', open: '<g>', close: '</g>', paint: { opacity: '0.5' }, children: [{ node: text('ordinary'), indent: 0 }, { node: edge, indent: 0 }] })
  const outer = marks.group({ id: 'outer', role: 'group', open: '<g>', close: '</g>', paint: { opacity }, children: [{ node: inner, indent: 0 }] })
  const document = admitSceneDocument(scene([outer, cover(0, 0, 0)]), 'internal', false)
  const baseline = withPerformanceExperiments([], () => inspectScenePrimitives(document))
  withPerformanceExperiments(['text-spans', 'indexed-layout', 'position-cache'], () => {
    const inspection = inspectScenePrimitives(document)
    expect(inspection).toEqual(baseline)
    for (const primitive of inspection.primitives.filter(value => value.kind === 'text')) {
      expect(primitive.groupOpacity).toBe(Number(opacity) * 0.5)
      expect(primitive.coverage).toBe(opacity === '0' ? 'non-painting' : 'measured')
      expect(primitive.bounds === undefined).toBe(opacity === '0')
    }
    expect(inspection.coverage.preparedText).toBe(opacity === '0' ? 0 : 2)
    const certificate = certifyScenePaint(document)
    expect(certificate.issues.some(issue => issue.code === 'TEXT_OCCLUDED' && issue.id === 'inline')).toBe(opacity !== '0')
  })
})
