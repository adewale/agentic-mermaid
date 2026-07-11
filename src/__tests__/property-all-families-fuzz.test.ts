// Universal output-oracle fuzz for EVERY renderable family.
//
// property-layout-metamorphic.test.ts fuzzes the shared family registry for
// metamorphic RELATIONS (metric determinism, relabeling, count monotonicity).
// This file fuzzes the SAME registry for the STRONG OUTPUT ORACLES that say the
// rendered artifact itself is sound:
//   • finite geometry (no NaN/Infinity coords, non-negative sizes),
//   • byte-identical GEOMETRY determinism (stronger than metric determinism),
//   • well-formed SVG (matched <svg> tags, no NaN/Infinity/undefined leaked),
//   • route-contract cleanliness (auditRouteContracts == []) for the ELK-routed
//     families — the oracle that caught, and now guards, ROUTE_LABEL_ON_SHARED_TRUNK.
//
// It is driven off METAMORPHIC_FAMILIES, so a new diagram family is fuzzed the
// moment it joins that registry — no per-family wiring here. A citizenship gate
// fails if the registry drifts from the central family list, so a new family
// CANNOT ship without a fuzz generator. The seed is pinned for cross-run
// reproducibility (a gap in the rest of the property suite).

import { describe, test, expect } from 'bun:test'
import fc from 'fast-check'
import {
  parseMermaid, layoutMermaid, renderMermaidSVG, serializeMermaid,
  describeMermaidFacts,
} from '../agent/index.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { auditRouteContracts } from '../route-contracts.ts'
import { auditRenderedRoutes } from '../agent/rendered-route-audit.ts'
import { stateBodyToGraph } from '../agent/state-body.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import type { RenderedLayout, ValidDiagram } from '../agent/types.ts'
import type { MermaidGraph } from '../types.ts'

const SEED = 0x5eed1234
const tagArb = fc.integer({ min: 0, max: 1_000_000 }).map(n => `q${n.toString(36)}`)

// The graph families flow through the ELK route-contract pipeline, so a
// MermaidGraph is available and the FULL auditRouteContracts applies: flowchart
// directly, state via its graph conversion (stateBodyToGraph). Every OTHER
// family is route-audited at the rendered level (auditRenderedRoutes) instead —
// so the label-on-shared-trunk class can no longer hide in any family.
function graphFor(d: ValidDiagram): MermaidGraph | null {
  if (d.body.kind === 'flowchart') return d.body.graph
  if (d.body.kind === 'state') return stateBodyToGraph(d.body)
  return null
}

function assertFiniteGeometry(layout: RenderedLayout): void {
  expect(Number.isFinite(layout.bounds.w) && Number.isFinite(layout.bounds.h)).toBe(true)
  for (const n of layout.nodes) {
    expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.w) && Number.isFinite(n.h)).toBe(true)
    expect(n.w >= 0 && n.h >= 0).toBe(true)
  }
  for (const e of layout.edges) for (const [x, y] of e.path) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
}

function assertWellFormedSvg(svg: string): void {
  expect(svg).toContain('<svg')
  expect(svg).toContain('</svg>')
  expect(svg.includes('NaN') || svg.includes('Infinity') || svg.includes('undefined')).toBe(false)
}

function rendererSemanticProjection(layout: RenderedLayout): unknown {
  const sortJson = <T>(values: T[]): T[] => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return {
    kind: layout.kind,
    nodes: sortJson(layout.nodes.map(({ id, shape, label, role }) => ({ id, shape, label, role }))),
    edges: sortJson(layout.edges.map(({ from, to, label }) => ({ from, to, label: label?.text }))),
    groups: sortJson(layout.groups.map(({ id, members, label, parentId }) => ({ id, members: [...members].sort(), label, parentId }))),
  }
}

describe('universal fuzz: every renderable family (strong output oracles)', () => {
  // A new family in the central registry must declare a fuzz generator, or this
  // fails — which is what "new diagram types automatically get fuzzing" means:
  // the loop below picks up every registry entry, and this gate keeps the
  // registry complete.
  test('every BUILTIN family has a fuzz generator (citizenship)', () => {
    expect(Object.keys(METAMORPHIC_FAMILIES).sort()).toEqual(BUILTIN_FAMILY_METADATA.map(f => f.id).sort())
  })

  for (const fam of Object.values(METAMORPHIC_FAMILIES)) {
    const [kmin, kmax] = fam.kRange
    // Structural variation: vary the entity count across the whole valid range,
    // relabel via tag, and randomly append an add-primary / add-relation snippet.
    const srcArb = fc.record({
      k: fc.integer({ min: kmin, max: kmax }),
      tag: tagArb,
      extra: fc.constantFrom('none', 'primary', 'relation'),
    }).map(({ k, tag, extra }) => {
      let s = fam.build(k, tag)
      if (extra === 'primary' && fam.addPrimary) s += fam.addPrimary.snippet(k, tag)
      if (extra === 'relation' && fam.addRelation) s += fam.addRelation(k, tag)
      return s
    })

    test(`${fam.family}: serializer output reparses through the agent and renderer without semantic drift`, () => {
      fc.assert(
        fc.property(srcArb, src => {
          const original = parseMermaid(src)
          expect(original.ok).toBe(true)
          if (!original.ok) return
          expect(original.value.body.kind).not.toBe('opaque')

          const canonical = serializeMermaid(original.value)
          const reparsed = parseMermaid(canonical)
          expect(reparsed.ok).toBe(true)
          if (!reparsed.ok) return
          expect(reparsed.value.body.kind).toBe(original.value.body.kind)
          expect(serializeMermaid(reparsed.value)).toBe(canonical)
          expect(describeMermaidFacts(reparsed.value)).toEqual(describeMermaidFacts(original.value))

          // layoutMermaid and renderMermaidSVG invoke each family's actual
          // renderer parser/layout hook. Compare its semantic inventory rather
          // than coordinates: canonical declaration order may intentionally
          // change deterministic geometry (notably architecture), but may not
          // add/drop/retarget renderer nodes, edges, groups, labels, or roles.
          expect(rendererSemanticProjection(layoutMermaid(reparsed.value))).toEqual(
            rendererSemanticProjection(layoutMermaid(original.value)),
          )
          assertWellFormedSvg(renderMermaidSVG(canonical))
        }),
        { numRuns: 30, seed: SEED ^ 0x51a1 },
      )
    })

    test(`${fam.family}: fuzzed diagrams are finite, well-formed, deterministic, route-clean`, () => {
      fc.assert(
        fc.property(srcArb, src => {
          const p = parseMermaid(src)
          expect(p.ok).toBe(true)
          if (!p.ok) return
          const layout = layoutMermaid(p.value)
          assertFiniteGeometry(layout)
          // geometry determinism — byte-identical re-layout (stronger than MR1's metric equality)
          expect(JSON.stringify(layoutMermaid(p.value))).toBe(JSON.stringify(layout))
          assertWellFormedSvg(renderMermaidSVG(src))
          // route audit, rendered level — EVERY family (the universal
          // label-on-shared-trunk invariant)
          expect(auditRenderedRoutes(layout)).toEqual([])
          // full ELK route-contract audit for the graph families
          const graph = graphFor(p.value)
          if (graph) expect(auditRouteContracts(layoutGraphSync(graph), graph)).toEqual([])
        }),
        { numRuns: 40, seed: SEED },
      )
    })
  }
})
