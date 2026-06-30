// The PROPERTY a labelled-source-port fix must satisfy — over the WHOLE local
// neighbourhood, not just the one edge under repair.
//
// Post-mortem #2 (why two more fixes shipped insufficient and the test missed
// it): the previous spec asserted only `exitGap` on the single A→B *source*
// port. That is too narrow in two independent ways, and each escaped:
//   • it never checked the source's OTHER incident edges, so a fix that
//     straightens A→B by sliding A — while dragging A's incoming Z→A edge off
//     *Z*'s mid-port — passed (Approach A: Z→A srcExitGap = 14.19px).
//   • it never checked BENDS, so a fix that hits the mid-port via a post-freeze
//     dog-leg passed (Approach B: A→B mid-port but bends = 2 — an unnecessary
//     hitch, since a straight 0-bend route demonstrably exists).
//
// The real invariant: in this neighbourhood every node that has exactly ONE
// edge on its exit side must leave at that side's mid-port, AND the labelled
// edge (and its incoming chain) must be drawn STRAIGHT — because a straight
// mid-port-to-mid-port routing is achievable here (translate the chain, don't
// jog). We assert mid-port + straightness for each single-out source in the
// neighbourhood, across label width × source in-degree × direction.
//
// Out of scope (deliberately): B2→B feeds the multi-input hub B, whose two
// inputs must slot apart, so that edge is legitimately off B's mid-port and is
// pre-existing — not part of the labelled-source defect.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { layoutGraphSync } from '../layout-engine.ts'

const TOL = 2 // px

type Case = {
  name: string
  src: string
  horizontal: boolean
  // single-out sources whose outgoing edge must exit at mid-port AND be straight
  straightMidSources: string[]
}

const CASES: Case[] = [
  {
    name: 'narrow label, degree-1 source (minimal repro)',
    horizontal: true,
    straightMidSources: ['A'],
    src: 'flowchart LR\n  A -->|x| B\n  B2 --> B\n  B --> C',
  },
  {
    name: 'wide label, degree-1 source',
    horizontal: true,
    straightMidSources: ['A'],
    src: 'flowchart LR\n  A["warnings"] -->|warning| B["ok"]\n  B2["other"] --> B\n  B --> C["done"]',
  },
  {
    name: 'wide label, degree-2 source (incoming Z->A)',
    horizontal: true,
    straightMidSources: ['Z', 'A'], // BOTH the incoming chain AND the labelled edge
    src: 'flowchart LR\n  Z["start"] --> A["warnings"]\n  A -->|warning| B["ok"]\n  B2["other"] --> B\n  B --> C["done"]',
  },
  {
    name: 'wide label, degree-1 source, top-down',
    horizontal: false,
    straightMidSources: ['A'],
    src: 'flowchart TD\n  A["warnings"] -->|warning| B["ok"]\n  B2["other"] --> B\n  B --> C["done"]',
  },
]

function measure(src: string, horizontal: boolean, sourceId: string) {
  const p = layoutGraphSync(parseMermaid(src))
  const S = p.nodes.find(n => n.id === sourceId)!
  const out = p.edges.filter(e => e.source === sourceId)
  expect(out.length).toBe(1) // constructed so each checked source is single-out
  const e = out[0]!
  const exit = e.points[0]!
  const midCross = horizontal ? S.y + S.height / 2 : S.x + S.width / 2
  const portGap = horizontal ? Math.abs(exit.y - midCross) : Math.abs(exit.x - midCross)
  const bends = Math.max(0, e.points.length - 2)
  return { portGap, bends, edge: `${e.source}->${e.target}` }
}

describe('labelled-source neighbourhood: single-out sources exit mid-port, straight', () => {
  for (const c of CASES) {
    for (const sid of c.straightMidSources) {
      test(`${c.name} — ${sid} exits mid-port as a straight line`, () => {
        const r = measure(c.src, c.horizontal, sid)
        // One assertion that names both failure modes, so the diff shows which broke.
        expect({ edge: r.edge, midPort: r.portGap <= TOL, straight: r.bends === 0 }).toEqual({
          edge: r.edge,
          midPort: true,
          straight: true,
        })
      })
    }
  }
})
