// The family-generic layout rubric (src/family-rubric.ts) is the quality
// loop's eye onto every non-flowchart family, so IT must be able to see
// defects: each hard metric is proven against a synthetic bad layout (these
// fail if the corresponding check is deleted), and the journey assessor is
// proven against real journey layouts plus perturbed geometry.

import { describe, expect, it } from 'bun:test'
import {
  assessRenderedLayout, assessJourneyLayout, familyHardViolations,
  FAMILY_HARD_METRICS,
} from '../family-rubric.ts'
import type { RenderedLayout } from '../agent/types.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'
import { preprocessMermaidLines } from '../mermaid-source.ts'

// The rubric is defense-in-depth BEHIND the Finite brand, so these synthetic
// layouts deliberately bypass toFinite (which would throw on the NaN case).
type LooseLayout = {
  [K in keyof RenderedLayout]: RenderedLayout[K]
}
function looseLayout(layout: {
  kind?: string
  nodes?: Array<{ id: string; x: number; y: number; w: number; h: number; shape: string; label: string; role?: 'box' | 'mark' | 'labelled-mark' }>
  groups?: Array<{ id: string; x: number; y: number; w: number; h: number; members: string[]; label?: string; parentId?: string }>
  bounds?: { w: number; h: number }
} = {}): LooseLayout {
  return {
    version: 1,
    kind: layout.kind ?? 'journey',
    nodes: layout.nodes ?? [
      { id: 'a', x: 10, y: 10, w: 50, h: 20, shape: 'rectangle', label: 'A' },
      { id: 'b', x: 80, y: 10, w: 50, h: 20, shape: 'rectangle', label: 'B' },
    ],
    edges: [],
    groups: layout.groups ?? [],
    bounds: layout.bounds ?? { w: 200, h: 100 },
  } as unknown as LooseLayout
}
const baseLayout = looseLayout

describe('family rubric hard metrics discriminate', () => {
  it('scores a healthy layout 100 with zero violations', () => {
    const r = assessRenderedLayout(baseLayout())
    expect(r.score).toBe(100)
    expect(r.violations).toEqual([])
  })

  it('flags non-finite geometry', () => {
    const r = assessRenderedLayout(baseLayout({
      nodes: [{ id: 'a', x: Number.NaN, y: 0, w: 10, h: 10, shape: 'rectangle', label: 'A' }],
    }))
    expect(r.metrics.nonFiniteGeometry).toBeGreaterThan(0)
    expect(familyHardViolations(r).length).toBeGreaterThan(0)
  })

  it('flags off-canvas nodes', () => {
    const r = assessRenderedLayout(baseLayout({
      nodes: [{ id: 'a', x: 190, y: 10, w: 50, h: 20, shape: 'rectangle', label: 'A' }],
    }))
    expect(r.metrics.offCanvas).toBe(1)
  })

  it('flags overlapping text boxes but not coinciding data marks', () => {
    const boxes = assessRenderedLayout(baseLayout({
      nodes: [
        { id: 'a', x: 10, y: 10, w: 50, h: 20, shape: 'rectangle', label: 'A' },
        { id: 'b', x: 30, y: 15, w: 50, h: 20, shape: 'rectangle', label: 'B' },
      ],
    }))
    expect(boxes.metrics.nodeOverlaps).toBe(1)

    const marks = assessRenderedLayout(baseLayout({
      nodes: [
        { id: 'p1', x: 20, y: 20, w: 6, h: 6, shape: 'circle', label: '' },
        { id: 'p2', x: 22, y: 22, w: 6, h: 6, shape: 'circle', label: '' },
      ],
    }))
    expect(marks.metrics.nodeOverlaps).toBe(0)
    expect(marks.metrics.markOverlapRate).toBeGreaterThan(0)
    expect(marks.score).toBeLessThan(100)
  })

  it('explicit labelled marks participate in the missing-label score', () => {
    const result = assessRenderedLayout(baseLayout({
      nodes: [{ id: 'bar', x: 10, y: 10, w: 20, h: 40, shape: 'rectangle', label: '', role: 'labelled-mark' }],
    }))
    expect(result.metrics.labelledBoxRate).toBe(0)
    expect(result.violations).toContainEqual(expect.objectContaining({ metric: 'missingLabel' }))
    expect(result.score).toBeLessThan(100)
  })

  it('flags a member outside its group (x axis for journey)', () => {
    const r = assessRenderedLayout(baseLayout({
      groups: [{ id: 'g', x: 0, y: 0, w: 40, h: 90, members: ['b'], label: 'G' }],
    }))
    expect(r.metrics.groupBreaches).toBe(1)
  })

  it('flags partially overlapping sibling groups but allows full nesting', () => {
    const partial = assessRenderedLayout(baseLayout({
      groups: [
        { id: 'g1', x: 0, y: 0, w: 100, h: 50, members: [], label: 'G1' },
        { id: 'g2', x: 60, y: 10, w: 100, h: 50, members: [], label: 'G2' },
      ],
    }))
    expect(partial.metrics.groupOverlaps).toBe(1)

    const nested = assessRenderedLayout(baseLayout({
      groups: [
        { id: 'outer', x: 0, y: 0, w: 150, h: 90, members: [], label: 'O' },
        { id: 'inner', x: 10, y: 10, w: 50, h: 40, members: [], label: 'I' },
      ],
    }))
    expect(nested.metrics.groupOverlaps).toBe(0)
  })

  it('flags a foreign node intruding into a group region, but not its members or nested descendants', () => {
    // Architecture groups are true bounding frames ('both' axes). A non-member
    // whose centre sits inside the frame reads as belonging to the wrong
    // cluster (Palmer common-region purity — the dual of groupBreaches).
    const intruded = assessRenderedLayout(looseLayout({
      kind: 'architecture',
      nodes: [
        { id: 'a', x: 10, y: 10, w: 40, h: 20, shape: 'service', label: 'A' }, // member, inside
        { id: 'b', x: 60, y: 40, w: 40, h: 20, shape: 'service', label: 'B' }, // foreign, inside
      ],
      groups: [{ id: 'g', x: 0, y: 0, w: 120, h: 90, members: ['a'], label: 'G' }],
    }))
    expect(intruded.metrics.regionIntrusions).toBe(1)
    expect(intruded.violations).toContainEqual(expect.objectContaining({ metric: 'regionIntrusions' }))
    expect(intruded.score).toBeLessThan(100)

    // Same geometry, but B now belongs to the group: no intrusion.
    const member = assessRenderedLayout(looseLayout({
      kind: 'architecture',
      nodes: [
        { id: 'a', x: 10, y: 10, w: 40, h: 20, shape: 'service', label: 'A' },
        { id: 'b', x: 60, y: 40, w: 40, h: 20, shape: 'service', label: 'B' },
      ],
      groups: [{ id: 'g', x: 0, y: 0, w: 120, h: 90, members: ['a', 'b'], label: 'G' }],
    }))
    expect(member.metrics.regionIntrusions).toBe(0)

    // B belongs to a nested child group inside G: still inside G's region
    // legitimately, so not an intruder into the ancestor.
    const nested = assessRenderedLayout(looseLayout({
      kind: 'architecture',
      nodes: [
        { id: 'a', x: 10, y: 10, w: 40, h: 20, shape: 'service', label: 'A' },
        { id: 'b', x: 60, y: 40, w: 40, h: 20, shape: 'service', label: 'B' },
      ],
      groups: [
        { id: 'g', x: 0, y: 0, w: 120, h: 90, members: ['a'], label: 'G' },
        { id: 'child', x: 55, y: 35, w: 55, h: 45, members: ['b'], parentId: 'g', label: 'C' },
      ],
    }))
    expect(nested.metrics.regionIntrusions).toBe(0)
  })

  it('does not count region intrusions for band/plot group models (journey)', () => {
    // Journey sections are header BANDS ('x' axis), not ownership frames, so a
    // task sitting below a foreign band is not an intrusion.
    const r = assessRenderedLayout(looseLayout({
      kind: 'journey',
      nodes: [
        { id: 'a', x: 10, y: 10, w: 40, h: 20, shape: 'rectangle', label: 'A' },
        { id: 'b', x: 60, y: 40, w: 40, h: 20, shape: 'rectangle', label: 'B' },
      ],
      groups: [{ id: 'g', x: 0, y: 0, w: 120, h: 90, members: ['a'], label: 'G' }],
    }))
    expect(r.metrics.regionIntrusions).toBe(0)
  })

  it('every hard metric is exercised by this file', () => {
    // Guard against a new hard metric landing without a discriminating test.
    expect([...FAMILY_HARD_METRICS].sort()).toEqual(
      ['groupBreaches', 'groupOverlaps', 'nodeOverlaps', 'nonFiniteGeometry', 'offCanvas'],
    )
  })
})

describe('journey assessor', () => {
  const positioned = (src: string) => layoutJourneyDiagram(
    parseJourneyDiagram(preprocessMermaidLines(src)),
    resolveJourneyRequestAppearance(),
  )

  it('scores the docs example 100 with zero violations', () => {
    const r = assessJourneyLayout(positioned(`journey
      title My working day
      section Go to work
        Make tea: 5: Me
        Go upstairs: 3: Me
        Do work: 1: Me, Cat
      section Go home
        Go downstairs: 5: Me
        Sit down: 3: Me`))
    expect(r.score).toBe(100)
    expect(r.violations).toEqual([])
  })

  it('scores the wide-section-label stress case clean (the PR #136 bug shape)', () => {
    const r = assessJourneyLayout(positioned(`journey
      section A very long section label that is much wider than its tasks
        Short: 3: Me
      section Next
        Task: 4: Me`))
    expect(r.metrics.sectionSpanOverlaps).toBe(0)
    expect(r.score).toBe(100)
  })

  it('detects overlapping section spans on perturbed geometry', () => {
    const layout = positioned('journey\n  section One\n    A: 3: Me\n  section Two\n    B: 4: Me')
    layout.sections[1]!.x = layout.sections[0]!.x + layout.sections[0]!.width / 2
    const result = assessJourneyLayout(layout)
    expect(result.metrics.sectionSpanOverlaps).toBeGreaterThan(0)
    expect(result.score).toBeLessThan(100)
  })

  it('detects a broken score axis on perturbed geometry', () => {
    const layout = positioned('journey\n  section S\n    A: 5: Me\n    B: 1: Me')
    // Sabotage: swap the two markers' vertical positions.
    const [a, b] = layout.sections[0]!.tasks
    const swap = a!.marker.cy
    a!.marker.cy = b!.marker.cy
    b!.marker.cy = swap
    const r = assessJourneyLayout(layout)
    expect(r.metrics.scoreOrderViolations).toBeGreaterThan(0)
    expect(r.score).toBeLessThan(100)
  })

  it('detects markers pushed off their column and dots escaping their box', () => {
    const layout = positioned('journey\n  section S\n    A: 3: Me')
    const task = layout.sections[0]!.tasks[0]!
    task.marker.cx += 30
    task.actorDots[0]!.x = task.x + task.width + 50
    const r = assessJourneyLayout(layout)
    expect(r.metrics.markerOffCenter).toBe(1)
    expect(r.metrics.actorDotsOutsideTask).toBe(1)
  })
})
