// Determinism grid + drift sentinel.
//
// The grid sweeps direction × node-count × density and asserts that running
// verify twice on the same source produces byte-identical layout JSON.
//
// The drift sentinel commits a small set of canonical layout JSONs and asserts
// they don't change without an explicit acknowledgment (regenerate by running
// `bun test --update-snapshots`).

import { describe, test, expect } from 'bun:test'
import { verifyMermaid } from '../agent/verify.ts'

const DIRECTIONS = ['TD', 'BT', 'LR', 'RL'] as const
const NODE_COUNTS = [2, 3, 5, 8]
const DENSITY: Array<'sparse' | 'dense'> = ['sparse', 'dense']

function makeDiagram(direction: string, n: number, density: 'sparse' | 'dense'): string {
  const ids = Array.from({ length: n }, (_, i) => `N${i}`)
  const lines = [`flowchart ${direction}`]
  // Sparse: chain. Dense: chain + every node connects to N0.
  for (let i = 0; i < n - 1; i++) {
    lines.push(`  ${ids[i]} --> ${ids[i + 1]}`)
  }
  if (density === 'dense') {
    for (let i = 2; i < n; i++) {
      lines.push(`  ${ids[0]} --> ${ids[i]}`)
    }
  }
  return lines.join('\n')
}

describe('determinism grid', () => {
  for (const dir of DIRECTIONS) {
    for (const n of NODE_COUNTS) {
      for (const density of DENSITY) {
        test(`flowchart ${dir} ${n} nodes ${density}: layout JSON is identical across runs`, () => {
          const src = makeDiagram(dir, n, density)
          const a = verifyMermaid(src).layout
          const b = verifyMermaid(src).layout
          expect(JSON.stringify(b)).toEqual(JSON.stringify(a))
        })
      }
    }
  }
})

// ---- Drift sentinel ------------------------------------------------------
//
// A small set of hand-picked diagrams whose canonical layout JSON we want to
// pin. We use bun:test's toMatchSnapshot here; any drift fails CI and a human
// has to look at the change before updating.

describe('drift sentinel', () => {
  const SENTINELS = [
    'flowchart TD\n  A --> B',
    'flowchart LR\n  A --> B\n  B --> C',
    'flowchart TD\n  A[Alpha] --> B[Beta]\n  B --> C[Gamma]',
    'flowchart TD\n  A{Decision} --> B[Yes]\n  A --> C[No]',
    'flowchart LR\n  A --> B\n  A --> C\n  B --> D\n  C --> D',
    'flowchart TD\n  A((Start)) --> B[Step]\n  B --> C((End))',
    'flowchart TD\n  A --> B\n  B --> C\n  C --> A',
    'flowchart LR\n  A1 --> A2\n  A2 --> A3\n  A3 --> A4\n  A4 --> A5',
  ]
  for (const src of SENTINELS) {
    test(`sentinel: ${src.replace(/\n/g, ' / ').slice(0, 60)}`, () => {
      const layout = verifyMermaid(src).layout
      expect(layout).toMatchSnapshot()
    })
  }
})
