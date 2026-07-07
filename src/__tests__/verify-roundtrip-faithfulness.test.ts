// Move 3 (promotion): CONTENT_DROPPED_ON_ROUNDTRIP verify lint.
//
// independentFaithfulness was a judge-only helper; it is now a Tier-3 verify
// lint that runs on every verifyMermaid, for every family, reusing the shared
// structural counter. These tests pin: (a) faithful diagrams across families do
// NOT emit it, (b) it is a lint that never flips verify.ok, and (c) it is wired
// into the warning vocabulary as lint/warning.

import { describe, test, expect } from 'bun:test'
import { parseMermaid, verifyMermaid } from '../agent/index.ts'
import { WARNING_TIER, WARNING_SEVERITY } from '../agent/types.ts'

const FAITHFUL: Record<string, string> = {
  flowchart: 'flowchart TD\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]\n  B -->|no| A',
  sequence: 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi\n  B-->>A: ok',
  class: 'classDiagram\n  class Animal\n  class Dog\n  Animal <|-- Dog',
  er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE : contains',
  state: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> [*]',
  pie: 'pie title Pets\n  "Dogs" : 40\n  "Cats" : 30',
}

describe('CONTENT_DROPPED_ON_ROUNDTRIP verify lint', () => {
  for (const [family, source] of Object.entries(FAITHFUL)) {
    test(`${family}: faithful diagram emits no faithfulness-drop lint`, () => {
      const p = parseMermaid(source)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      const v = verifyMermaid(p.value)
      const drops = v.warnings.filter(w => w.code === 'CONTENT_DROPPED_ON_ROUNDTRIP')
      expect(drops).toEqual([])
    })
  }

  test('it is registered as a lint that cannot flip verify.ok', () => {
    expect(WARNING_TIER.CONTENT_DROPPED_ON_ROUNDTRIP).toBe('lint')
    expect(WARNING_SEVERITY.CONTENT_DROPPED_ON_ROUNDTRIP).toBe('warning')
  })

  test('a clean flowchart verifies ok with the lint active', () => {
    const p = parseMermaid(FAITHFUL.flowchart!)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(verifyMermaid(p.value).ok).toBe(true)
  })

  // Move 6: an OPAQUE body (the wrapper's `before === null` branch) must never
  // produce a faithfulness drop — its faithfulness contract is byte-verbatim,
  // owned by the round-trip-stability gate. Exercises that wrapper branch
  // end-to-end through verify (an accTitle directive is unmodeled → opaque).
  test('an opaque body produces no faithfulness drop', () => {
    const p = parseMermaid('xychart-beta\n  accTitle: forces opaque\n  bar [1, 2, 3]')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('opaque')
    const drops = verifyMermaid(p.value).warnings.filter(w => w.code === 'CONTENT_DROPPED_ON_ROUNDTRIP')
    expect(drops).toEqual([])
  })
})
