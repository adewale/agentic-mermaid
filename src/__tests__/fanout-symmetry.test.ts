// Regression: fan-out peers with differing label widths must be equalized and
// aligned (the "warnings"/"ok" symmetry).
//
// In `C -->|warnings| D["warnings"]` + `C -->|ok| E["ok"]`, D and E are genuine
// fan-out peers of C. ELK places them at different widths (97 vs 60) AND
// different main-axis positions (~32px apart, driven by that width gap), so they
// look mismatched. applySymmetricFanoutEmissions exists to equalize such peers,
// but its same-rank gate previously rejected any pair more than 28px apart —
// tighter than the very width-driven drift it was meant to absorb — so it bailed
// and the asymmetry stood. Widening that gate to 40 (still below layerSpacing,
// and AFTER the peer confirmation, so non-peers are never affected) lets the pass
// equalize them. Reverting the gate to 28 fails the assertions below.

import { describe, test, expect } from 'bun:test'
import { parseMermaid, layoutMermaid } from '../agent/index.ts'

const SYM = [
  'flowchart LR',
  '  A["warnings"] -->|warnings| B["ok"]',
  '  B -->|ok| C["rendered"]',
  '  A2["same word: warnings"] --> A',
  '  B2["same word: ok"] --> B',
  '  C -->|warnings| D["warnings"]',
  '  C -->|ok| E["ok"]',
].join('\n')

describe('fan-out peer symmetry', () => {
  test('peers with differing label widths are equalized to a common width and aligned', () => {
    const p = parseMermaid(SYM)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value)
    const D = layout.nodes.find(n => n.id === 'D')!
    const E = layout.nodes.find(n => n.id === 'E')!
    expect(D).toBeDefined()
    expect(E).toBeDefined()
    // Equal width (both widened to the wider "warnings" box) ...
    expect(D.w).toBe(E.w)
    // ... and aligned on the main (flow) axis — LR ⇒ identical x.
    expect(D.x).toBe(E.x)
  })
})
