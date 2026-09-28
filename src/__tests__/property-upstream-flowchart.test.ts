// Grammar-based differential test: flowchart sources generated from a
// recursive grammar are parsed by the pinned upstream Mermaid (11.16.0,
// devDependency) and by our public parser, and the two must agree.
//
//   (i)   upstream accepts every generated source — validates the generator;
//   (ii)  parseRegisteredMermaid accepts it as a structured flowchart;
//   (iii) vertices, edges (endpoints, stroke, arrowheads, label) and subgraphs
//         agree with upstream's flowchart DB;
//   (iv)  parse → serialize → re-parse preserves all of the above.
//
// Upstream runs in a child process (helpers/upstream-mermaid.ts), so the async
// property keeps shrinking against it: a disagreement is reported as a minimal
// source, not a 20-statement haystack.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { asFlowchart, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { countStructuralElements } from '../agent/structural-count.ts'
import type { MermaidEdge, MermaidGraph, MermaidSubgraph } from '../types.ts'
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
const WORDS = ['alpha', 'Beta', 'gamma', 'D4', 'echo', 'Fox', 'go', 'ok', 'x9', 'Zed']
const QUOTED_CHARS = 'abcXYZ019 ()[]{}<>:,.!?-_/&=+\''.split('') // no `*`/`~` (KD2), no `;` (KD4)
// Edge operators with a fixed spelling; labelled forms are built below.
const ARROWS = ['-->', '---', '-.->', '==>', '-.-', '===', '--o', '--x', '<-->']

const wordsArb = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 3 }).map(words => words.join(' '))
const labelArb: fc.Arbitrary<Label> = fc.oneof(
  wordsArb.map(text => ({ text, quoted: false })),
  fc
    .array(fc.constantFrom(...QUOTED_CHARS), { minLength: 1, maxLength: 12 })
    .map(chars => chars.join('').trim()) // KD3: no boundary whitespace
    .filter(text => text.length > 0)
    .map(text => ({ text, quoted: true })),
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
      const text = statement.kind === 'node'
        ? printNode(statement.node)
        : [printNode(statement.head), ...statement.tail.map(({ link, node }) => `${printLink(link)} ${printNode(node)}`)].join(' ')
      lines.push(`${indent}${text}${statement.semicolon ? ';' : ''}`)
    }
  }
  emit(chart.body, 1)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Known divergences (found by this property; product code deliberately
// unchanged). Each is steered around by the generator AND pinned below, so a
// fix turns its pinned test red: delete the entry and its steering then.
// ---------------------------------------------------------------------------

const KNOWN_DIVERGENCES = {
  // KD1: upstream's addVertex lets a later declaration replace a node's shape
  // and label; ours keeps whatever registered the id first (src/parser.ts
  // registerNode), even a bare reference. Minimal repros:
  //   flowchart TB\n  A --> B\n  A[alpha]   upstream A = square "alpha"; ours rectangle "A"
  //   flowchart TB\n  A[x] --> A[y]         upstream A = "y"; ours "x"
  lateDeclaration: [
    { source: 'flowchart TB\n  A --> B\n  A[alpha]', upstream: 'A rectangle : alpha', ours: 'A rectangle : A' },
    { source: 'flowchart TB\n  A[x] --> A[y]', upstream: 'A rectangle : y', ours: 'A rectangle : x' },
  ],
  // KD2: plain (non-markdown) node and edge labels get markdown-lite
  // formatting (src/multiline-utils.ts normalizeBrTags: `*x*` → italic,
  // `**x**` → bold, `~~x~~` → strike); upstream keeps the characters and only
  // formats backtick markdown strings. Steering: no `*` or `~` in labels.
  plainLabelMarkdown: [
    { source: 'flowchart TB\n  A["*a*"]', upstream: 'A rectangle : *a*', ours: 'A rectangle : <i>a</i>' },
    { source: 'flowchart TB\n  A[**b**]', upstream: 'A rectangle : **b**', ours: 'A rectangle : <b>b</b>' },
  ],
  // KD3: node labels (quoted or not) and quoted edge labels keep boundary
  // whitespace; upstream's DB trims it. Ours looks deliberate (agent.test.ts
  // "typed mutations preserve boundary whitespace in labels") but diverges.
  // Steering: generated labels never start or end with a space.
  boundaryWhitespace: [
    { source: 'flowchart TB\n  A[" a "]', upstream: 'A rectangle : a', ours: 'A rectangle :  a ' },
  ],
} as const

// KD4 (a round-trip bug, property iv): the serializer drops the quotes from a
// `;`-bearing label, and `;` is a statement separator. Brackets shield it in
// `A[;a]`, but not in an asymmetric `A>;a]` node or after a closing bracket in
// a subgraph title, so our own parser rejects the serialized source.
// Steering: labels never contain `;`.
const KNOWN_ROUND_TRIP_BUGS = [
  { source: 'flowchart TB\n  A>";a"] --> B', serializedLine: '  A>;a] --> B' },
  { source: 'flowchart TB\n  subgraph S0 ["};a"]\n    A\n  end', serializedLine: '  subgraph S0[};a]' },
] as const

/** KD1 steering: a node may carry a shape/label only at its first mention. */
function declareOnlyAtFirstMention(chart: Flowchart): Flowchart {
  const seen = new Set<string>()
  const visit = (node: NodeRef): NodeRef => {
    const first = !seen.has(node.id)
    seen.add(node.id)
    return first ? node : { id: node.id }
  }
  const statements = (list: Statement[]): Statement[] =>
    list.map(statement =>
      statement.kind === 'subgraph'
        ? { ...statement, body: statements(statement.body) }
        : statement.kind === 'node'
          ? { ...statement, node: visit(statement.node) }
          : { ...statement, head: visit(statement.head), tail: statement.tail.map(({ link, node }) => ({ link, node: visit(node) })) },
    )
  return { ...chart, body: statements(chart.body) }
}

const sourceArb = flowchartArb.map(declareOnlyAtFirstMention).map(printFlowchart)

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

function ours(graph: MermaidGraph): Projection {
  return {
    vertices: [...graph.nodes.values()].map(node => `${node.id} ${node.shape} : ${node.label}`).sort(),
    edges: graph.edges.map(edgeKey),
    subgraphs: flattenSubgraphs(graph.subgraphs).map(subgraph => `${subgraph.id} : ${subgraph.label}`).sort(),
  }
}

const UPSTREAM_TYPE_TO_OURS = Object.fromEntries(Object.entries(SHAPES).map(([name, shape]) => [shape.upstream, name]))

function theirs(parsed: Extract<UpstreamParse, { ok: true }>): Projection {
  const db = parsed.flowchart
  if (!db) throw new Error(`upstream diagram type ${parsed.type} exposes no flowchart DB`)
  return {
    // A vertex never given a shape is a plain rectangle labelled by its id.
    vertices: db.vertices.map(v => `${v.id} ${v.type ? UPSTREAM_TYPE_TO_OURS[v.type] ?? `upstream:${v.type}` : 'rectangle'} : ${v.text}`).sort(),
    edges: db.edges.map(e => `${e.start} ${e.end} ${e.stroke} ${e.type} : ${e.text}`),
    subgraphs: db.subgraphs.map(s => `${s.id} : ${s.title}`).sort(),
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

  test('the generator covers every required construct', () => {
    const sources = fc.sample(sourceArb, 200).join('\n')
    const constructs: Record<string, RegExp> = {
      'flowchart header': /^flowchart (?:TB|TD|BT|RL|LR)$/m,
      'graph header': /^graph (?:TB|TD|BT|RL|LR)$/m,
      'rectangle []': /\w\[[^[(]/,
      'rounded ()': /\w\([^(]/,
      'diamond {}': /\w\{[^{]/,
      'circle (( ))': /\w\(\(/,
      'asymmetric >]': /\w>[^\]]*\]/,
      'subroutine [[ ]]': /\w\[\[/,
      'cylinder [( )]': /\w\[\(/,
      'hexagon {{ }}': /\w\{\{/,
      'quoted label': /[[({>]"/,
      'unquoted label': /\w\[[a-zA-Z]/,
      '-->': / --> /,
      '---': / --- /,
      '-.->': / -\.-> /,
      '==>': / ==> /,
      '-- text -->': / -- \w[\w ]* --> /,
      '-->|text|': / -->\|[^|]+\| /,
      'chain (two links in one statement)': /(?:-->|---|-\.->|==>|-\.-|===|--o|--x|<-->)[^\n]*(?:-->|---|-\.->|==>|-\.-|===|--o|--x|<-->)/,
      'subgraph with title': /^\s+subgraph S\d+ \[/m,
      'subgraph direction': /^\s+direction (?:TB|TD|BT|RL|LR)$/m,
      'nested subgraph': /^ {4,}subgraph /m,
    }
    const missing = Object.entries(constructs).filter(([, pattern]) => !pattern.test(sources)).map(([name]) => name)
    expect(missing).toEqual([])
  })

  test('(i)–(iv) upstream and our parser agree on every generated flowchart', async () => {
    await fc.assert(
      fc.asyncProperty(sourceArb, async source => {
        const upstreamParse = await upstream.parse(source)
        // (i) the generator only produces Mermaid 11.16 flowcharts.
        expect({ source, upstream: upstreamParse.ok ? 'accepted' : upstreamParse.error }).toEqual({ source, upstream: 'accepted' })
        if (!upstreamParse.ok) return
        // (ii) our public parser accepts it as a structured flowchart.
        const graph = parseOurs(source)
        // (iii) the same vertices, edges and subgraphs as upstream's DB, and
        // the faithfulness counter reports upstream's counts.
        const expected = theirs(upstreamParse)
        expect({ source, ...ours(graph) }).toEqual({ source, ...expected })
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
      }),
      { numRuns: 100 },
    )
  }, 20_000)

  test('each known divergence still diverges exactly as recorded', async () => {
    for (const known of Object.values(KNOWN_DIVERGENCES).flat()) {
      const upstreamParse = await upstream.parse(known.source)
      expect(upstreamParse.ok).toBe(true)
      if (!upstreamParse.ok) continue
      expect({ source: known.source, upstream: theirs(upstreamParse).vertices }).toEqual({ source: known.source, upstream: expect.arrayContaining([known.upstream]) })
      expect({ source: known.source, ours: ours(parseOurs(known.source)).vertices }).toEqual({ source: known.source, ours: expect.arrayContaining([known.ours]) })
    }
    for (const known of KNOWN_ROUND_TRIP_BUGS) {
      expect((await upstream.parse(known.source)).ok).toBe(true)
      const parsed = parseRegisteredMermaid(known.source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const serialized = serializeMermaid(parsed.value)
      expect(serialized.split('\n')).toContain(known.serializedLine)
      expect({ serialized, reparsed: parseRegisteredMermaid(serialized).ok }).toEqual({ serialized, reparsed: false })
    }
  })
})
