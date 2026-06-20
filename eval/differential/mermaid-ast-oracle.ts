// Differential oracle (Move 2): count structural elements via mermaid-ast — an
// INDEPENDENT Mermaid parser (a separate implementation, not our code) — so the
// faithfulness counter can be cross-checked against an external authority rather
// than only against itself. This is the differential-testing answer to the
// closed-loop / oracle-problem ceiling (McKeeman 1998; Barr et al. 2015): a
// second implementation is an oracle our own gates can never be.
//
// Supported here: the families mermaid-ast and we BOTH model structurally with a
// comparable node/edge notion — flowchart, sequence, class, er. Others return
// null (no cross-check claimed).

import * as MA from 'mermaid-ast'
import type { StructuralCount } from '../../src/agent/structural-count.ts'

const uniq = (xs: Array<string | undefined>): number =>
  new Set(xs.filter((x): x is string => typeof x === 'string' && x.length > 0)).size

// mermaid-ast models declared nodes/actors/classes/entities as Maps; read keys
// via the Map API (Object.keys on a Map is always empty).
const keysOf = (m: unknown): string[] =>
  m instanceof Map ? [...m.keys()] : (m && typeof m === 'object' ? Object.keys(m as object) : [])

/** Returns the independent count, or null if mermaid-ast doesn't model the family. */
export function countViaMermaidAst(source: string): StructuralCount | null {
  let kind: string | null
  try { kind = MA.detectDiagramType(source) } catch { return null }
  try {
    switch (kind) {
      case 'flowchart': {
        const a = MA.parseFlowchart(source) as unknown as {
          nodes: unknown
          links: Array<{ source: string; target: string }>
          subgraphs: Array<{ nodes: string[] }>
        }
        const ids = [
          ...keysOf(a.nodes),
          ...a.links.flatMap(l => [l.source, l.target]),
          ...a.subgraphs.flatMap(s => s.nodes),
        ]
        return { nodes: uniq(ids), edges: a.links.length, groups: a.subgraphs.length }
      }
      case 'sequence': {
        const a = MA.parseSequence(source) as unknown as {
          actors: unknown
          statements: Array<{ type: string; from?: string; to?: string }>
        }
        const messages = a.statements.filter(s => s.type === 'message')
        const ids = [...keysOf(a.actors), ...messages.flatMap(m => [m.from, m.to])]
        return { nodes: uniq(ids), edges: messages.length, groups: 0 }
      }
      case 'classDiagram': {
        const a = MA.parseClassDiagram(source) as unknown as {
          classes: unknown
          relations: Array<{ id1: string; id2: string }>
        }
        const ids = [...keysOf(a.classes), ...a.relations.flatMap(r => [r.id1, r.id2])]
        return { nodes: uniq(ids), edges: a.relations.length, groups: 0 }
      }
      case 'erDiagram': {
        const a = MA.parseErDiagram(source) as unknown as {
          entities: unknown
          relationships: Array<{ entityA: string; entityB: string }>
        }
        const ids = [...keysOf(a.entities), ...a.relationships.flatMap(r => [r.entityA, r.entityB])]
        return { nodes: uniq(ids), edges: a.relationships.length, groups: 0 }
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

/** Families this oracle cross-checks. */
export const MERMAID_AST_FAMILIES = ['flowchart', 'sequence', 'class', 'er'] as const
