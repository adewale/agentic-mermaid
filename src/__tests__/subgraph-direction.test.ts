// Subgraph `direction` support (TODO.md BUILD-12).
//
// Mermaid itself ignores `direction` inside a subgraph whenever any inner
// node links outward (mermaid-js/mermaid#2509, #6438). Our ELK SEPARATE
// hierarchy handling and the ASCII grid layout both honor it; these tests
// pin that differentiator with geometry assertions so layout work cannot
// silently regress it.

import { describe, test, expect } from 'bun:test'
import { parseMermaid, layoutMermaid } from '../agent/index.ts'
import { renderMermaidASCII } from '../index.ts'

function layoutOf(source: string) {
  const r = parseMermaid(source)
  if (!r.ok) throw new Error('parse failed: ' + JSON.stringify(r.error))
  return layoutMermaid(r.value)
}

function node(layout: ReturnType<typeof layoutOf>, id: string) {
  const n = layout.nodes.find(n => n.id === id)
  if (!n) throw new Error(`node ${id} missing from layout`)
  return n
}

const LR_INSIDE_TD = `flowchart TD
  Start --> Pipeline
  subgraph Pipeline
    direction LR
    Fetch --> Parse --> Transform --> Store
  end
  Pipeline --> Done
`

describe('subgraph direction override (SVG/ELK layout geometry)', () => {
  test('direction LR inside a TD flowchart lays the inner chain out horizontally', () => {
    const layout = layoutOf(LR_INSIDE_TD)
    const chain = ['Fetch', 'Parse', 'Transform', 'Store'].map(id => node(layout, id))
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.x).toBeGreaterThan(chain[i - 1]!.x)
      // Same rank row: vertical centers stay aligned.
      expect(Math.abs(chain[i]!.y - chain[i - 1]!.y)).toBeLessThan(2)
    }
    // The outer flow stays TD.
    expect(node(layout, 'Done').y).toBeGreaterThan(node(layout, 'Start').y)
  })

  test('direction TB inside an LR flowchart survives an external link to an inner node (mermaid#2509 case)', () => {
    const layout = layoutOf(`flowchart LR
  subgraph subgraph2
    direction TB
    top2[top] --> bottom2[bottom]
  end
  outside ---> top2
`)
    const top = node(layout, 'top2')
    const bottom = node(layout, 'bottom2')
    // TB inside: bottom strictly below top, roughly same column.
    expect(bottom.y).toBeGreaterThan(top.y + top.h / 2)
    expect(Math.abs(bottom.x - top.x)).toBeLessThan(top.w)
    // Outer LR: outside sits to the left of the subgraph contents.
    expect(node(layout, 'outside').x).toBeLessThan(top.x)
  })
})

describe('subgraph direction override (ASCII grid layout)', () => {
  test('direction LR inside a TD flowchart renders the inner chain on one row', () => {
    const out = renderMermaidASCII(LR_INSIDE_TD)
    const fetchRow = out.split('\n').findIndex(l => l.includes('Fetch'))
    expect(fetchRow).toBeGreaterThanOrEqual(0)
    const row = out.split('\n')[fetchRow]!
    for (const label of ['Parse', 'Transform', 'Store']) {
      expect(row).toContain(label)
    }
    expect(row.indexOf('Fetch')).toBeLessThan(row.indexOf('Parse'))
    expect(row.indexOf('Parse')).toBeLessThan(row.indexOf('Transform'))
    expect(row.indexOf('Transform')).toBeLessThan(row.indexOf('Store'))
  })
})
