/**
 * Loop 8 M3 — SVG `compact` mode.
 *
 * Asserts:
 *  - Structural indentation between non-text elements is collapsed.
 *  - Geometry, authored text, accessibility, and XML attribute boundaries are
 *    never rewritten.
 *  - `data-*` attribute set is IDENTICAL between compact and non-compact —
 *    they're agent inspection hooks per Loop 7 audit.
 *  - `class=` attribute set is IDENTICAL between compact and non-compact.
 *  - Compact form is strictly smaller (or equal) than the non-compact form
 *    for realistic graphs.
 *  - `compactSvg` is idempotent on already-compact input.
 */
import { describe, it, expect } from 'bun:test'
import { applyOutputSecurityPolicy, renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { compactSvg } from '../renderer.ts'

// A small but realistic flowchart that exercises curves (ELK produces floats),
// labels, edge styles, and subgraphs.
const SRC = `flowchart TD
  subgraph S [Edge Layer]
    A[Client] --> B(Gateway)
  end
  B --> C{Auth?}
  C -- yes --> D[Service]
  C -- no  --> E[Reject]
  D --> F[(DB)]
`

function extractDataAttrs(svg: string): Set<string> {
  // Match data-XYZ="value" pairs.
  const set = new Set<string>()
  for (const m of svg.matchAll(/\bdata-[\w-]+="[^"]*"/g)) {
    set.add(m[0])
  }
  return set
}

function extractClassAttrs(svg: string): Set<string> {
  const set = new Set<string>()
  for (const m of svg.matchAll(/\bclass="[^"]*"/g)) {
    set.add(m[0])
  }
  return set
}

describe('Loop 8 M3 — SVG compact mode', () => {
  it('compactSvg is a pure function and idempotent', () => {
    const svg = renderMermaidSVG(SRC, { compact: true })
    expect(compactSvg(svg)).toBe(svg)
  })

  it('preserves authored decimal-looking text and generated geometry exactly', () => {
    const source = 'flowchart TD\n  A["A123.456789"] --> B["B987.654321"]'
    const plain = renderMermaidSVG(source, { compact: false })
    const compact = renderMermaidSVG(source, { compact: true })
    expect(compact).toContain('A123.456789')
    expect(compact).toContain('B987.654321')
    expect(compact.match(/\bd="[^"]+"/g)).toEqual(plain.match(/\bd="[^"]+"/g))
  })

  it('never joins XML attributes or rewrites quoted and accessible text', () => {
    const inert = '<svg xmlns="http://www.w3.org/2000/svg">\n  <title>A123.456789\n title</title>\n  <rect on\n load="alert(1)" data-note="line\n value" />\n</svg>'
    const compact = compactSvg(inert)
    expect(compact).toContain('on\n load=')
    expect(compact).not.toContain('onload=')
    expect(compact).toContain('A123.456789\n title')
    expect(compact).toContain('data-note="line\n value"')
    // Preserving the split keeps compaction from manufacturing an `onload`
    // attribute, but the original fragment is still malformed XML (`on` has
    // no value) and must fail the shared SVG document-envelope gate.
    expect(() => applyOutputSecurityPolicy(compact, 'strict'))
      .toThrow(/invalid SVG document envelope/i)
    expect(verifyNoExternalRefs(compact)).toEqual({ ok: true, refs: [] })
  })

  it('removes structural indentation between non-text elements', () => {
    expect(compactSvg('<svg>\n  <g>\n    <rect />\n  </g>\n</svg>'))
      .toBe('<svg><g><rect /></g></svg>')
  })

  it('data-* attribute set is IDENTICAL between compact and non-compact', () => {
    const plain = renderMermaidSVG(SRC, { compact: false })
    const compact = renderMermaidSVG(SRC, { compact: true })
    // The same data-from/data-to/data-shape/data-id/data-label attrs must
    // appear in both. We don't compare positions because compact strips
    // whitespace and may slightly reorder due to layout precision changes —
    // but the attribute *set* is invariant.
    expect(extractDataAttrs(compact)).toEqual(extractDataAttrs(plain))
  })

  it('class= attribute set is IDENTICAL between compact and non-compact', () => {
    const plain = renderMermaidSVG(SRC, { compact: false })
    const compact = renderMermaidSVG(SRC, { compact: true })
    expect(extractClassAttrs(compact)).toEqual(extractClassAttrs(plain))
  })

  it('compact output is strictly smaller than non-compact for realistic graphs', () => {
    const plain = renderMermaidSVG(SRC, { compact: false })
    const compact = renderMermaidSVG(SRC, { compact: true })
    expect(compact.length).toBeLessThan(plain.length)
  })

  it('default (no compact option) preserves the existing wire format', () => {
    // Back-compat: omitting `compact` defaults to false. The output should
    // contain newlines and unrounded floats, just as before Loop 8.
    const svg = renderMermaidSVG(SRC)
    expect(svg).toContain('\n')
  })
})
