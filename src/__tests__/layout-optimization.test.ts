import { expect, test } from 'bun:test'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { executeGraphicalRequest } from '../graphical-render.ts'
import type { PositionedGraph, RenderOptions } from '../types.ts'

const CROSSING = 'flowchart TD\nA[One]\nB[Two]\nC[Three]\nD[Four]\nA --> D\nB --> C'
function layout(source: string, options: RenderOptions) {
  let positioned: PositionedGraph | undefined
  const result = executeGraphicalRequest(source, options, 'svg', undefined, {}, { validate() {}, consume(_request, value) { positioned = value.positioned as PositionedGraph } })
  return { ...result, positioned: positioned! }
}

test('an optional ELK order candidate removes a crossing while preserving authored identities', () => {
  const before = layout(CROSSING, { graphLayout: { backend: 'elk' } })
  const after = layout(CROSSING, { graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(before.positioned.certification?.preference.selectedScore.edgeCrossings).toBe(1)
  expect(after.positioned.certification?.preference.selectedScore.edgeCrossings).toBe(0)
  expect(after.positioned.nodes.map(node => node.id).sort()).toEqual(['A', 'B', 'C', 'D'])
  expect(after.positioned.edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'D'], ['B', 'C']])
  expect(after.receipt.layoutOptimization?.additionalProducerCalls).toBe(1)
  expect(after.receipt.layoutOptimization?.selected).toEqual(['prefer-model-order'])
})

test('explicit adjacency remains authoritative and an already clear diagram avoids extra ELK work', () => {
  const fixed = { graphLayout: { backend: 'elk' as const }, layoutHints: { adjacent: [['A', 'B', 'C', 'D']] } }
  const before = renderMermaidSVGWithReceipt(CROSSING, fixed)
  const after = renderMermaidSVGWithReceipt(CROSSING, { ...fixed, graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(after.svg).toBe(before.svg)
  expect(after.receipt.layoutOptimization?.additionalProducerCalls).toBe(0)
  const clear = renderMermaidSVGWithReceipt('flowchart LR; A-->B', { graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(clear.receipt.layoutOptimization?.additionalProducerCalls).toBe(0)
})
