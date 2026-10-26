import policy from '../../../docs/project/upstream-mermaid-policy.json' with { type: 'json' }
import { portableCases } from '../portable/cohorts.ts'
import type { AuthoredFidelityCase, MeaningExpectation, MeaningEdge } from './meaning.ts'

const required = (family: string) => policy.families.some(item => item.id === family && item.maturity === 'stable') || ['eventmodeling', 'zenuml'].includes(family)
const relation = (source: string, target: string, label = '', directed = true): MeaningEdge => ({ source, target, label, directed })
const nodes = (...ids: string[]) => ids.map(id => ({ id, label: id }))
const authoredEdit: Record<string, [string, string]> = {
  flowchart: ['Alpha', 'Alpha edited'], sequence: ['Alpha', 'Alpha edited'], class: ['Alpha', 'Renamed'], state: ['Alpha', 'Alpha edited'], er: ['ALPHA', 'RENAMED'], journey: ['Review', 'Inspect'], gantt: ['Design', 'Inspect'], pie: ['Alpha', 'Renamed'], quadrant: ['Alpha', 'Renamed'], requirement: ['Requests retain meaning', 'Requests stay intact'], gitgraph: ['Alpha', 'Renamed'], mindmap: ['Root', 'RevisedRoot'], sankey: ['Alpha', 'Renamed'], xychart: ['One', 'First'], block: ['Alpha', 'Renamed'], packet: ['Header', 'RevisedHeader'], kanban: ['Build', 'Inspect'], architecture: ['API', 'Gateway'], treemap: ['Alpha', 'Renamed'], ishikawa: ['Review', 'Inspect'],
}
function replaceAuthored<T>(value: T, from: string, to: string): T {
  if (typeof value === 'string') return value.replaceAll(from, to) as T
  if (Array.isArray(value)) return value.map(item => replaceAuthored(item, from, to)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replaceAll(from, to), replaceAuthored(item, from, to)])) as T
  return value
}
const basicFacts: Record<string, MeaningExpectation> = {
  timeline: { labels: [], facts: { title: 'Delivery', periods: [{ section: '', label: '2026', events: ['Launch', 'Review'] }] } },
  journey: { labels: [], facts: { title: 'Delivery', tasks: [{ section: 'Plan', label: 'Review', score: 4, actors: ['Builder'] }] } },
  xychart: { labels: [], facts: { title: 'Series', 'x-categories': ['One', 'Two', 'Three'], 'y-range': [0, 10], series: [{ kind: 'bar', values: [3, 7, 5] }, { kind: 'line', values: [2, 6, 4] }] } },
  pie: { labels: [], facts: { title: 'Shares', slices: [{ label: 'Alpha', value: 7 }, { label: 'Beta', value: 3 }], 'show-data': false } },
  quadrant: { labels: [], unorderedFacts: ['points'], facts: { points: [{ label: 'Alpha', x: .2, y: .8 }, { label: 'Beta', x: .8, y: .2 }], 'axis-labels': ['Low effort', 'High effort', 'Low value', 'High value'] } },
  gantt: { labels: [], facts: { title: 'Delivery', tasks: [{ id: 'taskAlpha', label: 'Design', section: 'Build', start: '2026-01-01', end: '2d', tags: [] }, { id: 'taskBeta', label: 'Review', section: 'Build', start: 'after taskAlpha', end: '3d', tags: [] }] } },
  gitgraph: { labels: [], nodes: nodes('Alpha', 'Beta', 'Gamma'), edges: [relation('Alpha', 'Beta'), relation('Alpha', 'Gamma'), relation('Beta', 'Gamma')], facts: { commits: [{ id: 'Alpha', parents: [], branch: 'main', tags: ['v1'] }, { id: 'Beta', parents: ['Alpha'], branch: 'feature', tags: [] }, { id: 'Gamma', parents: ['Alpha', 'Beta'], branch: 'main', tags: [] }], branches: ['feature', 'main'] } },
  radar: { labels: [], facts: { title: 'Skills', axes: [{ id: 'speed', label: 'Speed' }, { id: 'power', label: 'Power' }, { id: 'range', label: 'Range' }], curves: [{ id: 'now', label: 'Current', values: [3, 4, 2] }], range: [0, 5] } },
  packet: { labels: [], facts: { fields: [{ label: 'Header', start: 0, end: 7 }, { label: 'Payload', start: 8, end: 15 }] } },
  kanban: { labels: [], nodes: [{ id: 'TaskA', label: 'Build' }, { id: 'TaskB', label: 'Test' }], groups: [{ id: 'backlog', label: 'Backlog', members: ['TaskA'] }, { id: 'done', label: 'Done', members: ['TaskB'] }] },
  requirement: { labels: [], nodes: nodes('reliable', 'suite'), edges: [relation('suite', 'reliable', 'verifies')], facts: { requirements: [{ name: 'reliable', type: 'requirement', id: 'R1', text: 'Requests retain meaning', risk: 'high', verify: 'test' }], elements: [{ name: 'suite', type: 'test', docRef: '' }] } },
  treemap: { labels: [], unorderedFacts: ['values'], nodes: [{ id: 'Root', label: 'Root' }, { id: 'Root/Alpha', label: 'Alpha' }, { id: 'Root/Beta', label: 'Beta' }], edges: [relation('Root', 'Root/Alpha'), relation('Root', 'Root/Beta')], groups: [{ id: 'Root', label: 'Root', members: ['Root/Alpha', 'Root/Beta'] }], facts: { values: [{ id: 'Root/Alpha', value: 7 }, { id: 'Root/Beta', value: 3 }] } },
  ishikawa: { labels: [], nodes: [{ id: 'Delay', label: 'Delay' }, { id: 'Delay/Process', label: 'Process' }, { id: 'Delay/Process/Review', label: 'Review' }, { id: 'Delay/Tooling', label: 'Tooling' }, { id: 'Delay/Tooling/Build', label: 'Build' }], edges: [relation('Delay', 'Delay/Process'), relation('Delay/Process', 'Delay/Process/Review'), relation('Delay', 'Delay/Tooling'), relation('Delay/Tooling', 'Delay/Tooling/Build')] },
  mindmap: { labels: [], nodes: [{ id: 'root', label: 'Root' }, ...nodes('Alpha', 'Beta', 'Gamma')], edges: [relation('root', 'Alpha'), relation('Alpha', 'Beta'), relation('root', 'Gamma')] },
  block: { labels: [], nodes: nodes('Alpha', 'Beta'), edges: [relation('Alpha', 'Beta')], facts: { columns: 2 } },
}

const authored: Array<Omit<AuthoredFidelityCase, 'required' | 'provenance'>> = [
  {
    id: 'features:flowchart:nesting-parallel-unicode', family: 'flowchart', features: ['nested-groups', 'parallel-edges', 'reciprocal-edges', 'unicode-labels', 'relationship-labels'],
    source: 'flowchart TB\nsubgraph Outer[Outer group]\nsubgraph Inner[Inner group]\nA["工程"]\nB[Beta]\nend\nC[Gamma]\nend\nA -->|send| B\nA -->|again| B\nB -->|reply| A\nB -->|finish| C',
    expected: { labels: ['Outer group', 'Inner group', '工程', 'Beta', 'Gamma', 'send', 'again', 'reply', 'finish'], nodes: [{ id: 'A', label: '工程' }, { id: 'B', label: 'Beta' }, { id: 'C', label: 'Gamma' }], edges: [relation('A', 'B', 'send'), relation('A', 'B', 'again'), relation('B', 'A', 'reply'), relation('B', 'C', 'finish')], groups: [{ id: 'Outer', label: 'Outer group', members: ['Inner', 'C'] }, { id: 'Inner', label: 'Inner group', members: ['A', 'B'] }], facts: { direction: 'TB' } },
  },
  {
    id: 'features:flowchart:two-ended-and-undirected', family: 'flowchart', features: ['two-ended-arrows', 'undirected-edge', 'marker-ownership'],
    source: 'flowchart LR\nA[Alpha] <--> B[Beta]\nB --- C[Gamma]',
    expected: { labels: ['Alpha', 'Beta', 'Gamma'], nodes: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }, { id: 'C', label: 'Gamma' }], edges: [{ ...relation('A', 'B'), startMarker: 'arrow', endMarker: 'arrow' }, { ...relation('B', 'C', '', false), startMarker: 'none', endMarker: 'none' }] },
  },
  {
    id: 'features:sequence:notes-loop-reciprocal', family: 'sequence', features: ['aliases', 'message-order', 'reply-style', 'notes', 'loop-fragment'],
    source: 'sequenceDiagram\nparticipant A as Alpha\nparticipant B as Beta\nNote over A,B: Keep ownership\nloop Retry\nA->>B: Request\nB-->>A: Reply\nend\nA->>B: Finish',
    expected: { labels: ['Alpha', 'Beta', 'Keep ownership', 'Retry', 'Request', 'Reply', 'Finish'], nodes: [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }], edges: [relation('A', 'B', 'Request'), relation('B', 'A', 'Reply'), relation('A', 'B', 'Finish')], facts: { 'message-order': [{ from: 'A', to: 'B', text: 'Request' }, { from: 'B', to: 'A', text: 'Reply' }, { from: 'A', to: 'B', text: 'Finish' }], 'message-style': ['->>', '-->>', '->>'], notes: [{ text: 'Keep ownership', actors: ['A', 'B'] }], fragments: [{ kind: 'loop', label: 'Retry' }] } },
  },
  {
    id: 'features:class:namespace-members-cardinality', family: 'class', features: ['namespace', 'members', 'methods', 'cardinality', 'notes'],
    source: 'classDiagram\nnamespace Domain {\nclass User {\n+String name\n+save() bool\n}\nclass Store\n}\nUser "1" --> "*" Store : owns\nnote for User "Keep ownership"',
    expected: { labels: ['Domain', 'User', 'Store', 'name', 'save', 'owns', 'Keep ownership'], nodes: nodes('User', 'Store'), edges: [relation('User', 'Store', 'owns')], groups: [{ id: 'Domain', label: 'Domain', members: ['User', 'Store'] }], facts: { members: [{ id: 'Store', values: [] }, { id: 'User', values: ['+String name', '+save() bool'] }], notes: [{ target: 'User', text: 'Keep ownership' }], cardinalities: [{ from: 'User', to: 'Store', left: '1', right: '*' }] } },
  },
  {
    id: 'features:class:inheritance-composition-dependency', family: 'class', features: ['inheritance', 'composition', 'dependency', 'marker-ownership'],
    source: 'classDiagram\nAnimal <|-- Dog\nDog *-- Collar\nDog ..> Food : eats',
    expected: { labels: ['Animal', 'Dog', 'Collar', 'Food', 'eats'], nodes: nodes('Animal', 'Dog', 'Collar', 'Food'), edges: [{ ...relation('Animal', 'Dog'), startMarker: 'triangle', endMarker: 'none' }, { ...relation('Dog', 'Collar', '', false), startMarker: 'diamond', endMarker: 'none' }, { ...relation('Dog', 'Food', 'eats'), startMarker: 'none', endMarker: 'arrow' }] },
  },
  {
    id: 'features:state:nesting-reciprocal-alias', family: 'state', features: ['composite-state', 'aliases', 'reciprocal-transitions', 'transition-labels'],
    source: 'stateDiagram-v2\nstate Active {\nstate "Waiting" as Idle\nIdle --> Busy: begin\nBusy --> Idle: reset\n}\nActive --> Done: finish',
    expected: { labels: ['Active', 'Waiting', 'Busy', 'Done', 'begin', 'reset', 'finish'], nodes: [{ id: 'Active', label: 'Active' }, { id: 'Idle', label: 'Waiting' }, { id: 'Busy', label: 'Busy' }, { id: 'Done', label: 'Done' }], edges: [relation('Idle', 'Busy', 'begin'), relation('Busy', 'Idle', 'reset'), relation('Active', 'Done', 'finish')], groups: [{ id: 'Active', label: 'Active', members: ['Idle', 'Busy'] }] },
  },
  {
    id: 'features:state:initial-final-pseudostates', family: 'state', features: ['initial-state', 'final-state', 'contextual-identities'],
    source: 'stateDiagram-v2\n[*] --> Idle\nIdle --> Done: finish\nDone --> [*]',
    expected: { labels: ['Idle', 'Done', 'finish'], nodes: [...nodes('Idle', 'Done'), { id: '[start:root]', label: '' }, { id: '[end:root]', label: '' }], edges: [relation('[start:root]', 'Idle'), relation('Idle', 'Done', 'finish'), relation('Done', '[end:root]')], facts: { pseudostates: [{ id: '[end:root]', kind: 'end', scope: 'root' }, { id: '[start:root]', kind: 'start', scope: 'root' }] } },
  },
  {
    id: 'features:er:attributes-identifying-cardinality', family: 'er', features: ['attributes', 'keys', 'cardinality', 'nonidentifying-relationship'],
    source: 'erDiagram\nUSER {\nstring name PK\nint age\n}\nORDER {\nint id PK\n}\nUSER ||--o{ ORDER : places\nORDER }o..|| ITEM : contains',
    expected: { labels: ['USER', 'ORDER', 'ITEM', 'name', 'age', 'places', 'contains'], nodes: nodes('USER', 'ORDER', 'ITEM'), edges: [relation('USER', 'ORDER', 'places', false), relation('ORDER', 'ITEM', 'contains', false)], facts: { attributes: [{ id: 'ITEM', values: [] }, { id: 'ORDER', values: [{ name: 'id', type: 'int', keys: ['PK'] }] }, { id: 'USER', values: [{ name: 'name', type: 'string', keys: ['PK'] }, { name: 'age', type: 'int', keys: [] }] }], cardinalities: [{ from: 'USER', to: 'ORDER', left: 'one-only', right: 'zero-or-many', identifying: true }, { from: 'ORDER', to: 'ITEM', left: 'zero-or-many', right: 'one-only', identifying: false }] } },
  },
  {
    id: 'features:journey:sections-scores-actors', family: 'journey', features: ['sections', 'numeric-scores', 'multiple-actors', 'task-order'],
    source: 'journey\ntitle Delivery\nsection Plan\nReview: 4: Builder,Reviewer\nsection Ship\nDeploy: 2: Builder',
    expected: { labels: ['Delivery', 'Plan', 'Ship', 'Review', 'Deploy', 'Builder', 'Reviewer'], facts: { title: 'Delivery', tasks: [{ section: 'Plan', label: 'Review', score: 4, actors: ['Builder', 'Reviewer'] }, { section: 'Ship', label: 'Deploy', score: 2, actors: ['Builder'] }] } },
  },
  {
    id: 'features:gantt:dependency-tags-milestone', family: 'gantt', features: ['dependencies', 'critical-task', 'duration', 'milestone', 'sections'],
    source: 'gantt\ntitle Delivery\ndateFormat YYYY-MM-DD\ntodayMarker off\nsection Build\nDesign :crit, design, 2026-01-01, 2d\nReview :active, review, after design, 3d\nsection Ship\nRelease :milestone, release, after review, 0d',
    expected: { labels: ['Delivery', 'Build', 'Ship', 'Design', 'Review', 'Release'], facts: { title: 'Delivery', tasks: [{ id: 'design', label: 'Design', section: 'Build', start: '2026-01-01', end: '2d', tags: ['crit'] }, { id: 'review', label: 'Review', section: 'Build', start: 'after design', end: '3d', tags: ['active'] }, { id: 'release', label: 'Release', section: 'Ship', start: 'after review', end: '0d', tags: ['milestone'] }] } },
  },
  {
    id: 'features:pie:fractions-show-data', family: 'pie', features: ['fractional-values', 'show-data', 'unicode-labels'],
    source: 'pie showData\ntitle Allocation\n"工程" : 2.5\n"Review" : 7.5',
    expected: { labels: ['Allocation', '工程', 'Review'], facts: { title: 'Allocation', 'show-data': true, slices: [{ label: '工程', value: 2.5 }, { label: 'Review', value: 7.5 }] } },
  },
  {
    id: 'features:quadrant:boundary-and-interior-points', family: 'quadrant', features: ['axis-labels', 'normalized-data', 'boundary-points', 'interior-points'],
    source: 'quadrantChart\nx-axis Low --> High\ny-axis Low value --> High value\nAlpha: [0, 1]\nBeta: [1, 0]\nGamma: [0.25, 0.75]',
    expected: { labels: ['Alpha', 'Beta', 'Gamma', 'Low', 'High', 'Low value', 'High value'], facts: { points: [{ label: 'Alpha', x: 0, y: 1 }, { label: 'Beta', x: 1, y: 0 }, { label: 'Gamma', x: .25, y: .75 }], 'axis-labels': ['Low', 'High', 'Low value', 'High value'] } },
  },
  {
    id: 'features:requirement:types-risk-relations', family: 'requirement', features: ['requirement-fields', 'element-document', 'relationship-type', 'multiple-relationships'],
    source: 'requirementDiagram\nrequirement reliable {\nid: R1\ntext: Keep every request\nrisk: high\nverifymethod: test\n}\nfunctionalRequirement fast {\nid: R2\ntext: Return promptly\nrisk: medium\nverifymethod: analysis\n}\nelement suite {\ntype: "test"\ndocref: "tests.md"\n}\nsuite - verifies -> reliable\nfast - refines -> reliable',
    expected: { labels: ['reliable', 'fast', 'suite', 'Keep every request', 'Return promptly'], nodes: nodes('reliable', 'fast', 'suite'), edges: [relation('suite', 'reliable', 'verifies'), relation('fast', 'reliable', 'refines')], facts: { requirements: [{ name: 'fast', type: 'functionalrequirement', id: 'R2', text: 'Return promptly', risk: 'medium', verify: 'analysis' }, { name: 'reliable', type: 'requirement', id: 'R1', text: 'Keep every request', risk: 'high', verify: 'test' }], elements: [{ name: 'suite', type: 'test', docRef: 'tests.md' }] } },
  },
  {
    id: 'features:gitgraph:merge-parents-tags-branch', family: 'gitgraph', features: ['branch-identity', 'merge-parent-order', 'tags', 'commit-order'],
    source: 'gitGraph\ncommit id:"Base" tag:"v1"\nbranch work\ncommit id:"Change"\ncheckout main\ncommit id:"Parallel"\nmerge work id:"Merge" tag:"v2"',
    expected: { labels: ['Base', 'Change', 'Parallel', 'Merge', 'v1', 'v2'], nodes: nodes('Base', 'Change', 'Parallel', 'Merge'), edges: [relation('Base', 'Change'), relation('Base', 'Parallel'), relation('Parallel', 'Merge'), relation('Change', 'Merge')], facts: { branches: ['main', 'work'], commits: [{ id: 'Base', parents: [], branch: 'main', tags: ['v1'] }, { id: 'Change', parents: ['Base'], branch: 'work', tags: [] }, { id: 'Parallel', parents: ['Base'], branch: 'main', tags: [] }, { id: 'Merge', parents: ['Parallel', 'Change'], branch: 'main', tags: ['v2'] }] } },
  },
  {
    id: 'features:mindmap:depth-shapes-and-siblings', family: 'mindmap', features: ['hierarchy-depth', 'sibling-order', 'explicit-identities', 'shape-labels'],
    source: 'mindmap\nroot((Project))\n  build[Build]\n    test(Test)\n  ship[Ship]',
    expected: { labels: ['Project', 'Build', 'Test', 'Ship'], nodes: [{ id: 'root', label: 'Project' }, { id: 'build', label: 'Build' }, { id: 'test', label: 'Test' }, { id: 'ship', label: 'Ship' }], edges: [relation('root', 'build'), relation('build', 'test'), relation('root', 'ship')], groups: [{ id: 'root', label: 'Project', members: ['build', 'ship'] }, { id: 'build', label: 'Build', members: ['test'] }], facts: { 'tree-order': ['root', 'build', 'test', 'ship'] } },
  },
  {
    id: 'features:sankey:weighted-branching', family: 'sankey', features: ['weighted-links', 'branching', 'shared-endpoint-identities'],
    source: 'sankey-beta\nInput,Build,8\nInput,Review,2\nBuild,Output,8\nReview,Output,2',
    expected: { labels: ['Input', 'Build', 'Review', 'Output'], nodes: nodes('Input', 'Build', 'Review', 'Output'), edges: [relation('Input', 'Build'), relation('Input', 'Review'), relation('Build', 'Output'), relation('Review', 'Output')], facts: { links: [{ source: 'Input', target: 'Build', value: 8 }, { source: 'Input', target: 'Review', value: 2 }, { source: 'Build', target: 'Output', value: 8 }, { source: 'Review', target: 'Output', value: 2 }] } },
  },
  {
    id: 'features:xychart:negative-mixed-series', family: 'xychart', features: ['negative-values', 'mixed-series', 'axis-range', 'category-order'],
    source: 'xychart-beta\ntitle "Delta"\nx-axis [One, Two, Three]\ny-axis "Change" -5 --> 10\nbar [-3, 7, 0]\nline [2, -1, 4]',
    expected: { labels: ['Delta', 'One', 'Two', 'Three', 'Change'], facts: { title: 'Delta', 'x-categories': ['One', 'Two', 'Three'], 'y-range': [-5, 10], series: [{ kind: 'bar', values: [-3, 7, 0] }, { kind: 'line', values: [2, -1, 4] }] } },
  },
  {
    id: 'features:block:composite-membership', family: 'block', features: ['composite-block', 'spanning-columns', 'internal-and-external-edges'],
    source: 'block\ncolumns 2\nblock:Group:2\ncolumns 2\nA["Alpha"] B["Beta"]\nA --> B\nend\nC["Gamma"]\nB --> C',
    expected: { labels: ['Alpha', 'Beta', 'Gamma'], nodes: [{ id: 'Group', label: '' }, { id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }, { id: 'C', label: 'Gamma' }], edges: [relation('A', 'B'), relation('B', 'C')], groups: [{ id: 'Group', label: '', members: ['A', 'B'] }], facts: { columns: 2, spans: [{ id: 'A', columns: 1 }, { id: 'B', columns: 1 }, { id: 'C', columns: 1 }, { id: 'Group', columns: 2 }] } },
  },
  {
    id: 'features:packet:offsets-widths-multiline', family: 'packet', features: ['bit-offsets', 'field-widths', 'multiple-rows'],
    source: 'packet\n0-3: "Version"\n4-7: "Flags"\n8-31: "Payload"\n32-63: "Checksum"',
    expected: { labels: ['Version', 'Flags', 'Payload', 'Checksum'], facts: { fields: [{ label: 'Version', start: 0, end: 3 }, { label: 'Flags', start: 4, end: 7 }, { label: 'Payload', start: 8, end: 31 }, { label: 'Checksum', start: 32, end: 63 }] } },
  },
  {
    id: 'features:kanban:membership-and-metadata', family: 'kanban', features: ['column-membership', 'task-identities', 'assignment', 'priority'],
    source: 'kanban\nbacklog[Backlog]\n  TaskA[Build]@{ assigned: "Alice", priority: "High" }\n  TaskB[Review]\ndone[Done]\n  TaskC[Ship]',
    expected: { labels: ['Backlog', 'Build', 'Review', 'Done', 'Ship'], nodes: [{ id: 'TaskA', label: 'Build' }, { id: 'TaskB', label: 'Review' }, { id: 'TaskC', label: 'Ship' }], groups: [{ id: 'backlog', label: 'Backlog', members: ['TaskA', 'TaskB'] }, { id: 'done', label: 'Done', members: ['TaskC'] }], facts: { metadata: [{ id: 'TaskA', assigned: 'Alice', priority: 'High', ticket: '' }, { id: 'TaskB', assigned: '', priority: '', ticket: '' }, { id: 'TaskC', assigned: '', priority: '', ticket: '' }] } },
  },
  {
    id: 'features:architecture:ports-groups-branching', family: 'architecture', features: ['group-membership', 'service-icons', 'edge-direction', 'endpoint-ports'],
    source: 'architecture-beta\ngroup app(cloud)[Application]\nservice api(server)[API] in app\nservice db(database)[Database] in app\nservice cache(disk)[Cache] in app\napi:R --> L:db\napi:B --> T:cache',
    expected: { labels: ['Application', 'API', 'Database', 'Cache'], nodes: [{ id: 'api', label: 'API' }, { id: 'db', label: 'Database' }, { id: 'cache', label: 'Cache' }], edges: [relation('api', 'db'), relation('api', 'cache')], groups: [{ id: 'app', label: 'Application', members: ['api', 'db', 'cache'] }], facts: { ports: [{ from: 'api', to: 'db', fromSide: 'R', toSide: 'L' }, { from: 'api', to: 'cache', fromSide: 'B', toSide: 'T' }], icons: [{ id: 'api', icon: 'server' }, { id: 'cache', icon: 'disk' }, { id: 'db', icon: 'database' }] } },
  },
  {
    id: 'features:treemap:hierarchy-weight-and-identity', family: 'treemap', features: ['nested-membership', 'leaf-weights', 'sibling-identity'],
    source: 'treemap\n"Root"\n  "Build"\n    "Alpha": 7\n    "Beta": 3\n  "Ship": 2',
    expected: { labels: ['Root', 'Build', 'Alpha', 'Beta', 'Ship'], nodes: [{ id: 'Root', label: 'Root' }, { id: 'Root/Build', label: 'Build' }, { id: 'Root/Build/Alpha', label: 'Alpha' }, { id: 'Root/Build/Beta', label: 'Beta' }, { id: 'Root/Ship', label: 'Ship' }], edges: [relation('Root', 'Root/Build'), relation('Root/Build', 'Root/Build/Alpha'), relation('Root/Build', 'Root/Build/Beta'), relation('Root', 'Root/Ship')], groups: [{ id: 'Root', label: 'Root', members: ['Root/Build', 'Root/Ship'] }, { id: 'Root/Build', label: 'Build', members: ['Root/Build/Alpha', 'Root/Build/Beta'] }], facts: { values: [{ id: 'Root/Build/Alpha', value: 7 }, { id: 'Root/Build/Beta', value: 3 }, { id: 'Root/Ship', value: 2 }] } },
  },
  {
    id: 'features:ishikawa:deep-cause-ownership', family: 'ishikawa', features: ['cause-hierarchy', 'depth', 'sibling-ownership'],
    source: 'ishikawa\n  Delay\n  People\n    Review\n      Context\n  Tools\n    Build',
    expected: { labels: ['Delay', 'People', 'Review', 'Context', 'Tools', 'Build'], nodes: [{ id: 'Delay', label: 'Delay' }, { id: 'Delay/People', label: 'People' }, { id: 'Delay/People/Review', label: 'Review' }, { id: 'Delay/People/Review/Context', label: 'Context' }, { id: 'Delay/Tools', label: 'Tools' }, { id: 'Delay/Tools/Build', label: 'Build' }], edges: [relation('Delay', 'Delay/People'), relation('Delay/People', 'Delay/People/Review'), relation('Delay/People/Review', 'Delay/People/Review/Context'), relation('Delay', 'Delay/Tools'), relation('Delay/Tools', 'Delay/Tools/Build')] },
  },
]

/** Both the complete expected values and source are authored before executing a target. */
export function fidelityCases(): AuthoredFidelityCase[] {
  const basics = portableCases(['family']).map(testCase => {
    const declared = basicFacts[testCase.family]
    let expected: MeaningExpectation = { labels: [...testCase.expected.labels] }
    if (declared) expected = { ...declared, labels: [...testCase.expected.labels] }
    else if (testCase.expected.topology) {
      const topology = testCase.expected.topology
      expected.nodes = topology.nodes.map(id => ({ id, label: topology.nodeLabels?.[id] ?? id }))
      expected.edges = topology.edges.map(item => ({ source: item.source, target: item.target, directed: testCase.family !== 'er' }))
      if (topology.groups) expected.groups = topology.groups.map(group => ({ ...group, label: group.id }))
    }
    // Aliases in these authored representatives belong to their identities.
    if (testCase.family === 'sequence') expected.nodes = [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }]
    if (testCase.family === 'state') expected.nodes = [{ id: 'A', label: 'Alpha' }, { id: 'B', label: 'Beta' }]
    if (testCase.family === 'architecture') { expected.nodes = [{ id: 'api', label: 'API' }, { id: 'db', label: 'Data' }]; expected.groups = [{ id: 'app', label: 'App', members: ['api', 'db'] }] }
    if (testCase.family === 'c4') expected.nodes = [{ id: 'user', label: 'User' }, { id: 'api', label: 'API' }]
    return { id: 'meaning:' + testCase.id, family: testCase.family, required: required(testCase.family), source: testCase.source, features: ['family-representative', ...(expected.nodes ? ['identity-label-binding'] : []), ...(expected.edges ? ['endpoint-multiplicity'] : []), ...(expected.facts ? ['native-content'] : [])], provenance: 'Original independent portable literal, supplemented with reviewed canonical semantic expectations', expected }
  })
  const variants = authored.map(testCase => ({ ...testCase, required: required(testCase.family), provenance: 'Independent authored intersecting-feature contract; no implementation supplied expected values' }))
  // These documented diagrams remain required while maturity/addon evidence is reviewed.
  const pending: AuthoredFidelityCase[] = [
    { id: 'meaning:required:eventmodeling', family: 'eventmodeling', required: true, source: 'eventmodeling\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded', features: ['documented-required-pending-maturity-review', 'ordered-modeling-frames', 'frame-relationships'], provenance: 'Pinned public Event Modeling example; issue #501 records native-product gap', expected: { labels: ['CartUI', 'AddItem', 'ItemAdded'], nodes: [{ id: '01', label: 'CartUI' }, { id: '02', label: 'AddItem' }, { id: '03', label: 'ItemAdded' }], edges: [relation('01', '02'), relation('02', '03')], facts: { 'frame-order': ['CartUI', 'AddItem', 'ItemAdded'] } } },
    { id: 'meaning:required:zenuml', family: 'zenuml', required: true, source: 'zenuml\ntitle Demo\nAlice->John: Hello John, how are you?\nJohn->Alice: Great!', features: ['documented-required-pending-maturity-review', 'reciprocal-messages', 'message-order'], provenance: 'Pinned public ZenUML example; issue #502 records addon/native-product requirements', expected: { labels: ['Alice', 'John', 'Hello John, how are you?', 'Great!'], nodes: nodes('Alice', 'John'), edges: [relation('Alice', 'John', 'Hello John, how are you?'), relation('John', 'Alice', 'Great!')], facts: { 'message-order': [{ from: 'Alice', to: 'John', text: 'Hello John, how are you?' }, { from: 'John', to: 'Alice', text: 'Great!' }] } } },
  ]
  const workflows = basics.filter(testCase => testCase.required).map(testCase => ({
    ...testCase,
    id: testCase.id + ':configuration-reset',
    features: [...testCase.features, 'configuration-retains-meaning', 'cross-family-state-reset', 'source-replacement'],
    prelude: [{ source: '---\nconfig:\n  theme: forest\n---\nflowchart LR\nOld[Previous state] --> Other[Other state]', accept: true }],
    // Replacing a prior source is an edit workflow, not a claim that every
    // implementation offers the same typed mutation or serializer API.
    edit: { source: replaceAuthored(testCase.source, ...authoredEdit[testCase.family]!), expected: replaceAuthored(testCase.expected, ...authoredEdit[testCase.family]!) },
    provenance: 'Independent source-replacement workflow; a configured different-family prelude must not leak identities or content into the final public parse',
  }))
  const configuration = portableCases(['adversarial']).find(testCase => testCase.id === 'adversarial:configuration-reset')!
  const styleWorkflow: AuthoredFidelityCase = { id: 'features:flowchart:font-size-reset', family: 'flowchart', required: true, source: configuration.source, features: ['font-size-effect', 'configuration-reset'], provenance: 'Original independent portable configuration-reset literal; actual computed font-size is separately checked by the paint observer', expected: { labels: ['Current', 'Configuration'], nodes: [{ id: 'A', label: 'Current' }, { id: 'B', label: 'Configuration' }], edges: [relation('A', 'B')], facts: { direction: 'TB' } }, prelude: configuration.prelude, renderOptions: { fontSize: 14 }, paint: { fontSize: 14 }, edit: { source: configuration.edit!.source, expected: { labels: ['Current', 'Configuration'], nodes: [{ id: 'A', label: 'Current' }, { id: 'B', label: 'Configuration' }], edges: [relation('A', 'B')], facts: { direction: 'TB' } }, renderOptions: { fontSize: 24 }, paint: { fontSize: 24 } } }
  // Authored one-pixel opaque-red RGBA PNG. It needs no remote server, font,
  // credential, image proxy or generator dependency to remain reproducible.
  const redPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
  const image: AuthoredFidelityCase = { id: 'features:flowchart:controlled-image', family: 'flowchart', required: true, source: `flowchart LR\nArt@{ img: "${redPixel}", label: "Icon", w: 32, h: 32, constraint: "on" }\nArt --> Target[Target]`, features: ['authored-image-presence', 'controlled-asset', 'image-decoding'], provenance: 'Pinned Mermaid image-node grammar with an independent inline opaque-red PNG; native image policy and actual emitted/decode evidence are separate', expected: { labels: ['Icon', 'Target'], nodes: [{ id: 'Art', label: 'Icon' }, { id: 'Target', label: 'Target' }], edges: [relation('Art', 'Target')], facts: { 'image-requests': [{ id: 'Art', href: redPixel }] } }, paint: { images: [{ href: redPixel, count: 1 }] } }
  return [...basics, ...variants, ...workflows, styleWorkflow, image, ...pending]
}

/** The edited source has its own authored expectations; it is never compared
 * with the implementation's previous answer. Preludes remain real operations. */
export function expandedFidelityCases(): AuthoredFidelityCase[] {
  return fidelityCases().flatMap(value => [value, ...(value.edit ? [{ ...value, id: value.id + ':edit', source: value.edit.source, expected: value.edit.expected, renderOptions: value.edit.renderOptions, paint: value.edit.paint, edit: undefined, prelude: [...(value.prelude ?? []), { source: value.source, accept: true, renderOptions: value.renderOptions }] }] : [])])
}
