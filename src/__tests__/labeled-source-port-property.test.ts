// The PROPERTY a labelled source feeding a MIXED-LABEL FAN-IN must satisfy.
//
// History: this spec used to assert that EVERY single-out source — including a
// labelled source feeding a multi-input hub — exits at its side mid-port AND is
// drawn STRAIGHT (0 bends). That contract was correct only for a labelled edge
// whose target is single-input. When the target is a fan-in fed by both a
// labelled and an unlabelled edge, co-ranking (default; APL_NO_CORANK_FANIN to
// disable) now squares the sources onto one rank and centres the hub on their
// barycentre, so the spokes CONVERGE as symmetric doglegs. Under the adopted
// principle a bend that is part of a symmetric convergence is "as good as
// straight" (it is structurally necessary and buys the symmetry), so demanding
// the labelled spoke stay straight is the wrong contract — it would de-centre
// the hub. The cases in this file all have a multi-input hub (B fed by A + B2),
// so they exercise exactly the fan-in.
//
// The NEW contract for a labelled source feeding a mixed-label fan-in:
//   • the hub sits on its inputs' cross-axis barycentre (centred fan-in);
//   • the spokes are mirror-symmetric about the hub centre;
//   • the labelled source still EXITS at its side mid-PORT (the exit point is
//     the source mid-port — the edge then bends to converge, which is allowed);
//   • no HARD rubric violation is introduced.
// Each assertion breaks if the centring/co-rank regresses (verified red→green:
// these fail under APL_NO_CORANK_FANIN=1, which restores the un-centred base).
//
// A labelled source feeding a SINGLE-input target is the unchanged case:
// alignLabeledSourcePort still applies, so it stays STRAIGHT at the mid-port.
// One such case is asserted at the end as the discriminating contrast.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations } from '../layout-rubric.ts'

const TOL = 2 // px

type FanInCase = {
  name: string
  src: string
  horizontal: boolean
  hub: string
  /** The labelled source whose exit must stay on its side mid-port. */
  labeledSource: string
}

// Every case: a mixed-label fan-in into `hub` (one labelled spoke, one not).
const FAN_IN_CASES: FanInCase[] = [
  {
    name: 'narrow label, degree-1 source (minimal repro)',
    horizontal: true, hub: 'B', labeledSource: 'A',
    src: 'flowchart LR\n  A -->|x| B\n  B2 --> B\n  B --> C',
  },
  {
    name: 'wide label, degree-1 source',
    horizontal: true, hub: 'B', labeledSource: 'A',
    src: 'flowchart LR\n  A["warnings"] -->|warning| B["ok"]\n  B2["other"] --> B\n  B --> C["done"]',
  },
  {
    name: 'wide label, degree-2 source (incoming Z->A)',
    horizontal: true, hub: 'B', labeledSource: 'A',
    src: 'flowchart LR\n  Z["start"] --> A["warnings"]\n  A -->|warning| B["ok"]\n  B2["other"] --> B\n  B --> C["done"]',
  },
  {
    name: 'wide label, degree-1 source, top-down',
    horizontal: false, hub: 'B', labeledSource: 'A',
    src: 'flowchart TD\n  A["warnings"] -->|warning| B["ok"]\n  B2["other"] --> B\n  B --> C["done"]',
  },
]

function crossCenter(n: { x: number; y: number; width: number; height: number }, horizontal: boolean): number {
  return horizontal ? n.y + n.height / 2 : n.x + n.width / 2
}

function measureFanIn(c: FanInCase) {
  const graph = parseMermaid(c.src)
  const pos = layoutGraphSync(graph)
  const nm = new Map(pos.nodes.map(n => [n.id, n]))
  const hub = nm.get(c.hub)!
  const incoming = pos.edges.filter(e => e.target === c.hub)
  // hub-vs-barycentre offset
  const sources = incoming.map(e => nm.get(e.source)!)
  const bary = sources.reduce((s, n) => s + crossCenter(n, c.horizontal), 0) / sources.length
  const hubOffset = Math.abs(crossCenter(hub, c.horizontal) - bary)
  // labelled spoke: exit must be on the source's side mid-port
  const labeledEdge = incoming.find(e => e.source === c.labeledSource && e.label)!
  const src = nm.get(c.labeledSource)!
  const srcMid = crossCenter(src, c.horizontal)
  const exit = labeledEdge.points[0]!
  const exitCross = c.horizontal ? exit.y : exit.x
  const labeledExitGap = Math.abs(exitCross - srcMid)
  // mirror symmetry: the two hub ENTRY points must straddle the hub centre evenly
  const hubCross = crossCenter(hub, c.horizontal)
  const entryDevs = incoming.map(e => {
    const p = e.points[e.points.length - 1]!
    return (c.horizontal ? p.y : p.x) - hubCross
  })
  const mirrorResidual = Math.abs(entryDevs.reduce((a, b) => a + b, 0))
  const hard = hardViolations(assessLayout(graph, pos)).length
  return { hubOffset, labeledExitGap, mirrorResidual, hard, labeledEdge: `${labeledEdge.source}->${labeledEdge.target}` }
}

describe('labelled source into a mixed-label fan-in: hub centred, spokes symmetric, exit at mid-port', () => {
  for (const c of FAN_IN_CASES) {
    test(`${c.name} — hub centred + ${c.labeledSource} exits mid-port as a symmetric dogleg`, () => {
      const r = measureFanIn(c)
      // One assertion naming every failure mode, so a regression shows which broke.
      expect({
        edge: r.labeledEdge,
        hubCentred: r.hubOffset <= TOL,
        labeledExitAtMidPort: r.labeledExitGap <= TOL,
        spokesMirrorSymmetric: r.mirrorResidual <= TOL,
        noHardViolation: r.hard === 0,
      }).toEqual({
        edge: r.labeledEdge,
        hubCentred: true,
        labeledExitAtMidPort: true,
        spokesMirrorSymmetric: true,
        noHardViolation: true,
      })
    })
  }
})

// The unchanged contrast: a labelled source whose target is SINGLE-input (no
// fan-in) is still straightened onto its mid-port by alignLabeledSourcePort.
type SingleInputCase = { name: string; src: string; horizontal: boolean; source: string }
const SINGLE_INPUT_CASES: SingleInputCase[] = [
  { name: 'LR', horizontal: true, source: 'A', src: 'flowchart LR\n  A["warnings"] -->|warning| B["ok"]\n  B --> C["done"]' },
  { name: 'top-down', horizontal: false, source: 'A', src: 'flowchart TD\n  A["warnings"] -->|warning| B["ok"]\n  B --> C["done"]' },
]

describe('labelled source into a SINGLE-input target: still straight at mid-port (unchanged)', () => {
  for (const c of SINGLE_INPUT_CASES) {
    test(`${c.name} — ${c.source} exits mid-port as a straight line`, () => {
      const graph = parseMermaid(c.src)
      const pos = layoutGraphSync(graph)
      const src = pos.nodes.find(n => n.id === c.source)!
      const out = pos.edges.filter(e => e.source === c.source)
      expect(out.length).toBe(1)
      const e = out[0]!
      const exit = e.points[0]!
      const mid = crossCenter(src, c.horizontal)
      const exitGap = c.horizontal ? Math.abs(exit.y - mid) : Math.abs(exit.x - mid)
      const bends = Math.max(0, e.points.length - 2)
      expect({ edge: `${e.source}->${e.target}`, midPort: exitGap <= TOL, straight: bends === 0 }).toEqual({
        edge: `${e.source}->${e.target}`,
        midPort: true,
        straight: true,
      })
    })
  }
})
