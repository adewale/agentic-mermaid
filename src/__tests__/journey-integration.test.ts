/**
 * Integration tests for journey diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import type { RenderOptions } from '../types.ts'

function render(text: string, options: RenderOptions = {}): string {
  return renderMermaidSVG(text, options)
}

describe('renderMermaidSVG – journey diagrams', () => {
  it('renders a basic user journey to valid SVG', () => {
    const svg = render(`journey
      title My working day
      section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me`)

    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('My working day')
    expect(svg).toContain('class="journey-section"')
    expect(svg).toContain('class="journey-task"')
    expect(svg).toContain('class="journey-score-marker"')
    expect(svg).toContain('class="journey-actor-dot')
    expect(svg).toContain('class="journey-baseline"')
  })

  it('routes journey diagrams through frontmatter and Mermaid init directives', () => {
    const svg = render(`---
      title: Journey sample
      config:
        theme: dark
      ---
      %%{init: {'theme': 'base'}}%%
      journey
      section Go to work
      Make tea: 5: Me`)

    expect(svg).toContain('<svg')
    expect(svg).toContain('class="journey-task"')
    expect(svg).toContain('Make tea')
  })

  it('surfaces accTitle and accDescr as SVG accessibility metadata', () => {
    const svg = render(`journey
      accTitle: Working day accessibility title
      accDescr {
        A compact summary
        of the working day journey
      }
      title My working day
      section Go to work
      Make tea: 5: Me`)

    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-roledescription="user journey"')
    expect(svg).toContain('aria-labelledby="journey-')
    expect(svg).toContain('aria-describedby="journey-')
    expect(svg).toContain('Working day accessibility title</title>')
    expect(svg).toContain('A compact summary\nof the working day journey</desc>')
  })

  it('falls back to the visible title for accessibility metadata when accTitle is absent', () => {
    const svg = render(`journey
      title My working day
      section Go to work
      Make tea: 5: Me`)

    expect(svg).toContain('aria-labelledby="journey-')
    expect(svg).toContain('My working day</title>')
  })

  it('emits semantic data attributes for section, score, and actors', () => {
    const svg = render(`journey
      section Go to work
      Make tea: 5: Me, Cat`)

    expect(svg).toContain('data-label="Go to work"')
    expect(svg).toContain('data-score="5"')
    expect(svg).toContain('data-actors="Me, Cat"')
    expect(svg).toContain('data-actor="Me"')
    expect(svg).toContain('data-actor="Cat"')
  })

  it('renders score guide ticks and one score marker per task', () => {
    const svg = render(`journey
      section Work
      Do work: 3: Me`)

    const guideCount = (svg.match(/class="journey-guide"/g) ?? []).length
    const markerCount = (svg.match(/class="journey-score-marker"/g) ?? []).length
    expect(guideCount).toBe(5)
    expect(markerCount).toBe(1)
    expect(svg).toContain('data-score="3"')
    expect(svg).toContain('class="journey-score-face"')
  })

  it('namespaces Journey marker ids per SVG instead of using the fixed Mermaid id', () => {
    const first = render(`journey
      section Work
      Do work: 3: Me`)
    const second = render(`journey
      section Play
      Take break: 5: Me`)

    const firstMarker = first.match(/<marker id="([^"]*journey[^"]*arrowhead)"/)?.[1]
    const secondMarker = second.match(/<marker id="([^"]*journey[^"]*arrowhead)"/)?.[1]

    expect(first).not.toContain('id="journey-arrowhead"')
    expect(first).not.toContain('url(#journey-arrowhead)')
    expect(firstMarker).toBeDefined()
    expect(secondMarker).toBeDefined()
    expect(firstMarker).not.toBe(secondMarker)
    expect(first).toContain(`marker-end="url(#${firstMarker})"`)
    expect(second).toContain(`marker-end="url(#${secondMarker})"`)
  })

  it('renders multiline labels with tspans', () => {
    const svg = render(`journey
      title Product<br>journey
      section Go<br>to work
      Make<br>tea: 5: Me`)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('Product')
    expect(svg).toContain('journey')
    expect(svg).toContain('Make')
    expect(svg).toContain('tea')
  })

  it('supports CSS variable colors without NaN output', () => {
    const svg = render(`journey
      section Work
      Deep work: 4: Me`, {
      bg: 'var(--background)',
      fg: 'var(--foreground)',
      accent: 'var(--accent)',
    })

    expect(svg).toContain('--bg:var(--background)')
    expect(svg).toContain('--fg:var(--foreground)')
    expect(svg).not.toContain('NaN')
  })
})
