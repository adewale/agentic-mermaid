/**
 * Loop 8 M3 — SVG `compact` mode.
 *
 * Asserts:
 *  - Compact output has no decimals with 3+ fractional digits (rounded via
 *    roundCoord).
 *  - Compact output has no newlines outside <style> blocks (collapsed).
 *  - `data-*` attribute set is IDENTICAL between compact and non-compact —
 *    they're agent inspection hooks per Loop 7 audit.
 *  - `class=` attribute set is IDENTICAL between compact and non-compact.
 *  - Compact form is strictly smaller (or equal) than the non-compact form
 *    for realistic graphs.
 *  - `compactSvg` is idempotent on already-compact input.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { compactSvg, roundCoord } from '../renderer.ts'

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
  it('roundCoord rounds to 3 decimal places', () => {
    expect(roundCoord(1.2345678)).toBe(1.235)
    expect(roundCoord(100.0001)).toBe(100)
    expect(roundCoord(0)).toBe(0)
    expect(roundCoord(-3.14159)).toBe(-3.142)
  })

  it('compactSvg is a pure function and idempotent', () => {
    const svg = renderMermaidSVG(SRC, { compact: true })
    expect(compactSvg(svg)).toBe(svg)
  })

  it('compact output has no decimals with 4+ fractional digits (rounded to 3)', () => {
    const svg = renderMermaidSVG(SRC, { compact: true })
    // Pull out style blocks (CSS may legitimately have e.g. 100.000% — none today, but safe).
    const noStyle = svg.replace(/<style\b[\s\S]*?<\/style>/gi, '')
    // The plan calls for "no `\.\d{3,}` digits" — meaning 3-or-more isn't
    // strictly correct because roundCoord produces up to 3 fractional digits.
    // The intent (catch unrounded float spam) is satisfied by checking 4+ digits.
    expect(noStyle).not.toMatch(/\d+\.\d{4,}/)
  })

  it('non-compact output DOES have long-decimal coords from ELK (sanity check on the SRC)', () => {
    // This is a guard rail: if ELK suddenly starts rounding internally, the
    // "compact is strictly smaller" assertion would become a coincidence.
    const plain = renderMermaidSVG(SRC, { compact: false })
    expect(plain).toMatch(/\d+\.\d{4,}/)
  })

  it('compact output has no newlines outside <style> blocks', () => {
    const svg = renderMermaidSVG(SRC, { compact: true })
    const noStyle = svg.replace(/<style\b[\s\S]*?<\/style>/gi, '')
    expect(noStyle).not.toContain('\n')
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
