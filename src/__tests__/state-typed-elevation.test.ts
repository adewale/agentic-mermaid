import { afterAll, describe, expect, test } from 'bun:test'
import { decodeHTML } from 'entities'
import { describeMermaidFacts } from '../agent/facts.ts'
import { mutate } from '../agent/mutate.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { renderMermaidSVG as renderAgentSVG, renderMermaidASCII as renderAgentASCII, renderMermaidASCIIWithMeta } from '../agent/core.ts'
import { asState, type StateMutationOp, type StateValidDiagram } from '../agent/types.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { parseMermaid as parseRenderGraph } from '../parser.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import { expectNearLinearGrowth } from './helpers/complexity.ts'
import { startUpstreamMermaid, type UpstreamDiagram } from './helpers/upstream-mermaid.ts'

// Independent consumer projection: Mermaid resolves DB markers in HTML.
function logicalStyle(field: string): string {
  const decoded = decodeHTML(field.replace(/ﬂ°°(\d+)¶ß|ﬂ°(\w+)¶ß/g, (_token, numeric, named) => numeric ? `&#${numeric};` : `&${named};`))
  const colon = decoded.indexOf(':')
  return `${decoded.slice(0, colon).trim()}:${decoded.slice(colon + 1).trim()}`
}

function state(source: string): StateValidDiagram {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const narrowed = asState(parsed.value)
  if (!narrowed) throw new Error(`expected structured State body, got ${parsed.value.body.kind}`)
  return narrowed
}

/** Verify's UNSUPPORTED_SYNTAX findings on `source`, as `syntax@line`. */
function unsupportedSyntax(source: string): string[] {
  return verifyMermaid(source).warnings.flatMap(warning => (warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : []))
}

function apply(diagram: StateValidDiagram, op: StateMutationOp): StateValidDiagram {
  const result = mutate(diagram, op)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

function expectRetainedComment(diagram: StateValidDiagram, fragment: string): string {
  const written = serializeMermaid(diagram)
  expect(written).toContain(fragment)
  const verification = verifyMermaid(diagram)
  expect(verification.warnings.filter(warning => warning.code === 'COMMENT_DROPPED')).toEqual([])
  expect(verification.checks?.sourceLoss).toBe('not-detected')
  return written
}

describe('typed State residual elevation (B07)', () => {
  test('class shorthand and floating notes retain separate global identities and declared scopes', () => {
    const source = 'stateDiagram-v2\nstate Other {\nN:::hot\n}\nstate Outer {\nnote "Floating" as N\nA --> N\n}\nclassDef hot fill:red'
    const diagram = state(source)
    expect(diagram.body.states).toEqual([
      { id: 'Other', declarationBeforeTransition: 0, states: [{ id: 'N', declaredBare: true, declarationBeforeTransition: 0, className: 'hot' }], transitions: [] },
      { id: 'Outer', declarationBeforeTransition: 0, states: [{ id: 'A' }], transitions: [{ from: 'A', to: 'N' }] },
    ])
    expect(diagram.body.floatingNotes).toEqual([{ id: 'N', text: 'Floating', scope: { parent: 'Outer' } }])
    const written = serializeMermaid(diagram)
    expect(state(written).body).toEqual(diagram.body)
    for (const input of [source, written]) {
      const graph = parseRenderGraph(input), note = graph.floatingStateNotes?.[0]
      if (!note) throw new Error('Expected independently identified floating annotation')
      expect(note.nodeId).not.toBe('N')
      expect([...graph.nodes.keys()]).toHaveLength(3)
      expect(graph.subgraphs.find(group => group.id === 'Other')?.nodeIds).toEqual(['N'])
      expect(graph.subgraphs.find(group => group.id === 'Outer')?.nodeIds).toEqual(['A', note.nodeId])
      expect(graph.edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'N']])
    }
    const renamed = apply(diagram, { kind: 'rename_state', from: 'N', to: 'Target' })
    expect(renamed.body.floatingNotes).toEqual(diagram.body.floatingNotes)
    expect(state(serializeMermaid(renamed)).body).toEqual(renamed.body)
  })
  test('quoted pseudostate-looking labels preserve literal text and nested identity through portable export', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const [source, id, label] of [
        ['stateDiagram state "<<choice>>" as N{g\n}', 'N', '<<choice>>'],
        ['stateDiagram state "<<join>>" as N{C }', 'N', '<<join>>'],
        ['stateDiagram state "<<join>>state " as s', 's', '<<join>>state '],
        ['stateDiagram-v2\nstate "Before <<fork>> after" as s', 's', 'Before <<fork>> after'],
        ['stateDiagram-v2\nstate "Before [[choice]] after" as s', 's', 'Before [[choice]] after'],
      ] as const) {
        const diagram = state(source)
        const written = serializeMermaid(diagram)
        expect(await upstream.accepts(written), source).toBe(true)
        expect(state(written).body.states.find(node => node.id === id)?.label).toBe(label)
        expect(describeMermaidFacts(state(written))).toEqual(describeMermaidFacts(diagram))
        expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
        expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(source))
        const edited = apply(diagram, { kind: 'set_state_label', id, label: 'Updated <<join>> and [[fork]]' })
        const exported = serializeMermaid(edited)
        expect(await upstream.accepts(exported)).toBe(true)
        expect(state(exported).body.states.find(node => node.id === id)?.label).toBe('Updated <<join>> and [[fork]]')
        expect(describeMermaidFacts(state(exported))).toEqual(describeMermaidFacts(edited))
      }
    } finally { upstream.close() }
  })

  test('bare as after a quoted alias remains a distinct state through export and edits', async () => {
    const source = 'stateDiagram-v2 state "s" as 1\nas'
    const diagram = state(source)
    const written = serializeMermaid(diagram)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(written)).toBe(true)
      expect(state(written).body).toEqual(diagram.body)
      expect(diagram.body.states.map(node => [node.id, node.label])).toEqual([['1', 's'], ['as', undefined]])
      expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
      expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(source))
      const edited = apply(diagram, { kind: 'add_transition', from: 'as', to: '1' })
      const exported = serializeMermaid(edited)
      expect(await upstream.accepts(exported)).toBe(true)
      expect(state(exported).body.transitions).toEqual([{ from: 'as', to: '1' }])
    } finally { upstream.close() }
  })

  test('nonportable style targets retain native output in opaque source and refuse typed output', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const target of ['-', 'not-defined', 'é']) {
        const source = `stateDiagram t\nstyle ${target} d:#\n`
        const parsed = parseMermaid(source)
        if (!parsed.ok) throw new Error('Expected preserved State')
        expect(parsed.value.body.kind).toBe('opaque')
        expect(serializeMermaid(parsed.value)).toBe(source)
        expect(await upstream.accepts(source)).toBe(false)
        expect(renderAgentSVG(parsed.value)).toBe(renderMermaidSVG(source))
        expect(renderAgentASCII(parsed.value)).toBe(renderMermaidASCII(source))
        expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'state_style_target' }))
        const body = { ...state('stateDiagram-v2\nt').body, unresolvedStyles: [{ id: target, style: { d: '#' } }] }
        expect(synthesizeFromGraph({ kind: 'state', body })).toMatchObject({ ok: false })
      }
      const diagram = state('stateDiagram-v2\nstate "Ready" as not_defined')
      const edited = apply(diagram, { kind: 'set_state_style', id: 'not_defined', style: 'fill:#abc' })
      expect(await upstream.accepts(serializeMermaid(edited))).toBe(true)
      const nonportable = state('stateDiagram-v2\nstate "Ready" as not-defined')
      expect(mutate(nonportable, { kind: 'set_state_style', id: 'not-defined', style: 'fill:#abc' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
    } finally { upstream.close() }
  })

  test('directive-looking labels and note terminator prefixes survive public export and typed edits', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const source of [
        'stateDiagram state "%%{1" as n',
        'stateDiagram-v2\nstate "Small State%%{1" as n',
        'stateDiagram-v2\nnote "%%{1" as n',
        'stateDiagram-v2\nstate "Group %%{literal" as Group {\nA --> B : label %%{literal\n}\nnote right of A\nfirst line\nend note nside the note e text\nend note',
        'stateDiagram-v2\nState1\nnote right of State1\nthis sentence contains\nA:::c --> B\nend note as part of the note text\nend note\nState1 --> State2',
      ]) {
        const diagram = state(source)
        const written = serializeMermaid(diagram)
        expect(await upstream.publicAccepts(written), written).toBe(true)
        expect(describeMermaidFacts(state(written))).toEqual(describeMermaidFacts(diagram))
        expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
        expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(source))
        expect(serializeMermaid(state(written))).toBe(written)
      }
      let edited = apply(state('stateDiagram-v2\nA --> B'), { kind: 'set_state_label', id: 'A', label: '%%{title}%%' })
      edited = apply(edited, { kind: 'set_transition_label', index: 0, label: '%%{edge}%%' })
      edited = apply(edited, { kind: 'add_note', target: 'A', side: 'right', text: '%%{first}%%\nEND NOTE still text' })
      edited = apply(edited, { kind: 'add_floating_note', id: 'A', text: '%%{floating}%%' })
      const written = serializeMermaid(edited)
      expect(await upstream.publicAccepts(written)).toBe(true)
      const reloaded = state(written)
      expect(reloaded.body.states.find(node => node.id === 'A')?.label).toBe('%%{title}%%')
      expect(reloaded.body.transitions[0]?.label).toBe('%%{edge}%%')
      expect(reloaded.body.notes?.[0]?.text).toBe('%%{first}%%\nEND NOTE still text')
      expect(reloaded.body.floatingNotes).toMatchObject([{ id: 'A', text: '%%{floating}%%' }])
      expect(describeMermaidFacts(reloaded)).toEqual(describeMermaidFacts(edited))
      expect(renderAgentSVG(reloaded)).toBe(renderAgentSVG(edited))
      expect(renderAgentASCII(reloaded)).toBe(renderAgentASCII(edited))
    } finally { upstream.close() }
  })

  test('nonportable class definitions and labeled accessibility endpoints preserve source without authoring invalid output', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const [source, syntax] of [
        ['stateDiagram classDef - s:i\nt-->[*]\n', 'state_class_definition_name'],
        ['stateDiagram-v2\nA\nclassDef default fill:red\n', 'state_class_definition_name'],
        ['stateDiagram-v2\nclassDef mov--ment font-style:italic\nA:::mov--ment --> B\n', 'state_class_definition_name'],
        ['stateDiagram 2-->accDescr:d\n', 'state_accessibility_endpoint'],
        ['stateDiagram-v2\nstate Group {\nA --> ACCTitle : nested\n}\nA --> ACCTitle : root\n', 'state_accessibility_endpoint'],
      ]) {
        const parsed = parseMermaid(source!)
        if (!parsed.ok) throw new Error('Expected preserved State')
        expect(parsed.value.body.kind).toBe('opaque')
        expect(serializeMermaid(parsed.value)).toBe(source!)
        expect(renderAgentSVG(parsed.value)).toBe(renderMermaidSVG(source!))
        expect(renderAgentASCII(parsed.value)).toBe(renderMermaidASCII(source!))
        expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax }))
      }
      for (const name of ['-', 'mov--ment', 'default', 'DEFAULT']) {
        const diagram = state('stateDiagram-v2\nA')
        expect(mutate(diagram, { kind: 'define_class', name, style: 'fill:red' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
        expect(synthesizeFromGraph({ kind: 'state', body: { ...diagram.body, classDefs: { [name]: { fill: 'red' } } } })).toMatchObject({ ok: false })
      }
      for (const name of ['accDescr', 'ACCTitle']) {
        const diagram = state(`stateDiagram-v2\nA --> ${name}`)
        expect(await upstream.publicAccepts(serializeMermaid(diagram))).toBe(true)
        expect(mutate(diagram, { kind: 'set_transition_label', index: 0, label: 'd' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
        expect(mutate(diagram, { kind: 'add_transition', from: 'A', to: name, label: 'd' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
        expect(synthesizeFromGraph({ kind: 'state', body: { ...diagram.body, transitions: [{ from: 'A', to: name, label: 'd' }] } })).toMatchObject({ ok: false })
      }
      const portable = state('stateDiagram-v2\naccDescr--> A : kept\nA --> accTitle\nA --> accDescr1 : kept too\nclass A a-b\nclassDef __proto__ fill:red\nclassDef default1 color:blue')
      const written = serializeMermaid(portable)
      expect(await upstream.publicAccepts(written)).toBe(true)
      expect(state(written).body).toEqual(portable.body)
      expect(renderMermaidSVG(written)).toBe(renderAgentSVG(portable))
      expect(apply(portable, { kind: 'set_state_class', id: 'A', className: 'a-b' }).body.states.find(node => node.id === 'A')?.className).toBe('a-b')
    } finally { upstream.close() }
  })

  test('accessibility endpoint portability follows the transition scope rather than the state identity', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const sources = [
        'stateDiagram-v2\nstate Outer {\nA --> accTitle : title label\n}',
        'stateDiagram-v2\nstate Outer {\nA --> accDescr : description label\n}',
        'stateDiagram-v2\nstate "Destination" as ACCTitle\nstate Outer {\nstate Inner {\nA --> ACCTitle : reused outer ID\n}\n}',
        'stateDiagram-v2\nstate Outer {\nA --> accTitle : first region\n--\nB --> accDescr : second region\n}',
      ]
      for (const body of sources) {
        const source = `---\ntitle: Scope check\n---\n%% retained comment\n${body.replace('stateDiagram-v2', 'stateDiagram-v2\naccTitle: Accessible title\naccDescr: Accessible description')}\n`
        expect(await upstream.publicAccepts(source), source).toBe(true)
        const diagram = state(source)
        const written = serializeMermaid(diagram)
        expect(await upstream.publicAccepts(written), written).toBe(true)
        expect(verifyMermaid(diagram).warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'state_accessibility_endpoint')).toBe(false)
        expect(state(written).body).toEqual(diagram.body)
        expect(state(written).meta.accessibility).toEqual({ title: 'Accessible title', descr: 'Accessible description' })
        expect(written).toContain('%% retained comment')
        expect(renderMermaidSVG(written)).toBe(renderMermaidSVG(source))
        // Canonical declaration order can change terminal placement. The
        // terminal projection must retain identities, parents, text and edges.
        const terminalMeaning = (input: string) => {
          const terminal = renderMermaidASCIIWithMeta(input, { colorMode: 'none' })
          expect(terminal.warnings.filter(warning => warning.code === 'ASCII_RENDER_FAILED')).toEqual([])
          return terminal.regions.map(({ id, kind, parentId, from, to, projectedText }) => ({ id, kind, parentId, from, to, projectedText })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        }
        expect(terminalMeaning(written)).toEqual(terminalMeaning(source))
        const projected = await upstream.projectAll([source, written], d => d.db.getData().edges.map((edge: any) => ({ from: edge.start, to: edge.end, label: edge.label })))
        expect(projected[1]).toEqual(projected[0])
      }
      let edited = state(sources[0]!)
      edited = apply(edited, { kind: 'set_transition_label', parent: 'Outer', index: 0, label: 'edited label' })
      edited = apply(edited, { kind: 'add_transition', parent: 'Outer', from: 'A', to: 'accDescr', label: 'new label' })
      const written = serializeMermaid(edited)
      expect(await upstream.publicAccepts(written)).toBe(true)
      expect(state(written).body).toEqual(edited.body)
      // Hoisting the same transition changes the lexer context and must not
      // allow a successful edit to produce an invalid top-level transition.
      expect(mutate(edited, { kind: 'dissolve_composite', id: 'Outer' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
      for (const name of ['accTitle', 'accDescr']) {
        const source = `stateDiagram-v2\nstate Outer {\nA --> ${name} : valid nested\n}\nA --> ${name} : invalid root\n`
        expect(await upstream.publicAccepts(source)).toBe(false)
        const parsed = parseMermaid(source)
        if (!parsed.ok) throw new Error('Expected preserved root transition')
        expect(parsed.value.body.kind).toBe('opaque')
        expect(serializeMermaid(parsed.value)).toBe(source)
        expect(unsupportedSyntax(source).filter(warning => warning.startsWith('state_accessibility_endpoint@'))).toEqual(['state_accessibility_endpoint@5'])
      }
    } finally { upstream.close() }
  })

  test('writes accepted State descriptions, notes and reserved endpoint spellings without changing their text', async () => {
    const cases = [
      ['namedState1: Small St"ate 1', 'namedState1', 'Small St"ate 1'],
      ['foo: b note "Quoted" as N1', 'foo', 'b note "Quoted" as N1'],
      ['A --> State: continue', 'State', undefined],
      ['state assstateDiagram-v2', 'assstateDiagram-v2', undefined],
      ['style note fill:#ff0000', 'note', undefined],
    ] as const
    const upstream = startUpstreamMermaid()
    try {
      for (const [body, id, label] of cases) {
        const source = `stateDiagram-v2\n${body}`
        const diagram = state(source)
        const serialized = serializeMermaid(diagram)
        expect(await upstream.accepts(source), source).toBe(true)
        expect(await upstream.accepts(serialized), serialized).toBe(true)
        expect(diagram.body.states.find(node => node.id === id)?.label).toBe(label)
        expect(state(serialized).body).toEqual(diagram.body)
        const graph = parseRenderGraph(serialized)
        if (/^(?:style|class) /.test(body)) expect(graph.nodes.has(id)).toBe(false)
        else expect(graph.nodes.get(id)?.label).toBe(label ?? id)
      }
      for (const text of ['fill:white    a note with punctuation', 'this sentence: keeps its colon']) {
        const source = `stateDiagram-v2\nState1\nnote right of State1\n${text}\nend note\nState1 --> State2`
        const diagram = state(source)
        const serialized = serializeMermaid(diagram)
        expect(await upstream.accepts(source)).toBe(true)
        expect(await upstream.accepts(serialized), serialized).toBe(true)
        expect(diagram.body.notes).toEqual([{ target: 'State1', side: 'right', text }])
        expect(state(serialized).body.notes).toEqual(diagram.body.notes)
        expect(parseRenderGraph(serialized).stateNotes?.[0]?.text).toBe(text)
      }
    } finally {
      upstream.close()
    }
  })

  test('a class operand whose word prefix Mermaid accepts stays source-only with its complete target', async () => {
    const source = 'stateDiagram-v2\nclass S--econd pinned'
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      const parsed = parseMermaid(source)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source + '\n')
      expect(unsupportedSyntax(source)).toContain('state_class_target@2')
      expect(parseRenderGraph(source).nodes.has('S--econd')).toBe(false)
    } finally { upstream.close() }
  })

  test('paint assignments preserve undeclared targets without inventing states, and resolve later declarations', async () => {
    const source = `stateDiagram-v2
  classDef hot fill:#ff0000
  class Missing hot
  style Missing stroke:#00ff00
  class end hot
  class Future hot
  Future --> Ready
`
    const diagram = state(source)
    expect(diagram.body.states.map(node => node.id).sort()).toEqual(['Future', 'Ready'])
    expect(diagram.body.states.find(node => node.id === 'Future')?.className).toBe('hot')
    const canonical = serializeMermaid(diagram)
    expect(canonical).toContain('class Missing hot')
    expect(canonical).toContain('class end hot')
    expect(canonical).toContain('style Missing stroke:#00ff00')
    expect(state(canonical).body).toEqual(diagram.body)
    const upstream = startUpstreamMermaid()
    try {
      const originals = await upstream.projectAll([source, canonical], d =>
        d.db
          .getData()
          .nodes.map((node: any) => ({ id: node.id, classes: node.cssClasses }))
          .sort((a: any, b: any) => a.id.localeCompare(b.id)),
      )
      expect(originals[0]).toEqual(originals[1])
      expect(originals[0]?.map((node: { id: string }) => node.id)).toEqual(['Future', 'Ready'])
    } finally {
      upstream.close()
    }
    for (const input of [source, canonical]) {
      const graph = parseRenderGraph(input)
      expect([...graph.nodes.keys()].sort()).toEqual(['Future', 'Ready'])
      expect(graph.classAssignments.get('Missing')).toBe('hot')
      expect(graph.nodeStyles.get('Missing')).toEqual({ stroke: '#00ff00' })
      expect(renderMermaidSVG(input)).not.toContain('data-id="Missing"')
      expect(renderMermaidASCII(input)).not.toContain('Missing')
    }
    const added = apply(diagram, { kind: 'add_state', id: 'Missing' })
    expect(added.body.states.find(node => node.id === 'Missing')).toMatchObject({ className: 'hot', style: { stroke: '#00ff00' } })
    expect(state(serializeMermaid(added)).body).toEqual(added.body)
    expect(diagram.body.states.some(node => node.id === 'Missing')).toBe(false)
  })

  test('a classed transition followed by a standalone state preserves both statements', async () => {
    const source = 'stateDiagram-v2\nMoving --> Crash:::mov pinnedement'
    const diagram = state(source)
    expect(diagram.body.transitions).toEqual([{ from: 'Moving', to: 'Crash' }])
    expect(diagram.body.states.map(node => node.id).sort()).toEqual(['Crash', 'Moving', 'pinnedement'])
    expect(diagram.body.states.find(node => node.id === 'Crash')?.className).toBe('mov')
    const serialized = serializeMermaid(diagram)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      upstream.close()
    }
    for (const text of [source, serialized]) {
      const graph = parseRenderGraph(text)
      expect(graph.edges.map(edge => [edge.source, edge.target, edge.label])).toEqual([['Moving', 'Crash', undefined]])
      expect(graph.nodes.has('pinnedement')).toBe(true)
      expect(graph.classAssignments.get('Crash')).toBe('mov')
    }
    expect(state(serialized).body).toEqual(diagram.body)
  })

  test.each([
    ['state A\nstate "Running" as A\nA --> B', 'Running'],
    ['state "A" as A\nstate "Running" as A\nA --> B', 'A'],
    ['A --> B\nstate "Running" as A', 'Running'],
    ['state A\nA : First\nA : Second\nA --> B', 'First\nSecond'],
    ['A : First\nA : Second\nstate A {\nB --> C\n}', 'First\nSecond'],
  ])('retains State labels after declarations and repeated descriptions: %s', async (body, label) => {
    const source = `stateDiagram-v2\n${body}`
    const diagram = state(source)
    expect(diagram.body.states.find(node => node.id === 'A')?.label).toBe(label)
    const serialized = serializeMermaid(diagram)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      upstream.close()
    }
    expect(state(serialized).body.states.find(node => node.id === 'A')?.label).toBe(label)
    for (const input of [source, serialized]) {
      const graph = parseRenderGraph(input)
      expect(graph.nodes.get('A')?.label ?? graph.subgraphs.find(group => group.id === 'A')?.label).toBe(label)
      for (const part of label.split('\n')) expect(renderMermaidSVG(input)).toContain(part)
      const verified = verifyMermaid(input)
      expect(verified.ok).toBe(true)
      expect(verified.layout.nodes.find(node => node.id === 'A')?.label ?? verified.layout.groups.find(group => group.id === 'A')?.label).toBe(label)
    }
  })

  test('full-line slash comments preserve source without hiding drawing content or note text', () => {
    const source = 'stateDiagram-v2\n// A --> Ghost\nA --> B\nnote right of A\n// literal note text\nend note'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(parseRenderGraph(source).edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'B']])
    expect(renderMermaidSVG(source)).toContain('// literal note text')
    expect(verifyMermaid(source).ok).toBe(true)
    const commentedDelimiter = 'stateDiagram-v2\n// A["` @{\nA --> B'
    expect(parseRenderGraph(commentedDelimiter).edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'B']])
    expect(() => renderMermaidSVG(`${commentedDelimiter}\nbogus -->`)).toThrow('Unsupported state syntax: "bogus -->"')
  })

  test.each(['scale 350 width', 'hide empty description'])('preserves and warns about an unapplied State layout directive: %s', async directive => {
    const source = `stateDiagram-v2\nA --> B\n${directive}`
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      upstream.close()
    }
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(parseRenderGraph(source).edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'B']])
    expect(renderMermaidSVG(source)).toContain('>A</text>')
    const verified = verifyMermaid(source)
    expect(verified.ok).toBe(true)
    expect(verified.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_SYNTAX',
        syntax: 'state_layout_directive',
        message: expect.stringContaining(directive),
      }),
    )
    expect(verified.warnings.some(warning => warning.code === 'RENDER_FAILED')).toBe(false)
  })

  test('State layout-directive recognition leaves note text literal and rejects malformed lookalikes', () => {
    const source = 'stateDiagram-v2\n// source comment\nA --> B\nnote right of A\nscale 350 width\nhide empty description\nend note'
    expect(renderMermaidSVG(source)).toContain('scale 350 width')
    expect(verifyMermaid(source).warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'state_layout_directive')).toBe(false)
    const accessibility = verifyMermaid('stateDiagram-v2\naccDescr {\nscale 350 width\n}\nA --> B\n// comment')
    expect(accessibility.ok).toBe(true)
    expect(accessibility.warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'state_layout_directive')).toBe(false)
    const multiple = verifyMermaid('stateDiagram-v2\nA --> B\nscale 350 width\nhide empty description')
    const warning = multiple.warnings.find(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'state_layout_directive')
    expect(warning).toEqual(expect.objectContaining({ message: expect.stringContaining('scale 350 width') }))
    expect(warning).toEqual(expect.objectContaining({ message: expect.stringContaining('hide empty description') }))
    for (const directive of ['scale diagonal width', 'hide empty description extra']) {
      expect(() => renderMermaidSVG(`stateDiagram-v2\nA --> B\n${directive}`)).toThrow(`Unsupported state syntax: "${directive}"`)
    }
  })

  test.each(['state "First<br/>second" as A\nA --> B', 'A --> B : First<br/>second'])('writes normalized label breaks without introducing unknown body lines: %s', body => {
    const source = `stateDiagram-v2\n${body}`
    const diagram = state(source)
    const serialized = serializeMermaid(diagram)
    expect(serialized).toContain('First<br/>second')
    expect(state(serialized).body).toEqual(diagram.body)
    expect(verifyMermaid(diagram).ok).toBe(true)
    expect(renderMermaidSVG(serialized)).toContain('second')
  })

  test.each([
    ['bogus -->', ''],
    ['state A <<unknown>>', ''],
    ['direction diagonal', ''],
    // Mermaid reads the rest of the line after `as` as one name, which ours
    // cannot hold, and rejects `as` after an unquoted name.
    ['state "Long name" as X Y', ' — expected one word after `as`; pinned Mermaid reads "X Y" as one name'],
    ['state X as Y', ''],
    ['state X as', ''],
  ])('rejects unknown State content instead of drawing a partial diagram: %s', (statement, guidance) => {
    const source = `stateDiagram-v2\nA --> B\n${statement}`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(() => renderMermaidSVG(source)).toThrow(`Unsupported state syntax: "${statement}"${guidance}`)
    const verified = verifyMermaid(source)
    expect(verified.ok).toBe(false)
    expect(verified.warnings).toContainEqual(
      expect.objectContaining({
        code: 'RENDER_FAILED',
        reason: expect.stringContaining(statement),
      }),
    )
  })

  test('literal percent pairs survive State labels, notes, edits and source-loss receipts', async () => {
    const source = `stateDiagram-v2
state "100%% alias" as A
B : 100%% description
A --> B : 100%% transition
note right of A : 100%% inline
B --> C %% real comment`
    const diagram = state(source)
    expect(diagram.body.states.find(node => node.id === 'A')?.label).toBe('100%% alias')
    expect(diagram.body.states.find(node => node.id === 'B')?.label).toBe('100%% description')
    expect(diagram.body.transitions[0]?.label).toBe('100%% transition')
    expect(diagram.body.notes?.[0]?.text).toBe('100%% inline')
    expect(diagram.meta.comments).toEqual([{ text: 'real comment', line: 6 }])
    expectRetainedComment(diagram, 'B --> C\n%% real comment\n')
    const edited = apply(diagram, { kind: 'add_state', id: 'Added' })
    const written = expectRetainedComment(edited, 'B --> C\n%% real comment\n')
    expect(describeMermaidFacts(state(written))).toEqual(describeMermaidFacts(edited))
    const upstream = startUpstreamMermaid()
    try {
      const labels = await upstream.project(written, diagram => diagram.db.rootDoc.flatMap((item: any) => (item.description ? [item.description] : item.note ? [item.note.text] : [])))
      expect(labels).toEqual({ ok: true, value: ['100%% alias', '100%% description', '100%% transition', '100%% inline'] })
    } finally {
      upstream.close()
    }
    for (const input of [source, written]) {
      const graph = parseRenderGraph(input)
      expect(graph.nodes.get('A')?.label).toBe('100%% alias')
      expect(graph.edges[0]?.label).toBe('100%% transition')
      for (const label of ['100%% alias', '100%% description', '100%% transition', '100%% inline']) {
        expect(renderMermaidSVG(input)).toContain(label)
        expect(renderMermaidASCII(input)).toContain(label)
      }
    }
  })

  test('block-note percent lines remain text while end-note comments keep physical receipts', async () => {
    const source = `---
config:
  theme: default
---
stateDiagram-v2
A --> B
note right of A
%% literal note line
100%% block
state Fake {
end note %% end comment`
    const diagram = state(source)
    const expected = '%% literal note line\n100%% block\nstate Fake {'
    expect(diagram.body.notes?.[0]?.text).toBe(expected)
    expect(diagram.body.states.map(node => node.id)).toEqual(['A', 'B'])
    expect(parseRenderGraph(source.slice(source.indexOf('stateDiagram'))).stateNotes?.[0]?.text).toBe(expected)
    expect(diagram.meta.comments).toEqual([{ text: 'end comment', line: 11 }])
    expectRetainedComment(diagram, 'end note\n%% end comment\n')
    const edited = apply(diagram, { kind: 'add_state', id: 'Added' })
    const written = expectRetainedComment(edited, 'end note\n%% end comment\n')
    expect(state(written).body.notes).toEqual(edited.body.notes)
    expect(describeMermaidFacts(state(written))).toEqual(describeMermaidFacts(edited))
    expect(renderMermaidSVG(written)).toContain('%% literal note line')
    expect(renderMermaidASCII(written)).toContain('%% literal note line')
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(written)).toBe(true)
    } finally {
      upstream.close()
    }
  })

  test('trailing Mermaid comments preserve transition topology in both parsers', () => {
    const source = `stateDiagram-v2
      A --> B %% legal trailing comment
      B --> C`
    const diagram = state(source)
    expect(diagram.body.transitions).toEqual([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ])
    const graph = parseRenderGraph(source)
    expect(graph.edges.map(edge => [edge.source, edge.target])).toEqual([
      ['A', 'B'],
      ['B', 'C'],
    ])
    const written = expectRetainedComment(diagram, 'A --> B\n%% legal trailing comment\n  B --> C')
    expect(state(written).body.transitions).toEqual(diagram.body.transitions)
    const edited = apply(diagram, { kind: 'add_state', id: 'Added' })
    expectRetainedComment(edited, 'A --> B\n%% legal trailing comment\n  B --> C')
  })

  test('State header comments and comment-only delimiters never create or erase transitions', () => {
    for (const [source, comment] of [
      ['stateDiagram-v2 %% heading; Bogus --> Edge\nA --> B', '%% heading; Bogus --> Edge'],
      ['stateDiagram-v2\nA --> B %% ; Bogus --> Edge\nB --> C', '%% ; Bogus --> Edge'],
      ['stateDiagram-v2\nA --> B %% `\nB --> C', '%% `'],
      ['stateDiagram-v2\nA --> B %% @{\nB --> C', '%% @{'],
    ] as const) {
      const expected = source.includes('heading')
        ? [['A', 'B']]
        : [
            ['A', 'B'],
            ['B', 'C'],
          ]
      expect(state(source).body.transitions.map(transition => [transition.from, transition.to])).toEqual(expected)
      expect(parseRenderGraph(source).edges.map(edge => [edge.source, edge.target])).toEqual(expected)
      const diagram = state(source)
      const fragment = source.includes('heading') ? `${comment}\n  A --> B` : `A --> B\n${comment}\n  B --> C`
      expectRetainedComment(diagram, fragment)
      const edited = apply(diagram, { kind: 'add_state', id: 'Added' })
      const written = expectRetainedComment(edited, fragment)
      expect(state(written).body.transitions.map(transition => [transition.from, transition.to])).toEqual(expected)
    }
  })

  test('retained trailing comments keep authored receipts after frontmatter and init directives', () => {
    const source = `---
config:
  theme: default
---
%%{init: {"theme":"default"}}%%
stateDiagram-v2
  A --> B %% note`
    const diagram = state(source)
    expect(diagram.meta.comments).toEqual([{ text: 'note', line: 7 }])
    expectRetainedComment(diagram, 'A --> B\n%% note\n')
    expectRetainedComment(apply(diagram, { kind: 'add_state', id: 'Added' }), 'A --> B\n%% note\n')
  })

  test('spaced comma-separated State class targets retain both paint assignments', () => {
    const source = `stateDiagram-v2
      Moving --> Crash
      classDef movement fill:#ff0000
      class Moving, Crash movement`
    const diagram = state(source)
    expect(diagram.body.states.find(item => item.id === 'Moving')?.className).toBe('movement')
    expect(diagram.body.states.find(item => item.id === 'Crash')?.className).toBe('movement')
    const graph = parseRenderGraph(source)
    expect(graph.classAssignments.get('Moving')).toBe('movement')
    expect(graph.classAssignments.get('Crash')).toBe('movement')
    expect(parseRenderGraph(serializeMermaid(diagram)).classAssignments).toEqual(graph.classAssignments)
    const svg = renderMermaidSVG(source)
    for (const id of ['Moving', 'Crash']) {
      expect(svg).toMatch(new RegExp(`<rect[^>]*fill="#ff0000"[^>]*data-id="node-shape:${id}"`))
    }
  })

  test('models concurrency regions and lets region-addressed edits round-trip', () => {
    let diagram = state(`stateDiagram-v2
      state parallel-work {
        [*] --> Left
        --
        Right --> [*]
      }`)
    const composite = diagram.body.states.find(item => item.id === 'parallel-work')!
    expect(composite.regions).toHaveLength(2)
    expect(composite.regions![0]!.states.some(item => item.id === 'Left')).toBe(true)
    expect(composite.regions![1]!.states.some(item => item.id === 'Right')).toBe(true)

    diagram = apply(diagram, { kind: 'add_state', id: 'Audit', parent: 'parallel-work', region: 1 })
    diagram = apply(diagram, { kind: 'add_transition', from: 'Right', to: 'Audit', parent: 'parallel-work', region: 1 })
    const serialized = serializeMermaid(diagram)
    expect(serialized).toContain('  --')
    expect(serialized.indexOf('Audit')).toBeGreaterThan(serialized.indexOf('  --'))
    expect(parseRenderGraph(serialized).subgraphs[0]!.children).toHaveLength(2)
    expect(state(serialized).body.states[0]!.regions![1]!.transitions).toContainEqual({ from: 'Right', to: 'Audit' })
  })

  test('models classDef, class/cssClass, inline style, and linkStyle paint', () => {
    let diagram = state(`stateDiagram-v2
      A --> B
      classDef hot fill:#ff0000,stroke:#220000
      class A hot
      style B fill:#00ff00
      linkStyle 0 stroke:#0000ff`)
    expect(diagram.body.classDefs?.hot?.fill).toBe('#ff0000')
    expect(diagram.body.states.find(item => item.id === 'A')?.className).toBe('hot')
    expect(diagram.body.states.find(item => item.id === 'B')?.style?.fill).toBe('#00ff00')
    expect(diagram.body.transitions[0]?.style?.stroke).toBe('#0000ff')

    diagram = apply(diagram, { kind: 'define_class', name: 'cool', style: 'fill:#abcdef,stroke:#123456' })
    diagram = apply(diagram, { kind: 'set_state_class', id: 'B', className: 'cool' })
    diagram = apply(diagram, { kind: 'set_state_style', id: 'A', style: 'stroke-width:4px' })
    diagram = apply(diagram, { kind: 'set_transition_style', index: 0, style: 'stroke:#654321' })
    const graph = parseRenderGraph(serializeMermaid(diagram))
    expect(graph.classDefs.get('cool')?.fill).toBe('#abcdef')
    expect(graph.classAssignments.get('B')).toBe('cool')
    expect(graph.nodeStyles.get('A')?.['stroke-width']).toBe('4px')
    expect(graph.linkStyles.get(0)?.stroke).toBe('#654321')
  })

  test.each([
    { fields: ['font:24px monospace!important', 'font:12px serif'] },
    { fields: ['font:24px monospace', 'font:bogus'] },
    { fields: ['font:10px serif', 'font-size:24px', 'font:12px serif'] },
  ])('State retains repeated CSS across source, mutation and JSON: %j', async ({ fields }) => {
    const upstream = startUpstreamMermaid()
    try {
      for (const definition of [false, true]) {
        const source = definition
          ? `stateDiagram-v2\nA\nclass A hot\n${fields.map(field => `classDef hot ${field}`).join('\n')}`
          : `stateDiagram-v2\nA\nstyle A ${fields.join(',')}`
        const parsed = state(source)
        const op: StateMutationOp = definition ? { kind: 'define_class', name: 'hot', style: fields.join(',') } : { kind: 'set_state_style', id: 'A', style: fields.join(',') }
        const edited = apply(state('stateDiagram-v2\nA\nclass A hot'), op)
        for (const diagram of [parsed, edited]) {
          const synthesized = synthesizeFromGraph(JSON.parse(JSON.stringify({ kind: 'state', body: diagram.body })))
          if (!synthesized.ok) throw new Error(JSON.stringify(synthesized.error))
          const written = serializeMermaid(synthesized.value)
          expect(serializeMermaid(state(written))).toBe(written)
          const projection = await upstream.project(written, d => ({ node: d.db.getStates().get('A').styles, definitions: d.db.getClasses().get('hot')?.styles ?? [] }))
          expect(projection).toEqual({ ok: true, value: { node: definition ? [] : fields, definitions: definition ? fields : [] } })
          const renamed = apply(diagram, { kind: 'rename_state', from: 'A', to: 'B' })
          expect(serializeMermaid(renamed)).toContain(fields.join(','))
          const replaced = apply(diagram, { ...op, style: 'font:32px serif' })
          expect(replaced.body.states[0]!.styleDeclarations).toBeUndefined()
          expect(replaced.body.classDefDeclarations).toBeUndefined()
          const body = structuredClone(diagram.body)
          if (definition) body.classDefs!.hot!.font = '32px serif'
          else body.states[0]!.style!.font = '32px serif'
          expect(synthesizeFromGraph({ kind: 'state', body }).ok).toBe(false)
        }
      }
    } finally { upstream.close() }
  })

  test('each State inline style replaces the preceding statement, including unresolved styles', async () => {
    const source = 'stateDiagram-v2\nA\nstyle A font:24px monospace!important,font:12px serif\nstyle A margin:0'
    const parsed = state(source)
    expect(parsed.body.states[0]!.style).toEqual({ margin: '0' })
    expect(parsed.body.states[0]!.styleDeclarations).toBeUndefined()
    expect(parseRenderGraph(source).nodeStyles.get('A')).toEqual({ margin: '0' })
    const pending = state(source.replaceAll('style A ', 'style B '))
    const added = apply(pending, { kind: 'add_state', id: 'B' })
    expect(added.body.states.find(node => node.id === 'B')!.style).toEqual({ margin: '0' })
    expect(added.body.states.find(node => node.id === 'B')!.styleDeclarations).toBeUndefined()
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.project(serializeMermaid(parsed), d => d.db.getStates().get('A').styles)).toEqual({ ok: true, value: ['margin:0'] })
    } finally { upstream.close() }
  })

  test('State functional paints retain exact channel tokens and alpha through constructors and style consumers', async () => {
    const paints = [
      ['rgb(1,2,3)', 'rgb(1,2,3)'],
      ['rgba(1.125,2.25,3.5,.375)', 'rgba(1.125,2.25,3.5,.375)'],
      ['hsl(.125turn,20.25%,30.5%)', 'hsl(.125turn,20.25%,30.5%)'],
      ['hsla(10.125,20.25%,30.5%,37.5%)', 'hsla(10.125,20.25%,30.5%,37.5%)'],
      ['hsl(0 0% 0% / 0)', 'hsl(0 0% 0% / 0)'],
      ['var(--brand)', 'var(--brand)'],
    ] as const
    const upstream = startUpstreamMermaid()
    try {
      for (const [input, expected] of paints) {
        let diagram = state('stateDiagram-v2\nA')
        for (const op of [
          { kind: 'define_class', name: 'hot', style: `fill:${input}` },
          { kind: 'set_state_class', id: 'A', className: 'hot' },
          { kind: 'set_state_style', id: 'A', style: `stroke:${input}` },
          { kind: 'set_state_label', id: 'A', label: 'Ready' },
        ] as StateMutationOp[]) diagram = apply(diagram, op)
        expect(diagram.body.classDefs?.hot?.fill).toBe(expected)
        expect(diagram.body.states[0]!.style?.stroke).toBe(expected)
        const written = serializeMermaid(diagram)
        const reference = await upstream.project(written, d => ({
          definitions: d.db.getClasses().get('hot').styles,
          inline: d.db.getStates().get('A').styles,
          // compileStyles consumes these separate class and inline arrays,
          // in that order, rather than folding inline into cssCompiledStyles.
          rendered: d.db.getData().nodes.filter((node: { id: string }) => node.id === 'A').map((node: { cssCompiledStyles: string[]; cssStyles: string[] }) => ({ classes: node.cssCompiledStyles, inline: node.cssStyles })),
        }))
        if (!reference.ok) throw new Error(reference.error)
        expect({ definitions: reference.value.definitions.map(logicalStyle), inline: reference.value.inline.map(logicalStyle), rendered: reference.value.rendered.map((node: { classes: string[]; inline: string[] }) => ({ classes: node.classes.map(logicalStyle), inline: node.inline.map(logicalStyle) })) }).toEqual({ definitions: [`fill:${expected}`], inline: [`stroke:${expected}`], rendered: [{ classes: [`fill:${expected}`], inline: [`stroke:${expected}`] }] })
        expect(state(written).body).toEqual(diagram.body)
        expect(renderAgentSVG(diagram)).toBe(renderMermaidSVG(written))
        const raw = state(`stateDiagram-v2\nA\nclassDef hot fill:${input}\nclass A hot\nstyle A stroke:${input}`)
        expect(raw.body.classDefs?.hot?.fill).toBe(expected)
        expect(raw.body.states[0]!.style?.stroke).toBe(expected)
      }
      const original = state('stateDiagram-v2\nA'), before = serializeMermaid(original)
      const font = apply(original, { kind: 'set_state_style', id: 'A', style: 'font-family:Inter\\,serif' })
      expect(state(serializeMermaid(font)).body.states[0]!.style).toEqual({ 'font-family': 'Inter,serif' })
      expect(serializeMermaid(original)).toBe(before)
      expect(synthesizeFromGraph({ kind: 'state', body: { ...original.body, classDefs: { hot: { 'font-family': 'Inter,serif' } } } }).ok).toBe(true)
      const source = 'stateDiagram-v2\nA\nstyle A fill:red,font-family:Inter\\,serif\n'
      const retained = parseMermaid(source)
      if (!retained.ok) throw new Error(JSON.stringify(retained.error))
      expect(asState(retained.value)!.body.states[0]!.style).toEqual({ fill: 'red', 'font-family': 'Inter,serif' })
      expect(state(serializeMermaid(retained.value)).body).toEqual(asState(retained.value)!.body)
      expect(renderAgentSVG(retained.value)).toBe(renderMermaidSVG(source))
      expect(verifyMermaid(retained.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'state_style_commas' }))
    } finally { upstream.close() }
  })

  test('State style statements keep payloads out of lexer productions and preserve every field', async () => {
    const style = {
      fill: 'rgb(1,2,3)',
      'font-family': 'direction TB, "Inter, Text", serif',
      custom: 'var(--brand,rgb(1,2,3)) literal:#44; ﬂ°°44¶ß %%{wrap}%% <tag a="b"> \\\ end',
      stroke: '#123',
    }
    const upstream = startUpstreamMermaid()
    try {
      for (const id of ['A']) {
        const original = state('stateDiagram-v2\ndirection LR\nA')
        const built = synthesizeFromGraph({ kind: 'state', body: { ...original.body, states: original.body.states.map(node => ({ ...node, style })) } })
        if (!built.ok) throw new Error(JSON.stringify(built.error))
        const written = serializeMermaid(built.value)
        const reload = state(written)
        expect(reload.body.states[0]!.style).toEqual(style)
        const reference = await upstream.project(written, d => ({ direction: d.db.getDirection(), nodes: d.db.getData().nodes.map((node: { id: string; styles?: string[]; cssStyles?: string[] }) => ({ id: node.id, styles: node.styles ?? node.cssStyles })) }))
        if (!reference.ok) throw new Error(reference.error)
        expect(reference.value.direction).toBe('LR')
        expect(reference.value.nodes).toHaveLength(1)
        expect(reference.value.nodes[0]!.id).toBe(id)
        expect(reference.value.nodes[0]!.styles.map(logicalStyle)).toEqual([
          'fill:rgb(1,2,3)',
          'font-family:direction TB, "Inter, Text", serif',
          'custom:var(--brand,rgb(1,2,3)) literal:#44; ﬂ°°44¶ß %%{wrap}%% <tag a="b"> \\ end',
          'stroke:#123',
        ])
        expect(renderAgentSVG(built.value)).toBe(renderMermaidSVG(written))
      }
      // A mutable string also retains commas inside a quoted CSS font name.
      const original = state('stateDiagram-v2\nA')
      const changed = mutate(original, { kind: 'set_state_style', id: 'A', style: 'fill:red,font-family:"Inter, Text"' })
      if (!changed.ok) throw new Error(JSON.stringify(changed.error))
      expect(state(serializeMermaid(changed.value)).body.states[0]!.style).toEqual({ fill: 'red', 'font-family': '"Inter, Text"' })
    } finally { upstream.close() }
  })

  test('style entities are read before CSS backslash escapes without losing the following text', async () => {
    const source = String.raw`stateDiagram-v2\nA\nstyle A fill: blue,font-family: A\#44;B`.replaceAll('\\n', '\n')
    const diagram = state(source)
    expect(diagram.body.states[0]!.style).toEqual({ fill: 'blue', 'font-family': String.raw`A\,B` })
    const written = serializeMermaid(diagram)
    expect(state(written).body.states[0]!.style).toEqual({ fill: 'blue', 'font-family': String.raw`A\,B` })
    const pin = startUpstreamMermaid()
    try {
      const fields = await pin.project<string[]>(written, d => d.db.getData().nodes[0].cssStyles)
      if (!fields.ok) throw new Error(fields.error)
      expect(fields.value.map(logicalStyle)).toEqual(['fill:blue', String.raw`font-family:A\,B`])
    } finally { pin.close() }
  })

  test('label construction replaces the bare declaration flag and removing a label restores it', () => {
    const original = state('stateDiagram-v2\nA')
    const labeled = apply(original, { kind: 'set_state_label', id: 'A', label: 'Ready' })
    expect(labeled.body.states).toEqual([{ id: 'A', label: 'Ready', declarationBeforeTransition: 0 }])
    expect(state(serializeMermaid(labeled)).body).toEqual(labeled.body)
    const bare = apply(labeled, { kind: 'set_state_label', id: 'A', label: null })
    expect(bare.body).toEqual(original.body)
    expect(state(serializeMermaid(bare)).body).toEqual(bare.body)
  })

  test('a state Mermaid cannot read alone is written so that Mermaid draws it', async () => {
    // A hyphen ends a Mermaid name, a keyword before a line break starts its
    // statement, and `state X` declares nothing upstream.
    let diagram = state('stateDiagram-v2\n  state in-flight\n  state note\n  state State\n  hide\n  A')
    diagram = apply(diagram, { kind: 'add_state', id: 'classDef' })
    const serialized = serializeMermaid(diagram)
    expect(state(serialized).body).toEqual(diagram.body)
    const upstream = startUpstreamMermaid()
    try {
      const drawn = await upstream.project(serialized, mermaid =>
        mermaid.db
          .getData()
          .nodes.map((node: { id: string }) => node.id)
          .sort(),
      )
      expect(drawn).toEqual({ ok: true, value: ['A', 'State', 'classDef', 'hide', 'in-flight', 'note'] })
    } finally {
      upstream.close()
    }
  })

  test('a state keeps every class assigned to it, in order, as Mermaid does', async () => {
    const source = 'stateDiagram-v2\n  A:::a --> B\n  A:::b --> C\n  class A c'
    const diagram = state(source)
    expect(diagram.body.states.find(node => node.id === 'A')?.className).toBe('a b c')
    expect(parseRenderGraph(source).classAssignments.get('A')).toBe('a b c')
    const serialized = serializeMermaid(diagram)
    expect(state(serialized).body).toEqual(diagram.body)
    const upstream = startUpstreamMermaid()
    try {
      const classes = (mermaid: { db: any }) => mermaid.db.getData().nodes.find((node: { id: string }) => node.id === 'A').cssClasses
      expect(await upstream.projectAll([source, serialized], classes)).toEqual(['a b c statediagram-state', 'a b c statediagram-state'])
    } finally {
      upstream.close()
    }
    // Setting a state's class replaces them all.
    expect(apply(diagram, { kind: 'set_state_class', id: 'A', className: 'd' }).body.states.find(node => node.id === 'A')?.className).toBe('d')
  })

  test('reads Mermaid entity codes in State text, and writes them back as Mermaid reads them', async () => {
    const source = 'stateDiagram-v2\n  state "I #9829; states" as A\n  A : x #lt;b#gt;y#lt;/b#gt;\n  A --> B : t #35;1\n  note right of B : n #quot;q#quot;'
    const diagram = state(source)
    expect(diagram.body.states.find(node => node.id === 'A')?.label).toBe('I ♥ states\nx <b>y</b>')
    expect(diagram.body.transitions[0]?.label).toBe('t #1')
    expect(diagram.body.notes?.[0]?.text).toBe('n "q"')
    const graph = parseRenderGraph(source)
    expect([graph.nodes.get('A')?.label, graph.edges[0]?.label, graph.stateNotes?.[0]?.text]).toEqual(['I ♥ states\nx <b>y</b>', 't #1', 'n "q"'])
    // An entity-produced tag is text, not formatting.
    expect(renderMermaidSVG(source)).toContain('x &lt;b&gt;y&lt;/b&gt;')
    const serialized = serializeMermaid(diagram)
    expect(state(serialized).body).toEqual(diagram.body)
    // Text an edit gives is literal: its `#` is written so it stays one.
    const edited = apply(diagram, { kind: 'set_state_label', id: 'B', label: 'C#35; sharp' })
    expect(state(serializeMermaid(edited)).body.states.find(node => node.id === 'B')?.label).toBe('C#35; sharp')
    const upstream = startUpstreamMermaid()
    try {
      // A label and the descriptions under it, which ours writes as one label.
      const text = (mermaid: { db: any }) => {
        const data = mermaid.db.getData()
        return [...data.nodes.map((node: { id: string; label: string; description?: string[] }) => [node.id, [node.label, ...(node.description ?? [])].join('<br/>').replace(/<br\s*\/?\s*>/gi, '\n')]), ...data.edges.map((edge: { label: unknown }) => edge.label)]
      }
      const [original, written, writtenEdit] = await upstream.projectAll([source, serialized, serializeMermaid(edited)], text)
      expect(written).toEqual(original)
      expect(writtenEdit).toContainEqual(['B', 'Cﬂ°°35¶ß35; sharp'])
      // A `"` in the label of a state written `state "…" as X` is `#quot;`.
      const quoted = state('stateDiagram-v2\n  default : x"y')
      expect(quoted.body.states[0]?.label).toBe('x"y')
      expect(await upstream.projectAll([serializeMermaid(quoted)], text)).toEqual([[['default', 'xﬂ°quot¶ßy']]])
    } finally {
      upstream.close()
    }
  })

  test('writes a `;` or a colon run in a description or label so Mermaid reads the whole text, and reports it in source', async () => {
    // Mermaid's description token ends at `;`, at `::` and at a final `:`.
    const labels = ['a; b', 'a::b', 'ends:', 'x # y; z', 'classDef x:y; z']
    const sources = [...['a; b', 'a::b', 'ends:', 'x #35; y; z', 'classDef x:y; z'].map(text => `stateDiagram-v2\n  A --> B : ${text}`), 'stateDiagram-v2\n  A : say "hi"; ok', 'stateDiagram-v2\n  A:::hot : a;']
    const written = sources.map(source => serializeMermaid(state(source)))
    expect(
      sources.map(source => {
        const body = state(source).body
        return body.transitions[0]?.label ?? body.states[0]?.label
      }),
    ).toEqual([...labels, 'say "hi"; ok', 'a;'])
    expect(
      written.map(source => {
        const body = state(source).body
        return body.transitions[0]?.label ?? body.states[0]?.label
      }),
    ).toEqual([...labels, 'say "hi"; ok', 'a;'])
    expect(sources.map(unsupportedSyntax)).toEqual(sources.map(() => ['state_text_cut@2']))
    expect(written.map(unsupportedSyntax)).toEqual(written.map(() => []))
    // Mermaid reads these whole: a colon text or blank space follows, an
    // entity code, the text after `state "…" as`, and a block note.
    const whole = ['A : a:b', 'A --> B : ends: ', 'A --> B : a #59; b', 'state "x" as A : a; b', 'note right of A\n    a; b :: c:\n  end note'].map(body => `stateDiagram-v2\n  ${body}`)
    expect(whole.map(unsupportedSyntax)).toEqual(whole.map(() => []))
    // Verify reads the authored line, whose blanks the canonical one drops,
    // given the source or the diagram parsed from it.
    const blanks = ['---\ntitle: t\n---\nstateDiagram-v2\n  A --> B : ends: \n  B --> C : ends:', 'stateDiagram-v2\n  A --> B\n  note right of A\n    : \n  end note']
    const fromSource = blanks.map(unsupportedSyntax)
    expect(fromSource).toEqual([['state_text_cut@6'], ['state_note_block_colon@4']])
    expect(blanks.map(source => verifyMermaid(state(source)).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : []))).toEqual(fromSource)
    const upstream = startUpstreamMermaid()
    try {
      const read = await upstream.projectAll(written, mermaid => {
        const data = mermaid.db.getData()
        return data.edges[0]?.label ?? data.nodes.find((node: { id: string }) => node.id === 'A').label
      })
      expect(read.map(text => projectEntityMarkers(text))).toEqual([...labels, 'say "hi"; ok', 'a;'])
      expect(await upstream.projectAll(whole, mermaid => mermaid.db.rootDoc.flatMap((item: any) => (item.description ? [item.description] : item.note ? [item.note.text] : [])))).toEqual([['a:b'], ['ends:'], ['a ﬂ°°59¶ß b'], [['x', ' a; b']], ['a; b :: c:']])
    } finally {
      upstream.close()
    }
  })

  test("a `;` Mermaid's entity prepass drops from text is read as text, reported, and written so Mermaid keeps it", async () => {
    // Before it reads entity codes, Mermaid drops the `;` ending a line's
    // `style…:…#…;` run, then its `classDef…:…#…;` run, in that case only.
    const dropped = ['A : style:#f00; x', 'A --> B : style:#f00 x; y', 'A : classDef x:#fff; y', 'state "style:#f00; x" as A', 'note right of A\n    style:#f00; x\n  end note'].map(body => `stateDiagram-v2\n  ${body}`)
    expect(dropped.map(unsupportedSyntax)).toEqual([...Array(4).fill(['mermaid_cleanup@2']), ['mermaid_cleanup@3']])
    const kept = ['A : style: #f00; x', 'A : Style:#f00; x', 'A --> B\n  style A fill:#f00;'].map(body => `stateDiagram-v2\n  ${body}`)
    expect(kept.map(unsupportedSyntax)).toEqual(kept.map(() => []))
    // Ours reads the `;`, and an entity code it ends; the writer spells the
    // text's colons `#58;` there, so the prepass leaves the line whole.
    const ours = (source: string): string[] => {
      const graph = parseRenderGraph(source)
      return [...graph.edges.map(edge => edge.label ?? ''), ...[...graph.nodes.values()].flatMap(node => (node.label !== node.id ? [node.label] : [])), ...(graph.stateNotes ?? []).map(note => note.text)]
    }
    const read = [['style:&f00; x'], ['style:#f00 x; y'], ['classDef x:&fff; y'], ['style:&f00; x'], ['style:&f00; x']]
    expect(dropped.map(ours)).toEqual(read)
    const written = dropped.map(source => serializeMermaid(state(source)))
    expect(written.map(ours)).toEqual(read)
    expect(written.map(unsupportedSyntax)).toEqual(written.map(() => []))
    const texts = (mermaid: UpstreamDiagram): string[] => mermaid.db.rootDoc.flatMap((item: any) => (item.description ? [item.description] : item.note ? [item.note.text] : []))
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.projectAll(dropped, texts))
        .toEqual([['style:#f00 x'], ['style:#f00 x y'], ['classDef x:#fff y'], ['style:#f00 x'], ['style:#f00 x']])
      expect((await upstream.projectAll(written, texts)).map(read => read.map(text => projectEntityMarkers(text)))).toEqual(read)
    } finally {
      upstream.close()
    }
  })

  test('the prepass check reads a long `style` run in linear time', () => {
    // Mermaid's own prepass regex backtracks catastrophically on a run of
    // `:#` that no `;` ends; verify reads that text and must not stall on it.
    expectNearLinearGrowth(
      'State text holding a long style run',
      size => {
        const warnings = verifyMermaid(`stateDiagram-v2\n  A : style${':#'.repeat(size)}`).warnings
        expect(warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
      },
      4000,
    )
  })

  test("a composite draws its classes' classDef paint on its body, as Mermaid does, and not its style", async () => {
    const source = 'stateDiagram-v2\n  classDef hot fill:#ff0000,stroke:#0000ff,color:#00ff00\n  state X {\n    A\n  }\n  class X hot\n  state Y {\n    B\n  }\n  style Y fill:#ff00ff'
    const svg = renderMermaidSVG(source)
    const group = (id: string) => svg.match(new RegExp(`<g class="subgraph" data-id="${id}"[\\s\\S]*?</g>`))?.[0] ?? ''
    expect(group('X')).toMatch(/<rect [^>]*fill="#ff0000" stroke="#0000ff"[^>]*data-id="group-rect:X"/)
    expect(group('X')).toMatch(/<text [^>]*fill="#00ff00"[^>]*>X</)
    expect(group('Y')).not.toContain('#ff00ff')
    // Mermaid gives the cluster the class, whose CSS rules paint its body;
    // its rounded composite shape draws no `style` paint.
    const upstream = startUpstreamMermaid()
    try {
      const clusters = await upstream.project(source, mermaid =>
        mermaid.db
          .getData()
          .nodes.filter((node: { isGroup: boolean }) => node.isGroup)
          .map((node: { id: string; cssClasses: string; shape: string }) => [node.id, node.cssClasses.trim().split(/\s+/)[0], node.shape]),
      )
      expect(clusters).toEqual({
        ok: true,
        value: [
          ['X', 'hot', 'roundedWithTitle'],
          ['Y', 'statediagram-state', 'roundedWithTitle'],
        ],
      })
    } finally {
      upstream.close()
    }
  })

  test('a quoted description with an entity code keeps its spelling under a label', () => {
    // Reading drops the quotes around a description; the label is written
    // in `state "…" as A`, with its codes as they were written.
    const diagram = state('stateDiagram-v2\n  state "x" as A\n  A : "y #35;"')
    expect(diagram.body.states[0]?.label).toBe('x\ny #')
    const serialized = serializeMermaid(diagram)
    expect(serialized).toContain('state "x<br/>y #35;" as A')
    expect(state(serialized).body).toEqual(diagram.body)
  })

  test('a class named like an Object.prototype key is an ordinary class', () => {
    const parsed = state('stateDiagram-v2\n  classDef __proto__ fill:#ff0000\n  A:::__proto__')
    const defined = apply(state('stateDiagram-v2\n  A:::__proto__'), { kind: 'define_class', name: '__proto__', style: 'fill:#0000ff' })
    for (const [diagram, fill] of [
      [parsed, '#ff0000'],
      [defined, '#0000ff'],
    ] as const) {
      expect(Object.entries(diagram.body.classDefs ?? {})).toEqual([['__proto__', { fill }]])
      const graph = parseRenderGraph(serializeMermaid(diagram))
      expect(graph.classDefs.get('__proto__')?.fill).toBe(fill)
      expect(graph.classAssignments.get('A')).toBe('__proto__')
    }
  })

  test('paint mutations reject statement-injecting line breaks', () => {
    const diagram = state('stateDiagram-v2\n  A --> B')
    const operations: StateMutationOp[] = [
      { kind: 'define_class', name: 'hot', style: 'fill:#f00\nInjected' },
      { kind: 'set_state_style', id: 'A', style: 'fill:#f00\rInjected' },
      { kind: 'set_transition_style', index: 0, style: 'stroke:#000\nInjected' },
    ]
    for (const operation of operations) {
      const result = mutate(diagram, operation)
      expect(result.ok, operation.kind).toBe(false)
      if (!result.ok) expect(result.error).toMatchObject({ code: 'INVALID_OP', message: expect.stringContaining('single-line') })
    }
    expect(state(serializeMermaid(diagram)).body).toEqual(diagram.body)
  })

  test('deferred paint targets stay in their composite or concurrency-region scope', () => {
    const cases = [
      ['class', 'class A hot', 'hot', undefined],
      ['cssClass', 'cssClass A hot', 'hot', undefined],
      ['style', 'style A fill:#ff0000', undefined, '#ff0000'],
      ['shorthand', 'A:::hot', 'hot', undefined],
    ] as const
    for (const [name, directive, className, fill] of cases) {
      const diagram = state(`stateDiagram-v2
  state C {
    ${directive}
    A --> B
  }`)
      const composite = diagram.body.states.find(item => item.id === 'C')!
      expect(
        composite.states?.map(item => item.id),
        name,
      ).toEqual(['A', 'B'])
      expect(
        diagram.body.states.some(item => item.id === 'A'),
        name,
      ).toBe(false)
      expect(composite.states?.[0]?.className, name).toBe(className)
      expect(composite.states?.[0]?.style?.fill, name).toBe(fill)
      const serialized = serializeMermaid(diagram)
      const rendered = parseRenderGraph(serialized)
      expect(rendered.subgraphs[0]?.nodeIds, name).toContain('A')
      expect(state(serialized).body, `${name} agent round-trip`).toEqual(diagram.body)
    }

    const regions = state(`stateDiagram-v2
  state C {
    class Left hot
    Left
    --
    style Right fill:#00ff00
    Right
  }`)
    const composite = regions.body.states.find(item => item.id === 'C')!
    expect(composite.regions?.[0]?.states).toContainEqual(expect.objectContaining({ id: 'Left', className: 'hot' }))
    expect(composite.regions?.[1]?.states).toContainEqual(expect.objectContaining({ id: 'Right', style: { fill: '#00ff00' } }))
    expect(state(serializeMermaid(regions)).body, 'region agent round-trip').toEqual(regions.body)
  })

  test('bare declarations are structured, rendered, and survive unlabeled add_state', () => {
    let diagram = state('stateDiagram-v2\n  Standalone')
    expect(diagram.body.states).toContainEqual(expect.objectContaining({ id: 'Standalone', declaredBare: true }))
    expect(parseRenderGraph(serializeMermaid(diagram)).nodes.has('Standalone')).toBe(true)

    diagram = apply(diagram, { kind: 'add_state', id: 'Added' })
    const serialized = serializeMermaid(diagram)
    expect(serialized).toContain('  Added')
    expect(parseRenderGraph(serialized).nodes.has('Added')).toBe(true)
  })

  test('hyphenated composite ids share the ordinary State identifier grammar', () => {
    const diagram = state(`stateDiagram-v2
      state in-flight {
        waiting-room --> active-work
      }`)
    const composite = diagram.body.states.find(item => item.id === 'in-flight')!
    expect(composite.states?.map(item => item.id)).toEqual(['waiting-room', 'active-work'])
    const graph = parseRenderGraph(serializeMermaid(diagram))
    expect(graph.subgraphs[0]?.id).toBe('in-flight')
    expect(graph.subgraphs[0]?.nodeIds.sort()).toEqual(['active-work', 'waiting-room'])
  })
})

// Mermaid's State lexer (stateDiagram.jison) does not read one statement per
// line: braces are tokens, statements share a line with nothing between them,
// a composite's line breaks are whitespace, a `state` declaration's `{` may
// start the next line, and quoted names and block-note text run across lines.
describe('State statements across and within lines', () => {
  const upstream = startUpstreamMermaid()
  afterAll(() => upstream.close())
  const readingOf = (graph: ReturnType<typeof parseRenderGraph>): string[] => {
    // Declaration order is not meaning: the writer puts definitions first.
    const groups = (list: typeof graph.subgraphs, path: string): string[] => list.flatMap(group => [`${path}${group.id}:${group.label}{${[...group.nodeIds].sort().join(' ')}}`, ...groups(group.children, `${path}${group.id}/`)])
    return [
      ...[...graph.nodes.values()].map(node => `${node.id}:${node.shape}:${node.label}`),
      ...graph.edges.map(edge => `${edge.source}->${edge.target}${edge.label ? `:${edge.label}` : ''}`),
      ...groups(graph.subgraphs, ''),
      ...[...graph.classAssignments].map(([id, name]) => `${id}:::${name}`),
      ...(graph.stateNotes ?? []).map(note => `note ${note.side} of ${note.target}:${note.text}`),
    ].sort()
  }
  test.each([
    ['state X { A --> B }', ['A:rounded:A', 'B:rounded:B', 'A->B', 'X:X{A B}'], []],
    ['state X {\nA --> B }', ['A:rounded:A', 'B:rounded:B', 'A->B', 'X:X{A B}'], []],
    ['state "Long" as X { A }', ['A:rounded:A', 'X:Long{A}'], []],
    ['state X {\nstate Y {\nA\n}}', ['A:rounded:A', 'X:X{}', 'X/Y:Y{A}'], []],
    ['state X\n{\nA\n} B', ['A:rounded:A', 'B:rounded:B', 'X:X{A}'], []],
    ['state X {\nA\n--> B\n}', ['A:rounded:A', 'B:rounded:B', 'A->B', 'X:X{A B}'], []],
    ['state X {\nA -->\nB : go\n}', ['A:rounded:A', 'B:rounded:B', 'A->B:go', 'X:X{A B}'], []],
    // A warning names the line holding the construct, not the row's first.
    ['state X {\nA\n--> B : a; b\n}', ['A:rounded:A', 'B:rounded:B', 'A->B:a; b', 'X:X{A B}'], ['state_text_cut@4']],
    ['state X {\nA -->\nB : ends:\n}', ['A:rounded:A', 'B:rounded:B', 'A->B:ends:', 'X:X{A B}'], ['state_text_cut@4']],
    ['state X { A -- B }', ['A:rounded:A', 'B:rounded:B', 'X:X{}', 'X/X__r1:{A}', 'X/X__r2:{B}'], []],
    ['state X {\nA --> B\n--\nC }', ['A:rounded:A', 'B:rounded:B', 'C:rounded:C', 'A->B', 'X:X{}', 'X/X__r1:{A B}', 'X/X__r2:{C}'], []],
    ['A B', ['A:rounded:A', 'B:rounded:B'], ['state_statements_share_line@2']],
    ['A --> B C --> D', ['A:rounded:A', 'B:rounded:B', 'C:rounded:C', 'D:rounded:D', 'A->B', 'C->D'], ['state_statements_share_line@2']],
    ['[*] --> A A --> [*]', ['_start:state-start:', 'A:rounded:A', '_end:state-end:', '_start->A', 'A->_end'], ['state_statements_share_line@2']],
    ['A:::hot B', ['A:rounded:A', 'B:rounded:B', 'A:::hot'], ['state_statements_share_line@2']],
    ['state X {\nA B\n}', ['A:rounded:A', 'B:rounded:B', 'X:X{A B}'], ['state_statements_share_line@3']],
    ['A --> B; B --> C', ['A:rounded:A', 'B:rounded:B', 'C:rounded:C', 'A->B', 'B->C'], ['state_semicolon_separator@2']],
    ['state X {A}', ['A:rounded:A', 'X:X{A}'], ['state_brace_after_name@2']],
    ['state X { A --> B}', ['A:rounded:A', 'B:rounded:B', 'A->B', 'X:X{A B}'], ['state_brace_after_name@2']],
    ['state X { A : desc }', ['A:rounded:desc', 'X:X{A}'], ['state_brace_after_description@2']],
    ['state X {\nA --> B : go }', ['A:rounded:A', 'B:rounded:B', 'A->B:go', 'X:X{A B}'], ['state_brace_after_description@3']],
    ['state X {\nstate Y {\nA : desc {x} }}', ['A:rounded:desc {x}', 'X:X{}', 'X/Y:Y{A}'], ['state_brace_after_description@4']],
    ['state X {\nA : desc }\n}', ['A:rounded:desc }', 'X:X{A}'], []],
    // Mermaid ends the text at the `;`, and its `}` then closes X.
    ['state X {\nA : a; }', ['A:rounded:a;', 'X:X{A}'], ['state_text_cut@3']],
    // State ids are global: a mention of a composite's id, before or after
    // its block or inside it, names the composite and adds no simple state.
    ['state X {\nA\n}\nX : desc\nX:::hot', ['A:rounded:A', 'X:desc{A}', 'X:::hot'], []],
    ['state X {\nX\nA\n}', ['A:rounded:A', 'X:X{A}'], []],
    ['state X {\n[*] --> Y\nstate Y {\nB\n}\n}', ['X_start:state-start:', 'B:rounded:B', 'X_start->Y', 'X:X{X_start}', 'X/Y:Y{B}'], []],
    ['state P {\nstate X {\nA\n}\n}\nstate "L" as X', ['A:rounded:A', 'P:P{}', 'P/X:L{A}'], []],
    // Read generously where Mermaid reads otherwise, and reported: its State
    // grammar has no `cssClass` or `linkStyle`, and it rejects a composite
    // with a label and a description.
    ['A --> B\ncssClass A hot\nlinkStyle 0 stroke:#f00', ['A:rounded:A', 'B:rounded:B', 'A->B', 'A:::hot'], ['state_css_class@3', 'state_link_style@4']],
    ['state "L" as X {\nA\n}\nX : desc', ['A:rounded:A', 'X:L\ndesc{A}'], ['state_composite_description@5']],
    // A `}` with no composite open is dropped; Mermaid reads a state `}`,
    // or `A}` where it follows a name.
    ['A\n}', ['A:rounded:A'], ['state_brace_unopened@3']],
    ['state X {\nA\n}\n} B', ['A:rounded:A', 'B:rounded:B', 'X:X{A}'], ['state_brace_unopened@5']],
    ['A --> B}', ['A:rounded:A', 'B:rounded:B', 'A->B'], ['state_brace_after_name@2']],
    ['[*]:::hot --> A', ['_start:state-start:', 'A:rounded:A', '_start->A', '_start:::hot'], []],
    // Mermaid's lexer skips blanks around `:::` (and a line break inside a
    // composite), and `A:::c : text` is A's class and description.
    ['A :::hot --> B ::: cold : go', ['A:rounded:A', 'B:rounded:B', 'A->B:go', 'A:::hot', 'B:::cold'], []],
    ['A :::hot : desc', ['A:rounded:desc', 'A:::hot'], []],
    ['state X {\nA\n:::hot --> B\n}', ['A:rounded:A', 'B:rounded:B', 'A->B', 'X:X{A B}', 'A:::hot'], []],
    ['state X {\nA --> [*]:::hot : done\n}', ['A:rounded:A', 'X_end:state-end:', 'A->X_end:done', 'X:X{A X_end}', 'X_end:::hot'], []],
    ['note right of A line1\nline2\nend note', ['A:rounded:A', 'note right of A:line1\nline2'], []],
    // Mermaid's State lexer reads its keywords in any case; `end` is one only
    // before `note`, and a name otherwise.
    ['STATE X {\nA\n}', ['A:rounded:A', 'X:X{A}'], []],
    ['State "Long" AS L\nState F <<FORK>>\nL --> F', ['L:rounded:Long', 'F:state-fork:', 'L->F'], []],
    // Mermaid also spells a fork, join or choice `[[fork]]`.
    ['state f [[fork]]\nstate j [[JOIN]]\nstate c [[choice]]\nA --> f\nf --> c\nc --> j', ['A:rounded:A', 'f:state-fork:', 'j:state-join:', 'c:state-choice:', 'A->f', 'f->c', 'c->j'], []],
    ['ClassDef hot fill:#f00\nA --> B\nCLASS A hot\nNote Right Of B : hi\nNOTE LEFT OF A\ntext\nEND NOTE', ['A:rounded:A', 'B:rounded:B', 'A->B', 'A:::hot', 'note right of B:hi', 'note left of A:text'], []],
    ['end A', ['A:rounded:A', 'end:rounded:end'], ['state_statements_share_line@2']],
    ['State "multi\nline" as X', ['X:rounded:multi\nline'], []],
    // `State` before a transition or description is a name, as before;
    // Mermaid reads it as starting a declaration of `2ate1`, which it drops.
    ['Small State 2ate1 --> B : go', ['Small:rounded:Small', 'State:rounded:State', '2ate1:rounded:2ate1', 'B:rounded:B', '2ate1->B:go'], ['state_statements_share_line@2', 'state_declaration_name@2']],
    // A block note opened after another statement keeps its lines whole.
    ['A note right of B\nsome text\nend note', ['A:rounded:A', 'B:rounded:B', 'note right of B:some text'], ['state_statements_share_line@2']],
    ['state "multi\nline" as X\nX --> Y', ['X:rounded:multi\nline', 'Y:rounded:Y', 'X->Y'], []],
    // A `//` line inside the string is text, not a comment.
    ['state "first\n// second\nthird" as X\nX --> Y', ['X:rounded:first\n// second\nthird', 'Y:rounded:Y', 'X->Y'], []],
    // Mermaid reads the rest of the line after `as` into the name, `}` too.
    ['state X {\nstate "x" as A }', ['A:rounded:x', 'X:X{A}'], ['state_brace_after_name@3']],
    // Mermaid splits the name after `as` at `:`: the text describes A, as
    // `A : desc` would (a description adds a line to the label). It drops a
    // class after `:::` and text after a second colon, which ours keeps.
    ['state "x" as A : desc\nA --> B', ['A:rounded:x\ndesc', 'B:rounded:B', 'A->B'], []],
    ['state "x" as A:::hot', ['A:rounded:x', 'A:::hot'], ['state_alias_suffix@2']],
    ['state "x" as A ::: hot', ['A:rounded:x', 'A:::hot'], ['state_alias_suffix@2']],
    ['state "x" as A : d1 : d2', ['A:rounded:x\nd1 : d2'], ['state_alias_suffix@2']],
    ['state X {\nstate "x" as A : desc }', ['A:rounded:x\ndesc', 'X:X{A}'], ['state_brace_after_description@3']],
    // A line inside the string is its text, never an accTitle.
    ['state X {\nstate "x\naccTitle: y" as A }', ['A:rounded:x\naccTitle: y', 'X:X{A}'], ['state_brace_after_name@3']],
  ] as const)('%j is read alike by the renderer, the typed body, its output and verify', async (body, expected, warnings) => {
    const source = `stateDiagram-v2\n${body}`
    expect(readingOf(parseRenderGraph(source))).toEqual([...expected].sort())
    const written = serializeMermaid(state(source))
    expect(readingOf(parseRenderGraph(written))).toEqual([...expected].sort())
    expect(await upstream.accepts(written), written).toBe(true)
    const verified = verifyMermaid(source)
    expect(verified.ok).toBe(true)
    expect(verified.warnings.flatMap(warning => (warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : []))).toEqual([...warnings])
  })

  // Where a composite that nothing closes was meant to end cannot be told, so
  // no surface may draw its members without it.
  test.each(['state X {\nA', 'state X {\nA : uses {x}', 'state X {\nstate Y {\nA\n}'])('%j never closes X, so every surface rejects it, as Mermaid does', async body => {
    const source = `stateDiagram-v2\n${body}`
    expect(await upstream.accepts(source)).toBe(false)
    expect(() => parseRenderGraph(source)).toThrow('Composite state "X" is never closed')
    const parsed = parseMermaid(source)
    expect(parsed.ok && parsed.value.body.kind).toBe('opaque')
    const verified = verifyMermaid(source)
    expect(verified.ok).toBe(false)
    expect(verified.warnings.map(warning => (warning.code === 'UNSUPPORTED_SYNTAX' ? `${warning.syntax}@${warning.line}` : warning.code))).toEqual(['state_composite_unclosed@2', 'RENDER_FAILED'])
  })

  test('a transition naming a state Mermaid cannot name there is read, and reported', async () => {
    const source = 'stateDiagram-v2\nA --> in-flight\nnote --> A\nA --> B\nstate X {\nC\n--> to-do\n}'
    expect(readingOf(parseRenderGraph(source))).toEqual(['A:rounded:A', 'B:rounded:B', 'C:rounded:C', 'in-flight:rounded:in-flight', 'note:rounded:note', 'to-do:rounded:to-do', 'A->in-flight', 'note->A', 'A->B', 'C->to-do', 'X:X{C to-do}'].sort())
    expect(state(source).body.transitions).toHaveLength(3)
    expect(await upstream.accepts(source)).toBe(false)
    // Each where the name is: inside a composite a transition runs across lines.
    expect(verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : []))
      .toEqual(['state_endpoint_name@2', 'state_endpoint_name@3', 'state_endpoint_name@7'])
  })

  test('a transition naming `state`, `note` or the like is written with no blank after the name, which Mermaid reads', async () => {
    // Mermaid drops `A --> state` and rejects the rest; it reads `note-->`,
    // `--> state%%` and `--> class: x` as transitions.
    const sources = ['A --> state', 'note --> A : go', 'A --> class : x\nstateDiagram --> scale', 'state X {\nA --> note\nstyle --> classDef\n}', 'A --> state:::hot']
      .map(body => `stateDiagram-v2\n${body}`)
    const expected = [['A->state'], ['note->A:go'], ['A->class:x', 'stateDiagram->scale'], ['A->note', 'style->classDef'], ['A->state']]
    expect(sources.map(source => readingOf(parseRenderGraph(source)).filter(item => item.includes('->')))).toEqual(expected.map(edges => [...edges].sort()))
    expect(sources.map(unsupportedSyntax)).toEqual([['state_endpoint_name@2'], ['state_endpoint_name@2'], ['state_endpoint_name@2', 'state_endpoint_name@3', 'state_endpoint_name@3'], ['state_endpoint_name@3', 'state_endpoint_name@4', 'state_endpoint_name@4'], []])
    const written = sources.map(source => serializeMermaid(state(source)))
    expect(written.map(unsupportedSyntax)).toEqual(written.map(() => []))
    expect(written.map(source => state(source).body)).toEqual(sources.map(source => state(source).body))
    expect(await upstream.projectAll(written, mermaid => mermaid.db.getData().edges.map((edge: { start: string; end: string; label: string }) => `${edge.start}->${edge.end}${edge.label ? `:${edge.label}` : ''}`)))
      .toEqual(expected)
  })

  test('a declaration or description naming a state Mermaid cannot name there is read, and reported', async () => {
    // Mermaid rejects the first three, and drops `State : x` as it drops a
    // bare `state X`; it reads `direction` as a name, and the name after
    // `state "…" as` to the line's end. A name alone declares a state: Mermaid
    // rejects a hyphen or `default` there, and reads `state` as starting a
    // declaration of the next line's name, which it drops.
    const sources = ['in-flight : x', 'note : x', 'class : x', 'State : x', 'direction : x', 'state "x" as in-flight : y', 'A --> B\nin-flight', 'default', 'state\nA'].map(body => `stateDiagram-v2\n${body}`)
    expect(sources.map(source => readingOf(parseRenderGraph(source))))
      .toEqual([['in-flight:rounded:x'], ['note:rounded:x'], ['class:rounded:x'], ['State:rounded:x'], ['direction:rounded:x'], ['in-flight:rounded:x\ny'], ['A->B', 'A:rounded:A', 'B:rounded:B', 'in-flight:rounded:in-flight'], ['default:rounded:default'], ['A:rounded:A', 'state:rounded:state']])
    expect(sources.map(unsupportedSyntax)).toEqual([['state_description_name@2'], ['state_description_name@2'], ['state_description_name@2'], ['state_description_name@2'], [], [], ['state_declaration_name@3'], ['state_declaration_name@2'], ['state_declaration_name@2']])
    const drawn = (mermaid: UpstreamDiagram): string[] => mermaid.db.getData().nodes.map((node: { id: string }) => node.id)
    expect((await upstream.projectEach(sources, drawn)).map(read => read.ok ? read.value : 'rejected'))
      .toEqual(['rejected', 'rejected', 'rejected', [], ['direction'], ['in-flight'], 'rejected', 'rejected', []])
    // The writer names each state after `state "…" as`, which Mermaid reads.
    const written = sources.map(source => serializeMermaid(state(source)))
    expect(written.map(unsupportedSyntax)).toEqual(written.map(() => []))
    expect(await upstream.projectAll(written, drawn)).toEqual([['in-flight'], ['note'], ['class'], ['State'], ['direction'], ['in-flight'], ['A', 'B', 'in-flight'], ['default'], ['state', 'A']])
  })

  test('a note position Mermaid reads only with one space is read, and reported', async () => {
    const sources = ['A --> B\nnote right  of A : x', 'A --> B\nnote LEFT\tOF B\ntext\nend note'].map(body => `stateDiagram-v2\n${body}`)
    expect(sources.map(source => readingOf(parseRenderGraph(source)).filter(item => item.startsWith('note'))))
      .toEqual([['note right of A:x'], ['note left of B:text']])
    expect(sources.map(unsupportedSyntax)).toEqual([['state_note_position@3'], ['state_note_position@3']])
    expect(await Promise.all(sources.map(source => upstream.accepts(source)))).toEqual([false, false])
    const written = sources.map(source => serializeMermaid(state(source)))
    expect(written.map(unsupportedSyntax)).toEqual([[], []])
    expect(await upstream.projectAll(written, mermaid => mermaid.db.rootDoc.flatMap((item: any) => item.note ? [[item.note.position, item.id, item.note.text]] : [])))
      .toEqual([[['right of', 'A', 'x']], [['left of', 'B', 'text']]])
  })

  test('a note on a state Mermaid cannot name as a note target is read, and reported', async () => {
    // A keyword names a note's state there; a hyphen does not.
    const oneLine = 'stateDiagram-v2\nnote right of in-flight : x\nnote left of note : y'
    expect(readingOf(parseRenderGraph(oneLine))).toEqual(['in-flight:rounded:in-flight', 'note:rounded:note', 'note right of in-flight:x', 'note left of note:y'].sort())
    expect(await upstream.accepts(oneLine)).toBe(false)
    expect(unsupportedSyntax(oneLine)).toEqual(['state_note_target@2'])
    // Mermaid's note target ends at the hyphen, and the rest is note text.
    const block = 'stateDiagram-v2\nA --> B\nnote left of in-flight\ntext\nend note'
    expect(state(block).body.notes).toEqual([{ target: 'in-flight', side: 'left', text: 'text' }])
    expect(await upstream.project(block, mermaid => mermaid.db.rootDoc.flatMap((item: any) => (item.note ? [[item.id, item.note.text]] : [])))).toEqual({ ok: true, value: [['in', '-flight\ntext']] })
    expect(unsupportedSyntax(block)).toEqual(['state_note_target@3'])
  })

  test('a note whose text Mermaid ends at a colon or `;` is read whole, and reported', async () => {
    // Mermaid ends a one-line note's text at a colon or `;`, after reading
    // entity codes: it rejects the colon, and reads on from the `;`. Its
    // one-line note text starts at a colon after any blank lines, so a block
    // note whose text starts with one is one-line, and `end note` rejected.
    const sources = [
      ...['a; b', 'see http://x', 'a #59; b #58; c', ': x'].map(text => `stateDiagram-v2\nA --> B\nnote right of A : ${text}`),
      ...['  : x', '\n  : x', '  :: x\n  : y'].map(text => `stateDiagram-v2\nA --> B\nnote right of A\n${text}\nend note`),
    ]
    const read = ['a; b', 'see http://x', 'a ; b : c', ': x', ': x', ': x', ':: x\n: y']
    expect(sources.map(source => parseRenderGraph(source).stateNotes?.[0]?.text)).toEqual(read)
    expect(sources.map(unsupportedSyntax)).toEqual([['state_note_text_cut@3'], ['state_note_text_cut@3'], [], ['state_note_text_cut@3'], ['state_note_block_colon@4'], ['state_note_block_colon@5'], []])
    const notes = (mermaid: UpstreamDiagram): string[] => mermaid.db.rootDoc.flatMap((item: any) => item.note ? [item.note.text] : [])
    expect((await upstream.projectEach(sources, notes)).map(read => read.ok ? read.value.map(text => projectEntityMarkers(text)) : 'rejected'))
      .toEqual([['a'], 'rejected', ['a ; b : c'], 'rejected', 'rejected', 'rejected', [':: x\n  : y']])
    // The writer writes a block note, which Mermaid reads whole: a colon
    // starting it as `#58;`, or Mermaid would read a one-line note there.
    const written = sources.map(source => serializeMermaid(state(source)))
    expect(written.map(source => parseRenderGraph(source).stateNotes?.[0]?.text)).toEqual(read)
    expect(written.map(unsupportedSyntax)).toEqual(written.map(() => []))
    expect((await upstream.projectAll(written, notes)).map(texts => texts.map(text => projectEntityMarkers(text)))).toEqual([['a; b'], ['see http://x'], ['a ; b : c'], [': x'], [': x'], [': x'], [':: x\n    : y']])
  })

  test('a block note\'s text is trimmed of the blank lines it starts and ends with, as Mermaid trims it', async () => {
    const sources = ['note right of A\n\n  first\n\n  second\n\nend note', 'A --> B note left of B\n\n  only\n\nend note'].map(body => `stateDiagram-v2\n${body}`)
    const read = ['first\n\nsecond', 'only']
    expect(sources.map(source => parseRenderGraph(source).stateNotes?.[0]?.text)).toEqual(read)
    expect(sources.map(source => state(source).body.notes?.[0]?.text)).toEqual(read)
    const written = sources.map(source => serializeMermaid(state(source)))
    expect(written.map(source => state(source).body.notes?.[0]?.text)).toEqual(read)
    // Mermaid keeps the indentation of a later line, which ours drops.
    const notes = (mermaid: UpstreamDiagram): string[] => mermaid.db.rootDoc.flatMap((item: any) => item.note ? [item.note.text.replace(/\n[ \t]+/g, '\n')] : [])
    expect(await upstream.projectAll([...sources, ...written], notes)).toEqual([...read, ...read].map(text => [text]))
  })

  test('a direction is read in any case, as Mermaid reads it', () => {
    const source = 'stateDiagram-v2\nDIRECTION lr\nstate X {\nDirection BT\nA\n}'
    const body = state(source).body
    expect([body.direction, body.states[0]?.direction]).toEqual(['LR', 'BT'])
    const graph = parseRenderGraph(source)
    expect([graph.direction, graph.subgraphs[0]?.direction]).toEqual(['LR', 'BT'])
    expect(state(serializeMermaid(state(source))).body).toEqual(body)
  })

  test('a statement after `;` on the header line is read, and reported because Mermaid rejects it', async () => {
    const source = 'stateDiagram-v2;A-->B'
    expect(await upstream.accepts(source)).toBe(false)
    expect(readingOf(parseRenderGraph(source))).toEqual(['A->B', 'A:rounded:A', 'B:rounded:B'])
    const written = serializeMermaid(state(source))
    expect(readingOf(parseRenderGraph(written))).toEqual(['A->B', 'A:rounded:A', 'B:rounded:B'])
    expect(await upstream.accepts(written), written).toBe(true)
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'state_semicolon_separator', line: 1 }))
  })
})
