import { strict as assert } from 'node:assert'
import '/workspace/elk-layered-port/src/index.ts'
import { executeGraphicalRequest } from '/workspace/elk-layered-port/src/graphical-render.ts'
import { orderAlternativeInkClear } from '/workspace/elk-layered-port/src/layout/order-alternative-admission.ts'
import { measureLabelConflicts } from '/workspace/elk-layered-port/src/layout/label-conflicts.ts'
import { resolveRenderStyle } from '/workspace/elk-layered-port/src/styles.ts'
import type { PositionedGraph } from '/workspace/elk-layered-port/src/types.ts'

// Helper-boundary adverse fixture, not an emitted/certified public candidate.
// The public producer supplies real authored identities and retained text.
// Stage isolated boxes/anchors afterward to isolate occurrence attribution.
const source = 'flowchart TD\nA[One]\nB[Two]\nA -->|alpha| B\nA -->|bravo| B'
let prepared: PositionedGraph | undefined
executeGraphicalRequest(source, { graphLayout: { backend: 'elk' } }, 'svg', undefined, {}, {
  validate() {},
  consume(_request, value) { prepared = value.positioned as PositionedGraph },
})
assert(prepared)
assert.equal(prepared.edges.length, 2)
assert(prepared.edges.every(edge => edge.labelBlock && edge.labelBlock.width < 100 && edge.labelBlock.height < 50))
const style = resolveRenderStyle({})
const first: PositionedGraph = {
  ...prepared, width: 3000, height: 2000, groups: [],
  nodes: prepared.nodes.map((node, index) => ({ ...node, x: index * 2000, y: 0, width: 200, height: 100 })),
  edges: prepared.edges.map((edge, index) => ({ ...edge,
    points: [{ x: 500, y: 1000 + index * 500 }, { x: 600, y: 1000 + index * 500 }],
    labelPosition: index === 0 ? { x: 100, y: 50 } : { x: 1000, y: 600 },
  })),
}
const other: PositionedGraph = { ...first, edges: first.edges.map((edge, index) => ({ ...edge,
  labelPosition: index === 0 ? { x: 1000, y: 300 } : { x: 2100, y: 50 },
})) }
const repaired: PositionedGraph = { ...other, edges: other.edges.map((edge, index) => ({ ...edge,
  labelPosition: index === 0 ? { x: 1000, y: 300 } : { x: 1000, y: 600 },
})) }
const totals = (graph: PositionedGraph) => measureLabelConflicts(graph, style)
const perOccurrence = (graph: PositionedGraph) => graph.edges.map((_edge, index) => measureLabelConflicts(graph, style, new Set([index])).total)
// Independent expectations: only the caption centered inside one 200x100
// authored node can intersect anything. All other boxes/shafts are far apart.
for (const graph of [first, other]) assert.deepEqual(totals(graph), { total: 1, labelNode: 1, labelLabel: 0, labelEdge: 0 })
assert.deepEqual(perOccurrence(first), [1, 0])
assert.deepEqual(perOccurrence(other), [0, 1])
assert.equal(orderAlternativeInkClear(first, other, style, 1), false)
assert.equal(totals(repaired).total, 0)
assert.equal(orderAlternativeInkClear(first, repaired, style, 0), true)
console.log(JSON.stringify({ scope: 'direct guard only; staged anchors, not public adverse candidate',
  before: totals(first), after: totals(other), beforeOwners: perOccurrence(first), afterOwners: perOccurrence(other),
  tradedConflictRejected: true, genuinelyRepairedAdmitted: true,
}, null, 2))
