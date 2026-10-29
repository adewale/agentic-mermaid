import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOps, getFamily, knownBuiltinFamilies, parseRegisteredMermaid, serializeMermaid } from '../../src/agent/core.ts'
import blockCases from '../mermaid-block-bench/cases.json'
import ishikawaCases from '../mermaid-ishikawa-bench/cases.json'
import kanbanCases from '../mermaid-kanban-bench/cases.json'
import packetCases from '../mermaid-packet-bench/cases.json'
import requirementCases from '../mermaid-requirement-bench/cases.json'
import treemapCases from '../mermaid-treemap-bench/cases.json'
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

async function assertOperations(family: string, source: string, requireWrite = true) {
  const preparation = await oracle.prepare(family, getFamily(family)!.example)
  const reference = await oracle.parse(family, source)
  const local = inspectAgenticGrammar(family, source)
  const mutations = local.native.observation.mutations
  const native = mutations.status === 'available' ? projectNativeOperations(family, mutations.value) : undefined
  const expected = projectReferenceOperations(family, reference)
  const operationComparison = preparation.actionInstrumentation.startsWith('unavailable:') ? { status: 'unavailable', reason: preparation.actionInstrumentation } : { status: 'compared' }
  cases.push({ family, source, referenceAccepted: reference.accepted, nativeStatus: local.native.status, operationComparison,
    nativeObservation: mutations.status === 'available' ? { status: mutations.status, method: mutations.method, events: mutations.value.length } : mutations,
    referenceObservation: { actions: reference.actions.status, ast: reference.ast.status, parserIdentity: reference.parserIdentity },
    native, reference: expected })
  expect(reference.instrumentationErrors ?? []).toEqual([])
  expect(reference.accepted).toBe(true)
  expect(local.native.status).toBe('accepted')
  expect(local.native.observation.instrumentationErrors ?? []).toEqual([])
  expect(local.native.observation.control?.same).toBe(true)
  if (operationComparison.status === 'unavailable') {
    // Syntax acceptance is still exercised by the same owning case. A public
    // pass/error API cannot supply ordered operation parity through its shim.
    expect(preparation.parserIdentity?.api).toContain('pass/errorDetails')
    expect(reference.actions.status).toBe('unavailable')
    expect(expected).toBeUndefined()
    return { native, reference: expected, nativeSemantic: local.native.observation.semantic, referenceReply: reference }
  }
  expect(native).toBeDefined()
  if (requireWrite) expect(native?.operations.length).toBeGreaterThan(0)
  expect(native?.operations).toEqual(expected?.operations)
  return { native, reference: expected, nativeSemantic: local.native.observation.semantic, referenceReply: reference }
}

describe('native syntax and actual builder operations qualify against the declared reference boundary', () => {
  for (const family of knownBuiltinFamilies()) test(`${family}: canonical syntax and declared operation observations qualify`, () => assertOperations(family, getFamily(family)!.example))

  const stableCorpora: Record<string, readonly { id: string; source: string }[]> = {
    packet: packetCases.filter(fixture => fixture.reference.ok),
    kanban: kanbanCases.filter(fixture => fixture.reference.ok),
    requirement: requirementCases,
    block: blockCases,
    treemap: treemapCases,
    ishikawa: ishikawaCases,
  }
  for (const [family, fixtures] of Object.entries(stableCorpora))
    test(`${family}: accepted pinned corpus and representative citizenship sources retain semantic values and ordered writes`, async () => {
      for (const fixture of fixtures) {
        // Valid header-only diagrams intentionally write nothing. The canonical
        // all-family loop above separately proves each family's observation path
        // emits real writes. Every accepted corpus source is still compared.
        const parsed = await assertOperations(family, fixture.source, false)
        expect(parsed.nativeSemantic?.value, fixture.id).toEqual(projectReferenceSemantic(family, parsed.referenceReply)?.value)
      }

      // The same domain-rich source drives citizenship, reviewed renders and
      // this independent syntax/DB oracle. Check the canonical writer too:
      // local parse/serialize agreement alone cannot establish Mermaid validity.
      const source = readFileSync(join(here, '../stable-families/fixtures', `${family}.mmd`), 'utf8')
      const expected = await assertOperations(family, source)
      expect(expected.nativeSemantic?.value, `${family}: representative`).toEqual(projectReferenceSemantic(family, expected.referenceReply)?.value)
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const written = await assertOperations(family, serializeMermaid(parsed.value))
      expect(written.nativeSemantic?.value, `${family}: representative writer`).toEqual(projectReferenceSemantic(family, written.referenceReply)?.value)
      expect(written.nativeSemantic?.value, `${family}: representative round trip`).toEqual(expected.nativeSemantic?.value)
    })

  test.each([
    ['packet', 'packet\n+4: "Version"\n+36: "Payload spanning words"\n+24: "Trailer"'],
    ['packet', '---\ntitle: Register fields\n---\npacket\n+1: "EN"\n+7: "Mode"'],
    ['kanban', 'kanban\n  todo[To do]\n  :::column-class\n    work[Original label]@{label: "Ship parser", assigned: Alice, ticket: ID-42, priority: High}\n    :::task-class\n    ::icon(bomb)\n      deeper[Still in the same column]\n  done[Done]\n    research[Research]'],
    ['requirement', 'requirementDiagram\ndirection LR\nfunctionalRequirement fast {\nid: R1\ntext: "Respond within 100ms"\nrisk: high\nverifymethod: test\n}\nelement benchmark {\ntype: "test suite"\ndocref: "Acceptance specification"\n}\nfast <- verifies - benchmark'],
    ['treemap', 'treemap\n"Product"\n  "Delivery"\n    "Engineering": 60\n    "Design": 40\n  "Learning": 20\n"Operations": 10'],
    ['ishikawa', 'ishikawa\n  Slow release\n  Process\n    Manual checks\n      Duplicate reviews\n  Tooling\n    Slow builds\n      Cold caches'],
    ['ishikawa', 'ishikawa\n      Effect\n    First category\n      Nested cause\n  Outdented category\n    New category at the original baseline'],
    ['block', 'block\ncolumns 2\nblock:services:2\ncolumns 2\nA["API"] B[("Database")]\nend\nA -- "Read" --> B'],
    ['block', 'block\ncolumns 3\nblock\ncolumns 2\nA["API"]\nblock\nB["Database"]\nend\nend\nspace:3\nA -- "Read" --> B'],
  ])('%s retains meaningful values and parentage across native writes and independent reference results', async (family, source) => {
    const parsed = await assertOperations(family, source)
    expect(parsed.nativeSemantic?.value).toEqual(projectReferenceSemantic(family, parsed.referenceReply)?.value)
  })
  test('Block retains authored generated-looking composite IDs while normalizing actual anonymous allocation', async () => {
    const parsed = await assertOperations('block', 'block\nblock:block_generated_1\nA\nend\nblock\nB\nend\nA --> B')
    const semantic = parsed.nativeSemantic?.value as { nodes: { id: string }[] }
    expect(semantic.nodes[0]?.id).toBe('block_generated_1')
    expect(parsed.nativeSemantic?.value).toEqual(projectReferenceSemantic('block', parsed.referenceReply)?.value)
  })

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
    const shafts = {
      relationships: [
        { line: 'dashed', startMarker: 'diamond-filled', endMarker: 'none' },
        { line: 'dashed', startMarker: 'diamond-open', endMarker: 'none' },
        { line: 'dashed', startMarker: 'lollipop', endMarker: 'none' },
      ],
    }
    // Mermaid materializes synthetic lollipop interfaces in its returned DB.
    // Logical endpoints are compared above in the actual builder operands.
    expect(projectReferenceSemantic('class', parsed.referenceReply)?.value).toMatchObject(shafts)
    expect(parsed.nativeSemantic?.value).toMatchObject(shafts)
    const authored = applyOps({ source: 'classDiagram\nclass E\nclass F', ops: [{ kind: 'add_interface', class: 'F', label: 'E', side: 'from', lineStyle: 'dashed' }] })
    expect(authored.ok).toBe(true)
    if (!authored.ok) throw new Error('Expected explicit interface creation')
    const written = await assertOperations('class', authored.source)
    expect(written.native?.operations).toEqual([['relationship', 'E', 'F', '', '', '', 'dashed', 'lollipop', 'none']])
  })
  test('Class interface write projection retains repeated labels separately from authored generated-looking classes', async () => {
    const source = 'classDiagram\nclass interface0\nclass Port\nclass Service\nService --() Port\ninterface0 --() Port'
    const parsed = await assertOperations('class', source)
    expect(parsed.native?.operations).toEqual([
      ['relationship', 'Service', 'Port', '', '', '', 'solid', 'none', 'lollipop'],
      ['relationship', 'interface0', 'Port', '', '', '', 'solid', 'none', 'lollipop'],
    ])
    const local = inspectAgenticGrammar('class', source)
    const declarations = local.native.observation.mutations
    if (declarations.status !== 'available') throw new Error('Expected actual native declaration observations')
    expect(declarations.value.filter(event => event.kind === 'add-class' && (event.value as { isInterface?: boolean })?.isInterface).map(event => event.value)).toMatchObject([
      { id: 'interface0#1', label: 'Port', isInterface: true },
      { id: 'interface1', label: 'Port', isInterface: true },
    ])
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
