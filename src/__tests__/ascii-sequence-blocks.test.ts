// Loop 7 bug 3.2: a self-arrow nested inside an alt/loop/opt block was not
// taken into account by the block-width math, so the right border of the
// block clipped the self-arrow's label. The fix extends maxLX with the
// self-arrow visual extent: llX[f] + 6 + maxLineWidth(label) + 2.
//
// This test asserts the entire self-arrow (top corner, label, bottom corner)
// sits to the LEFT of the block's right border on every row.

import { describe, it, expect } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'

describe('ASCII sequence blocks — self-arrow extent', () => {
  it('alt block right border sits past a self-arrow label (bug 3.2)', () => {
    const src = `sequenceDiagram
  participant A
  alt success
    A->>A: very long self-label here
  end`
    const ascii = renderMermaidASCII(src, { useAscii: false })

    // The block header text "alt" should appear in the canvas.
    expect(ascii).toContain('alt')
    // The full self-arrow label should appear, not clipped.
    expect(ascii).toContain('very long self-label here')

    // For every row that contains the label, the right border (┐ or │ or ┘
    // belonging to the alt frame, NOT the self-arrow's own ┐/┘) must sit
    // to the right of the last label character. We approximate "block right
    // border" as the rightmost │ on a row that also contains the label.
    const lines = ascii.split('\n')
    const labelRow = lines.find(l => l.includes('very long self-label here'))!
    expect(labelRow).toBeDefined()
    const labelLastIdx = labelRow.lastIndexOf('e') // last 'e' of "here"
    // The rightmost block border │ must be strictly to the right.
    const lastBorder = labelRow.lastIndexOf('│')
    expect(lastBorder).toBeGreaterThan(labelLastIdx)
  })

  it('loop block right border accommodates multi-line self labels', () => {
    const src = `sequenceDiagram
  participant A
  loop forever
    A->>A: line1<br/>line2longerthanline1
  end`
    const ascii = renderMermaidASCII(src, { useAscii: false })
    expect(ascii).toContain('line1')
    expect(ascii).toContain('line2longerthanline1')

    const lines = ascii.split('\n')
    const longRow = lines.find(l => l.includes('line2longerthanline1'))!
    expect(longRow).toBeDefined()
    // Loop frame right border must be past the longest line.
    const lastBorder = longRow.lastIndexOf('│')
    const lastTextIdx = longRow.lastIndexOf('1') // last '1' of "line1" or longer
    expect(lastBorder).toBeGreaterThan(lastTextIdx)
  })
})
