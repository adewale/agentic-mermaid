import { expect, test } from 'bun:test'
import { parseRailroad } from '../railroad/parser.ts'
import { renderRailroad } from '../railroad/source.ts'
import { layoutRailroad } from '../railroad/layout.ts'
import { mutateRailroad, parseRailroadBody } from '../agent/railroad-body.ts'
import { knownStyles, renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'

const grammars = [
  ['constructors', 'railroad-beta\nentry = sequence(terminal("start"), choice(nonterminal("item"), optional(terminal("end"))), zeroOrMore(terminal(",")));'],
  ['EBNF', 'railroad-ebnf-beta\nentry = "start", [item], {","};\nitem = name - keyword;'],
  ['ABNF', 'railroad-abnf-beta\nentry = 1*3"a" / %x41;'],
  ['PEG', 'railroad-peg-beta\nentry <- &item ("a" / .)*;\nitem <- !"reserved" name;'],
] as const

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
  expect(svg).toContain('data-id="entry:rule#0:entry"')
  expect(svg).toContain('<polyline')
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
