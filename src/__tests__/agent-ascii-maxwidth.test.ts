// Loop 9 M13: ASCII maxWidth label wrapping.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'

describe('renderMermaidASCII with maxWidth', () => {
  test('narrow maxWidth wraps long node labels', () => {
    const src = 'flowchart LR\n  A["the quick brown fox jumps over"] --> B[End]'
    const wide = renderMermaidASCII(src)
    const narrow = renderMermaidASCII(src, { maxWidth: 30 })
    // Narrow output should be shorter columns than wide.
    const wideMaxCol = Math.max(...wide.split('\n').map(l => l.length))
    const narrowMaxCol = Math.max(...narrow.split('\n').map(l => l.length))
    expect(narrowMaxCol).toBeLessThan(wideMaxCol)
    for (const word of ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'End']) expect(narrow).toContain(word)
  })

  test('maxWidth does not affect single-word labels', () => {
    const src = 'flowchart LR\n  A[Start] --> B[End]'
    // Nothing fits the wrap budget worse than it already does, so the render
    // is byte-identical to the unbounded one.
    expect(renderMermaidASCII(src, { maxWidth: 20 })).toBe(renderMermaidASCII(src))
  })

  test('maxWidth preserves <br/> in already-wrapped labels', () => {
    const src = 'flowchart LR\n  A["line one<br/>line two"] --> B[End]'
    const rows = renderMermaidASCII(src, { maxWidth: 40 }).split('\n')
    const one = rows.findIndex(row => row.includes('line one'))
    const two = rows.findIndex(row => row.includes('line two'))
    // The authored break survives: the halves sit on consecutive rows, not joined.
    expect({ one: one >= 0, gap: two - one }).toEqual({ one: true, gap: 1 })
  })

  test('omitted maxWidth is identical to default render', () => {
    const src = 'flowchart LR\n  A[Start] --> B[End]'
    expect(renderMermaidASCII(src)).toBe(renderMermaidASCII(src, {}))
  })
})
