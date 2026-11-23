// Every authored edge occurrence must stay individually readable in the final
// geometry. Crossing counts and hard node/endpoint checks cannot see two
// occurrences painted as one: a duplicate drawn over its twin, or one
// arrowhead standing for edges with different strokes or two captions. This
// property states that reading independently of any routing pass, so a
// bundling, port or router rewrite is held to the same public contract.

import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import type { PositionedEdge, PositionedGraph } from '../types.ts'

const LINKS = { solid: '-->', dotted: '-.->', thick: '==>' } as const
type Link = keyof typeof LINKS

const SHAPES = { rect: ['[', ']'], diamond: ['{', '}'], round: ['((', '))'] } as const
type Shape = keyof typeof SHAPES

interface Spec { direction: string; shapes: Shape[]; edges: { from: number; to: number; link: Link; label: boolean }[] }

// Small multigraphs: repeated pairs, reciprocal pairs, fan-ins with mixed
// strokes and captions, into straight-sided and single-vertex/curved hubs.
// Labels are short ASCII words so text measurement is not what varies.
const spec: fc.Arbitrary<Spec> = fc.integer({ min: 3, max: 7 }).chain(nodes => fc.record({
  direction: fc.constantFrom('TD', 'LR', 'BT', 'RL'),
  shapes: fc.array(fc.constantFrom<Shape>('rect', 'rect', 'rect', 'diamond', 'round'), { minLength: nodes, maxLength: nodes }),
  edges: fc.array(fc.record({
    from: fc.integer({ min: 0, max: nodes - 1 }),
    to: fc.integer({ min: 0, max: nodes - 1 }),
    link: fc.constantFrom<Link>('solid', 'solid', 'dotted', 'thick'),
    label: fc.boolean(),
  }), { minLength: 2, maxLength: 10 }).map(edges => edges.filter(edge => edge.from !== edge.to)).filter(edges => edges.length >= 2),
}))

function source({ direction, shapes, edges }: Spec): string {
  const lines = [`flowchart ${direction}`]
  shapes.forEach((shape, i) => lines.push(`  N${i}${SHAPES[shape][0]}Node ${i}${SHAPES[shape][1]}`))
  edges.forEach((edge, i) => lines.push(`  N${edge.from} ${LINKS[edge.link]}${edge.label ? `|e${i}|` : ''} N${edge.to}`))
  return lines.join('\n')
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 0.5
const samePath = (a: PositionedEdge, b: PositionedEdge) => a.points.length === b.points.length && a.points.every((point, i) => near(point, b.points[i]!))

/** Pairs of visible occurrences whose final geometry would read as one. */
function indistinct(positioned: PositionedGraph): string[] {
  const visible = positioned.edges.filter(edge => edge.style !== 'invisible' && edge.source !== edge.target && edge.points.length >= 2)
  const found: string[] = []
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i]!, b = visible[j]!
    const name = `${a.source}->${a.target} (${a.style}${a.label ? `, ${a.label}` : ''}) / ${b.source}->${b.target} (${b.style}${b.label ? `, ${b.label}` : ''})`
    if (a.source === b.source && a.target === b.target) {
      if (samePath(a, b)) found.push(`${name}: duplicate drawn on its twin`)
      else if (a.hasArrowEnd && b.hasArrowEnd && near(a.points.at(-1)!, b.points.at(-1)!)) found.push(`${name}: duplicates share one arrowhead`)
      continue
    }
    if (a.target !== b.target || !a.hasArrowEnd || !b.hasArrowEnd || !near(a.points.at(-1)!, b.points.at(-1)!)) continue
    // One painted arrowhead may stand for several arrivals only when it
    // cannot misstate any of them.
    if (a.style !== b.style) found.push(`${name}: one arrowhead for different strokes`)
    else if (a.label && b.label) found.push(`${name}: one arrowhead for two captions`)
  }
  return found
}

const rects = (count: number): Shape[] => Array.from({ length: count }, () => 'rect')
const edge = (from: number, to: number, link: Link, label: boolean) => ({ from, to, link, label })
// Reduced counterexamples: a port-lane slide rebuilt duplicates and mixed
// strokes onto one hub arrowhead; a co-ranked fan-in into a diamond collapsed
// two captioned spokes onto its single port.
const REDUCED: [Spec][] = [
  [{ direction: 'TD', shapes: rects(5), edges: [edge(0, 4, 'solid', false), edge(1, 4, 'solid', false), edge(1, 4, 'solid', true), edge(0, 4, 'solid', true)] }],
  ...(['TD', 'LR'] as const).map((direction): [Spec] => [{ direction, shapes: rects(4),
    edges: [edge(2, 0, 'dotted', true), edge(1, 0, 'dotted', false), edge(3, 0, 'solid', false), edge(3, 0, 'solid', true), edge(2, 0, 'dotted', false)] }]),
  [{ direction: 'TD', shapes: ['rect', 'rect', 'rect', 'diamond'], edges: [edge(0, 3, 'solid', true), edge(1, 3, 'solid', true), edge(2, 3, 'solid', false)] }],
  // One per producer that could still merge arrivals after those fixes: diamond
  // facet alignment, a port-lane slide onto a twin's port, and two flow-port
  // rebuilds that ignored who already arrived there.
  [{ direction: 'TD', shapes: ['diamond', 'rect', 'rect'], edges: [edge(0, 2, 'solid', false), edge(1, 2, 'solid', true), edge(0, 2, 'solid', false), edge(1, 2, 'solid', false)] }],
  [{ direction: 'LR', shapes: ['rect', 'round', 'round', 'rect'], edges: [edge(0, 3, 'solid', false), edge(2, 3, 'solid', false), edge(2, 3, 'solid', false)] }],
  [{ direction: 'LR', shapes: rects(3), edges: [edge(1, 0, 'solid', false), edge(1, 0, 'thick', false), edge(2, 0, 'solid', true)] }],
  [{ direction: 'TD', shapes: rects(4), edges: [edge(1, 2, 'solid', false), edge(3, 2, 'solid', false), edge(3, 2, 'solid', false), edge(0, 2, 'solid', false)] }],
  // Three duplicates across a flow gap too short for their full riser step:
  // the last riser fell back to the gap's midpoint, the lanes could not nest,
  // and the stale routes were extended to one corner of the target.
  [{ direction: 'TD', shapes: rects(5), edges: [edge(1, 4, 'solid', false), edge(2, 3, 'solid', false), edge(2, 3, 'solid', false), edge(1, 4, 'solid', false), edge(3, 4, 'solid', false), edge(2, 3, 'solid', false)] }],
]

test('every visible edge occurrence keeps its own readable route and arrowhead', () => {
  fc.assert(fc.property(spec, value => {
    const text = source(value)
    const graph = parseMermaid(text)
    const positioned = layoutGraphSync(graph)
    // Distinctness presupposes that every authored occurrence is present.
    expect(positioned.edges.map(edge => `${edge.source}->${edge.target}`).sort(), text).toEqual(graph.edges.map(edge => `${edge.source}->${edge.target}`).sort())
    expect(indistinct(positioned), text).toEqual([])
  }), fcParameters({ numRuns: 60, examples: REDUCED }))
})
