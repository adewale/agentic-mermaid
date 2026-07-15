// Tests for the typographic readability band (idea #12): the CPL primitive and
// the LABEL_LINE_OVERLONG audit finding it drives.

import { describe, it, expect } from 'bun:test'
import { READABLE_MAX_CHARS, longestLineChars } from '../shared/readability.ts'
import { wrapLabelToWidth } from '../shared/label-wrap.ts'
import { auditReadability } from '../agent/readability-audit.ts'
import { toFinite } from '../agent/types.ts'
import type { RenderedLayout } from '../agent/types.ts'

describe('readability primitives', () => {
  it('longestLineChars measures the widest line and ignores formatting tags', () => {
    expect(longestLineChars('short')).toBe(5)
    expect(longestLineChars('a\nlonger line\nb')).toBe('longer line'.length)
    expect(longestLineChars('<b>bold</b>')).toBe(4) // 'bold', tags not counted
  })

  it('READABLE_MAX_CHARS sits in the classic 45–75 reading band', () => {
    expect(READABLE_MAX_CHARS).toBeGreaterThanOrEqual(45)
    expect(READABLE_MAX_CHARS).toBeLessThanOrEqual(75)
  })
})

describe('LABEL_LINE_OVERLONG readability finding', () => {
  const f = toFinite
  const flowchartWith = (label: string): RenderedLayout => ({
    version: 1,
    kind: 'flowchart',
    nodes: [{ id: 'N', x: f(0), y: f(0), w: f(600), h: f(40), shape: 'rectangle', label }],
    edges: [],
    groups: [],
    bounds: { w: f(600), h: f(40) },
  })

  it('flags a node label whose line runs past the reading measure', () => {
    const long = 'x'.repeat(READABLE_MAX_CHARS + 5)
    const findings = auditReadability(flowchartWith(long))
    expect(findings.map(x => x.code)).toContain('LABEL_LINE_OVERLONG')
    const overlong = findings.find(x => x.code === 'LABEL_LINE_OVERLONG')
    expect(overlong).toMatchObject({ element: 'N', chars: READABLE_MAX_CHARS + 5 })
  })

  it('does not flag a label at or below the reading measure', () => {
    const ok = 'x'.repeat(READABLE_MAX_CHARS)
    expect(auditReadability(flowchartWith(ok)).map(x => x.code)).not.toContain('LABEL_LINE_OVERLONG')
  })

  it('does not flag once a long label is wrapped into short readable lines', () => {
    const long = Array.from({ length: 20 }, (_u, i) => `word${i}`).join(' ')
    // A modest wrap budget yields lines well inside the reading measure.
    const wrapped = wrapLabelToWidth(long, 200, 14, 400)
    expect(longestLineChars(wrapped)).toBeLessThanOrEqual(READABLE_MAX_CHARS)
    expect(auditReadability(flowchartWith(wrapped)).map(x => x.code)).not.toContain('LABEL_LINE_OVERLONG')
  })

  it('flags an overlong edge label', () => {
    const layout: RenderedLayout = {
      version: 1,
      kind: 'flowchart',
      nodes: [
        { id: 'A', x: f(0), y: f(0), w: f(40), h: f(40), shape: 'rectangle', label: 'A' },
        { id: 'B', x: f(400), y: f(0), w: f(40), h: f(40), shape: 'rectangle', label: 'B' },
      ],
      edges: [{ id: 'A->B', from: 'A', to: 'B', path: [[f(40), f(20)], [f(400), f(20)]], label: { x: f(220), y: f(20), text: 'y'.repeat(READABLE_MAX_CHARS + 3) } }],
      groups: [],
      bounds: { w: f(440), h: f(40) },
    }
    expect(auditReadability(layout).map(x => x.code)).toContain('LABEL_LINE_OVERLONG')
  })
})
