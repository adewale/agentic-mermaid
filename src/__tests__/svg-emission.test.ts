import { describe, expect, test } from 'bun:test'
import type { SceneDoc, ShapeMark } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { admitSceneDocument, snapshotBoundedExternalData, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS } from '../scene/external-data-snapshot.ts'
import {
  measureSvgEmission, serializeSvgEmission, snapshotSvgEmissionRecipe,
  SVG_EMISSION_METADATA_LIMITS, svgEmissionMetadataCounts, svgValue as v,
  type SvgEmissionRecipe,
} from '../scene/svg-emission.ts'
import { SvgWriter } from '../scene/svg-writer.ts'

describe('bounded SVG writer', () => {
  test.each(['string', 'chunks', 'count'] as const)('counts joined UTF-8 across arbitrary chunk boundaries in %s mode', mode => {
    // Standard encoding, independently of the writer's UTF-16 accounting.
    for (const value of ['A界B', 'A\ud83d\ude80B', '\ud800X\udc00', '\ud800\ud800\udc00']) {
      const bytes = new TextEncoder().encode(value).length
      for (let split = 0; split <= value.length; split++) {
        const writer = new SvgWriter({ mode, maxBytes: bytes })
        writer.write(value.slice(0, split))
        writer.write(value.slice(split))
        expect(writer.bytes).toBe(bytes)
        if (mode !== 'count') expect(writer.finish()).toBe(value)
        const bounded = new SvgWriter({ mode, maxBytes: bytes - 1 })
        expect(() => { bounded.write(value.slice(0, split)); bounded.write(value.slice(split)) }).toThrow(/exceeds/)
      }
    }
  })

  test('escapes content and preserves the three distinct attribute lexical contracts', () => {
    const writer = new SvgWriter()
    writer.text('&<>"\'')
    writer.attribute('a', '\t\n\r')
    writer.attribute('b', '\t\n\r', 'xml')
    writer.attribute('style', "--font:'Inter',\tserif\n", 'safe')
    expect(writer.finish()).toBe('&amp;&lt;&gt;&quot;&#39; a="&#9;&#10;&#13;" b="\t\n\r" style="--font:\'Inter\',\tserif\n"')
    for (const delimiter of ['&', '<', '>', '"']) expect(() => new SvgWriter().attribute('style', delimiter, 'safe')).toThrow(/XML delimiters/)
  })

  test('node scopes count before outer indentation, whose bytes still count globally', () => {
    const document = new SvgWriter({ maxBytes: 7 })
    const node = document.indented(2).scoped(3)
    node.write('A\nB')
    expect(document.finish()).toBe('  A\n  B')
    expect(node.bytes).toBe(3)
    expect(document.bytes).toBe(7)

    const rejected = new SvgWriter()
    expect(() => rejected.indented(2).scoped(2).write('ABC')).toThrow(/exceeds 2 bytes/)
    expect(rejected.finish()).toBe('')
  })

  test('a counting writer enforces escaped output size without returning an empty artifact', () => {
    const writer = new SvgWriter({ mode: 'count', maxBytes: 5 })
    writer.text('&')
    expect(writer.bytes).toBe(5)
    expect(() => writer.write('x')).toThrow(/exceeds/)
    expect(() => writer.finish()).toThrow(/no retained output/)
  })

  test('empty chunks do not create indentation for empty children', () => {
    const writer = new SvgWriter()
    const child = writer.indented(2)
    child.write('')
    expect(writer.finish()).toBe('')
    child.write('A\n')
    child.write('')
    child.write('B')
    expect(writer.finish()).toBe('  A\n  B')
  })
})

const rectangle = (): ShapeMark => ({
  kind: 'shape', id: 'bar', role: 'bar',
  geometry: { kind: 'rect', x: 1.25, y: 2, width: 3, height: 4 },
  paint: { fill: '#abc' }, identity: { id: 'A&B', role: 'bar' },
})

describe('private typed SVG recipes', () => {
  test('projects semantic geometry, paint and identity with literal independently expected bytes', () => {
    const recipe = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
      { name: 'x', value: v.geometry('x') }, { name: 'y', value: v.geometry('y') },
      { name: 'width', value: v.geometry('width') }, { name: 'height', value: v.geometry('height') },
      { name: 'fill', value: v.paint('fill') }, { name: 'data-id', value: v.identity('id') },
    ] })
    const mark = rectangle()
    expect(serializeSvgEmission(mark, recipe)).toBe('<rect x="1.25" y="2" width="3" height="4" fill="#abc" data-id="A&amp;B" />')
    // The recipe is presentation only: changing semantic geometry changes ink.
    mark.geometry = { kind: 'rect', x: 9, y: 2, width: 3, height: 4 }
    const expected = '<rect x="9" y="2" width="3" height="4" fill="#abc" data-id="A&amp;B" />'
    expect(serializeSvgEmission(mark, recipe)).toBe(expected)
    const bytes = new TextEncoder().encode(expected).length
    expect(measureSvgEmission(mark, recipe)).toBe(bytes)
    expect(() => measureSvgEmission(mark, recipe, {}, bytes - 1)).toThrow(/exceeds/)
  })

  test('copies aliases without freezing callers or retaining subsequent mutation', () => {
    const attribute = { name: 'data-label' as const, value: v.meta('<script>') }
    const attributes = [attribute, { name: 'data-alt' as const, value: attribute.value }]
    const source: SvgEmissionRecipe = { kind: 'primitive', attributes }
    const snapshot = snapshotSvgEmissionRecipe(source)
    attribute.value = v.meta('changed')
    attributes.push({ name: 'data-label', value: v.meta(1) })
    expect(Object.isFrozen(source)).toBe(false)
    expect(Object.isFrozen(snapshot)).toBe(true)
    if (snapshot.kind !== 'primitive') throw new Error('Expected primitive recipe')
    expect(snapshot.attributes[0]!.value).toBe(snapshot.attributes[1]!.value)
    expect(Object.isFrozen(snapshot.attributes[0])).toBe(true)
    expect(serializeSvgEmission(rectangle(), snapshot)).toBe('<rect data-label="&lt;script&gt;" data-alt="&lt;script&gt;" />')
    expect(svgEmissionMetadataCounts(snapshot).objects).toBeGreaterThan(0)
  })

  test('rejects executable or opaque markup slots and snapshots without invoking accessors', () => {
    let reads = 0
    const accessor = { kind: 'primitive', get attributes() { reads++; return [] } }
    expect(() => snapshotSvgEmissionRecipe(accessor as SvgEmissionRecipe)).toThrow(/data properties/)
    expect(reads).toBe(0)
    for (const extra of [{ raw: '<script/>' }, { serialize: () => '<script/>' }]) {
      expect(() => snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [], ...extra } as SvgEmissionRecipe)).toThrow()
    }
    const cycle: unknown[] = []
    cycle.push(cycle)
    expect(() => snapshotSvgEmissionRecipe({ kind: 'sequence', children: cycle } as SvgEmissionRecipe)).toThrow(/cycles/)
  })

  test('private metadata participates in budgets before output exists', () => {
    expect(() => snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [{ name: 'data-label', value: v.meta('x'.repeat(200)) }] }, {
      ...SVG_EMISSION_METADATA_LIMITS, maxTextBytes: 100,
    })).toThrow(/textBytes budget/)
    expect(() => snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [] }, {
      ...SVG_EMISSION_METADATA_LIMITS, maxObjects: 0,
    })).toThrow(/object budget/)
  })

  test('geometry has no metadata literal or mismatched-field escape', () => {
    for (const value of [v.meta(900), v.geometry('width')]) {
      const recipe = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [{ name: 'x', value }] })
      expect(() => serializeSvgEmission(rectangle(), recipe)).toThrow(/typed geometry|matching semantic field/)
    }
  })

  test('a retained ordinary Scene still receives explicitly requested fidelity checks', () => {
    const colors = { bg: '#ffffff', fg: '#111111' }
    const scene: SceneDoc = { family: 'flowchart', width: 20, height: 20, colors, transparent: false, parts: [
      marks.documentOpen({ id: 'prelude', width: 20, height: 20, colors, transparent: false, font: 'Inter', hasMonoFont: false }, {
        kind: 'prelude', width: 20, height: 20, colors, transparent: false, font: 'Inter', hasMonoFont: false, children: [],
      }),
      // A plausible lowering omission: the semantic box exists, but its ink
      // lacks coordinates/dimensions. Ordinary structural admission accepts
      // the data; a later requested cross-check must find the missing box.
      marks.shape({ id: 'box', role: 'node', geometry: { kind: 'rect', x: 1, y: 2, width: 3, height: 4 }, paint: {} }, {
        kind: 'primitive', attributes: [],
      }),
      marks.documentClose(),
    ] }
    const retained = admitSceneDocument(scene, 'internal', false)
    expect(retained).toBe(scene)
    expect(() => admitSceneDocument(retained, 'internal', true)).toThrow(/semantic 1 != crisp undefined/)
  })

  test('external snapshot never invokes derived group views on mutable source fields', () => {
    const group = marks.group({ id: 'group', role: 'group', emission: { kind: 'group', attributes: [] }, children: [] })
    let reads = 0
    Object.defineProperty(group, 'identity', { enumerable: true, get() { reads++; return { id: 'hostile', role: 'group' } } })
    expect(() => snapshotBoundedExternalData(group, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS)).toThrow(/enumerable data property/)
    expect(reads).toBe(0)
  })

  test('ordinary admission rejects definitions that omit their declared gradient ink', () => {
    const colors = { bg: '#ffffff', fg: '#111111' }
    const scene: SceneDoc = { family: 'flowchart', width: 20, height: 20, colors, transparent: false, parts: [
      marks.documentOpen({ id: 'prelude', width: 20, height: 20, colors, transparent: false, font: 'Inter', hasMonoFont: false }, {
        kind: 'prelude', width: 20, height: 20, colors, transparent: false, font: 'Inter', hasMonoFont: false, children: [],
      }),
      marks.definitions({ id: 'gradient', gradientResources: [{ id: 'g', units: 'userSpaceOnUse', x1: 0, y1: 0, x2: 10, y2: 10,
        stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
      }] }, { kind: 'resources', resources: [] }),
      marks.documentClose(),
    ] }
    expect(() => admitSceneDocument(scene, 'internal', false)).toThrow(/definitions must be generated from typed resources/)
  })
})
