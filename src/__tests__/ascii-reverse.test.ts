// Loop 10 M5 (raiscui): reverse ASCII → Mermaid (best-effort, flowchart-only).
//
// LOSSY by nature: the ASCII render carries node LABELS, not original ids, so
// reverse synthesizes ids (N0, N1, …). Round-trip is STRUCTURAL — same label
// set + same edge count — never byte-identical source. Edge labels, node
// shapes, subgraphs, and styling are NOT recovered.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { asciiToMermaid } from '../ascii/reverse.ts'
import { parseMermaid } from '../agent/parse.ts'

function labelsAndEdgeCount(mermaid: string): { labels: Set<string>; edges: number } {
  const labels = new Set<string>()
  let edges = 0
  for (const line of mermaid.split('\n')) {
    if (line.includes('-->')) edges++
    const m = line.match(/\[(?:")?([^"\]]+)(?:")?\]/)
    if (m) labels.add(m[1]!)
  }
  return { labels, edges }
}

describe('asciiToMermaid — structural round-trip', () => {
  test('linear chain: labels + edge count preserved', () => {
    const src = 'flowchart LR\n  A[Start] --> B[Middle]\n  C[End]\n  B --> C'
    const rev = asciiToMermaid(renderMermaidASCII(src), { direction: 'LR' })
    expect(rev.ok).toBe(true)
    if (!rev.ok) return
    const got = labelsAndEdgeCount(rev.value)
    expect(got.labels).toEqual(new Set(['Start', 'Middle', 'End']))
    expect(got.edges).toBe(2)
    // The reversed source must itself parse.
    expect(parseMermaid(rev.value).ok).toBe(true)
  })

  test('fanout: all branch edges recovered', () => {
    const src = 'flowchart TD\n  A --> B\n  A --> C\n  A --> D'
    const rev = asciiToMermaid(renderMermaidASCII(src), { direction: 'TD' })
    expect(rev.ok).toBe(true)
    if (!rev.ok) return
    const got = labelsAndEdgeCount(rev.value)
    expect(got.labels).toEqual(new Set(['A', 'B', 'C', 'D']))
    expect(got.edges).toBe(3)
  })

  test('chain of 4: node + edge counts preserved', () => {
    const src = 'flowchart TD\n  A --> B\n  B --> C\n  C --> D'
    const rev = asciiToMermaid(renderMermaidASCII(src), { direction: 'TD' })
    expect(rev.ok).toBe(true)
    if (!rev.ok) return
    const got = labelsAndEdgeCount(rev.value)
    expect(got.labels.size).toBe(4)
    expect(got.edges).toBe(3)
  })

  test('reversed source re-renders to ASCII (full loop)', () => {
    const src = 'flowchart LR\n  A[One] --> B[Two]'
    const rev = asciiToMermaid(renderMermaidASCII(src), { direction: 'LR' })
    expect(rev.ok).toBe(true)
    if (!rev.ok) return
    const ascii2 = renderMermaidASCII(rev.value)
    expect(ascii2).toContain('One')
    expect(ascii2).toContain('Two')
  })

  test('empty input → error result (not a throw)', () => {
    const rev = asciiToMermaid('')
    expect(rev.ok).toBe(false)
  })

  test('non-diagram text → NO_BOXES error', () => {
    const rev = asciiToMermaid('just some prose\nwith no boxes')
    expect(rev.ok).toBe(false)
    if (rev.ok) return
    expect(rev.error[0]!.code).toBe('NO_BOXES')
  })

  test('ASCII-mode (+,-,|) boxes are detected too', () => {
    const src = 'flowchart LR\n  A[X] --> B[Y]'
    const rev = asciiToMermaid(renderMermaidASCII(src, { useAscii: true }), { direction: 'LR' })
    expect(rev.ok).toBe(true)
    if (!rev.ok) return
    expect(labelsAndEdgeCount(rev.value).labels.size).toBeGreaterThanOrEqual(2)
  })
})
