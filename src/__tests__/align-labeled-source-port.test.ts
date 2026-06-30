// alignLabeledSourcePort — the triggering symmetry/port defect, fixed in place.
//
// A labelled edge handed to ELK reserves a cell for its inline label dummy, and
// that cell pushes the edge's lane off the source node's mid-port: the certifying
// straightener then draws the edge straight but exits the source OFF-centre (the
// "warnings → warnings line not using the mid-point port" report that started the
// whole label-decoupling investigation). alignPortLanes would slide the node to
// fix this, but every one of its slide loops excludes labelled edges.
//
// alignLabeledSourcePort handles the one unambiguously-safe case: a source whose
// ONLY incident edge is a single labelled edge. It slides that source so its
// mid-port lines up with the target's mid-port, so the straightener draws one
// straight horizontal that is port-exact at BOTH ends — no bend. That beats
// label-decoupling, which keeps the source's original mid-port but adds a jog.
//
// This pins the fix and discriminates it from BOTH failure modes: the defect
// (exit far off mid-port) AND the decoupling alternative (mid-port but bent).

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'

// Minimal reproduction: a label on A→B + a second feeder into B + an outflow
// from B (so B is a multi-input hub whose slot the straightener anchors to).
const MIN = 'flowchart LR\n  A -->|x| B\n  B2 --> B\n  B --> C'

function abExit() {
  const p = layoutGraphSync(parseMermaid(MIN))
  const A = p.nodes.find(n => n.id === 'A')!
  const ab = p.edges.find(e => e.source === 'A' && e.target === 'B')!
  return {
    portGap: Math.abs(ab.points[0]!.y - (A.y + A.height / 2)),
    straight: Math.abs(ab.points[0]!.y - ab.points[ab.points.length - 1]!.y) < 0.5,
    bends: ab.points.length - 2,
  }
}

describe('alignLabeledSourcePort', () => {
  test('a single-edge labelled source exits at its mid-port — straight, no bend', () => {
    delete process.env.APL_DECOUPLE_LABELS
    const e = abExit()
    expect(e.portGap).toBeLessThanOrEqual(1) // exits A at its mid-port (the fix)
    expect(e.straight).toBe(true)            // …while staying straight…
    expect(e.bends).toBe(0)                  // …and adding no bend (beats decoupling's jog)
  })
})
