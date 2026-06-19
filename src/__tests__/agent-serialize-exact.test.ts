// Exact-string assertions for serialize.ts. Round-trip tests catch structural
// regressions; these kill mutation-testing survivors that produce parseable
// but subtly-wrong output. Targeted at the StringLiteral / ConditionalExpression
// clusters Stryker surfaced.

import { describe, test, expect } from 'bun:test'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'

function ser(src: string): string {
  const r = parseMermaid(src); if (!r.ok) throw new Error('parse')
  return serializeMermaid(r.value)
}

describe('frontmatter emission', () => {
  test('omits frontmatter when meta.frontmatter is empty', () => {
    const out = ser('flowchart TD\n  A --> B')
    expect(out.startsWith('---')).toBe(false)
    expect(out).not.toContain('---\n')
  })
  test('emits frontmatter only when present and non-empty', () => {
    const out = ser('---\ntitle: T\n---\nflowchart TD\n  A --> B')
    expect(out).toMatch(/^---\ntitle: T\n---\n/)
  })
  test('synthesizeFromGraph with empty meta does not emit `---`', () => {
    const r = synthesizeFromGraph({
      kind: 'flowchart',
      body: { kind: 'flowchart', graph: { direction: 'TD', nodes: { A: { id: 'A', label: 'A', shape: 'rectangle' } }, edges: [] } },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.canonicalSource).not.toContain('---')
  })
})

describe('init directive emission', () => {
  test('init directive line is preserved with trailing newline (trimEnd then `\\n`)', () => {
    const out = ser('%%{init: {"theme":"forest"}}%%\nflowchart TD\n  A --> B')
    expect(out).toContain('%%{init:')
    expect(out).toContain('}%%\n')
    // Belt-and-braces: not double-newlined, not missing the newline.
    expect(out).not.toContain('}%%\n\n')
  })
})

describe('flowchart trailing newline', () => {
  test('output ends with exactly one newline', () => {
    for (const src of ['flowchart TD\n  A --> B', 'flowchart LR\n  A --> B\n  B --> C']) {
      const out = ser(src)
      expect(out.endsWith('\n')).toBe(true)
      expect(out.endsWith('\n\n')).toBe(false)
    }
  })
})

describe('flowchart label escaping', () => {
  test('serializes line breaks as br tags and quoted bracket labels stably', () => {
    const out = ser('graph TD;A["chimpansen hoppar ()[]"] --> C(Chimpansen hoppar åäö  <br> -  ÅÄÖ);')
    expect(out).toContain('A["chimpansen hoppar ()[]"]')
    expect(out).toContain('C(Chimpansen hoppar åäö  <br> -  ÅÄÖ)')
    expect(ser(out)).toBe(out)
  })
})

describe('opaque body trailing newline', () => {
  test('opaque body without trailing newline gets one appended', () => {
    // synthesizeFromGraph an opaque body without trailing newline
    const r = synthesizeFromGraph({
      kind: 'class',
      body: { kind: 'opaque', family: 'class', source: 'classDiagram\n  A <|-- B' }, // no trailing \n
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.canonicalSource.endsWith('\n')).toBe(true)
  })
  test('opaque body already ending with newline is left alone (no double newline)', () => {
    const r = synthesizeFromGraph({
      kind: 'class',
      body: { kind: 'opaque', family: 'class', source: 'classDiagram\n  A <|-- B\n' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.canonicalSource.endsWith('\n')).toBe(true)
    expect(r.value.canonicalSource.endsWith('\n\n')).toBe(false)
  })
})

describe('sequence participant tag emission', () => {
  test('actor variant emits the literal `actor` keyword', () => {
    const out = ser('sequenceDiagram\n  actor A as Alice\n  A->>B: Hi')
    expect(out).toContain('actor A')
    expect(out).not.toContain('participant A as Alice')
  })
  test('participant variant emits literal `participant`', () => {
    const out = ser('sequenceDiagram\n  participant A as Alice\n  A->>B: Hi')
    expect(out).toContain('participant A')
    expect(out).not.toContain('actor A')
  })
  test('alias form: `as Label` literal', () => {
    const out = ser('sequenceDiagram\n  participant A as Alice\n  A->>B: Hi')
    expect(out).toContain(' as Alice')
  })
  test('no alias when label === id (no spurious `as`)', () => {
    const out = ser('sequenceDiagram\n  A->>B: Hi')
    expect(out).not.toContain(' as A')
    expect(out).not.toContain(' as B')
  })
})

describe('sequence arrow literal forms', () => {
  // Every style → exact arrow string. Kills the case-literal mutants Stryker found.
  const cases: Array<[string, string]> = [
    ['->>', '->>'],
    ['-->>', '-->>'],
    ['->', '->'],
    ['-->', '-->'],
    ['-x', '-x'],
    ['--x', '--x'],
  ]
  for (const [inArrow, outArrow] of cases) {
    test(`${inArrow} ↔ ${outArrow} preserved`, () => {
      const out = ser(`sequenceDiagram\n  A ${inArrow} B: Hi`)
      expect(out).toContain(`A${outArrow}B: Hi`)
    })
  }
})

describe('flowchart edge literal forms', () => {
  // Same idea for the flowchart edge style emission.
  const cases: Array<[string, string]> = [
    ['-->', '-->'],
    ['---', '---'],
    ['-.->', '-.->'],
    ['-.-', '-.-'],
    ['==>', '==>'],
    ['===', '==='],
    ['--o', '--o'],
    ['--x', '--x'],
    ['<-->', '<-->'],
  ]
  for (const [inEdge, outEdge] of cases) {
    test(`${inEdge} preserved literally`, () => {
      const out = ser(`flowchart TD\n  A ${inEdge} B`)
      expect(out).toContain(`A ${outEdge} B`)
    })
  }
})

describe('flowchart shape literal forms', () => {
  const cases: Array<[string, string]> = [
    ['A[X]', 'A[X]'],
    ['A(X)', 'A(X)'],
    ['A([X])', 'A([X])'],
    ['A[[X]]', 'A[[X]]'],
    ['A[(X)]', 'A[(X)]'],
    ['A((X))', 'A((X))'],
    ['A(((X)))', 'A(((X)))'],
    ['A{X}', 'A{X}'],
    ['A{{X}}', 'A{{X}}'],
  ]
  for (const [shape, expected] of cases) {
    test(`${shape} preserved`, () => {
      const out = ser(`flowchart TD\n  ${shape} --> B`)
      expect(out).toContain(expected)
    })
  }
})

describe('subgraph keyword and indent emitted literally', () => {
  test('`subgraph` keyword, `end` terminator, 4-space inner indent', () => {
    const out = ser('flowchart TD\n  subgraph G\n    A --> B\n  end\n  B --> C')
    expect(out).toContain('  subgraph G\n')
    expect(out).toMatch(/\n {4}A\n/)
    expect(out).toMatch(/\n {4}B\n/)
    expect(out).toContain('  end')
  })
})

describe('styleProp emission', () => {
  test('classDef literal keyword + comma-separated props', () => {
    const out = ser('flowchart TD\n  A --> B\n  classDef hot fill:#f00,stroke:#0f0')
    expect(out).toContain('classDef hot fill:#f00,stroke:#0f0')
  })
  test('class assignment literal `class` keyword', () => {
    const out = ser('flowchart TD\n  A --> B\n  classDef hot fill:#f00\n  class A hot')
    expect(out).toContain('class A hot')
  })
  test('style literal `style` keyword', () => {
    const out = ser('flowchart TD\n  A --> B\n  style A fill:#0f0')
    expect(out).toContain('style A fill:#0f0')
  })
  test('linkStyle literal keyword + index', () => {
    const out = ser('flowchart TD\n  A --> B\n  linkStyle 0 stroke:#f00')
    expect(out).toContain('linkStyle 0 stroke:#f00')
  })
})
