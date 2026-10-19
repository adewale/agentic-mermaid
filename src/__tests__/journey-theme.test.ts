/**
 * Journey-specific theme coverage for built-in light and dark palettes.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { verifyMermaid } from '../agent/index.ts'
import { BUILTIN_PALETTE_DEFINITIONS, type BuiltinPaletteDefinition } from '../palette-catalog.ts'
import { getStyle } from '../scene/style-registry.ts'

/** The catalog's colors for a built-in palette, so expectations track the catalog. */
const paletteColors = (name: string): BuiltinPaletteDefinition['colors'] =>
  (BUILTIN_PALETTE_DEFINITIONS as readonly BuiltinPaletteDefinition[]).find(p => p.inputName === name)!.colors

/** A paint attribute of the first element drawn with a class token. */
const drawnPaint = (svg: string, cls: string, property: string) =>
  svg.match(new RegExp(`<[a-z]+\\b[^>]*\\bclass="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>`))?.[0]
    .match(new RegExp(`\\s${property}="([^"]*)"`))?.[1]

const source = `journey
  title My working day
  section Go to work
  Make tea: 5: Me
  Go upstairs: 3: Me
  section Go home
  Sit down: 3: Me`

describe('renderMermaidSVG – journey themes', () => {
  it('renders correctly with the built-in light theme palette', () => {
    const svg = renderMermaidSVG(source, { style: 'github-light' })

    const { bg, fg, accent, line } = paletteColors('github-light')
    for (const [token, value] of [['bg', bg], ['fg', fg], ['accent', accent], ['line', line]]) {
      expect(svg).toContain(`--${token}:${value}`)
    }
    expect(svg).toContain('class="journey-task-box"')
    expect(svg).toContain('class="journey-score-marker"')
    expect(svg).not.toContain('NaN')
  })

  it('renders correctly with the built-in dark theme palette', () => {
    const svg = renderMermaidSVG(source, { style: 'github-dark' })

    const { bg, fg, accent, line } = paletteColors('github-dark')
    for (const [token, value] of [['bg', bg], ['fg', fg], ['accent', accent], ['line', line]]) {
      expect(svg).toContain(`--${token}:${value}`)
    }
    expect(svg).toContain('class="journey-task-box"')
    expect(svg).toContain('class="journey-score-marker"')
    expect(svg).not.toContain('NaN')
  })

  it('routes Mermaid journey config into colors, fonts, and geometry', () => {
    const svg = renderMermaidSVG(`%%{init: {"journey": {"actorColours": ["#123456", "#abcdef"], "sectionFills": ["#331122"], "sectionColours": ["#fedcba"], "taskFontSize": 19, "taskFontFamily": "Courier New", "titleColor": "#0f172a", "titleFontSize": 22, "titleFontFamily": "Georgia", "taskMargin": 80, "width": 180, "maxLabelWidth": 80}}}%%
journey
  title Configured Journey
  section Login
    Open app: 5: Primary Actor
    Enter one time password: 3: Secondary Actor`)

    expect(drawnPaint(svg, 'journey-actor-0', 'fill')).toBe('#123456')
    expect(drawnPaint(svg, 'journey-actor-1', 'fill')).toBe('#abcdef')
    expect(drawnPaint(svg, 'journey-section-0', 'fill')).toBe('#331122')
    expect(drawnPaint(svg, 'journey-section-label-0', 'fill')).toBe('#fedcba')
    expect(svg).toContain('.journey-task-text {')
    expect(svg).toContain('font-family: Courier New;')
    expect(svg).toContain('font-size="19"')
    expect(svg).toContain('font-size="22"')
    expect(svg).toContain('font-family="Georgia"')
    expect(drawnPaint(svg, 'journey-title', 'fill')).toBe('#0f172a')
    expect(svg).not.toContain('NaN')
  })

  it.each([
    ['taskFontFamily', 'x; } text { fill: red }'],
    ['taskFontFamily', 'url(https://example.com/font.woff)'],
    ['titleFontFamily', 'Georgia; } * { fill: red'],
  ])('ignores an unsafe %s and warns instead of writing it into CSS', (key, value) => {
    const source = `%%{init: {"journey": {"${key}": ${JSON.stringify(value)}}}}%%
journey
  title Configured Journey
  section Login
    Open app: 5: Primary Actor`
    const svg = renderMermaidSVG(source)
    expect(svg).not.toContain('fill: red')
    expect(svg).not.toContain('url(https://example.com')
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', message: expect.stringContaining(`journey.${key} must be`) }))
  })

  it('lets explicit Mermaid journey config override named style colors', () => {
    const svg = renderMermaidSVG(`%%{init: {"journey": {"actorColours": ["#123456"], "sectionFills": ["#331122"], "sectionColours": ["#fedcba"], "titleColor": "#0f172a"}}}%%
journey
  title Configured Journey
  section Login
    Open app: 5: Primary Actor`, { style: 'status-dashboard' })

    expect(drawnPaint(svg, 'journey-actor-0', 'fill')).toBe('#123456')
    expect(drawnPaint(svg, 'journey-section-0', 'fill')).toBe('#331122')
    expect(drawnPaint(svg, 'journey-section-label-0', 'fill')).toBe('#fedcba')
    expect(drawnPaint(svg, 'journey-title', 'fill')).toBe('#0f172a')
  })

  it('uses Agentic palette/style colors for Journey-specific channels', () => {
    const svg = renderMermaidSVG(source, { style: 'look:tufte' })
    const { bg, fg, accent } = getStyle('look:tufte')!.colors!
    const color = (cls: string, property: string) => drawnPaint(svg, cls, property)

    expect(svg).toContain(`--accent:${accent}`)
    // The journey-only channels follow the style's palette, not fixed defaults.
    expect({
      baseline: color('journey-baseline', 'stroke'),
      scoreFace: color('journey-score-face', 'stroke'),
      title: color('journey-title', 'fill'),
      actorDot: color('journey-actor-dot', 'stroke'),
    }).toEqual({ baseline: accent, scoreFace: accent, title: fg, actorDot: bg })
  })
})
