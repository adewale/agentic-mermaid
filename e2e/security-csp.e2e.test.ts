import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { chromium, type Browser, type Page } from 'playwright'
import { renderMermaidSVG } from '../src/index.ts'
import { serveWithAvailablePort } from './test-port.ts'

const PREFERRED_PORT = 4571
let BASE = ''
const NONCE = 'agentic-mermaid-csp-test'

const HOSTILE_SOURCE = `---
config:
  themeCSS: |
    @import/**/"//evil.example/comment.css"
    .xychart-title { fill: ur\\l(https://evil.example/simple-escape.svg); }
    </style><svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script><object data="//evil.example/x"></object><use href="https:&amp;#x2f;&amp;#x2f;evil.example/entity.svg#x"/>
---
xychart
  title Revenue
  bar [10, 20]`

const SAFE_SOURCE = `xychart
  title Revenue
  bar [10, 20]`

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let page: Page
let strictSvg = ''

beforeAll(async () => {
  strictSvg = renderMermaidSVG(SAFE_SOURCE, { security: 'strict' })
  const served = serveWithAvailablePort({
    preferredPort: PREFERRED_PORT,
    fetch() {
      const csp = [
        "default-src 'none'",
        `script-src 'nonce-${NONCE}'`,
        "style-src 'unsafe-inline'",
        "img-src 'none'",
        "font-src 'none'",
        "connect-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "require-trusted-types-for 'script'",
        'trusted-types agentic-mermaid-test',
      ].join('; ')
      const html = `<!doctype html>
<meta charset="utf-8">
<title>TT CSP Mermaid test</title>
<div id="target"></div>
<script nonce="${NONCE}">
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__violations.push({ violatedDirective: e.violatedDirective, effectiveDirective: e.effectiveDirective, blockedURI: e.blockedURI });
  });
  const svg = ${JSON.stringify(strictSvg)};
  window.__trustedTypesPresent = typeof trustedTypes !== 'undefined';
  try {
    document.getElementById('target').innerHTML = svg;
    window.__stringAssignmentBlocked = false;
  } catch (e) {
    window.__stringAssignmentBlocked = e && e.name === 'TypeError';
  }
  const policy = trustedTypes.createPolicy('agentic-mermaid-test', { createHTML: (s) => s });
  document.getElementById('target').innerHTML = policy.createHTML(svg);
  window.__rendered = document.querySelector('#target svg') !== null;
  window.__html = document.getElementById('target').innerHTML;
  window.__done = true;
</script>`
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp } })
    },
  })
  server = served.server
  BASE = served.base
  browser = await chromium.launch()
  page = await browser.newPage()
}, 120_000)

afterAll(async () => {
  try { await browser?.close() } catch {}
  server?.stop()
})

describe('Trusted Types + strict CSP browser verification', () => {
  it('rejects raw Mermaid themeCSS before producing strict SVG', () => {
    expect(() => renderMermaidSVG(HOSTILE_SOURCE, { security: 'strict' }))
      .toThrow('Raw Mermaid themeCSS is not allowed in strict security mode')
  })

  it('strict SVG can be inserted with a TrustedHTML policy and makes no external requests', async () => {
    const externalRequests: string[] = []
    page.on('request', req => {
      if (!req.url().startsWith(BASE)) externalRequests.push(req.url())
    })

    const response = await page.goto(BASE, { waitUntil: 'load' })
    expect(response?.headers()['content-security-policy']).toContain("require-trusted-types-for 'script'")
    await page.waitForFunction(() => (window as any).__done === true, undefined, { timeout: 30_000 })
    await page.waitForFunction(() => ((window as any).__violations ?? []).length >= 1, undefined, { timeout: 30_000 })

    const result = await page.evaluate(() => ({
      trustedTypesPresent: (window as any).__trustedTypesPresent,
      stringAssignmentBlocked: (window as any).__stringAssignmentBlocked,
      rendered: (window as any).__rendered,
      html: (window as any).__html as string,
      violations: (window as any).__violations as Array<{ violatedDirective: string; effectiveDirective: string; blockedURI: string }>,
    }))

    expect(result.trustedTypesPresent).toBe(true)
    expect(result.stringAssignmentBlocked).toBe(true)
    expect(result.rendered).toBe(true)
    expect(result.html).not.toContain('evil.example')
    expect(result.html).not.toMatch(/<(?:[^\s<>/:]+:)?script\b|<object\b|<embed\b|<iframe\b|<image\b/i)
    expect(result.html).not.toMatch(/\son[a-z][\w:.-]*\s*=/i)
    expect(result.violations.length).toBeGreaterThanOrEqual(1)
    expect(result.violations.every(v => v.effectiveDirective === 'require-trusted-types-for')).toBe(true)
    expect(externalRequests).toEqual([])
  }, 120_000)
})
