// Loop 9 M13: ASCII maxWidth label wrapping.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII, wrapLabel } from '../ascii/index.ts'

describe('wrapLabel helper', () => {
  test('short label passes through unchanged', () => {
    expect(wrapLabel('hi', 20)).toBe('hi')
  })

  test('multi-word label wraps at word boundaries', () => {
    const out = wrapLabel('the quick brown fox', 10)
    expect(out).toContain('<br/>')
    for (const line of out.split('<br/>')) expect(line.length).toBeLessThanOrEqual(10)
  })

  test('single oversized word renders anyway (with warn)', () => {
    const orig = console.warn
    let warned = false
    console.warn = () => { warned = true }
    try {
      const out = wrapLabel('antidisestablishmentarianism', 10)
      expect(out).toContain('antidisestablishmentarianism')
      expect(warned).toBe(true)
    } finally { console.warn = orig }
  })
})

describe('renderMermaidASCII with maxWidth', () => {
  test('narrow maxWidth wraps long node labels', () => {
    const src = 'flowchart LR\n  A["the quick brown fox jumps over"] --> B[End]'
    const wide = renderMermaidASCII(src)
    const narrow = renderMermaidASCII(src, { maxWidth: 30 })
    // Narrow output should be shorter columns than wide.
    const wideMaxCol = Math.max(...wide.split('\n').map(l => l.length))
    const narrowMaxCol = Math.max(...narrow.split('\n').map(l => l.length))
    expect(narrowMaxCol).toBeLessThan(wideMaxCol)
  })

  test('maxWidth does not affect single-word labels', () => {
    const src = 'flowchart LR\n  A[Start] --> B[End]'
    const out = renderMermaidASCII(src, { maxWidth: 20 })
    expect(out).toContain('Start')
    expect(out).toContain('End')
  })

  test('maxWidth preserves <br/> in already-wrapped labels', () => {
    const src = 'flowchart LR\n  A["line one<br/>line two"] --> B[End]'
    const out = renderMermaidASCII(src, { maxWidth: 40 })
    expect(out).toContain('line one')
    expect(out).toContain('line two')
  })

  test('omitted maxWidth is identical to default render', () => {
    const src = 'flowchart LR\n  A[Start] --> B[End]'
    expect(renderMermaidASCII(src)).toBe(renderMermaidASCII(src, {}))
  })
})
