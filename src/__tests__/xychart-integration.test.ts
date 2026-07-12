/**
 * Integration tests for xychart rendering.
 *
 * Tests data-* attributes (always emitted), interactive tooltip
 * groups (only when interactive: true), and Mermaid-compat behavior.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaid } from '../index.ts'

const BAR_CHART = `xychart-beta
  x-axis [Jan, Feb, Mar, Apr]
  y-axis "Revenue" 0 --> 100
  bar [30, 60, 45, 80]`

const LINE_CHART = `xychart-beta
  x-axis [Jan, Feb, Mar]
  y-axis "Users" 0 --> 500
  line [100, 250, 400]`

const MIXED_CHART = `xychart-beta
  x-axis [Q1, Q2, Q3, Q4]
  y-axis "Sales" 0 --> 200
  bar [50, 80, 120, 90]
  line [40, 100, 110, 85]`

const STABLE_XYCHART = `xychart
  title Revenue
  x-axis [Q1, "Q2 Growth", Q3]
  y-axis Users 0 --> 100
  bar [30, 60, 45]`

const FRONTMATTER_XYCHART = `---
config:
  xyChart:
    showDataLabel: true
    xAxis:
      showLabel: false
  themeVariables:
    xyChart:
      backgroundColor: "#f8fafc"
      plotColorPalette: "#ff6b6b, #0ea5e9"
      titleColor: "#123456"
      xAxisLabelColor: "#654321"
      xAxisTickColor: "#aa5500"
      yAxisLineColor: "#0055aa"
---
xychart
  title Revenue
  x-axis [Q1, "Q2 Growth", Q3]
  y-axis Users 0 --> 100
  bar [30, 60, 45]
  line [25, 55, 50]`

const FRONTMATTER_HORIZONTAL_XYCHART = [
  '---',
  'config:',
  '  xyChart:',
  '    chartOrientation: horizontal',
  '    showTitle: false',
  '    width: 720',
  '    height: 240',
  '---',
  'xychart',
  '  title Revenue',
  '  x-axis [A, B, C]',
  '  y-axis Users 0 --> 100',
  '  bar [10, 20, 30]',
].join('\r\n')

const INIT_DIRECTIVE_XYCHART = `%%{init: {
  "theme": "dark",
  "fontFamily": "Fira Code",
  "xyChart": {
    "showDataLabel": true,
    "xAxis": { "showLabel": false }
  },
  "themeVariables": {
    "xyChart": {
      "plotColorPalette": ["#ff6b6b", "#0ea5e9"]
    }
  }
}}%%
xychart
  title Revenue
  x-axis [Q1, "Q2 Growth", Q3]
  y-axis Users 0 --> 100
  bar [30, 60, 45]
  line [25, 55, 50]`

function getSvgSize(svg: string): { width: number; height: number } {
  const sizeMatch = svg.match(/<svg[^>]*viewBox="0 0 (\d+) (\d+)"/)
  if (!sizeMatch) throw new Error('SVG missing viewBox attribute')
  return {
    width: Number(sizeMatch[1]),
    height: Number(sizeMatch[2]),
  }
}

// ============================================================================
// Data attributes (always present)
// ============================================================================

describe('xychart – data attributes', () => {
  it('emits data-value and data-label on bars', async () => {
    const svg = await renderMermaid(BAR_CHART)
    expect(svg).toContain('data-value="30"')
    expect(svg).toContain('data-value="80"')
    expect(svg).toContain('data-label="Jan"')
    expect(svg).toContain('data-label="Apr"')
  })

  it('emits data-value and data-label on line dots (interactive)', async () => {
    // Line dots are only rendered when interactive: true
    const svg = await renderMermaid(LINE_CHART, { interactive: true })
    expect(svg).toContain('data-value="100"')
    expect(svg).toContain('data-value="400"')
    expect(svg).toContain('data-label="Jan"')
    expect(svg).toContain('data-label="Mar"')
  })

  it('does not render line dots unless interactive, matching Mermaid', async () => {
    const svg = await renderMermaid(LINE_CHART)
    expect(svg).not.toContain('<circle')
    expect(svg).not.toContain('data-value="100"')
    expect(svg).not.toContain('xychart-tip-bg')
    expect(svg).not.toContain('xychart-dot-group')
  })

  it('emits data attributes on mixed chart elements', async () => {
    const svg = await renderMermaid(MIXED_CHART, { interactive: true })
    // Bars
    expect(svg).toContain('data-value="50"')
    expect(svg).toContain('data-value="120"')
    // Line dots (only when interactive)
    expect(svg).toContain('data-value="40"')
    expect(svg).toContain('data-value="110"')
    // Labels on both
    expect(svg).toContain('data-label="Q1"')
    expect(svg).toContain('data-label="Q4"')
  })
})

// ============================================================================
// Interactive tooltips (opt-in)
// ============================================================================

describe('xychart – interactive tooltips', () => {
  it('does not emit tooltip elements by default', async () => {
    const svg = await renderMermaid(BAR_CHART)
    expect(svg).not.toContain('xychart-tip')
    expect(svg).not.toContain('xychart-bar-group')
    expect(svg).not.toContain('<title>')
  })

  it('emits tooltip groups for bars when interactive', async () => {
    const svg = await renderMermaid(BAR_CHART, { interactive: true })
    expect(svg).toContain('class="xychart-bar-group"')
    expect(svg).toContain('class="xychart-tip xychart-tip-bg"')
    expect(svg).toContain('class="xychart-tip xychart-tip-text"')
    expect(svg).toContain('<title>Jan: 30</title>')
    expect(svg).toContain('<title>Apr: 80</title>')
  })

  it('emits tooltip groups for line dots when interactive', async () => {
    const svg = await renderMermaid(LINE_CHART, { interactive: true })
    expect(svg).toContain('class="xychart-dot-group"')
    expect(svg).toContain('<title>Jan: 100</title>')
    expect(svg).toContain('<title>Mar: 400</title>')
  })

  it('includes hover CSS rules when interactive', async () => {
    const svg = await renderMermaid(BAR_CHART, { interactive: true })
    expect(svg).toContain('.xychart-tip {')
    expect(svg).toContain('opacity: 0')
    expect(svg).toContain('.xychart-bar-group:hover .xychart-tip')
    expect(svg).toContain('.xychart-dot-group:hover .xychart-tip')
    // Tooltips appear instantly (no transition)
  })

  it('does not include hover CSS when not interactive', async () => {
    const svg = await renderMermaid(BAR_CHART)
    expect(svg).not.toContain('.xychart-tip {')
    expect(svg).not.toContain('.xychart-bar-group:hover')
  })

  it('still emits data attributes when interactive', async () => {
    const svg = await renderMermaid(BAR_CHART, { interactive: true })
    expect(svg).toContain('data-value="30"')
    expect(svg).toContain('data-label="Jan"')
  })
})

// ============================================================================
// CSS variable color inputs
// ============================================================================

describe('xychart – CSS variable color inputs', () => {
  it('does not produce NaN colors when accent/bg are CSS variables', async () => {
    const svg = await renderMermaid(MIXED_CHART, {
      bg: 'var(--background)',
      fg: 'var(--foreground)',
      accent: 'var(--accent)',
    })
    expect(svg).not.toContain('NaN')
    expect(svg).toContain('xychart-color-0')
    expect(svg).toContain('xychart-color-1')
  })
})

describe('xychart – Mermaid parity', () => {
  it('accepts the stable xychart header and cleans quoted category labels', async () => {
    const svg = await renderMermaid(STABLE_XYCHART)
    expect(svg).toContain('>Revenue</text>')
    expect(svg).toContain('Q2 Growth')
    expect(svg).not.toContain('&quot;Q2 Growth&quot;')
  })

  it('supports Mermaid frontmatter config and theme variables', async () => {
    const svg = await renderMermaid(FRONTMATTER_XYCHART)
    expect(svg).toContain('class="xychart-data-label')
    expect(svg).toContain('--xychart-color-0: #ff6b6b;')
    expect(svg).toContain('--xychart-color-1: #0ea5e9;')
    expect(svg).toContain('.xychart-title { fill: #123456; }')
    expect(svg).toContain('.xychart-x-label { fill: #654321; }')
    expect(svg).toContain('.xychart-x-tick { stroke: #aa5500; }')
    expect(svg).toContain('.xychart-y-axis-line { stroke: #0055aa; }')
    expect(svg).toContain('--bg:#f8fafc')
    expect(svg).toContain('class="xychart-axis-line xychart-x-axis-line"')
    expect(svg).toContain('class="xychart-tick xychart-y-tick"')
    expect(svg).not.toContain('>Q1</text>')
  })

  it('renders showDataLabel for bars only, matching Mermaid behavior', async () => {
    const svg = await renderMermaid(FRONTMATTER_XYCHART)
    expect(svg).toContain('>30</text>')
    expect(svg).toContain('>60</text>')
    expect(svg).toContain('>45</text>')
    expect(svg.match(/class="xychart-data-label"/g)?.length ?? 0).toBe(3)
  })

  it('supports CRLF frontmatter for orientation, title visibility, and chart sizing', async () => {
    const defaultSvg = await renderMermaid(`xychart horizontal
  title Revenue
  x-axis [A, B, C]
  y-axis Users 0 --> 100
  bar [10, 20, 30]`)
    const svg = await renderMermaid(FRONTMATTER_HORIZONTAL_XYCHART)
    const defaultSize = getSvgSize(defaultSvg)
    const configuredSize = getSvgSize(svg)

    expect(svg).not.toContain('>Revenue</text>')
    expect(svg).toMatch(/class="xychart-label xychart-x-label"[^>]*>A<\/text>/)
    expect(svg).toMatch(/class="xychart-axis-title xychart-y-axis-title"[^>]*>Users<\/text>/)
    expect(configuredSize.width).toBeGreaterThan(defaultSize.width)
    expect(configuredSize.height).toBeLessThan(defaultSize.height)
  })

  it('supports Mermaid init directives for routing, theme, font, and xychart config', async () => {
    const svg = await renderMermaid(INIT_DIRECTIVE_XYCHART)
    expect(svg).toContain('--bg:#18181B')
    expect(svg).toContain('Fira%20Code')
    expect(svg).toContain('class="xychart-data-label"')
    expect(svg).toContain('--xychart-color-0: #ff6b6b;')
    expect(svg).toContain('--xychart-color-1: #0ea5e9;')
    expect(svg).not.toContain('>Q1</text>')
  })

  it('renders accessibility metadata on the root SVG without duplicate ARIA attributes', async () => {
    const svg = await renderMermaid(`xychart
  accTitle: Revenue chart
  accDescr {
    Quarterly sales
    across two regions.
  }
  bar [10, 20]`)
    const openTag = svg.match(/<svg[^>]+>/)?.[0] ?? ''

    expect(openTag).toContain('role="img"')
    expect(openTag).toContain('aria-roledescription="xychart"')
    expect(openTag.match(/aria-labelledby=/g)).toHaveLength(1)
    expect(openTag.match(/aria-describedby=/g)).toHaveLength(1)
    expect(openTag).toContain('aria-labelledby="chart-title-mermaid-')
    expect(openTag).toContain('aria-describedby="chart-desc-mermaid-')
    expect(svg.match(/<title id="chart-title-/g)).toHaveLength(1)
    expect(svg.match(/<desc id="chart-desc-/g)).toHaveLength(1)
    expect(svg).toContain('Quarterly sales')
  })

  it('sets xychart role for title-only and description-only accessibility metadata', async () => {
    const titleOnly = await renderMermaid(`xychart
  accTitle: Revenue chart
  bar [10, 20]`)
    const titleOpen = titleOnly.match(/<svg[^>]+>/)?.[0] ?? ''
    expect(titleOpen).toContain('role="img"')
    expect(titleOpen).toContain('aria-labelledby="chart-title-mermaid-')
    expect(titleOpen).not.toContain('aria-describedby=')

    const descOnly = await renderMermaid(`xychart
  accDescr: Quarterly sales by region
  bar [10, 20]`)
    const descOpen = descOnly.match(/<svg[^>]+>/)?.[0] ?? ''
    expect(descOpen).toContain('role="img"')
    expect(descOpen).toContain('aria-describedby="chart-desc-mermaid-')
    expect(descOpen).not.toContain('aria-labelledby=')
  })

  it('supports semicolon-separated Mermaid xychart statements', async () => {
    const svg = await renderMermaid('xychart; title Revenue; x-axis [Q1, Q2]; bar [10, 20]')

    expect(svg).toContain('>Revenue</text>')
    expect(svg).toContain('data-label="Q1"')
    expect(svg).toContain('data-value="20"')
  })
})
