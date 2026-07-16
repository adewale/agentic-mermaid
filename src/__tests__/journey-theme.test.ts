/**
 * Journey-specific theme coverage for built-in light and dark palettes.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

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

    expect(svg).toContain('--bg:#ffffff')
    expect(svg).toContain('--fg:#1f2328')
    expect(svg).toContain('--accent:#0969da')
    expect(svg).toContain('--line:#d1d9e0')
    expect(svg).toContain('class="journey-task-box"')
    expect(svg).toContain('class="journey-score-marker"')
    expect(svg).not.toContain('NaN')
  })

  it('renders correctly with the built-in dark theme palette', () => {
    const svg = renderMermaidSVG(source, { style: 'github-dark' })

    expect(svg).toContain('--bg:#0d1117')
    expect(svg).toContain('--fg:#e6edf3')
    expect(svg).toContain('--accent:#4493f8')
    expect(svg).toContain('--line:#3d444d')
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

    expect(svg).toContain('--accent:#a00000')
    expect(svg).not.toContain('#facc15')
    expect(svg).not.toContain('#8a6d1d')
    expect(svg).not.toContain('#16a34a')
    expect(svg).not.toContain('#d97706')
    expect(svg).not.toContain('#7c3aed')
    expect(svg).not.toContain('#db2777')
    expect(svg).not.toContain('#0891b2')
  })
})
