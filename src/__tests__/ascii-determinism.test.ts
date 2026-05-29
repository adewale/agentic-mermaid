// Loop 7 bug 3.5: pathfinder determinism regression guard.
//
// The plan called for a 10-run byte-identity check on a fixture with multiple
// parallel edges. Probing the current code revealed the pathfinder IS already
// deterministic across 10 runs (probably because the A* priority queue uses
// stable index-based tie-breaks and the Set/Map iteration order in V8/Bun is
// insertion-ordered). The fix is therefore documented as a regression guard
// rather than a behaviour change — if anyone introduces a tie-break that
// depends on iteration of an unordered structure or on Math.random / Date.now,
// this test will catch it.

import { describe, it, expect } from 'bun:test'
import { renderMermaidAscii } from '../ascii/index.ts'
import { createHash } from 'node:crypto'

const FIXTURES: Array<{ name: string; src: string }> = [
  {
    name: 'fan-out fan-in (parallel edges)',
    src: `graph LR
  A --> B
  A --> C
  A --> D
  B --> E
  C --> E
  D --> E
  A --> E
`,
  },
  {
    name: 'cross-pattern routing (forces tie-break choices)',
    src: `graph TD
  A --> C
  A --> D
  B --> C
  B --> D
`,
  },
  {
    name: 'self-and-bidirectional edges',
    src: `graph LR
  A --> B
  B --> A
  A --> C
  C --> A
`,
  },
]

describe('ASCII pathfinder determinism', () => {
  for (const fx of FIXTURES) {
    it(`renders ${fx.name} byte-identically across 10 runs`, () => {
      const hashes = new Set<string>()
      for (let i = 0; i < 10; i++) {
        const out = renderMermaidAscii(fx.src, { useAscii: false })
        hashes.add(createHash('sha256').update(out).digest('hex'))
      }
      expect(hashes.size).toBe(1)
    })
  }

  it('ASCII mode also stays deterministic', () => {
    const src = FIXTURES[0]!.src
    const hashes = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const out = renderMermaidAscii(src, { useAscii: true })
      hashes.add(createHash('sha256').update(out).digest('hex'))
    }
    expect(hashes.size).toBe(1)
  })
})
