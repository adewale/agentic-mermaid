import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { asEventModeling, buildMermaid, createMermaid, describeMermaidTree, layoutMermaidWithReceipt, mutateChecked, parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { eventRelations, parseEventModeling } from '../eventmodeling/parser.ts'
import { layoutEventModeling } from '../eventmodeling/layout.ts'
import { LINEAR_GROWTH_CEILING, measureGrowth } from './helpers/complexity.ts'
import { colorPixelCountInRaster, redPixel, renderSvgPixels } from './helpers/raster.ts'

// IDs and labels below are authored expectations from #501 and the pinned
// syntax guide, not a projection of the parser under test.
const minimal = 'eventmodeling\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded'
const complex = `eventmodeling
title Inventory
entity Changed
entity Refresh
entity Refreshed
timeframe 09 ui Cart.UI
timeframe 01 command Cart.AddItem { description: string }
timeframe 03 event Cart.ItemAdded
resetframe 04 event External.Changed
timeframe 06 processor Cart.Refresh ->> 04
rf 07 readmodel Cart.Items ->> 03 ->> 04 [[Items]]
tf 08 ui Cart.UI
data Items \`json\`{
{"lastCharacter":"z"}
}
note 07 {
Keep the whole note
}
gwt 07
given event Changed
when command Refresh
then event Refreshed`
const complexRelations: Array<[string, string, boolean]> = [
  ['09', '01', false],
  ['01', '03', false],
  ['04', '06', true],
  ['03', '07', true],
  ['04', '07', true],
  ['07', '08', false],
]

test('native frames keep source order, full data and source-owned notes/specifications', () => {
  const body = parseEventModeling(complex)
  expect(body.frames.map(frame => frame.id)).toEqual(['09', '01', '03', '04', '06', '07', '08'])
  expect(body.frames[1]!.data!.text).toBe(' description: string ')
  expect(body.data.Items!.text).toBe('{"lastCharacter":"z"}')
  expect(body.notes).toEqual([{ frame: '07', data: { text: 'Keep the whole note' } }])
  expect(body.specifications).toEqual([{ frame: '07', given: [{ type: 'event', entity: 'Changed' }], when: [{ type: 'command', entity: 'Refresh' }], then: [{ type: 'event', entity: 'Refreshed' }] }])
  expect(eventRelations(body).map(edge => [edge.from, edge.to, edge.explicit])).toEqual(complexRelations)
  const parsed = parseRegisteredMermaid(complex)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(asEventModeling(parsed.value)?.body).toEqual(body)
  expect(parseEventModeling(serializeMermaid(parsed.value))).toEqual(body)
  expect(describeMermaidTree(parsed.value).edges.map(edge => [edge.from, edge.to])).toContainEqual(['04', '07'])
})

test('domain verification diagnoses each invalid explicit source while retaining renderable authored connections', () => {
  const bad = 'eventmodeling\ntf 01 rmo Catalog\ntf 02 pcr Refresh\nrf 03 evt Changed ->> 01 ->> 02'
  const parsed = parseRegisteredMermaid(bad)
  if (!parsed.ok || parsed.value.body.kind !== 'eventmodeling') throw Error('Expected retained native Event semantics')
  expect(eventRelations(parsed.value.body).filter(edge => edge.explicit).map(edge => [edge.from, edge.to])).toEqual([['01', '03'], ['02', '03']])
  const result = verifyMermaid(bad)
  expect(result.ok).toBe(true)
  expect(result.warnings.filter(warning => warning.code === 'EVENT_SOURCE_TYPE').map(warning => [warning.node, warning.source])).toEqual([['03', '01'], ['03', '02']])
  for (const warning of result.warnings.filter(warning => warning.code === 'EVENT_SOURCE_TYPE')) {
    expect(warning.message).toContain('event')
    expect(warning.message).toContain('command')
  }
  const svg = renderMermaidSVG(bad, { embedFontImport: false })
  for (const label of ['Catalog', 'Refresh', 'Changed']) expect(svg).toContain(label)
  for (const source of ['eventmodeling\ntf 01 cmd Save\ntf 02 evt Saved ->> 01', 'eventmodeling\ntf 01 rmo Catalog\ntf 02 evt Changed', 'eventmodeling\nrf 01 rmo Catalog']) {
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'EVENT_SOURCE_TYPE')).toEqual([])
  }
})

test('label caps cover the text actually owned by frames, lanes and titles', () => {
  const frame = 'eventmodeling\ntf 01 ui Main'
  const cases = [
    { source: `eventmodeling\ntf 01 ui ${'A'.repeat(21)}`, target: '01', charCount: 21 },
    { source: `${frame} {${'p'.repeat(21)}}`, target: '01', charCount: 21 },
    { source: `${frame} [[Payload]]\ndata Payload {\n${'d'.repeat(21)}\n}`, target: '01', charCount: 21 },
    { source: `${frame}\nnote 01 {\n${'n'.repeat(21)}\n}`, target: '01', charCount: 27 },
    { source: `${frame}\ngwt 01 given evt Value123 then evt Value123`, target: '01', charCount: 21 },
    { source: `---\ntitle: "<b>${'T'.repeat(21)}</b>"\n---\n${frame}`, target: 'title', charCount: 21 },
    { source: 'eventmodeling\ntf 01 ui LongNamespace.X', target: 'lane:0', charCount: 31 },
    { source: `${frame} {<b>123456789012345</b>}`, target: '01', charCount: 22 },
    { source: `${frame} {${'&amp;'.repeat(5)}}`, target: '01', charCount: 25 },
  ]
  for (const { source, target, charCount } of cases) {
    expect(verifyMermaid(source, { labelCharCap: 20 }).warnings.filter(warning => warning.code === 'LABEL_OVERFLOW')).toEqual([
      { code: 'LABEL_OVERFLOW', target, charCount, limit: 20 },
    ])
  }

  const defaultCap = `eventmodeling\ntf 01 ui ${'A'.repeat(41)}`
  expect(verifyMermaid(defaultCap).warnings.filter(warning => warning.code === 'LABEL_OVERFLOW')).toEqual([
    { code: 'LABEL_OVERFLOW', target: '01', charCount: 41, limit: 40 },
  ])
  expect(verifyMermaid(defaultCap, { labelCharCap: 41 }).warnings.filter(warning => warning.code === 'LABEL_OVERFLOW')).toEqual([])
  const multiline = `${frame}\nnote 01 {\n123456789012\n123456789012\n}\ndata Unused {\n${'u'.repeat(50)}\n}`
  expect(verifyMermaid(multiline, { labelCharCap: 20 }).warnings.filter(warning => warning.code === 'LABEL_OVERFLOW')).toEqual([])
})

test('namespace re-entry owns one lane, non-overlapping chronological columns and exact endpoints', () => {
  const p = layoutEventModeling(parseEventModeling(complex))
  expect(p.nodes.filter(node => node.frame.type === 'ui').map(node => node.lane)).toEqual(['lane:0', 'lane:0'])
  for (const [i, node] of p.nodes.entries()) for (const other of p.nodes.slice(i + 1)) expect(node.x + node.width).toBeLessThan(other.x)
  expect(p.edges.map(edge => [edge.from, edge.to])).toContainEqual(['04', '07'])
  for (const edge of p.edges) {
    const from = p.nodes.find(node => node.id === edge.from)!,
      to = p.nodes.find(node => node.id === edge.to)!
    expect(edge.points[0]!.x).toBe(from.x + from.width + p.style.nodeLineWidth / 2)
    expect(edge.points[0]!.y).toBeGreaterThan(from.y)
    expect(edge.points[0]!.y).toBeLessThan(from.y + from.height)
    expect(edge.points.at(-1)!.x).toBe(to.x - p.style.nodeLineWidth / 2)
    expect(edge.points.at(-1)!.y).toBeGreaterThan(to.y)
    expect(edge.points.at(-1)!.y).toBeLessThan(to.y + to.height)
  }
  const incoming = p.edges.filter(edge => edge.to === '07').map(edge => edge.points.at(-1)!.y)
  expect(incoming).toHaveLength(2)
  expect(Math.abs(incoming[0]! - incoming[1]!)).toBeGreaterThanOrEqual(12)
  const svg = renderMermaidSVG(minimal, { embedFontImport: false })
  for (const label of ['CartUI', 'AddItem', 'ItemAdded']) expect(svg).toContain(label)
  const terminal = renderMermaidASCII(minimal, { useAscii: true })
  for (const label of ['CartUI', 'AddItem', 'ItemAdded']) expect(terminal).toContain(label)
  expect(terminal).toContain('>')
  expect(verifyMermaid(minimal).ok).toBe(true)
})

test('multiple explicit inputs retain separate painted arrowheads through backward and rounded routes', () => {
  const reciprocal = 'eventmodeling\nrf 09 ui Cart.UI ->> 01 ->> 03\nrf 01 cmd Cart.Save ->> 09\nrf 03 evt Cart.Saved ->> 01'
  const fanIn = `eventmodeling\n${Array.from({ length: 12 }, (_, index) => `rf ${index + 1} cmd Input${index + 1}`).join('\n')}\nrf 13 evt Output ${Array.from({ length: 12 }, (_, index) => `->> ${index + 1}`).join(' ')}`
  for (const [source, targetId, count] of [[reciprocal, '09', 2], [fanIn, '13', 12]] as const) for (const bendRadius of [0, 24]) {
    const options = { padding: 24, embedFontImport: false, style: { roles: { node: { lineWidth: 1 }, edge: { strokeColor: '#ff0000', bendRadius } } } }
    const p = layoutMermaidWithReceipt(source, options).layout
    const target = p.nodes.find(node => node.id === targetId)!
    const inputs = p.edges.filter(edge => edge.to === targetId)
    expect(inputs).toHaveLength(count)
    expect(target.h).toBeGreaterThanOrEqual((count - 1) * 12 + 12)
    const endpoints = inputs.map(edge => edge.path.at(-1)!)
    expect(new Set(endpoints.map(point => point[1])).size).toBe(count)
    const raster = renderSvgPixels(renderMermaidSVG(source, options))
    for (const point of endpoints) {
      // The public layout view rounds positions to whole pixels; the raster
      // below independently checks the actual emitted marker artwork.
      expect(Math.abs(point[0] - (target.x - 0.5))).toBeLessThanOrEqual(1)
      expect(point[1]).toBeGreaterThanOrEqual(target.y + 6)
      expect(point[1]).toBeLessThanOrEqual(target.y + target.h - 6)
      expect(colorPixelCountInRaster(raster, redPixel, { left: Math.floor(point[0] - 7), right: Math.ceil(point[0] - 2), top: Math.floor(point[1] - 2), bottom: Math.ceil(point[1] + 2) })).toBeGreaterThan(8)
    }
    for (const edge of p.edges) for (const point of edge.path) {
      expect(point[0]).toBeGreaterThanOrEqual(0)
      expect(point[1]).toBeGreaterThanOrEqual(0)
      expect(point[0]).toBeLessThanOrEqual(p.bounds.w)
      expect(point[1]).toBeLessThanOrEqual(p.bounds.h)
    }
  }
}, 20_000)

test('arrowheads dock at the painted outer frame boundary beside thick node outlines', () => {
  const source = 'eventmodeling\nrf 01 ui Cart.UI\nrf 02 cmd Cart.Save\nrf 03 evt Cart.Saved ->> 01 ->> 02'
  for (const borderColor of ['#000000', '#ff0000']) for (const bendRadius of [0, 24]) {
    const options = { padding: 24, embedFontImport: false, style: { roles: { node: { lineWidth: 20, borderColor }, edge: { strokeColor: '#ff0000', bendRadius } } } }
    const p = layoutMermaidWithReceipt(source, options).layout
    const target = p.nodes.find(node => node.id === '03')!
    const inputs = p.edges.filter(edge => edge.to === '03')
    const raster = renderSvgPixels(renderMermaidSVG(source, options))
    for (const edge of inputs) {
      const point = edge.path.at(-1)!
      // SVG's centered20px outline paints10px outside the rectangle geometry.
      const boundary = target.x - 10
      // A triangle fills this outer approach; coincident1px shafts alone do not.
      expect(colorPixelCountInRaster(raster, redPixel, { left: Math.floor(boundary - 7), right: Math.ceil(boundary - 2), top: Math.floor(point[1] - 2), bottom: Math.ceil(point[1] + 2) })).toBeGreaterThan(12)
      expect(point[0]).toBeCloseTo(boundary, 8)
    }
  }
})

test('equivalent palette and role outlines retain the same frame geometry and painted docking', () => {
  const source = 'eventmodeling\ntf 01 ui Main\ntf 02 cmd Save'
  const { JSDOM } = createRequire(import.meta.url)('jsdom')
  for (const [paint, extent] of [['transparent', 0], ['none', 0], ['rgba(20, 30, 40, 0)', 0], ['#000000', 10]] as const) for (const bendRadius of [0, 24]) {
    const common = { bg: '#ffffff', fg: '#000000', line: '#ff0000', surface: '#ffffff' }
    const roles = { node: { lineWidth: 20, fillColor: '#ffffff' }, group: { borderColor: '#555555' }, edge: { strokeColor: '#ff0000', bendRadius } }
    const palette = { embedFontImport: false, style: { colors: { ...common, border: paint }, roles } }
    const role = { embedFontImport: false, style: { colors: { ...common, border: '#000000' }, roles: { ...roles, node: { ...roles.node, borderColor: paint } } } }
    const paletteSvg = new JSDOM(renderMermaidSVG(source, palette), { contentType: 'image/svg+xml' })
    const roleSvg = new JSDOM(renderMermaidSVG(source, role), { contentType: 'image/svg+xml' })
    try {
      const selector = '[data-role="node"][data-id="02"] rect'
      const paletteStroke = paletteSvg.window.document.querySelector(selector)!.getAttribute('stroke')
      expect(paletteStroke).toBe(paint)
      expect(roleSvg.window.document.querySelector(selector)!.getAttribute('stroke')).toBe(paletteStroke)
      const a = layoutMermaidWithReceipt(source, palette).layout
      const b = layoutMermaidWithReceipt(source, role).layout
      expect(a).toEqual(b)
      const target = a.nodes.find(node => node.id === '02')!
      expect(a.edges[0]!.path.at(-1)![0]).toBeCloseTo(target.x - extent, 8)
    } finally {
      paletteSvg.window.close()
      roleSvg.window.close()
    }
  }
})

test('checked writes preserve identity and reject dangling references atomically', () => {
  const parsed = parseRegisteredMermaid(complex)
  if (!parsed.ok) throw Error('expected native diagram')
  const diagram = asEventModeling(parsed.value)!
  const source = serializeMermaid(diagram)
  const rejected = mutateChecked(diagram, { kind: 'remove_frame', id: '04' })
  expect(rejected.ok).toBe(false)
  expect(serializeMermaid(diagram)).toBe(source)
  const moved = mutateChecked(diagram, { kind: 'move_frame', id: '04', index: 0 })
  expect(moved.ok).toBe(true)
  const edited = mutateChecked(diagram, { kind: 'set_frame', id: '06', frame: { ...diagram.body.frames[4]!, entity: 'Stock.Refresh', data: { text: 'retained' } } })
  expect(edited.ok).toBe(true)
  expect(serializeMermaid(diagram)).toBe(source)
  expect(createMermaid('eventmodeling').body.frames).toEqual([])
  const built = buildMermaid('eventmodeling', [{ kind: 'insert_frame', frame: { id: '01', type: 'ui', reset: false, entity: 'CartUI', sources: [] } }])
  expect(built.ok && serializeMermaid(built.value)).toContain('tf 01 ui CartUI')
})

test('ambiguous and future syntax is preserved; rejected parses have no stale state', () => {
  for (const source of ['eventmodeling\ntf 01 ui A\ntf 01 cmd B', 'eventmodeling\nfuture syntax']) {
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) continue
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source)
    expect(mutateChecked(parsed.value, { kind: 'remove_frame', id: '01' }).ok).toBe(false)
  }
  expect(parseEventModeling(minimal).frames.map(frame => frame.id)).toEqual(['01', '02', '03'])
})

test('compact statements and comments do not consume literal data', () => {
  const body = parseEventModeling('eventmodeling\ntf 01 ui CartUI tf 02 cmd AddItem { keep %% and /* data */ } /* bridge\ncomment */ tf 03 evt Added // comment')
  expect(body.frames.map(frame => frame.entity)).toEqual(['CartUI', 'AddItem', 'Added'])
  expect(body.frames[1]!.data!.text).toBe(' keep %% and /* data */ ')
  for (const comment of ['/* heading */ ', '/* heading\ncontinued */ ']) {
    const titled = parseEventModeling(`eventmodeling\n${comment}title https://example.com\ntf 01 ui Main`)
    expect(titled.title).toBe('https://example.com')
  }
})

test('literal payload punctuation and reserved dictionary keys survive checked writes', () => {
  for (const text of ['a} // remainder', 'a} tf 02 evt Extra {b', '<b>keep</b>', '&lt;b&gt;keep&lt;/b&gt;', 'https://example.com']) {
    const changed = mutateChecked(createMermaid('eventmodeling'), { kind: 'insert_frame', frame: { id: '01', reset: false, type: 'ui', entity: 'Main', sources: [], data: { text } } })
    expect(changed.ok).toBe(true)
    if (!changed.ok || changed.value.body.kind !== 'eventmodeling') throw Error('expected native write')
    expect(changed.value.body.frames).toHaveLength(1)
    expect(changed.value.body.frames[0]!.data!.text).toBe(text)
    expect(parseEventModeling(serializeMermaid(changed.value)).frames[0]!.data!.text).toBe(text)
    expect(renderMermaidASCII(serializeMermaid(changed.value))).toContain(text)
  }
  const data = mutateChecked(createMermaid('eventmodeling'), { kind: 'set_data', id: '__proto__', data: { text: 'retained' } })
  expect(data.ok).toBe(true)
  if (!data.ok || data.value.body.kind !== 'eventmodeling') throw Error('expected native data')
  expect(Object.hasOwn(data.value.body.data, '__proto__')).toBe(true)
  expect(data.value.body.data.__proto__!.text).toBe('retained')
  for (const kind of ['set_title', 'set_accessibility_title', 'set_accessibility_description'] as const) {
    const op = kind === 'set_accessibility_description' ? { kind, description: 'https://example.com' } : { kind, title: 'https://example.com' }
    const result = mutateChecked(createMermaid('eventmodeling'), op)
    expect(result.ok).toBe(true)
    if (!result.ok) throw Error('expected text write')
    if (result.value.body.kind !== 'eventmodeling') throw Error('expected native text')
    const field = kind === 'set_title' ? 'title' : kind === 'set_accessibility_title' ? 'accessibilityTitle' : 'accessibilityDescription'
    expect(result.value.body[field]).toBe('https://example.com')
    expect(parseEventModeling(serializeMermaid(result.value))[field]).toBe('https://example.com')
  }
})

test('untyped shapes and reserved writer tokens fail atomically without banning ordinary prototype-named identifiers', () => {
  const empty = createMermaid('eventmodeling')
  for (const frame of [
    { id: 1, reset: false, type: 'ui', entity: 'Main', sources: [] },
    { id: '01', reset: false, type: 'ui', entity: 'event', sources: [] },
    { id: '01', reset: false, type: 'ui', entity: 'then', sources: [] },
  ])
    expect(mutateChecked(empty, { kind: 'insert_frame', frame } as never).ok).toBe(false)
  expect(empty.body.frames).toEqual([])
  expect(mutateChecked(empty, { kind: 'insert_frame', frame: { id: '01', reset: false, type: 'ui', entity: 'constructor', sources: [] } }).ok).toBe(true)
  const invalid = parseRegisteredMermaid('eventmodeling\nentity A\ntf 01 ui Main\ngwt 01 given constructor A then constructor A')
  expect(invalid.ok && invalid.value.body.kind).toBe('opaque')
})

test('compact/comment-prefixed declarations and explicit relations retain exact authored spans', () => {
  const source = 'eventmodeling\n/* doc */ tf 01 ui Main tf 02 cmd Save\nrf 03 evt Saved ->> 02'
  const result = parseRegisteredMermaid(source)
  if (!result.ok) throw Error('expected native source')
  expect([...result.value.source.nodes.keys()]).toEqual(['01', '02', '03'])
  for (const id of ['01', '02', '03']) {
    const span = result.value.source.spans!.nodes.get(id)!
    expect(source.slice(span.start.offset, span.start.offset + 2)).toBe(id)
  }
  const edge = result.value.source.spans!.edges.get('relation:02:03')!
  expect(source.slice(edge.start.offset, edge.end.offset)).toBe('->> 02')
})

test('outer routing space and group typography survive public render options', () => {
  const sources = ['eventmodeling\nrf 01 ui A\nrf 02 cmd B\nrf 03 evt C ->> 01', 'eventmodeling\nrf 01 ui Main ->> 02\nrf 02 evt Source']
  for (const source of sources) for (const padding of [0, 24])
    for (const nodeSpacing of [48, 80, 200]) {
      const p = layoutEventModeling(parseEventModeling(source), { padding, nodeSpacing })
      for (const edge of p.edges) for (const point of edge.points) expect(point.y).toBeGreaterThan(0)
      expect(renderMermaidSVG(source, { padding, nodeSpacing })).toContain('viewBox=')
    }
  const svg = renderMermaidSVG('eventmodeling\ntf 01 ui A', { style: { roles: { group: { fontSize: 42, fontWeight: 900, fontFamily: 'Georgia', textTransform: 'uppercase' }, node: { fontSize: 18 } } } })
  expect(svg).toContain('UI /')
  expect(svg).toContain('AUTOMA')
  expect(svg).not.toContain('Automation')
  expect(svg).toContain('Georgia')
  expect(svg).toContain('font-size="42"')
  expect(svg).toContain('font-weight="900"')
})

test('native writers produce source admitted by pinned Mermaid for rich ownership and data delimiters', async () => {
  const upstream = startUpstreamMermaid()
  try {
    const rich = parseRegisteredMermaid(complex)
    if (!rich.ok) throw Error('expected rich native source')
    expect((await upstream.parse(serializeMermaid(rich.value))).ok).toBe(true)
    for (const text of ['a} // remainder', 'a} tf 02 evt Extra {b', 'https://example.com']) {
      const result = buildMermaid('eventmodeling', [{ kind: 'insert_frame', frame: { id: '01', reset: false, type: 'ui', entity: 'Main', sources: [], data: { text } } }])
      if (!result.ok) throw Error(result.error.message)
      expect((await upstream.parse(serializeMermaid(result.value))).ok).toBe(true)
    }
  } finally {
    await upstream.close()
  }
})

test('title changes preserve unrelated wrapper fields/comments and metadata-looking data stays literal', async () => {
  const upstream = startUpstreamMermaid()
  try {
    for (const title of ['title: Old # keep comment\n', 'title: |\n  First\n  Second\n', '']) {
      const source = `---\n${title}config:\n  theme: dark\n# untouched metadata comment\n---\n%% leading comment\neventmodeling\ntf 01 ui Main`
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw Error('expected source')
      const changed = mutateChecked(parsed.value, { kind: 'set_title', title: 'https://example.com' })
      if (!changed.ok) throw Error(changed.error.message)
      const written = serializeMermaid(changed.value)
      expect(written.match(/^---$/gm)).toHaveLength(2)
      expect(written).toContain('config:\n  theme: dark\n# untouched metadata comment')
      expect(written).toContain('%% leading comment')
      expect((await upstream.parse(written)).ok).toBe(true)
      const cleared = mutateChecked(changed.value, { kind: 'set_title' })
      if (!cleared.ok || cleared.value.body.kind !== 'eventmodeling') throw Error('expected title removal')
      expect(cleared.value.body.title).toBeUndefined()
      expect(serializeMermaid(cleared.value)).toContain('# untouched metadata comment')
    }
    for (const yaml of ['{title: Old, config: {theme: dark}}', '{config: {theme: dark}, title: Old}']) {
      const parsed = parseRegisteredMermaid(`---\n${yaml}\n---\neventmodeling\ntf 01 ui Main`)
      if (!parsed.ok) throw Error('expected flow metadata')
      const cleared = mutateChecked(parsed.value, { kind: 'set_title' })
      if (!cleared.ok) throw Error(cleared.error.message)
      expect(cleared.value.meta.frontmatter?.theme).toBe('dark')
    }
    const anchored = parseRegisteredMermaid('---\ntitle: &shared Old\nconfig:\n  theme: dark\n  fontFamily: *shared\n---\neventmodeling\ntf 01 ui Main')
    if (!anchored.ok) throw Error('expected aliased title')
    const before = serializeMermaid(anchored.value)
    const rejected = mutateChecked(anchored.value, { kind: 'set_title', title: 'Changed' })
    expect(rejected.ok).toBe(false)
    expect(serializeMermaid(anchored.value)).toBe(before)
    expect(anchored.value.meta.frontmatter?.fontFamily).toBe('Old')
    const source = 'eventmodeling\ntf 01 ui Main [[Payload]]\ndata Payload {\naccTitle: literal field\naccDescr: literal description\n}'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'eventmodeling') throw Error('expected native payload')
    expect(parsed.value.body.data.Payload!.text).toBe('accTitle: literal field\naccDescr: literal description')
    expect(parsed.value.meta.accessibility).toEqual({})
  } finally {
    await upstream.close()
  }
})


test('generous Given/When/Then reads warn for missing and reordered clause markers', async () => {
  const upstream = startUpstreamMermaid()
  try {
    for (const clauses of ['cmd A then evt A', 'given cmd A then evt A given evt A', 'given cmd A then evt A when cmd A', 'given cmd A when then evt A']) {
      const source = `eventmodeling\nentity A\ntf 01 ui Main\ngwt 01 ${clauses}`
      expect((await upstream.parse(source)).ok).toBe(false)
      expect(verifyMermaid(source).warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toBe(true)
    }
  } finally { await upstream.close() }
})


test('source-map relation ownership excludes arrow-like literal data', () => {
  const source = 'eventmodeling\nrf 01 ui Main {example ->> 99}\ntf 02 cmd Next ->> 01 {literal ->> 98}'
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw Error('expected source')
  expect([...parsed.value.source.edges.keys()]).toEqual(['relation:01:02'])
  expect(parsed.value.source.edges.get('relation:01:02')).toEqual({line: 3, col: 16})
})


test('lane padding, header paint and rounded routes consume the shared style face', () => {
  const source = 'eventmodeling\ntf 01 ui Main\ntf 02 cmd Save'
  const roomy = { style: { roles: { node: { lineWidth: 2 }, group: { paddingX: 90, paddingY: 55, headerFillColor: '#dbf7ef' }, edge: { bendRadius: 24 } } } }
  const tight = { style: { roles: { node: { lineWidth: 2 }, group: { paddingX: 0, paddingY: 0 }, edge: { bendRadius: 0 } } } }
  const r = verifyMermaid(source, { renderOptions: roomy }).layout!
  const t = verifyMermaid(source, { renderOptions: tight }).layout!
  expect(r.nodes[0]!.x).toBeGreaterThan(t.nodes[0]!.x)
  //55px remains outside each painted side, including the1px half-outline.
  expect(r.groups[0]!.h - r.nodes[0]!.h).toBe(112)
  const rounded = renderMermaidSVG(source, roomy)
  const straight = renderMermaidSVG(source, tight)
  expect(rounded).toContain('#dbf7ef')
  expect(rounded).toMatch(/data-id="relation:01:02"[^>]*d="[^"]*Q|d="[^"]*Q[^"]*"[^>]*data-id="relation:01:02"/)
  expect(straight).not.toMatch(/d="[^"]*Q/)
  expect(r.edges[0]!.path.length).toBeGreaterThan(t.edges[0]!.path.length)
  expect(r.edges[0]!.from).toBe('01')
  expect(r.edges[0]!.to).toBe('02')
})

test('complex payload edits retain painted frame, lane and relationship ownership across looks and palettes', () => {
  const parsed = parseRegisteredMermaid(complex)
  if (!parsed.ok || parsed.value.body.kind !== 'eventmodeling') throw Error('expected native source')
  const changed = mutateChecked(parsed.value, { kind: 'set_data', id: 'Items', data: { text: '{"lastCharacter":"λ"}' } })
  if (!changed.ok || changed.value.body.kind !== 'eventmodeling') throw Error('expected native payload edit')
  expect(changed.value.body.frames).toEqual(parsed.value.body.frames)
  expect(changed.value.body.notes).toEqual(parsed.value.body.notes)
  expect(changed.value.body.specifications).toEqual(parsed.value.body.specifications)
  expect(parsed.value.body.data.Items!.text).toBe('{"lastCharacter":"z"}')
  expect(changed.value.body.data.Items!.text).toBe('{"lastCharacter":"λ"}')
  const { JSDOM } = createRequire(import.meta.url)('jsdom')
  for (const style of ['crisp', ['hand-drawn', 'github-light'], ['hand-drawn', 'dracula'], ['watercolor', 'solarized-light']]) {
    const svg = renderMermaidSVG(serializeMermaid(changed.value), { style, seed: 7, embedFontImport: false })
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' })
    try {
      const document = dom.window.document as Document
      expect([...document.querySelectorAll('[data-role="node"]')].map(node => [node.getAttribute('data-id'), node.getAttribute('data-parent')])).toEqual([
        ['09', 'lane:0'], ['01', 'lane:1'], ['03', 'lane:2'], ['04', 'lane:3'], ['06', 'lane:0'], ['07', 'lane:1'], ['08', 'lane:0'],
      ])
      expect([...document.querySelectorAll('[data-role="edge"]')].map(edge => [edge.getAttribute('data-from'), edge.getAttribute('data-to'), edge.getAttribute('data-relationship')])).toEqual(complexRelations.map(([from, to, explicit]) => [from, to, explicit ? 'explicit' : 'inferred']))
      const owned = document.querySelector('[data-role="node"][data-id="07"]')!
      const words = [...owned.querySelectorAll('text > tspan')].map(line => line.textContent).join(' ').replace(/\s+/g, ' ')
      for (const text of ['Cart.Items', '{"lastCharacter":"λ"}', 'Note: Keep the whole note', 'given: event Changed', 'when: command Refresh', 'then: event Refreshed']) expect(words).toContain(text)
      expect(document.querySelector('[data-role="node"][data-id="04"]')!.textContent).toContain('reset')
      expect(document.querySelectorAll('[data-role="edge"][data-to="04"]')).toHaveLength(0)
      expect(document.querySelectorAll('[data-role="edge"][data-to="07"]')).toHaveLength(2)
    } finally { dom.window.close() }
  }
})

test('pinned multiline blocks and undeclared GWT reference tokens retain owned meaning', async () => {
  // Mermaid12.2: eventmodeling.spec.ts:46 and parser/tests/eventmodeling.test.ts:11.
  const source = 'eventmodeling\ntf 01 cmd AddItem\ntf 02 evt ItemAdded [[ItemAddedData]]\ndata ItemAddedData\n{\n  productId: 7\n}\nnote 02\n`md` {\nKeep this note\n}\ngwt 01 given evt ItemAdded when cmd AddItem then evt ItemAdded'
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'eventmodeling') throw Error('expected native pinned source')
  expect(parsed.value.body.data.ItemAddedData).toEqual({ text: '  productId: 7' })
  expect(parsed.value.body.notes).toEqual([{ frame: '02', data: { type: 'md', text: 'Keep this note' } }])
  expect(parsed.value.body.entities).toEqual([])
  expect(parsed.value.body.specifications[0]!.given).toEqual([{ type: 'event', entity: 'ItemAdded' }])
  const upstream = startUpstreamMermaid()
  try { expect((await upstream.parse(serializeMermaid(parsed.value))).ok).toBe(true) }
  finally { await upstream.close() }
  const rejected = mutateChecked(parsed.value, { kind: 'set_specifications', specifications: [{ frame: '01', given: [{ type: 'event', entity: 'then' }], when: [], then: [{ type: 'event', entity: 'ItemAdded' }] }] })
  expect(rejected.ok).toBe(false)
  expect(parsed.value.body.entities).toEqual([])
})


test('duplicate diagnostics retain original lines through comments and compact statements', () => {
  for (const [source, line] of [
    ['eventmodeling\ntf 01 ui Main\n%% retained source line\nrf 01 evt Duplicate', 4],
    ['eventmodeling\ntf 01 ui Main rf 01 evt Duplicate', 2],
    ['eventmodeling\r\ntf 01 ui Main\r\n/* comment */ rf 01 evt Duplicate', 3],
  ] as const) expect(() => parseEventModeling(source)).toThrow(`Duplicate event modeling frame ID "01" on line ${line}`)
})

test('long authored indentation retains frame offsets with bounded scanning work', () => {
  const { ratio, result } = measureGrowth(size => {
    const source = `eventmodeling\n${' '.repeat(size)}tf 01 ui Main`
    const spans: Array<{ id: string; start: number; end: number }> = []
    const body = parseEventModeling(source, event => { if (event.kind === 'nodes') spans.push(event) })
    expect(body.frames.map(frame => [frame.id, frame.entity])).toEqual([['01', 'Main']])
    expect(spans.map(span => source.slice(span.start, span.end))).toEqual(['01 ui Main'])
    return body.frames.length
  }, 2048)
  expect(result).toBe(1)
  expect(ratio).toBeLessThan(LINEAR_GROWTH_CEILING)
})
