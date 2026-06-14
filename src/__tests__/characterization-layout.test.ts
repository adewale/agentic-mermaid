// ============================================================================
// Characterisation kernel for the ASCII grid layout algorithm.
//
// This file is the *minimal load-bearing set* of property-based tests that pin
// the behaviour of the hand-written grid + A* layout (src/ascii/grid.ts,
// pathfinder.ts, edge-routing.ts, edge-bundling.ts). It is a CHARACTERISATION
// suite in Feathers' sense: it documents what the algorithm does today, so a
// refactor that changes behaviour fails loudly. It is NOT a correctness oracle.
//
// The properties are organised in three tiers (see
// docs/layout-characterization/properties.md for the full catalogue, the
// minimality argument, and the academic grounding):
//
//   Tier A — UNIVERSAL invariants. Hold for every valid flowchart/state input.
//   Tier B — STRUCTURAL properties scoped to well-behaved subclasses
//            (trees / chains). The scope boundary is itself a characterisation:
//            the layout is a best-effort heuristic that does NOT guarantee
//            these for cyclic / dense graphs (counterexamples are pinned in
//            Tier C as "known limits").
//   Tier C — METAMORPHIC / symmetry relations that pin specific design choices
//            (BT = flip(TD); RL = LR; relabel invariance) and known limits.
//
// Each property names the class of mutant it kills. A property that kills no
// unique mutant is redundant; this set is the residual after that pruning.
// ============================================================================

import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { renderMermaidASCII } from '../ascii/index.ts'
import { hasDiagonalLines } from '../ascii/validate.ts'
import { asciiToMermaid } from '../ascii/reverse.ts'

const RUNS = 100

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const DIRECTIONS = ['TD', 'LR', 'BT', 'RL'] as const
type Dir = (typeof DIRECTIONS)[number]

/** Unique, single-token, alphanumeric node ids (also used as labels). */
function ids(n: number, prefix = 'N'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`)
}

/** Arbitrary general flowchart: any edges, any direction. Exercises the full
 *  pipeline including cycles, self-loops, fan-in/out — the Tier A surface. */
const generalGraphArb = fc
  .record({
    nodeCount: fc.integer({ min: 1, max: 7 }),
    direction: fc.constantFrom<Dir>(...DIRECTIONS),
    edges: fc.array(fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 })), {
      maxLength: 10,
    }),
  })
  .map(({ nodeCount, direction, edges }) => {
    const ns = ids(nodeCount)
    const valid = edges.filter(([a, b]) => a < nodeCount && b < nodeCount)
    const src = [
      `graph ${direction}`,
      ...ns.map((id) => `${id}[${id}]`),
      ...valid.map(([a, b]) => `${ns[a]} --> ${ns[b]}`),
    ].join('\n')
    return { src, ns, direction }
  })

/** Arbitrary OUT-TREE: node i (i>=1) has exactly one parent in 0..i-1.
 *  Acyclic, connected, every edge forward — the Tier B subclass on which the
 *  structural/layering guarantees actually hold. */
function outTreeArb(direction: Dir) {
  return fc
    .record({
      nodeCount: fc.integer({ min: 2, max: 6 }),
      parents: fc.array(fc.nat(), { maxLength: 6 }),
    })
    .map(({ nodeCount, parents }) => {
      const ns = ids(nodeCount, 'T')
      const edges: Array<[string, string]> = []
      for (let i = 1; i < nodeCount; i++) {
        const p = (parents[i - 1] ?? 0) % i
        edges.push([ns[p]!, ns[i]!])
      }
      const src = [
        `graph ${direction}`,
        ...ns.map((id) => `${id}[${id}]`),
        ...edges.map(([a, b]) => `${a} --> ${b}`),
      ].join('\n')
      return { src, ns, edges }
    })
}

// ---------------------------------------------------------------------------
// Output inspection helpers (operate only on the rendered string)
// ---------------------------------------------------------------------------

/** Detect Unicode rectangles and their label text and bounding box. */
function detectBoxes(ascii: string) {
  const rows = ascii.split('\n')
  const boxes: Array<{ label: string; top: number; bottom: number; left: number; right: number }> = []
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '┌') continue
      let x1 = -1
      for (let xx = x + 1; xx < row.length; xx++) {
        const c = row[xx]
        if (c === '┐') { x1 = xx; break }
        if (c !== '─') break
      }
      if (x1 < 0) continue
      let y1 = -1
      for (let yy = y + 1; yy < rows.length; yy++) {
        const c = rows[yy]?.[x]
        if (c === '└') { y1 = yy; break }
        if (c !== '│') break
      }
      if (y1 < 0) continue
      let label = ''
      for (let yy = y + 1; yy < y1; yy++) {
        const seg = (rows[yy] ?? '').slice(x + 1, x1).replace(/[│]/g, ' ').trim()
        if (seg) label += seg
      }
      boxes.push({ label, top: y, bottom: y1, left: x, right: x1 })
    }
  }
  return boxes
}

/** Mask all alphanumerics, preserving box/line/whitespace glyphs — the layout
 *  "skeleton" independent of label identity. */
function skeleton(ascii: string): string {
  return ascii.replace(/[A-Za-z0-9]/g, '#')
}

/** Vertical flip of an ASCII-mode TD render, remapping vertical arrow glyphs,
 *  to compare against a BT render. ASCII mode keeps corners symmetric (`+`),
 *  so the flip needs no glyph remap beyond the arrowheads — unlike Unicode
 *  mode, whose flip also swaps ┌↔└ / ┬↔┴ / ▲↔▼ (canvas.ts). */
function flipVertically(ascii: string): string {
  return ascii
    .split('\n')
    .reverse()
    .join('\n')
    .replace(/[v^]/g, (c) => (c === 'v' ? '^' : 'v'))
}

const U = { colorMode: 'none', useAscii: false } as const
const A = { colorMode: 'none', useAscii: true } as const

// ===========================================================================
// TIER A — UNIVERSAL INVARIANTS (hold for every valid input)
// ===========================================================================

describe('characterisation · Tier A · universal invariants', () => {
  // P1. Totality. The layout is a total function over valid sources: it never
  // throws and never returns empty. Kills mutants that introduce unguarded
  // index access, infinite loops (the A* iteration cap / multi-pass safety
  // break), or early empty returns.
  it('P1 totality — never throws, always non-empty', () => {
    fc.assert(
      fc.property(generalGraphArb, ({ src }) => {
        const out = renderMermaidASCII(src, U)
        expect(out.length).toBeGreaterThan(0)
      }),
      { numRuns: RUNS },
    )
  })

  // P2. Determinism. render(x) is byte-identical across runs. This is the
  // keystone that makes golden/approval tests valid. Kills mutants that
  // replace the deterministic MinHeap FIFO tie-break, label-segment tie-break,
  // or stable root sort with order-dependent or random behaviour.
  it('P2 determinism — byte-identical across repeated renders', () => {
    fc.assert(
      fc.property(generalGraphArb, ({ src }) => {
        expect(renderMermaidASCII(src, U)).toBe(renderMermaidASCII(src, U))
      }),
      { numRuns: RUNS },
    )
  })

  // P3. Orthogonality. No diagonal connector glyphs: every edge is Manhattan
  // (90° bends only). This is the defining invariant of the A* router. Kills
  // mutants that add diagonal moves to A* or skip orthogonalisation.
  it('P3 orthogonality — output contains no diagonal connectors', () => {
    fc.assert(
      fc.property(generalGraphArb, ({ src }) => {
        expect(hasDiagonalLines(renderMermaidASCII(src, U))).toBe(false)
      }),
      { numRuns: RUNS },
    )
  })

  // P4. Rectangularity. The canvas is a true grid: every line has the same
  // width. Kills mutants in canvas sizing / row padding. (Labels here are
  // ASCII, so character length == display width.)
  it('P4 rectangularity — all rows share one width', () => {
    fc.assert(
      fc.property(generalGraphArb, ({ src }) => {
        const widths = new Set(renderMermaidASCII(src, U).split('\n').map((l) => l.length))
        expect(widths.size).toBe(1)
      }),
      { numRuns: RUNS },
    )
  })
})

// ===========================================================================
// TIER B — STRUCTURAL PROPERTIES on well-behaved subclasses (trees / chains)
// ===========================================================================

describe('characterisation · Tier B · structural (trees & chains)', () => {
  // P5. Node conservation (trees). Every declared node is drawn. Holds for
  // out-trees; see P10 for the cyclic counterexample where it does NOT.
  it('P5 node conservation — every tree node is rendered', () => {
    fc.assert(
      fc.property(fc.constantFrom<Dir>('TD', 'LR'), (dir) =>
        fc.assert(
          fc.property(outTreeArb(dir), ({ src, ns }) => {
            const out = renderMermaidASCII(src, U)
            for (const id of ns) expect(out).toContain(id)
          }),
          { numRuns: 40 },
        ),
      ),
      { numRuns: 1 },
    )
  })

  // P6. Box non-overlap (trees). Drawn node boxes occupy disjoint regions.
  // Holds for out-trees; the 3×3 reservation + stride-4 collision shift
  // guarantee it here. (Dense/cyclic graphs can overlap — a known limit.)
  it('P6 box non-overlap — tree node boxes are pairwise disjoint', () => {
    fc.assert(
      fc.property(outTreeArb('TD'), ({ src }) => {
        const b = detectBoxes(renderMermaidASCII(src, U))
        for (let i = 0; i < b.length; i++) {
          for (let j = i + 1; j < b.length; j++) {
            const a = b[i]!, c = b[j]!
            const overlap = a.left <= c.right && c.left <= a.right && a.top <= c.bottom && c.top <= a.bottom
            expect(overlap).toBe(false)
          }
        }
      }),
      { numRuns: RUNS },
    )
  })

  // P7. Monotone layering. For every forward edge u->v of a tree, v's box is
  // strictly downstream of u's along the flow axis (below for TD, right for
  // LR). This is the Sugiyama layer-assignment essence. Kills mutants that
  // change the childLevel stride or the flow-axis direction.
  it('P7 monotone layering (TD) — child below parent', () => {
    fc.assert(
      fc.property(outTreeArb('TD'), ({ src, edges }) => {
        const m = new Map(detectBoxes(renderMermaidASCII(src, U)).map((b) => [b.label, b]))
        for (const [u, v] of edges) {
          const su = m.get(u), sv = m.get(v)
          if (su && sv) expect(sv.top).toBeGreaterThan(su.top)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('P7 monotone layering (LR) — child right of parent', () => {
    fc.assert(
      fc.property(outTreeArb('LR'), ({ src, edges }) => {
        const m = new Map(detectBoxes(renderMermaidASCII(src, U)).map((b) => [b.label, b]))
        for (const [u, v] of edges) {
          const su = m.get(u), sv = m.get(v)
          if (su && sv) expect(sv.left).toBeGreaterThan(su.left)
        }
      }),
      { numRuns: RUNS },
    )
  })

  // P8. Structural round-trip (chains). Rendering a linear chain then parsing
  // the ASCII back with the in-repo reverse recovers the same node count and
  // edge count. Pins the documented round-trip contract (reverse.ts) and that
  // edges actually connect their endpoints. Scoped to chains, where reverse is
  // reliable. Kills mutants that drop edges or merge boxes.
  it('P8 structural round-trip — linear chains recover node/edge counts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), (n) => {
        const ns = ids(n, 'C')
        const src = ['graph LR', ...ns.map((x) => `${x}[${x}]`),
          ...ns.slice(0, -1).map((x, i) => `${x} --> ${ns[i + 1]}`)].join('\n')
        const r = asciiToMermaid(renderMermaidASCII(src, U))
        expect(r.ok).toBe(true)
        if (!r.ok) return
        const nodeLines = r.value.split('\n').filter((l) => /^ {2}N\d+\[/.test(l)).length
        const edgeLines = (r.value.match(/-->/g) ?? []).length
        expect(nodeLines).toBe(n)
        expect(edgeLines).toBe(n - 1)
      }),
      { numRuns: 30 },
    )
  })
})

// ===========================================================================
// TIER C — METAMORPHIC / SYMMETRY relations + known limits
// ===========================================================================

describe('characterisation · Tier C · metamorphic & known limits', () => {
  // P9a. BT = vertical flip of TD. The implementation literally lays out BT as
  // TD then flips; this pins that contract. Scoped to chains so the flip is
  // exact. Kills mutants in the BT flip / arrow remap.
  it('P9a BT equals vertical flip of TD (chains)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (n) => {
        const ns = ids(n, 'B')
        const decls = ns.map((x) => `${x}[${x}]`)
        const links = ns.slice(0, -1).map((x, i) => `${x} --> ${ns[i + 1]}`)
        const td = renderMermaidASCII(['graph TD', ...decls, ...links].join('\n'), A)
        const bt = renderMermaidASCII(['graph BT', ...decls, ...links].join('\n'), A)
        expect(flipVertically(td)).toBe(bt)
      }),
      { numRuns: 20 },
    )
  })

  // P9b. RL = LR. RL is not implemented and is treated as LR. This pins that
  // (current) design decision — if RL ever gets real support, this test is the
  // canary that flags the intended change.
  it('P9b RL renders identically to LR (RL treated as LR)', () => {
    fc.assert(
      fc.property(outTreeArb('LR'), ({ src }) => {
        const lr = renderMermaidASCII(src, U)
        const rl = renderMermaidASCII(src.replace('graph LR', 'graph RL'), U)
        expect(rl).toBe(lr)
      }),
      { numRuns: 40 },
    )
  })

  // P9c. Relabel invariance. Replacing every label with a same-length label
  // leaves the layout skeleton (box outlines + routing) unchanged. Placement
  // depends on label *width*, not identity. Kills mutants that let label text
  // leak into placement decisions.
  it('P9c relabel invariance — same-length labels yield same skeleton', () => {
    fc.assert(
      fc.property(generalGraphArb, ({ src }) => {
        const a = renderMermaidASCII(src, U)
        const b = renderMermaidASCII(src.replace(/N(\d)/g, 'Z$1'), U)
        expect(skeleton(b)).toBe(skeleton(a))
      }),
      { numRuns: RUNS },
    )
  })

  // P10. KNOWN LIMIT (a characterisation, not an aspiration): node conservation
  // is NOT universal. A 2-cycle can drop a node and overlap boxes. This test
  // pins the current behaviour so an *improvement* here is a deliberate, visible
  // change rather than a silent one. If this starts passing the "missing" check,
  // the layout got better — update the characterisation.
  it('P10 known limit — a 2-cycle does not conserve all nodes', () => {
    const src = 'graph TD\n  Q0[Q0]\n  Q1[Q1]\n  Q2[Q2]\n  Q0 --> Q2\n  Q2 --> Q0\n  Q1 --> Q0'
    const out = renderMermaidASCII(src, U)
    const allPresent = ['Q0', 'Q1', 'Q2'].every((id) => out.includes(id))
    // Documents today's reality: at least one node is lost / corrupted.
    expect(allPresent).toBe(false)
  })
})
