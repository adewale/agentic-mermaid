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

test('Class preserves authored method strings that Mermaid HTML sanitization consumes', async () => {
  const native = await import(pathToFileURL(join(target, 'src/index.ts')).href) as typeof import('../../src/index.ts')
  const agent = await import(pathToFileURL(join(target, 'src/agent/index.ts')).href) as typeof import('../../src/agent/index.ts')
  const members = ['<e()', '<m()', '+assM <swim()', '<<interface    +authorise() bool', '<e>()', '<!e()', '</e()', '<?e()']
  for (const member of members) {
    const source = `classDiagram\nclass C {\n${member}\n}\n`
    expect((await modern.parse(source)).ok).toBe(false)
    const parsed = am.parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) continue
    expect(parsed.value.body.kind).toBe('opaque')
    expect(am.serializeMermaid(parsed.value)).toBe(source)
    expect(agent.renderMermaidSVG(parsed.value)).toBe(native.renderMermaidSVG(source))
    expect(agent.renderMermaidASCII(parsed.value)).toBe(native.renderMermaidASCII(source))
    expect(am.verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'class_member_html' }))
    expect(am.mutate(parsed.value, { kind: 'add_class', id: 'Other' }).ok).toBe(false)
    const safe = am.parseRegisteredMermaid('classDiagram\nclass C')
    if (!safe.ok || safe.value.body.kind !== 'class') throw new Error('structured Class required')
    expect(am.mutate(safe.value, { kind: 'add_member', class: 'C', text: member }).ok).toBe(false)
    expect(am.mutate(safe.value, { kind: 'add_class', id: 'Other', members: [member] }).ok).toBe(false)
    expect(am.synthesizeFromGraph({ kind: 'class', body: { ...safe.value.body, classes: [{ id: 'C', members: [member] }] } }).ok).toBe(false)
  }
  // Closed generic text, comparisons, annotations, and authored entity tokens
  // remain distinct raw grammar strings and retain their public edit contract.
  for (const member of ['List<T> get()', '+get() Map<T>', 'a < b()', '<_e()', '<1e()', '<<interface>>', '#60;e()']) {
    const source = `classDiagram\nclass C {\n${member}\n}\n`
    const parsed = am.parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'class') throw new Error('structured Class required')
    expect(parsed.value.body.classes[0]!.members).toEqual([member])
    const edited = am.mutate(parsed.value, { kind: 'rename_class', from: 'C', to: 'Edited' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) continue
    const written = am.serializeMermaid(edited.value)
    expect((await modern.parse(written)).ok).toBe(true)
    const reloaded = am.parseRegisteredMermaid(written)
    expect(reloaded.ok && reloaded.value.body).toEqual(edited.value.body)
  }
})

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

afterAll(() => {
  modern.close()
  grammar.close()
  const output = process.env.AM_MODERN_REGRESSION_REPORT ?? join(here, 'output/grammar-regressions-gate.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ reference: admitted, target, method: 'Reviewed seeded failures must remain accepted by actual default Mermaid detection after public serialization; named reference semantic fields and actual native fields also agree where selected.', cases: results }, null, 2) + '\n')
})
