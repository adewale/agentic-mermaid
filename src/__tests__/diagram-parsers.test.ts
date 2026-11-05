import { describe, expect, test } from 'bun:test'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import * as api from '../index.ts'
import * as agent from '../agent/core.ts'

for (const [entry, parsers] of [['main', api], ['agent/core', agent]] as const) {
  describe(`typed renderer parsers through ${entry}`, () => {
    test('class members and annotations stay separate, and links keep their arrow semantics', () => {
      const diagram = parsers.parseClassDiagram('---\ntitle: Contracts\n---\nclassDiagram\nclass Reader {\n<<interface>>\n+String name\n+read(id: int) String$\n}\nReader -- Plain\nReader --> Directed')
      expect(diagram.title).toBe('Contracts')
      expect(diagram.classes[0]).toMatchObject({
        id: 'Reader', annotation: 'interface',
        attributes: [{ visibility: '+', name: 'name', type: 'String', sourceText: '+String name', isMethod: false }],
        methods: [{ visibility: '+', name: 'read', type: 'String', params: 'id: int', isStatic: true, isMethod: true }],
      })
      expect(diagram.relationships).toMatchObject([
        { from: 'Reader', to: 'Plain', type: 'link-solid', markerAt: 'none' },
        { from: 'Reader', to: 'Directed', type: 'association', markerAt: 'to' },
      ])
    })

    test('method classifiers are suffixes, separate from return types and parameter text', () => {
      const diagram = parsers.parseClassDiagram('classDiagram\nclass A {\n+abstract() Money*\n+plain(price: Money$, glob: *) Map~Money$~\n+legacy$() String\n+noReturn()*\n}')
      expect(diagram.classes[0]?.methods).toMatchObject([
        { name: 'abstract', type: 'Money', isAbstract: true, isStatic: false },
        { name: 'plain', type: 'Map~Money$~', params: 'price: Money$, glob: *', isAbstract: false, isStatic: false },
        { name: 'legacy', type: 'String', isStatic: true, isAbstract: false },
        { name: 'noReturn', type: undefined, isAbstract: true, isStatic: false },
      ])
    })

    test('ER attributes expose key lists and comments alongside front matter and accessibility', () => {
      const diagram = parsers.parseErDiagram('---\ntitle: Accounts\nconfig:\n  er:\n    layoutDirection: TB\n---\nerDiagram\naccTitle: Database\nUSER {\nint id PK, FK "account key"\nstring name UK\n}')
      expect(diagram).toMatchObject({ title: 'Accounts', accessibilityTitle: 'Database', direction: 'TB' })
      expect(diagram.entities[0]?.attributes).toMatchObject([
        { type: 'int', name: 'id', keys: ['PK', 'FK'], comment: 'account key' },
        { type: 'string', name: 'name', keys: ['UK'] },
      ])
    })

    test('sequence models expose notes, activations, boxes and lifecycle boundaries', () => {
      const diagram = parsers.parseSequenceDiagram('---\ntitle: Fallback\nconfig:\n  sequence:\n    showSequenceNumbers: true\n---\nsequenceDiagram\ntitle Conversation\nbox aqua Clients\nparticipant A\nend\nNote over A: Ready\nactivate A\ncreate participant B\nA->>B: Hello\ndestroy B\nB-->>A: Goodbye\ndeactivate A')
      expect(diagram.title).toBe('Conversation')
      expect(diagram.boxes).toEqual([{ actorIds: ['A'], label: 'Clients', color: 'aqua' }])
      expect(diagram.actors).toMatchObject([
        { id: 'A', box: 0 }, { id: 'B', createMessageIndex: 0, destroyMessageIndex: 1 },
      ])
      expect(diagram.notes).toMatchObject([{ actorIds: ['A'], text: 'Ready', position: 'over', afterIndex: -1 }])
      expect(diagram.activationEvents).toEqual([
        { actorId: 'A', kind: 'activate', messageIndex: 0 },
        { actorId: 'A', kind: 'deactivate', messageIndex: 2 },
      ])
      expect(diagram.messages.map(message => ({ number: message.number, lineStyle: message.lineStyle }))).toEqual([
        { number: 1, lineStyle: 'solid' }, { number: 2, lineStyle: 'dashed' },
      ])
    })

    test.each([
      ['class', parsers.parseClassDiagram, 'classDiagram\n  invalid ???', 3],
      ['er', parsers.parseErDiagram, 'erDiagram\n  !!', 3],
      ['sequence', parsers.parseSequenceDiagram, 'sequenceDiagram\ninvalid ???', 1],
      ['sequence', parsers.parseSequenceDiagram, 'sequenceDiagram\n  participant A@{type: nonsense}', 3],
      ['sequence', parsers.parseSequenceDiagram, 'sequenceDiagram\n  rect url(bad)\n  A->>B: hi\n  end', 3],
      ['er', parsers.parseErDiagram, 'erDiagram\n  USER {\nint id PK', 3],
    ] as const)('%s syntax errors expose authored positions as fields', (diagramType, parse, body, column) => {
      let failure: unknown
      try { parse(`---\ntitle: Broken\n---\n${body}`) } catch (error) { failure = error }
      expect(failure).toBeInstanceOf(parsers.MermaidSyntaxError)
      expect(failure).toMatchObject({ code: 'MERMAID_SYNTAX_ERROR', diagramType, line: 5, column })
    })

    test('a different family cannot silently produce an empty typed model', () => {
      expect(() => parsers.parseErDiagram('classDiagram\nclass User')).toThrow('Expected erDiagram header')
    })

    test('parse results and renderer errors expose the same authored malformed-edge position', () => {
      const source = '---\ntitle: Broken\n---\n\n%% comment\nflowchart TD\n\n  B --> [oops'
      const parsed = parsers.parseRegisteredMermaid(source)
      expect(parsed).toMatchObject({ ok: false, error: [{ code: 'PARSE_FAILED', line: 8, column: 9, col: 9, diagramType: 'flowchart' }] })
      let failure: unknown
      try { parsers.renderMermaidSVG(source) } catch (error) { failure = error }
      expect(failure).toMatchObject({ line: 8, column: 9, diagramType: 'flowchart' })
    })
  })
}

describe('authored parser positions across native, SVG and terminal consumers', () => {
  test.each([
    ['class', 'classDiagram\n%% comment } <<interface>> Missing\n  <<interface>> Missing', 3, 3],
    ['er', 'erDiagram\n%% comment } invalid !\n  invalid !', 3, 3],
    ['sequence', 'sequenceDiagram\naccDescr {\ninvalid\n}\n  invalid', 5, 3],
    ['class', 'classDiagram\nnamespace N { <<interface>> Missing }', 2, 15],
    ['class', 'classDiagram\n  &lt;&lt;interface&gt;&gt; Missing', 2, 3],
    ['flowchart', 'flowchart TD\n  subgraph', 2, 3],
    ['flowchart', 'flowchart TD\n  A@{ shape: [ }', 2, 3],
    ['flowchart', 'flowchart TD\nA["a &amp; b"] --> [oops', 2, 20],
    ['sequence', 'sequenceDiagram\nA->>B: x &amp; y; invalid', 2, 19],
    ...['&nbsp;', '&#59;', '&#35;', '&amp;nbsp;'].map(entity => ['sequence', `---\ntitle: Test\n---\nsequenceDiagram\nA->>B: ${entity}\n  invalid`, 6, 3] as const),
  ] as const)('%s owns locations after normalization: %s', (family, source, line, column) => {
    const native = family === 'class' ? api.parseClassDiagram : family === 'er' ? api.parseErDiagram : family === 'sequence' ? api.parseSequenceDiagram : undefined
    for (const parse of [native, api.renderMermaidSVG, api.renderMermaidASCII].filter(fn => fn !== undefined)) {
      let failure: unknown
      try { parse(source) } catch (error) { failure = error }
      expect(failure).toMatchObject({ diagramType: family, line, column })
    }
  })
})


test.each([
  ['sequenceDiagram\n%% comment\n\n  participant A@', 8, 3],
  ['sequenceDiagram; participant A@', 5, 18],
  ['sequenceDiagram\naccDescr {\nparticipant A@\n}\n  participant A@', 9, 3],
])('agent sequence participant errors retain source coordinates: %s', (body, line, column) => {
  expect(api.parseRegisteredMermaid(`---\ntitle: Invalid\n---\n\n${body}`)).toMatchObject({ ok: false, error: [{ code: 'PARSE_FAILED', diagramType: 'sequence', line, column }] })
})

describe('native family errors retain authored metadata', () => {
  test.each([
    ['mindmap', 'mindmap\n  Root\n    x[A]\n    x[B]', 7],
    ['gitgraph', 'gitGraph\n  commit\n  checkout missing', 6],
  ] as const)('%s errors survive parse, SVG, terminal and transport boundaries', (diagramType, body, line) => {
    const source = `---\ntitle: Invalid\n---\n${body}`
    expect(api.parseRegisteredMermaid(source)).toMatchObject({ ok: false, error: [{ code: 'PARSE_FAILED', diagramType, line }] })
    for (const render of [api.renderMermaidSVG, api.renderMermaidASCII]) {
      let failure: unknown
      try { render(source) } catch (error) { failure = error }
      expect(failure).toMatchObject({ diagramType, line, column: undefined })
      expect(projectRenderErrorDiagnostic(failure)).toEqual({ code: 'MERMAID_SYNTAX_ERROR', message: expect.any(String), diagramType, line })
    }
  })
})
