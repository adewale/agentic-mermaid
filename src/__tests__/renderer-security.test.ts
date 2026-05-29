// Loop 11 M3 (#7645/#7695): strict security mode — no external fetch in
// agent-generated diagram output.

import { describe, test, expect } from 'bun:test'
import { renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'

describe('#7645/#7695 strict security mode', () => {
  test('strict mode SVG has zero external-fetch references', () => {
    const svg = renderMermaidSVG('flowchart TD\n A[Start] --> B[End]', { security: 'strict' })
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
  })

  test('default mode still emits the Google Fonts @import (back-compat)', () => {
    const svg = renderMermaidSVG('flowchart TD\n A --> B')
    const v = verifyNoExternalRefs(svg)
    expect(v.ok).toBe(false)
    expect(v.refs.some(r => r.includes('fonts.googleapis.com'))).toBe(true)
  })

  test('strict mode preserves the --font CSS variable (family still declared)', () => {
    const svg = renderMermaidSVG('flowchart TD\n A --> B', { security: 'strict' })
    expect(svg).toContain('--font')
  })

  test('strict mode works across families', () => {
    for (const src of [
      'sequenceDiagram\n A->>B: hi',
      'classDiagram\n A <|-- B',
      'erDiagram\n A ||--o{ B : x',
      'stateDiagram-v2\n [*] --> S',
    ]) {
      const svg = renderMermaidSVG(src, { security: 'strict' })
      expect(verifyNoExternalRefs(svg).ok).toBe(true)
    }
  })

  test('xmlns namespace declaration is NOT flagged as an external ref', () => {
    // The SVG always carries xmlns="http://www.w3.org/2000/svg" — a declaration,
    // not a fetch. verifyNoExternalRefs must not flag it.
    const svg = renderMermaidSVG('flowchart TD\n A --> B', { security: 'strict' })
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(verifyNoExternalRefs(svg).ok).toBe(true)
  })

  test('verifyNoExternalRefs flags an @import', () => {
    const v = verifyNoExternalRefs('<svg><style>@import url(https://evil.example/x.css);</style></svg>')
    expect(v.ok).toBe(false)
    expect(v.refs.length).toBeGreaterThan(0)
  })

  test('verifyNoExternalRefs flags <image>, <script>, http href', () => {
    expect(verifyNoExternalRefs('<svg><image href="https://x/y.png"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><script>fetch("//x")</script></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><a href="https://x">t</a></svg>').ok).toBe(false)
  })

  test('a clean inline SVG passes', () => {
    expect(verifyNoExternalRefs('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toEqual({ ok: true, refs: [] })
  })
})
