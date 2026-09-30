import { describe, expect, it } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'

/**
 * Audit fix: the grid layout tracked per-level placement in a fixed
 * `new Array(100)`, but levels grow by 4 per generation — a linear chain of
 * ~25 edges already reads index 100, got `undefined`, and the resulting NaN
 * grid coordinates sent A* pathfinding into an unbounded search. A 100-edge
 * flowchart hung the text renderer for minutes (SVG rendered in <1s).
 * These renders must complete well inside the test timeout.
 */
describe('ASCII deep chains — no fixed level-tracker limit', () => {
  const chain = (n: number, dir: 'TD' | 'LR'): string => {
    let s = `flowchart ${dir}\n`
    for (let i = 0; i < n; i++) s += `  N${i} --> N${i + 1}\n`
    return s
  }

  it('renders a 100-edge TD chain (past the old level-100 cliff) with every node present', () => {
    const out = renderMermaidASCII(chain(100, 'TD'))
    // Word boundaries so N1 is not satisfied by N10..N19 or N100.
    const missing = Array.from({ length: 101 }, (_, i) => `N${i}`).filter(id => !new RegExp(`\\b${id}\\b`).test(out))
    expect(missing).toEqual([])
  })

  it('renders a 30-edge LR chain (level growth along x)', () => {
    const out = renderMermaidASCII(chain(30, 'LR'))
    expect(out).toContain('N30')
  })
})
