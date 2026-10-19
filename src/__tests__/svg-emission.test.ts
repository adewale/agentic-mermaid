import { describe, expect, test } from 'bun:test'
import { buildExternalScene, DefaultBackend, EXTERNAL_SCENE_API_VERSION } from '../index.ts'
import { svgTextWhitespace, writeSvgTextWhitespace } from '../scene/svg-text-whitespace.ts'
import type { DocumentMark, SceneDoc, ShapeMark } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { admitSceneDocument, freezeBoundedFirstPartyData, snapshotBoundedExternalData, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS } from '../scene/external-data-snapshot.ts'
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

  test('projects the historical translate-scale spelling only from an equivalent typed matrix', () => {
    const recipe = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
      { name: 'transform', value: { source: 'transform', form: 'translate-scale' } },
    ] })
    const mark = rectangle()
    mark.transform = { kind: 'matrix', a: 0.5, b: 0, c: 0, d: 0.5, e: 12.25, f: -3 }
    expect(serializeSvgEmission(mark, recipe)).toBe('<rect transform="translate(12.25,-3) scale(0.5)" />')
    const spaced = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
      { name: 'transform', value: { source: 'transform', form: 'translate-scale-space' } },
    ] })
    expect(serializeSvgEmission(mark, spaced)).toBe('<rect transform="translate(12.25 -3) scale(0.5)" />')
    for (const transform of [
      { kind: 'matrix', a: 0.5, b: 1, c: 0, d: 0.5, e: 12.25, f: -3 },
      { kind: 'matrix', a: 0.5, b: 0, c: 1, d: 0.5, e: 12.25, f: -3 },
      { kind: 'matrix', a: 0.5, b: 0, c: 0, d: 2, e: 12.25, f: -3 },
      { kind: 'rotate', angle: 20, cx: 0, cy: 0 },
    ] as const) {
      mark.transform = transform
      expect(() => serializeSvgEmission(mark, recipe)).toThrow('uniform unrotated matrix')
    }
    expect(() => snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
      { name: 'transform', value: { source: 'transform', form: 'translate-scale', separator: 'comma' } },
    ] })).toThrow('fixed lexical separators')
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

  test('bounds expanded work even when a small shared recipe emits no bytes', () => {
    const empty: SvgEmissionRecipe = { kind: 'sequence', children: [], join: '' }
    const small: SvgEmissionRecipe = { kind: 'sequence', children: [empty, empty], join: '' }
    expect(serializeSvgEmission(rectangle(), snapshotSvgEmissionRecipe(small))).toBe('')
    let dag = empty
    // Twenty binary levels are tiny retained data, but over a million visits.
    // Reject at admission; never execute the expanded hostile recipe.
    for (let level = 0; level < 20; level++) dag = { kind: 'sequence', children: [dag, dag], join: '' }
    expect(() => snapshotSvgEmissionRecipe(dag)).toThrow('expanded emission budget')
    expect(Object.isFrozen(empty)).toBe(false)
  })

  test('a custom-limit snapshot must still satisfy default limits when reused', () => {
    let deep: SvgEmissionRecipe = { kind: 'sequence', children: [] }
    for (let level = 0; level < 33; level++) deep = { kind: 'sequence', children: [deep] }
    // Each level contains an object and an array: the explicit wider request
    // can admit this small input, while ordinary admission must reject it.
    const custom = snapshotSvgEmissionRecipe(deep, { ...SVG_EMISSION_METADATA_LIMITS, maxDepth: 128 })
    expect(Object.isFrozen(custom)).toBe(true)
    expect(Object.isFrozen(deep)).toBe(false)
    expect(() => snapshotSvgEmissionRecipe(custom)).toThrow('depth budget')
  })

  test('private stylesheet data cannot terminate its XML text context', () => {
    const document: DocumentMark = { kind: 'document', id: 'styles', role: 'chrome', element: 'content', nonPaint: 'stylesheet' }
    const safe = snapshotSvgEmissionRecipe({ kind: 'stylesheet', css: '.label{fill:#123456}' })
    expect(serializeSvgEmission(document, safe)).toBe('<style>.label{fill:#123456}</style>')
    for (const css of ['</style><script/>', '.label::before{content:"<"}']) {
      expect(() => snapshotSvgEmissionRecipe({ kind: 'stylesheet', css })).toThrow('XML markup delimiters')
    }
  })

  test.each([
    ['external snapshot', snapshotBoundedExternalData],
    ['first-party freeze', freezeBoundedFirstPartyData],
  ] as const)('%s charges hidden recipe text against the enclosing aggregate budget', (_name, admit) => {
    const mark = (id: string) => marks.shape({ ...rectangle(), id }, {
      kind: 'primitive', attributes: [{ name: 'data-note', value: v.meta('x'.repeat(80)) }],
    })
    const limits = { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, maxTextBytes: 220 }
    expect(() => admit([mark('one')], limits)).not.toThrow()
    // Both individual recipes are small; their combined private text exceeds
    // the literal enclosing limit even though the public fields do not.
    expect(() => admit([mark('one'), mark('two')], limits)).toThrow('Private SVG emission metadata exceeds the aggregate Scene data limits')
  })

  test.each([
    ['objects', { maxObjects: 5 }],
    ['properties', { maxAggregateProperties: 14 }],
    ['array entries', { maxAggregateArrayEntries: 1 }],
    ['property-key bytes', { maxAggregatePropertyKeyBytes: 60 }],
  ] as const)('hidden recipe %s share the enclosing Scene budget', (_name, override) => {
    const limits = { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, ...override }
    for (const admit of [snapshotBoundedExternalData, freezeBoundedFirstPartyData]) {
      // These literal budgets admit the semantic rectangle alone. Its private
      // recipe contributes extra data even though no SVG has been materialized.
      expect(() => admit([rectangle()], limits)).not.toThrow()
      const typed = marks.shape(rectangle(), { kind: 'primitive', attributes: [{ name: 'data-note', value: v.meta('kept') }] })
      expect(() => admit([typed], limits)).toThrow(/Private SVG emission metadata|object graph is too large/)
    }
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

  test('the exported backend snapshots typed external groups without freezing callers or executing source getters', () => {
    const safe = buildExternalScene({
      version: EXTERNAL_SCENE_API_VERSION, family: 'family:test/owned-group', width: 20, height: 20,
      colors: { bg: '#fff', fg: '#111' }, metadata: { title: 'Owned group' },
      parts: [{ kind: 'container', id: 'group', role: 'group', children: [] }],
    })
    const group = marks.group({ id: 'group', role: 'group', emission: { kind: 'group', attributes: [] }, children: [] })
    const source = { ...safe, parts: safe.parts.map(part => part.kind === 'group' ? group : part) }
    const output = DefaultBackend.render(source, { seed: 0 })
    expect(output).toContain('<g data-id="group" data-role="group">')
    expect(Object.isFrozen(source)).toBe(false)
    expect(Object.isFrozen(source.parts)).toBe(false)
    expect(Object.isFrozen(group)).toBe(false)
    let reads = 0
    Object.defineProperty(group, 'identity', { enumerable: true, get() { reads++; return { id: 'hostile', role: 'group' } } })
    expect(() => DefaultBackend.render(source, { seed: 0 })).toThrow(/enumerable data property/)
    expect(reads).toBe(0)
    expect(Object.isFrozen(group)).toBe(false)
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

describe('typed literal text whitespace', () => {
  test.each([
    { original: 'A B', source: 'A B', edits: undefined, xml: 'A B' },
    { original: 'A  B', source: 'A B', edits: [{ offset: 1, length: 1 as const, value: '  ' }], xml: 'A  B' },
    { original: '\u00a0A\r\nB\ufeff', source: 'A B', edits: [{ offset: 0, length: 0 as const, value: '\u00a0' }, { offset: 1, length: 1 as const, value: '\r\n' }, { offset: 3, length: 0 as const, value: '\ufeff' }], xml: '\u00a0A\r\nB\ufeff' },
    { original: '👩‍💻\t B', source: '👩‍💻 B', edits: [{ offset: 5, length: 1 as const, value: '\t ' }], xml: '👩‍💻\t B' },
    { original: '<x>  &', source: '<x> &', edits: [{ offset: 3, length: 1 as const, value: '  ' }], xml: '&lt;x&gt;  &amp;' },
    { original: ' \u00a0\t', source: '', edits: [{ offset: 0, length: 0 as const, value: ' \u00a0\t' }], xml: ' \u00a0\t' },
    { original: '', source: '', edits: undefined, xml: '' },
  ])('retains original whitespace without a second visible-text authority: $original', ({ original, source, edits, xml }) => {
    expect(svgTextWhitespace(original, source)).toEqual(edits)
    const writer = new SvgWriter()
    writeSvgTextWhitespace(source, edits ?? [], writer)
    expect(writer.finish()).toBe(xml)
  })

  test('rejects a changed visible source and edits that replace or insert visible content', () => {
    expect(() => svgTextWhitespace('A B', 'A C')).toThrow('normalized semantic text')
    for (const edits of [
      [{ offset: 1, length: 1 as const, value: 'X' }],
      [{ offset: 0, length: 1 as const, value: ' ' }],
      [{ offset: 1, length: 0 as const, value: ' ' }],
      [{ offset: 0, length: 0 as const, value: '<' }],
      [{ offset: 1, length: 1 as const, value: '\u00a0' }],
      [{ offset: 3, length: 0 as const, value: ' ' }, { offset: 1, length: 1 as const, value: '  ' }],
      [{ offset: 1, length: 1 as const, value: '  ' }, { offset: 1, length: 1 as const, value: '\t' }],
    ]) {
      const writer = new SvgWriter()
      expect(() => writeSvgTextWhitespace('A B', edits, writer)).toThrow()
      expect(writer.finish()).toBe('')
    }
  })
})
