/**
 * Integration tests for sequence diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { Resvg } from '@resvg/resvg-js'
import { join } from 'node:path'
import { renderMermaidSVG } from '../index.ts'

describe('renderMermaidSVG – sequence diagrams', () => {
  it('renders a basic sequence diagram to valid SVG', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      Alice->>Bob: Hello
      Bob-->>Alice: Hi there`)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Alice')
    expect(svg).toContain('Bob')
    expect(svg).toContain('Hello')
  })

  it('renders participant declarations', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      participant A as Alice
      participant B as Bob
      A->>B: Message`)
    expect(svg).toContain('Alice')
    expect(svg).toContain('Bob')
    expect(svg).toContain('Message')
  })

  it('renders actor circle-person icons', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      actor U as User
      participant S as System
      U->>S: Click`)
    // Actors use the circle-person icon (three paths inside a scaled <g>)
    expect(svg).toContain('<g transform="translate(')
    expect(svg).toContain('scale(')
    expect(svg).toContain('User')
    expect(svg).toContain('System')
  })

  it('renders dashed return arrows', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Request
      B-->>A: Response`)
    // Select each message's own line: the lifelines are always dashed, so a bare
    // `stroke-dasharray` search would pass for an all-solid diagram.
    const messageLine = (from: string, to: string) =>
      svg.match(new RegExp(`<line [^>]*data-from="${from}" data-to="${to}"[^>]*>`))?.[0]
    const request = messageLine('A', 'B')
    const response = messageLine('B', 'A')
    expect(request).toBeDefined()
    expect(response).toBeDefined()
    expect(request).not.toContain('stroke-dasharray')
    expect(response).toContain('stroke-dasharray="6 4"')
    expect(svg).toContain('Request')
    expect(svg).toContain('Response')
  })

  it('renders loop blocks', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Start
      loop Every 5s
        A->>B: Ping
      end`)
    expect(svg).toContain('loop')
    expect(svg).toContain('Every 5s')
  })

  it('renders alt/else blocks', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Request
      alt Success
        B->>A: 200
      else Error
        B->>A: 500
      end`)
    expect(svg).toContain('alt')
    expect(svg).toContain('Success')
    // Else divider (dashed line)
    expect(svg).toContain('Error')
  })

  it('renders notes', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Hello
      Note right of B: Think about response
      B-->>A: Hi`)
    expect(svg).toContain('Think about response')
  })

  it('renders with dark colors', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Hello`, { bg: '#18181B', fg: '#FAFAFA' })
    expect(svg).toContain('--bg:#18181B')
  })

  it('renders lifeline dashed lines', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      A->>B: Hello`)
    // Lifelines are dashed vertical lines
    const dashedLines = svg.match(/stroke-dasharray="6 4"/g) ?? []
    expect(dashedLines.length).toBeGreaterThanOrEqual(2) // at least 2 lifelines
  })

  it('renders a complex authentication flow', () => {
    const svg = renderMermaidSVG(`sequenceDiagram
      participant C as Client
      participant S as Server
      participant DB as Database
      C->>S: POST /login
      S->>DB: SELECT user
      alt User found
        DB-->>S: User record
        S-->>C: 200 OK + token
      else Not found
        DB-->>S: null
        S-->>C: 401 Unauthorized
      end`)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Client')
    expect(svg).toContain('Server')
    expect(svg).toContain('Database')
    expect(svg).toContain('POST /login')
  })

  const participants = 'participant A\nparticipant B\nparticipant C'
  for (const fixture of [
    { name: 'an ordinary message spanning a declared participant', source: `sequenceDiagram\n${participants}\nA->>C: Read Read`, options: {} },
    {
      name: 'numbered bidirectional multiline text with custom metrics',
      source: `sequenceDiagram\nautonumber 10 2\n${participants}\nA<<->>C: Read Read<br/>More More`,
      options: { style: { font: 'DejaVu Sans', roles: { edge: { fontSize: 18, fontWeight: 600, letterSpacing: 1 } } } },
      numbered: true,
    },
    { name: 'an active intervening participant', source: `sequenceDiagram\n${participants}\nA->>+B: Open\nA->>C: Read Read\nB-->>-A: Close`, options: {} },
    {
      name: 'a colored box with nested translucent backgrounds',
      source: `sequenceDiagram\nbox CornflowerBlue Services\n${participants}\nend\nrect rgba(255,0,0,0.25)\nrect rgba(0,200,150,0.3)\nA->>C: Read\u2003Read\nend\nend`,
      options: {},
      preserveSurface: true,
    },
    { name: 'transparent output', source: `sequenceDiagram\n${participants}\nA->>C: Read\u2003Read`, options: { transparent: true }, preserveSurface: true },
    {
      name: 'transparent output with nested translucent backgrounds',
      source: `sequenceDiagram\n${participants}\nrect rgba(255,0,0,0.25)\nrect rgba(0,200,150,0.3)\nA->>C: Read\u2003Read\nend\nend`,
      options: { transparent: true },
      preserveSurface: true,
    },
  ] as const) {
    it(`keeps intervening structural ink out of the full message label envelope for ${fixture.name}`, () => {
      const svg = renderMermaidSVG(fixture.source, { ...fixture.options, embedFontImport: false })
      const label = [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].find(match => match[0].replace(/<[^>]+>/g, '').replace(/\u2003/g, ' ').includes('Read Read'))?.[0]
      expect(label).toBeDefined()
      if ('numbered' in fixture) {
        expect(label!.replace(/<[^>]+>/g, '')).toContain('10. Read Read')
        const arrow = svg.match(/<line\b[^>]*data-from="A"[^>]*data-to="C"[^>]*>/)?.[0]
        expect(arrow).toContain('marker-start=')
        expect(arrow).toContain('marker-end=')
        expect(label!.replace(/<[^>]+>/g, '')).toContain('More More')
      }
      // Measure the emitted glyphs with bundled fonts, independently of the
      // layout's bounds. Remove halos from this ownership raster only.
      const glyphs = label!.replace(/<(?:text|tspan)\b[^>]*>/g, tag => tag
        .replace(/\s(?:stroke|stroke-width|paint-order)="[^"]*"/g, '')
        .replace(/\sfill="[^"]*"/g, ' fill="#000000"'))
      const textOnly = svg.match(/<svg\b[^>]*>/)![0] + [...svg.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(match => match[0]).join('') + glyphs + '</svg>'
      const raster = (source: string) => {
        const image = new Resvg(source, {
          fitTo: { mode: 'zoom', value: 2 },
          font: { loadSystemFonts: false, fontDirs: [join(import.meta.dir, '..', '..', 'assets', 'fonts')], defaultFontFamily: 'Inter' },
        }).render()
        return { width: image.width, height: image.height, pixels: image.pixels }
      }
      const ownership = raster(textOnly)
      let left = ownership.width, right = -1, top = ownership.height, bottom = -1
      for (let y = 0; y < ownership.height; y++) {
        for (let x = 0; x < ownership.width; x++) {
          if (ownership.pixels[(y * ownership.width + x) * 4 + 3]! === 0) continue
          left = Math.min(left, x); right = Math.max(right, x)
          top = Math.min(top, y); bottom = Math.max(bottom, y)
        }
      }
      expect(right).toBeGreaterThan(left)
      expect(bottom).toBeGreaterThan(top)
      const actorB = svg.match(/<g\b[^>]*class="actor"[^>]*data-id="B"[^>]*>\s*<rect\b([^>]*)>/)![1]!
      const actorX = Number(actorB.match(/\bx="([^"]+)"/)![1]) + Number(actorB.match(/\bwidth="([^"]+)"/)![1]) / 2
      expect(actorX * 2).toBeGreaterThan(left)
      expect(actorX * 2).toBeLessThan(right)
      // Hide every B-owned structural mark, including all split spans or a
      // compound activation wrapper. No particular masking strategy is required.
      const withoutB = svg.replace(/<[\w:-]+\b(?=[^>]*\bclass="(?:lifeline|activation)")(?=[^>]*\bdata-actor="B")[^>]*>/g,
        tag => tag.replace(/\s*\/?>$/, ending => ` visibility="hidden"${ending}`))
      const backgroundOnly = withoutB.replace(/<g\b[^>]*\bclass="message"[^>]*>/g,
        tag => tag.replace(/>$/, ' visibility="hidden">'))
      const actual = raster(svg), reference = raster(withoutB), background = raster(backgroundOnly)
      let labelDifferences = 0, outsideDifferences = 0, surfaceDifferences = 0, surfaceSamples = 0
      for (let y = 0; y < actual.height; y++) {
        for (let x = 0; x < actual.width; x++) {
          const offset = (y * actual.width + x) * 4
          const inside = x >= left && x <= right && y >= top && y <= bottom
          const differs = [0, 1, 2, 3].some(channel => actual.pixels[offset + channel] !== reference.pixels[offset + channel])
          if (differs) { if (inside) labelDifferences++; else outsideDifferences++ }
          // Keep the existing authored-surface text halo out of this check.
          // An em-space supplies samples beyond its three-user-unit fringe.
          let clearOfGlyphs = inside && 'preserveSurface' in fixture && ownership.pixels[offset + 3] === 0
          for (let dy = -6; clearOfGlyphs && dy <= 6; dy++) {
            for (let dx = -6; dx <= 6; dx++) {
              const xx = x + dx, yy = y + dy
              if (xx >= 0 && xx < actual.width && yy >= 0 && yy < actual.height && ownership.pixels[(yy * actual.width + xx) * 4 + 3]! > 0) { clearOfGlyphs = false; break }
            }
          }
          if (clearOfGlyphs) {
            surfaceSamples++
            if ([0, 1, 2, 3].some(channel => actual.pixels[offset + channel] !== background.pixels[offset + channel])) surfaceDifferences++
          }
        }
      }
      expect(labelDifferences, 'lifelines and activations must contribute no ink inside the label envelope').toBe(0)
      expect(outsideDifferences, 'the intervening participant remains visible outside the label envelope').toBeGreaterThan(0)
      if ('preserveSurface' in fixture) {
        expect(surfaceSamples).toBeGreaterThan(0)
        expect(surfaceDifferences, 'label whitespace beyond the existing text halo preserves underlying color and alpha').toBe(0)
      }
    })
  }
})
