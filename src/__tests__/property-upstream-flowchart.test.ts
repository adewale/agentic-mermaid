// Grammar-based differential test: flowchart sources generated from a
// recursive grammar are parsed by the pinned upstream Mermaid (12.2.0,
// devDependency) and by our public parser, and the two must agree.
//
//   (i)   upstream accepts every generated source — validates the generator;
//   (ii)  parseRegisteredMermaid accepts it as a structured flowchart;
//   (iii) vertices, edges (endpoints, stroke, arrowheads, label) and subgraphs
//         agree with the real upstream grammar builder operands before sanitization;
//   (iv)  parse → serialize → re-parse preserves all of the above;
//   (v)   upstream accepts the export and retains those authored operands.
// This is a grammar contract, not equality with HTML sanitized by DOMPurify;
// the live builder wrappers observe inputs and always call the real methods.
//
// Upstream runs in a child process (helpers/upstream-mermaid.ts), so the async
// property keeps shrinking against it: a disagreement is reported as a minimal
// source, not a 20-statement haystack.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { asFlowchart, type FlowchartMutationOp, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { countStructuralElements } from '../agent/structural-count.ts'
import type { MermaidEdge, MermaidGraph, MermaidSubgraph } from '../types.ts'
import { breakLineTags } from '../multiline-utils.ts'
import { toEntityMarkers } from '../shared/mermaid-entities.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import { startUpstreamMermaid, type UpstreamMermaid, type UpstreamParse } from './helpers/upstream-mermaid.ts'

// ---------------------------------------------------------------------------
// The grammar
// ---------------------------------------------------------------------------

type Direction = 'TB' | 'TD' | 'BT' | 'RL' | 'LR'
type Label = { text: string; quoted: boolean }
type NodeRef = { id: string; shape?: ShapeName; label?: Label }
type Link = { arrow: string; text?: Label; form?: 'dash' | 'pipe' }
type Statement =
  | { kind: 'node'; node: NodeRef; semicolon: boolean }
  | { kind: 'chain'; head: NodeRef; tail: Array<{ link: Link; node: NodeRef }>; semicolon: boolean }
  | { kind: 'subgraph'; title?: Label; direction?: Direction; body: Statement[] }
  | { kind: 'style'; id: string }
type Flowchart = { header: 'flowchart' | 'graph'; direction: Direction; body: Statement[] }

// Our shape name → [open, close] delimiters and upstream's vertex type.
const SHAPES = {
  rectangle: { open: '[', close: ']', upstream: 'square' },
  rounded: { open: '(', close: ')', upstream: 'round' },
  diamond: { open: '{', close: '}', upstream: 'diamond' },
  circle: { open: '((', close: '))', upstream: 'circle' },
  asymmetric: { open: '>', close: ']', upstream: 'odd' },
  subroutine: { open: '[[', close: ']]', upstream: 'subroutine' },
  cylinder: { open: '[(', close: ')]', upstream: 'cylinder' },
  hexagon: { open: '{{', close: '}}', upstream: 'hexagon' },
} as const
type ShapeName = keyof typeof SHAPES

const DIRECTIONS: Direction[] = ['TB', 'TD', 'BT', 'RL', 'LR']
// Node ids never collide with subgraph ids (S0, S1, …) or grammar keywords.
const NODE_IDS = ['A', 'B', 'C', 'D', 'E', 'n1', 'n_2', 'Node3', 'k-1']
// Shape text, pipe labels and text-arrow labels hold `;` and a lone backtick
// as text.
const WORDS = ['alpha', 'Beta', 'gamma', 'D4', 'echo', 'Fox', 'go', 'ok', 'x9', 'Zed', 'a;b', 'a`b']
// Upstream's quoted strings have no escapes: `\` is literal, and a label
// spells `"` as the `#quot;` entity code (a bare one closes the string). A
// quoted label masks `@{`; entity codes show as upstream's browser shows
// them; `\n` breaks a plain label's line.
const QUOTED_CHARS = [
  ...'abcXYZ019 ()[]{}<>:,.!?-_/&=+\'*~;\\@`'.split(''),
  '#quot;', '@{', '#9829;', '#35;', '#amp;', '#lt;', '#gt;', '#92;', '\\n',
]
// Edge operators with a fixed spelling; labelled forms are built below.
const ARROWS = ['-->', '---', '-.->', '==>', '-.-', '===', '--o', '--x', '<-->']

const wordsArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 3 }).map(words => words.join(' '))
const labelArb: fc.Arbitrary<Label> = fc.oneof(
  wordsArb.map(text => ({ text, quoted: false })),
  fc
    .array(fc.constantFrom(...QUOTED_CHARS), { minLength: 1, maxLength: 12 })
    .map(chars => ({ text: chars.join(''), quoted: true }))
    // `"` and a backtick open a markdown string, which this grammar does not
    // generate (typed bodies keep them opaque). `&#35;` is an HTML character
    // reference, which the render path decodes before any grammar and our
    // parser keeps as written; upstream reads its `#35;` as an entity code.
    .filter(label => !label.text.startsWith('`') && !/&#\d+;/.test(label.text)),
)
const nodeRefArb: fc.Arbitrary<NodeRef> = fc.oneof(
  fc.constantFrom(...NODE_IDS).map(id => ({ id })),
  fc.record({ id: fc.constantFrom(...NODE_IDS), shape: fc.constantFrom(...(Object.keys(SHAPES) as ShapeName[])), label: labelArb }),
)
const linkArb: fc.Arbitrary<Link> = fc.oneof(
  fc.constantFrom(...ARROWS).map(arrow => ({ arrow })),
  // `-- text -->` takes plain words; `-->|text|` also takes a quoted label.
  wordsArb.map(text => ({ arrow: '-->', text: { text, quoted: false }, form: 'dash' as const })),
  labelArb.filter(label => !label.text.includes('|')).map(text => ({ arrow: '-->', text, form: 'pipe' as const })),
)

const { flowchart: flowchartArb } = fc.letrec<{ statement: Statement; subgraph: Statement; flowchart: Flowchart }>(tie => ({
  statement: fc.oneof(
    { maxDepth: 3, depthIdentifier: 'flowchart-subgraph' },
    fc.record({ kind: fc.constant('chain' as const), head: nodeRefArb, tail: fc.array(fc.record({ link: linkArb, node: nodeRefArb }), { minLength: 1, maxLength: 3 }), semicolon: fc.boolean() }),
    fc.record({ kind: fc.constant('node' as const), node: nodeRefArb, semicolon: fc.boolean() }),
    // A styled id is a mention that creates the node (BUG-29).
    fc.record({ kind: fc.constant('style' as const), id: fc.constantFrom(...NODE_IDS) }),
    tie('subgraph'),
  ),
  subgraph: fc.record(
    {
      kind: fc.constant('subgraph' as const),
      title: labelArb,
      direction: fc.constantFrom(...DIRECTIONS),
      body: fc.array(tie('statement'), { minLength: 1, maxLength: 3, depthIdentifier: 'flowchart-subgraph' }),
    },
    { requiredKeys: ['kind', 'body'] },
  ),
  flowchart: fc.record({
    header: fc.constantFrom('flowchart' as const, 'graph' as const),
    direction: fc.constantFrom(...DIRECTIONS),
    body: fc.array(tie('statement'), { minLength: 1, maxLength: 5, depthIdentifier: 'flowchart-subgraph' }),
  }),
}))

function printLabel(label: Label): string {
  return label.quoted ? `"${label.text}"` : label.text
}

function printNode(node: NodeRef): string {
  if (!node.shape || !node.label) return node.id
  const { open, close } = SHAPES[node.shape]
  return `${node.id}${open}${printLabel(node.label)}${close}`
}

function printLink(link: Link): string {
  if (!link.text) return link.arrow
  return link.form === 'dash' ? `-- ${link.text.text} -->` : `-->|${printLabel(link.text)}|`
}

function printFlowchart(chart: Flowchart): string {
  let nextSubgraph = 0
  const lines = [`${chart.header} ${chart.direction}`]
  const emit = (statements: Statement[], depth: number) => {
    const indent = '  '.repeat(depth)
    for (const statement of statements) {
      if (statement.kind === 'subgraph') {
        const id = `S${nextSubgraph++}`
        lines.push(`${indent}subgraph ${id}${statement.title ? ` [${printLabel(statement.title)}]` : ''}`)
        if (statement.direction) lines.push(`${indent}  direction ${statement.direction}`)
        emit(statement.body, depth + 1)
        lines.push(`${indent}end`)
        continue
      }
      if (statement.kind === 'style') {
        lines.push(`${indent}style ${statement.id} fill:#f00`)
        continue
      }
      const text = statement.kind === 'node'
        ? printNode(statement.node)
        : [printNode(statement.head), ...statement.tail.map(({ link, node }) => `${printLink(link)} ${printNode(node)}`)].join(' ')
      lines.push(`${indent}${text}${statement.semicolon ? ';' : ''}`)
    }
  }
  emit(chart.body, 1)
  return lines.join('\n')
}

/** Upstream's preprocessor (`cleanupText`) reads a `<word …>` span as an HTML
 *  tag and rewrites each `="…"` inside it to `='…'`. Quoted labels can form
 *  one: `<` and a word character in one label, a later label ending in `=`,
 *  and a `>` after it (an arrow, say). The rewrite moves upstream's string
 *  delimiters, so upstream rejects the source or parses other labels; that is
 *  preprocessing, not flowchart grammar, so the generator never emits it. */
function rewrittenByUpstreamPreprocess(source: string): boolean {
  return /<\w[^>]*="[^">]*"[^>]*>/.test(source)
}

const sourceArb = flowchartArb.map(printFlowchart).filter(source => !rewrittenByUpstreamPreprocess(source))

// ---------------------------------------------------------------------------
// One comparable projection for both parsers
// ---------------------------------------------------------------------------

type Projection = {
  vertices: string[]
  edges: string[]
  subgraphs: string[]
}

/** Our edge in upstream's vocabulary: start end stroke type : label. */
function edgeKey(edge: MermaidEdge): string {
  const stroke = edge.style === 'solid' ? 'normal' : edge.style
  const marker = edge.endMarker === 'circle' ? 'circle' : edge.endMarker === 'cross' ? 'cross' : 'point'
  const type = !edge.hasArrowEnd ? 'arrow_open' : `${edge.hasArrowStart ? 'double_' : ''}arrow_${marker}`
  return `${edge.source} ${edge.target} ${stroke} ${type} : ${edge.label ?? ''}`
}

function flattenSubgraphs(subgraphs: MermaidSubgraph[]): MermaidSubgraph[] {
  return subgraphs.flatMap(subgraph => [subgraph, ...flattenSubgraphs(subgraph.children)])
}

/** Node ids that more than one subgraph lists. Upstream lists each node in
 *  one subgraph at most (`makeUniq`), and so must we. */
function sharedMembers(graph: MermaidGraph): string[] {
  const members = flattenSubgraphs(graph.subgraphs).flatMap(subgraph => subgraph.nodeIds)
  return [...new Set(members.filter((id, index) => members.indexOf(id) !== index))]
}

function ours(graph: MermaidGraph): Projection {
  return {
    vertices: [...graph.nodes.values()].map(node => `${node.id} ${node.shape} : ${node.label}`).sort(),
    edges: graph.edges.map(edgeKey),
    subgraphs: flattenSubgraphs(graph.subgraphs).map(subgraph => `${subgraph.id} : ${subgraph.label}`).sort(),
  }
}

const UPSTREAM_TYPE_TO_OURS = Object.fromEntries(Object.entries(SHAPES).map(([name, shape]) => [shape.upstream, name]))

/** What upstream shows for a plain label its DB holds: the renderer breaks
 *  the line at `\n` and `<br>`, then the browser resolves each entity
 *  placeholder (`#9829;` → `ﬂ°°9829¶ß` → `&#9829;` → ♥), which our parser
 *  decodes. */
const displayed = (text: string): string => projectEntityMarkers(breakLineTags(text).replace(/\\n/g, '\n'))

function theirs(parsed: Extract<UpstreamParse, { ok: true }>): Projection {
  const db = parsed.flowchart
  if (!db) throw new Error(`upstream diagram type ${parsed.type} exposes no flowchart DB`)
  return {
    // A vertex never given a shape is a plain rectangle labelled by its id.
    vertices: db.vertices.map(v => `${v.id} ${v.type ? UPSTREAM_TYPE_TO_OURS[v.type] ?? `upstream:${v.type}` : 'rectangle'} : ${displayed(v.text)}`).sort(),
    edges: db.edges.map(e => `${e.start} ${e.end} ${e.stroke} ${e.type} : ${displayed(e.text)}`),
    subgraphs: db.subgraphs.map(s => `${s.id} : ${displayed(s.title)}`).sort(),
  }
}

function parseOurs(source: string): MermaidGraph {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(`our parser rejected:\n${source}\n${parsed.error.map(e => e.message).join('; ')}`)
  const flowchart = asFlowchart(parsed.value)
  if (!flowchart) throw new Error(`our parser did not produce a structured flowchart (${parsed.value.body.kind}):\n${source}`)
  return flowchart.body.graph
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('flowchart grammar differential against pinned upstream Mermaid', () => {
  let upstream: UpstreamMermaid
  beforeAll(() => {
    upstream = startUpstreamMermaid()
  })
  afterAll(() => upstream.close())

  test('the #372 preprocessing witness stays readable and exports portably with a precise warning', async () => {
    const source = 'flowchart TD\nA -->|"<a="| B["b"] --> C'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || !asFlowchart(parsed.value)) throw new Error('structured flowchart required')
    expect(ours(parseOurs(source))).toEqual({
      vertices: ['A rectangle : A', 'B rectangle : b', 'C rectangle : C'],
      edges: ['A B normal arrow_point : <a=', 'B C normal arrow_point : '],
      subgraphs: [],
    })
    const verified = verifyMermaid(parsed.value)
    expect(verified.warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'mermaid_cleanup', line: 2 }))
    expect(verified.warnings.some(warning => warning.code === 'RENDER_FAILED')).toBe(false)
    expect((await upstream.parse(source)).ok).toBe(false)
    const written = serializeMermaid(parsed.value)
    expect(written).toContain('#lt;a=')
    const upstreamWritten = await upstream.parse(written)
    expect(upstreamWritten.ok).toBe(true)
    if (!upstreamWritten.ok) throw new Error('portable export rejected')
    expect(theirs(upstreamWritten)).toEqual(ours(parseOurs(source)))
    expect(ours(parseOurs(written))).toEqual(ours(parseOurs(source)))
    expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(source))
    expect(renderMermaidSVG(source)).toContain('&lt;a=')
    const reread = parseRegisteredMermaid(written)
    if (!reread.ok) throw new Error('export rejected')
    expect(verifyMermaid(reread.value).warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'mermaid_cleanup')).toBe(false)

    // A dashed final edge leaves the preceding <a= label outside an HTML
    // tag, so both parsers read the same literal label without repair.
    const untouched = 'flowchart TB\n  subgraph S0\n    A -->|"<a="| A["a"] --- A\n  end'
    expect(await upstream.accepts(untouched)).toBe(true)
    expect(parseOurs(untouched).edges.map(edge => edge.label ?? '')).toEqual(['<a=', ''])
  })

  test('a preprocessing quote rewrite that breaks metadata YAML is diagnosed and exports portably', async () => {
    const source = 'flowchart TD\nA@{label: \'<a href="x">ok</a>\'} --> B'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || !asFlowchart(parsed.value)) throw new Error('structured flowchart required')
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'mermaid_cleanup', line: 2 }))
    expect(await upstream.accepts(source)).toBe(false)
    const written = serializeMermaid(parsed.value)
    const upstreamWritten = await upstream.parse(written)
    if (!upstreamWritten.ok) throw new Error('portable export rejected')
    expect(theirs(upstreamWritten)).toEqual(ours(parseOurs(source)))
    expect(ours(parseOurs(written))).toEqual(ours(parseOurs(source)))
    expect(renderMermaidASCII(written)).toBe(renderMermaidASCII(source))
    expect(renderMermaidSVG(source)).toContain('&lt;a href=&quot;x&quot;&gt;ok&lt;/a&gt;')
    expect(verifyMermaid(written).warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'mermaid_cleanup')).toBe(false)
  })

  // Observe label operands at the real builder boundary while still calling
  // every original method, including DOMPurify. Grammar parity concerns the
  // author's tokens; sanitized DB text is deliberately lossy for e.g. `<a`.
  async function grammarParse(source: string): Promise<UpstreamParse> {
    const result = await upstream.project(source, async diagram => {
      const db = diagram.db
      const vertices = new Map<string, string>(), edges: string[] = [], groups = new Map<string, string>()
      const vertex = db.addVertex, link = db.addSingleLink, group = db.addSubGraph
      db.clear()
      db.addVertex = function (...args: any[]) {
        if (args[1] !== undefined) vertices.set(args[0], args[1].text.trim())
        return vertex.apply(db, args)
      }
      db.addSingleLink = function (...args: any[]) {
        edges.push((args[2].text?.text ?? '').trim().replace(/^"([\s\S]*)"$/, '$1'))
        return link.apply(db, args)
      }
      db.addSubGraph = function (...args: any[]) {
        const id = group.apply(db, args)
        if (!groups.has(id)) groups.set(id, args[2].text.trim())
        return id
      }
      try {
        await diagram.parser.parse(diagram.text)
        return {
          type: diagram.type,
          flowchart: {
            vertices: [...db.getVertices().values()].map((node: any) => ({ id: node.id, type: node.type, text: vertices.get(node.id) ?? node.text })),
            edges: db.getEdges().map((edge: any, index: number) => ({ start: edge.start, end: edge.end, type: edge.type, stroke: edge.stroke, text: edges[index] ?? edge.text })),
            subgraphs: db.getSubGraphs().map((node: any) => ({ id: node.id, title: groups.get(node.id) ?? node.title, nodes: node.nodes })),
          },
        }
      } finally { db.addVertex = vertex; db.addSingleLink = link; db.addSubGraph = group }
    })
    return result.ok ? { ok: true, ...result.value } : result
  }

  test('(i)–(v) upstream and our parser agree on every generated flowchart', async () => {
    await fc.assert(
      fc.asyncProperty(sourceArb, async source => {
        const upstreamParse = await grammarParse(source)
        // (i) the generator only produces Mermaid 12.2.0 flowcharts.
        expect({ source, upstream: upstreamParse.ok ? 'accepted' : upstreamParse.error }).toEqual({ source, upstream: 'accepted' })
        if (!upstreamParse.ok) return
        // (ii) our public parser accepts it as a structured flowchart.
        const graph = parseOurs(source)
        // (iii) the same authored vertices, edges and subgraphs as upstream's live builder calls, and
        // the faithfulness counter reports upstream's counts.
        const expected = theirs(upstreamParse)
        expect({ source, ...ours(graph) }).toEqual({ source, ...expected })
        expect({ source, shared: sharedMembers(graph) }).toEqual({ source, shared: [] })
        const parsed = parseRegisteredMermaid(source)
        if (!parsed.ok) return
        expect({ source, count: countStructuralElements(parsed.value) }).toEqual({
          source,
          count: { nodes: expected.vertices.length, edges: expected.edges.length, groups: expected.subgraphs.length },
        })
        // (iv) serialize → re-parse keeps the same diagram and structural count.
        const serialized = serializeMermaid(parsed.value)
        expect({ serialized, ...ours(parseOurs(serialized)) }).toEqual({ serialized, ...expected })
        const reparsed = parseRegisteredMermaid(serialized)
        expect(reparsed.ok && countStructuralElements(reparsed.value)).toEqual(countStructuralElements(parsed.value))
        // (v) the real parser accepts the export and retains the authored builder operands.
        const upstreamReparse = await grammarParse(serialized)
        expect({ serialized, upstream: upstreamReparse.ok ? theirs(upstreamReparse) : upstreamReparse.error })
          .toEqual({ serialized, upstream: expected })
      }),
      fcParameters({ numRuns: 100, examples: [['flowchart TB\n  A[alpha] -->|"<a"| A']] }),
    )
  }, 20_000)

  // Divergences this property found, now fixed: each source agrees with
  // upstream, matches the recorded projection, and survives serialize →
  // re-parse, by our parser and by upstream. Returns the serialized source.
  async function agreesWithUpstream(source: string, expected: Partial<Projection>): Promise<string> {
    const upstreamParse = await upstream.parse(source)
    if (!upstreamParse.ok) throw new Error(`upstream rejected:\n${source}`)
    const projection = ours(parseOurs(source))
    expect({ source, ...projection }).toEqual({ source, ...theirs(upstreamParse) })
    expect({ source, ...projection }).toMatchObject({ source, ...expected })
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
    const serialized = serializeMermaid(parsed.value)
    expect({ serialized, ...ours(parseOurs(serialized)) }).toEqual({ serialized, ...projection })
    const upstreamReparse = await upstream.parse(serialized)
    expect({ serialized, upstream: upstreamReparse.ok ? theirs(upstreamReparse) : upstreamReparse.error })
      .toEqual({ serialized, upstream: projection })
    return serialized
  }

  test('plain labels keep `*` and `~` literally; only markdown strings format them', async () => {
    await agreesWithUpstream('flowchart TB\n  A["*a*"]', { vertices: ['A rectangle : *a*'] })
    await agreesWithUpstream('flowchart TB\n  A[**b**]', { vertices: ['A rectangle : **b**'] })
    await agreesWithUpstream('flowchart TB\n  A>"~~c~~"] -->|"*x*"| B', {
      vertices: ['A asymmetric : ~~c~~', 'B rectangle : B'],
      edges: ['A B normal arrow_point : *x*'],
    })
  })

  test('node, edge and subgraph labels trim boundary whitespace', async () => {
    await agreesWithUpstream('flowchart TB\n  A[" a "] -->|" b "| B', {
      vertices: ['A rectangle : a', 'B rectangle : B'],
      edges: ['A B normal arrow_point : b'],
    })
    await agreesWithUpstream('flowchart TB\n  A[ c ] -- " d " --> B', {
      vertices: ['A rectangle : c', 'B rectangle : B'],
      edges: ['A B normal arrow_point : d'],
    })
    // A blank label trims to empty and serializes as `" "`: upstream rejects `""`.
    const serialized = await agreesWithUpstream('flowchart TB\n  subgraph S0 [" e "]\n    A[" "]\n  end', {
      vertices: ['A rectangle : '],
      subgraphs: ['S0 : e'],
    })
    expect(serialized).toContain('  subgraph S0[e]\n    A[" "]\n')
  })

  test('a `;`-bearing label keeps its quotes, so the serialized source re-parses', async () => {
    const node = await agreesWithUpstream('flowchart TB\n  A>";a"] --> B', { vertices: ['A asymmetric : ;a', 'B rectangle : B'] })
    expect(node.split('\n')).toContain('  A>";a"] --> B')
    const title = await agreesWithUpstream('flowchart TB\n  subgraph S0 ["};a"]\n    A\n  end', { subgraphs: ['S0 : };a'] })
    expect(title.split('\n')).toContain('  subgraph S0["};a"]')
  })

  test('what upstream rejects, our parser rejects', async () => {
    for (const source of [
      // BUG-39: `--` and `-.` open a link, so no node id holds them. What
      // the author meant (an id, or a link label) is unclear.
      'flowchart TB\n  A--a --> A--a',
      'flowchart TB\n  foo--bar\n  foo',
      'flowchart TB\n  A--a["x"]',
      'flowchart TB\n  A--b@{ label: "y" }',
      'flowchart TB\n  A:::c--d',
    ]) {
      const upstreamParse = await upstream.parse(source)
      const ours = parseRegisteredMermaid(source)
      expect({ source, upstream: upstreamParse.ok, ours: ours.ok }).toEqual({ source, upstream: false, ours: false })
    }
  })

  test('BUG-29: `style X` creates node X where it stands, in no subgraph, as upstream does', async () => {
    for (const source of [
      'flowchart TB\n  style Z fill:#f00\n  A --> Z',
      'flowchart TB\n  subgraph S\n    style X fill:#f00\n    Y\n  end',
    ]) {
      const upstreamParse = await upstream.parse(source)
      if (!upstreamParse.ok) throw new Error(`upstream rejected:\n${source}`)
      const graph = parseOurs(source)
      expect({
        source,
        order: [...graph.nodes.keys()],
        members: flattenSubgraphs(graph.subgraphs).map(subgraph => `${subgraph.id}: ${subgraph.nodeIds.join(' ')}`),
      }).toEqual({
        source,
        order: upstreamParse.flowchart!.vertices.map(vertex => vertex.id),
        members: upstreamParse.flowchart!.subgraphs.map(subgraph => `${subgraph.id}: ${subgraph.nodes.join(' ')}`),
      })
    }
  })

  test('BUG-27: a node listed by two subgraphs belongs to the first to close, once', async () => {
    // Upstream's own lists (getSubGraphs), less nested subgraph ids.
    const membership = async (source: string) => {
      const upstreamParse = await upstream.parse(source)
      if (!upstreamParse.ok) throw new Error(`upstream rejected:\n${source}`)
      const subgraphIds = new Set(upstreamParse.flowchart!.subgraphs.map(subgraph => subgraph.id))
      return {
        source,
        ours: flattenSubgraphs(parseOurs(source).subgraphs).map(subgraph => `${subgraph.id}: ${subgraph.nodeIds.join(' ')}`).sort(),
        upstream: upstreamParse.flowchart!.subgraphs
          .map(subgraph => `${subgraph.id}: ${subgraph.nodes.filter(id => !subgraphIds.has(id)).join(' ')}`).sort(),
      }
    }
    for (const source of [
      'flowchart TB\n  subgraph S0\n    A[x]\n  end\n  subgraph S1\n    A[y]\n    B\n  end\n  A --> B',
      'flowchart TB\n  subgraph Outer\n    A[x] --> B\n    subgraph Inner\n      A[y]\n    end\n  end',
    ]) {
      const result = await membership(source)
      expect(result.ours).toEqual(result.upstream)
    }
  })

  test('BUG-21: `>…]` is shape text, so a `;` in an asymmetric label is text', async () => {
    await agreesWithUpstream('flowchart TB\n  A>x;y] --> B; B --> C', {
      vertices: ['A asymmetric : x;y', 'B rectangle : B', 'C rectangle : C'],
      edges: ['A B normal arrow_point : ', 'B C normal arrow_point : '],
    })
  })

  test('BUG-22: a quoted label masks `@{`, in the gate and across lines', async () => {
    await agreesWithUpstream('flowchart TB\n  A["x a@{y}"] --> B\n  B --> C', {
      vertices: ['A rectangle : x a@{y}', 'B rectangle : B', 'C rectangle : C'],
    })
    await agreesWithUpstream('flowchart TB\n  A["x @{y"] --> B\n  B -->|"z@{"| C', {
      vertices: ['A rectangle : x @{y', 'B rectangle : B', 'C rectangle : C'],
      edges: ['A B normal arrow_point : ', 'B C normal arrow_point : z@{'],
    })
  })

  test('a text-arrow label closes with any link of its stroke, as upstream\'s edge-text states close', async () => {
    // A dotted link may leave out its leading `-`, so one may follow a label
    // that `.-` closes. A thick or dotted closer may end in a cross or a
    // circle, and an `x` or `o` opener starts a label that one so ends.
    await agreesWithUpstream('flowchart TB\n  A-.b-.->B\n  B -. c .- C\n  E -- f --o F\n  F -. g ..-> G\n  G == h ===> H\n  H -. i .- I .-> J\n  J -. k .-x K\n  K == l ==o L\n  L x== m ==x M', {
      edges: [
        'A B dotted arrow_point : b', 'B C dotted arrow_open : c', 'E F normal arrow_circle : f',
        'F G dotted arrow_point : g', 'G H thick arrow_point : h',
        'H I dotted arrow_open : i', 'I J dotted arrow_point : ',
        'J K dotted arrow_cross : k', 'K L thick arrow_circle : l', 'L M thick double_arrow_cross : m',
      ],
    })
  })

  test('a text-arrow label runs to its closing link, `;` included, spaced or compact', async () => {
    await agreesWithUpstream('flowchart TB\n  A--a;b-->B; B -- c;d --> C', {
      edges: ['A B normal arrow_point : a;b', 'B C normal arrow_point : c;d'],
    })
  })

  test('BUG-19: entity codes in node, edge and subgraph labels show as upstream shows them', async () => {
    const serialized = await agreesWithUpstream('flowchart TB\n  A["I #9829; you"] -->|#35;1 #amp; #lt;x#gt;| B[#quot;q#quot;]\n  subgraph S0 [t #9829; #32;]\n    C@{ label: "c#35;" }\n  end', {
      vertices: ['A rectangle : I ♥ you', 'B rectangle : "q"', 'C rectangle : c#'],
      edges: ['A B normal arrow_point : #1 & <x>'],
      subgraphs: ['S0 : t ♥  '],
    })
    expect(serialized.split('\n')).toContain('  A[I ♥ you] -->|#1 & #lt;x>| B["#quot;q#quot;"]')
  })

  test('an HTML character reference is the render path\'s: the parser keeps it, and so does the writer', () => {
    // The render path decodes `&#x3C;` to `<` before any grammar
    // (render-contract.ts); a parsed body keeps it as written, so parse →
    // serialize → render still shows `<`. Upstream reads its `#x3C;` as an
    // entity code and shows `&&x3C;`: a recorded divergence, not an upstream match.
    const source = 'flowchart TB\n  A["Map&#x3C;K,V&#x3E; &#60;"] --> B'
    const label = parseOurs(source).nodes.get('A')?.label
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('our parser rejected the source')
    const serialized = serializeMermaid(parsed.value)
    expect({ label, reparsed: parseOurs(serialized).nodes.get('A')?.label })
      .toEqual({ label: 'Map&#x3C;K,V&#x3E; &#60;', reparsed: 'Map&#x3C;K,V&#x3E; &#60;' })
  })

  test('literal entity-produced tags survive editing in node, pipe and subgraph labels', async () => {
    const source = 'flowchart TB\n  subgraph G["#lt;u#gt;group#lt;/u#gt;"]\n  A["#lt;b#gt;box#lt;/b#gt;"] -->|"#lt;i#gt;edge#lt;/i#gt;"| B\n  end'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('fixture rejected')
    const edited = mutate(parsed.value, { kind: 'add_node', id: 'C', label: 'C' })
    if (!edited.ok) throw new Error('edit refused')
    const written = serializeMermaid(edited.value)
    expect(await upstream.accepts(written)).toBe(true)
    for (const candidate of [source, written]) {
      const graph = parseOurs(candidate)
      expect(graph.nodes.get('A')?.label).toBe('<b>box</b>')
      expect(graph.edges[0]?.label).toBe('<i>edge</i>')
      expect(graph.subgraphs[0]?.label).toBe('<u>group</u>')
      const svg = renderMermaidSVG(candidate)
      const terminal = renderMermaidASCII(candidate)
      for (const text of ['<b>box</b>', '<i>edge</i>', '<u>group</u>']) {
        expect(svg).toContain(text.replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
        expect(terminal).toContain(text)
      }
    }
  })

  test('real formatting and literal tags retain separate meanings through same-value and changed labels', async () => {
    const source = 'flowchart TB\n A["<b>real</b> #lt;b#gt;literal#lt;/b#gt;"]'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('fixture rejected')
    const label = asFlowchart(parsed.value)?.body.graph.nodes.get('A')?.label
    if (!label) throw new Error('missing label')
    const same = mutate(parsed.value, { kind: 'set_label', target: 'A', label })
    if (!same.ok) throw new Error('same-value edit refused')
    const written = serializeMermaid(same.value)
    expect(await upstream.accepts(written)).toBe(true)
    expect(renderMermaidSVG(written)).toContain('&lt;b&gt;literal&lt;/b&gt;')
    expect(renderMermaidASCII(written)).toContain('real <b>literal</b>')
    expect(verifyMermaid(same.value, { labelCharCap: 12 }).warnings.some(warning => warning.code === 'LABEL_OVERFLOW')).toBe(true)
    const changed = mutate(same.value, { kind: 'set_label', target: 'A', label: '<b>changed</b> literal #quot;' })
    if (!changed.ok) throw new Error('changed-label edit refused')
    const changedSource = serializeMermaid(changed.value)
    expect(await upstream.accepts(changedSource)).toBe(true)
    expect(parseOurs(changedSource).nodes.get('A')?.label).toBe('<b>changed</b> literal #quot;')
    expect(renderMermaidASCII(changedSource)).toContain('changed literal #quot;')
    expect(renderMermaidSVG(changedSource)).toMatch(/<tspan\b[^>]*\bfont-weight="(?:bold|700)"[^>]*>changed<\/tspan>/)
  })

  test('quoted labels have no escapes: `\\` stays literal and `"` is written `#quot;`', async () => {
    // A `\` before the closing quote used to escape it and `\\` read as one
    // backslash, while the serializer wrote `\"`, which upstream rejects.
    const serialized = await agreesWithUpstream('flowchart TB\n  A["a#quot;b\\\\c"] -->|"(e#quot;|q\\"| B\n  B --> C>";\\"];', {
      vertices: ['A rectangle : a"b\\\\c', 'B rectangle : B', 'C asymmetric : ;\\'],
      edges: ['A B normal arrow_point : (e"|q\\', 'B C normal arrow_point : '],
    })
    expect(serialized.split('\n')).toEqual(expect.arrayContaining(['  A["a#quot;b\\\\c"] -->|"(e#quot;|q\\"| B', '  B --> C>";\\"]']))
    // An apostrophe is label text, not a string delimiter, so it cannot expose
    // the `;` of a later `#quot;` to the statement splitter, nor hide the `;`
    // of a text-arrow label from it.
    await agreesWithUpstream('flowchart TB\n  A[it\'s] -- a;b --> B["\']x#quot;"];C', {
      vertices: ['A rectangle : it\'s', 'B rectangle : \']x"', 'C rectangle : C'],
      edges: ['A B normal arrow_point : a;b'],
    })
  })

  test('a `@{ label }` value is YAML upstream: `\\` is written `\\\\` and `"` as `#quot;`', async () => {
    const labels = async (source: string) => {
      const upstreamParse = await upstream.parse(source)
      if (!upstreamParse.ok) throw new Error(`upstream rejected:\n${source}`)
      return { source, ours: parseOurs(source).nodes.get('A')?.label, upstream: displayed(upstreamParse.flowchart!.vertices[0]!.text) }
    }
    const source = 'flowchart TB\n  A@{ shape: manual-input, label: "a\\\\b#quot;c" }'
    expect(await labels(source)).toEqual({ source, ours: 'a\\b"c', upstream: 'a\\b"c' })
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(`our parser rejected:\n${source}`)
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain('label: "a\\\\b#quot;c"')
    expect(await labels(serialized)).toEqual({ source: serialized, ours: 'a\\b"c', upstream: 'a\\b"c' })
  })

  test('every subgraph title is written in a form upstream parses', async () => {
    // Upstream rejects each of these titles bare, and a title holding `"` and
    // a `;` after a closing delimiter (`x"};a`) had no form that re-parsed.
    const titles = [
      ['"x#quot;};a"', 'x"};a'], ['"a(b)"', 'a(b)'], ['"a]b"', 'a]b'], ['"a|b"', 'a|b'],
      ['"a@b"', 'a@b'], ['"/a/"', '/a/'], ['"\\a"', '\\a'], ['"~~~a"', '~~~a'],
    ]
    for (const [authored, title] of titles) {
      const serialized = await agreesWithUpstream(`flowchart TB\n  subgraph S0 [${authored}]\n    A\n  end`, { subgraphs: [`S0 : ${title}`] })
      expect(serialized.split('\n')).toContain(`  subgraph S0[${authored}]`)
    }
  })

  test('typed labels holding `"`, `\\`, `@` or delimiters serialize to a source both parsers read back', async () => {
    const parsed = parseRegisteredMermaid('flowchart TB\n  A --> B')
    const start = parsed.ok ? asFlowchart(parsed.value) : undefined
    if (!start) throw new Error('the starting flowchart did not parse')
    // BUG-23: a literal backslash-n, the text `#quot;` or any entity-shaped
    // text, a literal `<br>` and a leading backtick are written as upstream's
    // entity codes (`#92;n`, `#35;quot;`, `#lt;br>`, `#96;`).
    for (const label of ['say "hi"', 'a|b\\', '(x\\', 'x"};a', '/lean/', '-dash', '~~~t', 'user@example.com', '"',
      'a\\nb', '#quot;', 'I #9829; you', 'a<br>b', '<i>x</i> < y', '`x(y)', 'x\\\\n', 'ﬂ°amp¶ß', '&"', '&#quot;']) {
      let diagram = start
      const ops: FlowchartMutationOp[] = [
        { kind: 'set_label', target: 'A', label },
        { kind: 'add_edge', from: 'A', to: 'C', label },
        { kind: 'add_subgraph', id: 'G', label, members: ['B'] },
      ]
      for (const op of ops) {
        const result = mutate(diagram, op)
        if (!result.ok) throw new Error(result.error.message)
        diagram = result.value
      }
      const expected = ours(diagram.body.graph)
      const serialized = serializeMermaid(diagram)
      expect({ serialized, ...ours(parseOurs(serialized)) }).toEqual({ serialized, ...expected })
      const upstreamParse = await upstream.parse(serialized)
      expect({ serialized, upstream: upstreamParse.ok ? theirs(upstreamParse) : upstreamParse.error })
        .toEqual({ serialized, upstream: expected })
    }
  })
})
