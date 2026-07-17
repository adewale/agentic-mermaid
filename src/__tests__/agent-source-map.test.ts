import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { mutate } from '../agent/mutate.ts'
import type { SourceSpan } from '../agent/types.ts'
import { sourcePreservationSpans } from '../family-detection.ts'

function textAt(source: string, span: SourceSpan | undefined): string | undefined {
  return span ? source.slice(span.start.offset, span.end.offset) : undefined
}

describe('flowchart SourceMap', () => {
  test('maps nodes, edges, groups, and labels to source locations', () => {
    const source = `flowchart LR
  subgraph Auth[Auth Layer]
    A[Login]
    B{MFA?}
  end
  A -->|yes| B
  B -- no --> A
`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // SourceMap locations are over canonical normalized Mermaid source (the
    // current parser trims body indentation before structured parsing).
    expect(parsed.value.source.nodes.get('A')).toEqual({ line: 3, col: 1 })
    expect(parsed.value.source.nodes.get('B')).toEqual({ line: 4, col: 1 })
    expect(parsed.value.source.groups.get('Auth')).toEqual({ line: 2, col: 10 })
    expect(parsed.value.source.labels.get('node:A')).toEqual({ line: 3, col: 3 })
    expect(parsed.value.source.labels.get('group:Auth')).toEqual({ line: 2, col: 15 })
    expect(parsed.value.source.edges.get('edge#0:A->B')).toEqual({ line: 6, col: 1 })
    expect(parsed.value.source.labels.get('edge#0:A->B')).toEqual({ line: 6, col: 7 })
    expect(parsed.value.source.edges.get('edge#1:B->A')).toEqual({ line: 7, col: 1 })
  })

  test('maps edge and node labels after the id/operator when text repeats endpoint ids', () => {
    const parsed = parseMermaid(`flowchart LR
  A[A] -->|A| B
`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.value.source.labels.get('node:A')).toEqual({ line: 2, col: 3 })
    expect(parsed.value.source.labels.get('edge#0:A->B')).toEqual({ line: 2, col: 10 })
  })

  test('class/ER/chart/Gantt traceability maps members, attrs, cardinalities, marks, and tasks', () => {
    const cls = parseMermaid(`classDiagram
  class Animal {
    +String name
  }
  Animal "1" --> "*" Dog : owns
`)
    expect(cls.ok).toBe(true)
    if (!cls.ok) return
    expect(cls.value.source.labels.get('class:Animal:member#0')).toEqual({ line: 3, col: 1 })
    expect(cls.value.source.labels.get('rel#0:Animal->Dog:fromCardinality')).toEqual({ line: 5, col: 9 })
    expect(cls.value.source.labels.get('rel#0:Animal->Dog:toCardinality')).toEqual({ line: 5, col: 17 })

    const er = parseMermaid(`erDiagram
  CUSTOMER {
    string email PK
  }
  CUSTOMER ||--o{ ORDER : places
`)
    expect(er.ok).toBe(true)
    if (!er.ok) return
    expect(er.value.source.labels.get('er:CUSTOMER:attr#0')).toEqual({ line: 3, col: 1 })
    expect(er.value.source.labels.get('rel#0:CUSTOMER->ORDER:leftCardinality')).toEqual({ line: 5, col: 10 })
    expect(er.value.source.labels.get('rel#0:CUSTOMER->ORDER:rightCardinality')).toEqual({ line: 5, col: 14 })

    const chart = parseMermaid(`xychart-beta
  x-axis [Jan, Feb]
  bar Sales [3, 7]
`)
    expect(chart.ok).toBe(true)
    if (!chart.ok) return
    expect(chart.value.source.labels.get('xychart:series-0:name')).toEqual({ line: 3, col: 5 })
    expect(chart.value.source.labels.get('xychart:series-0:point#1')).toEqual({ line: 3, col: 15 })

    const gantt = parseMermaid(`gantt
  section Build
    Core engine :core, 2024-01-01, 2d
`)
    expect(gantt.ok).toBe(true)
    if (!gantt.ok) return
    expect(gantt.value.source.groups.get('section-0')).toEqual({ line: 2, col: 9 })
    expect(gantt.value.source.nodes.get('core')).toEqual({ line: 3, col: 1 })
    expect(gantt.value.source.labels.get('gantt:task:core')).toEqual({ line: 3, col: 1 })
  })

  test('retains exact authored wrapper/directive, statement, and sub-statement spans', () => {
    const source = `---
theme: base
---
%%{init: {"flowchart": {"curve": "linear"}}}%%
%% leading comment
flowchart LR
  accTitle: Sign in flow
    A[Login] -->|yes| B[Done]
`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const spans = parsed.value.source.spans
    expect(spans).toBeDefined()
    if (!spans) return
    expect(textAt(source, spans.preserved.source)).toBe(source)
    expect(textAt(source, spans.preserved.frontmatter)).toBe('---\ntheme: base\n---\n')
    expect(textAt(source, spans.preserved.initDirectives?.[0])).toBe('%%{init: {"flowchart": {"curve": "linear"}}}%%\n')
    expect(textAt(source, spans.preserved.accessibilityDirectives?.[0])).toBe('  accTitle: Sign in flow\n')
    expect(textAt(source, spans.preserved.header)).toBe('flowchart LR')
    expect(textAt(source, spans.nodes.get('A'))).toBe('A[Login] -->|yes| B[Done]')
    expect(textAt(source, spans.edges.get('edge#0:A->B'))).toBe('A[Login] -->|yes| B[Done]')
    expect(textAt(source, spans.labels.get('node:A'))).toBe('Login')
    expect(textAt(source, spans.labels.get('edge#0:A->B'))).toBe('yes')
  })

  test('traces admitted init directives outside the leading wrapper', () => {
    const source = `flowchart LR
  A
  %%{initialize: {"theme": "dark"}}%%
  B`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.value.meta.initDirectives).toHaveLength(1)
    expect(parsed.value.source.spans?.preserved.initDirectives).toHaveLength(1)
    expect(textAt(source, parsed.value.source.spans?.preserved.initDirectives?.[0]))
      .toBe('  %%{initialize: {"theme": "dark"}}%%\n')
  })

  test('does not confuse accessibility prose with semantic statements', () => {
    const source = 'flowchart LR\naccDescr: A links to B\nA[Actual] --> B'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(textAt(source, parsed.value.source.spans?.nodes.get('A'))).toBe('A[Actual] --> B')
    expect(textAt(source, parsed.value.source.spans?.nodes.get('B'))).toBe('A[Actual] --> B')
    expect(parsed.value.source.nodes.get('A')).toEqual({ line: 3, col: 1 })
  })

  test('separates semicolon statements and preserves commas inside labels', () => {
    const source = 'flowchart LR\n  A[Hello, world]; B[Two]; A --> B'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const spans = parsed.value.source.spans!
    expect(textAt(source, spans.nodes.get('A'))).toBe('A[Hello, world]')
    expect(textAt(source, spans.nodes.get('B'))).toBe('B[Two]')
    expect(textAt(source, spans.edges.get('edge#0:A->B'))).toBe('A --> B')
    expect(textAt(source, spans.labels.get('node:A'))).toBe('Hello, world')
  })

  test('maps duplicate chart values to distinct authored occurrences', () => {
    const source = 'xychart-beta\n  x-axis [A, B, C]\n  line [10, 10, 20]'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const spans = parsed.value.source.spans!.labels
    const first = spans.get('xychart:series-0:point#0')!
    const second = spans.get('xychart:series-0:point#1')!
    expect(textAt(source, first)).toBe('10')
    expect(textAt(source, second)).toBe('10')
    expect(second.start.offset).toBeGreaterThan(first.end.offset)
  })

  test('anchors authored mapping after frontmatter and excludes wrapper pseudo-directives', () => {
    const source = `---
description: |
  flowchart LR
  A[Fake] --> B
  accTitle: YAML only
---
flowchart LR
  accDescr: {
    Actual description
  }
  A[Real] --> B
`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const spans = parsed.value.source.spans!
    expect(textAt(source, spans.nodes.get('A'))).toBe('A[Real] --> B')
    expect(spans.preserved.accessibilityDirectives).toHaveLength(1)
    expect(textAt(source, spans.preserved.accessibilityDirectives?.[0])).toContain('Actual description')
  })

  test('excludes YAML lookalikes from init directives and keeps accDescr suffix statements exact', () => {
    const source = `---
description: |
  %%{init: {theme: dark}}%%
---
%%{init: {theme: base}}%%
flowchart LR
accDescr: {
  A[Fake] prose
} A[Real] --> B
`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const spans = parsed.value.source.spans!
    expect(spans.preserved.initDirectives).toHaveLength(1)
    expect(textAt(source, spans.preserved.initDirectives?.[0])).toContain('theme: base')
    expect(textAt(source, spans.preserved.accessibilityDirectives?.[0])).toBe('accDescr: {\n  A[Fake] prose\n}')
    expect(textAt(source, spans.nodes.get('A'))).toBe('A[Real] --> B')
    expect(textAt(source, spans.edges.get('edge#0:A->B'))).toBe('A[Real] --> B')

    const inline = 'flowchart LR\naccDescr: {inline } A[Real] --> B'
    const inlineParsed = parseMermaid(inline)
    expect(inlineParsed.ok).toBe(true)
    if (inlineParsed.ok) expect(textAt(inline, inlineParsed.value.source.spans!.nodes.get('A'))).toBe('A[Real] --> B')
  })

  test('separates a same-line family header from its authored body statement', () => {
    const source = 'flowchart LR; A[One] --> B[Two]'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const spans = parsed.value.source.spans!
    expect(textAt(source, spans.preserved.header)).toBe('flowchart LR')
    expect(textAt(source, spans.preserved.body)).toBe('A[One] --> B[Two]')
    expect(textAt(source, spans.nodes.get('A'))).toBe('A[One] --> B[Two]')

    const encoded = 'flowchart&#32;LR; A --> B'
    const encodedParsed = parseMermaid(encoded)
    expect(encodedParsed.ok).toBe(true)
    if (encodedParsed.ok) {
      expect(textAt(encoded, encodedParsed.value.source.spans!.preserved.header)).toBe('flowchart&#32;LR')
      expect(textAt(encoded, encodedParsed.value.source.spans!.preserved.body)).toBe('A --> B')
    }
  })

  test('maps duplicate indexed objects to their distinct authored occurrences', () => {
    const flow = `flowchart LR
 A --> B
 A --> B`
    const flowParsed = parseMermaid(flow)
    expect(flowParsed.ok).toBe(true)
    if (!flowParsed.ok) return
    const firstEdge = flowParsed.value.source.spans!.edges.get('edge#0:A->B')!
    const secondEdge = flowParsed.value.source.spans!.edges.get('edge#1:A->B')!
    expect(firstEdge.start.line).toBe(2)
    expect(secondEdge.start.line).toBe(3)

    const mixed = `flowchart LR
 A -->|named| B
 A --> B`
    const mixedParsed = parseMermaid(mixed)
    expect(mixedParsed.ok).toBe(true)
    if (mixedParsed.ok) {
      expect(mixedParsed.value.source.spans!.edges.get('edge#0:A->B')!.start.line).toBe(2)
      expect(mixedParsed.value.source.spans!.edges.get('edge#1:A->B')!.start.line).toBe(3)
    }

    const targetNamedLabel = `flowchart LR
 A -- B --> B
 A --> B`
    const targetNamedParsed = parseMermaid(targetNamedLabel)
    expect(targetNamedParsed.ok).toBe(true)
    if (targetNamedParsed.ok) {
      expect(textAt(targetNamedLabel, targetNamedParsed.value.source.spans!.edges.get('edge#0:A->B'))).toBe('A -- B --> B')
      expect(textAt(targetNamedLabel, targetNamedParsed.value.source.spans!.edges.get('edge#1:A->B'))).toBe('A --> B')
    }

    for (const marker of ['x', 'o'] as const) {
      const marked = `flowchart LR\n A -- B --${marker} B\n A --${marker} B`
      const markedParsed = parseMermaid(marked)
      expect(markedParsed.ok).toBe(true)
      if (markedParsed.ok) {
        expect(textAt(marked, markedParsed.value.source.spans!.edges.get('edge#0:A->B'))).toBe(`A -- B --${marker} B`)
        expect(textAt(marked, markedParsed.value.source.spans!.edges.get('edge#1:A->B'))).toBe(`A --${marker} B`)
      }
    }

    const xy = 'xychart-beta\n line [10,20]\n line [30,40]'
    const xyParsed = parseMermaid(xy)
    expect(xyParsed.ok).toBe(true)
    if (xyParsed.ok) {
      expect(textAt(xy, xyParsed.value.source.spans!.labels.get('xychart:series-0:point#0'))).toBe('10')
      expect(textAt(xy, xyParsed.value.source.spans!.labels.get('xychart:series-1:point#0'))).toBe('30')
    }

    const pie = 'pie\n "Same": 1\n "Same": 2'
    const pieParsed = parseMermaid(pie)
    expect(pieParsed.ok).toBe(true)
    if (pieParsed.ok) {
      expect(pieParsed.value.source.spans!.labels.get('pie:slice#0')!.start.line).toBe(2)
      expect(pieParsed.value.source.spans!.labels.get('pie:slice#1')!.start.line).toBe(3)
    }

    const piePrefix = 'pie\n "AA": 1\n "A": 2'
    const piePrefixParsed = parseMermaid(piePrefix)
    expect(piePrefixParsed.ok).toBe(true)
    if (piePrefixParsed.ok) {
      expect(textAt(piePrefix, piePrefixParsed.value.source.spans!.labels.get('pie:slice#0'))).toBe('AA')
      expect(textAt(piePrefix, piePrefixParsed.value.source.spans!.labels.get('pie:slice#1'))).toBe('A')
      expect(piePrefixParsed.value.source.spans!.labels.get('pie:slice#1')!.start.line).toBe(3)
    }

    for (const [source, keys] of [
      ['classDiagram\n class A {\n +x\n +x\n }', ['class:A:member#0', 'class:A:member#1']],
      ['erDiagram\n A {\n string x\n string x\n }', ['er:A:attr#0', 'er:A:attr#1']],
      ['gantt\n dateFormat YYYY-MM-DD\n Same :a, 2024-01-01, 1d\n Same :b, 2024-01-01, 1d', ['gantt:task:a', 'gantt:task:b']],
    ] as const) {
      const item = parseMermaid(source)
      expect(item.ok).toBe(true)
      if (item.ok) {
        const first = item.value.source.spans!.labels.get(keys[0])!
        const second = item.value.source.spans!.labels.get(keys[1])!
        expect(second.start.line).toBeGreaterThan(first.start.line)
      }
    }
  })

  test('keeps pipe-label semicolons inside statements and maps exact chart tokens', () => {
    const flow = 'flowchart LR\n A[one] -->|x; y| B; C[three]'
    const parsed = parseMermaid(flow)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(textAt(flow, parsed.value.source.spans!.edges.get('edge#0:A->B'))).toBe('A[one] -->|x; y| B')
    expect(textAt(flow, parsed.value.source.spans!.labels.get('edge#0:A->B'))).toBe('x; y')
    expect(textAt(flow, parsed.value.source.spans!.nodes.get('C'))).toBe('C[three]')

    for (const [source, key, expected] of [
      ['pie\n "pie": 1', 'pie:slice#0', 'pie'],
      ['quadrantChart\n quadrant: [0.2,0.3]', 'quadrant:point#0', 'quadrant'],
      ['radar-beta\n axis a["Same"], b["Same"]\n curve c{1,2}', 'radar:axis#0', 'a'],
      ['radar-beta\n axis a["Same"], b["Same"]\n curve c{1,2}', 'radar:curve#0', 'c'],
      ['gantt\n dateFormat YYYY-MM-DD\n section S\n Same :a, 2024-01-01, 1d', 'gantt:task:a', 'Same'],
    ] as const) {
      const item = parseMermaid(source)
      expect(item.ok).toBe(true)
      if (item.ok) expect(textAt(source, item.value.source.spans!.labels.get(key))).toBe(expected)
    }
  })

  test('rebuilds source maps after mutation instead of retaining removed objects', () => {
    const parsed = parseMermaid('flowchart LR\n A[Old] --> B')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const changed = mutate(parsed.value, { kind: 'remove_node', id: 'A' })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changed.value.source.nodes.has('A')).toBe(false)
    expect(changed.value.source.spans!.nodes.has('A')).toBe(false)
    expect(textAt(changed.value.canonicalSource, changed.value.source.spans!.preserved.source)).toBe(changed.value.canonicalSource)
  })

  test('keeps bare text-arrow semicolons and accDescr suffix shapes inside exact statements', () => {
    const flow = 'flowchart LR\n A -- x;y;z --> B; B --> C'
    const parsed = parseMermaid(flow)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(textAt(flow, parsed.value.source.spans!.edges.get('edge#0:A->B'))).toBe('A -- x;y;z --> B')
    expect(textAt(flow, parsed.value.source.spans!.labels.get('edge#0:A->B'))).toBe('x;y;z')
    expect(textAt(flow, parsed.value.source.spans!.edges.get('edge#1:B->C'))).toBe('B --> C')

    const accessibility = 'flowchart LR\naccDescr: {\n prose\n} A{Decision} --> B'
    const accessible = parseMermaid(accessibility)
    expect(accessible.ok).toBe(true)
    if (!accessible.ok) return
    expect(textAt(accessibility, accessible.value.source.spans!.nodes.get('A'))).toBe('A{Decision} --> B')
    expect(textAt(accessibility, accessible.value.source.spans!.nodes.get('B'))).toBe('A{Decision} --> B')
  })

  test('scopes class and ER source maps to declarations, members, relations, and full cardinalities', () => {
    const cls = `classDiagram
 note "A B"
 note "+x"
 class A {
 +x
 }
 A "one" --> "many" B`
    const classParsed = parseMermaid(cls)
    expect(classParsed.ok).toBe(true)
    if (!classParsed.ok) return
    const classSpans = classParsed.value.source.spans!
    expect(textAt(cls, classSpans.nodes.get('A'))).toBe('class A {')
    expect(textAt(cls, classSpans.nodes.get('B'))).toBe('A "one" --> "many" B')
    expect(textAt(cls, classSpans.labels.get('class:A:member#0'))).toBe('+x')
    expect(textAt(cls, classSpans.edges.get('rel#0:A->B'))).toBe('A "one" --> "many" B')
    expect(textAt(cls, classSpans.labels.get('rel#0:A->B:fromCardinality'))).toBe('one')
    expect(textAt(cls, classSpans.labels.get('rel#0:A->B:toCardinality'))).toBe('many')

    const duplicateCards = 'classDiagram\n A "1" --> "1" B'
    const duplicateParsed = parseMermaid(duplicateCards)
    expect(duplicateParsed.ok).toBe(true)
    if (duplicateParsed.ok) {
      const from = duplicateParsed.value.source.spans!.labels.get('rel#0:A->B:fromCardinality')!
      const to = duplicateParsed.value.source.spans!.labels.get('rel#0:A->B:toCardinality')!
      expect(textAt(duplicateCards, from)).toBe('1')
      expect(textAt(duplicateCards, to)).toBe('1')
      expect(to.start.offset).toBeGreaterThan(from.end.offset)
    }

    const er = `erDiagram
 A ||--o{ B : string x
 A {
 string x
 }
 B`
    const erParsed = parseMermaid(er)
    expect(erParsed.ok).toBe(true)
    if (!erParsed.ok) return
    const erSpans = erParsed.value.source.spans!
    expect(textAt(er, erSpans.nodes.get('A'))).toBe('A {')
    expect(textAt(er, erSpans.nodes.get('B'))).toBe('B')
    expect(textAt(er, erSpans.labels.get('er:A:attr#0'))).toBe('string x')
    expect(textAt(er, erSpans.edges.get('rel#0:A->B'))).toBe('A ||--o{ B : string x')

    const compact = 'classDiagram\n namespace X { class A; class B; A --> B }'
    const compactParsed = parseMermaid(compact)
    expect(compactParsed.ok).toBe(true)
    if (compactParsed.ok) {
      expect(compactParsed.value.source.nodes.get('A')?.line).toBe(2)
      expect(compactParsed.value.source.nodes.get('B')?.line).toBe(2)
      expect(compactParsed.value.source.edges.get('rel#0:A->B')?.line).toBe(2)
      expect(compactParsed.value.source.spans?.nodes.has('A')).toBe(true)
      expect(compactParsed.value.source.spans?.edges.has('rel#0:A->B')).toBe(true)
      expect(textAt(compact, compactParsed.value.source.spans?.nodes.get('A'))).toBe('class A')
      expect(textAt(compact, compactParsed.value.source.spans?.nodes.get('B'))).toBe('class B')
      expect(textAt(compact, compactParsed.value.source.spans?.edges.get('rel#0:A->B'))).toBe('A --> B')
    }
  })

  test('does not map flowchart nodes to family-header or label tokens', () => {
    const source = `flowchart LR
 LR --> A
 X[B]; X -- A --> A; B --> C`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.value.source.nodes.get('LR')).toEqual({ line: 2, col: 1 })
    expect(textAt(source, parsed.value.source.spans?.nodes.get('LR'))).toBe('LR --> A')
    expect(parsed.value.source.nodes.get('A')).toEqual({ line: 2, col: 8 })
    expect(textAt(source, parsed.value.source.spans?.nodes.get('B'))).toBe('B --> C')
  })

  test('maps compact edge endpoints without confusing hyphenated ids', () => {
    for (const [source, expected] of [
      ['flowchart LR\nA-->B', ['A', 'B']],
      ['flowchart LR\nA---B', ['A', 'B']],
      ['flowchart LR\nfoo-bar-->baz\nbar', ['foo-bar', 'baz', 'bar']],
    ] as const) {
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect([...parsed.value.source.nodes.keys()].sort()).toEqual([...expected].sort())
      expect(parsed.value.source.nodes.get(expected[0])?.line).toBe(2)
    }

    const hyphenated = 'flowchart LR\nfoo--bar\nfoo\nbar'
    const hyphenatedParsed = parseMermaid(hyphenated)
    expect(hyphenatedParsed.ok).toBe(true)
    if (hyphenatedParsed.ok) {
      expect(hyphenatedParsed.value.source.nodes.get('foo--bar')).toEqual({ line: 2, col: 1 })
      expect(hyphenatedParsed.value.source.nodes.get('foo')).toEqual({ line: 3, col: 1 })
      expect(hyphenatedParsed.value.source.nodes.get('bar')).toEqual({ line: 4, col: 1 })
      expect(textAt(hyphenated, hyphenatedParsed.value.source.spans!.nodes.get('bar'))).toBe('bar')
    }

    const marked = `flowchart LR
x-->A
o==>B
C--xD
E--oF
Go--xH`
    const markedParsed = parseMermaid(marked)
    expect(markedParsed.ok).toBe(true)
    if (markedParsed.ok) {
      expect([...markedParsed.value.source.nodes.keys()].sort())
        .toEqual(['x', 'A', 'o', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].sort())
      for (const [key, statement] of [
        ['edge#0:x->A', 'x-->A'],
        ['edge#1:o->B', 'o==>B'],
        ['edge#2:C->D', 'C--xD'],
        ['edge#3:E->F', 'E--oF'],
        ['edge#4:G->H', 'Go--xH'],
      ] as const) {
        expect(textAt(marked, markedParsed.value.source.spans!.edges.get(key))).toBe(statement)
      }
    }

    const sourceMarkers = `flowchart LR
A o--x B
o
A x--o B
x`
    const sourceMarkersParsed = parseMermaid(sourceMarkers)
    expect(sourceMarkersParsed.ok).toBe(true)
    if (sourceMarkersParsed.ok) {
      expect(sourceMarkersParsed.value.source.nodes.get('o')).toEqual({ line: 3, col: 1 })
      expect(sourceMarkersParsed.value.source.nodes.get('x')).toEqual({ line: 5, col: 1 })
      expect(textAt(sourceMarkers, sourceMarkersParsed.value.source.spans!.nodes.get('o'))).toBe('o')
      expect(textAt(sourceMarkers, sourceMarkersParsed.value.source.spans!.nodes.get('x'))).toBe('x')
    }

    for (const statement of [
      'A-->|L|x--xB',
      'A-->|L|o--oB',
      'A-.->|L|x--xB',
      'A==>|L|o--oB',
    ]) {
      const source = `flowchart LR\n${statement}`
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const endpoint = statement.includes('|x') ? 'x' : 'o'
      expect(parsed.value.source.nodes.get(endpoint)).toEqual({ line: 2, col: statement.indexOf(endpoint) + 1 })
      expect(parsed.value.source.edges.has(`edge#0:A->${endpoint}`)).toBe(true)
      expect(parsed.value.source.edges.has(`edge#1:${endpoint}->B`)).toBe(true)
      expect(textAt(source, parsed.value.source.spans!.labels.get(`edge#0:A->${endpoint}`))).toBe('L')
    }

    const compactLabel = `flowchart LR
A--lab-->B
A-->B
lab`
    const compactLabelParsed = parseMermaid(compactLabel)
    expect(compactLabelParsed.ok).toBe(true)
    if (compactLabelParsed.ok) {
      expect(compactLabelParsed.value.source.nodes.get('lab')).toEqual({ line: 4, col: 1 })
      expect(textAt(compactLabel, compactLabelParsed.value.source.spans!.edges.get('edge#0:A->B'))).toBe('A--lab-->B')
      expect(textAt(compactLabel, compactLabelParsed.value.source.spans!.edges.get('edge#1:A->B'))).toBe('A-->B')
      expect(textAt(compactLabel, compactLabelParsed.value.source.spans!.labels.get('edge#0:A->B'))).toBe('lab')
    }

    const quotedCompact = 'flowchart LR\nA--"x --> y"-->B'
    const quotedCompactParsed = parseMermaid(quotedCompact)
    expect(quotedCompactParsed.ok).toBe(true)
    if (quotedCompactParsed.ok) {
      expect(textAt(quotedCompact, quotedCompactParsed.value.source.spans!.edges.get('edge#0:A->B'))).toBe('A--"x --> y"-->B')
      expect(textAt(quotedCompact, quotedCompactParsed.value.source.spans!.labels.get('edge#0:A->B'))).toBe('x --> y')
    }

    for (const source of [
      'flowchart LR\nA[--foo-->]-->B',
      'flowchart LR\nA["|foo|"]-->B',
      'flowchart LR\nA@{label:"--foo-->"}-->B',
    ]) {
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.source.edges.get('edge#0:A->B')).toEqual({ line: 2, col: 1 })
      expect(textAt(source, parsed.value.source.spans!.edges.get('edge#0:A->B'))).toBe(source.split('\n')[1])
    }

    const repeatedLabel = `flowchart LR
A[--lab] -->|other| B
A -->|lab| B`
    const repeatedLabelParsed = parseMermaid(repeatedLabel)
    expect(repeatedLabelParsed.ok).toBe(true)
    if (repeatedLabelParsed.ok) {
      expect(repeatedLabelParsed.value.source.edges.get('edge#1:A->B')).toEqual({ line: 3, col: 1 })
      expect(repeatedLabelParsed.value.source.labels.get('edge#1:A->B')).toEqual({ line: 3, col: 7 })
      expect(textAt(repeatedLabel, repeatedLabelParsed.value.source.spans!.labels.get('edge#1:A->B'))).toBe('lab')
    }

    const inlineCollision = 'flowchart LR\nA[-- x] -- x --> B'
    const inlineCollisionParsed = parseMermaid(inlineCollision)
    expect(inlineCollisionParsed.ok).toBe(true)
    if (inlineCollisionParsed.ok) {
      expect(inlineCollisionParsed.value.source.labels.get('edge#0:A->B')).toEqual({ line: 2, col: 12 })
      expect(textAt(inlineCollision, inlineCollisionParsed.value.source.spans!.labels.get('edge#0:A->B'))).toBe('x')
    }
  })

  test('maps near-limit hyphenated ids without quadratic label scanning', () => {
    const id = `A${'-a'.repeat(25_000)}`
    const source = `flowchart LR\n${id}`
    const started = performance.now()
    const parsed = parseMermaid(source)
    const elapsed = performance.now() - started

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.source.nodes.get(id)).toEqual({ line: 2, col: 1 })
    expect(elapsed).toBeLessThan(2_000)

    const packed = `flowchart LR\n${'A;'.repeat(10_000)}B-->C`
    const packedStarted = performance.now()
    const packedParsed = parseMermaid(packed)
    const packedElapsed = performance.now() - packedStarted
    expect(packedParsed.ok).toBe(true)
    expect(packedElapsed).toBeLessThan(2_000)

    const textLabel = `flowchart LR\nA -- x; ${'y; '.repeat(16_000)}z --> B`
    const textLabelStarted = performance.now()
    const textLabelParsed = parseMermaid(textLabel)
    const textLabelElapsed = performance.now() - textLabelStarted
    expect(textLabelParsed.ok).toBe(true)
    expect(textLabelElapsed).toBeLessThan(2_000)

    const quoted = `flowchart LR\nA["${'x -- '.repeat(2_000)}x"];${Array.from({ length: 100 }, (_, index) => `N${index}`).join(';')}`
    const quotedStarted = performance.now()
    const quotedParsed = parseMermaid(quoted)
    const quotedElapsed = performance.now() - quotedStarted
    expect(quotedParsed.ok).toBe(true)
    expect(quotedElapsed).toBeLessThan(2_000)
  })

  test('indexes line starts once for many mapped objects', () => {
    const sourceFor = (count: number): string => `flowchart LR\n${Array.from(
      { length: count },
      (_, index) => `N${index}`,
    ).join('\n')}`
    const parseTimed = (count: number) => {
      const source = sourceFor(count)
      const started = performance.now()
      const parsed = parseMermaid(source)
      return { source, parsed, elapsed: performance.now() - started }
    }

    const smaller = parseTimed(1_000)
    const larger = parseTimed(8_000)
    expect(smaller.parsed.ok).toBe(true)
    expect(larger.parsed.ok).toBe(true)
    expect(larger.elapsed).toBeLessThan(2_000)
    expect(larger.elapsed).toBeLessThan(smaller.elapsed * 12 + 1_000)
    if (larger.parsed.ok) {
      const last = larger.parsed.value.source.spans!.nodes.get('N7999')!
      expect(last.start).toEqual({ offset: larger.source.lastIndexOf('N7999'), line: 8_001, col: 1 })
    }
  })

  test('keeps same-line and repeated-node chains within a linear-time envelope', () => {
    const timed = (source: string) => {
      const started = performance.now()
      const parsed = parseMermaid(source)
      return { parsed, elapsed: performance.now() - started }
    }
    const unique = timed(`flowchart LR\n${Array.from({ length: 2_400 }, (_, index) => `N${index}`).join('-->')}`)
    const repeated = timed(`flowchart LR\n${Array.from({ length: 150 }, () => 'A').join('-->')}`)
    expect(unique.parsed.ok).toBe(true)
    expect(repeated.parsed.ok).toBe(true)
    expect(unique.elapsed).toBeLessThan(2_000)
    expect(repeated.elapsed).toBeLessThan(2_000)

    const shaped = timed(`flowchart LR\n${Array.from({ length: 9_600 }, (_, index) => `N${index}[L${index}]`).join('-->')}`)
    expect(shaped.parsed.ok).toBe(true)
    expect(shaped.elapsed).toBeLessThan(1_500)
  })

  test('indexes preservation coordinates and merges accessibility spans linearly', () => {
    const titles = `flowchart LR\n${Array.from({ length: 16_000 }, (_, index) => `accTitle: T${index}`).join('\n')}`
    let started = performance.now()
    const titleSpans = sourcePreservationSpans(titles, 'flowchart LR')
    const titleElapsed = performance.now() - started
    expect(titleSpans.accessibilityDirectives).toHaveLength(16_000)
    expect(titleElapsed).toBeLessThan(1_000)

    const mixed = `flowchart LR\n${Array.from({ length: 4_000 }, (_, index) =>
      `accDescr {\naccTitle: hidden ${index}\n}\naccTitle: visible ${index}`).join('\n')}`
    started = performance.now()
    const mixedSpans = sourcePreservationSpans(mixed, 'flowchart LR')
    const mixedElapsed = performance.now() - started
    expect(mixedSpans.accessibilityDirectives).toHaveLength(8_000)
    expect(mixedElapsed).toBeLessThan(750)
  })

  test('keeps compact labels inside statement and grammar boundaries', () => {
    const packed = 'flowchart LR\nfoo--bar; A-->B'
    const packedParsed = parseMermaid(packed)
    expect(packedParsed.ok).toBe(true)
    if (packedParsed.ok) {
      expect(packedParsed.value.source.nodes.get('A')).toEqual({ line: 2, col: 11 })
      expect(packedParsed.value.source.edges.get('edge#0:A->B')).toEqual({ line: 2, col: 11 })
      expect(textAt(packed, packedParsed.value.source.spans!.edges.get('edge#0:A->B'))).toBe('A-->B')
    }

    for (const [statement, id] of [
      ['A & o--x B', 'o'],
      ['A & x--o B', 'x'],
    ] as const) {
      const source = `flowchart LR\n${statement}`
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.source.nodes.get(id)).toEqual({ line: 2, col: 5 })
      expect(parsed.value.source.edges.get(`edge#1:${id}->B`)).toEqual({ line: 2, col: 5 })
    }

    for (const statement of [
      'A -- x --> B --> C',
      'A --> B -- x --> C',
      'A-->|x|B-->C',
      'A-->B-->|x|C',
    ]) {
      const source = `flowchart LR\n${statement}`
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.source.edges.has('edge#0:A->B')).toBe(true)
      expect(parsed.value.source.edges.has('edge#1:B->C')).toBe(true)
      expect(textAt(source, parsed.value.source.spans!.edges.get('edge#0:A->B'))).toBe(statement)
      expect(textAt(source, parsed.value.source.spans!.edges.get('edge#1:B->C'))).toBe(statement)
    }

    const repeatedNodeChain = 'flowchart LR\nA --> B -->|prior| A --> C'
    const repeatedNodeParsed = parseMermaid(repeatedNodeChain)
    expect(repeatedNodeParsed.ok).toBe(true)
    if (repeatedNodeParsed.ok) {
      expect(repeatedNodeParsed.value.source.edges.get('edge#2:A->C')).toEqual({ line: 2, col: 20 })
      expect(textAt(repeatedNodeChain, repeatedNodeParsed.value.source.spans!.edges.get('edge#2:A->C')))
        .toBe('A --> B -->|prior| A --> C')
    }
  })

  test('does not map nodes to edge ids or class suffixes', () => {
    const source = `flowchart LR
A e1@--> B
e1[Node]
C:::foo
foo[Node]`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.value.source.nodes.get('e1')).toEqual({ line: 3, col: 1 })
    expect(parsed.value.source.nodes.get('foo')).toEqual({ line: 5, col: 1 })
    expect(textAt(source, parsed.value.source.spans!.nodes.get('e1'))).toBe('e1[Node]')
    expect(textAt(source, parsed.value.source.spans!.nodes.get('foo'))).toBe('foo[Node]')
  })

  test('does not map implicit node labels to unrelated explicit labels', () => {
    for (const [source, absent, present] of [
      ['flowchart LR\nA -->|A| B', 'node:A', 'edge#0:A->B'],
      ['flowchart LR\nA --> B[A]', 'node:A', 'node:B'],
    ] as const) {
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.source.labels.has(absent)).toBe(false)
      expect(textAt(source, parsed.value.source.spans!.labels.get(present))).toBe('A')
    }
  })

  test('maps chart and Gantt tokens by grammar role and source occurrence', () => {
    const xy = 'xychart-beta\n line "line" [1 "Q2", 3 "Q4"]'
    const xyParsed = parseMermaid(xy)
    expect(xyParsed.ok).toBe(true)
    if (!xyParsed.ok) return
    expect(textAt(xy, xyParsed.value.source.spans!.labels.get('xychart:series-0:name'))).toBe('line')
    expect(xyParsed.value.source.spans!.labels.get('xychart:series-0:name')!.start.col).toBe(8)
    expect(textAt(xy, xyParsed.value.source.spans!.labels.get('xychart:series-0:point#1'))).toBe('3')

    const quadrant = 'quadrantChart\n title quadrant: [fake]\n quadrant: [0.2,0.3]'
    const quadrantParsed = parseMermaid(quadrant)
    expect(quadrantParsed.ok).toBe(true)
    if (quadrantParsed.ok) {
      const point = quadrantParsed.value.source.spans!.labels.get('quadrant:point#0')!
      expect(point.start.line).toBe(3)
      expect(textAt(quadrant, point)).toBe('quadrant')
    }

    const gantt = `gantt
 section Same
 A :a, 2024-01-01, 1d
 section Same
 B :b, 2024-01-02, 1d`
    const ganttParsed = parseMermaid(gantt)
    expect(ganttParsed.ok).toBe(true)
    if (ganttParsed.ok) {
      expect(ganttParsed.value.source.spans!.groups.get('section-0')!.start.line).toBe(2)
      expect(ganttParsed.value.source.spans!.groups.get('section-1')!.start.line).toBe(4)
    }

    const keyword = 'gantt\n section section\n T :t, 2024-01-01, 1d'
    const keywordParsed = parseMermaid(keyword)
    expect(keywordParsed.ok).toBe(true)
    if (keywordParsed.ok) expect(textAt(keyword, keywordParsed.value.source.spans!.labels.get('gantt:section-0:label'))).toBe('section')
  })

  test('does not map ER entities to family or subgraph control lines with the same name', () => {
    const source = `erDiagram
 subgraph Domain
 erDiagram ||--o{ B : owns
 end
 end ||--o{ C : closes`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.value.source.nodes.get('erDiagram')).toEqual({ line: 3, col: 1 })
    expect(parsed.value.source.nodes.get('end')).toEqual({ line: 5, col: 1 })
    expect(textAt(source, parsed.value.source.spans?.nodes.get('erDiagram'))).toBe('erDiagram ||--o{ B : owns')
    expect(textAt(source, parsed.value.source.spans?.nodes.get('end'))).toBe('end ||--o{ C : closes')

    const bare = parseMermaid('erDiagram\nerDiagram')
    expect(bare.ok).toBe(true)
    if (bare.ok) {
      expect(bare.value.source.nodes.get('erDiagram')).toEqual({ line: 2, col: 1 })
      expect(textAt('erDiagram\nerDiagram', bare.value.source.spans?.nodes.get('erDiagram'))).toBe('erDiagram')
    }
  })
})
