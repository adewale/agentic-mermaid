/**
 * Journey-specific theme coverage for built-in light and dark palettes.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { BUILTIN_PALETTE_DEFINITIONS, type BuiltinPaletteDefinition } from '../palette-catalog.ts'
import { getStyle } from '../scene/style-registry.ts'

/** The catalog's colors for a built-in palette, so expectations track the catalog. */
const paletteColors = (name: string): BuiltinPaletteDefinition['colors'] =>
  (BUILTIN_PALETTE_DEFINITIONS as readonly BuiltinPaletteDefinition[]).find(p => p.inputName === name)!.colors

/** The declarations of one class rule in the rendered stylesheet. */
const ruleOf = (svg: string, cls: string) => svg.match(new RegExp(`\\.${cls} \\{ ([^}]*) \\}`))?.[1] ?? ''

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

    expect(svg).toContain('.journey-actor-0 { fill: #123456; }')
    expect(svg).toContain('.journey-actor-1 { fill: #abcdef; }')
    expect(svg).toContain('.journey-section-0 { fill: #331122;')
    expect(svg).toContain('.journey-section-label-0 { fill: #fedcba; }')
    expect(svg).toContain('.journey-task-text {')
    expect(svg).toContain('font-family: Courier New;')
    expect(svg).toContain('font-size="19"')
    expect(svg).toContain('font-size="22"')
    expect(svg).toContain('font-family="Georgia"')
    expect(svg).toContain('fill: #0f172a;')
    expect(svg).not.toContain('NaN')
  })

  it('lets explicit Mermaid journey config override named style colors', () => {
    const svg = renderMermaidSVG(`%%{init: {"journey": {"actorColours": ["#123456"], "sectionFills": ["#331122"], "sectionColours": ["#fedcba"], "titleColor": "#0f172a"}}}%%
journey
  title Configured Journey
  section Login
    Open app: 5: Primary Actor`, { style: 'status-dashboard' })

    expect(svg).toContain('.journey-actor-0 { fill: #123456; }')
    expect(svg).toContain('.journey-section-0 { fill: #331122;')
    expect(svg).toContain('.journey-section-label-0 { fill: #fedcba; }')
    expect(svg).toContain('.journey-title { fill: #0f172a; }')
    expect(svg).not.toContain('.journey-section-0 { fill: #102033;')
    expect(svg).not.toContain('.journey-section-label-0 { fill: #e6f4ff; }')
  })

  it('uses Agentic palette/style colors for Journey-specific channels', () => {
    const svg = renderMermaidSVG(source, { style: 'look:tufte' })
    const { bg, fg, accent } = getStyle('look:tufte')!.colors!
    const color = (cls: string, property: string) => ruleOf(svg, cls).match(new RegExp(`(?:^|; )${property}: (#[0-9A-Fa-f]+)`))?.[1]

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
