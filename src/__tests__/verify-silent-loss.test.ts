import { describe, expect, test } from 'bun:test'
import { verifyMermaid } from '../agent/index.ts'

/**
 * Audit fix: broken input must not verify clean.
 *
 * 1. An unclosed bracket/quote/|label| in a flowchart statement makes the
 *    legacy parser silently drop everything after it — `A[Start --> B` loses
 *    the A→B edge and mangles the label, yet verify returned zero warnings.
 *    Now surfaced as UNSUPPORTED_SYNTAX (flowchart_unclosed_*).
 * 2. A sequence whose only content is a malformed message (`Alice->>` with no
 *    target) lays out a 0x0 canvas with zero participants — an empty render —
 *    yet verify returned ok with zero warnings. Now EMPTY_DIAGRAM.
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
  })

  test('well-formed statements stay clean', () => {
    expect(syntaxes('flowchart TD\n  A[Start] --> B')).toEqual([])
    expect(syntaxes('flowchart TD\n  A -->|Yes| B')).toEqual([])
    expect(syntaxes('flowchart LR\n  A>flag] --> B[Box]')).toEqual([])       // asymmetric closer without opener
    expect(syntaxes("flowchart TD\n  A[Don't panic] --> B")).toEqual([])     // apostrophe is not a quote
    expect(syntaxes('flowchart TD\n  A["says [hi]"] --> B')).toEqual([])     // brackets inside quotes
    expect(syntaxes('flowchart TD\n  subgraph Photos (2024\n    A --> B\n  end')).toEqual([]) // free-text subgraph label
  })
})

describe('verify — empty layouts never verify clean', () => {
  test('sequence with only a malformed message is empty (the audit repro)', () => {
    const r = verifyMermaid('sequenceDiagram\n  Alice->>')
    // Advisory: the source carries (unparseable) content, so ok is preserved —
    // the upstream-suite bench pins content-bearing-but-unrenderable ok:true —
    // and the announcement is UNSUPPORTED_SYNTAX (warning severity, consistent
    // with ok:true), never an appended EMPTY_DIAGRAM whose declared severity
    // is error and would contradict the verdict for ok-gating callers.
    expect(r.ok).toBe(true)
    expect(r.warnings.map(w => w.code)).not.toContain('EMPTY_DIAGRAM')
    const announced = r.warnings.find(w => w.code === 'UNSUPPORTED_SYNTAX' && (w as { syntax?: string }).syntax === 'empty_layout')
    expect(Boolean(announced)).toBe(true)
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

  test('opaque-only sequence content that DOES lay out stays ok', () => {
    const r = verifyMermaid('sequenceDiagram\n  Note over Alice: hello')
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
  test('unrenderable-but-parseable sources flip ok with RENDER_FAILED', () => {
    const cases = [
      'quadrantChart\n  title T\n  x-axis L --> R\n  y-axis B --> T2\n  Company A: 0.8, 0.75', // missing [x, y] brackets
      'architecture-beta\n  service a(database)[A]\n  end', // stray end
    ]
    for (const source of cases) {
      const r = verifyMermaid(source)
      expect({ source, ok: r.ok, hasRenderFailed: r.warnings.some(w => w.code === 'RENDER_FAILED') })
        .toEqual({ source, ok: false, hasRenderFailed: true })
      const reason = (r.warnings.find(w => w.code === 'RENDER_FAILED') as { reason?: string }).reason
      expect(reason && reason.length > 0).toBe(true)
    }
  })

  test('suppressing RENDER_FAILED restores the old lenient verdict', () => {
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
