import { expect, test } from 'bun:test'
import { renderMermaidSVGWithReceipt, createMermaidRenderer } from '../index.ts'
import { executeGraphicalRequest } from '../graphical-render.ts'
import type { PositionedGraph, RenderOptions } from '../types.ts'
import { withPerformanceExperiments } from '../experimental-performance.ts'
import { orderAlternativeInkClear } from '../layout/order-alternative-admission.ts'
import { resolveRenderStyle } from '../styles.ts'
import { measureLabelConflicts } from '../layout/label-conflicts.ts'

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

test('balanced ordering separates duplicate and returning occurrences without spending another preference', () => {
  const source = CROSSING + '\nA --> D\nD --> A'
  const before = layout(source, { graphLayout: { backend: 'elk' } })
  const after = layout(source, { graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(before.positioned.certification?.preference.selectedScore.edgeCrossings).toBe(3)
  expect(after.positioned.certification?.preference.selectedScore.edgeCrossings).toBe(0)
  expect(after.positioned.edges.map(edge => [edge.edgeIndex, edge.source, edge.target, edge.hasArrowEnd])).toEqual([
    [0, 'A', 'D', true], [1, 'B', 'C', true], [2, 'A', 'D', true], [3, 'D', 'A', true],
  ])
  expect(new Set(after.positioned.edges.map(edge => JSON.stringify(edge.points))).size).toBe(4)
  expect(after.positioned.width).toBeLessThanOrEqual(before.positioned.width)
  expect(after.positioned.height).toBeLessThan(before.positioned.height)
  expect(after.receipt.layoutCertification?.status).toBe('passed')
  expect(after.receipt.layoutOptimization?.additionalProducerCalls).toBe(1)
  expect(after.receipt.layoutOptimization?.selected).toEqual(['prefer-model-order'])
})

test('optional ordering cannot conceal one duplicate on another occurrence or exchange their identities', () => {
  const source = CROSSING + '\nA --> D\nD --> A'
  const before = layout(source, { graphLayout: { backend: 'elk' } }).positioned
  const after = layout(source, { graphLayout: { backend: 'elk', quality: 'balanced' } }).positioned
  const style = resolveRenderStyle({})
  expect(orderAlternativeInkClear(before, after, style, 0)).toBe(true)
  const hidden = { ...after, edges: after.edges.map(edge => ({ ...edge })) }
  hidden.edges[2]!.points = hidden.edges[0]!.points
  expect(orderAlternativeInkClear(before, hidden, style, 0)).toBe(false)
  const repeatedIdentity = { ...after, edges: after.edges.map(edge => ({ ...edge })) }
  repeatedIdentity.edges[2]!.edgeIndex = repeatedIdentity.edges[0]!.edgeIndex
  expect(orderAlternativeInkClear(before, repeatedIdentity, style, 0)).toBe(false)
})

test('duplicate ordering retains the incumbent when fewer crossings require a wider canvas', () => {
  const source = CROSSING + '\nA --> D'
  const before = layout(source, { graphLayout: { backend: 'elk' } })
  const after = layout(source, { graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(after.svg).toBe(before.svg)
  expect(after.receipt.layoutOptimization?.additionalProducerCalls).toBe(1)
  expect(after.receipt.layoutOptimization?.selected).toEqual([])
})

test('order admission cannot pay for obstructing one caption by clearing another', () => {
  const prepared = layout('flowchart TD\nA[One]\nB[Two]\nA -->|alpha| B\nA -->|bravo| B', { graphLayout: { backend: 'elk' } }).positioned
  // Stage anchors around isolated boxes to test the admission owner, without
  // claiming these intentionally displaced captions are a public candidate.
  const first: PositionedGraph = { ...prepared, width: 3000, height: 2000, groups: [],
    nodes: prepared.nodes.map((node, index) => ({ ...node, x: index * 2000, y: 0, width: 200, height: 100 })),
    edges: prepared.edges.map((edge, index) => ({ ...edge,
      points: [{ x: 500, y: 1000 + index * 500 }, { x: 600, y: 1000 + index * 500 }],
      labelPosition: index === 0 ? { x: 100, y: 50 } : { x: 1000, y: 600 },
    })),
  }
  const other: PositionedGraph = { ...first, edges: first.edges.map((edge, index) => ({ ...edge,
    labelPosition: index === 0 ? { x: 1000, y: 300 } : { x: 2100, y: 50 },
  })) }
  const style = resolveRenderStyle({})
  expect(measureLabelConflicts(first, style)).toEqual({ total: 1, labelNode: 1, labelLabel: 0, labelEdge: 0 })
  expect(measureLabelConflicts(other, style)).toEqual({ total: 1, labelNode: 1, labelLabel: 0, labelEdge: 0 })
  expect(orderAlternativeInkClear(first, other, style, 1)).toBe(false)
  other.edges[1]!.labelPosition = { x: 1000, y: 600 }
  expect(measureLabelConflicts(other, style).total).toBe(0)
  expect(orderAlternativeInkClear(first, other, style, 0)).toBe(true)
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

test('a clear ELK fan avoids irrelevant ordering exploration', () => {
  const source = 'flowchart LR\nA((One)) --> T((Hub))\nB((Two)) --> T'
  const before = layout(source, { graphLayout: { backend: 'elk' } })
  const after = layout(source, { graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(after.svg).toBe(before.svg)
  expect(after.positioned.certification?.hardViolations).toBe(0)
  expect(after.positioned.edges.map(edge => [edge.source, edge.target])).toEqual([['A', 'T'], ['B', 'T']])
  expect(after.receipt.layoutOptimization?.additionalProducerCalls).toBe(0)
  expect(after.receipt.layoutOptimization?.selected).toEqual([])
})

test('port-aware exploration skips a large graph with no rubric bends to improve', () => {
  const source = 'flowchart TD\n' + Array.from({ length: 64 }, (_, index) =>
    `N${index}[Step ${index}]${index ? `\nN${Math.floor((index - 1) / 2)} --> N${index}` : ''}`).join('\n')
  const result = layout(source, { graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(result.positioned.certification?.preference.selectedScore.totalBends).toBe(0)
  expect(result.receipt.layoutOptimization?.additionalProducerCalls).toBe(0)
})

test.each([
  'flowchart TD\nQ{Decision} -->|left| L[Left]\nQ -->|middle| M[Middle]\nQ -.->|right| R[Right]',
  'flowchart LR\nSrc[Source] -->|top*| Top[Top Target]\nSrc -->|mid*| Mid[Middle Target]\nSrc -->|bot*| Bot[Bottom Target]',
])('port-aware compaction retains label centring for %s', source => {
  const before = layout(source, { graphLayout: { backend: 'elk' } })
  const after = layout(source, { graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(after.svg).toBe(before.svg)
  expect(after.receipt.layoutOptimization?.selected).toEqual([])
})

const WIDE = 'flowchart LR\nA[Very wide authentication and authorization gateway] --> C[OK]\nB[Input] --> C\nA --> D[Persist the transaction and return a response]\nC --> E[Done]\nD --> E'
test('viewport wrapping retains the primary when fitting requires more height or worse geometry', () => {
  const before = layout(WIDE, { graphLayout: { backend: 'elk' } })
  const after = layout(WIDE, { graphLayout: { backend: 'elk', viewport: { width: 800, height: 600 } } })
  const viewportScale = (graph: PositionedGraph) => Math.min(1, 800 / graph.width, 600 / graph.height)
  expect(after.svg).toBe(before.svg)
  expect(after.receipt.layoutOptimization!.additionalProducerCalls).toBeLessThanOrEqual(2)
  expect(after.positioned.nodes.map(node => [node.id, node.label])).toEqual(before.positioned.nodes.map(node => [node.id, node.label]))
  expect(after.positioned.certification?.hardViolations).toBe(0)
  const combined = layout(WIDE, { graphLayout: { backend: 'elk', quality: 'balanced', viewport: { width: 800, height: 600 } } })
  const ordered = layout(WIDE, { graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(viewportScale(combined.positioned)).toBeGreaterThanOrEqual(viewportScale(ordered.positioned))
  expect(combined.receipt.layoutOptimization!.additionalProducerCalls).toBeLessThanOrEqual(2)
})

test('explicit wrapping wins over viewport search and authored line breaks survive alternatives', () => {
  const fixed = { wrappingWidth: 140, graphLayout: { backend: 'elk' as const } }
  const before = renderMermaidSVGWithReceipt(WIDE, fixed)
  const after = renderMermaidSVGWithReceipt(WIDE, { ...fixed, graphLayout: { backend: 'elk', viewport: { width: 400, height: 300 } } })
  expect(after.svg).toBe(before.svg)
  expect(after.receipt.layoutOptimization?.additionalProducerCalls).toBe(0)
  const source = 'flowchart LR\nA["Authentication<br/>must remain on this line"] --> B["Record request tracing and audit information"]'
  const prepared = layout(source, { graphLayout: { backend: 'elk', viewport: { width: 400, height: 300 } } }).positioned.nodes.find(node => node.id === 'A')!.labelBlock!
  expect(prepared.breaks.filter(value => value.kind === 'authored')).toHaveLength(1)
  expect(prepared.prepared.lines).toHaveLength(2)
})

test('nested renders own independent optional work and restore the outer ledger', () => {
  let nested = false
  const renderer = createMermaidRenderer({ textMeasurement: { id: 'test:nested-layout', version: '1.0.0', measure: input => {
    if (!nested) {
      nested = true
      const child = withPerformanceExperiments(['text-spans'], () => renderMermaidSVGWithReceipt(CROSSING, { graphLayout: { backend: 'elk', quality: 'balanced' } }))
      expect(child.receipt.layoutOptimization?.additionalProducerCalls).toBe(1)
    }
    return input.text.length * 8
  } } })
  const result = renderer.renderMermaidSVGWithReceipt('flowchart LR; A[Hello]-->B[World]', { graphLayout: { backend: 'elk', quality: 'balanced' } })
  expect(result.receipt.layoutOptimization?.additionalProducerCalls).toBe(0)
  expect(result.receipt.layoutOptimization?.primaryProducerCalls).toBe(1)
})
