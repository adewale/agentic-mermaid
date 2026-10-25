// ============================================================================
// Quadrant interactive tooltips — the same `interactive` RenderOptions
// affordance xychart ships, built on the shared SVG tooltip primitive
// (src/shared/svg-tooltip.ts) rather than a copy. Hover chrome appears only
// when `interactive: true`; the default output is byte-unchanged.
// ============================================================================

import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

const SRC = `quadrantChart
  title Reach and engagement of campaigns
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  Campaign A: [0.3, 0.6]
  Campaign B: [0.45, 0.23]`

describe('quadrant interactive tooltips', () => {
  it('static renders carry no hover chrome', () => {
    const svg = renderMermaidSVG(SRC)
    expect(svg).not.toContain('quadrant-point-group')
    expect(svg).not.toContain('quadrant-tip')
  })

  it('interactive renders add hover groups, native titles, and tooltip chrome per point', () => {
    const svg = renderMermaidSVG(SRC, { interactive: true })
    expect((svg.match(/quadrant-point-group/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(svg).toContain('<title>Campaign A: [0.3, 0.6]</title>')
    expect(svg).toContain('<title>Campaign B: [0.45, 0.23]</title>')
    expect(svg).toContain('quadrant-tip-bg')
    expect(svg).toMatch(/\.quadrant-point-group:hover \.quadrant-tip/)
  })

  it('interactive output is deterministic', () => {
    expect(renderMermaidSVG(SRC, { interactive: true })).toBe(renderMermaidSVG(SRC, { interactive: true }))
  })


  it('xychart interactive output still renders its tooltip chrome through the shared module', () => {
    const xy = renderMermaidSVG(
      'xychart\n  x-axis [Q1, Q2]\n  y-axis Revenue 0 --> 100\n  bar [10, 20]',
      { interactive: true },
    )
    expect(xy).toContain('xychart-bar-group')
    expect(xy).toContain('xychart-tip xychart-tip-bg')
  })
})
