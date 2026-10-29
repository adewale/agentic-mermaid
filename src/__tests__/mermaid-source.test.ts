import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'

import { BUILTIN_FAMILY_METADATA, getFamily } from '../agent/families.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import {
  detectDiagramType,
  getFrontmatterMap,
  getFrontmatterScalar,
  mermaidInitDirectiveIdentity,
  mermaidInitDirectives,
  normalizeMermaidSource,
  preprocessMermaidSource,
  stripMermaidInitDirectives,
} from '../mermaid-source.ts'
import { mermaidFirstLine } from '../mermaid-source-wrapper.ts'

describe('preprocessMermaidSource', () => {
  it('observes the family descriptor even when configuration is empty', () => {
    let reads = 0
    let fail = false
    const family = {
      ...getFamily('flowchart')!,
      get id() {
        reads++
        if (fail) throw new Error('descriptor failed')
        return 'flowchart' as const
      },
    }
    const source = 'flowchart TD\nA --> B'
    expect(preprocessMermaidSource(source, {}, family).frontmatter).toEqual({})
    expect(reads).toBe(1)
    fail = true
    expect(() => preprocessMermaidSource(source, {}, family)).toThrow('descriptor failed')
    expect(reads).toBe(2)
  })

  it('applies base, YAML and init config in order when a scalar replaces a map', () => {
    const source = '---\nconfig:\n  xyChart: false\n---\n%%{init: {"xyChart":{"height":200}}}%%\nxychart\nbar [1]'
    const normalized = normalizeMermaidSource(source, { xyChart: { width: 100 } })
    // The YAML scalar erases the base map before init creates a new map.
    expect(normalized.config.xyChart).toEqual({ height: 200 })
  })

  it('parses real YAML frontmatter, including anchors, lists, and block scalars', () => {
    const processed = preprocessMermaidSource(`---
theme: base
themeCSS: |
  .foo { fill: red; }
secure:
  - theme
palette: &palette
  plotColorPalette: "#ff6b6b, #0ea5e9"
themeVariables:
  xyChart: *palette
config:
  xyChart:
    width: 640
---
xychart
x-axis [A]
bar [1]`)

    expect(processed.body).toBe(`xychart
x-axis [A]
bar [1]`)
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['theme'])).toBe('base')
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['themeCSS'])).toContain('.foo { fill: red; }')
    expect(processed.frontmatter.secure).toEqual(['theme'])
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['themeVariables', 'xyChart', 'plotColorPalette']))
      .toBe('#ff6b6b, #0ea5e9')
    expect(getFrontmatterScalar<number>(processed.frontmatter, ['xyChart', 'width'])).toBe(640)
  })

  it('merges init directives before and after the header and strips them from the body', () => {
    const processed = preprocessMermaidSource(`%%{init: { theme: base, xyChart: { width: 640 } }}%%
xychart
%% regular comment
x-axis [A]
%%{initialize: { fontFamily: 'Fira Code', themeVariables: { primaryTextColor: '#111111' } }}%%
bar [1]`)

    expect(processed.lines).toEqual([
      'xychart',
      'x-axis [A]',
      'bar [1]',
    ])
    expect(processed.body).not.toContain('%%{')
    expect(processed.lines).not.toContain('%% regular comment')
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['theme'])).toBe('base')
    expect(getFrontmatterScalar<number>(processed.frontmatter, ['xyChart', 'width'])).toBe(640)
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['fontFamily'])).toBe('Fira Code')
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['themeVariables', 'primaryTextColor'])).toBe('#111111')
  })

  it('applies and removes a directive inside a statement, leaving the rest of its line', () => {
    // Mermaid's preprocessing removes a directive wherever it stands, and
    // applies an init's config and a wrap's `wrap: true`, and nothing else.
    const processed = preprocessMermaidSource('classDiagram\n  A : +x %%{init: {"theme": "dark"}}%% y\n  class B\n  "pie %%{initialize: {"fontFamily": "Fira"}}%%"\n  C : z %%{wrap}%%\n  D %%{config: {"theme": "forest"}}%% %%{other}%%')
    expect(processed.lines).toEqual(['classDiagram', 'A : +x  y', 'class B', '"pie "', 'C : z', 'D'])
    expect(processed.frontmatter).toEqual({ theme: 'dark', fontFamily: 'Fira', wrap: true })
    // Mermaid applies an init inside a `%%` comment line too (checked against the pin).
    expect(preprocessMermaidSource('pie\n  %% see %%{init: {"theme": "neutral"}}%%\n  "a" : 1').frontmatter).toEqual({ theme: 'neutral' })
    expect(stripMermaidInitDirectives('family\n  A %%{init:{"theme":"dark"}}%%\n  B\n')).toBe('family\n  A \n  B\n')
    expect(mermaidInitDirectives('family\n  A %%{init:{"theme":"dark"}}%%\n').map(directive => directive.parsed)).toEqual([{ theme: 'dark' }])
  })

  it('strips only directive lines and preserves adjacent LF/CRLF indentation and blank bytes', () => {
    expect(stripMermaidInitDirectives(`family

  %%{init:{"theme":"dark"}}%%
    child
`)).toBe(`family

    child
`)
    expect(stripMermaidInitDirectives('family\r\n\r\n  %%{initialize:{"theme":"dark"}}%%\r\n\t  child\r\n'))
      .toBe('family\r\n\r\n\t  child\r\n')
  })

  it('identifies equivalent init config independently of top-level and nested key order', () => {
    const [authored] = mermaidInitDirectives(
      '%%{init:{"theme":"dark","flowchart":{"htmlLabels":true,"curve":"basis"}}}%%',
    )
    const [reordered] = mermaidInitDirectives(
      '%%{init:{"flowchart":{"curve":"basis","htmlLabels":true},"theme":"dark"}}%%',
    )
    expect(mermaidInitDirectiveIdentity(authored!)).toBe(mermaidInitDirectiveIdentity(reordered!))
  })
})

describe('normalizeMermaidSource', () => {
  it.each([
    '',
    '\uFEFF%% comment\n',
    '---\nconfig: {}\n---\n',
    '---\n- ignored metadata\n---\n',
    '%%{config: {"theme":"dark"}}%%\n',
  ])('keeps empty configuration independently mutable with wrapper %j', wrapper => {
    const base = {}
    const text = `${wrapper}flowchart TD\n  A --> B`
    const first = normalizeMermaidSource(text, base)
    const second = normalizeMermaidSource(text, base)

    expect(first.frontmatter).toEqual({})
    expect(first.config).toEqual({})
    expect(first.familyLines).toEqual(['flowchart TD', 'A --> B'])
    first.frontmatter.theme = 'dark'
    expect(first.config).toEqual({})
    first.config.theme = 'forest'
    expect(base).toEqual({})
    expect(second.frontmatter).toEqual({})
    expect(second.config).toEqual({})
    expect(normalizeMermaidSource(text, base).frontmatter).toEqual({})
  })

  it('owns universal accessibility grammar and preserves family suffixes', () => {
    const normalized = normalizeMermaidSource(`flowchart TD
  accTitle Accessible graph
  accDescr: {
    First line
    Second line
  } A --> B`)

    expect(normalized.accessibility).toEqual({
      title: 'Accessible graph',
      descr: 'First line\nSecond line',
    })
    expect(normalized.familyLines).toEqual(['flowchart TD', 'A --> B'])
  })

  // A family string that runs across lines is the family's text, even where a
  // line inside it reads like a directive; Mermaid's lexers read it so.
  it.each([
    ['pie\n  "a\naccTitle: b" : 1\n  "c" : 2', 'a\naccTitle: b'],
    ['xychart-beta\n  title "a\naccTitle: b"\n  bar [1, 2]', 'a\naccTitle: b'],
    ['gitGraph\n  commit id: "a\naccDescr { b"', 'a\naccDescr { b'],
    ['quadrantChart\n  x-axis "a\naccTitle: b" --> High\n  p: [0.5, 0.5]', 'a\naccTitle: b'],
    ['architecture-beta\n  service a(server)["x\naccDescr {\ny }"]', 'x\naccDescr {\ny }'],
    ['radar-beta\n  axis a["x\naccTitle: y"], b\n  curve c{1, 2}', 'x\naccTitle: y'],
    // Class keeps a label's line break as <br>.
    ['classDiagram\n  class A["x\naccTitle: y"]', 'x<br>accTitle: y'],
    ['mindmap\n  root["x\naccTitle: y"]', 'x\naccTitle: y'],
    ['stateDiagram-v2\n  state "x\naccTitle: y" as A\n  A --> B', 'x\naccTitle: y'],
    // A block note's text runs to its `end note` line.
    ['stateDiagram-v2\n  note left of A\n    accDescr {\n    y }\n  end note', 'accDescr {\ny }'],
    ['flowchart TD\n  A["x\naccTitle: y"] --> B', 'x\naccTitle: y'],
    ['flowchart TD\n  A -- x\naccDescr {\ny } --> B', 'x\naccDescr {\ny }'],
  ])('%j keeps a directive-shaped line inside its quoted text', (statements, text) => {
    // The comment after the string is still the envelope's, on its line.
    const source = `${statements}\n  %% note`
    expect(normalizeMermaidSource(source).accessibility).toEqual({})
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).not.toBe('opaque')
    // A flowchart body keeps its nodes in a Map.
    expect(JSON.stringify(parsed.value.body, (_, value) => value instanceof Map ? [...value.values()] : value)).toContain(JSON.stringify(text))
    expect(parsed.value.meta.accessibility).toEqual({})
    expect(parsed.value.meta.comments).toEqual([{ text: 'note', line: source.split('\n').length }])
    expect(parsed.value.source.spans?.preserved?.accessibilityDirectives).toBeUndefined()
  })

  // Mermaid's flowchart lexer reads `accDescr {` to its `}`: a quote in the
  // description opens no string, so the statements after it start where
  // they stand.
  it('reads a flowchart string after an accDescr block that holds a quote', () => {
    const source = 'flowchart TD\n  accDescr {\n  a "b\n  }\n  A["x\naccTitle: y"]'
    expect(normalizeMermaidSource(source).accessibility).toEqual({ descr: 'a "b' })
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind === 'flowchart' && parsed.value.body.graph.nodes.get('A')?.label).toBe('x\naccTitle: y')
  })

  // Mermaid reads a statement written on these families' header lines.
  it.each([
    ['sequenceDiagram A->>B: hi', 'sequenceDiagram\nA->>B: hi'],
    ['stateDiagram-v2 A --> B', 'stateDiagram-v2\nA --> B'],
    ['mindmap root\n  A', 'mindmap\nroot\n  A'],
    ['architecture-beta service a(server)[A]', 'architecture-beta\nservice a(server)[A]'],
    ['gitGraph LR: commit\ncommit', 'gitGraph LR:\ncommit\ncommit'],
    ['gantt dateFormat YYYY-MM-DD\nTask :a, 2024-01-01, 1d', 'gantt\ndateFormat YYYY-MM-DD\nTask :a, 2024-01-01, 1d'],
    ['journey title T\nsection S\nA: 5: Me', 'journey\ntitle T\nsection S\nA: 5: Me'],
    ['quadrantChart title T', 'quadrantChart\ntitle T'],
    ['timeline LR title T\n2020 : a', 'timeline LR\ntitle T\n2020 : a'],
    ['pie showData "a": 1', 'pie showData\n"a": 1'],
    ['xychart-beta horizontal title "T"\nbar [1, 2]', 'xychart-beta horizontal\ntitle "T"\nbar [1, 2]'],
    ['radar-beta axis a, b\ncurve x{1, 2}', 'radar-beta\naxis a, b\ncurve x{1, 2}'],
    ['radar-beta:axis a, b\ncurve x{1, 2}', 'radar-beta:\naxis a, b\ncurve x{1, 2}'],
    ['gitGraph:commit\ncommit', 'gitGraph:\ncommit\ncommit'],
    // A Mindmap root's leading whitespace is its level.
    ['mindmap root\n  a', 'mindmap\n root\n  a'],
    ['erDiagram subgraph S\nA\nend', 'erDiagram\nsubgraph S\nA\nend'],
  ])('%j reads its header-line statement as a line of its own', (oneLine, twoLines) => {
    expect(normalizeMermaidSource(oneLine).familyLines).toEqual(normalizeMermaidSource(twoLines).familyLines)
    const parsed = parseRegisteredMermaid(oneLine)
    const expected = parseRegisteredMermaid(twoLines)
    if (!parsed.ok || !expected.ok) throw new Error(JSON.stringify(parsed.ok ? expected : parsed))
    expect(parsed.value.body.kind).not.toBe('opaque')
    expect(parsed.value.body).toEqual(expected.value.body)
  })

  // Mermaid rejects these, so the statement is not read off the header line.
  it.each([
    'erDiagram direction LR\n  A ||--o{ B : r',
    'stateDiagram-v2 direction TB\n  A',
    'stateDiagram-v2 A --> B : direction LR',
    'gitGraph LR commit\n  commit',
    'erDiagram&#32;A ||--o{ B : r',
    'pie&#32;"a": 1',
    'mindmap  root\n  a',
    'mindmap layout s}}es}}election',
    'mindmap  This String containing []is a comment root((the root))',
  ])('%j is no typed diagram', source => {
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok && !['opaque', 'preserved'].includes(parsed.value.body.kind) ? parsed.value.body.kind : 'untyped').toBe('untyped')
  })

  it('leaves an unclosed accessibility block visible to family error handling', () => {
    const normalized = normalizeMermaidSource(`journey
  accDescr {
    never closed
  Task: 3: Me`)

    expect(normalized.accessibility).toEqual({})
    expect(normalized.familyBody).toContain('accDescr {')
    expect(normalized.familyBody).toContain('Task: 3: Me')
  })

  it('merges base config with parsed frontmatter and directive overrides', () => {
    const normalized = normalizeMermaidSource(`---
theme: neutral
timeline:
  disableMulticolor: false
---
%%{init: { timeline: { disableMulticolor: true, sectionColors: ['#111111', '#222222'] } }}%%
timeline
  title Release plan
  section Now
    Ship : Done`, {
      fontFamily: 'IBM Plex Sans',
      timeline: { disableMulticolor: false },
    })

    expect(normalized.text).toBe(`timeline
title Release plan
section Now
Ship : Done`)
    expect(normalized.config.theme).toBe('neutral')
    expect(normalized.config.fontFamily).toBe('IBM Plex Sans')
    expect(normalized.config.timeline?.disableMulticolor).toBe(true)
    expect(normalized.config.timeline?.sectionColours).toEqual(['#111111', '#222222'])
    expect(getFrontmatterMap(normalized.frontmatter, ['timeline'])).toEqual(expect.objectContaining({
      disableMulticolor: true,
    }))
  })

  it('rejects prototype keys and cyclic YAML aliases before config cloning', () => {
    expect(() => normalizeMermaidSource(`%%{init: { "__proto__": { polluted: true } }}%%
flowchart TD
  A --> B`)).toThrow('uses a forbidden prototype key')

    expect(() => normalizeMermaidSource(`%%{init: &root { safe: true, self: *root }}%%
flowchart TD
  A --> B`)).toThrow('must be acyclic')
  })
})

// The lazy browser entry reads the family header with mermaidFirstLine so it
// loads no YAML; the family's render then normalizes the whole source. The two
// must name the same line, or detection loads the wrong family.
describe('mermaidFirstLine is normalizeMermaidSource(…).firstLine without parsing the wrapper', () => {
  const agree = (source: string) => {
    let firstLine: string
    try {
      firstLine = normalizeMermaidSource(source).firstLine
    } catch {
      return
    }
    expect({ source, header: mermaidFirstLine(source) }).toEqual({ source, header: firstLine })
  }

  it('on every upstream bench source', () => {
    const cases = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'eval/mermaid-upstream-suite-bench/cases.json'), 'utf8')) as Array<{ source: string }>
    expect(cases.length).toBeGreaterThan(500)
    for (const { source } of cases) agree(source)
  })

  it('on generated wrappers: BOM, CRLF, frontmatter, init directives, comments and blank lines', () => {
    const line = fc.constantFrom('', '   ', '%% a comment', '%%{config: {}}%%', '%%{name}%%', '%%{init: {"theme": "dark"}}%%', '%%{ initialize: { "look": "handDrawn" } }%%', '%%{init: {\n  "theme": "base"\n}}%%')
    const frontmatter = fc.constantFrom('', '---\ntitle: T\n---\n', '---\nconfig:\n  theme: forest\n---\n', '  ---\na: 1\n  ---\n')
    const header = fc.constantFrom('flowchart TD', 'Graph LR', 'sequenceDiagram', 'stateDiagram-v2', 'pie showData', 'xychart-beta', '  erDiagram  ')
    fc.assert(fc.property(
      fc.boolean(), fc.boolean(), frontmatter, fc.array(line, { maxLength: 4 }), header, fc.array(line, { maxLength: 2 }),
      (bom, crlf, front, before, head, after) => {
        const text = `${bom ? '\uFEFF' : ''}${front}${[...before, head, ...after, '  A --> B'].join('\n')}`
        agree(crlf ? text.replace(/\n/g, '\r\n') : text)
      },
    ))
  })

  it.each(['%%{config: {}}%%packet', 'pa%%{config: {}}%%cket'])('removes inert directives in %s before selecting the header', header => {
    const source = `${header}\n0-7: "Header"`
    expect(mermaidFirstLine(source)).toBe('packet')
    expect(normalizeMermaidSource(source).firstLine).toBe('packet')
  })
})

describe('detectDiagramType', () => {
  // SVG and ASCII rendering route through this detector; the agent parser must
  // land every family on the same kind.
  it('routes every built-in family example to the kind the agent parser assigns', () => {
    for (const family of BUILTIN_FAMILY_METADATA) {
      const parsed = parseRegisteredMermaid(family.example)
      expect({ family: family.id, detected: detectDiagramType(family.example), parsed: parsed.ok ? parsed.value.kind : parsed.error })
        .toEqual({ family: family.id, detected: family.id, parsed: family.id })
    }
  })
})
