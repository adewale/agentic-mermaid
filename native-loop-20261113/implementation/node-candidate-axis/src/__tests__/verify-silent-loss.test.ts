import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'
import { DIAGRAM_WORK_LIMITS } from '../shared/diagram-limits.ts'

/**
 * Audit fix: broken input must not verify clean.
 *
 * 1. An unclosed bracket/quote/|label| in a flowchart statement makes the
 *    legacy parser silently drop everything after it — `A[Start --> B` loses
 *    the A→B edge and mangles the label, yet verify returned zero warnings.
 *    Now surfaced as UNSUPPORTED_SYNTAX (flowchart_unclosed_*).
 * 2. A sequence whose only content is a malformed message (`Alice->>` with no
 *    target) lays out a 0x0 canvas with zero participants — an empty render —
 *    yet verify returned ok with zero warnings. Now a named render failure.
 */
describe('verify — unclosed flowchart delimiters are reported, not silent', () => {
  const syntaxes = (source: string): string[] =>
    verifyMermaid(source).warnings
      .filter(w => w.code === 'UNSUPPORTED_SYNTAX')
      .map(w => (w as { syntax: string }).syntax)

  test('unclosed bracket that swallows an arrow warns (the audit repro)', () => {
    expect(syntaxes('flowchart TD\n  A[Start --> B')).toContain('flowchart_unclosed_bracket')
  })

  test('unclosed rounded/diamond delimiters warn too', () => {
    expect(syntaxes('flowchart TD\n  A(Start --> B')).toContain('flowchart_unclosed_bracket')
    expect(syntaxes('flowchart TD\n  A{Start --> B')).toContain('flowchart_unclosed_bracket')
  })

  test('unclosed double quote warns', () => {
    expect(syntaxes('flowchart TD\n  A["Start --> B')).toContain('flowchart_unclosed_quote')
  })

  test('unclosed |edge label| warns', () => {
    expect(syntaxes('flowchart TD\n  A -->|Yes B')).toContain('flowchart_unclosed_pipe')
  })

  test('warning carries the source line', () => {
    const w = verifyMermaid('flowchart TD\n  A --> B\n  C[Broken --> D')
      .warnings.find(x => x.code === 'UNSUPPORTED_SYNTAX' && (x as { syntax: string }).syntax === 'flowchart_unclosed_bracket')
    expect(w).toBeDefined()
    expect((w as { line?: number }).line).toBe(3)
    // A statement after an accDescr block's `}` is linted on that line.
    const suffix = verifyMermaid('flowchart TD\n  accDescr {\n    a\n  } C[Broken --> D')
      .warnings.find(x => x.code === 'UNSUPPORTED_SYNTAX' && (x as { syntax: string }).syntax === 'flowchart_unclosed_bracket')
    expect((suffix as { line?: number } | undefined)?.line).toBe(4)
  })

  test('well-formed statements stay clean', () => {
    expect(syntaxes('flowchart TD\n  A[Start] --> B')).toEqual([])
    expect(syntaxes('flowchart TD\n  A -->|Yes| B')).toEqual([])
    expect(syntaxes('flowchart LR\n  A>flag] --> B[Box]')).toEqual([])       // asymmetric closer without opener
    expect(syntaxes("flowchart TD\n  A[Don't panic] --> B")).toEqual([])     // apostrophe is not a quote
    expect(syntaxes('flowchart TD\n  A["says [hi]"] --> B')).toEqual([])     // brackets inside quotes
    expect(syntaxes('flowchart TD\n  A["(a\\"] --> B')).toEqual([])          // `\` is literal; the `"` closes
    expect(syntaxes('flowchart TD\n  accDescr {\n    a "b\n  }\n  A --> B')).toEqual([])  // accessibility text, not a statement
  })

  test('a free-text subgraph title is no unclosed bracket', () => {
    // Mermaid rejects the `(` in a title without quotes, which verify names.
    expect(syntaxes('flowchart TD\n  subgraph Photos (2024\n    A --> B\n  end')).toEqual(['flowchart_subgraph_title'])
  })
})

describe('verify — empty layouts never verify clean', () => {
  test('sequence with only a malformed message is empty (the audit repro)', () => {
    const r = verifyMermaid('sequenceDiagram\n  Alice->>')
    // Preserving malformed source does not make its empty drawing successful.
    expect(r.ok).toBe(false)
    expect(r.warnings.map(w => w.code)).not.toContain('EMPTY_DIAGRAM')
    expect(r.warnings.map(w => w.code)).toContain('RENDER_FAILED')
    expect(r.warnings.some(w => w.code === 'UNSUPPORTED_SYNTAX' && 'syntax' in w && w.syntax === 'sequence_statement')).toBe(true)
  })

  test('a truly content-less sequence stays a hard error', () => {
    const r = verifyMermaid('sequenceDiagram')
    expect(r.warnings.map(w => w.code)).toContain('EMPTY_DIAGRAM')
    expect(r.ok).toBe(false)
  })

  test('valid sequence content stays ok', () => {
    const r = verifyMermaid('sequenceDiagram\n  Alice->>Bob: hi')
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([])
  })

  test('note-only sequence content that lays out stays ok', () => {
    const r = verifyMermaid('sequenceDiagram\n  Note over Alice: hello')
    expect(r.ok).toBe(true)
    expect(r.layout.nodes.length).toBeGreaterThan(0)
    expect(r.warnings.map(w => w.code)).not.toContain('EMPTY_DIAGRAM')
  })

  // Opaque bodies (unmodeled-but-preserved syntax, e.g. a title-only journey)
  // intentionally do NOT trip the empty-layout guard: their local layout
  // degrading to 0x0 means the syntax is unmodeled, not that the diagram is
  // empty — the docs-corpus floors pin that behavior.
})

describe('render-parity gate (RENDER_FAILED)', () => {
  // The seam found by the onboarding probes: agents followed
  // verify-before-commit and still shipped sources the render parser
  // rejects. A clean verify must prove the diagram actually renders.
  test('unrenderable sources flip ok with RENDER_FAILED naming what to fix', () => {
    const nesting = DIAGRAM_WORK_LIMITS.nesting + 1
    const themeCss = '%%{init: {"themeCSS": ".node rect { fill: red }"}}%%\nflowchart LR\n  A --> B'
    const cases = [
      { source: 'quadrantChart\n  title T\n  x-axis L --> R\n  y-axis B --> T2\n  Company A: 0.8, 0.75', origin: 'source' }, // missing [x, y] brackets
      { source: 'architecture-beta\n  service a(database)[A]\n  end', origin: 'source' }, // stray end
      // A host work limit the author can act on, though it is a RangeError.
      { source: `classDiagram\n${'namespace N {\n'.repeat(nesting)}class A\n${'}\n'.repeat(nesting)}`, origin: 'source' },
      { source: '%%{init: {"themeVariables": {"primaryColor": "notacolor"}}}%%\nflowchart LR\n  A --> B', origin: 'config' },
      { source: 'flowchart LR\n  A --> B', renderOptions: { bg: 'url(https://example.test/x)' }, origin: 'config' },
      { source: 'flowchart LR\n  A --> B', renderOptions: { style: 'no-such-style' }, origin: 'config' },
      // Authored values that reach Scene admission's range and identity checks,
      // or the family normalizer's option checks, are still the author's.
      { source: 'flowchart LR\n  A --> B\n  style A stroke-width:-5px', origin: 'source' },
      { source: 'flowchart LR\n  A --> B\n  linkStyle 0 stroke-width:1e9px', origin: 'source' },
      { source: 'stateDiagram-v2\n  state A {\n    state A {\n      x --> y\n    }\n  }', origin: 'source' },
      { source: '---\nconfig:\n  themeVariables:\n    fontFamily: "Inter, sans-serif;"\n---\nsequenceDiagram\n  A->>B: hi', origin: 'config' },
      // The authored config envelope a flowchart-like canonical body drops
      // still governs render, so verify must check it too.
      { source: themeCss, origin: 'config' },
      { source: themeCss, renderOptions: { security: 'strict' }, origin: 'config' },
      { source: '%%{init: {"themeVariables": {"fontFamily": "x;}"}}}%%\nclassDiagram\n  class A', origin: 'config' },
      { source: '%%{init: {"flowchart": {"nodeSpacing": 1e9}}}%%\nflowchart LR\n  A --> B\n  A --> C', origin: 'source' },
      // Sources the render-path parsers refuse before any layout.
      { source: '---\ntitle: [unclosed\n---\nflowchart LR\n  A --> B', origin: 'source' },
      { source: `stateDiagram-v2\n${Array.from({ length: nesting }, (_, i) => `state S${i} {\n`).join('')}X\n${'}\n'.repeat(nesting)}`, origin: 'source' },
      { source: `flowchart LR\n${Array.from({ length: DIAGRAM_WORK_LIMITS.nodes + 1 }, (_, i) => `  N${i}`).join('\n')}`, origin: 'source' },
    ] as const
    for (const { source, origin, ...opts } of cases) {
      expect(() => renderMermaidSVG(source, 'renderOptions' in opts ? opts.renderOptions : {})).toThrow()
      const r = verifyMermaid(source, opts)
      const failures = r.warnings.filter(w => w.code === 'RENDER_FAILED' || w.code === 'INTERNAL_ERROR')
      expect({ source, ok: r.ok, codes: [...new Set(failures.map(w => w.code))], origins: [...new Set(failures.map(w => 'origin' in w ? w.origin : undefined))] })
        .toEqual({ source, ok: false, codes: ['RENDER_FAILED'], origins: [origin] })
      expect(failures.every(w => w.reason.length > 0)).toBe(true)
    }
  })

  test.each([
    ['refused config', '%%{init: {"themeCSS": ".node rect { fill: red }"}}%%\nflowchart LR\n'],
    ['a layout past the canvas cap', '%%{init: {"flowchart": {"nodeSpacing": 1e9}}}%%\nflowchart LR\n  A --> C\n'],
  ])('a render that fails over %s still reports the body\'s own findings', (_case, head) => {
    const label = 'x'.repeat(80)
    const codes = verifyMermaid(`${head}  A[${label}] --> B`).warnings.map(w => w.code)
    expect(codes).toContain('RENDER_FAILED')
    expect(codes).toContain('LABEL_OVERFLOW')
  })

  test('malformed or refused frontmatter is a parse failure, not a throw or flowchart statements', () => {
    for (const [source, code, origin] of [
      ['---\ntitle: [unclosed\nconfig: {\n---\nflowchart LR\n  A --> B', 'INVALID_FRONTMATTER', 'source'],
      ['---\n__proto__:\n  x: 1\n---\nflowchart LR\n  A --> B', 'CONFIG_REJECTED', 'config'],
    ] as const) {
      const parsed = parseMermaid(source)
      expect({ source, codes: parsed.ok ? [] : parsed.error.map(error => error.code) }).toEqual({ source, codes: [code] })
      expect({ source, warnings: verifyMermaid(source).warnings.map(w => [w.code, 'origin' in w ? w.origin : undefined]) }).toEqual({ source, warnings: [['RENDER_FAILED', origin]] })
    }
  })

  test('suppressing the finding never makes a source that does not parse verify', () => {
    const r = verifyMermaid('flowchart LR\n  A -->', { suppress: ['RENDER_FAILED', 'EMPTY_DIAGRAM'] })
    expect(r.ok).toBe(false)
  })

  test('a source string and its parsed diagram verify alike', () => {
    // A regression guard: the structural tiers read the parsed body, so the
    // positioned layout must come from it too (here `[*]` ids inside a
    // composite are numbered in serialization order).
    for (const source of [
      'stateDiagram-v2\n    [*] --> First\n    state First {\n        [*] --> second\n        second --> [*]\n    }',
      '%%{init: {"flowchart": {"rankSpacing": 300}}}%%\nflowchart LR\n  A --> B',
    ]) {
      const parsed = parseMermaid(source)
      if (!parsed.ok) throw new Error(`parse failed: ${source}`)
      const fromSource = verifyMermaid(source)
      const fromParsed = verifyMermaid(parsed.value)
      expect({ source, ok: fromSource.ok, codes: fromSource.warnings.map(w => w.code) }).toEqual({ source, ok: true, codes: fromParsed.warnings.map(w => w.code) })
      expect(fromParsed.ok).toBe(true)
      expect(fromParsed.checks).toEqual(fromSource.checks)
    }
  })

  test('verify measures the layout render draws, under the authored layout config', () => {
    for (const source of [
      '%%{init: {"flowchart": {"rankSpacing": 300}}}%%\nflowchart LR\n  A --> B',
      '---\nconfig:\n  class:\n    nodeSpacing: 200\n---\nclassDiagram\n  A <|-- B\n  A <|-- C',
      // Axis and grid lines end on the canvas edge.
      'xychart-beta\n  x-axis [a, b]\n  y-axis 0 --> 10\n  bar [1, 2]',
      '---\ntitle: Chart\n---\nxychart-beta horizontal\n  x-axis [a, b]\n  y-axis 0 --> 10\n  bar [1, 2]',
      '%%{init: {"xyChart": {"width": 400, "height": 300}}}%%\nxychart-beta\n  x-axis [a, b]\n  y-axis 0 --> 10\n  bar [1, 2]',
      // Marks centered on a plot edge that meets the canvas edge: a line point
      // and tick at a linear axis end, values clamped past the range, and the
      // end grid lines and ticks where no labels or title stand between.
      'xychart-beta\n  x-axis 0 --> 100\n  line [0, 10]',
      // A Journey legend title whose top is floating-point noise below zero.
      'journey\n  Only task: 3: Me',
      'xychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 10\n  line [20, -5, 10]',
      '%%{init: {"xyChart": {"showTitle": false, "yAxis": {"showLabel": false}}}}%%\nxychart-beta\n  x-axis [a, b]\n  line [3.5, 8]',
      '%%{init: {"xyChart": {"yAxis": {"showLabel": false}}}}%%\nxychart-beta horizontal\n  x-axis [a, b]\n  y-axis 0 --> 10\n  line [12, 4]',
      // Thick curved ribbons: bent, off-centre control points (rounded
      // midpoints), and a ribbon thicker than its bend that folds past its end.
      'sankey-beta\nA,B,10\nB,C,5',
      '---\ntitle: Flow\n---\n%%{init: {"sankey": {"width": 500, "height": 300}}}%%\nsankey-beta\nA,B,10\nB,C,10\nC,D,10\nA,E,3\nE,D,3',
      'sankey-beta\nA,B,10\nB,C,10\nC,D,10\nD,E,6',
    ]) {
      const [x, y, width, height] = /viewBox="([^"]+)"/.exec(renderMermaidSVG(source))![1]!.split(' ').map(Number)
      const { bounds } = verifyMermaid(source).layout
      expect({ source, x: 0, y: 0, w: Math.round(bounds.w), h: Math.round(bounds.h) }).toEqual({ source, x: x!, y: y!, w: Math.round(width!), h: Math.round(height!) })
    }
  })

  test('suppressing RENDER_FAILED removes that diagnostic', () => {
    const r = verifyMermaid('quadrantChart\n  title T\n  x-axis L --> R\n  y-axis B --> T2\n  P: 0.5, 0.5', { suppress: ['RENDER_FAILED'] })
    expect(r.warnings.map(w => w.code)).not.toContain('RENDER_FAILED')
  })

  test('renderable diagrams never carry RENDER_FAILED', () => {
    for (const source of ['graph TD\n  A-->B', 'pie title P\n  "a" : 1', 'timeline\n  title T\n  2024 : x']) {
      const r = verifyMermaid(source)
      expect({ source, codes: r.warnings.map(w => w.code) }).toEqual({ source, codes: [] })
    }
  })
})

describe('verify — flowchart lints read only flowchart source', () => {
  test.each(['gitGraph\n  commit\n  bogus ["x', 'mindmap\n  root((unclosed'])('%j fails to parse without flowchart lints', source => {
    const result = verifyMermaid(source)
    expect(result.ok).toBe(false)
    expect(result.warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX' && (w as { syntax: string }).syntax.startsWith('flowchart_'))).toEqual([])
  })
})
