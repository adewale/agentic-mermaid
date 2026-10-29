/**
 * Architecture-specific theme coverage for built-in light and dark palettes.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'
import { scanSvgStartTags, svgAttribute } from '../svg-structure.ts'
import type { RenderOptions } from '../types.ts'

const source = `architecture-beta
  group app(cloud)[Application]
  service api(server)[Public API] in app
  service db(database)[Primary DB]
  api:R --> L:db`

// Architecture emits separate fill and outline shapes. Crisp outlines inherit
// their class rule; rough/hybrid outlines carry their own actual stroke paint.
function outlineInk(svg: string, id: string, className: string): string {
  const outline = scanSvgStartTags(svg).find(tag => svgAttribute(tag, 'data-id')?.value === id)
  expect(outline, `actual outline ${id}`).toBeDefined()
  const direct = svgAttribute(outline!, 'stroke')?.value
  if (direct !== undefined) return direct
  expect(svgAttribute(outline!, 'class')?.value.split(/\s+/)).toContain(className)
  const rule = svg.match(new RegExp(`\\.${className}\\s*\\{([^}]+)\\}`))?.[1]
  const ink = rule?.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/)?.[1]?.trim()
  expect(ink, `actual CSS stroke for ${className}`).toBeDefined()
  return ink!
}

const outlines = [
  { id: 'group-outline:app', className: 'architecture-group-outline' },
  { id: 'service-outline:api', className: 'architecture-service-outline' },
  { id: 'service-outline:db', className: 'architecture-service-outline' },
]

describe('renderMermaidSVG – architecture themes', () => {
  it('renders correctly with the built-in light theme palette', () => {
    const svg = renderMermaidSVG(source, { style: 'github-light' })

    expect(svg).toContain('--bg:#ffffff')
    expect(svg).toContain('--fg:#1f2328')
    expect(svg).toContain('--accent:#0969da')
    expect(svg).toContain('--line:#d1d9e0')
    expect(svg).toContain('class="architecture-service-card"')
    expect(svg).not.toContain('NaN')
  })

  it('renders correctly with the built-in dark theme palette', () => {
    const svg = renderMermaidSVG(source, { style: 'github-dark' })

    expect(svg).toContain('--bg:#0d1117')
    expect(svg).toContain('--fg:#e6edf3')
    expect(svg).toContain('--accent:#4493f8')
    expect(svg).toContain('--line:#3d444d')
    expect(svg).toContain('class="architecture-service-card"')
    expect(svg).not.toContain('NaN')
  })

  it('uses repaired shared outline ink for palette borders in every backend', () => {
    const cases: { options: RenderOptions; page: string }[] = [
      { options: {}, page: '#FFFFFF' },
      { options: { style: ['hand-drawn', 'dracula'] }, page: '#282a36' },
      { options: { style: ['watercolor', 'dracula'] }, page: '#282a36' },
      { options: { bg: '#282a36', fg: '#f8f8f2', border: '#292a36' }, page: '#282a36' },
    ]
    for (const { options, page } of cases) {
      const svg = renderMermaidSVG(source, options)
      for (const { id, className } of outlines) {
        const ink = outlineInk(svg, id, className)
        expect(wcagContrastRatio(ink, page), `${id}: ${ink} against ${page}`).toBeGreaterThanOrEqual(3)
      }
      if (options.border) expect(svg).toContain(`--border:${options.border}`)
      expect(svg).not.toContain('NaN')
    }
  })

  for (const ink of ['#292a36', 'none', 'currentColor', 'midnightblue', 'rgb(41,42,54)', 'hsl(240,10%,18%)', 'var(--border)']) {
    it(`preserves admitted role, Mermaid theme, and architecture visual border paint ${ink}`, () => {
      const alias = ink === 'var(--border)'
      const expected = alias ? '#292a36' : ink
      for (const look of ['default', 'hand-drawn', 'watercolor']) {
        const base: RenderOptions = {
          style: look === 'default' ? 'dracula' : [look, 'dracula'],
          ...(alias ? { border: expected } : {}),
        }
        const cases: { origin: string; options: RenderOptions }[] = [
          { origin: 'theme', options: { ...base, mermaidConfig: { themeVariables: { clusterBorder: ink, primaryBorderColor: ink } } } },
          { origin: 'visual', options: { ...base, architecture: { visual: { groupBorder: ink, serviceBorder: ink } } } },
        ]
        // Public roles admit concrete paints, while theme and visual paint
        // inputs additionally admit aliases. Preserve that admission boundary.
        if (!alias) cases.push({ origin: 'role', options: {
          ...base,
          style: [...(Array.isArray(base.style) ? base.style : [base.style!]), { roles: { node: { borderColor: ink }, group: { borderColor: ink } } }],
        } })
        for (const { origin, options } of cases) {
          const svg = renderMermaidSVG(source, options)
          for (const { id, className } of outlines) expect(outlineInk(svg, id, className), `${look} ${origin} ${id}`).toBe(expected)
          if (alias) expect(svg).toContain(`--border:${expected}`)
        }
      }
    })
  }

  it('retains the concrete-paint admission boundary for role borders', () => {
    expect(() => renderMermaidSVG(source, {
      style: { roles: { node: { borderColor: 'var(--border)' } } },
    })).toThrow('roles.node.borderColor')
  })
})
