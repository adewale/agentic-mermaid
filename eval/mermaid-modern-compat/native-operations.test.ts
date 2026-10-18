import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getFamily, knownBuiltinFamilies } from '../../src/agent/core.ts'
import { inspectAgenticGrammar } from './grammar-agentic.ts'
import { projectNativeOperations, projectReferenceOperations } from './grammar-native-operations.ts'
import { projectReferenceSemantic } from './grammar-native-semantics.ts'
import { startGrammarReference } from './grammar-reference.ts'
import { admitCurrentReference } from './reference.ts'

const here = dirname(fileURLToPath(import.meta.url))
const upstream = process.env.MERMAID_UPSTREAM_DIR ?? join(here, '../../../mermaid')
const referenceDir = process.env.MERMAID_REFERENCE_DIR ?? join(here, '../../../mermaid-reference')
const admitted = admitCurrentReference(upstream, referenceDir)
const oracle = startGrammarReference(referenceDir, upstream)
const cases: unknown[] = []
afterAll(() => {
  oracle.close()
  const output = join(here, 'output/native-operations-gate.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ reference: admitted, method: 'Independent ordered projections of actual native write events and actual reference call operands; each case declares its operation scope and omitted methods. No returned IR is used as an operation trace.', cases }, null, 2) + '\n')
})

async function assertOperations(family: string, source: string) {
  await oracle.prepare(family, getFamily(family)!.example)
  const reference = await oracle.parse(family, source)
  const local = inspectAgenticGrammar(family, source)
  const mutations = local.native.observation.mutations
  const native = mutations.status === 'available' ? projectNativeOperations(family, mutations.value) : undefined
  const expected = projectReferenceOperations(family, reference)
  cases.push({ family, source, referenceAccepted: reference.accepted, nativeStatus: local.native.status, native, reference: expected })
  expect(reference.instrumentationErrors ?? []).toEqual([])
  expect(reference.accepted).toBe(true)
  expect(local.native.status).toBe('accepted')
  expect(local.native.observation.instrumentationErrors ?? []).toEqual([])
  expect(local.native.observation.control?.same).toBe(true)
  expect(native?.operations.length).toBeGreaterThan(0)
  expect(native?.operations).toEqual(expected?.operations)
  return { native, reference: expected, nativeSemantic: local.native.observation.semantic, referenceReply: reference }
}

describe('actual native builder operations agree with the pinned modern reference in declared scopes', () => {
  for (const family of knownBuiltinFamilies()) test(`${family}: canonical operations retain operand values and order`, () => assertOperations(family, getFamily(family)!.example))

  test.each([
    ['C4Container', 'System_Boundary(domain, "Domain") {\nContainer(api, "API", $descr="Serves requests", $techn="TypeScript")\nContainerDb_Ext(db, "Database", "SQL", "Stores data")\n}\nPerson(user, "User")\nBiRel(user, api, "Talks", "HTTPS")\nRel_Back(api, db, "Reads", "SQL")'],
    ['C4Deployment', 'Deployment_Node(region, "Region", "Cloud") {\nNode_L(vm, "VM", "Linux", "Worker") {\nComponent(worker, "Worker", "TypeScript", "Runs jobs")\n}\n}\nPerson(user, "User")\nRel_R(user, worker, "Starts", "HTTPS")'],
  ])('C4 %s retains declaration parentage, text slots and relationship marker sides', async (variant, body) => {
    const parsed = await assertOperations('c4', `${variant}\n${body}`)
    expect(parsed.nativeSemantic?.value).toEqual(projectReferenceSemantic('c4', parsed.referenceReply)?.value)
  })
  test('C4 repeated interaction writes remain ordered when the reference getter upserts pairs', async () => {
    const parsed = await assertOperations('c4', 'C4Dynamic\nPerson(a, "A")\nSystem(b, "B")\nRel(a, b, "First")\nRel_Back(a, b, "Second")\nBiRel(a, b, "Third")')
    const native = parsed.nativeSemantic?.value as Record<string, unknown>
    const reference = projectReferenceSemantic('c4', parsed.referenceReply)!.value as Record<string, unknown>
    expect(native.relationships).toHaveLength(3)
    expect(reference.relationships).toHaveLength(1)
    expect(parsed.native?.operations.filter(operation => Array.isArray(operation) && operation[0] === 'relationship')).toHaveLength(3)
  })

  test('Flowchart retains class append order around edge creation', () => assertOperations('flowchart', 'flowchart TD\nA --> B\nclass A warm\nclass A cool\nB --> C\nclass A warm'))
  test('Flowchart retains authored named-edge identifiers in actual link operands', () => assertOperations('flowchart', 'flowchart LR\nA e1@--> B\nB e2@==> C'))
  test('Class preserves one-ended marker sides in relationship creation order', () => assertOperations('class', 'classDiagram\nA <-- B : calls\nC --|> D\nE o-- F\nG ..> H : uses'))
  test('Class preserves dashed diamond and lollipop shafts independently of marker kinds', async () => {
    const parsed = await assertOperations('class', 'classDiagram\nA *.. B\nC o.. D\nE ().. F')
    const shafts = { relationships: [
      { line: 'dashed', startMarker: 'diamond-filled', endMarker: 'none' },
      { line: 'dashed', startMarker: 'diamond-open', endMarker: 'none' },
      { line: 'dashed', startMarker: 'lollipop', endMarker: 'none' },
    ] }
    // Mermaid materializes synthetic lollipop interfaces in its returned DB.
    // Logical endpoints are compared above in the actual builder operands.
    expect(projectReferenceSemantic('class', parsed.referenceReply)?.value).toMatchObject(shafts)
    expect(parsed.nativeSemantic?.value).toMatchObject(shafts)
  })
  test('State expands recorded document operands without losing nested parent scope', () => assertOperations('state', 'stateDiagram-v2\nstate Outer {\n[*] --> A\nA --> [*]\n}\n[*] --> Outer'))
  test('Sequence preserves explicit and inline activation order', () => assertOperations('sequence', 'sequenceDiagram\nA->>+B: start\nactivate A\nB-->>-A: finish\ndeactivate A'))
  test('Sequence retains ordinary, open, bidirectional and half-arrow marker sides', () => {
    const arrows = ['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '<<->>', '<<-->>', '-|\\', '--|\\', '-|/', '--|/', '-\\\\', '--\\\\', '-//', '--//', '/|-', '/|--', '\\|-', '\\|--', '//-', '//--', '\\\\-', '\\\\--']
    return assertOperations('sequence', `sequenceDiagram\n${arrows.map((arrow, index) => `A${arrow}B: arrow ${index}`).join('\n')}`)
  })
  test('Mindmap attachment and quoted delimiters retain logical parent identities', () => assertOperations('mindmap', 'mindmap\nroot(("Root [label]"))\n  Child["Child (detail)"]\n    Leaf\n    ::icon(fa fa-book)\n    ::: warm cool'))
  test('Radar keyed curve writes retain axis references while resolving authored entry order', () => assertOperations('radar', 'radar-beta\naxis A, B, C\ncurve m{ C: 3, A: 1, B: 2 }'))
  test('Git keeps authored generated-looking IDs distinct from automatic identities, including parents and heads', async () => {
    const source = 'gitGraph\ncommit id:"@commit:0"\ncommit id:"0-abc"\ncommit'
    const authored = await assertOperations('gitgraph', source)
    const generated = await assertOperations('gitgraph', source.replace('commit id:"@commit:0"', 'commit'))
    for (const parsed of [authored, generated]) expect(parsed.nativeSemantic?.value).toEqual(projectReferenceSemantic('gitgraph', parsed.referenceReply)?.value)
    // Removing an authored ID changes identity even when its bytes match an
    // older generated-ID placeholder. Both inputs exercise actual parsers.
    expect(authored.native?.operations).not.toEqual(generated.native?.operations)
    expect(authored.nativeSemantic?.value).not.toEqual(generated.nativeSemantic?.value)
  })
})
