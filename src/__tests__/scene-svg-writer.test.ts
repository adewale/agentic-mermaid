import { describe, expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { canonicalizeSceneNodeSerialization, sceneNodeSerialization, sceneHasOnlyPreparedText } from '../scene/serialization.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
import { preparePixelText } from '../shared/prepared-text.ts'

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
})
