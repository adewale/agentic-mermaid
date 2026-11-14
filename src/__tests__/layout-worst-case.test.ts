import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'

// Bounded cost at the render boundary: small sources that once drove ELK or
// our own all-pairs passes for 10-110 s each. Every case must render or throw
// its typed size limit within a loose wall-clock bound, never an internal
// error; measured on a 4-core development container they take 0.1-6 s. The
// bound only catches a return to superlinear work, so it is generous for CI
// shards. Terminal cases draw ASCII, whose cell routing has its own costs.
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

const c4Systems = (n: number): string => ['C4Context', ...names('s', n).map(id => `  System(${id}, "System ${id}")`),
  ...completeDag(n).split('\n').slice(1).map(line => `  Rel(${line.replace(' --> ', ', ').replaceAll('k', 's')}, "Uses")`)].join('\n')
const fan = (n: number): string => `flowchart TD\n${names('a', n).join(' & ')} --> ${names('b', n).join(' & ')}`
const completeDag = (n: number): string => ['flowchart TD', ...Array.from({ length: n }, (_, i) => Array.from({ length: n - 1 - i }, (_, k) => `k${i} --> k${i + k + 1}`)).flat()].join('\n')

const CASES: Array<{ name: string; source: string; limit?: string; terminal?: true }> = [
  { name: 'all-to-all fan 30 x 30 (`&` chains)', source: fan(30) },
  { name: 'complete DAG 30', source: completeDag(30) },
  { name: 'chain 150 with long links', source: chainWithLongLinks(150) },
  { name: 'state transition table 30 x 30', source: edgewise('stateDiagram-v2', 30, (a, b) => `${a} --> ${b}`) },
  { name: 'class relationships 20 x 20', source: edgewise('classDiagram', 20, (a, b) => `${a} --> ${b}`), limit: 'CLASS_LAYOUT_WORK_LIMIT' },
  { name: 'ER relationships 20 x 20', source: edgewise('erDiagram', 20, (a, b) => `${a.toUpperCase()} ||--o{ ${b.toUpperCase()} : r`), limit: 'ER_LABEL_WORK_LIMIT' },
  // Every relationship label collides with many others; seat search once
  // re-proved fixed clearances per conflict and sweep (~40 s).
  { name: 'C4 relationships between all pairs of 29 systems (406)', source: c4Systems(29) },
  { name: 'edges past the host limit', source: ['flowchart TD', ...Array.from({ length: 5001 }, () => 'A --> B')].join('\n'), limit: 'DIAGRAM_WORK_LIMIT' },
  // Overlapping routes share cells, and every shared cell's owner set grows
  // with each route through it; dense fans refuse once composing them passes
  // its ceiling. The complete DAG stays below it and renders.
  { name: 'terminal: all-to-all fan 30 x 30', source: fan(30), limit: 'TERMINAL_WORK_LIMIT', terminal: true },
  { name: 'terminal: all-to-all fan 50 x 50', source: fan(50), limit: 'TERMINAL_WORK_LIMIT', terminal: true },
  { name: 'terminal: complete DAG 30', source: completeDag(30), terminal: true },
  { name: 'terminal: chain 150 with long links', source: chainWithLongLinks(150), terminal: true },
  { name: 'terminal: class relationships 20 x 20', source: edgewise('classDiagram', 20, (a, b) => `${a} --> ${b}`), limit: 'TERMINAL_WORK_LIMIT', terminal: true },
  // Card routing widens its corridors until every relationship routes, within
  // one shared search ceiling: an all-pairs table of 10 entities renders; the
  // 400-relationship bipartite table and a one-column complete DAG of 12
  // requirements refuse with the typed limit instead of an unroutable edge.
  { name: 'terminal: ER all pairs of 10 entities', source: ['erDiagram', ...completeDag(10).split('\n').slice(1).map(line => line.replace(' --> ', ' ||--o{ ') + ' : r')].join('\n'), terminal: true },
  { name: 'terminal: ER relationships 20 x 20', source: edgewise('erDiagram', 20, (a, b) => `${a.toUpperCase()} ||--o{ ${b.toUpperCase()} : r`), limit: 'TERMINAL_WORK_LIMIT', terminal: true },
  { name: 'terminal: requirement complete DAG 12', source: ['requirementDiagram', ...names('r', 12).map(id => `requirement ${id} {\nid: ${id}\ntext: "${id}"\n}`), ...completeDag(12).split('\n').slice(1).map(line => line.replaceAll('k', 'r').replace(' --> ', ' - traces -> '))].join('\n'), limit: 'TERMINAL_WORK_LIMIT', terminal: true },
]

describe('worst-case layout inputs finish within a bounded time', () => {
  for (const { name, source, limit, terminal } of CASES) {
    test(name, () => {
      const started = performance.now()
      let outcome: string
      try {
        outcome = terminal
          ? renderMermaidASCII(source, { useAscii: true }).includes('+') ? 'rendered' : 'no frames'
          : renderMermaidSVG(source, { security: 'strict' }).startsWith('<svg') ? 'rendered' : 'not svg'
      } catch (error) {
        outcome = (error as { code?: string }).code ?? String(error)
        expect(projectRenderErrorDiagnostic(error, { source }).code).not.toBe('INTERNAL_ERROR')
      }
      const elapsed = performance.now() - started
      expect({ name, outcome }).toEqual({ name, outcome: limit ?? 'rendered' })
      expect(elapsed).toBeLessThan(BOUND_MS)
    }, BOUND_MS * 2)
  }
})
