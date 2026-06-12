// BUILD-14: edges whose endpoint is a subgraph id must attach to the subgraph
// CONTAINER, not a phantom duplicate node.
//
// The TS parser auto-creates a leaf node for every edge endpoint, so an edge
// like `Start --> Pipeline` (where `Pipeline` is a subgraph) used to render a
// separate small box labelled "Pipeline" (the phantom) that the edge connected
// to, while the real container floated separately. The SVG/ELK path already
// filters this via hierarchical ports (see src/layout-engine.ts); these tests
// pin the equivalent behavior for the ASCII renderer.
//
// Assertions (per BUILD-14): exactly ONE occurrence of the container title; the
// phantom box is gone; the edge visually attaches at/inside the container border
// column/row; all internal nodes still render inside the container.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII } from '../index.ts'

/** Count non-overlapping occurrences of a substring. */
function count(haystack: string, needle: string): number {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

/** Index of the row (line) containing a substring, or -1. */
function rowOf(out: string, needle: string): number {
  return out.split('\n').findIndex(l => l.includes(needle))
}

const LR_INSIDE_TD = `flowchart TD
  Start --> Pipeline
  subgraph Pipeline
    direction LR
    Fetch --> Parse --> Transform --> Store
  end
  Pipeline --> Done
`

describe('BUILD-14: edge endpoint is a subgraph id (ASCII)', () => {
  test('TD: container title appears exactly once and the phantom box is gone', () => {
    const out = renderMermaidASCII(LR_INSIDE_TD)

    // Exactly one "Pipeline" — the container title, not a phantom node box too.
    expect(count(out, 'Pipeline')).toBe(1)

    // The internal chain still renders inside the container.
    for (const label of ['Fetch', 'Parse', 'Transform', 'Store']) {
      expect(out).toContain(label)
    }

    // The phantom would have been a standalone box whose only text is the
    // subgraph id, placed on its OWN row below Start. The container title row
    // must be the only row mentioning "Pipeline".
    const pipelineRows = out.split('\n').filter(l => l.includes('Pipeline'))
    expect(pipelineRows.length).toBe(1)
  })

  test('TD: the incoming edge attaches to the container top border (not a node)', () => {
    const out = renderMermaidASCII(LR_INSIDE_TD)
    const lines = out.split('\n')

    // The container title row and its top border row.
    const titleRow = rowOf(out, 'Pipeline')
    expect(titleRow).toBeGreaterThan(0)
    const borderRow = lines[titleRow - 1]!

    // The incoming arrowhead terminates AT the container: either embedded in
    // the top border row (clip-style) or on the row immediately above it
    // (drop-style — both honest attachments; the phantom box is what's banned).
    const arrowRow = borderRow.includes('▼') ? borderRow : lines[titleRow - 2] ?? ''
    expect(arrowRow).toContain('▼')
    // The arrow column falls within the container's horizontal span.
    const arrowCol = arrowRow.indexOf('▼')
    expect(arrowCol).toBeGreaterThanOrEqual(borderRow.indexOf('┌'))
    expect(arrowCol).toBeLessThanOrEqual(borderRow.lastIndexOf('┐'))
    // And that border row is a genuine container border (corner + horizontal).
    expect(borderRow).toContain('┌')
    expect(borderRow).toContain('┐')
  })

  test('TD: Start and Done remain outside the container in the outer TD flow', () => {
    const out = renderMermaidASCII(LR_INSIDE_TD)
    // Start is above the container; Done is below it.
    expect(rowOf(out, 'Start')).toBeLessThan(rowOf(out, 'Pipeline'))
    expect(rowOf(out, 'Done')).toBeGreaterThan(rowOf(out, 'Store'))
    // Done renders as its own node (single occurrence, not duplicated).
    expect(count(out, 'Done')).toBe(1)
  })

  test('mermaid#2509-shaped: LR outside --> subgraph attaches to the container', () => {
    const out = renderMermaidASCII(`flowchart LR
  outside --> subgraph1
  subgraph subgraph1
    inner1 --> inner2
  end
`)

    // Single container title; phantom "subgraph1" box gone.
    expect(count(out, 'subgraph1')).toBe(1)
    // Internal nodes still inside.
    expect(out).toContain('inner1')
    expect(out).toContain('inner2')
    // outside renders once, to the left of the container contents.
    expect(count(out, 'outside')).toBe(1)
    expect(rowOf(out, 'inner1')).toBe(rowOf(out, 'outside'))

    // The edge attaches at the container's left border: on the outside/inner1
    // row, a right-pointing arrowhead lands on/just outside the container's
    // left vertical border.
    const row = out.split('\n')[rowOf(out, 'inner1')]!
    expect(row).toContain('►')
    // The arrowhead must sit to the LEFT of inner1 (edge enters the container,
    // not exits it).
    expect(row.indexOf('►')).toBeLessThan(row.indexOf('inner1'))
  })

  test('sad path: id collision — subgraph id also given a standalone label', () => {
    // Mermaid resolves a `subgraph P` ahead of any standalone `P[...]` node:
    // the id refers to the container. Pin that honest behavior — the explicit
    // label is ignored and BOTH edges attach to the container, with no phantom.
    const out = renderMermaidASCII(`flowchart TD
  Start --> P
  P[Real Node] --> Done
  subgraph P
    A --> B
  end
`)

    // The container title "P" appears once; the ignored "Real Node" label
    // produces no phantom box.
    expect(out).not.toContain('Real Node')
    expect(count(out, 'Done')).toBe(1)
    // Internal nodes render inside the container.
    expect(out).toContain('A')
    expect(out).toContain('B')
    // Both Start (above) and Done (reached from inside via the container exit)
    // render as their own nodes.
    expect(rowOf(out, 'Start')).toBeLessThan(rowOf(out, 'A'))
  })
})
