/**
 * Integration tests for timeline diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import type { RenderOptions } from '../types.ts'

function render(text: string, options: RenderOptions = {}): string {
  return renderMermaidSVG(text, options)
}

const MERMAID_DOCS_SOCIAL_TIMELINE = `timeline
  title History of Social Media Platform
  2002 : LinkedIn
  2004 : Facebook : Google
  2005 : YouTube
  2006 : Twitter`

describe('renderMermaidSVG – timeline diagrams', () => {
  it('renders a basic timeline to valid SVG', () => {
    const svg = render(`timeline
      title Product history
      2022 : Private alpha
      2023 : Public launch`)

    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Product history')
    expect(svg).toContain('class="timeline-rail"')
    expect(svg).toContain('class="timeline-period"')
    expect(svg).toContain('class="timeline-event"')
  })

  it('renders section frames and semantic data attributes', () => {
    const svg = render(`timeline
      title Beautiful Mermaid
      section Foundation
      2020 : Prototype
      section Growth
      2021 : Launch`)

    expect(svg).toContain('class="timeline-section"')
    expect(svg).toContain('data-label="Foundation"')
    expect(svg).toContain('data-section="Foundation" data-family="0"')
    expect(svg).toContain('data-section="Growth"')
    expect(svg).toContain('data-section="Growth" data-family="1"')
    expect(svg).toContain('Prototype')
    expect(svg).toContain('Launch')
  })

  it('renders Mermaid docs social media example with semantic period families but no default rainbow palette', () => {
    const svg = render(MERMAID_DOCS_SOCIAL_TIMELINE)
    const periodCount = (svg.match(/class="timeline-period"/g) ?? []).length
    const eventCount = (svg.match(/class="timeline-event"/g) ?? []).length
    const familyIds = [...svg.matchAll(/class="timeline-period"[\s\S]*?data-family="(\d+)"/g)].map(match => match[1])

    expect(svg).toContain('History of Social Media Platform')
    expect(svg).toContain('LinkedIn')
    expect(svg).toContain('Facebook')
    expect(svg).toContain('Google')
    expect(svg).toContain('YouTube')
    expect(svg).toContain('Twitter')
    expect(periodCount).toBe(4)
    expect(eventCount).toBe(5)
    expect(familyIds).toEqual(['0', '1', '2', '3'])
    expect(svg).not.toContain('#5B7FFF')
    expect(svg).not.toContain('#159A72')
  })

  it('renders multiple events for a single period', () => {
    const svg = render(`timeline
      2024 : Design refresh
           : Timeline support
           : Packaging polish`)

    const eventCount = (svg.match(/class="timeline-event"/g) ?? []).length
    expect(eventCount).toBe(3)
    expect(svg).toContain('data-period="2024"')
    expect(svg).toContain('Timeline support')
  })

  it('renders multiline labels with tspans', () => {
    const svg = render(`timeline
      title Product<br>history
      section Platform<br>work
      2024<br>Q1 : Soft<br>launch`)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('Product')
    expect(svg).toContain('history')
    expect(svg).toContain('Soft')
    expect(svg).toContain('launch')
  })

  it('supports dark themes and CSS variable colors without NaN output', () => {
    const svg = render(`timeline
      2024 : Timeline support`, {
      bg: 'var(--background)',
      fg: 'var(--foreground)',
      accent: 'var(--accent)',
    })

    expect(svg).toContain('--bg:var(--background)')
    expect(svg).toContain('--fg:var(--foreground)')
    expect(svg).not.toContain('NaN')
  })

  it('routes timeline diagrams correctly with frontmatter and comment lines', () => {
    const svg = render(`---
      title: Timeline example
      ---
      %% comment before header
      timeline
      title Product history
      2022 : Private alpha
      2023 : Public launch`)

    expect(svg).toContain('class="timeline-rail"')
    expect(svg).toContain('Product history')
    expect(svg).toContain('Private alpha')
    expect(svg).toContain('Public launch')
  })

  it('renders accessibility metadata on the root SVG instead of as timeline content', () => {
    const svg = render(`timeline
      accTitle: Accessible roadmap
      accDescr: Product launch plan
      2024 : Private alpha`)

    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-labelledby="tl-')
    expect(svg).toContain('aria-describedby="tl-')
    expect(svg).toContain('Accessible roadmap</title>')
    expect(svg).toContain('Product launch plan</desc>')
    expect(svg).not.toContain('data-label="accTitle"')
  })

  it('applies theme variable color families from Mermaid init config', () => {
    const svg = render(`%%{init: {"themeVariables":{"cScale0":"#224466","cScaleLabel0":"#f8f8f8","cScaleInv0":"#99bbdd"}}}%%
      timeline
      2024 : Private alpha`)

    expect(svg).toContain('--tl-accent:#224466')
    expect(svg).toContain('--tl-label:#f8f8f8')
    expect(svg).toContain('--tl-line:#99bbdd')
  })

  it('supports explicit timeline color config from mermaidConfig options', () => {
    const svg = render(`timeline
      2024 : Private alpha`, {
      mermaidConfig: {
        timeline: {
          sectionFills: ['#113355'],
          sectionColours: ['#ffffff'],
        },
      },
    })

    expect(svg).toContain('--tl-accent:#113355')
    expect(svg).toContain('--tl-label:#ffffff')
  })

  it('respects disableMulticolor for unsectioned timelines', () => {
    const svg = render(`---
      config:
        timeline:
          disableMulticolor: true
      ---
      timeline
      2022 : Alpha
      2023 : Beta
      2024 : GA`)

    const familyIds = [...svg.matchAll(/class="timeline-period"[\s\S]*?data-family="(\d+)"/g)].map(match => match[1])
    expect(familyIds).toEqual(['0', '0', '0'])
  })

  it('wraps long labels automatically without explicit <br> tags', () => {
    const svg = render(`timeline
      2024 : This is a deliberately long event label that should wrap across multiple lines to match Mermaid timeline behavior more closely`)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('This is a deliberately long')
    expect(svg).toContain('match Mermaid timeline')
  })
})
