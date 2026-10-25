import { expect, test } from 'bun:test'
import type { PortableCase } from '../portable/cohorts.ts'
import { qualifyPortable } from '../portable/fidelity.ts'

type Family = 'class' | 'state' | 'er'
const sources: Record<Family, string> = {
  class: 'classDiagram\nclass A\nclass B\nclass C\nA --> B\nB --> C',
  state: 'stateDiagram-v2\nA --> B\nB --> C',
  er: 'erDiagram\nA ||--o{ B : first\nB ||--o{ C : second',
}
const graph = (family: Family): PortableCase => ({
  id: 'owned-' + family,
  family,
  cohort: 'adversarial',
  source: sources[family],
  expected: {
    accept: true,
    labels: ['A', 'B', 'C'],
    topology: {
      nodes: ['A', 'B', 'C'],
      edges: [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
      ],
    },
  },
})
function model(family: Family) {
  if (family === 'class')
    return {
      type: family,
      classes: new Map(['A', 'B', 'C'].map(id => [id, { label: id }])),
      relations: [
        { id1: 'A', id2: 'B', relation: { type1: 'none', type2: 3 } },
        { id1: 'B', id2: 'C', relation: { type1: 'none', type2: 3 } },
      ],
    }
  if (family === 'state')
    return {
      type: family,
      states: new Map(['A', 'B', 'C'].map(id => [id, { descriptions: [id] }])),
      relations: [
        { id1: 'A', id2: 'B' },
        { id1: 'B', id2: 'C' },
      ],
    }
  return {
    type: family,
    entities: new Map(['A', 'B', 'C'].map(id => [id, { id: 'entity-' + id, label: id }])),
    relationships: [
      { entityA: 'entity-A', entityB: 'entity-B' },
      { entityA: 'entity-B', entityB: 'entity-C' },
    ],
  }
}
const node = (family: Family, id: string, x: number) => `<g class="pele-node pele-${family === 'er' ? 'entity' : family}" data-id="${id}"><rect x="${x}" y="10" width="20" height="20" fill="white" stroke="black"/><text x="${x}" y="20">${id}</text></g>`
const edge = (family: Family, index: number, from: number, to: number, marker = true) =>
  `<g class="pele-edge" data-id="relation-${index}"><path d="M${from},20 L${to - (family === 'er' ? 0 : 7)},20"/>${!marker ? '' : family === 'er' ? `<path class="pele-marker" d="M${from + 6},16 L${from + 6},24 M${from + 10},16 L${from + 10},24"/><path class="pele-marker" d="M${to + 6},20 L${to},10 L${to - 6},20"/>` : `<path class="pele-marker" d="M${to},20L${to - 8},16L${to - 8},24Z" fill="black" stroke="none"/>`}</g>`
const svg = (family: Family, edges = edge(family, 0, 30, 110) + edge(family, 1, 130, 210)) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="pele pele-${family}" viewBox="0 0 250 50"><g class="pele-edges" fill="none" stroke="black">${edges}</g>${node(family, 'A', 10)}${node(family, 'B', 110)}${node(family, 'C', 210)}</svg>`
const finding = (result: ReturnType<typeof qualifyPortable>, name: string) => result.checks.find(check => check.name === name)

for (const family of ['class', 'state', 'er'] as const) {
  test(`${family}: owned geometry binds authored relations without guessing generated IDs`, () => {
    const result = qualifyPortable(graph(family), { svg: svg(family), model: model(family) })
    expect(result.passed).toBe(true)
    expect(result.semanticComplete).toBe(true)
    expect(finding(result, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('passed')
    // DOM order is irrelevant; the independently observed endpoints bind each edge.
    expect(qualifyPortable(graph(family), { svg: svg(family, edge(family, 1, 130, 210) + edge(family, 0, 30, 110)), model: model(family) }).semanticComplete).toBe(true)
  })
  test(`${family}: correct public model and labels cannot hide an edge redirected to another node`, () => {
    const result = qualifyPortable(graph(family), { svg: svg(family, edge(family, 0, 30, 210) + edge(family, 1, 130, 210)), model: model(family) })
    expect(finding(result, 'model-edge-endpoints-and-multiplicity')?.status).toBe('passed')
    expect(finding(result, 'label:B')?.status).toBe('passed')
    expect(finding(result, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('failed')
    expect(result.semanticComplete).toBe(false)
  })
  test(`${family}: dropped relation ink fails despite unchanged labels and native graph`, () => {
    const result = qualifyPortable(graph(family), { svg: svg(family, edge(family, 0, 30, 110)), model: model(family) })
    expect(finding(result, 'model-node-identities')?.status).toBe('passed')
    expect(finding(result, 'label:C')?.status).toBe('passed')
    expect(finding(result, 'svg-owned-edge-count')?.status).toBe('failed')
    expect(result.passed).toBe(false)
  })
  test(`${family}: body paths without endpoint marker ink cannot certify the declared relation`, () => {
    const result = qualifyPortable(graph(family), { svg: svg(family, edge(family, 0, 30, 110, false) + edge(family, 1, 130, 210)), model: model(family) })
    expect(finding(result, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('passed')
    expect(finding(result, family === 'er' ? 'svg-edge-end-markers:0' : 'svg-edge-target-marker:0')?.status).toBe('failed')
    expect(result.semanticComplete).toBe(false)
  })
}
test('duplicate relation owner IDs fail even when all expected geometric endpoint pairs are present', () => {
  const result = qualifyPortable(graph('class'), { svg: svg('class').replace('data-id="relation-1"', 'data-id="relation-0"'), model: model('class') })
  expect(finding(result, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('passed')
  expect(finding(result, 'svg-owned-edge-identities')?.status).toBe('failed')
  expect(result.semanticComplete).toBe(false)
})
test('a degenerate move-only path is not a connecting segment', () => {
  const result = qualifyPortable(graph('state'), { svg: svg('state').replace('M30,20 L103,20', 'M30,20'), model: model('state') })
  expect(finding(result, 'svg-edge-attachment:0')?.status).toBe('unmeasured')
  expect(result.semanticComplete).toBe(false)
})
test('a failed canvas or authored-label criterion withholds semantic completion despite correct topology', () => {
  const emptyCanvas = qualifyPortable(graph('state'), { svg: svg('state').replace('0 0 250 50', '0 0 0 0'), model: model('state') })
  expect(finding(emptyCanvas, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('passed')
  expect(finding(emptyCanvas, 'positive-canvas')?.status).toBe('failed')
  expect(emptyCanvas.semanticComplete).toBe(false)
  const annotated = { ...graph('class'), expected: { ...graph('class').expected, labels: ['A', 'B', 'C', 'Required authored note'] } }
  expect(qualifyPortable(annotated, { svg: svg('class'), model: model('class') }).semanticComplete).toBe(false)
})
test('unreviewed class marker profiles remain unmeasured rather than pretending to cover all relationship kinds', () => {
  const actual = model('class')
  const relations = (actual as { relations: { relation: { type1: string; type2: number } }[] }).relations
  relations[0]!.relation.type2 = 0
  const result = qualifyPortable(graph('class'), { svg: svg('class'), model: actual })
  expect(finding(result, 'svg-edge-target-marker:0')?.status).toBe('unmeasured')
  expect(result.semanticComplete).toBe(false)
})

const sequence: PortableCase = {
  id: 'owned-sequence',
  family: 'sequence',
  cohort: 'adversarial',
  source: 'sequenceDiagram\nparticipant A\nparticipant B\nparticipant C\nA->>B: Request\nB-->>A: Reply',
  expected: {
    accept: true,
    labels: ['A', 'B', 'C', 'Request', 'Reply'],
    topology: {
      nodes: ['A', 'B', 'C'],
      edges: [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'A' },
      ],
    },
  },
}
const sequenceModel = () => ({
  type: 'sequence',
  actors: new Map(['A', 'B', 'C'].map(id => [id, { name: id, description: id, type: 'participant' }])),
  messages: [
    { from: 'A', to: 'B', message: 'Request', type: 0 },
    { from: 'B', to: 'A', message: 'Reply', type: 1 },
  ],
  notes: [],
  boxes: [],
  createdActors: {},
  destroyedActors: {},
  active: {},
})
const participant = (id: string, x: number, footer = false) => `<g class="pele-node pele-actor${footer ? ' pele-actor-footer' : ''}" data-id="${id}"><rect x="${x - 10}" y="${footer ? 200 : 10}" width="20" height="20" fill="white" stroke="black"/><text x="${x}" y="${footer ? 215 : 25}">${id}</text></g>`
const message = (index: number, from: number, to: number, y: number) =>
  `<g class="pele-edge pele-message" data-id="message-${index}"><path d="M${from},${y}H${to - Math.sign(to - from) * 7}"/><path class="pele-marker" d="M${to},${y}L${to - Math.sign(to - from) * 8},${y - 4}L${to - Math.sign(to - from) * 8},${y + 4}Z" fill="black" stroke="none"/></g>`
const messageLabel = (index: number, label: string, y: number) => `<g class="pele-edge-label" data-id="message-${index}"><text x="70" y="${y}">${label}</text></g>`
const sequenceSvg = (messages = message(0, 20, 120, 70) + message(1, 120, 20, 110), labels = messageLabel(0, 'Request', 65) + messageLabel(1, 'Reply', 105), extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="pele pele-sequence" viewBox="0 0 250 240"><g class="pele-edges" stroke="black" fill="none">${messages}</g>${['A', 'B', 'C'].map((id, i) => participant(id, i * 100 + 20) + participant(id, i * 100 + 20, true) + `<path class="pele-lifeline" data-id="${id}" d="M${i * 100 + 20},30V200" stroke="black"/>`).join('')}${labels}${extra}</svg>`

test('simple sequence messages bind to actor lifelines while legitimate footer duplicates stay distinct', () => {
  const result = qualifyPortable(sequence, { svg: sequenceSvg(), model: sequenceModel() })
  expect(result.passed).toBe(true)
  expect(result.semanticComplete).toBe(true)
  expect(finding(result, 'svg-owned-node-identities')?.status).toBe('passed')
  expect(finding(result, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('passed')
})
test('sequence message paint redirected to a third actor fails with correct labels and unchanged native messages', () => {
  const result = qualifyPortable(sequence, { svg: sequenceSvg(message(0, 20, 220, 70) + message(1, 120, 20, 110)), model: sequenceModel() })
  expect(finding(result, 'model-message-order')?.status).toBe('passed')
  expect(finding(result, 'label:Request')?.status).toBe('passed')
  expect(finding(result, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('failed')
  expect(result.semanticComplete).toBe(false)
})
test('duplicating a message label cannot be hidden by an unowned global copy of the missing text', () => {
  const result = qualifyPortable(sequence, { svg: sequenceSvg(undefined, messageLabel(0, 'Request', 65) + messageLabel(1, 'Request', 105), '<text x="10" y="230">Reply</text>'), model: sequenceModel() })
  expect(finding(result, 'label:Reply')?.status).toBe('passed')
  expect(finding(result, 'svg-sequence-owned-message-label:1')?.status).toBe('failed')
  expect(result.semanticComplete).toBe(false)
})
test('sequence chronology comes from painted rows, not DOM order or native endpoint multiset alone', () => {
  const result = qualifyPortable(sequence, { svg: sequenceSvg(message(0, 20, 120, 110) + message(1, 120, 20, 70)), model: sequenceModel() })
  expect(finding(result, 'model-edge-endpoints-and-multiplicity')?.status).toBe('passed')
  expect(finding(result, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('failed')
  expect(result.passed).toBe(false)
})
test('a duplicated actor header cannot impersonate a legitimate footer', () => {
  const result = qualifyPortable(sequence, { svg: sequenceSvg(undefined, undefined, participant('A', 20)), model: sequenceModel() })
  expect(finding(result, 'svg-owned-node-identities')?.status).toBe('failed')
  expect(result.semanticComplete).toBe(false)
})
test('unreviewed sequence signal styles stay unmeasured even when their labels and endpoints match', () => {
  const actual = sequenceModel()
  actual.messages[0]!.type = 2
  const result = qualifyPortable(sequence, { svg: sequenceSvg(), model: actual })
  expect(finding(result, 'model-message-order')?.status).toBe('passed')
  expect(finding(result, 'svg-sequence-message-profile')?.status).toBe('unmeasured')
  expect(result.semanticComplete).toBe(false)
})
