import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidPNG, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'

// Issue #318: a break inside the first word used to make Scene validation
// reject otherwise renderable diagrams. These are real source-render routes,
// not synthetic Scene fragments; both State variants are in Mermaid's pinned
// parser-suite corpus.
const upstreamCases = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'eval', 'mermaid-upstream-suite-bench', 'cases.json'), 'utf8')) as Array<{ id: string; source: string }>
function pinnedStateSource(id: string): string {
  const matching = upstreamCases.filter(entry => entry.id === id)
  if (matching.length !== 1) throw new Error(`Expected one pinned State source for ${id}`)
  return matching[0]!.source
}
const sources = {
  'pinned stateDiagram-v2 note': pinnedStateSource('state-upstream-should-handle-multiline-notes-with-different-line-breaks'),
  'pinned stateDiagram note': pinnedStateSource('state-upstream-should-handle-multiline-notes-with-different-line-breaks-2'),
  'class note': 'classDiagram\n  class A\n  note for A "Line1<br/>Line2"',
  'Gantt section and task': 'gantt\n  dateFormat YYYY-MM-DD\n  section Line1<br/>Line2\n    Line1<br/>Line2 :a1, 2024-01-01, 1d',
  'XY Chart title and category': 'xychart-beta\n  title "Line1<br/>Line2"\n  x-axis ["Line1<br/>Line2", b]\n  bar [1, 2]',
  'GitGraph commit ID and tag': 'gitGraph\n  commit id: "Line1<br/>Line2" tag: "Line1<br/>Line2"',
  'Sankey node': 'sankey-beta\nLine1<br/>Line2,B,10',
} as const

/** The raw text content of every drawn <text>/<tspan>. */
function drawnText(svg: string): string {
  return [...svg.matchAll(/<(?:text|tspan)\b[^>]*>([^<]*)/g)].map(match => match[1]!).join(' ')
}

describe('Scene text fidelity with a break in the first word', () => {
  // Regression guard for #318: the render must not be rejected, and the words on
  // both sides of the break must still be drawn. Whether `<br>` then displays as
  // a line break is per context, as pinned upstream draws it; that is asserted
  // in label-line-break-display.test.ts, not here.
  for (const [position, source] of Object.entries(sources)) {
    it(`renders ${position} without a false text-loss error`, () => {
      const drawn = drawnText(renderMermaidSVG(source))
      expect({ position, line1: drawn.includes('Line1'), line2: drawn.includes('Line2') }).toEqual({ position, line1: true, line2: true })
    })
  }

  it('keeps verification and PNG rendering in agreement for the pinned State note', () => {
    const source = sources['pinned stateDiagram-v2 note']
    expect(verifyMermaid(source).ok).toBe(true)
    expect([...renderMermaidPNG(source).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })
})
