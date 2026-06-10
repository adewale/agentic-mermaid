// Box-start connector placement (upstream lukilabs#112 class).
//
// The junction character (├ ┤ ┬ ┴) where an edge leaves a node must sit on
// the node's actual border. The first path point is a grid-cell center, which
// drifts away from the border when a sibling edge's label widens the column —
// the old code drew the connector there, floating in whitespace.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII } from '../index.ts'

describe('ASCII box-start connector sits on the node border', () => {
  test('LR fan-out with labels: connector flush on the source box (upstream #112 repro)', () => {
    const out = renderMermaidASCII(`flowchart LR
  Src["Source"]
  Top["Top Target"]
  Mid["Middle Target"]
  Bot["Bottom Target"]
  Src -->|top*| Top
  Src -->|mid*| Mid
  Src -->|bot*| Bot`)
    // Connector replaces the border character and the edge is continuous.
    expect(out).toMatch(/Source ├─+top\*/)
    // No floating junction: a ├ preceded by border-plus-whitespace.
    expect(out).not.toMatch(/│ +├/)
  })

  test('diamond fan-out with labels: connector flush on the decision shape (mermaid docs example)', () => {
    const out = renderMermaidASCII(`flowchart LR
    A[Hard edge] -->|Link text| B(Round edge)
    B --> C{Decision}
    C -->|One| D[Result one]
    C -->|Two| E[Result two]`)
    expect(out).toMatch(/Decision ├─+One/)
    expect(out).not.toMatch(/│ +├/)
  })

  test('unlabeled fan-out stays flush (no regression on the easy case)', () => {
    const out = renderMermaidASCII('flowchart LR\n  A --> B\n  A --> C')
    expect(out).not.toMatch(/│ +├/)
  })
})
