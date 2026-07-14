// ============================================================================
// countStructuralElements — a family-agnostic faithfulness oracle.
//
// "100% parse success is not faithfulness" (lessons-learned, Loop 17): a parser
// can accept a source and the serializer can round-trip byte-stably while a
// relationship is silently dropped (the ER `}o` bug shipped inside a fully
// gated corpus for exactly this reason). Byte-stability proves serialize∘parse
// is idempotent; it does NOT prove parse preserved the source's content.
//
// This counter projects every renderable family onto a small {nodes, edges,
// groups} tally drawn from the structured IR. Comparing the count of a source
// against the count of its re-parsed serialization turns "did we drop a node or
// edge on round-trip?" into a deterministic assertion across every registered
// family — without a golden image and without a human. It backs both the
// corpus count-oracle (eval) and the CONTENT_DROPPED_ON_ROUNDTRIP verify lint.
//
// Opaque bodies have no structured arrays to count, so they return null and the
// caller skips them (their faithfulness contract is byte-verbatim preservation,
// which the round-trip-stability gate already covers).
// ============================================================================

import type { ValidDiagram, StateNode, LayoutWarning } from './types.ts'
import type { MermaidSubgraph } from '../types.ts'
import { sequenceMessages } from './sequence-body.ts'

export interface StructuralCount {
  /** Primary entities: nodes, participants, states, classes, entities, slices… */
  nodes: number
  /** Relations: edges, messages, transitions, relations. 0 for relationless families. */
  edges: number
  /** Containers: subgraphs, sections, groups. 0 when the family has none. */
  groups: number
}

function countStates(states: StateNode[]): { nodes: number; edges: number } {
  let nodes = 0, edges = 0
  for (const s of states) {
    nodes++
    if (s.regions) {
      for (const region of s.regions) {
        const inner = countStates(region.states)
        nodes += inner.nodes
        edges += inner.edges + region.transitions.length
      }
    } else {
      if (s.states && s.states.length) {
        const inner = countStates(s.states)
        nodes += inner.nodes
        edges += inner.edges
      }
      if (s.transitions) edges += s.transitions.length
    }
  }
  return { nodes, edges }
}

function countSubgraphs(subgraphs: MermaidSubgraph[]): number {
  let groups = 0
  for (const sg of subgraphs) {
    groups++
    groups += countSubgraphs(sg.children)
  }
  return groups
}

/**
 * Count the structured elements of a diagram, or null for opaque bodies (which
 * carry no structured arrays — their faithfulness is byte-verbatim, covered by
 * the round-trip gate).
 */
export function countStructuralElements(d: ValidDiagram): StructuralCount | null {
  const body = d.body
  switch (body.kind) {
    case 'flowchart': {
      const g = body.graph
      return { nodes: g.nodes.size, edges: g.edges.length, groups: countSubgraphs(g.subgraphs) }
    }
    case 'sequence':
      return { nodes: body.participants.length, edges: sequenceMessages(body).length, groups: 0 }
    case 'state': {
      const top = countStates(body.states)
      return { nodes: top.nodes, edges: top.edges + body.transitions.length, groups: 0 }
    }
    case 'class':
      // Namespaces are the class family's containers (repo #118).
      return { nodes: body.classes.length, edges: body.relations.length, groups: (body.namespaces ?? []).length }
    case 'er':
      return { nodes: body.entities.length, edges: body.relations.length, groups: (body.groups ?? []).length }
    case 'timeline': {
      let nodes = 0
      for (const sec of body.sections) for (const p of sec.periods) nodes += 1 + p.events.length
      return { nodes, edges: 0, groups: body.sections.length }
    }
    case 'journey': {
      let nodes = 0
      for (const sec of body.sections) nodes += sec.tasks.length
      return { nodes, edges: 0, groups: body.sections.length }
    }
    case 'architecture':
      return {
        nodes: body.services.length + body.junctions.length,
        edges: body.edges.length,
        groups: body.groups.length,
      }
    case 'xychart':
      return { nodes: body.series.length, edges: 0, groups: 0 }
    case 'pie':
      return { nodes: body.slices.length, edges: 0, groups: 0 }
    case 'quadrant':
      return { nodes: body.points.length, edges: 0, groups: 0 }
    case 'gantt': {
      let nodes = 0
      for (const sec of body.sections) nodes += sec.tasks.length
      return { nodes, edges: 0, groups: body.sections.length }
    }
    case 'mindmap': {
      let nodes = 0, edges = 0
      const visit = (node: import('../mindmap/types.ts').MindmapNode): void => {
        nodes++
        edges += node.children.length
        node.children.forEach(visit)
      }
      visit(body.root)
      return { nodes, edges, groups: 0 }
    }
    case 'gitgraph':
      return {
        nodes: body.commits.length,
        edges: body.commits.reduce((sum, commit) => sum + commit.parents.length, 0),
        groups: body.branches.length,
      }
    case 'radar':
      // Vertices (curves × axes) are the marks; axes are the reference groups.
      return { nodes: body.curves.reduce((sum, c) => sum + c.values.length, 0), edges: 0, groups: body.axes.length }
    case 'opaque':
      return null
    default: {
      // Exhaustiveness guard: a new family must declare its count here.
      const _never: never = body
      void _never
      return null
    }
  }
}

export function countsEqual(a: StructuralCount, b: StructuralCount): boolean {
  return a.nodes === b.nodes && a.edges === b.edges && a.groups === b.groups
}

/**
 * Pure faithfulness verdict over the before/after counts of a round-trip
 * (Move 3): the decision logic of the CONTENT_DROPPED_ON_ROUNDTRIP verify lint,
 * separated from the parse/serialize I/O so it lives in the mutation-gated
 * counter module and is directly unit-testable with constructed counts.
 *
 *   before = null  → opaque body, nothing to check (no warning).
 *   after  = null  → the serialization did not re-parse: total loss.
 *   counts differ  → a node/edge/group was dropped or duplicated.
 *   counts equal    → faithful (no warning).
 */
export function faithfulnessWarning(
  before: StructuralCount | null,
  after: StructuralCount | null,
): LayoutWarning[] {
  if (!before) return []
  if (!after) return [{ code: 'CONTENT_DROPPED_ON_ROUNDTRIP', before, after: { nodes: 0, edges: 0, groups: 0 } }]
  if (!countsEqual(before, after)) return [{ code: 'CONTENT_DROPPED_ON_ROUNDTRIP', before, after }]
  return []
}

/**
 * Boolean view of {@link faithfulnessWarning} for the differential gates
 * (corpus / seqbench / upstream), which only need "did content drop?" — reads
 * better than `faithfulnessWarning(...).length > 0` at the call sites and is
 * independently testable.
 */
export function isDrop(before: StructuralCount | null, after: StructuralCount | null): boolean {
  return faithfulnessWarning(before, after).length > 0
}
