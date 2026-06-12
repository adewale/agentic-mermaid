// Phase A regression: opaque-body parse → serialize must preserve original
// indentation, blank lines, and comments. Without this, an agent that calls
// `parseMermaid → serializeMermaid` on architecture or any opaque fallback
// (including unmodeled journey / xychart / sequence constructs) silently loses formatting.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'

describe('opaque-body fidelity (indentation + blank lines)', () => {
  // NOTE: xychart and any unmodeled syntax (here: architecture accTitle +
  // {group} boundary edges) are source-level in the agent surface; the
  // journey / architecture / class / ER structured subsets are covered elsewhere.
  const cases: Array<[string, string]> = [
    ['journey-opaque', `journey
  title My day
  section Morning
    Wake up: 3: Me
    Coffee: 5: Me
  click task href`],
    ['xychart-opaque', `xychart-beta
  title "Revenue"
  x-axis [jan, feb, mar]
  y-axis "USD" 0 --> 100
  bar [10, 50, 90]
  curve basis`],
    // Unmodeled syntax (accTitle + the {group} boundary modifier) keeps this
    // architecture sample on the opaque path even after BUILD-17 promoted the
    // structured subset.
    ['architecture-opaque (accTitle + {group} boundary)', `architecture-beta
  accTitle: System overview
  group api(cloud)[API]
  service db(database)[DB] in api
  service web(server)[Web] in api
  web{group}:R --> L:db`],
    // A stray `end` keeps this sample on the whole-body opaque path — it can't
    // be cleanly segmented, so the lossless v4 fallback still applies.
    ['sequence-opaque (unbalanced end)', `sequenceDiagram
  participant A
  A->>B: ping
  end`],
  ]

  for (const [name, src] of cases) {
    test(`${name}: serialize(parse(src)) preserves indentation`, () => {
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      expect(p.value.body.kind).toBe('opaque')
      const out = serializeMermaid(p.value).trimEnd()
      expect(out).toBe(src.trimEnd())
    })

    test(`${name}: round-trip stable (parse(serialize(x)) → same serialize)`, () => {
      const p1 = parseMermaid(src)
      expect(p1.ok).toBe(true)
      if (!p1.ok) return
      const s1 = serializeMermaid(p1.value)
      const p2 = parseMermaid(s1)
      expect(p2.ok).toBe(true)
      if (!p2.ok) return
      expect(serializeMermaid(p2.value)).toBe(s1)
    })
  }

  // BUILD-18: the alt/activate/Note sample that used to go whole-body opaque
  // now parses structured-with-segments — but the verbatim fidelity assertion
  // is unchanged: every original line round-trips byte-for-byte.
  test('sequence-with-segments (alt/activate/Note): structured yet verbatim-lossless', () => {
    const src = `sequenceDiagram
  participant A
  participant B
  Note over A: setup
  A->>B: ping
  activate B
  alt success
    B-->>A: ok
  else failure
    B-->>A: nope
  end
  deactivate B`
    const p = parseMermaid(src)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('sequence')        // structured, not opaque
    const out = serializeMermaid(p.value).trimEnd()
    expect(out).toBe(src.trimEnd())                   // verbatim-lossless
    // The opaque alt/Note lines stay byte-for-byte; structured ops still apply.
    expect(out).toContain('  alt success\n    B-->>A: ok\n  else failure')
  })

  test('frontmatter + indented opaque body (journey): both preserved', () => {
    const src = `---
title: Coffee day
---
journey
  title My day
  section Morning
    Wake up: 3: Me
  click task href`
    const p = parseMermaid(src)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.body.kind).toBe('opaque')
    const out = serializeMermaid(p.value)
    expect(out).toContain('  section Morning')
    expect(out).toContain('    Wake up: 3: Me')
    expect(out).toContain('title: Coffee day')
  })
})
