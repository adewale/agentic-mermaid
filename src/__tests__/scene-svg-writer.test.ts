import { describe, expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { canonicalizeSceneNodeSerialization, sceneNodeSerialization, sceneHasOnlyPreparedText, sceneNodeWrite, transferSceneNodeSerialization } from '../scene/serialization.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { createSvgXmlCapture, writeShapeSvg, writeTextSvg, writeConnectorSvg, type SvgXmlWrite, type SvgXmlCapture } from '../scene/svg-writer.ts'
import { verifySvgDocumentEnvelope } from '../output-security.ts'
import { createNativeSceneValidator } from '../scene/scene-validation-core.ts'
import type { SceneNode } from '../scene/ir.ts'

// The default backend writes shape, text and connector elements from their
// typed fields, so paint certification, which reads those fields, describes
// the bytes. Families add only inert hooks.
describe('typed Scene SVG writer', () => {
  test('proves prepared text only when no opaque fragment can introduce fallback text', () => {
    const block = preparePixelText('Prepared', { fontSize: 12, fontWeight: 400, letterSpacing: 0 })
    const text = marks.text({ id: 'label', role: 'label', text: block.text, block, x: 10, y: 10, fontSize: 12, anchor: 'start', paint: {} })
    const doc = { family: 'sequence', width: 100, height: 50, colors: { bg: '#fff', fg: '#111' }, transparent: false, parts: [text] }
    expect(sceneHasOnlyPreparedText(doc)).toBe(true)
    const fallback = marks.text({ id: 'fallback', role: 'label', text: 'Fallback', x: 10, y: 10, fontSize: 12, anchor: 'start', paint: {} })
    expect(sceneHasOnlyPreparedText({ ...doc, parts: [fallback] })).toBe(false)
    expect(sceneHasOnlyPreparedText({ ...doc, parts: [marks.documentContent({ id: 'opaque', role: 'chrome' }, '<text>opaque</text>')] })).toBe(false)
    expect(sceneHasOnlyPreparedText({ ...doc, parts: [marks.documentContent({ id: 'opaque-upper', role: 'chrome' }, '<TEXT>opaque</TEXT>')] })).toBe(false)
    expect(sceneHasOnlyPreparedText({ ...doc, parts: [marks.documentContent({ id: 'opaque-space', role: 'chrome' }, '< text>opaque</text>')] })).toBe(false)
    expect(sceneHasOnlyPreparedText({ ...doc, parts: [marks.documentContent({ id: 'metadata', role: 'chrome' }, '<title>Metadata</title>'), text] })).toBe(true)
    expect(() => marks.group({ id: 'custom-close', role: 'chrome', open: '<g>', close: '</g><text>fallback</text>', children: [] })).toThrow('close and join must not add artwork')
    expect(sceneHasOnlyPreparedText({ ...doc, parts: [{ ...text }] })).toBe(false)
  })

  test('writes hooks, geometry, paint, transform and identity from the fields, escaped', () => {
    const shape = marks.shape({
      id: 'card', role: 'node',
      geometry: { kind: 'rect', x: 1 / 3, y: 2, width: 30, height: 12, rx: 3 },
      paint: { fill: '"/><script>', stroke: '#123456', strokeWidth: '1.5', fillOpacity: '0.5' },
      transform: { kind: 'rotate', angle: 45, cx: 1, cy: 2 },
      attributes: { className: 'node hot', data: { label: 'a & "b"' } },
    })
    expect(sceneNodeSerialization(shape)).toBe(
      '<rect class="node hot" data-label="a &amp; &quot;b&quot;" x="0.333333333333" y="2" width="30" height="12" rx="3"'
      + ' fill="&quot;/&gt;&lt;script&gt;" fill-opacity="0.5" stroke="#123456" stroke-width="1.5" transform="rotate(45 1 2)"'
      + ' data-id="card" data-role="node" />')
    const path = marks.shape({ id: 'p', role: 'chrome', geometry: { kind: 'path', d: 'M 0 0 L 2 3 Z" onload="bad' }, paint: { fill: 'none' } })
    expect(sceneNodeSerialization(path)).toBe('<path d="M 0 0 L 2 3 Z&quot; onload=&quot;bad" fill="none" />')
  })

  test('writes each compound piece with its own paint, hooks and identity on the first', () => {
    const shape = marks.shape({
      id: 'end', role: 'node',
      geometry: { kind: 'compound', children: [{ kind: 'circle', cx: 5, cy: 5, r: 5 }, { kind: 'circle', cx: 5, cy: 5, r: 2 }] },
      paint: { fill: 'black', stroke: 'black' },
      childPaints: [{ fill: 'none', stroke: 'black', strokeWidth: '2' }, { fill: 'black', stroke: 'none' }],
      attributes: { className: 'state-end' },
    })
    expect(sceneNodeSerialization(shape)).toBe(
      '<circle class="state-end" cx="5" cy="5" r="5" fill="none" stroke="black" stroke-width="2" data-id="end" data-role="node" />\n'
      + '<circle cx="5" cy="5" r="2" fill="black" stroke="none" />')
    expect(() => marks.shape({ id: 'x', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 }, paint: {}, childPaints: [{}] }))
      .toThrow(/child paints must match/)
  })

  test.each([
    [{ data: { id: 'forged' } }, /data-id belongs to its typed fields/],
    [{ data: { relationship: 'x' } }, /data-relationship belongs to its typed fields/],
    [{ data: { 'prepared-text': 'true' } }, /data-prepared-text belongs to its typed fields/],
    [{ data: { 'on load': 'x' } }, /invalid data attribute key/],
    [{ className: 'a"b' }, /class must be space-separated CSS tokens/],
    [{ style: 'fill:red' }, /unknown attribute hook "style"/],
  ] as const)('refuses hooks that could carry what typed fields own: %j', (attributes, error) => {
    expect(() => marks.shape({ id: 'x', role: 'chrome', geometry: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 }, paint: {}, attributes: attributes as never })).toThrow(error)
  })

  test('writes typography, baseline and painted runs from the text fields', () => {
    const block = preparePixelText('Hello', { fontSize: 12, fontWeight: 600, letterSpacing: 0 })
    const svg = sceneNodeSerialization(marks.text({
      id: 'label', role: 'label', text: block.text, block, x: 10, y: 20, fontSize: 12, anchor: 'middle',
      paint: { fill: 'navy' }, fontStyle: 'italic', textDecoration: 'underline', baselineShift: 0,
      spans: [{ text: 'He', fill: 'red' }, { text: 'llo', fill: 'blue' }],
      attributes: { className: 'mono' },
    }))
    expect(svg).toStartWith('<text x="10" y="20" class="mono" text-anchor="middle" font-size="12" font-weight="600" font-style="italic" text-decoration="underline" fill="navy"')
    expect(svg).toContain(' dy="0"')
    expect(svg).toEndWith('><tspan fill="red">He</tspan><tspan fill="blue">llo</tspan></text>')
    expect(() => marks.text({ id: 'bad', role: 'label', text: 'Hello', x: 0, y: 0, fontSize: 12, anchor: 'start', paint: {}, spans: [{ text: 'Help', fill: 'red' }] }))
      .toThrow(/spans must spell/)
  })

  test('writes connector stroke, markers and interaction, leaving SVG defaults implicit', () => {
    const arrow = { id: 'arrow', shape: 'arrow' as const }
    const plain = marks.connector({
      id: 'e1', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, lineStyle: 'solid', paint: { stroke: 'red', strokeWidth: '2' },
      markers: { end: arrow }, endpoints: { from: 'a', to: 'b' },
    })
    expect(sceneNodeSerialization(plain)).toBe(
      '<line x1="0" y1="0" x2="10" y2="0" stroke="red" stroke-width="2" marker-end="url(#arrow)" data-relationship="edge" data-direction="forward"'
      + ' data-id="e1" data-role="edge" data-from="a" data-to="b" role="graphics-symbol" aria-roledescription="relation" aria-label="a to b" />')
    const linked = marks.connector({
      id: 'e2', role: 'edge', geometry: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }, lineStyle: 'dashed',
      paint: { stroke: 'blue', strokeWidth: '1', strokeLinejoin: 'round', strokeDasharray: '4 2' },
      hit: { pointerEvents: 'none' }, attributes: { className: 'edge', data: { href: 'https://example.com' }, tabIndex: 0 },
    })
    const svg = sceneNodeSerialization(linked)
    expect(svg).toStartWith('<polyline class="edge" data-href="https://example.com" tabindex="0" points="0,0 5,5" fill="none" stroke="blue" stroke-width="1" stroke-dasharray="4 2" stroke-linejoin="round" pointer-events="none"')
    expect(sceneNodeSerialization(marks.connector({ id: 'e3', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }, lineStyle: 'invisible', paint: {} }))).toBe('')
    // An invisible connector still draws the labels it owns.
    const labelled = sceneNodeSerialization(marks.connector({
      id: 'e4', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }, lineStyle: 'invisible', paint: {},
      labels: [{ id: 'e4-label', text: 'Kept', anchor: { x: 20, y: 10 }, paint: { fill: '#111' }, fontSize: 12, fontWeight: 400, textAnchor: 'middle', visual: { kind: 'inline' } }],
    }))
    expect(labelled).toStartWith('<text ')
    expect(labelled).toContain('data-id="e4-label"')
    expect(labelled.replace(/<[^>]+>/g, '')).toBe('Kept')
  })

  test('writes only marks the constructors built', () => {
    // A plain object shaped like a group has no serialization, so its open
    // tag and indent are never written, however large.
    const forged = { kind: 'group', id: 'g', role: 'group', open: '<g onload="x()">', close: '</g><text>extra</text>', join: '\n', children: [{ node: { kind: 'shape', id: 's', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 }, paint: {} }, indent: 4e8 }] }
    expect(() => sceneNodeSerialization(forged as never)).toThrow(/no admitted SVG serialization/)
    const built = marks.shape({ id: 's', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 }, paint: {} })
    expect(() => sceneNodeSerialization({ ...built } as never)).toThrow(/no admitted SVG serialization/)
  })

  test.each([
    ['<g fill="red">', undefined, /sets "fill"/],
    ['<g style="opacity:0.5">', undefined, /may only set custom properties/],
    ['<g transform="translate(2 3)">', undefined, /disagrees with its typed transform/],
    ['<g>', { kind: 'matrix', a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }, /disagrees with its typed transform/],
    ['<g><rect /></g>', undefined, /one <g> tag/],
    ['<g transform="translate(2 3)" transform="scale(9)">', { kind: 'matrix', a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }, /duplicate "transform"/],
    ['<g style="--a: 1" style="fill:red">', undefined, /duplicate "style"/],
  ] as const)('refuses a group open tag that paints or moves its children: %s', (open, transform, error) => {
    expect(() => marks.group({ id: 'g', role: 'group', open, close: '</g>', children: [], ...(transform ? { transform } : {}) })).toThrow(error)
  })

  test('writes a group from its hooks, typed cascade paint and children', () => {
    const child = marks.shape({ id: 'c', role: 'chrome', geometry: { kind: 'circle', cx: 1, cy: 1, r: 1 }, paint: { fill: 'red' } })
    const group = marks.group({
      id: 'g', role: 'chrome', open: '<g class="wrap" style="--tone: red" transform="translate(2 3)"><title>Tip</title>', close: '</g>',
      transform: { kind: 'matrix', a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }, paint: { opacity: '0.8' }, children: [{ node: child, indent: 2 }],
    })
    expect(sceneNodeSerialization(group)).toBe('<g opacity="0.8" class="wrap" style="--tone: red" transform="translate(2 3)"><title>Tip</title>\n  <circle cx="1" cy="1" r="1" fill="red" />\n</g>')
  })

  test('escaped native output retains the Scene oversized-serialization diagnostic', () => {
    const mark = marks.shape({ id: 'note', role: 'chrome',
      geometry: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 }, paint: {},
      attributes: { data: { note: '&'.repeat(1_000_000) } },
    })
    const result = validateSceneDoc({ family: 'sequence', width: 10, height: 10,
      colors: { bg: '#fff', fg: '#111' }, transparent: false, parts: [mark] })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCENE_DOCUMENT', path: 'scene.parts[0]', message: 'has an oversized SVG serialization',
    }))
  })

  test('does not replay construction-time SVG byte order', () => {
    const authored = `<svg viewBox='0 0 3 2' height="2" xmlns="http://www.w3.org/2000/svg" width="3">`
    const canonical = canonicalizeSceneNodeSerialization(authored)
    expect(canonical).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2" viewBox="0 0 3 2">')
    expect(canonical).not.toBe(authored)
  })

  test('actual XML construction preserves malformed raw context, scalars and empty boundaries', () => {
    const capture = createSvgXmlCapture(() => true)
    const envelope = (write: SvgXmlWrite, open = '<svg xmlns="http://www.w3.org/2000/svg">', close = '</svg>') => {
      const whole = capture.join([capture.raw(open), write, capture.raw(close)], '')
      const checked = capture.validate(whole)
      const actual = capture.read(whole)!.svg
      const actualValid = verifySvgDocumentEnvelope(actual)
      expect(capture.verify(whole)).toBe(actualValid)
      return [actualValid, verifySvgDocumentEnvelope(checked?.skeleton ?? actual)]
    }
    const block = preparePixelText('x & < y', { fontSize: 12, fontWeight: 400 })
    const text = marks.text({ id: 'text', role: 'label', text: block.text, block, x: 5, y: 10, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
    const written = writeTextSvg(text, capture)
    expect(written.svg).toBe(writeTextSvg(text))
    expect(envelope(written)).toEqual([true, true])
    // A SPACE projection still represents actual artwork: its private occupied
    // position must be DATA inside the root, including after CRLF indentation.
    const root = '<svg xmlns="http://www.w3.org/2000/svg">'
    for (const parts of [[written, capture.raw(root + '</svg>')], [capture.raw(root + '</svg>'), written]]) {
      const outside = capture.join(parts, '')
      expect(verifySvgDocumentEnvelope(capture.read(outside)!.svg)).toBe(false)
      expect(capture.verify(outside)).toBe(false)
    }
    const paired = capture.join([written, written], '\r\n')
    const indented = capture.indent(capture.join([capture.raw(root), capture.indent(paired, 2), capture.raw('</svg>')], '\r\n'), 3)
    expect(capture.read(indented)!.svg).toContain('\r\n     <text')
    expect(verifySvgDocumentEnvelope(capture.read(indented)!.svg)).toBe(true)
    expect(capture.verify(indented)).toBe(true)
    for (const [spaces, prefix] of [[0.5, ''], [2.9, '  '], [Number.NaN, ''], [-0.5, '']] as const) {
      const shifted = capture.indent(written, spaces)
      expect(shifted.svg).toBe(prefix + written.svg)
      const whole = capture.join([capture.raw(root), shifted, capture.raw('</svg>')], '\r\n')
      expect(verifySvgDocumentEnvelope(whole.svg)).toBe(true)
      expect(capture.verify(whole)).toBe(true)
    }
    expect(() => capture.indent(written, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    for (const opening of ['<svg xmlns="http://www.w3.org/2000/svg"><g data-title="&unbound;">', '<svg xmlns="http://www.w3.org/2000/svg"><g data-title="\ufffe">', '<svg xmlns="http://www.w3.org/2000/svg"><p:group>']) {
      expect(envelope(written, opening, opening.endsWith('<p:group>') ? '</p:group></svg>' : '</g></svg>')).toEqual([false, false])
    }
    for (const value of ['\udc00', '\ufffe', '\uffff']) {
      const bad = marks.shape({ id: 'bad', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 }, paint: { fill: '#111' }, attributes: { data: { probe: value } } })
      expect(envelope(writeShapeSvg(bad, undefined, capture))).toEqual([false, false])
    }
    for (const value of ['\udc00', '<bad>']) {
      let calls = 0, coercions = 0
      const content = { length: 0, toString() { coercions++; return value } }
      const prepared = preparePixelText('x', { fontSize: 12, fontWeight: 400, display: 'literal' })
      const runs = [{ ...prepared.lineBlocks[0]!.runs[0]! }]
      Object.defineProperty(runs, 'map', { value(callback: (entry: unknown) => unknown) {
        return ++calls === 4 ? { join() { return content } } : Array.prototype.map.call(this, callback)
      } })
      const mutable = { ...text, text: 'x', block: { ...prepared, lineBlocks: [{ ...prepared.lineBlocks[0]!, runs }] } }
      expect(envelope(writeTextSvg(mutable, capture))).toEqual([false, false])
      expect({ calls, coercions }).toEqual({ calls: 4, coercions: 1 })
    }
    const shape = marks.shape({ id: 'duplicate', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 }, paint: { fill: '#111' } })
    // The direct writer still has to account for every actual attribute even
    // when a caller supplies fields the mark constructor would reject.
    expect(envelope(writeShapeSvg({ ...shape, attributes: { data: { id: 'second' } } }, undefined, capture))).toEqual([false, false])
    const hidden = marks.connector({ id: 'hidden', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 }, lineStyle: 'invisible', paint: {} })
    const empty = writeConnectorSvg(hidden, undefined, capture)
    expect(empty.svg).toBe('')
    expect(envelope(empty, '<svg xmlns="http://www.w3.org/2000/svg"><g>]]', '></g></svg>')).toEqual([false, false])
    expect(envelope(written, '<svg xmlns="http://www.w3.org/2000/svg"><g>]]', '></g></svg>')).toEqual([true, true])
    expect(envelope(empty, '<svg xmlns="http://www.w3.org/2000/svg"><g>\ud800', '\udc00</g></svg>')).toEqual([true, true])
    expect(envelope(written, '<svg xmlns="http://www.w3.org/2000/svg"><g>\ud800', '\udc00</g></svg>')).toEqual([false, false])
    const inline = marks.connector({ id: 'inline', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }, lineStyle: 'solid', paint: { stroke: '#111' },
      labels: [{ text: 'Kept & clear', anchor: { x: 20, y: 10 }, paint: { fill: '#111' }, fontSize: 12, fontWeight: 400, textAnchor: 'middle', visual: { kind: 'inline' } }],
    })
    const inlineWrite = writeConnectorSvg(inline, undefined, capture)
    expect(inlineWrite.svg).toBe(writeConnectorSvg(inline))
    expect(inlineWrite.svg).toContain('Kept &amp; clear')
    expect(envelope(inlineWrite)).toEqual([true, true])
    const commentShape = writeShapeSvg({ ...shape, identity: { id: 'a--b', role: 'node' } }, undefined, capture)
    expect(envelope(commentShape, '<svg xmlns="http://www.w3.org/2000/svg"><!--', '--></svg>')).toEqual([false, false])
    const unsupported = writeShapeSvg({ ...shape, geometry: { kind: '!--' } } as never, undefined, capture)
    const unsupportedWhole = capture.join([capture.raw('<svg xmlns="http://www.w3.org/2000/svg">'), unsupported, commentShape, capture.raw('--></svg>')], '')
    const unsupportedChecked = capture.validate(unsupportedWhole)
    const unsupportedActual = capture.read(unsupportedWhole)!.svg
    expect(verifySvgDocumentEnvelope(unsupportedActual)).toBe(false)
    expect(verifySvgDocumentEnvelope(unsupportedChecked?.skeleton ?? unsupportedActual)).toBe(false)
    const commentTail = capture.join([commentShape, capture.raw('--></svg>')], '')
    const throughSeparator = capture.join([capture.raw('<svg xmlns="http://www.w3.org/2000/svg">'), commentTail], '<!--')
    const checkedSeparator = capture.validate(throughSeparator)
    const separatorActual = capture.read(throughSeparator)!.svg
    expect(verifySvgDocumentEnvelope(separatorActual)).toBe(false)
    expect(verifySvgDocumentEnvelope(checkedSeparator?.skeleton ?? separatorActual)).toBe(false)
    capture.raw('<!--') // An unused fragment cannot invalidate another output.
    const unaffected = capture.join([capture.raw('<svg xmlns="http://www.w3.org/2000/svg">'), written, capture.raw('</svg>')], '')
    expect(capture.validate(unaffected)).toBeDefined()
    expect(capture.validate(capture.join([written], '<!--'))).toBeDefined()
    // Valid legacy token splits remain renderable through the actual fallback.
    expect(envelope(empty, '<svg xmlns="http://www.w3.org/2000/svg"><g data-label="', 'ok"></g></svg>')).toEqual([true, true])
    expect(envelope(empty, '<svg xmlns="http://www.w3.org/2000/svg"><g>&am', 'p;</g></svg>')).toEqual([true, true])
    const foreign = createSvgXmlCapture(() => true)
    expect(foreign.read(written)).toBeUndefined()
    expect(foreign.verify(written)).toBe(false)
    expect(() => foreign.join([written])).toThrow()
    expect(capture.read(written, {})).toBeUndefined()
    const exhausted = createSvgXmlCapture(() => false)
    const raw = exhausted.raw('<broken>')
    expect(exhausted.read(raw)?.svg).toBe('<broken>')
    expect(exhausted.validate(raw)).toBeUndefined()
    expect(exhausted.verify(raw)).toBe(false)

    // Private construction records must survive ambient receiver-sensitive
    // hooks. Compare the actual emitted bytes with both fresh verification
    // paths after restoring every prototype before making assertions.
    const badInline = marks.connector({ id: 'bad-inline', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }, lineStyle: 'solid', paint: { stroke: '#111' },
      labels: [{ text: 'label', visual: { kind: 'inline' }, anchor: { x: 20, y: 10 }, paint: { fill: '\uffff' }, fontSize: 12, textAnchor: 'middle' }],
    })
    for (const mode of ['occupied-iterator', 'children-iterator', 'events-iterator', 'events-push', 'inline-push', 'additional-every', 'actual-join', 'isolated-scalar', 'attrs-slice'] as const) {
      const prototype = mode === 'isolated-scalar' || mode === 'attrs-slice' ? String.prototype : Array.prototype
      const key = mode.endsWith('iterator') ? Symbol.iterator : mode.endsWith('push') ? 'push' : mode === 'additional-every' ? 'every' : mode === 'actual-join' ? 'join' : mode === 'attrs-slice' ? 'slice' : 'charCodeAt'
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key)!
      const local = createSvgXmlCapture(() => true)
      let actual = '', accepted = false, legacy = false
      const replacement = mode.endsWith('iterator') ? function* (this: unknown[]) {
        for (let index = 0; index < this.length; index++) {
          const value = this[index] as { record?: { svg: string } } & readonly unknown[]
          if (mode === 'occupied-iterator' && typeof value === 'number' && value === 0) continue
          if (mode === 'children-iterator' && value?.record?.svg === '</g>') continue
          if (mode === 'events-iterator' && value?.[0] === 'attribute' && value[1] === 'data-bad key') continue
          yield value
        }
      } : mode.endsWith('push') ? function (this: unknown[], ...values: unknown[]) {
        const value = values[0] as { check?: unknown } & readonly unknown[]
        if (mode === 'inline-push' && typeof value?.check === 'function'
          || mode === 'events-push' && value?.[0] === 'attribute' && value[1] === 'data-bad key') return this.length
        return Reflect.apply(descriptor.value, this, values)
      } : mode === 'additional-every' ? function (this: unknown[], ...values: unknown[]) {
        return typeof (this[0] as { check?: unknown } | undefined)?.check === 'function' ? true : Reflect.apply(descriptor.value, this, values)
      } : mode === 'actual-join' ? function (this: string[], ...values: unknown[]) {
        let opening = false, artwork = false, closing = false
        for (let index = 0; index < this.length; index++) {
          const value = this[index]
          if (typeof value === 'string') { opening ||= value.startsWith('<svg '); artwork ||= value.startsWith('<rect '); closing ||= value === '</svg>' }
        }
        return Reflect.apply(descriptor.value, this, values) + (opening && artwork && closing ? '</g>' : '')
      } : mode === 'attrs-slice' ? function (this: string, ...values: unknown[]) { const result = Reflect.apply(descriptor.value, this, values); return this.startsWith(' text-anchor=') ? result + ' data-bad=' : result } : function (this: string, index: number) { return this.length === 1 && this[0] === '\uffff' ? 65 : Reflect.apply(descriptor.value, this, [index]) }
      try {
        Object.defineProperty(prototype, key, { ...descriptor, value: replacement })
        const artwork = mode === 'attrs-slice' ? writeTextSvg(text, local) : mode === 'inline-push' || mode === 'additional-every' ? writeConnectorSvg(badInline, undefined, local)
          : writeShapeSvg({ ...shape, ...(mode === 'events-iterator' || mode === 'events-push' ? { attributes: { data: { 'bad key': 'literal' } } } : mode === 'isolated-scalar' ? { attributes: { data: { custom: '\uffff' } } } : {}) }, undefined, local)
        const whole = mode === 'occupied-iterator' ? local.join([artwork, local.raw(root + '</svg>')], '')
          : local.join([local.raw(root), artwork, ...(mode === 'children-iterator' ? [local.raw('</g>')] : []), local.raw('</svg>')], '')
        actual = whole.svg
        accepted = local.verify(whole)
        const checked = local.validate(whole)
        legacy = verifySvgDocumentEnvelope(checked?.skeleton ?? actual, () => true)
      } finally { Object.defineProperty(prototype, key, descriptor) }
      const actualValid = verifySvgDocumentEnvelope(actual, () => true)
      expect({ mode, accepted }).toEqual({ mode, accepted: actualValid })
      expect({ mode, legacy }).toEqual({ mode, legacy: actualValid })
    }

    const fresh = Object.freeze({ ...shape })
    transferSceneNodeSerialization(shape, fresh)
    const validator = createNativeSceneValidator({ family: 'flowchart', width: 20, height: 20, transparent: false, colors: { bg: '#fff', fg: '#111' } })
    const first = validator.write(fresh, capture)
    expect(capture.read(first, fresh)?.svg).toBe(writeShapeSvg(shape))
    expect(envelope(first)).toEqual([true, true])
    const cached = sceneNodeWrite(fresh, capture)
    expect(cached.svg).toBe(first.svg)
    expect(envelope(cached)).toEqual([true, true])
  })

  test.each(['shape', 'text', 'connector'] as const)('structured %s writes preserve source getter order and emitted bytes', kind => {
    const make = (): SceneNode => kind === 'shape'
      ? marks.shape({ id: 'shape', role: 'node', geometry: { kind: 'rect', x: 1 / 3, y: 2, width: 30, height: 12, rx: 3 }, paint: { fill: '#fff', stroke: '#111' }, attributes: { data: { label: 'a & b' } } })
      : kind === 'text'
        ? marks.text({ id: 'text', role: 'label', text: 'Prepared', block: preparePixelText('Prepared', { fontSize: 12, fontWeight: 400 }), x: 5, y: 10, fontSize: 12, anchor: 'start', paint: { fill: '#111' } })
        : marks.connector({ id: 'edge', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }, lineStyle: 'solid', paint: { stroke: '#111' }, endpoints: { from: 'a', to: 'b' } })
    const observe = (structured: boolean) => {
      const reads: string[] = [], proxies = new WeakMap<object, object>()
      const wrap = (value: object, path: string): object => {
        const cached = proxies.get(value)
        if (cached) return cached
        const proxy = new Proxy(value, { get(target, key, receiver) {
          reads.push(`${path}.${String(key)}`)
          const entry = Reflect.get(target, key, receiver)
          return entry && typeof entry === 'object' ? wrap(entry, `${path}.${String(key)}`) : entry
        } })
        proxies.set(value, proxy)
        return proxy
      }
      const node = wrap(structuredClone(make()), 'node') as SceneNode
      const capture: SvgXmlCapture | undefined = structured ? createSvgXmlCapture(() => true) : undefined
      const written = node.kind === 'shape' ? capture ? writeShapeSvg(node, undefined, capture) : writeShapeSvg(node)
        : node.kind === 'text' ? capture ? writeTextSvg(node, capture) : writeTextSvg(node)
          : node.kind === 'connector' ? capture ? writeConnectorSvg(node, undefined, capture) : writeConnectorSvg(node) : ''
      if (capture && typeof written !== 'string') capture.validate(written)
      return { svg: typeof written === 'string' ? written : written.svg, reads }
    }
    const legacy = observe(false), structured = observe(true)
    expect(structured.svg).toBe(legacy.svg)
    expect(structured.reads).toEqual(legacy.reads)
  })

})
