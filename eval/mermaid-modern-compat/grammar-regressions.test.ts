import { decodeXML } from 'entities'
import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getFamily } from '../../src/agent/core.ts'
import type { DiagramKind } from '../../src/agent/types.ts'
import { inspectAgenticGrammar } from './grammar-agentic.ts'
import { projectReferenceSemantic } from './grammar-native-semantics.ts'
import { startGrammarReference } from './grammar-reference.ts'
import { admitCurrentReference, startModernReference } from './reference.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const upstream = process.env.MERMAID_UPSTREAM_DIR ?? join(root, '../mermaid')
const referenceDir = process.env.MERMAID_REFERENCE_DIR ?? join(root, '../mermaid-reference')
const target = process.env.AM_MODERN_TARGET_DIR ?? root
const admitted = admitCurrentReference(upstream, referenceDir)
const am = (await import(pathToFileURL(join(target, 'src/agent/core.ts')).href)) as typeof import('../../src/agent/core.ts')
const modern = startModernReference(referenceDir)
const grammar = startGrammarReference(referenceDir, upstream)
const results: unknown[] = []

interface Regression {
  name: string
  family: DiagramKind
  source: string
  /** Selected semantic fields whose values must survive this writer fix. */
  fields?: string[]
  groups?: boolean
}

// Reviewed reductions of seed-7 failures from the all-family grammar run.
// Distinct examples exercise different quotation/statement boundaries; this
// is not an inventory of accepted syntax or a generated expected-output file.
const regressions: Regression[] = [
  { name: 'Quadrant single axis keeps a quoted delimiter inside its label', family: 'quadrant', source: 'quadrantChart\nx-axis "Urgent(* +=-->[❤"', fields: ['xAxis'] },
  { name: 'Quadrant separates axes only outside quoted text', family: 'quadrant', source: 'quadrantChart\ny-axis "Ur --> not urgent(* +=[❤" --> "Not Urgent (* +=[❤"', fields: ['yAxis'] },
  { name: 'Quadrant preserves the visible arrow of a trailing axis delimiter', family: 'quadrant', source: 'quadrantChart\nx-axis "Urgent(* x-axis 低い --> 高い y-axis =[❤" -->', fields: ['xAxis'] },
  { name: 'Flowchart anonymous link-like group title writes a safe identity', family: 'flowchart', source: 'graph TD;A-->B;subgraph "title in quotes --xs";c-->d;end;', fields: ['nodes', 'edges'], groups: true },
  { name: 'State reserved endpoint retains its transition label', family: 'state', source: 'stateDiagram-v2\nA --> State: continue', fields: ['states', 'transitions'] },
  { name: 'State descriptions retain literal quotes', family: 'state', source: 'stateDiagram-v2\nnamedState1: Small St"ate 1', fields: ['states'] },
  { name: 'State block notes retain colons as text', family: 'state', source: 'stateDiagram-v2\nState1\nnote right of State1\nfill:white    a note with punctuation\nend note\nState1 --> State2', fields: ['states', 'transitions'] },
  { name: 'State classed transition retains a following independent state', family: 'state', source: 'stateDiagram-v2\nMoving --> Crash:::mov pinnedement', fields: ['states', 'transitions'] },
  { name: 'Class inline members retain literal braces', family: 'class', source: 'classDiagram\nclass A\nA : String map{key}\nA : +run() Result}\nA : {literal', fields: ['classes'] },
  { name: 'Class namespace membership survives literal brace-bearing members', family: 'class', source: 'classDiagram\nnamespace N {\nclass A\n}\nA : String map{key}\nA : +run() Result}\nA : {literal', fields: ['classes', 'namespaces'] },
  { name: 'Class member text before a closing brace retains the following declaration', family: 'class', source: 'classDiagram\nnamespace N {\nclass A {\n+foo : string\nTriangle }\nclass B {\n+bar : int\n}\n}\nA --> B', fields: ['classes', 'namespaces', 'relationships'] },
  { name: 'Class mixes block-only colon members with inline literal braces', family: 'class', source: 'classDiagram\nnamespace N["Domain"] {\nclass A~T~["Display"] {\n<<interface>>\n+foo : string\n}\n}\nA : String map{key}\nclass A {\n+bar : int\n}\nA : +run() Result}\nclass A {\n+last : bool\n}', fields: ['classes', 'namespaces'] },
  { name: 'XY axis titles retain digits as text', family: 'xychart', source: 'xychart\nx-axis "Dap50te" [A]\nbar [1]', fields: ['xAxis', 'series'] },
  { name: 'Gantt colon metadata retains lexical separation', family: 'gantt', source: 'gantt\nTask : %H:%M' },
  { name: 'Mindmap preserves rounded label with another opener', family: 'mindmap', source: 'mindmap\n  (r[oot)', fields: ['root'] },
  { name: 'Mindmap preserves rounded label with a hexagon opener', family: 'mindmap', source: 'mindmap\n  (r{{oot)', fields: ['root'] },
  { name: 'Mindmap preserves anonymous cloud label', family: 'mindmap', source: 'mindmap\n  (Cloud))', fields: ['root'] },
  { name: 'Mindmap preserves literal comment marker inside a shaped label', family: 'mindmap', source: 'mindmap\n  node[Keep %% literal]', fields: ['root'] },
  { name: 'Mindmap preserves cloud label containing literal unmatched quotes', family: 'mindmap', source: 'mindmap\n  id)I am ["quoted(', fields: ['root'] },
]

for (const witness of regressions)
  test(witness.name, async () => {
    const before = await modern.parse(witness.source)
    expect(before.ok).toBe(true)
    const parsed = am.parseRegisteredMermaid(witness.source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.kind).toBe(witness.family)
    const serialized = am.serializeMermaid(parsed.value)
    const after = await modern.parse(serialized)
    results.push({ ...witness, serialized, before, after })
    expect(after.ok).toBe(true)
    if (before.ok && after.ok) expect(after.type).toBe(before.type)

    if (witness.fields?.length) {
      await grammar.prepare(witness.family, getFamily(witness.family)!.example)
      const original = await grammar.parse(witness.family, witness.source)
      const written = await grammar.parse(witness.family, serialized)
      const expected = projectReferenceSemantic(witness.family, original)?.value as Record<string, unknown> | undefined
      const actual = projectReferenceSemantic(witness.family, written)?.value as Record<string, unknown> | undefined
      const native = inspectAgenticGrammar(witness.family, witness.source).native.observation.semantic?.value as Record<string, unknown> | undefined
      expect(expected).toBeDefined()
      expect(actual).toBeDefined()
      if (target === root) expect(native).toBeDefined()
      for (const field of witness.fields) {
        expect(actual?.[field]).toEqual(expected?.[field])
        if (target === root) expect(native?.[field]).toEqual(expected?.[field])
      }
      if (witness.groups) {
        for (const value of [actual!, ...(target === root ? [native!] : [])]) expect(groupMeaning(value)).toEqual(groupMeaning(expected!))
      }
    }
  })

function groupMeaning(value: Record<string, unknown>) {
  const groups = value.groups as Array<{ id: string; parent: string; label: string; members: string[] }>
  expect(new Set(groups.map(group => group.id)).size).toBe(groups.length)
  // The reference stores #entity; labels in Mermaid's internal placeholder
  // spelling (utils.decodeEntities); compare their decoded authored text.
  const displayed = (label: string) => decodeXML(label.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';'))
  return groups.map(group => ({ label: displayed(group.label), parent: group.parent, members: group.members })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

test('Mindmap anonymous multiline Markdown retains identities, formatting and child membership', async () => {
  const source = `mindmap
    ["\`**Root** with
a second line
Unicode works too: 🤓\`"]
      id2["\`The dog in **the** hog... a *very long text* that wraps to a new line\`"]
      id3[Rgular labels still works]`
  const before = await modern.parse(source)
  expect(before.ok).toBe(true)
  const parsed = am.parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const serialized = am.serializeMermaid(parsed.value)
  const after = await modern.parse(serialized)
  expect(after).toMatchObject({ ok: true, type: 'mindmap' })
  await grammar.prepare('mindmap', getFamily('mindmap')!.example)
  const original = await grammar.parse('mindmap', source)
  const written = await grammar.parse('mindmap', serialized)
  expect(original.accepted).toBe(true)
  expect(written.accepted).toBe(true)
  const expected = projectReferenceSemantic('mindmap', original)!.value as Record<string, unknown>
  const actual = projectReferenceSemantic('mindmap', written)!.value as Record<string, unknown>
  expect(actual.root).toEqual(expected.root)
  if (target === root) {
    const native = inspectAgenticGrammar('mindmap', source).native.observation.semantic!.value as Record<string, unknown>
    const reparsed = inspectAgenticGrammar('mindmap', serialized).native.observation.semantic!.value as Record<string, unknown>
    expect(reparsed.root).toEqual(native.root)
    // Mermaid retains formatting in an anonymous identity; ours uses its
    // plain label. Each parser must keep its identities and parents,
    // while both retain the same labelled tree and explicit child identities.
    const meaning = (value: unknown, parent = '', ids = new Set<string>()): unknown => {
      const node = value as { id: string; parent: string; label: string; shape: string; icon: string; classes: string[]; children: unknown[] }
      expect(node.parent).toBe(parent)
      expect(ids.has(node.id)).toBe(false)
      ids.add(node.id)
      return {
        ...(parent ? { id: node.id } : {}),
        label: node.label.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**').replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*'),
        shape: node.shape, icon: node.icon, classes: node.classes,
        children: node.children.map(child => meaning(child, node.id, ids)),
      }
    }
    expect(meaning(native.root)).toEqual(meaning(expected.root))
  }
  results.push({ name: 'Mindmap anonymous multiline Markdown', family: 'mindmap', source, serialized, before, after, original, written })
})

test.each([
  'flowchart TD\nA_B_2[Important]\nsubgraph A_B[Explicit]\nC\nend\nsubgraph "A--B"\nD\nend',
  'flowchart TD\nsubgraph "A<br>B"\nX\nend\nsubgraph "A\\nB"\nY\nend',
  'flowchart TD\nsubgraph "A--B"\nX\nend\nsubgraph "A#45;#45;B"\nY\nend',
])('Flowchart distinct group identities retain labels and membership: %s', async source => {
  const parsed = am.parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const serialized = am.serializeMermaid(parsed.value)
  await grammar.prepare('flowchart', getFamily('flowchart')!.example)
  const original = await grammar.parse('flowchart', source)
  const written = await grammar.parse('flowchart', serialized)
  expect(original.accepted).toBe(true)
  expect(written.accepted).toBe(true)
  const expected = projectReferenceSemantic('flowchart', original)!.value as Record<string, unknown>
  const actual = projectReferenceSemantic('flowchart', written)!.value as Record<string, unknown>
  // Derived names may differ; distinct authored frames and their membership
  // must survive. The explicit group and node retain their original names.
  expect(groupMeaning(actual)).toEqual(groupMeaning(expected))
  expect(actual.nodes).toEqual(expected.nodes)
  if (source.includes('subgraph A_B[')) expect(actual.groups).toContainEqual(expect.objectContaining({ id: 'A_B', label: 'Explicit', members: ['C'] }))
  const native = inspectAgenticGrammar('flowchart', source).native.observation.semantic!.value as Record<string, unknown>
  expect(groupMeaning(native)).toEqual(groupMeaning(expected))
  expect(native.nodes).toEqual(expected.nodes)
  results.push({ name: 'Flowchart derived identity collisions', family: 'flowchart', source, serialized, original, written })
})

// Generous reads and valid neighboring forms need a public-parser writer oracle:
// reparsing with our reader alone would accept the same invalid output again.
const generousWriters = [
  { name: 'C4 bare final label', source: 'C4Context\nSystem(s,b)', expected: { getC4ShapeArray: [{ alias: 's', label: { text: 'b' } }] } },
  { name: 'C4 literal dollar label', source: 'C4Context\nPerson(c,$)', expected: { getC4ShapeArray: [{ alias: 'c', label: { text: '$' } }] } },
  { name: 'C4 comma-delimited dollar text', source: 'C4Context\nSystem(s,cost $currency=GBP,"description")', expected: { getC4ShapeArray: [{ alias: 's', label: { text: 'cost $currency=GBP' }, descr: { text: 'description' } }] } },
  { name: 'ER numeric entity after an empty block', source: 'erDiagram\nu{}1\nR', expected: { getEntities: [['1', { label: '1' }], ['R', { label: 'R' }], ['u', { label: 'u' }]], getRelationships: [] } },
  { name: 'Journey literal unknown entity', source: 'journey\ns:3:&mp;', expected: { getTasks: [{ task: 's', score: 3, people: ['&mp;'] }] } },
  { name: 'Journey encoded comment and actor delimiter remain text', source: 'journey\n&#37;&#37;Task: 3: A&#44;B', expected: { getTasks: [{ task: '%%Task', score: 3, people: ['A,B'] }] } },
  { name: 'Journey encoded keyword remains task text', source: 'journey\n&#116;itle T: 3: Alice', expected: { getTasks: [{ task: 'title T', score: 3, people: ['Alice'] }], getDiagramTitle: '' } },
  { name: 'Timeline escaped break cannot introduce a section', source: 'timeline\nsection<br>A : event', expected: { getSections: [], getTasks: [{ task: 'section<br>A ', events: ['event'], section: '' }] } },
  { name: 'Flowchart style token text remains literal across directives', source: 'flowchart TD\nA-->B\nstyle A stroke\\-width:2px,accTitle-color:red\nclassDef c font\\2d family:Arial\nlinkStyle 0 accDescr-width:3px', expected: {
    getVertices: [['A', { styles: ['stroke\\-width:2px', 'accTitle-color:red'] }], ['B', { styles: [] }]],
    getClasses: [['c', { styles: ['font\\2d family:Arial'] }]], getEdges: [{ start: 'A', end: 'B', style: ['accDescr-width:3px', 'fill:none'] }],
  } },
  { name: 'Journey original HTML entity actor', source: 'journey\n    title My working day\n    section Go to work\n      Make tea: 5: Me\n      Go upstairs: 3: Me&amp;\n      Do work: 1: Me, Cat\n    section Go home\n      Go downstairs: 5: Me\n      Sit down: 5: Me', expected: { getTasks: [
    { task: 'Make tea', score: 5, people: ['Me'], section: 'Go to work' },
    { task: 'Go upstairs', score: 3, people: ['Me&'], section: 'Go to work' },
    { task: 'Do work', score: 1, people: ['Me', 'Cat'], section: 'Go to work' },
    { task: 'Go downstairs', score: 5, people: ['Me'], section: 'Go home' },
    { task: 'Sit down', score: 5, people: ['Me'], section: 'Go home' },
  ] } },
  { name: 'Treemap empty wrapper', source: '---\n---\ntreemap-beta\n"":5', expected: { getNodes: [{ name: '', value: 5 }] } },
  { name: 'Treemap nonempty original wrapper control', source: '---\nconfig:\n    theme: \'forest\'\n---\ntreemap-beta\n"Category A"\n    "Item A1": 10\n    "Item A2": 20\n"Category B"\n \n    "Item B1": 15\n    "Item B2": 25', expected: { getRoot: { children: [
    { name: 'Category A', children: [{ name: 'Item A1', value: 10 }, { name: 'Item A2', value: 20 }] },
    { name: 'Category B', children: [{ name: 'Item B1', value: 15 }, { name: 'Item B2', value: 25 }] },
  ] } } },
]

// Decode the reference's own entity placeholders for authored text assertions.
// This is a database projection, not a second parser or a rendering oracle.
function publicReferenceText(value: unknown): unknown {
  if (typeof value === 'string') return decodeXML(value.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';'))
  if (Array.isArray(value)) return value.map(publicReferenceText)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, publicReferenceText(entry)]))
  return value
}

for (const witness of generousWriters) test(`strict writer: ${witness.name}`, async () => {
  const parsed = am.parseRegisteredMermaid(witness.source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  for (const wrapper of ['verbatim', 'canonical'] as const) {
    const serialized = am.serializeMermaid(parsed.value, { wrapper })
    const after = await modern.parse(serialized)
    results.push({ ...witness, wrapper, serialized, after })
    expect(after.ok, serialized).toBe(true)
    if (after.ok) expect(publicReferenceText(after.snapshot.data)).toMatchObject(witness.expected)
  }
})

test.each(['\n', ' \t\n', '\r\n', '\r'])('supported blank YAML keeps its verbatim wrapper: %j', async content => {
  const wrapper = `---\n${content}---\n`
  const source = `${wrapper}treemap-beta\n"":5`
  expect((await modern.parse(source)).ok).toBe(true)
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const serialized = am.serializeMermaid(parsed.value)
  expect(serialized).toStartWith(wrapper)
  expect((await modern.parse(serialized)).ok).toBe(true)
  expect(am.verifyMermaid(source).warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'empty_frontmatter')).toBe(false)
})

test('ER original numeric identities, endpoints and attributes survive strict writing', async () => {
  const source = 'erDiagram\n              CUSTOMER ||--o{ 1 : places\n              1 ||--|{ u : contains\n              u {\n                string name\n                int quantity\n              }1\n              "2.5" ||--|| ORDER : processes\n              ORDER {\n                int id\n                date created\n              }'
  const parsed = am.parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const serialized = am.serializeMermaid(parsed.value)
  const after = await modern.parse(serialized)
  expect(after.ok, serialized).toBe(true)
  if (!after.ok) return
  const entities = after.snapshot.data.getEntities as Array<[string, { id: string; attributes: Array<{ type: string; name: string }> }]>
  const ids = new Map(entities.map(([name, entity]) => [entity.id, name]))
  expect(entities.map(([name]) => name)).toEqual(['1', '2.5', 'CUSTOMER', 'ORDER', 'u'])
  expect(entities.find(([name]) => name === 'u')?.[1].attributes).toMatchObject([{ type: 'string', name: 'name' }, { type: 'int', name: 'quantity' }])
  expect(entities.find(([name]) => name === 'ORDER')?.[1].attributes).toMatchObject([{ type: 'int', name: 'id' }, { type: 'date', name: 'created' }])
  const relationships = after.snapshot.data.getRelationships as Array<{ entityA: string; entityB: string; roleA: string }>
  expect(relationships.map(edge => [ids.get(edge.entityA), ids.get(edge.entityB), edge.roleA])).toEqual([
    ['CUSTOMER', '1', 'places'], ['1', 'u', 'contains'], ['2.5', 'ORDER', 'processes'],
  ])
  results.push({ name: 'ER original numeric identities', source, serialized, after })
})

test.each([
  'C4Context\nSystem(s, "S", $tadb"cyl&inder")',
  'C4Context\nPerson_Ext(customerA,b2 $link="https://github.com/mermaidjs")',
  'sequenceDiagram\nparticipant :@',
  'sequenceDiagram\n      participant title:C@{ "type" : "control" }\n      C->C: test',
  'timeline section a: v',
  'timeline\n    section abc-123    task1: event1\n      task2: event2: event3\n           : event4: #ev#ent2# : event5',
  'timeline\n      title ;my;title;\n      section ;a;bc-123;\n     section abc-456 ;ta;sk1;: ;ev;ent1; : ;ev;ent2; : ;ev;e3;',
  'graph TD;style S background:#aaa;\nstyle T b] &   n4ackground:#bbb,border:1px solid red;',
])('ambiguous source refuses instead of inventing a portable interpretation: %s', source => {
  const parsed = am.parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(false)
  if (!parsed.ok) expect(parsed.error).toContainEqual(expect.objectContaining({ code: 'PARSE_FAILED' }))
  expect(am.verifyMermaid(source).ok).toBe(false)
})

afterAll(() => {
  modern.close()
  grammar.close()
  const output = process.env.AM_MODERN_REGRESSION_REPORT ?? join(here, 'output/grammar-regressions-gate.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ reference: admitted, target, method: 'Reviewed seeded failures must remain accepted by actual default Mermaid detection after public serialization; named reference semantic fields and actual native fields also agree where selected.', cases: results }, null, 2) + '\n')
})
