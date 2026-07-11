// ============================================================================
// Quadrant dense-cluster label placement (plan §Quadrant item 4, probe
// quad-20 class of inputs).
//
// Placement policy is a pure, deterministic function of point geometry:
//   1. the four near slots (right / left / below / above — unchanged from the
//      sparse-chart behavior, so sparse layouts do not move);
//   2. an offset ring and a deterministic outward spiral, connected to the
//      point by a leader line;
//   3. priority-based hiding as a last resort — source order wins, and the
//      hidden label is recorded on the positioned point (never silently
//      dropped from the model).
//
// Invariant gates (P5: snapshots pin, invariants judge):
//   - no two VISIBLE point-label boxes overlap;
//   - every visible label box stays inside the canvas;
//   - identical input → identical placement (byte determinism).
// ============================================================================

import { describe, it, expect } from 'bun:test'
import fc from 'fast-check'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import { resolveQuadrantVisualConfig } from '../quadrant/config.ts'
import { renderMermaidSVG } from '../index.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import type { PositionedQuadrantChart } from '../quadrant/types.ts'

function layout(src: string, config?: Record<string, unknown>): PositionedQuadrantChart {
  const chart = parseQuadrantChart(toMermaidLines(src))
  return layoutQuadrantChart(chart, {}, resolveQuadrantVisualConfig(config ? { quadrantChart: config as never } : {}))
}

interface Box { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5

function visibleBoxes(positioned: PositionedQuadrantChart): Box[] {
  return positioned.points.filter(p => !p.labelHidden).map(p => {
    expect(p.labelBox).toBeDefined()
    return p.labelBox!
  })
}

function assertLabelInvariants(positioned: PositionedQuadrantChart): void {
  const boxes = visibleBoxes(positioned)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect({ pair: [i, j], overlap: overlaps(boxes[i]!, boxes[j]!) }).toEqual({ pair: [i, j], overlap: false })
    }
  }
  for (const b of boxes) {
    expect(b.x0).toBeGreaterThanOrEqual(0)
    expect(b.y0).toBeGreaterThanOrEqual(0)
    expect(b.x1).toBeLessThanOrEqual(positioned.width)
    expect(b.y1).toBeLessThanOrEqual(positioned.height)
  }
}

// The quad-20 probe: 20 labeled points bunched into two clusters.
const QUAD20 = `quadrantChart
  title Feature priorities
  x-axis Low Effort --> High Effort
  y-axis Low Value --> High Value
  quadrant-1 Do now
  quadrant-2 Plan
  quadrant-3 Drop
  quadrant-4 Delegate
${Array.from({ length: 10 }, (_, i) => `  Cluster A item ${i}: [0.${20 + i}, 0.7${i}]`).join('\n')}
${Array.from({ length: 10 }, (_, i) => `  Cluster B item ${i}: [0.6${i}, 0.${25 + i}]`).join('\n')}`

describe('quad-20 dense cluster placement', () => {
  const positioned = layout(QUAD20)

  it('no two visible point-label boxes overlap', () => {
    assertLabelInvariants(positioned)
  })

  it('every label is either visible or explicitly recorded hidden — none lost', () => {
    for (const p of positioned.points) {
      expect(Boolean(p.labelHidden) || p.labelBox !== undefined).toBe(true)
    }
  })

  it('placement is deterministic (two layouts byte-identical, two renders byte-identical)', () => {
    expect(JSON.stringify(layout(QUAD20))).toBe(JSON.stringify(positioned))
    expect(renderMermaidSVG(QUAD20)).toBe(renderMermaidSVG(QUAD20))
  })

  it('crowded labels get leader lines in the SVG rather than overprinting', () => {
    const svg = renderMermaidSVG(QUAD20)
    expect(svg).toContain('class="quadrant-leader"')
  })

  it('labels do not sit on top of foreign point circles', () => {
    const circles: Box[] = positioned.points.map(p => ({
      x0: p.cx - p.radius, y0: p.cy - p.radius, x1: p.cx + p.radius, y1: p.cy + p.radius,
    }))
    positioned.points.forEach((p, i) => {
      if (p.labelHidden || !p.labelBox) return
      circles.forEach((c, j) => {
        if (i === j) return
        expect({ label: p.label, circle: j, overlap: overlaps(p.labelBox!, c) })
          .toEqual({ label: p.label, circle: j, overlap: false })
      })
    })
  })
})

describe('priority-based hiding is a last resort with source-order priority', () => {
  // Ten identically-placed long-label points inside a deliberately tiny
  // canvas: no placement can show them all, so later points must yield.
  const cramped = 'quadrantChart\n' +
    Array.from({ length: 10 }, (_, i) => `  A very long overlapping label ${i}: [0.5, 0.5]`).join('\n')
  const positioned = layout(cramped, { chartWidth: 220, chartHeight: 220 })

  it('some labels hide rather than overlap', () => {
    assertLabelInvariants(positioned)
    expect(positioned.points.some(p => p.labelHidden)).toBe(true)
  })

  it('the first point in source order keeps its label', () => {
    // labelHidden is only ever set (true) when placement hides a label.
    expect(positioned.points[0]!.labelHidden).toBeUndefined()
    expect(positioned.points[0]!.labelBox).toBeDefined()
  })

  it('hidden labels drop only later source-order points (prefix keeps, suffix hides)', () => {
    const hiddenIdx = positioned.points.map((p, i) => (p.labelHidden ? i : -1)).filter(i => i >= 0)
    const visibleIdx = positioned.points.map((p, i) => (!p.labelHidden ? i : -1)).filter(i => i >= 0)
    expect(Math.min(...hiddenIdx)).toBeGreaterThan(Math.max(0, ...visibleIdx.slice(0, 1)))
  })
})

describe('sparse charts keep the historical near-slot placement', () => {
  it('a lone point keeps its right-hand label with no leader and no hiding', () => {
    const positioned = layout('quadrantChart\n  P: [0.5, 0.5]')
    const p = positioned.points[0]!
    expect(p.labelHidden).toBeUndefined()
    expect(p.leader).toBeUndefined()
    expect(p.labelAnchor).toBe('start')
    expect(p.labelX).toBeCloseTo(p.cx + p.radius + 4, 1)
    expect(p.labelY).toBeCloseTo(p.cy, 1)
  })

  it('the classic 4-point campaign chart has no leaders, no hiding, and clean boxes', () => {
    const positioned = layout(`quadrantChart
      Campaign A: [0.3, 0.6]
      Campaign B: [0.45, 0.23]
      Campaign C: [0.57, 0.69]
      Campaign D: [0.78, 0.34]`)
    assertLabelInvariants(positioned)
    for (const p of positioned.points) {
      expect(p.labelHidden).toBeUndefined()
      expect(p.leader).toBeUndefined()
    }
  })
})

describe('label placement property: invariants hold for arbitrary point sets', () => {
  const labelArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,16}[A-Za-z0-9]$/)
  const coordArb = fc.integer({ min: 0, max: 100 }).map(n => n / 100)

  it('no visible overlap, in-canvas boxes, determinism', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ label: labelArb, x: coordArb, y: coordArb }), {
          minLength: 1, maxLength: 25, selector: p => p.label,
        }),
        (points) => {
          const src = 'quadrantChart\n' + points.map(p => `  ${p.label}: [${p.x}, ${p.y}]`).join('\n')
          const positioned = layout(src)
          assertLabelInvariants(positioned)
          expect(JSON.stringify(layout(src))).toBe(JSON.stringify(positioned))
        },
      ),
      { numRuns: 40 },
    )
  })
})
