/** Additive cohorts. Dave and the historical six-core comparison stay unchanged. */
export const PORTABLE_COHORT_PROTOCOL = 'portable-authored-family-scaling-v1'
export type PortableCohort = 'family' | 'scaling' | 'adversarial' | 'invalid'
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface PortableEdge {
  source: string
  target: string
}
export interface PortableCase {
  id: string
  family: string
  source: string
  cohort: PortableCohort
  scale?: number
  expected: {
    accept: boolean
    labels: string[]
    model?: { path: (string | number | { map: string })[]; value: Json; comparison?: 'display-text' }[]
    topology?: { nodes: string[]; edges: PortableEdge[]; nodeLabels?: Record<string, string>; groups?: { id: string; members: string[] }[] }
  }
  renderOptions?: Record<string, Json>
  prelude?: { source: string; accept: boolean }[]
  edit?: { source: string; expected: PortableCase['expected']; renderOptions?: Record<string, Json> }
}

const edge = (source: string, target: string): PortableEdge => ({ source, target })
const familyCases: PortableCase[] = [
  {
    id: 'family:flowchart',
    family: 'flowchart',
    cohort: 'family',
    source: 'flowchart LR\nA[Alpha] --> B[Beta]\nB --> C[Gamma]',
    expected: { accept: true, labels: ['Alpha', 'Beta', 'Gamma'], topology: { nodes: ['A', 'B', 'C'], edges: [edge('A', 'B'), edge('B', 'C')], nodeLabels: { A: 'Alpha', B: 'Beta', C: 'Gamma' } } },
  },
  { id: 'family:sequence', family: 'sequence', cohort: 'family', source: 'sequenceDiagram\nparticipant A as Alpha\nparticipant B as Beta\nA->>B: Request\nB-->>A: Reply', expected: { accept: true, labels: ['Alpha', 'Beta', 'Request', 'Reply'], topology: { nodes: ['A', 'B'], edges: [edge('A', 'B'), edge('B', 'A')] } } },
  { id: 'family:state', family: 'state', cohort: 'family', source: 'stateDiagram-v2\nstate "Alpha" as A\nstate "Beta" as B\nA --> B: advance', expected: { accept: true, labels: ['Alpha', 'Beta', 'advance'], topology: { nodes: ['A', 'B'], edges: [edge('A', 'B')] } } },
  { id: 'family:class', family: 'class', cohort: 'family', source: 'classDiagram\nclass Alpha\nclass Beta\nAlpha --> Beta: uses', expected: { accept: true, labels: ['Alpha', 'Beta', 'uses'], topology: { nodes: ['Alpha', 'Beta'], edges: [edge('Alpha', 'Beta')] } } },
  { id: 'family:er', family: 'er', cohort: 'family', source: 'erDiagram\nALPHA ||--o{ BETA : owns', expected: { accept: true, labels: ['ALPHA', 'BETA', 'owns'], topology: { nodes: ['ALPHA', 'BETA'], edges: [edge('ALPHA', 'BETA')] } } },
  { id: 'family:timeline', family: 'timeline', cohort: 'family', source: 'timeline\ntitle Delivery\n2026 : Launch : Review', expected: { accept: true, labels: ['Delivery', '2026', 'Launch', 'Review'], model: [{ path: ['periods', 0, 'events'], value: ['Launch', 'Review'], comparison: 'display-text' }] } },
  {
    id: 'family:journey',
    family: 'journey',
    cohort: 'family',
    source: 'journey\ntitle Delivery\nsection Plan\nReview: 4: Builder',
    expected: {
      accept: true,
      labels: ['Delivery', 'Plan', 'Review', 'Builder'],
      model: [
        { path: ['tasks', 0, 'score'], value: 4 },
        { path: ['tasks', 0, 'people'], value: ['Builder'] },
      ],
    },
  },
  {
    id: 'family:architecture',
    family: 'architecture',
    cohort: 'family',
    source: 'architecture-beta\ngroup app(cloud)[App]\nservice api(server)[API] in app\nservice db(database)[Data] in app\napi:R --> L:db',
    expected: { accept: true, labels: ['App', 'API', 'Data'], topology: { nodes: ['api', 'db'], edges: [edge('api', 'db')], groups: [{ id: 'app', members: ['api', 'db'] }] } },
  },
  {
    id: 'family:xychart',
    family: 'xychart',
    cohort: 'family',
    source: 'xychart-beta\ntitle "Series"\nx-axis [One, Two, Three]\ny-axis "Count" 0 --> 10\nbar [3, 7, 5]\nline [2, 6, 4]',
    expected: {
      accept: true,
      labels: ['Series', 'One', 'Two', 'Three', 'Count'],
      model: [
        { path: ['xAxis', 'categories'], value: ['One', 'Two', 'Three'] },
        {
          path: ['plots', 0, 'data'],
          value: [
            ['One', 3],
            ['Two', 7],
            ['Three', 5],
          ],
        },
        {
          path: ['plots', 1, 'data'],
          value: [
            ['One', 2],
            ['Two', 6],
            ['Three', 4],
          ],
        },
      ],
    },
  },
  {
    id: 'family:pie',
    family: 'pie',
    cohort: 'family',
    source: 'pie title Shares\n"Alpha" : 7\n"Beta" : 3',
    expected: {
      accept: true,
      labels: ['Shares', 'Alpha', 'Beta'],
      model: [
        { path: ['sections', { map: 'Alpha' }], value: 7 },
        { path: ['sections', { map: 'Beta' }], value: 3 },
      ],
    },
  },
  {
    id: 'family:quadrant',
    family: 'quadrant',
    cohort: 'family',
    source: 'quadrantChart\ntitle Priority\nx-axis Low effort --> High effort\ny-axis Low value --> High value\nAlpha: [0.2, 0.8]\nBeta: [0.8, 0.2]',
    expected: {
      accept: true,
      labels: ['Priority', 'Alpha', 'Beta', 'Low effort', 'High effort', 'Low value', 'High value'],
      model: [
        { path: ['points', 0, 'x'], value: 0.2 },
        { path: ['points', 0, 'y'], value: 0.8 },
        { path: ['points', 1, 'x'], value: 0.8 },
        { path: ['points', 1, 'y'], value: 0.2 },
      ],
    },
  },
  {
    id: 'family:gantt',
    family: 'gantt',
    cohort: 'family',
    source: 'gantt\ntitle Delivery\ndateFormat YYYY-MM-DD\ntodayMarker off\nsection Build\nDesign :taskAlpha, 2026-01-01, 2d\nReview :taskBeta, after taskAlpha, 3d',
    expected: {
      accept: true,
      labels: ['Delivery', 'Build', 'Design', 'Review'],
      model: [
        { path: ['tasks', 0, 'id'], value: 'taskAlpha' },
        { path: ['tasks', 1, 'id'], value: 'taskBeta' },
        { path: ['tasks', 1, 'raw', 'start'], value: 'after taskAlpha' },
      ],
    },
  },
  {
    id: 'family:mindmap',
    family: 'mindmap',
    cohort: 'family',
    source: 'mindmap\nroot((Root))\n  Alpha\n    Beta\n  Gamma',
    expected: {
      accept: true,
      labels: ['Root', 'Alpha', 'Beta', 'Gamma'],
      model: [
        { path: ['nodes', 0, 'descr'], value: 'Root' },
        { path: ['nodes', 0, 'children', 0, 'descr'], value: 'Alpha' },
        { path: ['nodes', 0, 'children', 0, 'children', 0, 'descr'], value: 'Beta' },
      ],
    },
  },
  {
    id: 'family:gitgraph',
    family: 'gitgraph',
    cohort: 'family',
    source: 'gitGraph\ncommit id:"Alpha" tag:"v1"\nbranch feature\ncommit id:"Beta"\ncheckout main\nmerge feature id:"Gamma"',
    expected: {
      accept: true,
      labels: ['Alpha', 'Beta', 'Gamma', 'v1'],
      model: [
        { path: ['commits', { map: 'Alpha' }, 'tags'], value: ['v1'] },
        { path: ['commits', { map: 'Gamma' }, 'parents'], value: ['Alpha', 'Beta'] },
      ],
    },
  },
  {
    id: 'family:radar',
    family: 'radar',
    cohort: 'family',
    source: 'radar-beta\ntitle Skills\naxis speed["Speed"], power["Power"], range["Range"]\ncurve now["Current"]{3, 4, 2}\nmax 5\nshowLegend true',
    expected: {
      accept: true,
      labels: ['Skills', 'Speed', 'Power', 'Range', 'Current'],
      model: [
        { path: ['curves', 0, 'entries'], value: [3, 4, 2] },
        { path: ['axes', 0, 'label'], value: 'Speed' },
      ],
    },
  },
  {
    id: 'family:sankey',
    family: 'sankey',
    cohort: 'family',
    source: 'sankey-beta\nAlpha,Beta,5\nBeta,Gamma,5',
    expected: {
      accept: true,
      labels: ['Alpha', 'Beta', 'Gamma'],
      topology: { nodes: ['Alpha', 'Beta', 'Gamma'], edges: [edge('Alpha', 'Beta'), edge('Beta', 'Gamma')] },
      model: [
        { path: ['links', 0, 'value'], value: 5 },
        { path: ['links', 1, 'value'], value: 5 },
      ],
    },
  },
  { id: 'family:c4', family: 'c4', cohort: 'family', source: 'C4Context\nPerson(user, "User")\nSystem(api, "API", "Service")\nRel(user, api, "Uses")', expected: { accept: true, labels: ['User', 'API', 'Service', 'Uses'], topology: { nodes: ['user', 'api'], edges: [edge('user', 'api')] } } },
  {
    id: 'family:packet',
    family: 'packet',
    cohort: 'family',
    source: 'packet\n0-7: "Header"\n8-15: "Payload"',
    expected: {
      accept: true,
      labels: ['Header', 'Payload'],
      model: [
        { path: ['rows', 0, 0, 'bits'], value: 8 },
        { path: ['rows', 0, 1, 'start'], value: 8 },
        { path: ['rows', 0, 1, 'end'], value: 15 },
      ],
    },
  },
  {
    id: 'family:kanban',
    family: 'kanban',
    cohort: 'family',
    source: 'kanban\nbacklog[Backlog]\n  TaskA[Build]\ndone[Done]\n  TaskB[Test]',
    expected: {
      accept: true,
      labels: ['Backlog', 'Build', 'Done', 'Test'],
      model: [
        { path: ['sections', 0, 'id'], value: 'backlog' },
        { path: ['sections', 0, 'items', 0, 'id'], value: 'TaskA' },
        { path: ['sections', 1, 'items', 0, 'id'], value: 'TaskB' },
      ],
    },
  },
  {
    id: 'family:requirement',
    family: 'requirement',
    cohort: 'family',
    source: 'requirementDiagram\nrequirement reliable {\nid: R1\ntext: Requests retain meaning\nrisk: high\nverifymethod: test\n}\nelement suite {\ntype: "test"\n}\nsuite - verifies -> reliable',
    expected: {
      accept: true,
      labels: ['reliable', 'suite', 'Requests retain meaning'],
      topology: { nodes: ['reliable', 'suite'], edges: [edge('suite', 'reliable')] },
      model: [
        { path: ['requirements', { map: 'reliable' }, 'requirementId'], value: 'R1' },
        { path: ['requirements', { map: 'reliable' }, 'text'], value: 'Requests retain meaning' },
      ],
    },
  },
  {
    id: 'family:treemap',
    family: 'treemap',
    cohort: 'family',
    source: 'treemap\n"Root"\n  "Alpha": 7\n  "Beta": 3',
    expected: {
      accept: true,
      labels: ['Root', 'Alpha', 'Beta'],
      model: [
        { path: ['roots', 0, 'children', 0, 'value'], value: 7 },
        { path: ['roots', 0, 'children', 1, 'value'], value: 3 },
      ],
    },
  },
  {
    id: 'family:ishikawa',
    family: 'ishikawa',
    cohort: 'family',
    source: 'ishikawa\n  Delay\n  Process\n    Review\n  Tooling\n    Build',
    expected: {
      accept: true,
      labels: ['Delay', 'Process', 'Review', 'Tooling', 'Build'],
      model: [
        { path: ['root', 'text'], value: 'Delay' },
        { path: ['root', 'children', 0, 'text'], value: 'Process' },
        { path: ['root', 'children', 0, 'children', 0, 'text'], value: 'Review' },
      ],
    },
  },
  {
    id: 'family:block',
    family: 'block',
    cohort: 'family',
    source: 'block\ncolumns 2\nAlpha["Alpha"] Beta["Beta"]\nAlpha --> Beta',
    expected: {
      accept: true,
      labels: ['Alpha', 'Beta'],
      model: [
        { path: ['byId', { map: 'Alpha' }, 'label'], value: 'Alpha' },
        { path: ['edges', 0, 'start'], value: 'Alpha' },
        { path: ['edges', 0, 'end'], value: 'Beta' },
      ],
    },
  },
]

function scalingCase(family: string, size: number): PortableCase {
  const nodes = Array.from({ length: size }, (_, index) => `N${index}`)
  const edges = nodes.slice(1).map((target, index) => edge(nodes[index]!, target))
  let source: string,
    labels: string[],
    topology = { nodes, edges }
  if (family === 'flowchart') {
    source =
      'flowchart LR\n' +
      nodes
        .map(id => `${id}[${id}]`)
        .concat(edges.map(item => `${item.source} --> ${item.target}`))
        .join('\n')
    labels = nodes
  } else if (family === 'class') {
    source =
      'classDiagram\n' +
      nodes
        .map(id => `class ${id}`)
        .concat(edges.map(item => `${item.source} --> ${item.target}`))
        .join('\n')
    labels = nodes
  } else if (family === 'er') {
    source = 'erDiagram\n' + edges.map(item => `${item.source} ||--o{ ${item.target} : owns`).join('\n')
    labels = [...nodes, 'owns']
  } else if (family === 'state') {
    source = 'stateDiagram-v2\n' + edges.map(item => `${item.source} --> ${item.target}`).join('\n')
    labels = nodes
  } else {
    source = 'sequenceDiagram\nparticipant A as Alpha\nparticipant B as Beta\n' + nodes.map((id, index) => (index % 2 ? `B-->>A: ${id}` : `A->>B: ${id}`)).join('\n')
    labels = ['Alpha', 'Beta', ...nodes]
    topology = { nodes: ['A', 'B'], edges: nodes.map((_id, index) => (index % 2 ? edge('B', 'A') : edge('A', 'B'))) }
  }
  return { id: `scaling:${family}:${size}`, family, source, cohort: 'scaling', scale: size, expected: { accept: true, labels, topology: { ...topology, ...(family === 'flowchart' ? { nodeLabels: Object.fromEntries(nodes.map(id => [id, id])) } : {}) } } }
}
const adversarialCases: PortableCase[] = [
  {
    id: 'adversarial:label-edit',
    family: 'flowchart',
    cohort: 'adversarial',
    source: 'flowchart LR\nA[Base label] --> B[Stable label]',
    expected: { accept: true, labels: ['Base label', 'Stable label'], topology: { nodes: ['A', 'B'], edges: [edge('A', 'B')], nodeLabels: { A: 'Base label', B: 'Stable label' } } },
    edit: { source: 'flowchart LR\nA[Edited label] --> B[Stable label]', expected: { accept: true, labels: ['Edited label', 'Stable label'], topology: { nodes: ['A', 'B'], edges: [edge('A', 'B')], nodeLabels: { A: 'Edited label', B: 'Stable label' } } } },
  },
  {
    id: 'adversarial:parallel-reciprocal',
    family: 'flowchart',
    cohort: 'adversarial',
    source: 'flowchart LR\nA[Alpha] --> B[Beta]\nA --> B\nB --> A\nB --> C[Gamma]',
    expected: { accept: true, labels: ['Alpha', 'Beta', 'Gamma'], topology: { nodes: ['A', 'B', 'C'], edges: [edge('A', 'B'), edge('A', 'B'), edge('B', 'A'), edge('B', 'C')] } },
  },
  {
    id: 'adversarial:nested-groups',
    family: 'flowchart',
    cohort: 'adversarial',
    source: 'flowchart TB\nsubgraph Outer[Outer group]\nsubgraph Inner[Inner group]\nA[Alpha] --> B[Beta]\nend\nC[Gamma]\nend\nB --> C',
    expected: {
      accept: true,
      labels: ['Outer group', 'Inner group', 'Alpha', 'Beta', 'Gamma'],
      topology: {
        nodes: ['A', 'B', 'C'],
        edges: [edge('A', 'B'), edge('B', 'C')],
        groups: [
          { id: 'Inner', members: ['A', 'B'] },
          { id: 'Outer', members: ['Inner', 'C'] },
        ],
      },
    },
  },
  {
    id: 'adversarial:wide-unicode',
    family: 'flowchart',
    cohort: 'adversarial',
    source: 'flowchart LR\nA["工程 🧑‍💻 é A very long authored label that must survive"] --> B["部署 🚀"]',
    expected: { accept: true, labels: ['工程', '🧑‍💻', 'é', 'A very long authored label that must survive', '部署', '🚀'], topology: { nodes: ['A', 'B'], edges: [edge('A', 'B')] } },
  },
  {
    id: 'adversarial:generated-looking-ids',
    family: 'flowchart',
    cohort: 'adversarial',
    source: 'flowchart LR\nL_A_B_0[First] --> A_B[Second]\nA_B --> C[Third]',
    expected: { accept: true, labels: ['First', 'Second', 'Third'], topology: { nodes: ['L_A_B_0', 'A_B', 'C'], edges: [edge('L_A_B_0', 'A_B'), edge('A_B', 'C')] } },
  },
  { id: 'adversarial:quoted-labels', family: 'flowchart', cohort: 'adversarial', source: 'flowchart LR\nA["Authored A & B"] --> B["Less than #60; stays text"]', expected: { accept: true, labels: ['Authored A & B', 'Less than < stays text'], topology: { nodes: ['A', 'B'], edges: [edge('A', 'B')] } } },
  { id: 'adversarial:invalid-recovery', family: 'flowchart', cohort: 'adversarial', prelude: [{ source: 'flowchart LR\n --> -->', accept: false }], source: 'flowchart LR\nA[Recovered] --> B[Ready]', expected: { accept: true, labels: ['Recovered', 'Ready'], topology: { nodes: ['A', 'B'], edges: [edge('A', 'B')] } } },
  {
    id: 'adversarial:configuration-reset',
    family: 'flowchart',
    cohort: 'adversarial',
    prelude: [{ source: '%%{init: {"flowchart": {"nodeSpacing": 100}}}%%\nflowchart LR\nA[Previous] --> B[Configuration]', accept: true }],
    source: 'flowchart TB\nA[Current] --> B[Configuration]',
    renderOptions: { fontSize: 14 },
    expected: { accept: true, labels: ['Current', 'Configuration'], topology: { nodes: ['A', 'B'], edges: [edge('A', 'B')] }, model: [{ path: ['direction'], value: 'TB' }] },
    edit: { source: 'flowchart TB\nA[Current] --> B[Configuration]', renderOptions: { fontSize: 24 }, expected: { accept: true, labels: ['Current', 'Configuration'], topology: { nodes: ['A', 'B'], edges: [edge('A', 'B')] }, model: [{ path: ['direction'], value: 'TB' }] } },
  },
]
const invalidCases: PortableCase[] = [
  { id: 'invalid:unknown-header', family: 'invalid-source', cohort: 'invalid', source: 'This is not Mermaid. @@@ {{{', expected: { accept: false, labels: [] } },
  { id: 'invalid:missing-endpoints', family: 'flowchart', cohort: 'invalid', source: 'flowchart LR\n --> -->', expected: { accept: false, labels: [] } },
  { id: 'invalid:unfinished-sequence', family: 'sequence', cohort: 'invalid', source: 'sequenceDiagram\nA->>', expected: { accept: false, labels: [] } },
]
export function portableCases(selection?: readonly PortableCohort[]): PortableCase[] {
  const cases = [...familyCases, ...['flowchart', 'sequence', 'class', 'state', 'er'].flatMap(family => [8, 32, 128].map(size => scalingCase(family, size))), ...adversarialCases, ...invalidCases]
  return selection ? cases.filter(testCase => selection.includes(testCase.cohort)) : cases
}
