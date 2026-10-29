import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ReviewedUpstreamAssertions {
  expectStructured?: boolean
  renderError?: string
  nodeCount?: number
  edgeCount?: number
  groupCount?: number
  minNodes?: number
  minEdges?: number
  minGroups?: number
  labelsContain?: string[]
}
export interface ReviewedUpstreamCase {
  id: string
  family: string
  source: string
  upstream: { repo: string; files: string[]; blocks: string[] }
  assertions: ReviewedUpstreamAssertions
}

/** Preserve the historical harvest bytes and apply the same reviewed public
 * reading at every consuming boundary. These reviewed corrections previously lived
 * only in the owning unit test, so new reports silently used stale assertions. */
export function reviewedUpstreamCases(root: string): ReviewedUpstreamCase[] {
  const cases = JSON.parse(readFileSync(join(root, 'eval/mermaid-upstream-suite-bench/cases.json'), 'utf8')) as ReviewedUpstreamCase[]
  for (const entry of cases) {
    // Pinned Quadrant rejects fill in the harvested recovery example. Preserve
    // its native reading and historical source without admitting a typed style.
    if (entry.id === 'quadrant-upstream-should-be-able-to-handle-constructor-as-a-classname') entry.assertions.expectStructured = false
    if (entry.id === 'flowchart-upstream-should-handle-text-in-ellipse-vertices') entry.assertions.labelsContain = ['this is an ellipse', 'B']
    if (entry.id === 'sequence-upstream-it-should-handle-par-over-statements') {
      entry.assertions.expectStructured = true
      entry.assertions.labelsContain = ['Alice', 'Bob', 'Alice note', 'Bob note', 'Message', 'Parallel overlap']
    }
  }
  return cases
}
