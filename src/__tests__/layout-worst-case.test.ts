import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

// Bounded cost at the render boundary: small sources that once drove ELK or
// our own all-pairs passes for 10-110 s each. Every case must render or throw
// its typed size limit within a loose wall-clock bound; measured on a
// 4-core development container they take 0.1-6 s. The bound only catches a
// return to superlinear work, so it is generous for CI shards.
const BOUND_MS = 15_000

const names = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
const edgewise = (header: string, n: number, line: (a: string, b: string) => string): string =>
  [header, ...names('a', n).flatMap(a => names('b', n).map(b => line(a, b)))].join('\n')
/** A chain plus `n` pseudo-random long forward links (fixed LCG seed). */
function chainWithLongLinks(n: number): string {
  const lines = ['flowchart TD', ...Array.from({ length: n - 1 }, (_, i) => `n${i} --> n${i + 1}`)]
  let seed = 12345
  const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
  for (let i = 0; i < n; i++) {
    const x = next() % n, y = next() % n
    if (x !== y) lines.push(`n${Math.min(x, y)} --> n${Math.max(x, y)}`)
  }
  return lines.join('\n')
}

const CASES: Array<{ name: string; source: string; limit?: string }> = [
  { name: 'all-to-all fan 30 x 30 (`&` chains)', source: `flowchart TD\n${names('a', 30).join(' & ')} --> ${names('b', 30).join(' & ')}` },
  { name: 'complete DAG 30', source: ['flowchart TD', ...Array.from({ length: 30 }, (_, i) => Array.from({ length: 29 - i }, (_, k) => `k${i} --> k${i + k + 1}`)).flat()].join('\n') },
  { name: 'chain 150 with long links', source: chainWithLongLinks(150) },
  { name: 'state transition table 30 x 30', source: edgewise('stateDiagram-v2', 30, (a, b) => `${a} --> ${b}`) },
  { name: 'class relationships 20 x 20', source: edgewise('classDiagram', 20, (a, b) => `${a} --> ${b}`), limit: 'CLASS_LAYOUT_WORK_LIMIT' },
  { name: 'ER relationships 20 x 20', source: edgewise('erDiagram', 20, (a, b) => `${a.toUpperCase()} ||--o{ ${b.toUpperCase()} : r`), limit: 'ER_LABEL_WORK_LIMIT' },
  { name: 'edges past the host limit', source: ['flowchart TD', ...Array.from({ length: 5001 }, () => 'A --> B')].join('\n'), limit: 'DIAGRAM_WORK_LIMIT' },
]

describe('worst-case layout inputs finish within a bounded time', () => {
  for (const { name, source, limit } of CASES) {
    test(name, () => {
      const started = performance.now()
      let outcome: string
      try {
        outcome = renderMermaidSVG(source, { security: 'strict' }).startsWith('<svg') ? 'rendered' : 'not svg'
      } catch (error) {
        outcome = (error as { code?: string }).code ?? String(error)
      }
      const elapsed = performance.now() - started
      expect({ name, outcome }).toEqual({ name, outcome: limit ?? 'rendered' })
      expect(elapsed).toBeLessThan(BOUND_MS)
    }, BOUND_MS * 2)
  }
})
