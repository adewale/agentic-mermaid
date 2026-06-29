// Label-decoupling (opt-in via APL_DECOUPLE_LABELS) — validated, not yet default.
//
// An edge label handed to ELK is sized as a layout element, so ELK reserves a
// cell for it and DISPLACES the target node off the edge's port lane: adding a
// label to `A -->|x| B` shifts B so A→B leaves A off its mid-port — the sym
// diagram's A→B defect, and one symptom of a pervasive entanglement (a single
// label moves nodes in ~99% of fuzzed flowcharts). Decoupling omits labels from
// ELK (nodes lay out label-free) and lets the existing post-ELK passes place and
// fit the label, so the port survives. Measured: fixes the port on the minimal
// repro AND the sym diagram, zero readability cost on the corpus, deterministic.
//
// It is OFF by default because it currently trades a route-contract regression
// on bent DUPLICATE labels (a labelled edge drawn twice, whose labelled copy
// gets a multi-bend path the shared-trunk repair's offset-fallback doesn't yet
// cover — 5/300 fuzzed flowcharts). This test pins both the defect (default) and
// the fix (flag), so making it the default later is a guarded one-line change.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'

// Minimal reproduction: a label on A→B + a second feeder into B + an outflow
// from B. Remove any one and A→B is already mid-port.
const MIN = 'flowchart LR\n  A -->|x| B\n  B2 --> B\n  B --> C'

function abPortGap(): number {
  const p = layoutGraphSync(parseMermaid(MIN))
  const A = p.nodes.find(n => n.id === 'A')!
  const ab = p.edges.find(e => e.source === 'A' && e.target === 'B')!
  return Math.abs(Math.round(ab.points[0]!.y) - Math.round(A.y + A.height / 2))
}

describe('label decoupling (APL_DECOUPLE_LABELS)', () => {
  test('default (ELK reserves the label cell): the labelled edge is displaced off its mid-port', () => {
    delete process.env.APL_DECOUPLE_LABELS
    expect(abPortGap()).toBeGreaterThan(1) // off-port — the defect
  })

  test('with decoupling enabled: the labelled edge keeps its mid-port', () => {
    process.env.APL_DECOUPLE_LABELS = '1'
    try {
      expect(abPortGap()).toBeLessThanOrEqual(1) // mid-port — the fix
    } finally {
      delete process.env.APL_DECOUPLE_LABELS
    }
  })
})
