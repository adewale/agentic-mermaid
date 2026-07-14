import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../agent/index.ts'

const BASIC = 'radar-beta\n  title Skills\n  axis speed["Speed"], power["Power"], range["Range"]\n  curve now["Current"]{4, 3, 5}\n  curve goal["Target"]{5, 5, 4}\n  max 5'

describe('radar SVG renderer', () => {
  test('emits an svg with rings, spokes, filled areas, dots, legend, and title', () => {
    const svg = renderMermaidSVG(BASIC)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('aria-roledescription="radar chart"')
    expect((svg.match(/class="radar-ring/g) ?? []).length).toBe(5) // default ticks
    expect((svg.match(/class="radar-axis-line"/g) ?? []).length).toBe(3) // spokes
    expect((svg.match(/class="radar-area"/g) ?? []).length).toBe(2) // curves
    expect((svg.match(/class="radar-dot"/g) ?? []).length).toBe(6) // 2 curves × 3 axes
    expect(svg).toContain('class="radar-legend-swatch"')
    expect(svg).toContain('>Speed<') // axis label
    expect(svg).toContain('>Skills<') // title
  })

  test('showLegend false removes legend marks without removing curve geometry', () => {
    const svg = renderMermaidSVG(BASIC + '\n  showLegend false')
    expect(svg).not.toContain('<rect class="radar-legend-swatch"')
    expect(svg).not.toContain('<text class="radar-legend-text"')
    expect((svg.match(/class="radar-area"/g) ?? [])).toHaveLength(2)
  })

  test('circle graticule uses <circle> rings and a smooth <path> area; polygon uses <polygon>', () => {
    const circle = renderMermaidSVG(BASIC)
    expect(circle).toMatch(/<circle class="radar-ring/)
    expect(circle).toMatch(/<path class="radar-area" d="M[^"]*C/) // Catmull-Rom cubic

    const poly = renderMermaidSVG(BASIC + '\n  graticule polygon')
    expect(poly).toMatch(/<polygon class="radar-ring/)
    expect(poly).toMatch(/<polygon class="radar-area"/)
  })

  test('translucent fills via fill-opacity, dot vertices carry the series color', () => {
    const svg = renderMermaidSVG(BASIC)
    expect(svg).toMatch(/class="radar-area"[^>]*fill-opacity="0\.5"/)
    const areaFills = [...svg.matchAll(/class="radar-area"[^>]*fill="([^"]+)"/g)].map(match => match[1])
    const dotFills = [...svg.matchAll(/class="radar-dot"[^>]*fill="([^"]+)"/g)].map(match => match[1])
    expect(new Set(areaFills).size).toBe(2)
    expect(dotFills).toEqual([areaFills[0], areaFills[0], areaFills[0], areaFills[1], areaFills[1], areaFills[1]])
  })

  test('renders frontmatter title as visible and accessible document furniture', () => {
    const svg = renderMermaidSVG('---\ntitle: "Grades"\n---\nradar-beta\n  axis a, b, c\n  curve x{1,2,3}\n  max 5')
    expect(svg).toContain('class="radar-title"')
    expect(svg).toContain('>Grades<')
    expect(svg).toMatch(/aria-labelledby="[^"]+-title"/)
  })

  test('gives untitled charts an accessible name and parses accDescr blocks with a colon', () => {
    const unnamed = renderMermaidSVG('radar-beta\n  axis a, b\n  curve x{1,2}\n  max 3')
    expect(unnamed).toMatch(/aria-labelledby="[^"]+-title"/)
    expect(unnamed).toMatch(/<title id="[^"]+-title">Radar chart<\/title>/)

    const described = renderMermaidSVG('radar-beta\n  accTitle: Coverage\n  accDescr: {\n    First line\n    Second line\n  }\n  axis a, b\n  curve x{1,2}\n  max 3')
    expect(described).toContain('First line\nSecond line')
    expect(described).toMatch(/aria-describedby="[^"]+-desc"/)
  })

  test('disambiguates semantic identities for duplicate upstream curve and axis ids', () => {
    const svg = renderMermaidSVG('radar-beta\n  axis a, a\n  curve x{1,2}\n  curve x{2,1}\n  max 3')
    const ids = [...svg.matchAll(/data-id="([^"]+)"/g)].map(match => match[1]!)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('render is deterministic', () => {
    expect(renderMermaidSVG(BASIC)).toBe(renderMermaidSVG(BASIC))
  })

  test('renders across a Look × Palette pair without NaN or empty geometry', () => {
    const svg = renderMermaidSVG(BASIC, { style: ['hand-drawn', 'dracula'] } as never)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).not.toContain('NaN')
    expect(svg.length).toBeGreaterThan(500)
  })
})
