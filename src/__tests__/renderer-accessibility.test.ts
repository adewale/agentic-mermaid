// Loop 11 M2 (#7254/#7255 + #7349): SVG accessibility (title/desc/ARIA) and
// the structured AX tree from describeMermaid({format:'json'}).

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import { renderMermaidSVG } from '../index.ts'
import { describeMermaidSource, describeMermaidTree } from '../agent/describe.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { startUpstreamMermaid, type UpstreamDiagram } from './helpers/upstream-mermaid.ts'
import { synthesizeFromGraph } from '../agent/index.ts'
import { parseMindmap } from '../mindmap/parser.ts'
import { decodeXML } from 'entities'
import { serializeMermaid } from '../agent/serialize.ts'

test('successful accessibility edits close through body, metadata and source without creating statements', () => {
  const parsed = parseMermaid('packet\n0-7: "Payload"')
  if (!parsed.ok) throw new Error('Expected Packet')
  const original = structuredClone(parsed.value)
  for (const description of ['', '\n \t', 'one\n}\naccDescr {\ntwo', '{unfinished', 'one\r\ntwo', 'ordinary description']) {
    const result = mutate(parsed.value, { kind: 'set_accessibility_description', description })
    if (!description.trim()) expect(result.ok).toBe(false)
    if (description === 'ordinary description' || description === 'one\r\ntwo') expect(result.ok).toBe(true)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_OP')
    } else {
      const expected = description.replace(/\r\n?/g, '\n')
      const reload = parseMermaid(serializeMermaid(result.value))
      if (!reload.ok || result.value.body.kind !== 'packet' || reload.value.body.kind !== 'packet') throw new Error('Expected Packet reload')
      expect(result.value.body.accessibilityDescription).toBe(expected)
      expect(result.value.meta.accessibility.descr).toBe(expected)
      expect(reload.value.body.accessibilityDescription).toBe(expected)
      expect(reload.value.body.fields).toEqual(original.body.kind === 'packet' ? original.body.fields : [])
    }
    expect(parsed.value).toEqual(original)
  }
  for (const title of ['%%{init: {"theme":"dark"}}%%', 'ordinary title']) {
    const result = mutate(parsed.value, { kind: 'set_accessibility_title', title })
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_OP')
    } else {
      const reload = parseMermaid(serializeMermaid(result.value))
      if (!reload.ok || result.value.body.kind !== 'packet' || reload.value.body.kind !== 'packet') throw new Error('Expected Packet reload')
      expect(result.value.body.accessibilityTitle).toBe(title)
      expect(result.value.meta.accessibility.title).toBe(title)
      expect(reload.value.body.accessibilityTitle).toBe(title)
      expect(reload.value.meta.initDirectives).toEqual(original.meta.initDirectives)
      expect(reload.value.meta.frontmatter).toEqual(original.meta.frontmatter)
    }
    expect(parsed.value).toEqual(original)
  }
  const control = mutate(parsed.value, { kind: 'set_accessibility_title', title: 'ordinary title' })
  expect(control.ok).toBe(true)
})

describe('#7254/#7255 SVG accessibility', () => {
  test('literal directive openers in accessibility stay source-only and cannot escape through an edit', () => {
    const source = 'pie\naccDescr {\nReview %%{prose\n}\n"Share": 2'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source + '\n')
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'accessibility_directive_text' }))
    const editable = parseMermaid('pie\n"Share": 2')
    if (!editable.ok) throw new Error(JSON.stringify(editable.error))
    const edited = mutate(editable.value, { kind: 'set_accessibility_description', description: 'Review %%{prose' })
    expect(edited.ok).toBe(false)
    expect(editable.value.meta.accessibility.descr).toBeUndefined()
  })

  test.each([
    ['xychart-beta', 'line [2]', { kind: 'set_title', title: 'Changed' }, 'Changed'],
    ['pie', '"Share": 2', { kind: 'add_slice', label: 'Other', value: 3 }, 'Other'],
    ['stateDiagram-v2', 'A --> B', { kind: 'add_state', id: 'C' }, 'C'],
    ['packet', '0-7: "Payload"', { kind: 'set_field_label', index: 0, label: 'Changed' }, 'Changed'],
    ['classDiagram', 'class A', { kind: 'add_class', id: 'Changed' }, 'Changed'],
    ['classDiagram', 'namespace Domain {\nclass A\n}', { kind: 'add_class', id: 'Changed' }, 'Changed'],
  ] as const)('empty description blocks survive writing and unrelated %s edits', async (header, content, op, changedText) => {
    const upstream = startUpstreamMermaid()
    try {
      const parsed = parseMermaid(`${header}\naccDescr{}${content}%%`)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      const original = structuredClone(parsed.value)
      expect(parsed.value.meta.accessibility.descr).toBe('')
      expect(verifyMermaid(parsed.value).ok).toBe(true)
      if (header === 'classDiagram') expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'class_empty_accessibility_description' }))
      expect(await upstream.publicAccepts(serializeMermaid(parsed.value))).toBe(true)
      const edited = mutate(parsed.value, op)
      expect(edited.ok).toBe(true)
      if (!edited.ok) throw new Error(JSON.stringify(edited.error))
      expect(edited.value.meta.accessibility.descr).toBe('')
      const written = serializeMermaid(edited.value)
      expect(written).toContain(changedText)
      expect(await upstream.publicAccepts(written), written).toBe(true)
      if (header === 'classDiagram') expect(verifyMermaid(written).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'class_empty_accessibility_description' }))
      const reread = parseMermaid(written)
      if (!reread.ok) throw new Error(JSON.stringify(reread.error))
      expect(reread.value.meta.accessibility.descr).toBe('')
      expect(reread.value.body.kind).toBe(parsed.value.body.kind)
      expect(parsed.value).toEqual(original)
    } finally { upstream.close() }
  })

  test('accTitle → <title>, accDescr → <desc>, role + ARIA references on root', () => {
    const svg = renderMermaidSVG('flowchart TD\n accTitle: Login Flow\n accDescr: How a user logs in\n A[Start] --> B[End]')
    expect(svg).toContain('<title id="svg-title">Login Flow</title>')
    expect(svg).toContain('<desc id="svg-desc">How a user logs in</desc>')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-labelledby="svg-title"')
    expect(svg).toContain('aria-describedby="svg-desc"')
  })

  test('accDescr block form is captured', () => {
    const svg = renderMermaidSVG('flowchart TD\n accTitle: T\n accDescr {\n   multi line\n   description\n }\n A --> B')
    expect(svg).toContain('<title id="svg-title">T</title>')
    expect(svg).toContain('multi line\ndescription')
    expect(svg).not.toContain('data-id="accTitle"')
    expect(svg).not.toContain('data-id="accDescr"')
  })

  test('sequence malformed accDescr opener does not prevent rendering valid messages', () => {
    const svg = renderMermaidSVG('sequenceDiagram\n  accDescr: {foo\n  A->>B: hi')
    expect(svg).toContain('hi')
    expect(svg).toContain('data-id="A"')
    expect(svg).toContain('data-id="B"')
  })

  test('class, ER, and timeline reject unclosed accDescr blocks', () => {
    const cases = [
      ['class', 'classDiagram\n accDescr {\n never closed\n class A'],
      ['ER', 'erDiagram\n accDescr {\n never closed\n A ||--o{ B : rel'],
      ['timeline', 'timeline\n accDescr {\n never closed\n 2026 : Ship'],
    ] as const

    for (const [family, source] of cases) {
      expect(() => renderMermaidSVG(source), family).toThrow(/accDescr block/)
    }
  })

  test('diagram without acc directives emits no <title>/<desc>', () => {
    const svg = renderMermaidSVG('flowchart TD\n A --> B')
    expect(svg).not.toContain('<title')
    expect(svg).not.toContain('aria-labelledby')
  })

  test('title text is XML-escaped', () => {
    const svg = renderMermaidSVG('flowchart TD\n accTitle: A < B & C\n A --> B')
    expect(svg).toContain('A &lt; B &amp; C')
  })

  test('acc title/desc ids carry the idPrefix (collision-free with other diagrams)', () => {
    const svg = renderMermaidSVG('flowchart TD\n accTitle: X\n A --> B', { idPrefix: 'd3-' })
    expect(svg).toContain('<title id="d3-svg-title">X</title>')
    expect(svg).toContain('aria-labelledby="d3-svg-title"')
  })
})

describe('#7349 AX tree — describeMermaid({format:json})', () => {
  test('flowchart: every node + edge in the tree', () => {
    const tree = describeMermaidTree(parseMermaidOk('flowchart TD\n A[Start] --> B[Mid]\n B --> C[End]'))
    expect(tree.kind).toBe('flowchart')
    expect(tree.nodes.map(n => n.id).sort()).toEqual(['A', 'B', 'C'])
    expect(tree.nodes.find(n => n.id === 'A')!.label).toBe('Start')
    expect(tree.edges).toEqual([
      { from: 'A', to: 'B', label: undefined },
      { from: 'B', to: 'C', label: undefined },
    ])
    expect(tree.entryPoints).toEqual(['A'])
    expect(tree.sinks).toEqual(['C'])
  })

  test('json format is valid JSON with the tree shape', () => {
    const json = describeMermaidSource('flowchart TD\n A --> B', { format: 'json' })
    const parsed = JSON.parse(json)
    expect(parsed.kind).toBe('flowchart')
    expect(Array.isArray(parsed.nodes)).toBe(true)
    expect(Array.isArray(parsed.edges)).toBe(true)
  })

  test('sequence: participants → nodes, messages → edges', () => {
    const tree = describeMermaidTree(parseMermaidOk('sequenceDiagram\n Alice->>Bob: Hi\n Bob-->>Alice: Hello'))
    expect(tree.nodes.map(n => n.id).sort()).toEqual(['Alice', 'Bob'])
    expect(tree.edges.map(({ from, to, label }) => ({ from, to, label }))).toEqual([
      { from: 'Alice', to: 'Bob', label: 'Hi' },
      { from: 'Bob', to: 'Alice', label: 'Hello' },
    ])
  })

  test('class: classes → nodes, relations → edges', () => {
    const tree = describeMermaidTree(parseMermaidOk('classDiagram\n class A\n class B\n A <|-- B'))
    expect(tree.nodes.map(n => n.id).sort()).toEqual(['A', 'B'])
    expect(tree.edges).toEqual([{ from: 'A', to: 'B', label: 'inheritance', direction: 'reverse' }])
  })

  test('architecture and flowchart name each group\'s members in prose and parent every member in the tree', () => {
    const architecture = 'architecture-beta\n  group cloud(cloud)[Cloud]\n  group private(server)[Private] in cloud\n  group storage(disk)[Storage] in cloud\n  service db(database)[DB] in private\n  service api(server)[API] in private\n  junction j1 in cloud\n  service web(internet)[Web]\n  web:R --> L:api'
    expect(describeMermaidSource(architecture)).toContain('Groups: Cloud [private, storage, j1]; Private [db, api]; Storage [empty].')
    const archParents = Object.fromEntries(describeMermaidTree(parseMermaidOk(architecture)).nodes.map(n => [n.id, n.parentId]))
    expect(archParents).toEqual({ cloud: undefined, private: 'cloud', storage: 'cloud', db: 'private', api: 'private', web: undefined, j1: 'cloud' })

    const flowchart = 'flowchart LR\n  subgraph Outer[Outer box]\n    A\n    subgraph Inner\n      B\n    end\n  end\n  C --> Outer\n  A --> B'
    expect(describeMermaidSource(flowchart)).toContain('Subgraphs: Outer box [Inner, A]; Inner [B].')
    const flowTree = describeMermaidTree(parseMermaidOk(flowchart))
    expect(Object.fromEntries(flowTree.nodes.map(n => [n.id, n.parentId]))).toEqual({ Outer: undefined, Inner: 'Outer', A: 'Outer', B: 'Inner', C: undefined })
    expect(flowTree.sinks).toContain('Outer')
  })

  test('an unregistered source → preserved-family JSON tree, not a throw', () => {
    const json = describeMermaidSource('not a diagram', { format: 'json' })
    const parsed = JSON.parse(json)
    expect(parsed.kind).toBe('family:unknown')
    expect(parsed.nodes).toEqual([])
  })
})

// Every read-back surface names an edge's direction the way its arrowheads are
// drawn: describe prose and facts write the arrow token between the authored
// endpoints, the AX tree marks non-forward edges, and the SVG relation carries
// the matching marker ends and an aria-label read in arrowhead order.
describe('relation direction read-back agrees with the drawn arrowheads', () => {
  type Heads = { start: boolean; end: boolean }
  const token = ({ start, end }: Heads) => (start && end ? '<->' : start ? '<-' : end ? '->' : '--')
  const treeDirection = ({ start, end }: Heads) => (start && end ? 'bidirectional' : start ? 'reverse' : end ? undefined : 'undirected')
  const spoken = ({ start, end }: Heads, from: string, to: string) =>
    start && end ? `between ${from} and ${to} in both directions` : start ? `${to} to ${from}` : end ? `${from} to ${to}` : `between ${from} and ${to}`
  // Each family's authored arrow forms and the arrowheads they draw.
  const families: Record<string, { forms: Array<[string, Heads]>; source: (arrow: string) => string; prose: RegExp; fact?: (arrow: string) => string; ids?: [string, string] }> = {
    flowchart: {
      forms: [['-->', { start: false, end: true }], ['---', { start: false, end: false }], ['<-->', { start: true, end: true }], ['-.-', { start: false, end: false }], ['<-.->', { start: true, end: true }], ['==>', { start: false, end: true }], ['--o', { start: false, end: true }], ['x--x', { start: true, end: true }]],
      source: arrow => `flowchart LR\n  A ${arrow} B`,
      prose: /Edges: A (\S+) B\./,
      fact: arrow => `edge A ${arrow} B`,
    },
    architecture: {
      forms: [['-->', { start: false, end: true }], ['<--', { start: true, end: false }], ['<-->', { start: true, end: true }], ['--', { start: false, end: false }], ['-[uses]->', { start: false, end: true }], ['<-[uses]-', { start: true, end: false }]],
      // Lower-case ids: `L:B` would read B as a side.
      source: arrow => `architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R ${arrow} L:b`,
      prose: /Connections: a (\S+) b/,
      fact: arrow => `edge a:R ${arrow} b:L`,
      ids: ['a', 'b'],
    },
    class: {
      forms: [['-->', { start: false, end: true }], ['<--', { start: true, end: false }], ['<|--', { start: true, end: false }], ['--|>', { start: false, end: true }], ['<|--|>', { start: true, end: true }], ['--', { start: false, end: false }], ['*--', { start: true, end: false }]],
      source: arrow => `classDiagram\n  A ${arrow} B`,
      prose: /Relations: A (\S+) B \(/,
    },
  }
  test('describe, AX tree, facts and SVG marker ends and aria-label', () => {
    const arb = fc.constantFrom(...Object.keys(families)).chain(family => fc.tuple(fc.constant(family), fc.constantFrom(...families[family]!.forms)))
    fc.assert(fc.property(arb, ([family, [arrow, heads]]) => {
      const spec = families[family]!
      const source = spec.source(arrow)
      const parsed = parseMermaidOk(source)
      expect(describeMermaidSource(source).match(spec.prose)?.[1], source).toBe(token(heads))
      const [edge] = describeMermaidTree(parsed).edges
      expect(edge?.direction, source).toBe(treeDirection(heads))
      const label = arrow.includes('uses') ? ': uses' : ''
      if (spec.fact) expect(describeMermaidFacts(parsed), source).toContain(`${spec.fact(token(heads))}${label && ` ${label}`}`)
      const relations = [...renderMermaidSVG(source).matchAll(/<[^>]+aria-roledescription="relation"[^>]*>/g)].map(m => m[0])
      expect(relations, source).toHaveLength(1)
      const relation = relations[0]!
      expect(/\smarker-start="url\(/.test(relation), source).toBe(heads.start)
      expect(/\smarker-end="url\(/.test(relation), source).toBe(heads.end)
      expect(decodeXML(relation.match(/aria-label="([^"]*)"/)![1]!), source).toBe(`${spoken(heads, ...(spec.ids ?? ['A', 'B']))}${label}`)
    }), fcParameters({ numRuns: 60 }))
  })
})

function parseMermaidOk(src: string) {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse failed')
  return r.value
}


test('native accessibility comments preserve editable metadata and external topology without changing captured wrappers', async () => {
  const pin = startUpstreamMermaid()
  const wrapper = '---\ntitle: Diagram\n---\n%% wrapper rationale\n'
  const project = (d: UpstreamDiagram) => {
    if (d.type === 'block') return { blocks: d.db.getBlocks(), edges: d.db.getEdges() }
    if (d.type === 'mindmap') return d.db.getMindmap()
    if (d.type === 'ishikawa') return d.db.getRoot()
    return d.db.getGraph()
  }
  try {
    for (const bare of ['block\nA["A"]', 'sankey-beta\nA,B,1', 'mindmap\n  root((Root))\n    A', 'ishikawa\nEffect\n  Cause']) {
      const [header, ...body] = bare.split('\n')
      const source = wrapper + [header, 'accTitle: Accessible', 'accDescr {', 'First line', 'Second line', '}', '%% body rationale', ...body].join('\n')
      const parsed = parseMermaid(source)
      if (!parsed.ok || parsed.value.body.kind === 'opaque') throw new Error('Expected editable metadata: ' + source)
      const written = serializeMermaid(parsed.value)
      expect(written.startsWith(wrapper)).toBe(true)
      expect(written.match(/%% body rationale/g)).toHaveLength(1)
      expect(await pin.project(written, project)).toEqual(await pin.project(wrapper + bare, project))
      expect(await pin.publicAccepts(written), written).toBe(true)
      const reload = parseMermaid(written)
      if (!reload.ok) throw new Error('Expected native comment reload')
      expect(reload.value.meta.accessibility).toEqual({ title: 'Accessible', descr: 'First line\nSecond line' })
      expect(reload.value.meta.comments).not.toContainEqual(expect.objectContaining({ text: expect.stringContaining('agentic-mermaid acc') }))
      expect(serializeMermaid(reload.value)).toBe(written)
      expect(renderMermaidSVG(written)).toContain('Accessible</title>')
      expect(renderMermaidSVG(written)).toContain('First line\nSecond line</desc>')
      expect(verifyMermaid(reload.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: parsed.value.body.kind + '_accessibility' }))
      const kind = parsed.value.body.kind
      const edited = kind === 'block' ? mutate(parsed.value, { kind: 'rename_block', from: 'A', to: 'B' })
        : kind === 'sankey' ? mutate(parsed.value, { kind: 'rename_node', from: 'A', to: 'C' })
        : kind === 'mindmap' ? mutate(parsed.value, { kind: 'rename_node', from: 'A', to: 'B' })
        : kind === 'ishikawa' ? mutate(parsed.value, { kind: 'set_label', id: parsed.value.body.nodes[1]!.id, label: 'Changed' }) : undefined
      if (!edited?.ok) throw new Error('Expected unrelated typed edit: ' + JSON.stringify(edited))
      expect(edited.value.meta.accessibility).toEqual(reload.value.meta.accessibility)
      expect(await pin.publicAccepts(serializeMermaid(edited.value))).toBe(true)
    }
    for (const bare of ['mindmap\n  root((Root))', 'ishikawa\nEffect\n  Cause']) {
      const parsed = parseMermaid(bare)
      if (!parsed.ok) throw new Error('Expected native diagram')
      for (const title of ['literal #44; &amp; ﬂ°12¶ß', '%%{init:{"theme":"dark"}}%% <b>text</b>', 'Product%%cut', 'A\u2028B', 'A\u2029B', 'A<br>B', 'A<br/>B', 'A\nB']) {
        const edited = mutate(parsed.value, { kind: 'set_accessibility_title', title })
        if (!edited.ok) throw new Error('Expected constructive metadata: ' + JSON.stringify(edited))
        const source = serializeMermaid(edited.value)
        expect(await pin.publicAccepts(source), source).toBe(true)
        const reload = parseMermaid(source)
        if (!reload.ok) throw new Error('Expected literal metadata reload')
        expect(reload.value.meta.accessibility.title).toBe(title)
        expect(reload.value.meta.initDirectives).toEqual([])
        const svg = renderMermaidSVG(source)
        expect(decodeXML(svg.match(/<title[^>]*>([\s\S]*?)<\/title>/)![1]!)).toBe(title)
      }
    }
  } finally { pin.close() }
})


test('native metadata owns preprocessing, while moved ordinary comments remain comments', () => {
  for (const bare of ['block\nA["A"]', 'sankey-beta\nA,B,1', 'mindmap\n root((Root))', 'ishikawa\nEffect\n Cause']) {
    for (const title of ['%%{init: {theme: dark}}%%', '%%{wrap}%%', 'A\u2028B', 'A\u2029B', 'A<br/>B']) {
      const native = '%% agentic-mermaid accTitle: ' + JSON.stringify(title) + '\n'
      const parsed = parseMermaid(native + bare)
      if (!parsed.ok) throw new Error('Expected native field read')
      expect(parsed.value.meta.accessibility).toEqual({ title })
      expect(parsed.value.meta.initDirectives).toEqual([])
      expect(parsed.value.meta.frontmatter?.wrap).toBeUndefined()
      const written = serializeMermaid(parsed.value)
      expect(written.match(/%% agentic-mermaid accTitle:/g)).toHaveLength(1)
      const reload = parseMermaid(written)
      if (!reload.ok) throw new Error('Expected metadata reload')
      expect(reload.value.meta.accessibility).toEqual({ title })
      const body = parsed.value.body
      if (body.kind !== 'block' && body.kind !== 'sankey' && body.kind !== 'mindmap' && body.kind !== 'ishikawa') throw new Error('Expected native metadata family')
      const synthesized = synthesizeFromGraph({
        kind: body.kind,
        body: body.kind === 'sankey' ? body : { ...body, accessibilityTitle: title },
        meta: { accessibility: { title } },
      })
      if (!synthesized.ok) throw new Error('Expected JSON metadata construction: ' + JSON.stringify(synthesized))
      expect(synthesized.value.meta.accessibility).toEqual({ title })
      if (parsed.value.kind === 'mindmap' || parsed.value.kind === 'ishikawa') {
        const clear = mutate(parsed.value, { kind: 'set_accessibility_title', title: null })
        if (!clear.ok) throw new Error('Expected leading metadata removal')
        expect(clear.value.meta.accessibility).toEqual({})
      }
      if (parsed.value.kind === 'mindmap') expect(parseMindmap(written).accessibilityTitle).toBe(title)
    }
  }
  for (const bare of ['block\nA["A"]', 'sankey-beta\nA,B,1', 'mindmap\n root((Root))', 'ishikawa\nEffect\n Cause']) {
    for (const [field, expected] of [['&amp;', '&'], ['&amp;amp;', '&amp;'], ['&#35;44;', ','], ['&lt;br&gt;', '<br>'], ['#amp;amp#59;', '&amp;']] as const) {
      const source = '%% agentic-mermaid accTitle: ' + JSON.stringify(field) + '\n' + bare
      const parsed = parseMermaid(source)
      if (!parsed.ok) throw new Error('Expected authored native field')
      expect(parsed.value.meta.accessibility.title).toBe(expected)
      for (const input of [source, serializeMermaid(parsed.value)]) {
        const svg = renderMermaidSVG(input)
        expect(decodeXML(svg.match(/<title[^>]*>([\s\S]*?)<\/title>/)![1]!)).toBe(expected)
      }
    }
  }
  for (const header of ['mindmap', 'mindm&#97;p']) for (const field of ['accTitle', 'accDescr']) {
    const text = `agentic-mermaid ${field}: "Ordinary comment"`
    const parsed = parseMermaid(`${header}\n root((Start\n%% ${text}\nEnd))`)
    if (!parsed.ok) throw new Error('Expected multiline shaped node')
    const written = serializeMermaid(parsed.value)
    const reload = parseMermaid(written)
    if (!reload.ok) throw new Error('Expected ordinary comment reload')
    expect(reload.value.meta.accessibility).toEqual({})
    expect(reload.value.meta.comments).toContainEqual(expect.objectContaining({ text }))
    expect(serializeMermaid(reload.value)).toBe(written)
  }
})


test('leading native metadata keeps exact header, wrapper and directive source ownership', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const wrapper = ['---', 'title: Diagram', '---', '%% wrapper rationale', ''].join(ending)
    const native = '%% agentic-mermaid accTitle: "%%{wrap}%% &amp; #35;44; 👩🏽‍💻"' + ending
    const init = ['%%{init: {', '"theme": "dark"', '}}%%', ''].join(ending)
    const source = wrapper + native + init + 'mindmap' + ending + ' root((Root))'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error('Expected metadata and config before header')
    expect(parsed.value.meta.wrapperSource).toBe(wrapper)
    expect(parsed.value.meta.initDirectives).toHaveLength(1)
    const spans = parsed.value.source.spans!.preserved
    const text = (span: { start: { offset: number }; end: { offset: number } }) => source.slice(span.start.offset, span.end.offset)
    expect(text(spans.header)).toBe('mindmap')
    expect(text(spans.wrapper!)).toBe(wrapper)
    expect(spans.initDirectives?.map(text)).toEqual([init])
    expect(spans.accessibilityDirectives?.map(text)).toEqual([native])
    const reload = parseMermaid(serializeMermaid(parsed.value))
    if (!reload.ok) throw new Error('Expected owned metadata reload')
    expect(reload.value.meta.accessibility).toEqual(parsed.value.meta.accessibility)
    expect(reload.value.meta.initDirectives).toHaveLength(1)
  }
})


test('an enclosing init scalar owns native-looking text even after a literal unclosed opener', () => {
  for (const ending of ['\n', '\r\n', '\r']) for (const title of [undefined, 'ordinary', '%%{init: literal opener']) {
    const prefix = '%% agentic-mermaid accTitle: "A&B"\n'
    const init = ['%%{init:', 'sankey:', '  showValues: true', '  prefix: |', '    ' + prefix.trimEnd(), '}%%', ''].join(ending)
    const native = '%% agentic-mermaid accDescr: "Actual metadata"' + ending
    const leading = title === undefined ? '' : '%% agentic-mermaid accTitle: ' + JSON.stringify(title) + ending
    const source = leading + init + native + 'sankey-beta' + ending + 'A,B,1'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error('Expected lenient config read')
    expect(parsed.value.meta.accessibility).toEqual({ ...(title === undefined ? {} : { title }), descr: 'Actual metadata' })
    expect(parsed.value.meta.frontmatter?.sankey).toMatchObject({ prefix })
    const spans = parsed.value.source.spans!.preserved
    const slice = (span: { start: { offset: number }; end: { offset: number } }) => source.slice(span.start.offset, span.end.offset)
    expect(spans.initDirectives?.map(slice)).toEqual([init])
    expect(spans.accessibilityDirectives?.map(slice)).toEqual(leading ? [leading, native] : [native])
    const written = serializeMermaid(parsed.value)
    const reloaded = parseMermaid(written)
    if (!reloaded.ok) throw new Error('Expected verbatim config preservation')
    expect(reloaded.value.meta.frontmatter?.sankey).toMatchObject({ prefix })
    expect(decodeXML(renderMermaidSVG(source))).toContain('A&B')
    expect(renderMermaidSVG(source)).not.toContain('A\\u0026B')
  }
})
