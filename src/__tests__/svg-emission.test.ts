import { describe, expect, test } from 'bun:test'
import { buildExternalScene, DefaultBackend, EXTERNAL_SCENE_API_VERSION, renderMermaidSVG } from '../index.ts'
import { svgTextWhitespace, writeSvgTextWhitespace } from '../scene/svg-text-whitespace.ts'
import type { DocumentMark, SceneDoc, ShapeMark } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { admitSceneDocument, freezeBoundedFirstPartyData, snapshotBoundedExternalData, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS } from '../scene/external-data-snapshot.ts'
import {
  measureSvgEmission, serializeSvgEmission, snapshotSvgEmissionRecipe, validateSvgEmissionRecipe,
  SVG_EMISSION_METADATA_LIMITS, svgEmissionMetadataCounts, svgValue as v,
  snapshotSvgGroupMetadata, attachSvgGroupMetadata, svgGroupMetadataCounts,
  type SvgEmissionRecipe,
} from '../scene/svg-emission.ts'
import { SvgWriter } from '../scene/svg-writer.ts'
import { sceneDocumentEmission, attachSceneNodeEmission, sceneNodeEmission } from '../scene/serialization.ts'
import { renderDefaultScene } from '../scene/backend.ts'
import { SceneValidationError } from '../scene/scene-validation.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { lowerGraphScene } from '../renderer.ts'

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

  test('shared group programs project isolated semantic identities and copied scalar metadata', () => {
    const program = snapshotSvgEmissionRecipe({ kind: 'group', attributes: [
      { name: 'class', value: v.identity('classNames') }, { name: 'data-id', value: v.identity('id') },
      { name: 'data-label', value: { source: 'groupMetadata', field: 'label' }, display: true },
      { name: 'data-shape', value: { source: 'groupMetadata', field: 'shape' } },
      { name: 'data-semantic-shape', value: { source: 'groupMetadata', field: 'semanticShape' } },
      { name: 'data-href', value: { source: 'groupMetadata', field: 'href' } },
    ] })
    if (program.kind !== 'group') throw new Error('Expected group program')
    const classes = ['node', 'hot']
    const metadata = { label: 'Alpha & <B>', shape: 'rectangle' }
    let reads = 0
    const proxy = new Proxy(metadata, { get() { reads++; throw new Error('caller read') } })
    const identity = new Proxy({ id: 'A&B', classNames: classes }, { get() { reads++; throw new Error('caller identity read') } })
    const first = marks.group({ id: 'first', role: 'node', identity,
      emission: program, emissionMetadata: proxy, children: [] })
    const second = marks.group({ id: 'second', role: 'node', identity: { id: '界', classNames: ['node', 'cold'] },
      emission: program, emissionMetadata: { label: 'Beta', shape: 'diamond', semanticShape: 'decision', href: '/safe' }, children: [] })
    metadata.label = 'changed'; classes.push('leaked')
    const safe = buildExternalScene({
      version: EXTERNAL_SCENE_API_VERSION, family: 'family:test/owned-group', width: 20, height: 20,
      colors: { bg: '#fff', fg: '#111' }, metadata: { title: 'Groups' },
      parts: [{ kind: 'container', id: 'placeholder', role: 'group', children: [] }],
    })
    const external = { ...safe, parts: safe.parts.flatMap<SceneDoc['parts'][number]>(part => part.kind === 'group' ? [first, second] : [part]) }
    // Built-in wrapper metadata is not a public external-container extension.
    expect(() => DefaultBackend.render(external, { seed: 0 })).toThrow('external containers must use the canonical generated wrapper')
    const shell = lowerGraphScene({ positioned: { width: 20, height: 20, nodes: [], edges: [], groups: [] },
      colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } })
    const source = { ...shell, parts: [...shell.parts.slice(0, -1), first, second, shell.parts.at(-1)!] }
    const output = DefaultBackend.render(source, { seed: 0 })
    expect(output).toContain('<g class="node hot" data-id="A&amp;B" data-label="Alpha &amp; &lt;B&gt;" data-shape="rectangle" data-role="node">')
    expect(output).toContain('<g class="node cold" data-id="界" data-label="Beta" data-shape="diamond" data-semantic-shape="decision" data-href="/safe" data-role="node">')
    expect(reads).toBe(0)
    expect(Object.isFrozen(metadata)).toBe(false)
    expect(Object.isFrozen(classes)).toBe(false)
    expect(Object.isFrozen(source.parts)).toBe(false)
    const copied = snapshotBoundedExternalData(first, EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS) as typeof first
    expect(copied.open).toBe('<g class="node hot" data-id="A&amp;B" data-label="Alpha &amp; &lt;B&gt;" data-shape="rectangle" data-role="node">')
    expect(copied.close).toBe('</g>')
    const capturedProgram = sceneNodeEmission(copied)
    if (!capturedProgram) throw new Error('Missing captured group program')
    attachSceneNodeEmission(copied, capturedProgram)
    expect(DefaultBackend.drawNode(copied, { seed: 0 })).toBe('<g class="node hot" data-id="A&amp;B" data-label="Alpha &amp; &lt;B&gt;" data-shape="rectangle" data-role="node">\n</g>')
    Object.defineProperty(first, 'open', { enumerable: true, get() { reads++; throw new Error('poisoned source view') } })
    expect(copied.open).toContain('data-label="Alpha &amp; &lt;B&gt;"')
    expect(reads).toBe(0)
  })

  test('node wrapper programs preserve heterogeneous public Flow metadata and strict interactions', () => {
    const source = 'flowchart LR\nA["Alpha"]:::hot --> B{"界"}\nclick A href "https://example.test/path"'
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('<g class="node hot" data-id="A" data-label="Alpha" data-shape="rectangle" data-href="https://example.test/path" role="link" tabindex="0" data-role="node">')
    expect(svg).toContain('<g class="node" data-id="B" data-label="界" data-shape="diamond" data-role="node">')
    const strict = renderMermaidSVG(source, { security: 'strict' })
    expect(strict).toContain('<g class="node hot" data-id="A" data-label="Alpha" data-shape="rectangle" data-role="node">')
    expect(strict).not.toContain('data-href=')
  })

  test('closed group scalar metadata rejects accessors and mismatched projection sites', () => {
    let reads = 0
    const accessor = Object.defineProperty({ shape: 'rectangle' }, 'label', { enumerable: true, get() { reads++; return 'caller' } })
    expect(() => snapshotSvgGroupMetadata(accessor as { label: string; shape: string })).toThrow('enumerable data properties')
    expect(reads).toBe(0)
    expect(Object.isFrozen(accessor)).toBe(false)
    expect(() => snapshotSvgGroupMetadata({ label: 'A', shape: 'rectangle', markup: '<g>' } as { label: string; shape: string })).toThrow('Unknown SVG group metadata field')
    expect(() => snapshotSvgEmissionRecipe({ kind: 'group', attributes: [
      { name: 'fill', value: { source: 'groupMetadata', field: 'label' } },
    ] })).toThrow('matching data attribute')
  })

  test('closed group scalar capture counts literal UTF-8 data and respects custom limits on reuse', () => {
    const metadata = snapshotSvgGroupMetadata({ label: '界', shape: 'r' })
    expect(svgGroupMetadataCounts(metadata)).toEqual({ objects: 1, properties: 2, arrayEntries: 0, textBytes: 4, propertyKeyBytes: 10 })
    for (const override of [{ maxObjects: 0 }, { maxProperties: 1 }, { maxTextBytes: 3 }, { maxPropertyKeyBytes: 9 }, { maxDepth: 0 }]) {
      expect(() => snapshotSvgGroupMetadata(metadata, { ...SVG_EMISSION_METADATA_LIMITS, ...override })).toThrow(/budget/)
    }
    expect(() => snapshotSvgGroupMetadata(metadata, { ...SVG_EMISSION_METADATA_LIMITS, maxObjects: 1, maxProperties: 2,
      maxArrayEntries: 0, maxTextBytes: 4, maxPropertyKeyBytes: 10, maxDepth: 1 })).not.toThrow()
    const large = snapshotSvgGroupMetadata({ label: 'x'.repeat(5_000_001), shape: 'r' }, { ...SVG_EMISSION_METADATA_LIMITS, maxTextBytes: 6_000_000 })
    expect(() => snapshotSvgGroupMetadata(large)).toThrow('textBytes budget')
  })

  test('group identity bounds class copying before enumeration and retains the literal boundary', () => {
    const group = (identity: { id: string; classNames?: readonly string[] }) => marks.group({
      id: 'identity', role: 'node', identity, children: [], emission: { kind: 'group', attributes: [
        { name: 'class', value: v.identity('classNames') }, { name: 'data-id', value: v.identity('id') },
      ] },
    })
    let enumerations = 0
    let elementDescriptors = 0
    const oversized = new Proxy(new Array<string>(100_001), {
      ownKeys() { enumerations++; throw new Error('oversized enumeration') },
      getOwnPropertyDescriptor(target, key) {
        if (key !== 'length') elementDescriptors++
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })
    expect(() => group({ id: 'oversized', classNames: oversized })).toThrow('too many classes')
    expect(enumerations).toBe(0)
    expect(elementDescriptors).toBe(0)
    const classes = Array.from({ length: 100_000 }, () => 'x')
    const captured = group({ id: 'edge', classNames: classes })
    classes[99_999] = 'changed'
    expect(captured.identity?.classNames).toHaveLength(100_000)
    expect(captured.identity?.classNames?.at(-1)).toBe('x')
    expect(captured.open.startsWith('<g class="x x ')).toBe(true)
    expect(captured.open.endsWith(' x" data-id="edge" data-role="node">')).toBe(true)
    const hiddenKey = new Proxy(['x'], { ownKeys() { return ['length', 'other'] } })
    expect(() => group({ id: 'hidden-key', classNames: hiddenKey })).toThrow('dense data')
  })

  test('group identity rejects excess descriptors and charges UTF-8 across scalar fields', () => {
    const group = (identity: { id: string; from?: string }) => marks.group({
      id: 'identity', role: 'node', identity, children: [], emission: { kind: 'group', attributes: [] },
    })
    let descriptors = 0
    const oversized = new Proxy({ id: 'A', from: 'B', to: 'C', classNames: [], extra: 'unknown' }, {
      getOwnPropertyDescriptor(target, key) { descriptors++; return Reflect.getOwnPropertyDescriptor(target, key) },
    })
    expect(() => group(oversized)).toThrow('too many properties')
    expect(descriptors).toBe(0)
    let reads = 0
    const accessor = Object.defineProperty({}, 'id', { enumerable: true, get() { reads++; return 'A' } })
    expect(() => group(accessor as { id: string })).toThrow('enumerable data properties')
    expect(reads).toBe(0)
    expect(() => group(new Proxy({ id: 'hidden' }, { ownKeys() { return [] } }))).toThrow('requires an id')
    //1,666,666 three-byte characters plus two ASCII bytes exactly meets5M.
    const text = '界'.repeat(1_666_666) + 'aa'
    expect(group({ id: text }).identity?.id).toBe(text)
    expect(() => group({ id: text, from: 'x' })).toThrow('UTF-8 text budget')
  })

  test.each([
    ['external snapshot', snapshotBoundedExternalData], ['first-party freeze', freezeBoundedFirstPartyData],
  ] as const)('%s accounts for shared hidden group scalars, aggregate UTF-8 and enclosing depth', (_name, admit) => {
    // Minimal carrier objects isolate this generic data boundary's accounting
    // from independent Scene validity. Actual admitted groups are tested above.
    const metadata = snapshotSvgGroupMetadata({ label: '界', shape: 'r' })
    const carrier = (value = metadata) => { const node = {}; attachSvgGroupMetadata(node, value); return node }
    const limits = { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, maxObjects: 4, maxTextBytes: 4,
      maxAggregateProperties: 2, maxAggregatePropertyKeyBytes: 10, maxAggregateArrayEntries: 2, maxDepth: 2 }
    // One root array, two carriers, one aliased scalar record. The only text
    // is the three-byte CJK label plus one ASCII shape; keys have ten bytes.
    expect(() => admit([carrier(), carrier()], limits)).not.toThrow()
    for (const override of [{ maxObjects: 3 }, { maxTextBytes: 3 }, { maxAggregateProperties: 1 }, { maxAggregatePropertyKeyBytes: 9 }]) {
      expect(() => admit([carrier(), carrier()], { ...limits, ...override })).toThrow()
    }
    expect(() => admit([carrier(), carrier(snapshotSvgGroupMetadata({ label: '界', shape: 'r' }))], limits)).toThrow(/Private SVG emission metadata/)
    expect(() => admit([carrier(), { nested: carrier() }], { ...EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS, maxDepth: 2 })).toThrow('too deeply nested')
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
    for (const frozen of [false, true]) {
      let reads = 0
      const accessor = { kind: 'primitive', get attributes() { reads++; return [] } }
      if (frozen) Object.freeze(accessor)
      expect(() => snapshotSvgEmissionRecipe(accessor as SvgEmissionRecipe)).toThrow(/data properties/)
      expect(reads).toBe(0)
    }
    for (const extra of [{ raw: '<script/>' }, { serialize: () => '<script/>' }]) {
      expect(() => snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [], ...extra } as SvgEmissionRecipe)).toThrow()
    }
    const cycle: unknown[] = []
    cycle.push(cycle)
    expect(() => snapshotSvgEmissionRecipe({ kind: 'sequence', children: cycle } as SvgEmissionRecipe)).toThrow(/cycles/)
  })

  test('capture preserves copied numeric-key error order while direct validation observes caller keys', () => {
    const source = new Proxy({ kind: 'close', zeta: true, 10: true, 2: true }, {
      ownKeys() { return ['zeta', '10', '2', 'kind'] },
      get() { throw new Error('caller property read') },
    }) as unknown as SvgEmissionRecipe
    // Copying into an ordinary record orders integer keys before other keys.
    expect(() => snapshotSvgEmissionRecipe(source)).toThrow('Unknown SVG recipe field 2')
    // Direct validation retains the caller-facing ownKeys order instead.
    expect(() => validateSvgEmissionRecipe(source)).toThrow('Unknown SVG recipe field zeta')
  })

  test('direct validation retains repeated own-key and accessor observations', () => {
    let enumerations = 0
    const changing = new Proxy({ kind: 'close' }, {
      ownKeys() { return ++enumerations === 1 ? ['kind'] : ['kind', 'late'] },
    }) as unknown as SvgEmissionRecipe
    expect(() => validateSvgEmissionRecipe(changing)).toThrow('Unknown SVG recipe field late')
    expect(enumerations).toBe(2)

    let reads = 0
    const accessor = { kind: 'primitive', get attributes() { reads++; return [] } } as SvgEmissionRecipe
    expect(() => validateSvgEmissionRecipe(accessor)).not.toThrow()
    expect(reads).toBe(1)
    expect(() => snapshotSvgEmissionRecipe(accessor)).toThrow('enumerable data properties')
    expect(reads).toBe(1)
  })

  test('a Proxy of owned metadata cannot execute caller reads', () => {
    const owned = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [{ name: 'data-note', value: v.meta('kept') }] })
    let reads = 0
    const proxy = new Proxy(owned, { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver) } })
    const captured = snapshotSvgEmissionRecipe(proxy)
    expect(serializeSvgEmission(rectangle(), captured)).toBe('<rect data-note="kept" />')
    expect(reads).toBe(0)
  })

  test('a mutable wrapper around owned metadata is still captured without freezing its caller', () => {
    const owned = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [{ name: 'data-note', value: v.meta('kept') }] })
    const children: SvgEmissionRecipe[] = [owned]
    const source: SvgEmissionRecipe = { kind: 'sequence', children, join: '' }
    const captured = snapshotSvgEmissionRecipe(source)
    children.push({ kind: 'primitive', attributes: [{ name: 'data-note', value: v.meta('late') }] })
    expect(serializeSvgEmission(rectangle(), captured)).toBe('<rect data-note="kept" />')
    expect(Object.isFrozen(source)).toBe(false)
    expect(Object.isFrozen(children)).toBe(false)
  })

  test('overlapping owned descendants obey a literal six-object enclosing budget', () => {
    const shared: SvgEmissionRecipe = { kind: 'sequence', children: [] }
    const owned = snapshotSvgEmissionRecipe({
      kind: 'sequence', children: [shared, { kind: 'sequence', children: [shared] }],
    })
    if (owned.kind !== 'sequence') throw new Error('Expected sequence')
    const source: SvgEmissionRecipe = { kind: 'sequence', children: [...owned.children] }
    // Root+array, empty child+array, wrapper child+array: six unique objects.
    // The empty child is also reached through the wrapper; charge it once.
    expect(() => snapshotSvgEmissionRecipe(source, { ...SVG_EMISSION_METADATA_LIMITS, maxObjects: 6 })).not.toThrow()
    expect(() => snapshotSvgEmissionRecipe(source, { ...SVG_EMISSION_METADATA_LIMITS, maxObjects: 5 })).toThrow('object budget')
  })

  test('custom capture limits count a literal text leaf and its enclosing aliases without a family AST census', () => {
    const leaf: SvgEmissionRecipe = { kind: 'documentText', element: 'title', text: '界' }
    // One object, three properties; values have 12+5+3 UTF-8 bytes and
    // property names have 4+7+4 bytes. Every scalar is at depth 1.
    const limits = { ...SVG_EMISSION_METADATA_LIMITS, maxObjects: 1, maxProperties: 3,
      maxArrayEntries: 0, maxTextBytes: 20, maxPropertyKeyBytes: 15, maxDepth: 1 }
    const owned = snapshotSvgEmissionRecipe(leaf, limits)
    expect(svgEmissionMetadataCounts(owned)).toEqual({ objects: 1, properties: 3, arrayEntries: 0, textBytes: 20, propertyKeyBytes: 15 })
    for (const [override, diagnostic] of [
      [{ maxObjects: 0 }, 'object budget'], [{ maxProperties: 2 }, 'property budget'],
      [{ maxTextBytes: 19 }, 'textBytes budget'], [{ maxPropertyKeyBytes: 14 }, 'propertyKeyBytes budget'],
      [{ maxDepth: 0 }, 'depth budget'],
    ] as const) expect(() => snapshotSvgEmissionRecipe(owned, { ...limits, ...override })).toThrow(diagnostic)
    const outer: SvgEmissionRecipe = { kind: 'sequence', children: [owned, owned] }
    // New root+array+one shared leaf; 2 root+2 array+3 leaf properties.
    const enclosing = { ...SVG_EMISSION_METADATA_LIMITS, maxObjects: 3, maxProperties: 7, maxArrayEntries: 2, maxDepth: 3 }
    expect(() => snapshotSvgEmissionRecipe(outer, enclosing)).not.toThrow()
    for (const [override, diagnostic] of [
      [{ maxObjects: 2 }, 'object budget'], [{ maxProperties: 6 }, 'property budget'],
      [{ maxArrayEntries: 1 }, 'array budget'], [{ maxDepth: 2 }, 'depth budget'],
    ] as const) expect(() => snapshotSvgEmissionRecipe(outer, { ...enclosing, ...override })).toThrow(diagnostic)
    expect(Object.isFrozen(leaf)).toBe(false)
  })

  test('Timeline lexical operands do not authorize generic color mixes, recursive operands or new properties', () => {
    const mix = { source: 'colorMix' as const, primary: v.meta('url(https://example.test/paint)'), secondary: v.meta('var(--bg)'), amount: 11 }
    const scoped = { name: 'style' as const, value: { source: 'style' as const, declarations: [{ property: '--tl-pill-fill' as const, value: mix }] } }
    expect(() => snapshotSvgEmissionRecipe({ kind: 'group', attributes: [scoped] })).not.toThrow()
    // Reusing the identical object under an ordinary attribute must recheck
    // that occurrence's generic context after its scoped occurrence passed.
    expect(() => snapshotSvgEmissionRecipe({ kind: 'group', attributes: [scoped, { name: 'fill', value: mix }] })).toThrow('SVG color-mix operand')
    expect(() => snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ ...scoped, value: {
      source: 'style', declarations: [{ property: '--tl-pill-fill', value: { ...mix, primary: mix } }],
    } }] })).toThrow('non-recursive typed paints')
    expect(() => snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ ...scoped, value: {
      source: 'style', declarations: [{ property: '--not-timeline', value: v.meta('red') }],
    } }] } as unknown as SvgEmissionRecipe)).toThrow('Unsupported SVG recipe value')
    expect(() => snapshotSvgEmissionRecipe({ kind: 'group', attributes: [{ ...scoped, value: {
      source: 'style', declarations: [{ property: '--tl-fill', value: v.meta(42) }],
    } }] })).toThrow('Scoped palette paints require CSS text')
  })

  test('captured lexical span text remains bounded plain data without caller getter reads', () => {
    const span = { start: 0, end: 1, text: '<&界>', attributes: [] }
    const source: SvgEmissionRecipe = { kind: 'text', layout: 'multiline', attributes: [], spans: [span] }
    const captured = snapshotSvgEmissionRecipe(source)
    if (captured.kind !== 'text') throw new Error('Expected text recipe')
    span.text = 'changed'
    expect(captured.spans?.[0]?.text).toBe('<&界>')
    expect(Object.isFrozen(span)).toBe(false)
    expect(() => snapshotSvgEmissionRecipe({ ...source, spans: [{ ...span, text: 42 }] } as unknown as SvgEmissionRecipe)).toThrow('SVG recipe text must be strings')
    let reads = 0
    const accessor = Object.defineProperty({ start: 0, end: 1, attributes: [] }, 'text', {
      enumerable: true, get() { reads++; return 'caller text' },
    })
    expect(() => snapshotSvgEmissionRecipe({ ...source, spans: [accessor] })).toThrow('enumerable data properties')
    expect(reads).toBe(0)
    expect(() => snapshotSvgEmissionRecipe({ ...source, spans: [{ ...span, text: '界'.repeat(100) }] }, {
      ...SVG_EMISSION_METADATA_LIMITS, maxTextBytes: 200,
    })).toThrow('textBytes budget')
  })

  test('owned descendants still consume depth beneath a new parent', () => {
    let inner: SvgEmissionRecipe = { kind: 'sequence', children: [] }
    for (let level = 0; level < 16; level++) inner = { kind: 'sequence', children: [inner] }
    const owned = snapshotSvgEmissionRecipe(inner)
    expect(() => snapshotSvgEmissionRecipe({ kind: 'sequence', children: [owned] })).not.toThrow()
    let deep = owned
    // Together33 sequence edges alternate objects/arrays past data depth64;
    // the independent grammar's sequence depth remains below64.
    for (let level = 0; level < 17; level++) deep = { kind: 'sequence', children: [deep] }
    expect(() => snapshotSvgEmissionRecipe(deep)).toThrow('depth budget')
  })

  test.each([
    ['incompatible text layout', () => {
      const owned = snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', positionFormat: 'round2', attributes: [] })
      return { ...owned, layout: 'direct' } as SvgEmissionRecipe
    }, /Projected text coordinates require multiline emission/],
    ['expanded alias work', () => {
      let dag: SvgEmissionRecipe = { kind: 'sequence', children: [], join: '' }
      for (let level = 0; level < 17; level++) dag = { kind: 'sequence', children: [dag, dag], join: '' }
      const owned = snapshotSvgEmissionRecipe(dag)
      // The owned child is valid on its own; doubling its262143 projected
      // steps exceeds400000. Reject admission; never emit this recipe.
      return { kind: 'sequence', children: [owned, owned], join: '' } as SvgEmissionRecipe
    }, /expanded emission budget/],
  ] as const)('a new root with owned children still rejects %s', (_name, source, diagnostic) => {
    expect(() => snapshotSvgEmissionRecipe(source())).toThrow(diagnostic)
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

describe('actual typed text emission witness', () => {
  test('escapes lexical span text without changing semantic prepared text', () => {
    const recipe: SvgEmissionRecipe = { kind: 'text', layout: 'multiline', attributes: [],
      spans: [{ start: 0, end: 2, text: '<&', attributes: [] }] }
    const block = preparePixelText('AB', { display: 'literal', fontSize: 12, fontWeight: 400 })
    const node = marks.text({ id: 'lexical', role: 'label', text: 'AB', block, x: 0, y: 0, fontSize: 12, anchor: 'start', paint: {} }, recipe)
    const writer = new SvgWriter()
    sceneDocumentEmission(writer).writeNode(node)
    expect(writer.finish()).toContain('<tspan>&lt;&amp;</tspan>')
    expect(node.text).toBe('AB')
    expect(node.block!.text).toBe('AB')
  })

  const fitted = '<text x="1" y="2" font-size="20" data-prepared-text="true" dy="7" textLength="42" lengthAdjust="spacingAndGlyphs" data-font-metrics="deterministic-fit">Alpha</text>'
  test.each([
    { layout: 'multiline' as const, retained: true, forged: false, alreadyFitted: true, xml: fitted },
    { layout: 'direct' as const, retained: true, forged: false, alreadyFitted: false, xml: '<text font-size="20">Alpha</text>' },
    { layout: 'multiline' as const, retained: false, forged: false, alreadyFitted: false, xml: '<text x="1" y="2" font-size="20" dy="7">Alpha</text>' },
    { layout: 'direct' as const, retained: true, forged: true, alreadyFitted: false, xml: '<text font-size="20" data-prepared-text="true">Alpha</text>' },
    { layout: 'multiline' as const, retained: false, forged: true, alreadyFitted: false, xml: '<text x="1" y="2" font-size="20" data-prepared-text="true" dy="7">Alpha</text>' },
  ])('nested $layout retained=$retained forged=$forged observes actual emission', ({ layout, retained, forged, alreadyFitted, xml }) => {
    const execution = createTextMeasurementExecution({ id: 'test:emission-witness', version: '1.0.0', measure: () => 42 }, 'Inter')
    const root = withTextMeasurementExecution(execution, () => {
      const block = preparePixelText('Alpha', { display: 'literal', fontSize: 20, fontWeight: 400 })
      const prepared = marks.text({ id: 'prepared', role: 'label', text: 'Alpha', block, x: 1, y: 2, fontSize: 20, anchor: 'start', paint: {} }, {
        kind: 'text', layout: 'multiline', attributes: [{ name: 'font-size', value: v.text('fontSize') }],
      })
      const candidate = marks.text({ id: 'candidate', role: 'label', text: 'Alpha', ...(retained ? { block } : {}), x: 1, y: 2, fontSize: 20, anchor: 'start', paint: {} }, {
        kind: 'text', layout, attributes: [
          { name: 'font-size', value: v.text('fontSize') }, ...(forged ? [{ name: 'data-prepared-text' as const, value: v.meta('true') }] : []),
        ],
      })
      const inner = marks.group({ id: 'inner', role: 'chrome', emission: { kind: 'group', attributes: [] }, join: '', children: [{ node: prepared, indent: 0 }, { node: candidate, indent: 0 }] })
      return marks.group({ id: 'outer', role: 'chrome', emission: { kind: 'group', attributes: [] }, join: '', children: [{ node: inner, indent: 0 }] })
    })
    const writer = new SvgWriter()
    const emission = sceneDocumentEmission(writer)
    emission.writeNode(root)
    expect(writer.finish()).toBe(`<g><g>${fitted}${xml}</g></g>`)
    expect(emission.textAlreadyFitted).toBe(alreadyFitted)
  })
})

describe('typed text backgrounds', () => {
  const background = { padding: 4, rx: 2, ry: 3, paint: { fill: '#ffffff', stroke: '#111111', strokeWidth: '1' } }
  const text = (padding = 4) => withTextMeasurementExecution(createTextMeasurementExecution({ id: 'test:background-metrics', version: '1.0.0', measure: () => 42 }, 'Inter'), () => {
    const block = preparePixelText('Alpha', { display: 'literal', fontSize: 20, fontWeight: 400 })
    return marks.text({ id: 'pill', role: 'member', text: 'Alpha', block, x: 100, y: 50, fontSize: 20, anchor: 'start', paint: {} }, {
      kind: 'text', layout: 'multiline', attributes: [{ name: 'font-size', value: v.text('fontSize') }], background: { ...background, padding },
    })
  })

  test('derives rectangle metrics and keeps semantic identity on its first carrier', () => {
    const writer = new SvgWriter()
    sceneDocumentEmission(writer).writeNode(text())
    expect(writer.finish()).toBe('<rect x="75" y="33" width="50" height="34" rx="2" ry="3" fill="#ffffff" stroke="#111111" stroke-width="1" data-id="pill" data-role="member" />\n<text x="100" y="50" font-size="20" data-prepared-text="true" dy="7" textLength="42" lengthAdjust="spacingAndGlyphs" data-font-metrics="deterministic-fit">Alpha</text>')
  })

  test('rejects competing geometry, paint and forged identity at actual metadata capture', () => {
    for (const attribute of [
      { name: 'x', value: v.geometry('x') }, { name: 'fill', value: v.paint('fill') },
      { name: 'data-id', value: v.meta('forged') }, { name: 'data-id', value: v.identity('role') },
    ] as const) {
      expect(() => snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [], background: { ...background, attributes: [attribute] } }))
        .toThrow('background attributes must project semantic identity or accessibility')
    }
    for (const field of ['padding', 'rx', 'ry'] as const) {
      expect(() => snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [], background: { ...background, [field]: -1 } })).toThrow('non-negative')
    }
    expect(() => snapshotSvgEmissionRecipe({ kind: 'text', layout: 'multiline', attributes: [], background: { ...background, paint: { ...background.paint, fill: 'url(https://example.com)' } } })).toThrow('text background fill')
  })

  test('finite padding whose derived geometry overflows throws before any bytes', () => {
    const node = text(Number.MAX_VALUE)
    const writer = new SvgWriter()
    expect(() => sceneDocumentEmission(writer).writeNode(node)).toThrow('background geometry must be finite')
    expect(writer.finish()).toBe('')
  })
})

describe('typed document output limits', () => {
  const document = (titles: readonly string[]): SceneDoc => {
    const colors = { bg: '#ffffff', fg: '#111111' }
    return { family: 'flowchart', width: 20, height: 20, colors, transparent: false, parts: [
      marks.documentOpen({ id: 'prelude', width: 20, height: 20, colors, transparent: false, font: 'Inter', hasMonoFont: false }, {
        kind: 'prelude', width: 20, height: 20, colors, transparent: false, font: 'Inter', hasMonoFont: false, children: [],
      }),
      ...titles.map((text, index) => marks.documentText({ id: `title-${index}`, element: 'title', text })),
      marks.documentClose(),
    ] }
  }

  test('the actual default emitter preserves the public eight-million-byte limit diagnostic', () => {
    // Each title expands to four million bytes plus its tags, below the
    // five-million-byte node cap; their joined document exceeds eight million.
    const title = '&'.repeat(800_000)
    let error: unknown
    try { renderDefaultScene(document([title, title]), { seed: 0 }, 8_000_000) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(RangeError)
    expect((error as Error).message).toBe('backend/family SVG output exceeds the 8000000-byte final SVG limit')
  })

  test('an oversized node keeps its earlier Scene validation diagnostic', () => {
    // Escaping exactly one million ampersands fills the node cap before its
    // closing tag; the semantic title itself is still within the text limit.
    let error: unknown
    try { renderDefaultScene(document(['&'.repeat(1_000_000)]), { seed: 0 }, 8_000_000) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(SceneValidationError)
    expect((error as SceneValidationError).diagnostics).toContainEqual({
      code: 'SCENE_DOCUMENT', path: 'scene.parts[1]', message: 'SVG serialization exceeds 5000000 bytes',
    })
    expect((error as Error).message).not.toContain('8000000-byte final SVG limit')
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
