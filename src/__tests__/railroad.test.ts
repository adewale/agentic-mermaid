import { expect, test } from 'bun:test'
import { decodeXML } from 'entities'
import { parseRailroad } from '../railroad/parser.ts'
import { renderRailroad } from '../railroad/source.ts'
import { layoutRailroad } from '../railroad/layout.ts'
import { mutateRailroad, parseRailroadBody } from '../agent/railroad-body.ts'
import { knownStyles, renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { lowerRailroadScene } from '../railroad/renderer.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { visitTypedPathSegments } from '../scene/bounds.ts'
import type { Point } from '../types.ts'
import { mutate, mutateChecked, parseRegisteredMermaid, serializeMermaid } from '../agent/core.ts'

const grammars = [
  ['constructors', 'railroad-beta\nentry = sequence(terminal("start"), choice(nonterminal("item"), optional(terminal("end"))), zeroOrMore(terminal(",")));'],
  ['EBNF', 'railroad-ebnf-beta\nentry = "start", [item], {","};\nitem = name - keyword;'],
  ['ABNF', 'railroad-abnf-beta\nentry = 1*3"a" / %x41;'],
  ['PEG', 'railroad-peg-beta\nentry <- &item ("a" / .)*;\nitem <- !"reserved" name;'],
] as const

test.each(grammars)('Railroad %s title edits retain field punctuation and whitespace or fail atomically', async (_name, source) => {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'railroad') throw new Error('Expected editable Railroad')
  const upstream = startUpstreamMermaid()
  try {
    for (const [title, escapedTitle, abnfTitle] of [
      ['a%%b', true, false],
      ['slash\\%%{init: {}}%% literal #37;', true, false],
      ['two  spaces', true, false],
      ['quoted "title" \\ path', true, true],
      ['東京 title', true, true],
      ['line\nbreak', true, false],
      ['', false, false],
    ] as const) {
      const before = structuredClone(parsed.value)
      const edited = mutateChecked(parsed.value, { kind: 'set_title', title })
      const representable = parsed.value.body.notation === 'abnf' ? abnfTitle : escapedTitle
      expect(edited.ok).toBe(representable)
      expect(parsed.value).toEqual(before)
      if (!edited.ok) continue
      if (edited.value.body.kind !== 'railroad') throw new Error('Expected edited Railroad')
      expect(edited.value.body.title).toBe(title)
      const written = serializeMermaid(edited.value), reread = parseRegisteredMermaid(written)
      if (!reread.ok || reread.value.body.kind !== 'railroad') throw new Error('Expected reloaded Railroad')
      expect(reread.value.body.title).toBe(title)
      expect(reread.value.body.rules).toEqual(parsed.value.body.rules)
      expect(await upstream.publicAccepts(written)).toBe(true)
    }
  } finally { upstream.close() }
})

test.each(grammars)('Railroad %s keeps accessibility fields through native and public writes and edits', async (_name, source) => {
  const authored = source.replace('\n', '\naccTitle: Accessible "quoted"\naccDescr {\nFirst  paragraph\n\nSecond paragraph\n}\n')
  const native = parseRailroad(authored)
  expect(native.accessibilityTitle).toBe('Accessible "quoted"')
  expect(native.accessibilityDescription).toBe('First  paragraph\n\nSecond paragraph')
  const upstream = startUpstreamMermaid()
  try {
    for (const title of ['Read  "quoted" %%{ literal #35; &amp;', '']) for (const description of ['First  paragraph\n\nSecond } paragraph #10; %%{ literal\n"quoted" &amp;', 'One  paragraph', '']) {
      const body = { ...native, accessibilityTitle: title, accessibilityDescription: description }
      const written = renderRailroad(body)
      expect(parseRailroad(written)).toEqual(body)
      const nativeEdit = mutateRailroad(body, { kind: 'set_title', title: 'Edited' })
      if (!nativeEdit.ok) throw Error(nativeEdit.error.message)
      expect(nativeEdit.value).toEqual({ ...body, title: 'Edited' })
      const parsed = parseRegisteredMermaid(written)
      if (!parsed.ok || parsed.value.body.kind !== 'railroad') throw Error('Expected editable Railroad metadata')
      expect(parsed.value.body).toEqual(body)
      expect(parsed.value.meta.accessibility).toEqual({ title, descr: description })
      const edited = mutate(parsed.value, { kind: 'set_title', title: 'Edited' })
      if (!edited.ok || edited.value.body.kind !== 'railroad') throw Error('Expected Railroad title edit')
      expect(edited.value.body).toEqual({ ...body, title: 'Edited' })
      const output = serializeMermaid(edited.value)
      expect(output.match(/accTitle\s*:/g)).toHaveLength(1)
      expect(output.match(/accDescr\s*[:{]/g)).toHaveLength(1)
      const reopened = parseRegisteredMermaid(output)
      if (!reopened.ok) throw Error('Expected exported Railroad source')
      expect(reopened.value.body).toEqual(edited.value.body)
      const svg = renderMermaidSVG(edited.value)
      if (title) expect(decodeXML(svg.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)![1]!)).toBe(title)
      if (description) expect(decodeXML(svg.match(/<desc\b[^>]*>([\s\S]*?)<\/desc>/)![1]!)).toBe(description)
      expect(await upstream.publicAccepts(output)).toBe(true)
    }
    const rejected = mutateRailroad({ ...native, accessibilityTitle: 'First\nSecond' }, { kind: 'set_title', title: 'Edited' })
    expect(rejected.ok).toBe(false)
    expect(native.title).toBeUndefined()
  } finally { upstream.close() }
})

test.each(grammars)('Railroad %s retains its notation and complete expression model through native edits', (_name, source) => {
  const body = parseRailroad(source), serialized = renderRailroad(body)
  expect(parseRailroad(serialized)).toEqual(body)
  expect(JSON.stringify(body)).not.toContain('Infinity')
  const edited = mutateRailroad(body, { kind: 'add_rule', name: 'another', definition: { type: 'terminal', value: 'kept' } })
  if (!edited.ok) throw new Error(edited.error.message)
  expect(edited.value.notation).toBe(body.notation)
  expect(edited.value.rules.at(-1)).toEqual({ name: 'another', definition: { type: 'terminal', value: 'kept' } })
  expect(body.rules.some(rule => rule.name === 'another')).toBe(false)
})

test('Railroad preserves ABNF numeric-vs-string literals, bounded repeats, PEG lookahead and EBNF exclusion', () => {
  expect(parseRailroad(grammars[2][1]).rules[0]?.definition).toEqual({ type: 'choice', alternatives: [
    { type: 'repetition', min: 1, max: 3, element: { type: 'terminal', value: 'a' } }, { type: 'terminal', value: '%x41', literalKind: 'abnf-numeric' },
  ] })
  expect(parseRailroad(grammars[3][1]).rules[0]?.definition).toMatchObject({ type: 'sequence', elements: [{ type: 'predicate', operator: '&', element: { type: 'nonterminal', name: 'item' } }, { type: 'repetition', min: 0, max: null }] })
  expect(parseRailroad(grammars[1][1]).rules[1]?.definition).toEqual({ type: 'exception', base: { type: 'nonterminal', name: 'name' }, except: { type: 'nonterminal', name: 'keyword' } })
})

test('Railroad layout owns connected choice branches and repetition return tracks with measured bounds', () => {
  const body = parseRailroad(grammars[0][1]), layout = layoutRailroad(body)
  expect(layout).toEqual(layoutRailroad(body))
  expect(layout.labels.map(label => label.block.text)).toContain('repeat 0..unbounded')
  // Every leaf's left/right border physically meets an owned rail segment.
  const touches = (x: number, y: number) => layout.tracks.some(track => track.points.some(point => Math.abs(point.x - x) < 0.001 && Math.abs(point.y - y) < 0.001))
  for (const label of layout.labels.filter(label => label.kind !== 'annotation')) {
    expect(touches(label.x, label.y + label.height / 2)).toBe(true)
    expect(touches(label.x + label.width, label.y + label.height / 2)).toBe(true)
    expect(label.x + label.width).toBeLessThanOrEqual(layout.width)
    expect(label.y + label.height).toBeLessThanOrEqual(layout.height)
  }
})

test.each(grammars)('Railroad %s batches rails without losing contours or joining separate tracks', (_name, source) => {
  const chart = layoutRailroad(parseRailroad(source))
  const scene = lowerRailroadScene({ positioned: chart, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } })
  for (const part of scene.parts) {
    if (part.kind !== 'group') continue
    const rails = part.children.map(child => child.node).filter(node => node.id.startsWith('rails:'))
    expect(rails).toHaveLength(1)
    const rail = rails[0]!
    if (rail.kind !== 'shape' || rail.geometry.kind !== 'path') throw new Error('Expected owned rail artwork')
    const tracks = chart.tracks.filter(track => track.ruleId === part.id)
    const segments: Array<readonly [Point, Point]> = []
    expect(visitTypedPathSegments(rail.geometry.d, segment => { if (segment.line) segments.push(segment.line); return true })).toBe(true)
    const expected = tracks.flatMap(track => track.points.slice(1).map((point, index) => [track.points[index]!, point] as const))
    expect(segments).toHaveLength(expected.length)
    for (let index = 0; index < expected.length; index++) for (const endpoint of [0, 1] as const) {
      expect(segments[index]![endpoint].x).toBeCloseTo(expected[index]![endpoint].x, 3)
      expect(segments[index]![endpoint].y).toBeCloseTo(expected[index]![endpoint].y, 3)
    }
    expect(rail.geometry.d.match(/M/g)).toHaveLength(tracks.length)
    expect(rail.owner).toEqual({ id: part.id, role: 'group' })
    expect(rail.identity).toBeUndefined()
  }
})

test('Railroad structural edits reject cycles, malformed input is preserved, and repeated rule names remain distinct', () => {
  const body = parseRailroad('railroad-beta\nentry = terminal("a");\nentry = terminal("b");')
  expect(body.rules.map(rule => rule.name)).toEqual(['entry', 'entry'])
  expect(layoutRailroad(body).rules.map(rule => rule.id)).toEqual(['rule#0:entry', 'rule#1:entry'])
  const cyclic: any = { type: 'optional' }; cyclic.element = cyclic
  expect(mutateRailroad(body, { kind: 'replace_rule', index: 0, definition: cyclic }).ok).toBe(false)
  const malformed = 'railroad-ebnf-beta\nentry = ["unclosed";'
  const parsed = parseRailroadBody(malformed)
  expect(parsed.ok && parsed.value).toEqual({ kind: 'opaque', family: 'railroad', source: malformed })
})

test.each(grammars)('Railroad %s renders real SVG rails and explicitly diagnosed complete terminal grammar', (_name, source) => {
  const svg = renderMermaidSVG(source)
  expect(svg).toContain('data-id="rule#0:entry"')
  expect(svg).toContain('<path')
  const terminal = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', layoutSafety: 'strict' })
  expect(terminal.receipt.layoutCertification?.status).toBe('passed')
  const document = terminalDocumentOf(terminal)!
  expect(document.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'railroad.expression-hierarchy' }))
  expect(document.regions().some(region => region.id === 'rule#0:entry/expression')).toBe(true)
})

test('ABNF exact-zero and exact-one repeats draw only the traversable track', () => {
  const zero = layoutRailroad(parseRailroad('railroad-abnf-beta\nentry = 0"hidden";'))
  expect(zero.labels).toHaveLength(0)
  expect(zero.tracks).toHaveLength(3)
  const one = layoutRailroad(parseRailroad('railroad-abnf-beta\nentry = 1"once";'))
  expect(one.labels.map(label => label.block.text)).toEqual(['once'])
  expect(one.tracks).toHaveLength(4)
})

test('Railroad rule groups contain every rounded leaf across styles', () => {
  const input = 'railroad-ebnf-beta\nentry = "start", [item], {",", item};\nitem = "word" | "number";'
  for (const style of knownStyles()) expect(() => renderMermaidSVG(input, { style })).not.toThrow()
})

test('Railroad paints group, node and annotation typography and nonterminal corners from their style roles', () => {
  const svg = renderMermaidSVG('railroad-ebnf-beta\nentry = item, {"word"};', { style: { roles: {
    group: { textColor: '#123456', fontSize: 20, textTransform: 'uppercase' },
    node: { textColor: '#445566', fontSize: 18, textTransform: 'uppercase', cornerRadius: 17, paddingX: 30, paddingY: 20 },
    edge: { textColor: '#778899', fontSize: 12, textTransform: 'uppercase' },
  } } })
  const elements: Array<Record<string, string>> = scanSvgStartTags(svg).map(tag => ({ name: tag.name, ...Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])) }))
  expect(elements.find(element => element.name === 'text' && element.fill === '#123456')).toMatchObject({ fill: '#123456', 'font-size': '20' })
  expect(elements.find(element => element.name === 'text' && element.fill === '#445566')).toMatchObject({ fill: '#445566', 'font-size': '18' })
  expect(elements.find(element => element.name === 'text' && element.fill === '#778899')).toMatchObject({ fill: '#778899', 'font-size': '12' })
  expect(elements.find(element => element['data-id'] === 'rule#0:entry/expression/0')).toMatchObject({ rx: '17' })
  for (const text of ['ENTRY', 'ITEM', 'WORD', 'REPEAT 0..UNBOUNDED']) expect(svg).toContain(text)
})

test('Railroad writers retain grammar escapes and reject notation changes or injected numeric expressions', () => {
  for (const notation of ['railroad', 'ebnf', 'peg'] as const) {
    const body = { kind: 'railroad' as const, notation, title: 'title \\ path', rules: [{ name: 'entry', definition: { type: 'terminal' as const, value: 'back\b form\f slash\\ quoted"\n\t' } }] }
    const restored = parseRailroad(renderRailroad(body))
    expect(restored.title).toBe(body.title)
    expect(restored.rules).toEqual(body.rules)
  }
  const abnf = { kind: 'railroad' as const, notation: 'abnf' as const, title: 'title \\ path', rules: [{ name: 'entry', definition: { type: 'terminal' as const, value: 'value' } }] }
  expect(parseRailroad(renderRailroad(abnf)).title).toBe(abnf.title)
  expect(mutateRailroad(abnf, { kind: 'replace_rule', index: 0, definition: { type: 'terminal', literalKind: 'abnf-numeric', value: '%x41; injected = "wrong"' } }).ok).toBe(false)
  expect(() => parseRailroad('railroad-abnf-beta\nentry = 3*1"invalid";')).toThrow('Repetition bounds')
  expect(() => parseRailroad('railroad-abnf-beta\nentry = 999999999999999999999"unsafe";')).toThrow('Repetition bounds')
  expect(mutateRailroad({ ...abnf, notation: 'ebnf' }, { kind: 'replace_rule', index: 0, definition: { type: 'choice', ordered: true, alternatives: [{ type: 'terminal', value: 'first' }, { type: 'terminal', value: 'second' }] } }).ok).toBe(false)
})

test('canonical Railroad string escapes remain accepted by the independent public Mermaid parser', async () => {
  const upstream = startUpstreamMermaid()
  try {
    for (const notation of ['railroad', 'ebnf', 'abnf', 'peg'] as const) {
      const body = { kind: 'railroad' as const, notation, title: 'title \\ path', rules: [{ name: 'entry', definition: { type: 'terminal' as const, value: notation === 'abnf' ? 'back\\slash' : 'quoted" back\\slash\nline' } }] }
      expect(await upstream.publicAccepts(renderRailroad(body))).toBe(true)
    }
  } finally { upstream.close() }
})
