// Loop 7 bug 3.2: a self-arrow nested inside an alt/loop/opt block was not
// taken into account by the block-width math, so the right border of the
// block clipped the self-arrow's label. The fix extends maxLX with the
// self-arrow visual extent: llX[f] + 6 + maxLineWidth(label) + 2.
//
// This test asserts the entire self-arrow (top corner, label, bottom corner)
// sits to the LEFT of the block's right border on every row.

import { describe, it, expect } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { visualWidth } from '../ascii/width.ts'

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

  it('spaces adjacent lifelines so a self-message label does not overwrite the next lifeline (#385)', () => {
    const src = `sequenceDiagram
  participant A
  participant B
  participant C
  B->>B: Signal for throat clearance
  B->>C: Next step`
    const ascii = renderMermaidASCII(src, { useAscii: false })
    const lines = ascii.split('\n')
    const labelRow = lines.find(l => l.includes('Signal for throat clearance'))!
    expect(labelRow).toBeDefined()

    // On the self-message label row, C's lifeline (│) must still be drawn to the right of the label.
    const labelEnd = labelRow.indexOf('Signal for throat clearance') + 'Signal for throat clearance'.length
    const cLifelineIdx = labelRow.lastIndexOf('│')
    expect(cLifelineIdx).toBeGreaterThan(labelEnd)
  })
})


describe('ASCII sequence lexical ownership and complete cell bounds (#391)', () => {
  it.each([true, false])('keeps notes on their authored side of end (ASCII=%s)', useAscii => {
    const result = renderMermaidASCII(`sequenceDiagram
participant A
participant B
loop inside
A->>B: hi
Note over B: inside note
end
Note over B: outside note
A->>B: done`, { useAscii })
    const rows = result.split('\n')
    const inside = rows.findIndex(row => row.includes('inside note'))
    const outside = rows.findIndex(row => row.includes('outside note'))
    const border = useAscii ? '+' : '└'
    expect(inside).toBeGreaterThan(0)
    expect(outside).toBeGreaterThan(inside + 3)
    // The outer frame closes after the inside note box and before the outside box.
    expect(rows.slice(inside + 2, outside - 1).some(row => row.trimStart().startsWith(border))).toBe(true)
    const content = rows[inside]!
    expect(content.trimEnd().endsWith(useAscii ? '|' : '│')).toBe(true)
    expect(content.lastIndexOf(useAscii ? '|' : '│')).toBeGreaterThan(content.indexOf('inside note') + 'inside note'.length)
  })

  it('represents empty siblings and nested note-only branches in order', () => {
    const result = renderMermaidASCII(`sequenceDiagram
participant A
loop first
opt nested
end
end
loop second
Note over A: owned by second
end
Note over A: outside all`, { useAscii: false })
    expect(result.indexOf('loop [first]')).toBeGreaterThan(-1)
    expect(result.indexOf('opt [nested]')).toBeGreaterThan(result.indexOf('loop [first]'))
    expect(result.indexOf('loop [second]')).toBeGreaterThan(result.indexOf('opt [nested]'))
    expect(result.indexOf('owned by second')).toBeGreaterThan(result.indexOf('loop [second]'))
    expect(result.indexOf('outside all')).toBeGreaterThan(result.indexOf('owned by second'))
  })

  it.each([['alt', 'else'], ['par', 'and'], ['critical', 'option']])('retains complete %s/%s conditions and notes', (opener, divider) => {
    const condition = 'a complete condition much longer than the message span'
    const alternative = 'a different complete condition with its own continuation'
    const result = renderMermaidASCII(`sequenceDiagram
participant A
participant B
${opener} ${condition}
Note over A,B: first branch
${divider} ${alternative}
Note over A,B: second branch
end`, { useAscii: false })
    expect(result).toContain(condition)
    expect(result).toContain(alternative)
    expect(result.indexOf('first branch')).toBeLessThan(result.indexOf(alternative))
    expect(result.indexOf(alternative)).toBeLessThan(result.indexOf('second branch'))
  })

  it('keeps before/inside/after notes ordered without an intervening message', () => {
    const result = renderMermaidASCII(`sequenceDiagram
participant A
Note over A: before
rect rgb(240,240,240)
Note over A: inside
end
Note over A: after`, { useAscii: false })
    const rows = result.split('\n')
    const before = rows.findIndex(row => row.includes('before'))
    const inside = rows.findIndex(row => row.includes('inside'))
    const after = rows.findIndex(row => row.includes('after'))
    expect(before).toBeLessThan(inside)
    expect(inside).toBeLessThan(after)
    expect(rows[before]!.match(/│/g)?.length).toBe(2)
    expect(rows[inside]!.match(/│/g)?.length).toBe(4)
    expect(rows[after]!.match(/│/g)?.length).toBe(2)
  })

  it.each([['alt', 'else'], ['par', 'and'], ['critical', 'option']])('reserves empty and child-only %s sections', (opener, divider) => {
    const result = renderMermaidASCII(`sequenceDiagram
participant A
${opener} empty first
${divider} child section
opt child only
end
${divider} empty last
end`, { useAscii: false })
    const rows = result.split('\n')
    const first = rows.findIndex(row => row.includes('empty first'))
    const middle = rows.findIndex(row => row.includes('child section'))
    const child = rows.findIndex(row => row.includes('opt [child only]'))
    const last = rows.findIndex(row => row.includes('empty last'))
    expect(first).toBeLessThan(middle)
    expect(middle).toBeLessThan(child)
    expect(child).toBeLessThan(last)
    expect(rows.slice(child + 1, last).some(row => row.includes('└'))).toBe(true)
  })

  it('keeps a note between nested closes inside its parent only', () => {
    const result = renderMermaidASCII(`sequenceDiagram
participant A
loop outer
opt inner
Note over A: inner note
end
Note over A: parent note
end
Note over A: outside note`, { useAscii: false })
    const rows = result.split('\n')
    const innerRow = rows.findIndex(row => row.includes('inner note'))
    const parentRow = rows.findIndex(row => row.includes('parent note'))
    const outsideRow = rows.findIndex(row => row.includes('outside note'))
    expect(parentRow).toBeGreaterThan(innerRow + 3)
    expect(outsideRow).toBeGreaterThan(parentRow + 3)
    expect(rows[parentRow]!.match(/│/g)?.length).toBe(4)
    expect(rows[innerRow]!.match(/│/g)?.length).toBe(6)
    expect(rows[outsideRow]!.match(/│/g)?.length).toBe(2)
  })

  it.each(['left of A', 'right of A', 'over A', 'left of B', 'right of B', 'over B', 'over A,C'])('contains a note %s and leaves opaque padding', position => {
    const result = renderMermaidASCII(`sequenceDiagram
participant A
participant B
participant C
rect rgb(240,240,240)
Note ${position}: a sufficiently wide note
end`, { useAscii: false })
    const row = result.split('\n').find(line => line.includes('a sufficiently wide note'))!
    expect(row).toContain('│ a sufficiently wide note │')
    // The note's own two walls are enclosed by the complete fragment frame.
    const noteStart = row.indexOf('│ a sufficiently wide note │')
    expect(row.slice(0, noteStart)).toContain('│')
    expect(row.slice(noteStart + '│ a sufficiently wide note │'.length)).toContain('│')
  })

  it('retains multiline conditions, combining marks and emoji without unequal row cell widths', () => {
    const result = renderMermaidASCII(`sequenceDiagram
participant A
alt 注記です 👩‍💻 é<br/>second header line
Note over A: first note<br/>second note
else 他の条件 👩‍🚀<br/>second divider line
end`, { useAscii: false })
    expect(result).toContain('注記です 👩‍💻 é')
    expect(result).toContain('second header line]')
    expect(result).toContain('他の条件 👩‍🚀')
    expect(result).toContain('second divider line]')
    expect(new Set(result.split('\n').map(visualWidth)).size).toBe(1)
  })

  it.each(['none', 'ansi16', 'truecolor', 'html'] as const)('keeps measured sequence content within a hard width with %s output', colorMode => {
    const result = renderMermaidASCII(`sequenceDiagram
participant A
participant B
loop condition one two three four five six seven
Note over A,B: 注記です 👩‍💻 é
end
Note over B: outside`, { useAscii: false, targetWidth: 70, colorMode })
    const plain = result.replace(/\x1b\[[0-9;]*m/g, '').replace(/<[^>]+>/g, '')
    expect(plain).toContain('注記です 👩‍💻 é')
    expect(plain).toContain('outside')
    expect(Math.max(...plain.split('\n').map(visualWidth))).toBeLessThanOrEqual(70)
  })

  it('clears note padding and writes wide graphemes as terminal cells', () => {
    const result = renderMermaidASCII(`sequenceDiagram
participant A
participant B
Note over A,B: 注記です 👩‍💻 é`, { useAscii: false })
    expect(result).toContain('│ 注記です 👩‍💻 é │')
  })
})
