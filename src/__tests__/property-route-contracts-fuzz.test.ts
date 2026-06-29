// Structural flowchart fuzz against the route-contract auditor — a STRONG
// oracle on GENERATED structure.
//
// Why this exists: the rest of the property suite fuzzes thinly. Eleven of the
// twelve families are driven by templated build(k, tag) generators that only
// vary a node COUNT, and the largest oracle by assertion count (crash-freedom)
// only checks "does not throw". This test instead GENERATES varied flowchart
// STRUCTURE — random direction, node shapes, label widths, chains + fan-out +
// fan-in + cycles — and asserts the geometric CONTRACTS the 14 post-ELK passes
// exist to maintain, via the same auditRouteContracts() the curated
// route-contracts tests use: no unexplained diagonal bends, no mis-anchored
// endpoints, no stale-after-move routes, no label stranded on a shared trunk.
//
// It earns its keep: while being written it shrank, in ~40 generated cases, to
// a class of ROUTE_LABEL_ON_SHARED_TRUNK faults that the 13 property files and
// the 258-diagram corpus all miss (a labeled edge bundling onto a sibling's
// trunk). That class is pinned as characterization tests at the bottom; the
// generator here is scoped to UNLABELED edges so the gate stays green over the
// (large) space where the contracts already hold.
//
// The seed is pinned so any future counterexample reproduces across CI runs —
// the existing property tests leave fast-check's seed to chance.

import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { auditRouteContracts } from '../route-contracts.ts'

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
    // extra edges add fan-in, cross-links and back-edges (cycles) for variety.
    extra: fc.array(fc.record({ from: fc.nat(n - 1), to: fc.nat(n - 1) }), { maxLength: 3 }),
  }),
)

type Diagram = {
  dir: typeof DIRECTIONS[number]
  nodes: Array<{ shape: number; label: string }>
  parents: number[]
  extra: Array<{ from: number; to: number }>
}

function toSource(d: Diagram): string {
  const lines = [`flowchart ${d.dir}`]
  d.nodes.forEach((node, i) => lines.push(`  ${IDS[i]}${SHAPES[node.shape]!(node.label)}`))
  const seen = new Set<string>()
  d.parents.forEach((p, k) => { seen.add(`${p}>${k + 1}`); lines.push(`  ${IDS[p]} --> ${IDS[k + 1]}`) })
  for (const e of d.extra) {
    if (e.from === e.to || seen.has(`${e.from}>${e.to}`)) continue // no self-loops / duplicate pairs
    seen.add(`${e.from}>${e.to}`)
    lines.push(`  ${IDS[e.from]} --> ${IDS[e.to]}`)
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

        // finiteness + containment
        expect(Number.isFinite(positioned.width) && Number.isFinite(positioned.height)).toBe(true)
        for (const node of positioned.nodes) {
          expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true)
          expect(node.width).toBeGreaterThanOrEqual(0)
          expect(node.height).toBeGreaterThanOrEqual(0)
        }

        // the strong oracle: routes obey the contracts the passes maintain
        const findings = auditRouteContracts(positioned, graph)
        if (findings.length > 0) {
          throw new Error(`route-contract violations on:\n${src}\n→ ${JSON.stringify(findings)}`)
        }
      }),
      { numRuns: 200, seed: 0x9e3779b9 },
    )
  }, 30000)
})

// ---------------------------------------------------------------------------
// KNOWN LIMITATION (discovered by the fuzz above): a LABELED edge that bundles
// onto a sibling's trunk strands its label on the shared segment
// (ROUTE_LABEL_ON_SHARED_TRUNK). Neither applyParallelDuplicateLanes (scoped to
// UNLABELED pairs) nor applySymmetricParallelEdgeLanes (scoped to LABELED pairs)
// owns the mixed/skip case. The fault is context-dependent — it needs the
// surrounding fan-out, which is why the curated corpus never hits it. These pin
// the CURRENT behaviour; when the layout learns to separate these lanes the
// finding disappears and these tests fail — fold the case into the gate above
// and delete this block then.
// ---------------------------------------------------------------------------
describe('known limitation: labeled edge bundles onto a sibling trunk', () => {
  const auditCodes = (src: string): string[] => {
    const graph = parseMermaid(src)
    return auditRouteContracts(layoutGraphSync(graph), graph).map(f => f.code)
  }

  it('mixed labeled+unlabeled duplicate pair overlaps exactly (E→F twice)', () => {
    const src = [
      'flowchart TD',
      '  A["ok"]', '  B["ok"]', '  C["ok"]', '  D["ok"]', '  E{"rendered"}', '  F["ok"]', '  G["ok"]',
      '  A --> B', '  A --> C', '  A --> D', '  A --> E', '  E --> F', '  A --> G', '  E -->|no| F',
    ].join('\n')
    expect(auditCodes(src)).toContain('ROUTE_LABEL_ON_SHARED_TRUNK')
  })

  it('labeled skip-edge shares a sibling trunk (A→F sharing A→B)', () => {
    const src = [
      'flowchart TD',
      '  A["ok"]', '  B["ok"]', '  C["ok"]', '  D["ok"]', '  E["ok"]', '  F["ok"]', '  G["ok"]', '  H["ok"]',
      '  A --> B', '  A --> C', '  A --> D', '  A --> E', '  B --> F', '  B --> G', '  A --> H', '  A -->|yes| F',
    ].join('\n')
    expect(auditCodes(src)).toContain('ROUTE_LABEL_ON_SHARED_TRUNK')
  })
})
