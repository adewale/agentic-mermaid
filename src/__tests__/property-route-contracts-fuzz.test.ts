// Structural flowchart fuzz against the route-contract auditor — a STRONG
// oracle on GENERATED structure.
//
// Why this exists: the rest of the property suite fuzzes thinly. Families
// other than flowchart use templated build(k, tag) generators that mostly vary
// a node COUNT, and the largest oracle by assertion count (crash-freedom)
// only checks "does not throw". This test instead GENERATES varied flowchart
// STRUCTURE — random direction, node shapes, label widths, chains + fan-out +
// fan-in + cycles — and asserts the geometric CONTRACTS the 14 post-ELK passes
// exist to maintain, via the same auditRouteContracts() the curated
// route-contracts tests use: no unexplained diagonal bends, no mis-anchored
// endpoints, no stale-after-move routes, no label stranded on a shared trunk.
//
// It earned its keep: while being written it shrank, in ~40 generated cases, to
// a class of ROUTE_LABEL_ON_SHARED_TRUNK faults the 13 property files and the
// 258-diagram corpus all miss (a labeled edge bundling onto a sibling's trunk,
// and a mixed labeled+unlabeled duplicate pair). repairLabelsOnSharedTrunks
// (route-contracts.ts) now resolves both, so the generator fuzzes LABELED and
// DUPLICATE edges too; the two original counterexamples are pinned below as
// regression guards.
//
// The seed is pinned so any future counterexample reproduces across CI runs —
// the existing property tests leave fast-check's seed to chance.

import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { auditRouteContracts } from '../route-contracts.ts'
import { trackedExamples } from '../../eval/heuristic-tracker/catalog.ts'

const IDS = 'ABCDEFGH'.split('')
const DIRECTIONS = ['TD', 'LR', 'RL', 'BT'] as const
// Safe bracket shapes with a quoted label, so a finding is a LAYOUT fault, not
// a parse fault.
const SHAPES: Array<(l: string) => string> = [
  l => `["${l}"]`,      // rectangle
  l => `("${l}")`,      // rounded
  l => `{"${l}"}`,      // diamond
  l => `(["${l}"])`,    // stadium
  l => `[["${l}"]]`,    // subroutine
]
// Varied widths incl. a repeated "warnings"/"ok" motif, to drive the
// peer-equalization / symmetric-fanout passes into their gates.
const LABELS = ['ok', 'warnings', 'rendered', 'start', 'process the input', 'x', 'retry now']

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

const diagramArb = fc.integer({ min: 2, max: 7 }).chain(n =>
  fc.record({
    dir: fc.constantFrom(...DIRECTIONS),
    nodes: fc.array(
      fc.record({ shape: fc.nat(SHAPES.length - 1), label: fc.constantFrom(...LABELS) }),
      { minLength: n, maxLength: n },
    ),
    // node i+1 (i in 0..n-2) attaches to an earlier node in [0..i] → a connected
    // DAG with natural fan-out when a node is reused as a parent.
    parents: fc.tuple(...range(n - 1).map(i => fc.nat(i))),
    // extra edges add fan-in, cross-links, back-edges (cycles), and — with a
    // label — the labeled/duplicate cases the trunk-label fix must keep clean.
    extra: fc.array(fc.record({ from: fc.nat(n - 1), to: fc.nat(n - 1), label: fc.constantFrom('', 'yes', 'no', 'retry') }), { maxLength: 3 }),
  }),
)

type Diagram = {
  dir: typeof DIRECTIONS[number]
  nodes: Array<{ shape: number; label: string }>
  parents: number[]
  extra: Array<{ from: number; to: number; label: string }>
}

function toSource(d: Diagram): string {
  const lines = [`flowchart ${d.dir}`]
  d.nodes.forEach((node, i) => lines.push(`  ${IDS[i]}${SHAPES[node.shape]!(node.label)}`))
  d.parents.forEach((p, k) => lines.push(`  ${IDS[p]} --> ${IDS[k + 1]}`))
  for (const e of d.extra) {
    if (e.from === e.to) continue // skip self-loops (a distinct contract)
    // Labeled and duplicate edges ARE generated: a labeled extra that duplicates
    // a parent edge is the mixed-duplicate case; a labeled extra to a fan-out /
    // skip target is the bundled-trunk case. repairLabelsOnSharedTrunks must
    // bring both out route-contract clean.
    const lbl = e.label ? `|${e.label}|` : ''
    lines.push(`  ${IDS[e.from]} -->${lbl} ${IDS[e.to]}`)
  }
  return lines.join('\n')
}

describe('route-contract structural fuzz (strong oracle on generated structure)', () => {
  it('every generated flowchart is finite/contained and route-contract clean', () => {
    fc.assert(
      fc.property(diagramArb, d => {
        const src = toSource(d)
        const graph = parseMermaid(src)
        const positioned = layoutGraphSync(graph)
        expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
        expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())

        // finiteness + containment
        expect(Number.isFinite(positioned.width) && Number.isFinite(positioned.height)).toBe(true)
        for (const node of positioned.nodes) {
          expect([node.x, node.y, node.width, node.height].every(Number.isFinite)).toBe(true)
          expect(node.x).toBeGreaterThanOrEqual(0)
          expect(node.y).toBeGreaterThanOrEqual(0)
          expect(node.x + node.width).toBeLessThanOrEqual(positioned.width)
          expect(node.y + node.height).toBeLessThanOrEqual(positioned.height)
          expect(node.width).toBeGreaterThanOrEqual(0)
          expect(node.height).toBeGreaterThanOrEqual(0)
        }

        for (const edge of positioned.edges) for (const point of edge.points) {
          expect([point.x, point.y].every(Number.isFinite)).toBe(true)
          expect(point.x).toBeGreaterThanOrEqual(0)
          expect(point.y).toBeGreaterThanOrEqual(0)
          expect(point.x).toBeLessThanOrEqual(positioned.width)
          expect(point.y).toBeLessThanOrEqual(positioned.height)
        }

        // the strong oracle: routes obey the contracts the passes maintain
        const findings = auditRouteContracts(positioned, graph)
        if (findings.length > 0) {
          throw new Error(`route-contract violations on:\n${src}\n→ ${JSON.stringify(findings)}`)
        }
      }),
      fcParameters({ numRuns: 400, seed: 0x9e3779b9, includeErrorInReport: true, examples: [[{
        dir: 'TD', nodes: [{ shape: 0, label: 'ok' }, { shape: 2, label: 'warnings' }, { shape: 2, label: 'x' }, { shape: 0, label: 'ok' }, { shape: 3, label: 'process the input' }],
        parents: [0, 1, 1, 0], extra: [{ from: 4, to: 3, label: '' }],
      }], [{
        dir: 'TD', nodes: [{ shape: 0, label: 'ok' }, { shape: 1, label: 'ok' }, { shape: 2, label: 'ok' }],
        parents: [0, 0], extra: [{ from: 2, to: 1, label: 'yes' }, { from: 2, to: 1, label: 'yes' }],
      }], [{
        dir: 'TD', nodes: [{ shape: 0, label: 'ok' }, { shape: 2, label: 'ok' }, { shape: 2, label: 'process the input' }],
        parents: [0, 0], extra: [{ from: 2, to: 1, label: 'yes' }, { from: 2, to: 1, label: 'yes' }],
      }], [{
        dir: 'TD', nodes: [{ shape: 0, label: 'ok' }, { shape: 3, label: 'ok' }, { shape: 0, label: 'ok' }, { shape: 2, label: 'rendered' }],
        parents: [0, 1, 1], extra: [{ from: 1, to: 3, label: 'retry' }, { from: 0, to: 3, label: 'retry' }],
      }], [{
        dir: 'TD', nodes: [{ shape: 0, label: 'ok' }, { shape: 0, label: 'ok' }, { shape: 0, label: 'ok' }, { shape: 0, label: 'warnings' }, { shape: 0, label: 'ok' }],
        parents: [0, 0, 1, 0], extra: [{ from: 0, to: 3, label: 'no' }, { from: 0, to: 3, label: 'no' }],
      }], [{
        dir: 'TD', nodes: [{ shape: 2, label: 'rendered' }, { shape: 0, label: 'ok' }, { shape: 0, label: 'ok' }, { shape: 0, label: 'ok' }, { shape: 0, label: 'ok' }, { shape: 0, label: 'process the input' }, { shape: 2, label: 'ok' }],
        parents: [0, 1, 0, 0, 0, 0], extra: [{ from: 0, to: 6, label: 'yes' }],
      }], [{
        dir: 'TD', nodes: [{ shape: 0, label: 'ok' }, { shape: 1, label: 'warnings' }, { shape: 3, label: 'ok' }, { shape: 3, label: 'ok' }, { shape: 3, label: 'retry now' }, { shape: 2, label: 'ok' }],
        parents: [0, 0, 2, 1, 1], extra: [],
      }]] }),
    )
  }, 30000)
})

// ---------------------------------------------------------------------------
// Regression guards for ROUTE_LABEL_ON_SHARED_TRUNK. These two minimised
// counterexamples — a labeled+unlabeled duplicate pair, and a labeled skip-edge
// sharing a fan-out sibling's trunk — were the faults the fuzz above first
// surfaced. repairLabelsOnSharedTrunks now relocates the label to a clear
// segment, or (for an exactly-overlapping duplicate) offsets the labeled edge
// into its own lane. If the fix regresses, these fail with the exact diagram.
// ---------------------------------------------------------------------------
describe('regression: ROUTE_LABEL_ON_SHARED_TRUNK is repaired', () => {
  const auditCodes = (src: string): string[] => {
    const graph = parseMermaid(src)
    const positioned = layoutGraphSync(graph)
    expect(positioned.nodes.map(node => node.id).sort()).toEqual([...graph.nodes.keys()].sort())
    expect(positioned.edges.map(edge => [edge.source, edge.target, edge.label]).sort()).toEqual(graph.edges.map(edge => [edge.source, edge.target, edge.label]).sort())
    for (const edge of positioned.edges.filter(edge => edge.label)) expect(edge.labelPosition).toBeDefined()
    return auditRouteContracts(positioned, graph).map(f => f.code)
  }

  it.each(['TD', 'BT', 'LR', 'RL'])('feedback exits leave a private label segment in %s', direction => {
    const source = trackedExamples().find(example => example.group === 'contact-sheet' && example.name === 'AJ')!.source
      .replace('flowchart TD', `flowchart ${direction}`)
    const graph = parseMermaid(source)
    const positioned = layoutGraphSync(graph)
    expect(positioned.edges.map(edge => ({ source: edge.source, target: edge.target, label: edge.label })))
      .toEqual(graph.edges.map(edge => ({ source: edge.source, target: edge.target, label: edge.label })))
    expect(auditRouteContracts(positioned, graph)).toEqual([])
  })

  it('mixed labeled+unlabeled duplicate pair is separated into lanes (E→F twice)', () => {
    const src = [
      'flowchart TD',
      '  A["ok"]', '  B["ok"]', '  C["ok"]', '  D["ok"]', '  E{"rendered"}', '  F["ok"]', '  G["ok"]',
      '  A --> B', '  A --> C', '  A --> D', '  A --> E', '  E --> F', '  A --> G', '  E -->|no| F',
    ].join('\n')
    expect(auditCodes(src)).not.toContain('ROUTE_LABEL_ON_SHARED_TRUNK')
  })

  it('labeled skip-edge label is relocated off the shared trunk (A→F vs A→B)', () => {
    const src = [
      'flowchart TD',
      '  A["ok"]', '  B["ok"]', '  C["ok"]', '  D["ok"]', '  E["ok"]', '  F["ok"]', '  G["ok"]', '  H["ok"]',
      '  A --> B', '  A --> C', '  A --> D', '  A --> E', '  B --> F', '  B --> G', '  A --> H', '  A -->|yes| F',
    ].join('\n')
    expect(auditCodes(src)).not.toContain('ROUTE_LABEL_ON_SHARED_TRUNK')
  })
})
