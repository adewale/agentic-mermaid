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
// CANNOT ship without a fuzz generator. Its per-assert seeds (SEED) pin
// cross-run reproducibility; the rest of the property suite is pinned by the
// fc-seed.preload.ts global seed.

import { beforeAll, describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { SaxesParser } from 'saxes'
import { layoutFamilyToRendered } from '../agent/family-layouts.ts'
import { describeMermaidFacts, layoutMermaid, parseRegisteredMermaid as parseMermaid, renderMermaidSVG, serializeMermaid } from '../agent/index.ts'
import { positionedToRenderedLayout } from '../agent/layout-to-rendered.ts'
import { auditRenderedRoutes } from '../agent/rendered-route-audit.ts'
import { stateBodyToGraph } from '../agent/state-body.ts'
import type { ParsedDiagram, RenderedLayout } from '../agent/types.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid as parseRendererGraph } from '../parser.ts'
import { auditRouteContracts } from '../route-contracts.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import type { MermaidGraph } from '../types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { expectWellFormedXml, svgXmlReady } from './helpers/svg-xml.ts'

beforeAll(svgXmlReady)

const erReciprocalChain = "erDiagram\n q00 ||--o{ q01 : rel\n q01 ||--o{ q02 : rel\n q02 ||--o{ q03 : rel\n q01 ||--o{ q00 : extra"

const SEED = 0x5eed1234
const tagArb = fc.integer({ min: 0, max: 1_000_000 }).map(n => `q${n.toString(36)}`)

// The graph families flow through the ELK route-contract pipeline, so a
// MermaidGraph is available and the FULL auditRouteContracts applies: flowchart
// directly, state via its graph conversion (stateBodyToGraph). Every OTHER
// family is route-audited at the rendered level (auditRenderedRoutes) instead —
// so the label-on-shared-trunk class can no longer hide in any family.
function graphFor(d: ParsedDiagram): MermaidGraph | null {
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
  expectWellFormedXml(svg, svg.slice(0, 200))
}

/** Every decoded data-id in one SVG, read by an independent XML parser. */
function svgDataIds(svg: string): string[] {
  const ids: string[] = []
  const parser = new SaxesParser()
  parser.on('opentag', tag => {
    const id = (tag.attributes as Record<string, string>)['data-id']
    if (id !== undefined) ids.push(id)
  })
  parser.write(svg).close()
  return ids
}

// Authored names that resemble the IDs families generate for relations,
// branches, parts and occurrences, beside ordinary generated tags.
const identityTagArb = fc.oneof(tagArb, fc.constantFrom('c', 'edge', 'node', 'link', 'part', 'relation', 'branch', 'field', 'group', 'label'))

/** Reduced counterexamples (V9): an authored node or commit named like a
 * generated relation/branch ID shared its data-id with that relation/branch. */
const DATA_ID_EXAMPLES: Partial<Record<string, string[]>> = {
  mindmap: ['mindmap\n  root\n    a\n    root->a'],
  gitgraph: ['gitGraph\n  commit id:"branch:main"\n  commit id:"branch:main->c1"\n  commit'],
}

interface SemanticInventory {
  nodes: string[]
  edges: string[]
  groups: string[]
}
const sorted = (values: string[]): string[] => values.sort(compareCodePointStrings)
const item = (id: string, label?: string): string => `${id}|${label ?? ''}`
const edge = (from: string, to: string, label?: string): string => `${from}->${to}|${label ?? ''}`
const group = (id: string, label: string | undefined, members: string[]): string => `${id}|${label ?? ''}|${[...members].sort().join(',')}`

/** Independently project the structured agent body — never via a renderer parser. */
function structuredBodyInventory(d: ParsedDiagram): SemanticInventory {
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
    case 'eventmodeling': {
      // Independent domain projection: first-seen namespace/band membership,
      // explicit source references, otherwise latest frame in another lane.
      const lanes = new Map<string, { id: string; members: string[] }>()
      const laneOf = (frame: typeof body.frames[number]) => {
        const parts = frame.entity.split('.'), namespace = parts.slice(0, -1).join('.')
        const band = frame.type === 'event' ? 'Events' : frame.type === 'command' || frame.type === 'readmodel' ? 'Command / Read Model' : 'UI / Automation'
        return namespace ? `${namespace} · ${band}` : band
      }
      const relations: string[] = []
      body.frames.forEach((frame, index) => {
        const name = laneOf(frame), lane = lanes.get(name) ?? { id: `lane:${lanes.size}`, members: [] }
        lane.members.push(frame.id); lanes.set(name, lane)
        const previous = body.frames.slice(0, index).reverse().find(other => laneOf(other) !== name)
        const sources = frame.sources.length ? frame.sources : !frame.reset && previous ? [previous.id] : []
        relations.push(...sources.map(from => edge(from, frame.id)))
      })
      return { nodes: sorted(body.frames.map(frame => item(frame.id, frame.entity))), edges: sorted(relations), groups: sorted([...lanes].map(([label, lane]) => group(lane.id, label, lane.members))) }
    }
    case 'packet':
      return { nodes: sorted(body.fields.flatMap(field => Array.from({ length: Math.floor(field.end / 32) - Math.floor(field.start / 32) + 1 }, (_, index) => item(`${field.id}:row-${Math.floor(field.start / 32) + index}`, field.label)))), edges: [], groups: [] }
    case 'kanban':
      return {
        nodes: sorted(body.columns.flatMap(column => column.tasks.map(task => item(task.id, task.label)))),
        edges: [],
        groups: sorted(
          body.columns.map(column =>
            group(
              column.id,
              column.label,
              column.tasks.map(task => task.id),
            ),
          ),
        ),
      }
    case 'requirement':
      return { nodes: sorted([...body.requirements.map(node => item(node.name, `<<${node.type}>>\n${node.name}`)), ...body.elements.map(node => item(node.name, `<<Element>>\n${node.name}`))]), edges: sorted(body.relations.map(relation => edge(relation.src, relation.dst, `<<${relation.type}>>`))), groups: [] }
    case 'treemap':
      return {
        nodes: sorted(body.nodes.filter(node => node.value !== undefined).map(node => item(node.id, node.label))),
        edges: [],
        groups: sorted(
          body.nodes
            .filter(node => node.value === undefined)
            .map(node =>
              group(
                node.id,
                node.label,
                body.nodes.filter(child => child.parentId === node.id).map(child => child.id),
              ),
            ),
        ),
      }
    case 'ishikawa':
      return { nodes: sorted(body.nodes.map(node => item(node.id, node.label))), edges: sorted(body.nodes.filter(node => node.parentId).map(node => edge(node.id, node.parentId!))), groups: [] }
    case 'block': {
      const nodes: string[] = [],
        groups: string[] = []
      const visit = (parent: typeof body.root): void => {
        for (const node of parent.children ?? []) {
          if (node.type === 'composite') {
            groups.push(
              group(
                node.id,
                node.label,
                (node.children ?? []).filter(child => child.type !== 'space').map(child => child.id),
              ),
            )
            visit(node)
          } else if (node.type !== 'space') nodes.push(item(node.id, node.label ?? node.id))
        }
      }
      visit(body.root)
      return { nodes: sorted(nodes), edges: sorted(body.edges.map(link => edge(link.start!, link.end!, link.label || undefined))), groups: sorted(groups) }
    }
    case 'c4':
      return {
        nodes: sorted(body.elements.map(element => item(element.id, element.label))),
        edges: sorted(
          body.relationships.map(relationship => {
            const index = relationship.index ?? (body.variant === 'C4Dynamic' ? String(relationship.order) : undefined)
            const label = [
              `${index === undefined ? '' : `${index}: `}${relationship.label}`,
              relationship.technology ? `[${relationship.technology}]` : undefined,
              relationship.description,
              relationship.tags.length ? `[tags: ${relationship.tags.join(', ')}]` : undefined,
              relationship.sprite ? `[sprite: ${relationship.sprite}]` : undefined,
            ]
              .filter(value => value !== undefined && value !== '')
              .join('\n')
            return edge(relationship.source, relationship.target, label)
          }),
        ),
        groups: sorted(
          body.boundaries.map(boundary =>
            group(
              boundary.id,
              boundary.label,
              body.elements.filter(element => element.parentId === boundary.id).map(element => element.id),
            ),
          ),
        ),
      }
    case 'zenuml':
      return {
        nodes: sorted(body.participants.map(p => item(p.id, p.label))),
        edges: sorted(body.statements.flatMap(statement => statement.kind === 'message' ? [edge(statement.from, statement.to, statement.label)] : [])),
        groups: [],
      }
    case 'sequence':
      return {
        nodes: sorted(body.participants.map(p => item(p.id, p.label))),
        edges: sorted(body.messages.map(m => edge(m.from, m.to, m.text))),
        groups: [],
      }
    case 'class':
      return {
        nodes: sorted(body.classes.map(c => item(c.id, c.label ?? c.id))),
        edges: sorted(body.relations.map(r => edge(r.from, r.to, r.label))),
        groups: sorted(
          (body.namespaces ?? []).map(ns =>
            group(
              ns.name,
              ns.label ?? ns.name,
              body.classes.filter(c => c.namespace === ns.name).map(c => c.id),
            ),
          ),
        ),
      }
    case 'er':
      return {
        nodes: sorted(body.entities.map(e => item(e.id, e.label ?? e.id))),
        edges: sorted(body.relations.map(r => edge(r.from, r.to, r.label))),
        groups: [],
      }
    case 'architecture':
      return {
        nodes: sorted([...body.services.map(s => item(s.id, s.label)), ...body.junctions.map(j => item(j.id))]),
        edges: sorted(body.edges.map(e => edge(e.source.id, e.target.id, e.label))),
        groups: sorted(body.groups.map(g => group(g.id, g.label, [...body.services.filter(s => s.parentId === g.id).map(s => s.id), ...body.junctions.filter(j => j.parentId === g.id).map(j => j.id)]))),
      }
    case 'xychart': {
      const categories = body.xAxis?.categories ?? []
      return { nodes: sorted(body.series.flatMap(series => series.values.map((_v, i) => categories[i] ?? String(i)))), edges: [], groups: [] }
    }
    case 'pie':
      return { nodes: sorted(body.slices.map(slice => slice.label)), edges: [], groups: [] }
    case 'quadrant':
      return { nodes: sorted(body.points.map(point => point.label)), edges: [], groups: [] }
    case 'journey':
      return {
        nodes: sorted(body.sections.flatMap(section => section.tasks.map(task => item(task.id, task.text)))),
        edges: [],
        groups: sorted(
          body.sections.map(section =>
            group(
              section.id,
              section.label,
              section.tasks.map(task => task.id),
            ),
          ),
        ),
      }
    case 'timeline':
      return {
        nodes: sorted(body.sections.flatMap(section => section.periods.flatMap(period => [item(`${period.id}:period`, period.label), ...period.events.map(event => item(event.id, event.text))]))),
        edges: [],
        groups: [],
      }
    case 'gantt':
      return {
        nodes: sorted(body.sections.flatMap(section => section.tasks.map(task => item(task.taskId ?? task.id, task.label)))),
        edges: [],
        groups: sorted(
          body.sections.map((section, index) =>
            group(
              `section#${index}`,
              section.label,
              section.tasks.map(task => task.taskId ?? task.id),
            ),
          ),
        ),
      }
    case 'mindmap': {
      const nodes: string[] = [],
        edges: string[] = []
      const visit = (node: import('../mindmap/types.ts').MindmapNode, parent?: string): void => {
        nodes.push(item(node.id, node.label))
        if (parent) edges.push(edge(parent, node.id))
        node.children.forEach(child => visit(child, node.id))
      }
      visit(body.root)
      return { nodes: sorted(nodes), edges: sorted(edges), groups: [] }
    }
    case 'gitgraph':
      return {
        nodes: sorted(body.commits.map(commit => item(commit.id, commit.message ?? commit.id))),
        edges: sorted(body.commits.flatMap(commit => commit.parents.map(parent => edge(parent, commit.id)))),
        groups: sorted(
          body.branches.map(branch =>
            group(
              `branch:${branch.name}`,
              branch.name,
              body.commits.filter(commit => commit.branch === branch.name).map(commit => commit.id),
            ),
          ),
        ),
      }
    case 'radar': {
      // Complete public projection: labels, marks, furniture, and ring bounds.
      const n = body.axes.length
      return {
        nodes: sorted([
          ...body.axes.map((axis, i) => item(`axis#${i}:${axis.id}`, axis.label)),
          ...body.curves.flatMap(curve => (curve.values.length === n ? curve.values.map((_v, vertexIndex) => item(`dot:${curve.id}:${vertexIndex}`)) : [])),
          ...(body.showLegend ? body.curves.flatMap((curve, index) => [item(`legend-swatch#${index}`), item(`legend-label#${index}`, curve.label)]) : []),
          ...(body.title === undefined ? [] : [item('title', body.title)]),
        ]),
        edges: [],
        groups: sorted(Array.from({ length: body.ticks }, (_, index) => group(`ring:${index}`, undefined, []))),
      }
    }
    case 'sankey': {
      // Distinct labels are the node boxes; each CSV row is one ribbon edge.
      const labels: string[] = []
      const seen = new Set<string>()
      for (const link of body.links) {
        for (const label of [link.source, link.target]) {
          if (!seen.has(label)) {
            seen.add(label)
            labels.push(label)
          }
        }
      }
      return {
        nodes: sorted(labels.map(label => item(label, label))),
        edges: sorted(body.links.map(link => edge(link.source, link.target))),
        groups: [],
      }
    }
    default:
      throw new Error(`structured inventory unavailable for ${body.kind}`)
  }
}

/** Parse canonical source through the real renderer parser, then normalize its inventory. */
function rendererInventory(d: ParsedDiagram, canonical: string): SemanticInventory {
  let layout: RenderedLayout
  if (d.kind === 'flowchart' || d.kind === 'state') {
    const graph = parseRendererGraph(canonical)
    layout = positionedToRenderedLayout(layoutGraphSync(graph), d.kind, {})
  } else {
    layout = layoutFamilyToRendered({ ...d, canonicalSource: canonical })!
  }
  const plainLabels = layout.kind === 'pie' ? layout.nodes.map(node => (node.label ?? '').replace(/ \([^)]*%\)$/, '')) : layout.kind === 'xychart' || layout.kind === 'quadrant' ? layout.nodes.map(node => node.label ?? '') : null
  return {
    nodes: sorted(plainLabels ?? layout.nodes.map(node => item(node.id, node.label))),
    edges: sorted(layout.edges.map(e => edge(e.from, e.to, e.label?.text))),
    groups: layout.kind === 'xychart' || layout.kind === 'quadrant' ? [] : sorted(layout.groups.map(g => group(g.id, g.label, g.members))),
  }
}

function rendererSemanticProjection(layout: RenderedLayout): unknown {
  const sortJson = <T>(values: T[]): T[] => values.sort((a, b) => compareCodePointStrings(JSON.stringify(a), JSON.stringify(b)))
  return {
    kind: layout.kind,
    nodes: sortJson(layout.nodes.map(({ id, shape, label, role }) => ({ id, shape, label, role }))),
    edges: sortJson(layout.edges.map(({ from, to, label }) => ({ from, to, label: label?.text }))),
    groups: sortJson(layout.groups.map(({ id, members, label, parentId }) => ({ id, members: [...members].sort(), label, parentId }))),
  }
}

describe('universal fuzz: every renderable family (strong output oracles)', () => {

  for (const fam of Object.values(METAMORPHIC_FAMILIES)) {
    const [kmin, kmax] = fam.kRange
    // Structural variation: vary the entity count across the whole valid range,
    // relabel via tag, and randomly append an add-primary / add-relation snippet.
    const srcArb = fc
      .record({
        k: fc.integer({ min: kmin, max: kmax }),
        tag: tagArb,
        extra: fc.constantFrom('none', 'primary', 'relation'),
      })
      .map(({ k, tag, extra }) => {
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
          expect(rendererSemanticProjection(layoutMermaid(reparsed.value))).toEqual(rendererSemanticProjection(layoutMermaid(original.value)))
          assertWellFormedSvg(renderMermaidSVG(canonical))
        }),
        fcParameters({ numRuns: 30, seed: SEED ^ 0x51a1, ...(fam.family === 'er' ? { examples: [[erReciprocalChain]] } : {}) }),
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
        fcParameters({ numRuns: 40, seed: SEED, ...(fam.family === 'er' ? { examples: [[erReciprocalChain]] } : {}) }),
      )
    })

    // docs/svg-semantic-contract.md: data-id is deterministic and unique
    // within one SVG, and source-authored IDs win over generated ones.
    test(`${fam.family}: every data-id is unique within one SVG`, () => {
      const identitySrcArb = fc
        .record({ k: fc.integer({ min: kmin, max: kmax }), tag: identityTagArb, extra: fc.constantFrom('none', 'primary', 'relation') })
        .map(({ k, tag, extra }) => {
          let s = fam.build(k, tag)
          if (extra === 'primary' && fam.addPrimary) s += fam.addPrimary.snippet(k, tag)
          if (extra === 'relation' && fam.addRelation) s += fam.addRelation(k, tag)
          return s
        })
      fc.assert(
        fc.property(identitySrcArb, src => {
          let svg: string
          try { svg = renderMermaidSVG(src) } catch { return }
          const ids = svgDataIds(svg)
          const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
          expect({ src, duplicates }).toEqual({ src, duplicates: [] })
        }),
        fcParameters({ numRuns: 40, seed: SEED ^ 0x1d, examples: (DATA_ID_EXAMPLES[fam.family] ?? []).map(src => [src] as [string]) }),
      )
    })
  }
})
