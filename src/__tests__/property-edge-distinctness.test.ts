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

interface Spec { direction: string; nodes: number; edges: { from: number; to: number; link: Link; label: boolean }[] }

// Small multigraphs: repeated pairs, reciprocal pairs, fan-ins with mixed
// strokes and captions. Labels are short ASCII words so text measurement is
// not what varies.
const spec: fc.Arbitrary<Spec> = fc.integer({ min: 3, max: 7 }).chain(nodes => fc.record({
  direction: fc.constantFrom('TD', 'LR', 'BT', 'RL'),
  nodes: fc.constant(nodes),
  edges: fc.array(fc.record({
    from: fc.integer({ min: 0, max: nodes - 1 }),
    to: fc.integer({ min: 0, max: nodes - 1 }),
    link: fc.constantFrom<Link>('solid', 'solid', 'dotted', 'thick'),
    label: fc.boolean(),
  }), { minLength: 2, maxLength: 10 }).map(edges => edges.filter(edge => edge.from !== edge.to)).filter(edges => edges.length >= 2),
}))

function source({ direction, nodes, edges }: Spec): string {
  const lines = [`flowchart ${direction}`]
  for (let i = 0; i < nodes; i++) lines.push(`  N${i}[Node ${i}]`)
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

test('every visible edge occurrence keeps its own readable route and arrowhead', () => {
  fc.assert(fc.property(spec, value => {
    const text = source(value)
    const graph = parseMermaid(text)
    const positioned = layoutGraphSync(graph)
    // Distinctness presupposes that every authored occurrence is present.
    expect(positioned.edges.map(edge => `${edge.source}->${edge.target}`).sort(), text).toEqual(graph.edges.map(edge => `${edge.source}->${edge.target}`).sort())
    expect(indistinct(positioned), text).toEqual([])
  }), fcParameters({ numRuns: 60 }))
})
