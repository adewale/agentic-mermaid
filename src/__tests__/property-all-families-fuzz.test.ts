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
import { parseMermaid as parseRendererGraph } from '../parser.ts'
import { auditRouteContracts } from '../route-contracts.ts'
import { auditRenderedRoutes } from '../agent/rendered-route-audit.ts'
import { stateBodyToGraph } from '../agent/state-body.ts'
import { positionedToRenderedLayout } from '../agent/layout-to-rendered.ts'
import { layoutFamilyToRendered } from '../agent/family-layouts.ts'
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

interface SemanticInventory { nodes: string[]; edges: string[]; groups: string[] }
const sorted = (values: string[]): string[] => values.sort((a, b) => a.localeCompare(b))
const item = (id: string, label?: string): string => `${id}|${label ?? ''}`
const edge = (from: string, to: string, label?: string): string => `${from}->${to}|${label ?? ''}`
const group = (id: string, label: string | undefined, members: string[]): string => `${id}|${label ?? ''}|${[...members].sort().join(',')}`

/** Independently project the structured agent body — never via a renderer parser. */
function structuredBodyInventory(d: ValidDiagram): SemanticInventory {
  const body = d.body
  if (body.kind === 'flowchart' || body.kind === 'state') {
    const graphBody = body.kind === 'flowchart' ? body.graph : stateBodyToGraph(body)
    const groups: string[] = []
    const visit = (entries: typeof graphBody.subgraphs): void => {
      for (const sg of entries) {
        groups.push(group(sg.id, sg.label, sg.nodeIds))
        visit(sg.children)
      }
    }
    visit(graphBody.subgraphs)
    return {
      nodes: sorted([...graphBody.nodes.values()].map(node => item(node.id, node.label))),
      edges: sorted(graphBody.edges.map(e => edge(e.source, e.target, e.label))),
      groups: sorted(groups),
    }
  }
  switch (body.kind) {
    case 'sequence': return {
      nodes: sorted(body.participants.map(p => item(p.id, p.label))),
      edges: sorted(body.messages.map(m => edge(m.from, m.to, m.text))), groups: [],
    }
    case 'class': return {
      nodes: sorted(body.classes.map(c => item(c.id, c.label ?? c.id))),
      edges: sorted(body.relations.map(r => edge(r.from, r.to, r.label))),
      groups: sorted((body.namespaces ?? []).map(ns => group(ns.name, ns.label ?? ns.name, body.classes.filter(c => c.namespace === ns.name).map(c => c.id)))),
    }
    case 'er': return {
      nodes: sorted(body.entities.map(e => item(e.id, e.label ?? e.id))),
      edges: sorted(body.relations.map(r => edge(r.from, r.to, r.label))), groups: [],
    }
    case 'architecture': return {
      nodes: sorted([
        ...body.services.map(s => item(s.id, s.label)),
        ...body.junctions.map(j => item(j.id)),
      ]),
      edges: sorted(body.edges.map(e => edge(e.source.id, e.target.id, e.label))),
      groups: sorted(body.groups.map(g => group(g.id, g.label, [
        ...body.services.filter(s => s.parentId === g.id).map(s => s.id),
        ...body.junctions.filter(j => j.parentId === g.id).map(j => j.id),
      ]))),
    }
    case 'xychart': {
      const categories = body.xAxis?.categories ?? []
      return { nodes: sorted(body.series.flatMap(series => series.values.map((_v, i) => categories[i] ?? String(i)))), edges: [], groups: [] }
    }
    case 'pie': return { nodes: sorted(body.slices.map(slice => slice.label)), edges: [], groups: [] }
    case 'quadrant': return { nodes: sorted(body.points.map(point => point.label)), edges: [], groups: [] }
    case 'journey': return {
      nodes: sorted(body.sections.flatMap(section => section.tasks.map(task => item(task.id, task.text)))), edges: [],
      groups: sorted(body.sections.map(section => group(section.id, section.label, section.tasks.map(task => task.id)))),
    }
    case 'timeline': return {
      nodes: sorted(body.sections.flatMap(section => section.periods.flatMap(period => [
        item(`${period.id}:period`, period.label), ...period.events.map(event => item(event.id, event.text)),
      ]))), edges: [], groups: [],
    }
    case 'gantt': return {
      nodes: sorted(body.sections.flatMap(section => section.tasks.map(task => item(task.taskId ?? task.id, task.label)))), edges: [],
      groups: sorted(body.sections.map((section, index) => group(`section#${index}`, section.label, section.tasks.map(task => task.taskId ?? task.id)))),
    }
    case 'mindmap': {
      const nodes: string[] = [], edges: string[] = []
      const visit = (node: import('../mindmap/types.ts').MindmapNode, parent?: string): void => {
        nodes.push(item(node.id, node.label))
        if (parent) edges.push(edge(parent, node.id))
        node.children.forEach(child => visit(child, node.id))
      }
      visit(body.root)
      return { nodes: sorted(nodes), edges: sorted(edges), groups: [] }
    }
    case 'gitgraph': return {
      nodes: sorted(body.commits.map(commit => item(commit.id, commit.message ?? commit.id))),
      edges: sorted(body.commits.flatMap(commit => commit.parents.map(parent => edge(parent, commit.id)))),
      groups: sorted(body.branches.map(branch => group(`branch:${branch.name}`, branch.name, body.commits.filter(commit => commit.branch === branch.name).map(commit => commit.id)))),
    }
    case 'radar': {
      // Complete public projection: labels, marks, furniture, and ring bounds.
      const n = body.axes.length
      return {
        nodes: sorted([
          ...body.axes.map((axis, i) => item(`axis#${i}:${axis.id}`, axis.label)),
          ...body.curves.flatMap(curve => curve.values.length === n
            ? curve.values.map((_v, vertexIndex) => item(`dot:${curve.id}:${vertexIndex}`))
            : []),
          ...(body.showLegend ? body.curves.flatMap((curve, index) => [
            item(`legend-swatch#${index}`), item(`legend-label#${index}`, curve.label),
          ]) : []),
          ...(body.title === undefined ? [] : [item('title', body.title)]),
        ]),
        edges: [],
        groups: sorted(Array.from({ length: body.ticks }, (_, index) => group(`ring:${index}`, undefined, []))),
      }
    }
    default: throw new Error(`structured inventory unavailable for ${body.kind}`)
  }
}

/** Parse canonical source through the real renderer parser, then normalize its inventory. */
function rendererInventory(d: ValidDiagram, canonical: string): SemanticInventory {
  let layout: RenderedLayout
  if (d.kind === 'flowchart' || d.kind === 'state') {
    const graph = parseRendererGraph(canonical)
    layout = positionedToRenderedLayout(layoutGraphSync(graph), d.kind, {})
  } else {
    layout = layoutFamilyToRendered({ ...d, canonicalSource: canonical })!
  }
  const plainLabels = layout.kind === 'pie'
    ? layout.nodes.map(node => (node.label ?? '').replace(/ \([^)]*%\)$/, ''))
    : layout.kind === 'xychart' || layout.kind === 'quadrant'
      ? layout.nodes.map(node => node.label ?? '')
      : null
  return {
    nodes: sorted(plainLabels ?? layout.nodes.map(node => item(node.id, node.label))),
    edges: sorted(layout.edges.map(e => edge(e.from, e.to, e.label?.text))),
    groups: layout.kind === 'xychart' || layout.kind === 'quadrant'
      ? []
      : sorted(layout.groups.map(g => group(g.id, g.label, g.members))),
  }
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
  test('X1 acceptance: every built-in family has a cross-parser fuzz generator', () => {
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

          // This is the load-bearing cross-parser assertion: independently
          // project the structured agent body and compare it with canonical
          // source parsed by the actual renderer parser for that family.
          expect(rendererInventory(original.value, canonical)).toEqual(structuredBodyInventory(original.value))

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
