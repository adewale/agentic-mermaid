import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'

const SOURCE = `flowchart TD
  accTitle: Post pass contract
  accDescr: Accessibility survives namespacing
  A[Start] --> B[Finish]
  click A "https://example.com/private"`

describe('SVG post-pass interaction contract', () => {
  for (const style of [undefined, 'hand-drawn'] as const) {
    test(`${style ?? 'crisp'}: colors, identity, ARIA, strict security, namespacing, and compacting compose`, () => {
      const options = { idPrefix: 'probe-', security: 'strict' as const, compact: true, ...(style ? { style, seed: 7 } : {}) }
      const first = renderMermaidSVG(SOURCE, options)
      const second = renderMermaidSVG(SOURCE, options)
      expect(second).toBe(first)
      expect(first).toContain('id="probe-svg-title"')
      expect(first).toContain('aria-labelledby="probe-svg-title"')
      expect(first).toContain('aria-describedby="probe-svg-desc"')
      expect(first).toContain('data-id="A"')
      expect(first).not.toContain('data-id="probe-A"')
      expect(first).toContain('data-href="https://example.com/private"')
      expect(first).not.toMatch(/\s(?:xlink:)?href="https:\/\//)
      expect(verifyNoExternalRefs(first).ok).toBe(true)
      expect(first).not.toMatch(/(?:fill|stroke)="var\(--/)
    })
  }
})
