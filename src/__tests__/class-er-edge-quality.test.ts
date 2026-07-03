// Class & ER edge-quality guardrail (issue #26 WS7 boundary).
//
// The issue-#26 audit corrected a false spec claim that class/ER diagrams
// inherit the flowchart route-contract pass — they don't; they render through
// their own ELK ORTHOGONAL engines (src/class/layout.ts, src/er/layout.ts call
// elkLayoutSync directly). That is a DELIBERATE boundary, not a defect: this
// suite is the evidence. It measures the very metrics the route-contract
// straightener exists to fix (diagonal segments, duplicate/collinear points)
// and asserts ELK ORTHOGONAL already drives them to zero for the
// relationship-edge model — so the straightener would be a no-op here.
//
// If a future change ever makes one of these fail on a realistic diagram,
// THAT is the signal that class/ER route-contract adoption (WS7) has become
// worth its risk. Until then, this guard keeps their edge quality from
// silently regressing.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { verifyMermaid } from '../agent/index.ts'

const prep = (t: string) => t.split('\n').map(l => l.trim()).filter(l => l.length > 0)

interface Pt { x: number; y: number }

/** The two defects the route-contract simplifier/orthogonalizer remove. */
function edgeDefects(points: Pt[][]): { diagonals: number; duplicates: number; shortRoutes: number } {
  let diagonals = 0
  let duplicates = 0
  let shortRoutes = 0
  for (const p of points) {
    if (p.length < 2) { shortRoutes++; continue }
    for (let i = 1; i < p.length; i++) {
      const dx = Math.abs(p[i]!.x - p[i - 1]!.x)
      const dy = Math.abs(p[i]!.y - p[i - 1]!.y)
      if (dx > 0.5 && dy > 0.5) diagonals++   // a non-orthogonal segment
      if (dx < 0.5 && dy < 0.5) duplicates++  // a coincident/duplicate point
    }
  }
  return { diagonals, duplicates, shortRoutes }
}

const CLASS_DIAGRAMS: Array<[string, string]> = [
  ['inheritance + association', `classDiagram
    Animal <|-- Dog
    Animal <|-- Cat
    Dog --> Bone
    Cat --> Mouse
    Animal : +int age
    Animal : +makeSound()`],
  ['dense cross-linked with cardinalities', `classDiagram
    A <|-- B
    A <|-- C
    B <|-- D
    C <|-- D
    A --> E
    E --> F
    F --> A
    B "1" --> "*" G : owns
    C --> G
    D --> F
    G <|-- H`],
  ['composition + aggregation', `classDiagram
    Car *-- Engine
    Car o-- Wheel
    Car --> Driver
    Driver <|-- Person`],
]

const ER_DIAGRAMS: Array<[string, string]> = [
  ['orders schema', `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    CUSTOMER ||--o{ INVOICE : receives
    PRODUCT ||--o{ LINE_ITEM : in`],
  ['cross-linked entities', `erDiagram
    A ||--o{ B : has
    A ||--o{ C : has
    B ||--|{ D : owns
    C ||--|{ D : owns
    D ||--o{ E : refs`],
]

describe('class diagram relationship edges are orthogonal and clean (ELK direct, no straightener)', () => {
  it.each(CLASS_DIAGRAMS)('%s: zero diagonals, zero duplicate points', (_name, src) => {
    const d = layoutClassDiagram(parseClassDiagram(prep(src)))
    expect(d.relationships.length).toBeGreaterThan(0)
    const defects = edgeDefects(d.relationships.map(r => r.points as Pt[]))
    expect(defects.diagonals).toBe(0)
    expect(defects.duplicates).toBe(0)
    expect(defects.shortRoutes).toBe(0)
  })
})

describe('class/ER semantic layout validators (#33)', () => {
  it('verify surfaces real class/ER geometry with zero endpoint/on-canvas warnings for clean diagrams', () => {
    for (const src of [CLASS_DIAGRAMS[0]![1], ER_DIAGRAMS[0]![1]]) {
      const result = verifyMermaid(src)
      expect(result.ok).toBe(true)
      expect(result.layout.nodes.length).toBeGreaterThan(0)
      expect(result.layout.edges.length).toBeGreaterThan(0)
      expect(result.warnings.filter(w => w.code === 'OFF_CANVAS' || w.code === 'NODE_OVERLAP' || w.code === 'ROUTE_SHAPE_MISANCHOR')).toEqual([])
    }
  })
})

describe('ER diagram relationship edges are orthogonal and clean (ELK direct, no straightener)', () => {
  it.each(ER_DIAGRAMS)('%s: zero diagonals, zero duplicate points', (_name, src) => {
    const d = layoutErDiagram(parseErDiagram(prep(src)))
    expect(d.relationships.length).toBeGreaterThan(0)
    const defects = edgeDefects(d.relationships.map(r => r.points as Pt[]))
    expect(defects.diagonals).toBe(0)
    expect(defects.duplicates).toBe(0)
    expect(defects.shortRoutes).toBe(0)
  })
})

describe('rounding-consistent anchor spans', () => {
  it('the onboarding-probe ER diagram verifies without anchor false positives', () => {
    // Regression: erToRendered rounded x and width independently, shifting
    // the rect edge ±1px away from rounded endpoints and firing
    // ROUTE_SHAPE_MISANCHOR (TOL 0.5) on geometry that is exactly
    // on-boundary pre-rounding. fSpan rounds spans against their rounded
    // start, so anchors and edges agree.
    const probe = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'docs', 'pr-assets', 'onboarding-probes', 'probe-a.json'), 'utf8')) as { diagrams: { er: string } }
    const result = verifyMermaid(probe.diagrams.er)
    expect(result.ok).toBe(true)
    expect(result.warnings.filter(w => w.code === 'ROUTE_SHAPE_MISANCHOR')).toEqual([])
  })
})
