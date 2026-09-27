// ============================================================================
// Scene-IR text geometry fidelity (plan §Quadrant item 3).
//
// The fidelity oracle (src/scene/fidelity.ts) used to check only a text
// mark's content and fontSize — it was blind to x/y/anchor, so a lowering
// could claim one label position while the crisp SVG drew another (quadrant
// point labels did exactly that: semantic always said "right of the point,
// anchor start" while the drawn label used the collision-aware slot). The
// oracle now checks text x, y, and text-anchor, generically for every family.
// ============================================================================

import { describe, it, expect } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { sceneFidelityProblems, nodeProblems } from '../scene/fidelity.ts'
import { lowerQuadrantScene } from '../quadrant/renderer.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import type { SceneDoc } from '../scene/ir.ts'

function textMark(semantic: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }, crisp: string) {
  return marks.text(
    { id: 't', role: 'label', text: 'Hi', fontSize: 12, paint: {}, ...semantic },
    crisp,
  )
}

describe('fidelity oracle checks text x/y/anchor', () => {
  it('flags a crisp x that disagrees with the semantic x', () => {
    const problems: string[] = []
    nodeProblems(textMark({ x: 10, y: 20, anchor: 'start' },
      '<text x="99" y="20" text-anchor="start" font-size="12">Hi</text>'), 'p', problems)
    expect(problems.join('\n')).toContain('x')
    expect(problems.length).toBeGreaterThan(0)
  })

  it('flags a crisp text-anchor that disagrees with the semantic anchor', () => {
    const problems: string[] = []
    nodeProblems(textMark({ x: 10, y: 20, anchor: 'start' },
      '<text x="10" y="20" text-anchor="end" font-size="12">Hi</text>'), 'p', problems)
    expect(problems.join('\n')).toContain('anchor')
  })

  it('flags a crisp y that disagrees with the semantic y', () => {
    const problems: string[] = []
    nodeProblems(textMark({ x: 10, y: 20, anchor: 'start' },
      '<text x="10" y="220" text-anchor="start" font-size="12">Hi</text>'), 'p', problems)
    expect(problems.join('\n')).toContain('y')
  })

  it('accepts a faithful mark (including dy baseline shifts and missing anchor = start)', () => {
    const problems: string[] = []
    nodeProblems(textMark({ x: 10, y: 20, anchor: 'start' },
      '<text x="10" y="20" font-size="12" dy="4.2">Hi</text>'), 'p', problems)
    expect(problems).toEqual([])
  })

  it('treats generic angle brackets as semantic text, not removable markup', () => {
    const make = (crisp: string) => marks.text(
      { id: 'generic', role: 'member', text: 'List<List<int>> data', x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} },
      crisp,
    )
    const faithful: string[] = []
    nodeProblems(make('<text x="10" y="20" font-size="12">List&lt;List&lt;int&gt;&gt; data</text>'), 'p', faithful)
    expect(faithful).toEqual([])

    const missing: string[] = []
    nodeProblems(make('<text x="10" y="20" font-size="12">List data</text>'), 'p', missing)
    expect(missing.join('\n')).toContain('not found in crisp')
  })

  it('checks complete literal class member text, including tag-named and trailing generic parameters', () => {
    for (const [semantic, crispText] of [
      ['List<b> data', 'List data'],
      ['Map<i> values', 'Map values'],
      ['+id: List<int>', '+id: List'],
    ] as const) {
      const problems: string[] = []
      nodeProblems(marks.text(
        { id: 'generic', role: 'member', text: semantic, x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} },
        `<text x="10" y="20" font-size="12">${crispText}</text>`,
      ), 'p', problems)
      expect(problems.join('\n')).toContain('not found in crisp')
    }
  })

  it('keeps entity-produced Pie title tags literal without hiding missing text', () => {
    const make = (crispText: string) => marks.text(
      { id: 'title', role: 'title', text: 'A<script>B', x: 10, y: 20, fontSize: 12, anchor: 'middle', paint: {} },
      `<text x="10" y="20" text-anchor="middle" font-size="12" class="pie-title">${crispText}</text>`,
    )
    const faithful: string[] = []
    nodeProblems(make('A&lt;script&gt;B'), 'p', faithful)
    expect(faithful).toEqual([])
    const missing: string[] = []
    nodeProblems(make('A&lt;script&gt;'), 'p', missing)
    expect(missing.join('\n')).toContain('not found in crisp')
  })
})

describe('quadrant lowering is text-faithful', () => {
  function lower(src: string): SceneDoc {
    const positioned = layoutQuadrantChart(parseQuadrantChart(toMermaidLines(src)))
    return lowerQuadrantScene({
      positioned,
      colors: { bg: '#FFFFFF', fg: '#27272A', font: 'Inter' },
      resolved: { renderOptions: {} },
    })
  }

  it('point labels carry their REAL collision-aware position in the scene IR', () => {
    // Two nearby points force the second label off the default right-hand
    // slot; the semantic x/y/anchor must follow the drawn slot.
    const doc = lower(`quadrantChart
      Alpha long label: [0.5, 0.5]
      Beta long label: [0.55, 0.5]
      Gamma long label: [0.6, 0.5]
      Delta long label: [0.65, 0.5]`)
    expect(sceneFidelityProblems(doc)).toEqual([])
  })

  it('the classic campaign chart lowers faithfully', () => {
    const doc = lower(`quadrantChart
      title Reach and engagement of campaigns
      x-axis Low Reach --> High Reach
      y-axis Low Engagement --> High Engagement
      quadrant-1 We should expand
      Campaign A: [0.3, 0.6]
      Campaign B: [0.45, 0.23]`)
    expect(sceneFidelityProblems(doc)).toEqual([])
  })
})
