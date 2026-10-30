import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { describeMermaidFacts, mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, synthesizeFromGraph, verifyMermaid } from '../agent/index.ts'
import { applyMutationBatch } from '../agent/mutate.ts'
import type { AnyMutationOp, ParsedDiagram } from '../agent/types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

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

describe('canonical source', () => {
  for (const family of Object.values(METAMORPHIC_FAMILIES)) {
    // canonicalSource is the normalized renderer and source-map input. Families
    // that read indentation as structure (mindmap, kanban, treemap, ishikawa)
    // lost their tree when it was line-trimmed: a mindmap's canonical source
    // re-read as several roots. Scaling the indentation keeps every family's
    // relative structure, so the canonical source must read as the same facts.
    test(`${family.family}: the canonical source reads as the authored diagram`, () => {
      fc.assert(fc.property(
        fc.integer({ min: family.kRange[0], max: family.kRange[1] }), fc.integer({ min: 1, max: 3 }),
        (size, scale) => {
          const source = family.build(size, 'canon').replace(/^ +/gm, indent => ' '.repeat(indent.length * scale))
          const diagram = parse(source)
          const reread = parseRegisteredMermaid(diagram.canonicalSource)
          expect(reread.ok).toBe(true)
          if (!reread.ok) return
          expect(reread.value.body.kind).toBe(diagram.body.kind)
          expect(describeMermaidFacts(reread.value)).toEqual(describeMermaidFacts(diagram))
        }), fcParameters({ numRuns: 8 }),
      )
    })
  }
})

// `am format` (serialize∘parse) over hostile text in each family's text
// fields, written raw into the authored source. Whatever the reader admits as
// a typed body, the writer must spell back: serialization never throws on a
// body the parser produced (V5), and its output re-reads as the same facts and
// formats to itself (V6, V7). A source the reader keeps preserved is written
// back verbatim.
describe('format over hostile field text', () => {
  const TEMPLATES: ReadonlyArray<readonly [string, (text: string) => string]> = [
    ['flowchart node', text => `flowchart LR\n  A["${text}"] --> B\n`],
    ['flowchart edge', text => `flowchart LR\n  A -->|"${text}"| B\n`],
    ['state transition', text => `stateDiagram-v2\n  S1 --> S2 : ${text}\n`],
    ['state label', text => `stateDiagram-v2\n  S1 : ${text}\n`],
    ['sequence message', text => `sequenceDiagram\n  A->>B: ${text}\n`],
    ['class label', text => `classDiagram\n  class A["${text}"]\n`],
    ['class member', text => `classDiagram\n  class A {\n    ${text}\n  }\n`],
    ['class title', text => `classDiagram\n  title ${text}\n  class A\n`],
    ['er relation', text => `erDiagram\n  A ||--o{ B : "${text}"\n`],
    ['timeline event', text => `timeline\n  2025 : ${text}\n`],
    ['journey task', text => `journey\n  section S\n    ${text}: 3: Me\n`],
    ['architecture service', text => `architecture-beta\n  service api(server)[${text}]\n`],
    ['xychart title', text => `xychart-beta\n  title "${text}"\n  x-axis [a, b]\n  bar [1, 2]\n`],
    ['pie slice', text => `pie\n  "${text}" : 3\n`],
    ['pie title', text => `pie\n  title ${text}\n  "a" : 3\n`],
    ['quadrant point', text => `quadrantChart\n  ${text}: [0.3, 0.6]\n`],
    ['gantt task', text => `gantt\n  dateFormat YYYY-MM-DD\n  section S\n    ${text} : t1, 2024-01-01, 1d\n`],
    ['mindmap node', text => `mindmap\n  root\n    ${text}\n`],
    ['gitgraph message', text => `gitGraph\n  commit id: "a" msg: "${text}"\n`],
    ['radar axis', text => `radar-beta\n  axis a["${text}"], b, c\n  curve x{1, 2, 3}\n`],
    ['sankey quoted node', text => `sankey-beta\n"${text}",B,10\n`],
    ['sankey bare node', text => `sankey-beta\n${text},B,10\n`],
    ['c4 label', text => `C4Context\n  Person(user, "${text}")\n`],
    ['packet field', text => `packet\n  0-15: "${text}"\n`],
    ['kanban task', text => `kanban\n  todo[Todo]\n    t1["${text}"]\n`],
    ['kanban markdown', text => `kanban\n  todo["\`${text}\`"]\n`],
    ['requirement text', text => `requirementDiagram\n  requirement r {\n    id: 1\n    text: ${text}\n  }\n`],
    ['requirement quoted text', text => `requirementDiagram\n  requirement r {\n    id: 1\n    text: "${text}"\n  }\n`],
    ['treemap node', text => `treemap-beta\n  "${text}"\n    "B": 1\n`],
    ['block label', text => `block\n  a["${text}"] b\n`],
    ['ishikawa cause', text => `ishikawa\n  Effect\n    ${text}\n`],
    ['zenuml message', text => `zenuml\n  A->B: ${text}\n`],
    ['eventmodeling frame', text => `eventmodeling\n  tf 01 evt ${text}\n`],
  ]
  const HOSTILE = ['%%', '%%{x}%%', '#35;', '#37;', '#quot;', '#65534;', '"', "'", '`', '**', '[', ']', '{', '}', '(', ')', '|', ';', ',', ':', '--', '<br>', ' ', ' ', '\u0000', '\u0007', '\u0085', '\t', '\ud800', 'é', '👩🏽‍💻', 'end', '\\', '\\u0000', '&amp;', '#', '<', '>']
  const textArb = fc.oneof(
    fc.string({ unit: 'binary', minLength: 1, maxLength: 8 }),
    fc.array(fc.oneof(fc.constantFrom(...HOSTILE), fc.string({ unit: 'grapheme-ascii', maxLength: 3 })), { minLength: 1, maxLength: 5 }).map(parts => parts.join('')),
  )
  const sourceArb = fc.tuple(fc.constantFrom(...TEMPLATES), textArb).map(([[, template], text]) => template(text))
  // Shrunk counterexamples: a quote in bare requirement text and a NUL in a
  // C4 label made serialization throw; packet controls were written as JSON
  // escapes the reader takes literally; a markdown string lost its backticks
  // or reopened one; a node named `%%` was written as a comment row; a U+2028
  // label lost its quotes; a Quadrant point labelled `"` was read as empty,
  // and blanks beside a `<br>` in a quoted point label were trimmed.
  const EXAMPLES: Array<[string]> = [
    ['quadrantChart\n  ": [0.3, 0.6]\n'],
    ['quadrantChart\n  \u0000 <br>[: [0.3, 0.6]\n'],
    ['requirementDiagram\n  requirement r {\n    id: 1\n    text: a"b\n  }\n'],
    ['C4Context\n  Person(user, "a\u0000b")\n'],
    ['packet\n  0-15: "a\u0000b\u0007\ud800"\n'],
    ['kanban\n  todo["`**bold** x`"]\n'],
    ['kanban\n  todo["``j+`"]\n'],
    ['sankey-beta\n"%%",B,10\n'],
    ['flowchart LR\n  A["W   `"] --> B\n'],
  ]
  const format = (source: string) => {
    const parsed = parseRegisteredMermaid(source)
    return parsed.ok ? { parsed: parsed.value, written: serializeMermaid(parsed.value) } : undefined
  }

  test('serialization of a parsed body re-reads as the same facts', () => {
    fc.assert(fc.property(sourceArb, source => {
      const first = format(source)
      if (!first) return
      if (first.parsed.body.kind === 'opaque') {
        expect(first.written).toBe(source)
        return
      }
      const reread = parseRegisteredMermaid(first.written)
      expect(reread.ok).toBe(true)
      if (!reread.ok) return
      expect({ kind: reread.value.body.kind, facts: describeMermaidFacts(reread.value) }).toEqual({ kind: first.parsed.body.kind, facts: describeMermaidFacts(first.parsed) })
    }), fcParameters({ numRuns: 3000, examples: EXAMPLES }))
  })

  test('format is a fixed point', () => {
    fc.assert(fc.property(sourceArb, source => {
      const first = format(source)
      if (!first) return
      expect(format(first.written)?.written).toBe(first.written)
    }), fcParameters({ numRuns: 3000, examples: EXAMPLES }))
  })

  // Pinned Mermaid is a slow child process, so the oracle sees a bounded
  // generated set beside the examples: where Mermaid reads the authored
  // source, it reads the formatted source.
  test('Mermaid 12.2.0 reads the formatted form of a source it reads', async () => {
    const upstream = startUpstreamMermaid()
    let checked = 0
    try {
      const fixed: Array<[string]> = [...EXAMPLES, ['sankey-beta\n"a,b",B,10\n'], ['sankey-beta\nA,B,10\n"x,y",B,3\n'], ['requirementDiagram\n  requirement r {\n    id: 1\n    text: say "hi" now\n  }\n']]
      await fc.assert(fc.asyncProperty(sourceArb, async source => {
        if (!format(source) || !(await upstream.accepts(source))) return
        const written = format(source)!.written
        checked++
        expect({ source, written, accepted: await upstream.accepts(written) }).toEqual({ source, written, accepted: true })
      }), fcParameters({ numRuns: 400, examples: fixed }))
    } finally {
      upstream.close()
    }
    expect(checked).toBeGreaterThan(50)
  }, 120_000)
})

// Mermaid 12.2.0 reads U+2028 and U+2029 inside State, Timeline and ER text
// as characters of that text. Ours read `.`-based statement patterns, which
// stop at them, so these sources fell back to preserved source: render and
// verify failed, and a Timeline title was drawn as a period. Each must read
// as a typed body stating the text, and draw.
describe('line separators inside State, Timeline and ER text', () => {
  const separated = fc.tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,3}$/),
    fc.array(fc.tuple(fc.constantFrom(' ', ' ', '  ', '  '), fc.stringMatching(/^[a-z0-9]{1,4}$/)), { minLength: 1, maxLength: 3 }),
  ).map(([first, rest]) => first + rest.map(([separator, word]) => separator + word).join(''))
  // [name, source, the fact stating the text]
  const TEMPLATES: ReadonlyArray<readonly [string, (text: string) => string, (text: string) => string]> = [
    ['state transition', text => `stateDiagram-v2\n  S1 --> S2 : ${text}\n`, text => `edge S1 -> S2 : ${text}`],
    ['state description', text => `stateDiagram-v2\n  S1 : ${text}\n`, text => `state S1 : ${text}`],
    ['state note', text => `stateDiagram-v2\n  S1\n  note right of S1 : ${text}\n`, text => `note#0 right of S1 : ${text}`],
    ['state block note', text => `stateDiagram-v2\n  S1\n  note left of S1\n    ${text}\n  end note\n`, text => `note#0 left of S1 : ${text}`],
    ['timeline title', text => `timeline\n  title ${text}\n  2020 : a\n`, text => `title ${text}`],
    ['timeline section', text => `timeline\n  section ${text}\n    2020 : a\n`, text => `section ${text}`],
    ['timeline event', text => `timeline\n  2020 : ${text}\n`, text => `event 2020 : ${text}`],
    ['timeline continuation', text => `timeline\n  2020 : a\n       : ${text}\n`, text => `event 2020 : ${text}`],
    ['timeline period', text => `timeline\n  ${text} : a\n`, text => `period ${text}`],
    ['er quoted relation', text => `erDiagram\n  A ||--o{ B : "${text}"\n`, text => `relation A one-only -- zero-or-many B : ${text}`],
    ['er bare relation', text => `erDiagram\n  A ||--o{ B : ${text.replace(/ /g, '')}\n`, text => `relation A one-only -- zero-or-many B : ${text.replace(/ /g, '')}`],
  ]
  const caseArb = fc.tuple(fc.constantFrom(...TEMPLATES), separated)

  test('the text is read as a typed body that states it, and draws', () => {
    fc.assert(fc.property(caseArb, ([[name, template, fact], text]) => {
      const source = template(text)
      const diagram = parse(source)
      expect({ name, kind: diagram.body.kind as string }).toEqual({ name, kind: diagram.kind as string })
      expect(describeMermaidFacts(diagram)).toContain(fact(text))
      const verified = verifyMermaid(source)
      expect({ name, codes: verified.warnings.map(warning => warning.code) }).toEqual({ name, codes: [] })
      expect(() => renderMermaidSVG(source)).not.toThrow()
      // Formatting keeps the reading.
      expect(describeMermaidFacts(parse(serializeMermaid(diagram)))).toEqual(describeMermaidFacts(diagram))
    }), fcParameters({ numRuns: 200 }))
  }, 60_000)

  test('Mermaid 12.2.0 reads each source and its formatted form', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const [[name, template], text] of fc.sample(caseArb, { numRuns: 40, seed: 2028 })) {
        const source = template(text)
        const written = serializeMermaid(parse(source))
        expect({ name, source, written, accepted: [await upstream.accepts(source), await upstream.accepts(written)] }).toEqual({ name, source, written, accepted: [true, true] })
      }
    } finally {
      upstream.close()
    }
  }, 60_000)
})

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
