import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { describeMermaidFacts, mutate, parseRegisteredMermaid, serializeMermaid, synthesizeFromGraph } from '../agent/index.ts'
import { applyMutationBatch } from '../agent/mutate.ts'
import type { AnyMutationOp, ParsedDiagram } from '../agent/types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'

function parse(source: string): ParsedDiagram {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value
}

function reload(diagram: ParsedDiagram): ParsedDiagram {
  const payload = JSON.parse(JSON.stringify(diagram, (_key, value) => value instanceof Map ? Object.fromEntries(value) : value))
  const result = synthesizeFromGraph(payload)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  const source = serializeMermaid(result.value)
  const reparsed = parse(source)
  expect(serializeMermaid(reparsed)).toBe(source)
  return reparsed
}

function edit(diagram: ParsedDiagram, op: AnyMutationOp): ParsedDiagram {
  const result = mutate(diagram, op)
  if (!result.ok) throw new Error(result.error.message)
  return reload(result.value)
}

const wrapperArb = fc.constantFrom('', '%% wrapper\n', '---\ntitle: Preserve\n---\n%% wrapper\n', '%%{init: {"theme":"dark"}}%%\n')

describe('source comments across serialization and edit sequences', () => {
  for (const family of Object.values(METAMORPHIC_FAMILIES)) {
    test(`${family.family}: parser-identified comment occurrences survive without changing facts`, () => {
      fc.assert(fc.property(
        fc.integer({ min: family.kRange[0], max: family.kRange[1] }),
        fc.integer({ min: 1, max: 4 }), wrapperArb, fc.nat(),
        (size, count, wrapper, placement) => {
          const source = family.build(size, 'preserve')
          const lines = source.split('\n')
          const at = 1 + placement % lines.length
          lines.splice(at, 0, ...Array(count).fill('%% same retained reason'))
          const authored = wrapper + lines.join('\n')
          const diagram = parse(authored)
          expect(diagram.body.kind).toBe(parse(wrapper + source).body.kind)
          expect(describeMermaidFacts(diagram)).toEqual(describeMermaidFacts(parse(wrapper + source)))
          const output = serializeMermaid(reload(diagram))
          expect(output.startsWith(wrapper)).toBe(true)
          expect(output.split('%% same retained reason')).toHaveLength(count + 1)
          expect(describeMermaidFacts(parse(output))).toEqual(describeMermaidFacts(parse(wrapper + source)))
        }), fcParameters({ numRuns: 12 }),
      )
    })
  }

  test.each(['flowchart', 'state'] as const)('%s: rename, remove, and recreate parallel edges retain the surviving association', family => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 5 }), fc.nat(), wrapperArb, (count, position, wrapper) => {
      const removed = position % count
      const state = family === 'state'
      let diagram = parse(wrapper + (state ? 'stateDiagram-v2\n  state A\n  state B\n' : 'flowchart LR\n  A[Alpha]\n  B[Beta]\n')
        + Array.from({ length: count }, (_, index) => `%% edge rationale ${index}\n  A --> B`).join('\n'))
      diagram = edit(diagram, state ? { kind: 'rename_state', from: 'A', to: 'Renamed' } : { kind: 'rename_node', from: 'A', to: 'Renamed' })
      let output = serializeMermaid(diagram)
      for (let index = 0; index < count; index++) expect(output).toMatch(new RegExp(`%% edge rationale ${index}\\n  Renamed(?:\\[Alpha\\])? --> B(?:\\[Beta\\])?`))
      const operations: AnyMutationOp[] = state
        ? [{ kind: 'remove_transition', index: removed }, { kind: 'add_transition', from: 'Renamed', to: 'B' }]
        : [{ kind: 'remove_edge', id: `Renamed->B#${removed}` }, { kind: 'add_edge', from: 'Renamed', to: 'B' }]
      const changed = applyMutationBatch(diagram, operations)
      if (!changed.ok) throw new Error(changed.error.message)
      diagram = reload(changed.value)
      output = serializeMermaid(diagram)
      expect(output.startsWith(wrapper)).toBe(true)
      for (let index = 0; index < count; index++) {
        expect(output.split(`%% edge rationale ${index}`)).toHaveLength(2)
        if (index === removed) expect(output.trimEnd()).toEndWith(`%% edge rationale ${index}`)
        else expect(output).toMatch(new RegExp(`%% edge rationale ${index}\\n  Renamed(?:\\[Alpha\\])? --> B(?:\\[Beta\\])?`))
      }
    }), fcParameters({ numRuns: 35 }))
  })

  test.each(['flowchart', 'state'] as const)('%s: deleting and recreating a node never resurrects its old comment anchor', family => {
    const state = family === 'state'
    const diagram = parse(state ? 'stateDiagram-v2\n%% old rationale\nstate A\nstate B' : 'flowchart LR\n%% old rationale\nA[Alpha]\nB[Beta]')
    const result = applyMutationBatch(diagram, state
      ? [{ kind: 'remove_state', id: 'A' }, { kind: 'add_state', id: 'A' }]
      : [{ kind: 'remove_node', id: 'A' }, { kind: 'add_node', id: 'A', label: 'Replacement' }])
    if (!result.ok) throw new Error(result.error.message)
    expect(serializeMermaid(reload(result.value)).trimEnd()).toEndWith('%% old rationale')
  })

  test('State comments follow their scoped parallel transitions across region and composite reordering', () => {
    const diagram = parse(`stateDiagram-v2
state Composite {
  state A
  state B
  %% nested rationale
  A --> B
  --
  state C
  state D
  %% other region rationale
  C --> D
}
%% outer rationale
A --> B`)
    const renamed = edit(diagram, { kind: 'rename_state', from: 'Composite', to: 'Renamed' })
    const output = serializeMermaid(renamed)
    expect(output).toContain('%% nested rationale\n    A --> B')
    expect(output).toContain('%% other region rationale\n    C --> D')
    expect(output).toContain('%% outer rationale\n  A --> B')
  })

  test.each([
    'pie\n"A %% quoted": 2 %% actual rationale\n"B": 3',
    'stateDiagram-v2\nstate "A %% quoted" as A %% actual rationale\nA --> B',
  ])('a quoted percent pair cannot become an extra comment: %s', source => {
    const output = serializeMermaid(reload(parse(source)))
    expect(output.split('%% actual rationale')).toHaveLength(2)
    expect(output.split('A %% quoted')).toHaveLength(2)
    expect(output).not.toContain('\n%% quoted"')
  })

  test('a quoted copy of a comment cannot hide its dropped trailing occurrence', () => {
    const output = serializeMermaid(reload(parse('pie\n"%% same reason": 2 %% same reason\n"B": 3 %% same reason')))
    expect(output.split('%% same reason')).toHaveLength(4)
    expect(output.split('\n%% same reason')).toHaveLength(3)
  })

  test('Mindmap shaped labels and icon payloads do not leak into retained comment text', () => {
    const diagram = reload(parse('mindmap\n  root[100%% ready] %% root comment\n    child)cloud%% label( %% child comment\n      ::icon(mdi:foo%%bar) %% icon comment'))
    const output = serializeMermaid(diagram)
    for (const comment of ['root comment', 'child comment', 'icon comment']) expect(output.split(`%% ${comment}`)).toHaveLength(2)
    expect(output).not.toContain('\n%% ready]')
    expect(output).not.toContain('\n%% label(')
    expect(output).not.toContain('\n%% bar)')
  })

  test.each([
    ['block', 'block\n  columns 2\n  A["First"] B["Second"]', ['block "A" parent null type square span 1 columns -1 label "First"', 'block "B" parent null type square span 1 columns -1 label "Second"']],
    ['treemap', 'treemap\n"Portfolio"\n  "First": 2\n  "Second": 3', ['node#0 treemap-0 parent root : "Portfolio" section', 'node#1 treemap-1 parent treemap-0 : "First" value 2', 'node#2 treemap-2 parent treemap-0 : "Second" value 3']],
    ['ishikawa', 'ishikawa\n  Outcome\n  Process\n    Cause', ['effect#0 effect : "Outcome"', 'cause#1 cause-1 parent effect : "Process"', 'cause#2 cause-2 parent cause-1 : "Cause"']],
  ] as const)('%s wrapper comments cannot become content or force opaque fallback', (family, source, expected) => {
    const parsed = parse('---\ntitle: Preserve\n---\n%% wrapper\n' + source)
    expect(parsed.body.kind).toBe(family)
    const facts = describeMermaidFacts(reload(parsed))
    for (const fact of expected) expect(facts).toContain(fact)
  })

  test.each([
    'flowchart LR\nA[100%% ready]',
    'classDiagram\nclass A {\n +String a%%b\n}',
    'block\nA[foo%%bar]',
    'kanban\nTodo[100%%ready]\n child[work]',
    'requirementDiagram\nrequirement A {\nid: R1\ntext: foo%%bar\nrisk: low\nverifymethod: test\n}',
  ])('literal percent pairs cannot invent comment metadata: %s', source => {
    const diagram = parse(source)
    expect(diagram.meta.bodyComments).toBeUndefined()
    expect(describeMermaidFacts(reload(diagram))).toEqual(describeMermaidFacts(diagram))
  })
})
