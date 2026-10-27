import { expect, test } from 'bun:test'
import { asEventModeling, buildMermaid, createMermaid, describeMermaidTree, mutateChecked, parseRegisteredMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/core.ts'
import { eventRelations, parseEventModeling } from '../eventmodeling/parser.ts'
import { layoutEventModeling } from '../eventmodeling/layout.ts'

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

test('native frames keep source order, full data and source-owned notes/specifications', () => {
  const body = parseEventModeling(complex)
  expect(body.frames.map(frame => frame.id)).toEqual(['09', '01', '03', '04', '06', '07', '08'])
  expect(body.frames[1]!.data!.text).toBe(' description: string ')
  expect(body.data.Items!.text).toBe('{"lastCharacter":"z"}')
  expect(body.notes).toEqual([{ frame: '07', data: { text: 'Keep the whole note' } }])
  expect(body.specifications).toEqual([{ frame: '07', given: [{ type: 'event', entity: 'Changed' }], when: [{ type: 'command', entity: 'Refresh' }], then: [{ type: 'event', entity: 'Refreshed' }] }])
  expect(eventRelations(body).map(edge => [edge.from, edge.to, edge.explicit])).toEqual([
    ['09', '01', false],
    ['01', '03', false],
    ['04', '06', true],
    ['03', '07', true],
    ['04', '07', true],
    ['07', '08', false],
  ])
  const parsed = parseRegisteredMermaid(complex)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(asEventModeling(parsed.value)?.body).toEqual(body)
  expect(parseEventModeling(serializeMermaid(parsed.value))).toEqual(body)
  expect(describeMermaidTree(parsed.value).edges.map(edge => [edge.from, edge.to])).toContainEqual(['04', '07'])
})

test('namespace re-entry owns one lane, non-overlapping chronological columns and exact endpoints', () => {
  const p = layoutEventModeling(parseEventModeling(complex))
  expect(p.nodes.filter(node => node.frame.type === 'ui').map(node => node.lane)).toEqual(['lane:0', 'lane:0'])
  for (const [i, node] of p.nodes.entries()) for (const other of p.nodes.slice(i + 1)) expect(node.x + node.width).toBeLessThan(other.x)
  expect(p.edges.map(edge => [edge.from, edge.to])).toContainEqual(['04', '07'])
  for (const edge of p.edges) {
    const from = p.nodes.find(node => node.id === edge.from)!,
      to = p.nodes.find(node => node.id === edge.to)!
    expect(edge.points[0]).toEqual({ x: from.x + from.width, y: from.y + from.height / 2 })
    expect(edge.points.at(-1)).toEqual({ x: to.x, y: to.y + to.height / 2 })
  }
  const svg = renderMermaidSVG(minimal, { embedFontImport: false })
  for (const label of ['CartUI', 'AddItem', 'ItemAdded']) expect(svg).toContain(label)
  const terminal = renderMermaidASCII(minimal, { useAscii: true })
  for (const label of ['CartUI', 'AddItem', 'ItemAdded']) expect(terminal).toContain(label)
  expect(terminal).toContain('>')
  expect(verifyMermaid(minimal).ok).toBe(true)
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
})
