import { describe, expect, it } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'

describe('renderMermaidSVG – architecture diagrams', () => {
  it('renders a standalone visible title as header furniture', () => {
    const svg = renderMermaidSVG('architecture-beta\n  title Simple Architecture Diagram')
    expect(svg).toContain('class="architecture-title"')
    expect(svg).toContain('Simple Architecture Diagram')
    expect(svg).toContain('role="img"')
  })

  it('honors row and column alignment hints as center-coordinate constraints', () => {
    const layout = (source: string) => layoutArchitectureDiagram(
      parseArchitectureDiagram(source.split('\n').map(line => line.trim()).filter(Boolean)),
    )
    const row = layout('architecture-beta\nservice a(server)[A]\nservice b(server)[B]\nservice c(server)[C]\nalign row a b c')
    expect(new Set(row.services.map(s => s.y + s.height / 2)).size).toBe(1)
    for (let i = 1; i < row.services.length; i++) {
      expect(row.services[i]!.x).toBeGreaterThanOrEqual(row.services[i - 1]!.x + row.services[i - 1]!.width)
    }

    const column = layout('architecture-beta\nservice a(server)[A]\nservice b(server)[B]\nservice c(server)[C]\nalign column a b c')
    expect(new Set(column.services.map(s => s.x + s.width / 2)).size).toBe(1)
    for (let i = 1; i < column.services.length; i++) {
      expect(column.services[i]!.y).toBeGreaterThanOrEqual(column.services[i - 1]!.y + column.services[i - 1]!.height)
    }

    const declarations = '\nservice a(server)[A]\nservice b(server)[B]\nservice c(server)[C]\nservice d(server)[D]'
    const rowFirst = layout(`architecture-beta${declarations}\nalign row a b\nalign row c d\nalign column a c\nalign column b d`)
    const columnFirst = layout(`architecture-beta${declarations}\nalign column a c\nalign column b d\nalign row a b\nalign row c d`)
    expect(columnFirst.services.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      rowFirst.services.map(({ id, x, y }) => ({ id, x, y })),
    )
  })

  it('renders architecture services, groups, and junctions with semantic classes', () => {
    const svg = renderMermaidSVG(`architecture-beta
      group app(cloud)[Application]
      service api(server)[Public API] in app
      junction q in app
      service db(database)[Primary DB]
      api:R --> L:db
      api:B --> T:q`)

    expect(svg).toContain('<svg')
    expect(svg).toContain('class="architecture-group"')
    expect(svg).toContain('class="architecture-service"')
    expect(svg).toContain('class="architecture-junction"')
    expect(svg).toContain('data-id="api"')
    expect(svg).toContain('Public API')
    expect(svg).toContain('Primary DB')
  })

  it('renders group-boundary edges and edge labels', () => {
    const svg = renderMermaidSVG(`architecture-beta
      group storage(cloud)[Storage]
      group analytics(cloud)[Analytics]
      service db(database)[Database] in storage
      service warehouse(database)[Warehouse] in analytics
      db{group}:R -[replicates]-> L:warehouse`)

    expect(svg).toContain('data-from-boundary="group"')
    expect(svg).toContain('data-label="replicates"')
    expect(svg).toContain('marker-end="url(#architecture-arrow-end)"')
    expect(svg).toContain('Storage')
    expect(svg).toContain('Analytics')
  })

  it('emits ARIA attributes and title/desc when accTitle and accDescr are present', () => {
    const svg = renderMermaidSVG(`architecture-beta
      accTitle: System overview
      accDescr: High-level service topology
      group app(cloud)[Application]
      service api(server)[API] in app`)

    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-roledescription="architecture"')
    expect(svg).toContain('aria-labelledby="arch-')
    expect(svg).toContain('aria-describedby="arch-')
    expect(svg).toContain('System overview</title>')
    expect(svg).toContain('High-level service topology</desc>')
  })

  it('omits ARIA attributes when no accessibility directives are present', () => {
    const svg = renderMermaidSVG(`architecture-beta
      service api(server)[API]`)

    expect(svg).not.toContain('role="img"')
    expect(svg).not.toContain('aria-labelledby')
    expect(svg).not.toContain('<title')
  })

  it('supports CSS variable color inputs without invalid output', () => {
    const svg = renderMermaidSVG(`architecture-beta
      group edge(cloud)[Edge]
      service api(server)[API] in edge`, {
      bg: 'var(--background)',
      fg: 'var(--foreground)',
      accent: 'var(--accent)',
    })

    expect(svg).toContain('--bg:var(--background)')
    expect(svg).not.toContain('NaN')
  })

  it('applies Mermaid wrapper theme, font, and architecture sizing config', () => {
    const svg = renderMermaidSVG(`---
config:
  theme: forest
  themeVariables:
    background: "#0b1120"
    clusterBkg: "#111827"
    clusterBorder: "#38bdf8"
    mainBkg: "#0f172a"
    fontFamily: IBM Plex Sans
---
      %%{init: {
        "theme": "neutral",
        "themeVariables": {
          "lineColor": "#f59e0b",
          "primaryColor": "#38bdf8"
        },
        "architecture": {
          "iconSize": 26,
          "fontSize": 16
        }
      }}%%
      %% generated sample
      architecture-beta
      group edge(cloud)[Edge<br/>Layer]
      service api(server)[API & <Gateway>] in edge
      service db(database)[Primary DB]
      api:R -[reads <records>]-> L:db`)

    expect(svg).toContain('class="architecture-group"')
    expect(svg).toContain('--bg:#0b1120')
    expect(svg).toContain('--line:#f59e0b')
    expect(svg).toContain('--arch-group-fill:#111827')
    expect(svg).toContain('--arch-service-fill:#0f172a')
    expect(svg).toContain("font-family: var(--font, 'IBM Plex Sans')")
    expect(svg).not.toContain('@import url(')
    expect(svg).toContain('data-icon="server"')
    expect(svg).not.toContain('architecture-icon-bg')
    expect(svg).toContain('Edge')
    expect(svg).toContain('Layer')
    expect(svg).toContain('API &amp; &lt;Gateway&gt;')
    expect(svg).toContain('reads &lt;records&gt;')
  })

  it('runs architecture output through shared compact and id-prefix post-processing', () => {
    const source = `architecture-beta
      service api(server)[API]
      service db(database)[DB]
      api:R --> L:db`
    const plain = renderMermaidSVG(source, { embedFontImport: false })
    const compact = renderMermaidSVG(source, {
      compact: true,
      embedFontImport: false,
      idPrefix: 'arch-fixture-',
    })

    expect(compact.length).toBeLessThan(plain.length)
    expect(compact).toContain('id="arch-fixture-architecture-arrow-end"')
    expect(compact).toContain('marker-end="url(#arch-fixture-architecture-arrow-end)"')
    expect(compact).not.toContain('marker-end="url(#architecture-arrow-end)"')
  })
})
