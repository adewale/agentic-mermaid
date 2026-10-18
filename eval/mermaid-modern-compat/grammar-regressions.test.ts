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

afterAll(() => {
  modern.close()
  grammar.close()
  const output = process.env.AM_MODERN_REGRESSION_REPORT ?? join(here, 'output/grammar-regressions-gate.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ reference: admitted, target, method: 'Reviewed seeded failures must remain accepted by actual default Mermaid detection after public serialization; named reference semantic fields and actual native fields also agree where selected.', cases: results }, null, 2) + '\n')
})
