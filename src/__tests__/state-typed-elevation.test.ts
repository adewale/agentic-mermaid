import { afterAll, describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asState, type StateMutationOp, type StateValidDiagram } from '../agent/types.ts'
import { parseMermaid as parseRenderGraph } from '../parser.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

function state(source: string): StateValidDiagram {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const narrowed = asState(parsed.value)
  if (!narrowed) throw new Error(`expected structured State body, got ${parsed.value.body.kind}`)
  return narrowed
}

function apply(diagram: StateValidDiagram, op: StateMutationOp): StateValidDiagram {
  const result = mutate(diagram, op)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

describe('typed State residual elevation (B07)', () => {
  test('writes accepted State descriptions, notes and reserved endpoint spellings without changing their text', async () => {
    const cases = [
      ['namedState1: Small St"ate 1', 'namedState1', 'Small St"ate 1'],
      ['foo: b note "Quoted" as N1', 'foo', 'b note "Quoted" as N1'],
      ['A --> State: continue', 'State', undefined],
      ['state assstateDiagram-v2', 'assstateDiagram-v2', undefined],
      ['style note fill:#ff0000', 'note', undefined],
      ['class S--econd pinned', 'S--econd', undefined],
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
        expect(parseRenderGraph(serialized).nodes.get(id)?.label).toBe(label ?? id)
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
    } finally { upstream.close() }
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
    } finally { upstream.close() }
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
    expect(verified.warnings).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_SYNTAX', syntax: 'state_layout_directive', message: expect.stringContaining(directive),
    }))
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

  test.each([
    'state "First<br/>second" as A\nA --> B',
    'A --> B : First<br/>second',
  ])('writes normalized label breaks without introducing unknown body lines: %s', body => {
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
    expect(verified.warnings).toContainEqual(expect.objectContaining({
      code: 'RENDER_FAILED', reason: expect.stringContaining(statement),
    }))
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
    expect(verifyMermaid(diagram).warnings.filter(warning => warning.code === 'COMMENT_DROPPED')).toEqual([
      { code: 'COMMENT_DROPPED', count: 1, lines: [6] },
    ])
    const edited = apply(diagram, { kind: 'add_state', id: 'Added' })
    const written = serializeMermaid(edited)
    expect(describeMermaidFacts(state(written))).toEqual(describeMermaidFacts(edited))
    const upstream = startUpstreamMermaid()
    try {
      const labels = await upstream.project(written, diagram => diagram.db.rootDoc.flatMap((item: any) => item.description ? [item.description] : item.note ? [item.note.text] : []))
      expect(labels).toEqual({ ok: true, value: ['100%% alias', '100%% description', '100%% transition', '100%% inline'] })
    } finally { upstream.close() }
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
    expect(verifyMermaid(diagram).warnings.filter(warning => warning.code === 'COMMENT_DROPPED')).toEqual([
      { code: 'COMMENT_DROPPED', count: 1, lines: [11] },
    ])
    const edited = apply(diagram, { kind: 'add_state', id: 'Added' })
    const written = serializeMermaid(edited)
    expect(state(written).body.notes).toEqual(edited.body.notes)
    expect(describeMermaidFacts(state(written))).toEqual(describeMermaidFacts(edited))
    expect(renderMermaidSVG(written)).toContain('%% literal note line')
    expect(renderMermaidASCII(written)).toContain('%% literal note line')
    const upstream = startUpstreamMermaid()
    try { expect(await upstream.accepts(written)).toBe(true) } finally { upstream.close() }
  })

  test('trailing Mermaid comments preserve transition topology in both parsers', () => {
    const source = `stateDiagram-v2
      A --> B %% legal trailing comment
      B --> C`
    const diagram = state(source)
    expect(diagram.body.transitions).toEqual([{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }])
    const graph = parseRenderGraph(source)
    expect(graph.edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'B'], ['B', 'C']])
    expect(state(serializeMermaid(diagram)).body.transitions).toEqual(diagram.body.transitions)
    expect(verifyMermaid(diagram).warnings).toContainEqual({ code: 'COMMENT_DROPPED', count: 1, lines: [2] })
  })

  test('State header comments and comment-only delimiters never create or erase transitions', () => {
    for (const source of [
      'stateDiagram-v2 %% heading; Bogus --> Edge\nA --> B',
      'stateDiagram-v2\nA --> B %% ; Bogus --> Edge\nB --> C',
      'stateDiagram-v2\nA --> B %% `\nB --> C',
      'stateDiagram-v2\nA --> B %% @{\nB --> C',
    ]) {
      const expected = source.includes('heading') ? [['A', 'B']] : [['A', 'B'], ['B', 'C']]
      expect(state(source).body.transitions.map(transition => [transition.from, transition.to])).toEqual(expected)
      expect(parseRenderGraph(source).edges.map(edge => [edge.source, edge.target])).toEqual(expected)
      expect(verifyMermaid(state(source)).warnings).toContainEqual({
        code: 'COMMENT_DROPPED', count: 1, lines: [source.includes('heading') ? 1 : 2],
      })
    }
  })

  test('trailing-comment diagnostics use authored line numbers after frontmatter and init directives', () => {
    const source = `---
config:
  theme: default
---
%%{init: {"theme":"default"}}%%
stateDiagram-v2
  A --> B %% note`
    const diagram = state(source)
    expect(diagram.meta.comments).toEqual([{ text: 'note', line: 7 }])
    expect(verifyMermaid(diagram).warnings).toContainEqual({ code: 'COMMENT_DROPPED', count: 1, lines: [7] })
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

  test('a state Mermaid cannot read alone is written so that Mermaid draws it', async () => {
    // A hyphen ends a Mermaid name, a keyword before a line break starts its
    // statement, and `state X` declares nothing upstream.
    let diagram = state('stateDiagram-v2\n  state in-flight\n  state note\n  state State\n  hide\n  A')
    diagram = apply(diagram, { kind: 'add_state', id: 'classDef' })
    const serialized = serializeMermaid(diagram)
    expect(state(serialized).body).toEqual(diagram.body)
    const upstream = startUpstreamMermaid()
    try {
      const drawn = await upstream.project(serialized, mermaid => mermaid.db.getData().nodes.map((node: { id: string }) => node.id).sort())
      expect(drawn).toEqual({ ok: true, value: ['A', 'State', 'classDef', 'hide', 'in-flight', 'note'] })
    } finally { upstream.close() }
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
    } finally { upstream.close() }
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
        return [...data.nodes.map((node: { id: string; label: string; description?: string[] }) => [node.id, [node.label, ...node.description ?? []].join('<br/>')]), ...data.edges.map((edge: { label: unknown }) => edge.label)]
      }
      const [original, written, writtenEdit] = await upstream.projectAll([source, serialized, serializeMermaid(edited)], text)
      expect(written).toEqual(original)
      expect(writtenEdit).toContainEqual(['B', 'Cﬂ°°35¶ß35; sharp'])
      // A `"` in the label of a state written `state "…" as X` is `#quot;`.
      const quoted = state('stateDiagram-v2\n  default : x"y')
      expect(quoted.body.states[0]?.label).toBe('x"y')
      expect(await upstream.projectAll([serializeMermaid(quoted)], text)).toEqual([[['default', 'xﬂ°quot¶ßy']]])
    } finally { upstream.close() }
  })

  test('a class named like an Object.prototype key is an ordinary class', () => {
    const parsed = state('stateDiagram-v2\n  classDef __proto__ fill:#ff0000\n  A:::__proto__')
    const defined = apply(state('stateDiagram-v2\n  A:::__proto__'), { kind: 'define_class', name: '__proto__', style: 'fill:#0000ff' })
    for (const [diagram, fill] of [[parsed, '#ff0000'], [defined, '#0000ff']] as const) {
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
  }`)
      const composite = diagram.body.states.find(item => item.id === 'C')!
      expect(composite.states?.map(item => item.id), name).toEqual(['A'])
      expect(diagram.body.states.some(item => item.id === 'A'), name).toBe(false)
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
    --
    style Right fill:#00ff00
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
    const groups = (list: typeof graph.subgraphs, path: string): string[] => list.flatMap(group => [
      `${path}${group.id}:${group.label}{${[...group.nodeIds].sort().join(' ')}}`,
      ...groups(group.children, `${path}${group.id}/`),
    ])
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
    // State ids are global: a mention of a composite's id, before or after
    // its block or inside it, names the composite and adds no simple state.
    ['state X {\nA\n}\nX : desc\nX:::hot', ['A:rounded:A', 'X:desc{A}', 'X:::hot'], []],
    ['state X {\nX\nA\n}', ['A:rounded:A', 'X:X{A}'], []],
    ['state X {\n[*] --> Y\nstate Y {\nB\n}\n}', ['_start:state-start:', 'B:rounded:B', '_start->Y', 'X:X{_start}', 'X/Y:Y{B}'], []],
    ['state P {\nstate X {\nA\n}\n}\nstate "L" as X', ['A:rounded:A', 'P:P{}', 'P/X:L{A}'], []],
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
    ['state X {\nA --> [*]:::hot : done\n}', ['A:rounded:A', '_end:state-end:', 'A->_end:done', 'X:X{A _end}', '_end:::hot'], []],
    ['note right of A line1\nline2\nend note', ['A:rounded:A', 'note right of A:line1\nline2'], []],
    // Mermaid's State lexer reads its keywords in any case; `end` is one only
    // before `note`, and a name otherwise.
    ['STATE X {\nA\n}', ['A:rounded:A', 'X:X{A}'], []],
    ['State "Long" AS L\nState F <<FORK>>\nL --> F', ['L:rounded:Long', 'F:state-fork:', 'L->F'], []],
    ['ClassDef hot fill:#f00\nA --> B\nCLASS A hot\nNote Right Of B : hi\nNOTE LEFT OF A\ntext\nEND NOTE', ['A:rounded:A', 'B:rounded:B', 'A->B', 'A:::hot', 'note right of B:hi', 'note left of A:text'], []],
    ['end A', ['A:rounded:A', 'end:rounded:end'], ['state_statements_share_line@2']],
    ['State "multi\nline" as X', ['X:rounded:multi\nline'], []],
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
    expect(verified.warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : [])).toEqual([...warnings])
  })

  // Where a composite that nothing closes was meant to end cannot be told, so
  // no surface may draw its members without it.
  test.each([
    'state X {\nA',
    'state X {\nA : uses {x}',
    'state X {\nstate Y {\nA\n}',
  ])('%j never closes X, so every surface rejects it, as Mermaid does', async body => {
    const source = `stateDiagram-v2\n${body}`
    expect(await upstream.accepts(source)).toBe(false)
    expect(() => parseRenderGraph(source)).toThrow('Composite state "X" is never closed')
    const parsed = parseMermaid(source)
    expect(parsed.ok && parsed.value.body.kind).toBe('opaque')
    const verified = verifyMermaid(source)
    expect(verified.ok).toBe(false)
    expect(verified.warnings.map(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? `${warning.syntax}@${warning.line}` : warning.code)).toEqual(['state_composite_unclosed@2', 'RENDER_FAILED'])
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
