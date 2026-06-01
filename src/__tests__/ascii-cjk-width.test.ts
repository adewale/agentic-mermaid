import { describe, expect, it } from 'bun:test'

import { renderMermaidASCII } from '../ascii/index.ts'
import { maxLineWidth, visualWidth } from '../ascii/multiline-utils.ts'

describe('ASCII CJK/fullwidth display width', () => {
  it('counts CJK, Hangul, and emoji by terminal column width', () => {
    expect(visualWidth('开始')).toBe(4)
    expect(visualWidth('시작')).toBe(4)
    expect(visualWidth('A🙂B')).toBe(4)
    expect(maxLineWidth('A\n开始')).toBe(4)
  })

  it('sizes unicode node boxes by visual width, not JavaScript string length', () => {
    const output = renderMermaidASCII('graph TD\n  A[开始]')
    const lines = output.split('\n').filter(Boolean)
    const top = lines.find(line => line.includes('┌')) ?? ''
    const label = lines.find(line => line.includes('开始')) ?? ''
    expect(top).toContain('────')
    expect(label).toContain('开始')
    expect(label).toContain('│')
  })

  it('keeps CJK target labels visible in connected diagrams', () => {
    const output = renderMermaidASCII('graph LR\n  A[开始] --> B[처리]')
    expect(output).toContain('开始')
    expect(output).toContain('처리')
    expect(output).toContain('►')
  })

  it('sizes custom ASCII shapes by visual width too', () => {
    const output = renderMermaidASCII('graph TD\n  A([开始])\n  B[[처리]]\n  C[(数据🙂)]')
    expect(output).toContain('开始')
    expect(output).toContain('처리')
    expect(output).toContain('数据🙂')
    expect(output).not.toContain('\x00')
  })

  it('centers CJK sequence message labels on the arrow (bug 3.3)', () => {
    // CJK label between two participants — Loop 7 fix uses visualWidth, not
    // .length, so the label centers on terminal columns. The canvas pads
    // each wide glyph with a follow-cell, so the rendered row reads
    // "你 好 世 界" (single space between glyphs); we check each character
    // sits in monotonically increasing positions and the label is
    // roughly centered between the two lifelines.
    const output = renderMermaidASCII(`sequenceDiagram
      participant A
      participant B
      A->>B: 你好世界
    `)
    for (const ch of '你好世界') expect(output).toContain(ch)
    const lines = output.split('\n')
    const labelRow = lines.find(l => l.includes('你') && l.includes('世'))!
    expect(labelRow).toBeDefined()
    const pos = ['你', '好', '世', '界'].map(c => labelRow.indexOf(c))
    for (let i = 1; i < pos.length; i++) expect(pos[i]).toBeGreaterThan(pos[i - 1]!)
    // Lifelines │ should sit on either side of the label cluster.
    const leftWall = labelRow.indexOf('│')
    const rightWall = labelRow.lastIndexOf('│')
    expect(leftWall).toBeLessThan(pos[0]!)
    expect(rightWall).toBeGreaterThan(pos[pos.length - 1]!)
    // Center-ish: distance from left wall to first glyph and from last
    // glyph to right wall must be within a couple of cells of each other.
    const leftSlack = pos[0]! - leftWall
    const rightSlack = rightWall - pos[pos.length - 1]!
    expect(Math.abs(leftSlack - rightSlack)).toBeLessThanOrEqual(3)
  })

  it('handles FE0F emoji-presentation selector (bug 3.4)', () => {
    // 👍️ — thumbs up + U+FE0F — should be width 2.
    const { visualWidth } = require('../ascii/width.ts') as typeof import('../ascii/width.ts')
    expect(visualWidth('👍️')).toBe(2)
  })

  it('handles FE0E text-presentation selector (bug 3.4)', () => {
    // 👍︎ — thumbs up + U+FE0E — text presentation should be width 1.
    const { visualWidth } = require('../ascii/width.ts') as typeof import('../ascii/width.ts')
    expect(visualWidth('👍︎')).toBe(1)
  })

  it('handles ZWJ emoji sequences (bug 3.4)', () => {
    // 👨‍💻 — man + ZWJ + laptop. With the ZWJ fix this is one display cell-pair
    // (width 2), not two side-by-side emoji (width 4).
    const { visualWidth } = require('../ascii/width.ts') as typeof import('../ascii/width.ts')
    expect(visualWidth('\u{1F468}\u{200D}\u{1F4BB}')).toBe(2)
  })

  it('self-arrow CJK label uses codepoint+stride (Loop 7 review fix)', () => {
    // The M3.3 fix replaced .length with visualWidth() at three sites in
    // sequence.ts (lines ~207, 359-360, 408). The Loop 7 review-bughunt
    // found a fourth site at the self-arrow label-drawing loop (was using
    // line[i] + labelX + i). With the codepoint+stride fix, each CJK char
    // occupies its own canvas cell and is followed by a blank stride cell
    // (so the terminal renders it as a width-2 glyph). The bug would have
    // placed code-unit halves at consecutive columns, breaking surrogate
    // pairs entirely.
    const out = renderMermaidASCII('sequenceDiagram\n  participant A\n  A->>A: 你好世界')
    // Each CJK codepoint appears intact in the output (no surrogate halves).
    for (const ch of '你好世界') expect(out).toContain(ch)
    // And the canvas pattern is each CJK char with a stride-blank after it.
    expect(out).toContain('你 好 世 界')
  })
})
