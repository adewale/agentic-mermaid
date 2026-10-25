import { expect, test } from 'bun:test'
import type { PortableCase } from '../portable/cohorts.ts'
import { qualifyPortable } from '../portable/fidelity.ts'

const graph: PortableCase = {
  id: 'authored-flowchart',
  family: 'flowchart',
  cohort: 'adversarial',
  source: 'flowchart LR\nA[Alpha] --> B[Beta]',
  expected: { accept: true, labels: ['Alpha', 'Beta'], topology: { nodes: ['A', 'B'], edges: [{ source: 'A', target: 'B' }], nodeLabels: { A: 'Alpha', B: 'Beta' } } },
}
const model = () => ({
  type: 'flowchart',
  nodes: new Map([
    ['A', { text: 'Alpha' }],
    ['B', { text: 'Beta' }],
  ]),
  edges: [{ id: 'L_A_B_0', start: 'A', end: 'B' }],
  subgraphs: [] as { id: string; nodes: string[] }[],
})
const ownedEdge = (path = 'M30,20 L93,20') => `<g class="pele-edge" data-id="L_A_B_0"><path d="${path}"/><path class="pele-marker" d="M100,20L92,24L92,16Z"/></g>`
const node = (id: string, label: string, x: number) => `<g class="pele-node" data-id="${id}"><rect x="${x}" y="10" width="20" height="20"/><text x="${x}" y="20">${label}</text></g>`
const svg = (edges = ownedEdge(), extra = '', swapped = false) => `<svg xmlns="http://www.w3.org/2000/svg" class="pele pele-flowchart" viewBox="0 0 260 90">${extra}${edges}${node('A', swapped ? 'Beta' : 'Alpha', 10)}${node('B', swapped ? 'Alpha' : 'Beta', 100)}</svg>`
const check = (result: ReturnType<typeof qualifyPortable>, name: string) => result.checks.find(item => item.name === name)

test('qualifies declared graph meaning through both the public model and owned path geometry', () => {
  const result = qualifyPortable(graph, { svg: svg(), model: model() })
  expect(result.passed).toBe(true)
  expect(result.semanticComplete).toBe(true)
  expect(check(result, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('passed')
  expect(result.unmeasuredScopes.join(' ')).toContain('curve geometry')
  expect(result.scope).toContain('not complete Mermaid or visual fidelity')
})
test('correct labels and model do not hide a path attached to the wrong place', () => {
  const result = qualifyPortable(graph, { svg: svg(ownedEdge('M30,20 L230,20')), model: model() })
  expect(check(result, 'label:Alpha')?.status).toBe('passed')
  expect(check(result, 'model-edge-endpoints-and-multiplicity')?.status).toBe('passed')
  expect(check(result, 'svg-edge-attachment:0')?.status).toBe('failed')
  expect(result.passed).toBe(false)
  expect(result.semanticComplete).toBe(false)
})
test('a duplicate painted edge fails even with unchanged labels and native graph', () => {
  const result = qualifyPortable(graph, { svg: svg(ownedEdge() + ownedEdge()), model: model() })
  expect(check(result, 'svg-owned-edge-count')?.status).toBe('failed')
  expect(check(result, 'svg-owned-edge-endpoints-and-multiplicity')?.status).toBe('failed')
  expect(result.semanticComplete).toBe(false)
})
test('swapping labels between the correct node IDs loses authored meaning', () => {
  const result = qualifyPortable(graph, { svg: svg(ownedEdge(), '', true), model: model() })
  expect(check(result, 'label:Alpha')?.status).toBe('passed')
  expect(check(result, 'label:Beta')?.status).toBe('passed')
  expect(check(result, 'svg-owned-node-label:A')?.status).toBe('failed')
  expect(check(result, 'svg-owned-node-label:B')?.status).toBe('failed')
  expect(result.passed).toBe(false)
})
test('a public model with reversed endpoints fails independently of the SVG label census', () => {
  const actual = model()
  actual.edges[0] = { id: 'L_A_B_0', start: 'B', end: 'A' }
  const result = qualifyPortable(graph, { svg: svg(), model: actual })
  expect(check(result, 'model-edge-endpoints-and-multiplicity')?.status).toBe('failed')
  expect(result.passed).toBe(false)
})
test('edge IDs and marker ink alone do not substitute for an actual connecting path', () => {
  const result = qualifyPortable(graph, { svg: svg('<g class="pele-edge" data-id="L_A_B_0"><path class="pele-marker" d="M100,20L92,24L92,16Z"/></g>'), model: model() })
  expect(check(result, 'svg-edge-owned-ink:0')?.status).toBe('failed')
  expect(result.passed).toBe(false)
})
test('group membership must also be reflected in painted containment', () => {
  const grouped: PortableCase = { ...graph, expected: { ...graph.expected, topology: { ...graph.expected.topology!, groups: [{ id: 'G', members: ['A', 'B'] }] } } }
  const actual = model()
  actual.subgraphs = [{ id: 'G', nodes: ['A', 'B'] }]
  const result = qualifyPortable(grouped, { svg: svg(ownedEdge(), '<g class="pele-cluster" data-id="G"><rect x="0" y="0" width="50" height="50"/></g>'), model: actual })
  expect(check(result, 'model-group-membership:G')?.status).toBe('passed')
  expect(check(result, 'svg-group-containment:G')?.status).toBe('failed')
  expect(result.semanticComplete).toBe(false)
})
test('missing public parse evidence remains unmeasured and cannot qualify semantic equivalence', () => {
  const result = qualifyPortable(graph, { svg: svg() })
  expect(result.accepted).toBe(true)
  expect(check(result, 'model-node-identities')?.status).toBe('unmeasured')
  expect(result.passed).toBe(false)
  expect(result.semanticComplete).toBe(false)
})
test('numeric public-model fidelity is independent of labels and does not certify chart geometry', () => {
  const pie: PortableCase = { id: 'authored-pie', family: 'pie', source: 'pie\n"Alpha":7', cohort: 'family', expected: { accept: true, labels: ['Alpha'], model: [{ path: ['sections', { map: 'Alpha' }], value: 7 }] } }
  const output = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text>Alpha</text></svg>'
  const correct = qualifyPortable(pie, { svg: output, model: { type: 'pie', sections: new Map([['Alpha', 7]]) } })
  expect(check(correct, 'model:["sections",{"map":"Alpha"}]')?.status).toBe('passed')
  expect(check(correct, 'painted-semantic-correspondence')?.status).toBe('unmeasured')
  expect(correct.semanticComplete).toBe(false)
  const wrong = qualifyPortable(pie, { svg: output, model: { type: 'pie', sections: new Map([['Alpha', 70]]) } })
  expect(check(wrong, 'model:["sections",{"map":"Alpha"}]')?.status).toBe('failed')
})
test('invalid-source rejection requires a public exception, rather than an empty successful return', () => {
  const invalid: PortableCase = { id: 'authored-negative', family: 'flowchart', source: 'flowchart LR\n --> -->', cohort: 'invalid', expected: { accept: false, labels: [] } }
  expect(qualifyPortable(invalid, { error: 'Parser rejected missing endpoints' }).passed).toBe(true)
  expect(qualifyPortable(invalid, { svg: '' }).passed).toBe(false)
})
test('font configuration must be emitted, rather than merely accepted as an unused option', () => {
  const configured = { ...graph, renderOptions: { fontSize: 24 } }
  const ignored = qualifyPortable(configured, { svg: svg().replace('class="pele pele-flowchart"', 'class="pele pele-flowchart" style="font:14px sans-serif"'), model: model() })
  expect(check(ignored, 'svg-root-font-size')?.status).toBe('failed')
  const consumed = qualifyPortable(configured, { svg: svg().replace('class="pele pele-flowchart"', 'class="pele pele-flowchart" style="font:24px sans-serif"'), model: model() })
  expect(check(consumed, 'svg-root-font-size')?.status).toBe('passed')
})
test('namespace, duplicate document IDs and hidden source text are independent admission failures', () => {
  expect(check(qualifyPortable(graph, { svg: svg().replace('http://www.w3.org/2000/svg', 'urn:wrong'), model: model() }), 'svg-format')?.status).toBe('failed')
  expect(check(qualifyPortable(graph, { svg: svg(ownedEdge(), '<path id="duplicate"/><path id="duplicate"/>'), model: model() }), 'svg-unique-ids')?.status).toBe('failed')
  const hidden = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><metadata>Alpha Beta</metadata><text display="none">Alpha Beta</text></svg>'
  expect(check(qualifyPortable(graph, { svg: hidden, model: model() }), 'label:Alpha')?.status).toBe('failed')
  const foreign = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">Alpha Beta<g>Alpha Beta</g><text xmlns="urn:unpainted">Alpha Beta</text></svg>'
  expect(check(qualifyPortable(graph, { svg: foreign, model: model() }), 'label:Alpha')?.status).toBe('failed')
})
test('an uninspectable public result fails its own qualification without aborting the campaign', () => {
  const actual = Object.defineProperty({}, 'type', {
    get() {
      throw Error('Broken public model accessor')
    },
  })
  const result = qualifyPortable(graph, { svg: svg(), model: actual })
  expect(result.accepted).toBe(true)
  expect(result.passed).toBe(false)
  expect(check(result, 'qualification-protocol')?.actual).toBe('Broken public model accessor')
})
