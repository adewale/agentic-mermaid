// Label-decoupling (opt-in via APL_DECOUPLE_LABELS) — an alternative mechanism.
//
// An edge label handed to ELK is sized as a layout element, so ELK reserves a
// cell for it and can DISPLACE the target node off the edge's port lane: a label
// moves a node in ~99% of fuzzed flowcharts. Decoupling omits labels from ELK
// (nodes lay out label-free) and lets the post-ELK passes place the label, so the
// port survives. It is OFF by default — measured net-regressive on the corpus
// (6↑/23↓, incl. +2 crossings; see docs/design/system/layout-guarantees-and-
// robustness.md), because removing the reserved label space repacks nodes in ways
// the rubric penalises.
//
// The CANONICAL port-displacement defect (the minimal repro below — the
// "warnings → warnings line not using the mid-point port" report) is now fixed in
// the DEFAULT path without decoupling. NOTE: this repro is a mixed-label fan-in
// (A->B labelled, B2->B not), so on the default path the co-rank centring squares
// the hub and A->B converges as a symmetric dogleg whose EXIT is still A's
// mid-port (alignLabeledSourcePort yields to the convergence here — it only
// straightens a labelled source into a SINGLE-input target; see
// labeled-source-port-property.test.ts). Either way A leaves at its mid-port, so
// this file keeps the decoupling flag pinned as a regression guard that the
// mid-port exit is preserved (it must not re-break the port it already preserved).

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
  test('default path: the labelled edge keeps its mid-port (symmetric fan-in dogleg)', () => {
    delete process.env.APL_DECOUPLE_LABELS
    expect(abPortGap()).toBeLessThanOrEqual(1) // mid-port exit — co-rank centres the hub, no decoupling
  })

  test('with decoupling enabled: the labelled edge still keeps its mid-port', () => {
    process.env.APL_DECOUPLE_LABELS = '1'
    try {
      expect(abPortGap()).toBeLessThanOrEqual(1) // mid-port — the decoupling mechanism
    } finally {
      delete process.env.APL_DECOUPLE_LABELS
    }
  })
})
