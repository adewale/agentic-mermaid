// Loop 11 M3 (#7645/#7695): strict security mode — no external fetch in
// agent-generated diagram output.

import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { SaxesParser } from 'saxes'
import { applyOutputSecurityPolicy, renderMermaidSVG, verifyNoExternalRefs, verifySvgDocumentEnvelope } from '../index.ts'
import { inspectSvgOnce, withSvgInspectionCache } from '../svg-inspection-cache.ts'

const svgDocument = (body: string, attributes = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg"${attributes}>${body}</svg>`

describe('public SVG emission defaults', () => {
  test.each(['cold', 'warm'] as const)('%s rendering ignores inherited presentation defaults', phase => {
    const program = `
      const { renderMermaidSVGWithReceipt, applyOutputSecurityPolicy } = await import('./src/index.ts')
      const { sceneAssertionsEnabled } = await import('./src/scene/assertions.ts')
      const expected = process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS
      if (!['0', '1'].includes(expected) || sceneAssertionsEnabled() !== (expected === '1')) throw new Error('actual child Scene mode differs')
      console.log('SVG_DEFAULT_MODE ' + JSON.stringify({ actual: sceneAssertionsEnabled(), expected }))
      const source = 'sequenceDiagram\\n  A->>B: Hello 🚀 é'
      const render = () => renderMermaidSVGWithReceipt(source, { embedFontImport: false })
      const phase = process.env.SVG_DEFAULT_PHASE
      if (phase === 'warm') render()
      const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'fallback')
      if (prior) throw new Error('preexisting fallback in isolated child')
      let artifact
      try {
        if (phase !== 'control') Object.defineProperty(Object.prototype, 'fallback', { value: 'inherited', configurable: true, writable: true })
        artifact = render()
      } finally { delete Object.prototype.fallback }
      if (Object.getOwnPropertyDescriptor(Object.prototype, 'fallback')) throw new Error('prototype not restored')
      const secured = applyOutputSecurityPolicy(artifact.svg, 'strict')
      if (secured.svg !== artifact.svg || secured.diagnostics.length) throw new Error('secured output differs')
      // Standard FNV-1a over JSON's UTF-16 code units, independently of the
      // production two-lane implementation and including an astral label.
      const text = JSON.stringify(artifact.svg)
      let hash = 0xcbf29ce484222325n
      for (let index = 0; index < text.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * 0x100000001b3n)
      if (artifact.receipt.graphicalProjectionDigest !== 'fnv1a64:' + hash.toString(16).padStart(16, '0')) throw new Error('receipt does not bind secured output')
      console.log('SVG_DEFAULT_ARTIFACT ' + JSON.stringify(artifact))
    `
    const observe = (selected: string) => {
      const child = spawnSync(process.execPath, ['--eval', program], {
        cwd: join(import.meta.dir, '../..'), env: { ...process.env, SVG_DEFAULT_PHASE: selected }, encoding: 'utf8', timeout: 30_000,
      })
      console.log('SVG_DEFAULT_CHILD ' + JSON.stringify({ phase: selected, status: child.status, signal: child.signal,
        error: child.error ? { name: child.error.name, message: child.error.message } : null, stdout: child.stdout, stderr: child.stderr }))
      expect(child.error).toBeUndefined()
      expect(child.status).toBe(0)
      const modes = child.stdout.split('\n').filter(line => line.startsWith('SVG_DEFAULT_MODE '))
      expect(modes).toHaveLength(1)
      expect(JSON.parse(modes[0]!.slice('SVG_DEFAULT_MODE '.length))).toEqual({
        actual: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS === '1', expected: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS,
      })
      const rows = child.stdout.split('\n').filter(line => line.startsWith('SVG_DEFAULT_ARTIFACT '))
      expect(rows).toHaveLength(1)
      return JSON.parse(rows[0]!.slice('SVG_DEFAULT_ARTIFACT '.length)) as { svg: string; receipt: unknown }
    }
    const pristine = observe('control')
    const observed = observe(phase)
    expect(observed.svg).toContain('Hello 🚀 é')
    expect(observed.svg).not.toMatch(/\s(?:stroke|stroke-width|stroke-linejoin|paint-order)="inherited"/)
    expect(observed).toEqual(pristine)
  })
})

describe('#7645/#7695 strict security mode', () => {
  test('strict mode SVG has zero external-fetch references', () => {
    const svg = renderMermaidSVG('flowchart TD\n A[Start] --> B[End]', { security: 'strict' })
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
  })

  test('default mode has zero external-fetch references', () => {
    const svg = renderMermaidSVG('flowchart TD\n A --> B')
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: true, refs: [] })
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
    })).toThrow('safe, non-fetching CSS paint')
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
    expect(() => renderMermaidSVG('flowchart TD\n A --> B', {
      security: 'strict',
      mermaidConfig: { themeVariables: { primaryColor: 'url(https://evil.example/fill.svg)', secondaryColor: 'url(javascript:alert(1))' } } as any,
    })).toThrow('themeVariables.primaryColor: "url(https://evil.example/fill.svg)" is not a CSS color')
    const flow = renderMermaidSVG('flowchart TD\n A --> B', {
      security: 'strict',
      mermaidConfig: { themeVariables: { secondaryColor: 'url(javascript:alert(1))' } } as any,
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

  test('all modes reject active CSS schemes split by a CSS line continuation', () => {
    const continuedScheme = `jav${'\\'}\nascript:alert(1)`
    const documents = [
      svgDocument(`<rect style="fill:url(${continuedScheme})"/>`),
      svgDocument(`<style>rect { fill:url(${continuedScheme}) }</style>`),
    ]
    for (const document of documents) {
      for (const mode of ['default', 'strict'] as const) {
        expect(() => applyOutputSecurityPolicy(document, mode)).toThrow(/active content/i)
      }
    }
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
    expect(verifyNoExternalRefs('<svg xml:base="https://evil.example/s.svg"><use href="#x"/></svg>')).toEqual({
      ok: false,
      refs: ['xml:base=https://evil.example/s.svg'],
    })
    expect(() => applyOutputSecurityPolicy(svgDocument('<use href="#x"/>', ' xml:base="https://evil.example/s.svg"'), 'strict'))
      .toThrow('strict verification failed')
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

  test('escaped tag-like label text stays text while real active elements fail closed', () => {
    const escaped = svgDocument('<text>&lt;script&gt;alert(1)&lt;/script&gt; &lt;image href=&quot;//example.invalid/x&quot;/&gt;</text>')
    expect(applyOutputSecurityPolicy(escaped, 'strict')).toEqual({ svg: escaped, diagnostics: [] })
    expect(verifyNoExternalRefs(escaped)).toEqual({ ok: true, refs: [] })
    expect(applyOutputSecurityPolicy(svgDocument('<!-- <script src="//example.invalid/x"/> --><text>safe</text>'), 'strict').diagnostics).toEqual([])
    expect(() => applyOutputSecurityPolicy(svgDocument('<script>alert(1)</script>'))).toThrow('rejected active content')
    expect(() => applyOutputSecurityPolicy(svgDocument('<animate attributeName="opacity" from="0" to="1"/>'))).toThrow('rejected active content')
    expect(verifyNoExternalRefs('<svg><image href="#local"/></svg>').ok).toBe(false)
  })

  test('a clean inline SVG passes', () => {
    expect(verifyNoExternalRefs('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toEqual({ ok: true, refs: [] })
  })

  test.each([
    { name: 'XML envelope', owner: 'xml-envelope', svg: svgDocument('<g>'), forged: true,
      check: (svg: string) => expect(verifySvgDocumentEnvelope(svg)).toBe(false) },
    { name: 'active content', owner: 'final-security', svg: svgDocument('<script>alert(1)</script>'), forged: { active: [], refs: [] },
      check: (svg: string) => expect(() => applyOutputSecurityPolicy(svg)).toThrow('rejected active content') },
    { name: 'strict external references', owner: 'final-security', svg: svgDocument('<a href="https://example.invalid/"/>'), forged: { active: [], refs: [] },
      check: (svg: string) => expect(() => applyOutputSecurityPolicy(svg, 'strict')).toThrow('strict verification failed') },
    { name: 'reference inspection', owner: 'security', svg: svgDocument('<a href="https://example.invalid/"/>'), forged: { active: [], refs: [] },
      check: (svg: string) => expect(verifyNoExternalRefs(svg)).toEqual({ ok: false, refs: ['https://example.invalid/'] }) },
  ])('public inspection probes cannot replace $name decisions', ({ owner, svg, forged, check }) => {
    withSvgInspectionCache(() => {
      inspectSvgOnce(owner, svg, () => forged)
      check(svg)
    })
  })

  test.each([
    ['non-XML space after root', `${svgDocument('')}\u00a0`, svgDocument('<text>\u00a0</text>')],
    ['byte-order character after root', `${svgDocument('')}\ufeff`, `\ufeff${svgDocument('<text>\ufeff</text>')}`],
    ['uppercase hexadecimal reference prefix', svgDocument('<text>&#X41;</text>'), svgDocument('<text>&#x41; &#65;</text>')],
    ['digit at qualified attribute local-name start', svgDocument('', ' xmlns:p="urn:metadata" p:1="x"'), svgDocument('', ' xmlns:p="urn:metadata" p:_1="x"')],
    ['digit at namespace prefix start', svgDocument('', ' xmlns:1="urn:metadata"'), svgDocument('', ' xmlns:_1="urn:metadata" _1:value="x"')],
    ['repeatedly decoded namespace alias',
      svgDocument('', ' xmlns:p="urn:&#38;amp;amp;#x61;" xmlns:q="urn:&amp;amp;amp;#x61;" p:a="1" q:a="2"'),
      svgDocument('', ' xmlns:p="urn:&#38;amp;amp;#x61;" xmlns:q="urn:&amp;amp;amp;#x62;" p:a="1" q:a="2"')],
    ['literal namespace whitespace alias',
      svgDocument('', ' xmlns:p="urn:\tu" xmlns:q="urn: u" p:a="1" q:a="2"'),
      svgDocument('', ' xmlns:p="urn:&#x9;u" xmlns:q="urn: u" p:a="1" q:a="2"')],
  ])('final XML admission distinguishes %s from valid authored content', (_name, malformed, valid) => {
    expect(() => new SaxesParser({ xmlns: true }).write(valid).close()).not.toThrow()
    for (const mode of ['default', 'strict'] as const) {
      expect(applyOutputSecurityPolicy(valid, mode)).toEqual({ svg: valid, diagnostics: [] })
      expect(() => applyOutputSecurityPolicy(malformed, mode)).toThrow('invalid SVG document envelope')
    }
  })

  test('bounded XML admission pays repeated expanded namespace names before admitting a short document', () => {
    const attributes = Array.from({ length: 256 }, (_, index) => ` p:a${index}="x"`).join('')
    const svg = svgDocument('', ` xmlns:p="urn:${'u'.repeat(2_000)}"${attributes}`)
    expect(() => new SaxesParser({ xmlns: true }).write(svg).close()).not.toThrow()
    expect(verifySvgDocumentEnvelope(svg)).toBe(true)
    expect(svg.length).toBeLessThan(10_000)
    for (const [allowance, admitted] of [[400_000, false], [4_000_000, true]] as const) {
      let spent = 0
      const result = verifySvgDocumentEnvelope(svg, operations => {
        if (operations > allowance - spent) return false
        spent += operations
        return true
      })
      expect(result).toBe(admitted)
      expect(spent).toBeLessThanOrEqual(allowance)
      if (admitted) expect(spent).toBeGreaterThan(400_000)
    }
  })

  test('final inspection preserves raw attribute decoding and reference diagnostic order', () => {
    const encoded = 'javascript&amp;amp;amp;amp;#x3a;alert(1)'
    const svg = svgDocument(`<a href="${encoded}"/><rect fill="url(//paint/x)"/><image href="//image/x"/><style>@import url(//css/x);</style>`, ' xml:base="//base/x"')
    const refs = ['xml:base=//base/x', encoded, 'fill=url(//paint/x)', '//image/x', '@import', 'url(//css/x)', '<image>']
    expect(verifyNoExternalRefs(svg)).toEqual({ ok: false, refs })
    expect(applyOutputSecurityPolicy(svg).diagnostics).toEqual(refs.map(reference => ({ code: 'EXTERNAL_REFERENCE', reference })))
    expect(() => applyOutputSecurityPolicy(svg, 'strict')).toThrow(`OutputSecurityPolicy strict verification failed: ${refs.join(', ')}`)
    withSvgInspectionCache(() => {
      const first = verifyNoExternalRefs(svg)
      first.refs.length = 0
      const result = applyOutputSecurityPolicy(svg)
      result.diagnostics[0]!.reference = '#caller'
      expect(verifyNoExternalRefs(svg)).toEqual({ ok: false, refs })
      expect(applyOutputSecurityPolicy(svg).diagnostics).toEqual(refs.map(reference => ({ code: 'EXTERNAL_REFERENCE', reference })))
    })
  })

  test('retains distinct attribute and stylesheet handling when escaped CSS reveals a comment', () => {
    for (const paint of [
      String.raw`u\2f\2a x\2a\2f rl(https://example.invalid/fill.svg)`,
      String.raw`\26 #117;rl(relative.svg)`,
    ]) {
      const attribute = svgDocument(`<rect fill="${paint}"/>`)
      expect(applyOutputSecurityPolicy(attribute)).toEqual({
        svg: attribute,
        diagnostics: [{ code: 'EXTERNAL_REFERENCE', reference: `fill=${paint}` }],
      })
      expect(() => applyOutputSecurityPolicy(attribute, 'strict')).toThrow('strict verification failed')

      // The existing attribute policy applies its reference normalization twice;
      // stylesheet policy applies it once. Neither decoding step is idempotent.
      const stylesheet = svgDocument(`<style>rect{fill:${paint}}</style>`)
      expect(applyOutputSecurityPolicy(stylesheet, 'strict')).toEqual({ svg: stylesheet, diagnostics: [] })
    }
    expect(() => applyOutputSecurityPolicy(svgDocument(String.raw`<rect fill="\110000"/>`)))
      .toThrow(RangeError)
  })
})
