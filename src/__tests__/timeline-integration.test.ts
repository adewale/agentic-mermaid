/**
 * Integration tests for timeline diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { applyOutputSecurityPolicy, renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import type { RenderOptions } from '../types.ts'
import { measureTextWidth } from '../text-metrics.ts'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid, renderMermaidASCII } from '../agent/index.ts'
import { DefaultBackend, getFamily } from '../agent/core.ts'
import type { PositionedTimelineDiagram } from '../timeline/types.ts'
import type { TimelineFamilyPalette } from '../timeline/renderer.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

function render(text: string, options: RenderOptions = {}): string {
  return renderMermaidSVG(text, options)
}

const MERMAID_DOCS_SOCIAL_TIMELINE = `timeline
  title History of Social Media Platform
  2002 : LinkedIn
  2004 : Facebook : Google
  2005 : YouTube
  2006 : Twitter`

describe('tracked Unicode timeline titles', () => {
  for (const style of ['crisp', 'excalidraw', 'watercolor'] as const) {
    it.each(['é Ω ⋯ 😀', 'hello<br>世界'])(`${style} retains authored tracking on the native glyph run: %s`, title => {
      const svg = render(`timeline\ntitle ${title}\n2024 : Release`, {
        embedFontImport: false,
        style: [style, { roles: { label: { letterSpacing: 1.5, fontWeight: 600 } } }],
      })
      const text = svg.match(/<text\b[^>]*class="timeline-title"[^>]*>[\s\S]*?<\/text>/)?.[0]
      expect(text).toBeDefined()
      const tags = scanSvgStartTags(text!)
      const outer = new Map(tags[0]!.attributes.map(attribute => [attribute.name, attribute.value]))
      expect(outer.get('letter-spacing')).toBe('1.5')
      expect(outer.get('data-prepared-text')).toBe('true')
      expect(tags.map(tag => tag.name)).toEqual(['text', 'tspan'])
      const glyph = new Map(tags[1]!.attributes.map(attribute => [attribute.name, attribute.value]))
      expect(glyph.get('data-text-fragment')).toBe('true')
      expect(glyph.get('x')).toBe(outer.get('x'))
      expect(text).not.toContain('textLength=')
    })
  }
})

describe('renderMermaidSVG – timeline diagrams', () => {
  it.each(['Timeline redesign', 'timeline', 'TIMELINE release', 'section', 'SECTION'])('keeps a period named %s through parse, export and rendering', label => {
    const source = `timeline\n2020 : A\n${label} : Ship`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('timeline')
    const serialized = serializeMermaid(parsed.value)
    expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
    for (const input of [source, serialized]) {
      const svg = render(input)
      expect(svg).toContain(`>${label}</text>`)
      expect(svg).toContain('>Ship</text>')
      expect(svg.match(/class="timeline-period"/g)).toHaveLength(2)
      const terminal = renderMermaidASCII(input)
      expect(terminal).toContain(label)
      expect(terminal).toContain('Ship')
      expect(verifyMermaid(input).layout?.nodes.map(node => node.label)).toContain(label)
    }
    const reparsed = parseRegisteredMermaid(serialized)
    if (!reparsed.ok) throw new Error(JSON.stringify(reparsed.error))
    expect(reparsed.value.body.kind).toBe('timeline')
    expect(serializeMermaid(reparsed.value)).toBe(serialized)
  })

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

  it('renders exact <br> in Timeline titles literally, unlike node labels', () => {
    const svg = render('timeline\n  title Product<br>history\n  section Team<br>work\n  2024 : Launch')
    const title = svg.match(/<text\b[^>]*class="timeline-title"[^>]*>[\s\S]*?<\/text>/)?.[0]
    const section = svg.match(/<text\b[^>]*class="timeline-section-label"[^>]*>[\s\S]*?<\/text>/)?.[0]
    expect(title).toContain('Product&lt;br&gt;history')
    expect(title).not.toContain('<tspan')
    expect(Number(title?.match(/textLength="([^"]+)"/)?.[1])).toBeCloseTo(measureTextWidth('Product<br>history', 18, 600), 3)
    expect(section).toContain('<tspan')
  })

  it('renders noncanonical breaks and formatting-looking tags literally in every Timeline slot', () => {
    for (const tag of ['<BR>', '<br/>', '<br />', '<b>', '<i>', '<u>', '<s>']) {
      const text = `A${tag}B`
      const escaped = `A${tag.replace('<', '&lt;').replace('>', '&gt;')}B`
      for (const source of [
        `timeline\n  title ${text}\n  2024 : Event`,
        `timeline\n  section ${text}\n  2024 : Event`,
        `timeline\n  ${text} : Event`,
        `timeline\n  2024 : ${text}`,
      ]) {
        const svg = render(source)
        expect(svg, source).toContain(escaped)
        expect(svg, source).not.toContain('NaN')
        expect(svg, source).not.toMatch(/<tspan\b[^>]*\b(?:font-weight="(?:bold|700)"|font-style="italic"|text-decoration=")/)
      }
    }
    const complete = render('timeline\n  2024 : A<b>Bold</b>Z')
    expect(complete).toContain('A&lt;b&gt;Bold&lt;/b&gt;Z')
    expect(complete).not.toMatch(/<tspan\b[^>]*\b(?:font-weight="(?:bold|700)"|font-style="italic"|text-decoration=")/)
  })

  it('measures markup-looking Timeline text literally in all four slots', () => {
    const label = 'A<b>B'
    const svg = render(`timeline\n  title ${label}\n  section ${label}\n  ${label} : ${label}`)
    for (const [className, size, weight] of [
      ['timeline-title', 18, 600],
      ['timeline-section-label', 12, 600],
      ['timeline-period-text', 12, 600],
      ['timeline-event-text', 12, 400],
    ] as const) {
      const attrs = svg.match(new RegExp(`<text\\b[^>]*class="${className}"[^>]*>`))?.[0]
      expect(attrs, className).toBeDefined()
      expect(attrs, className).toContain('data-literal-text="true"')
      const width = Number(attrs?.match(/textLength="([^"]+)"/)?.[1])
      expect(width, className).toBeCloseTo(measureTextWidth(label, size, weight), 3)
    }
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

  it('respects disableMulticolor for labeled sections too (plan §Timeline 3)', () => {
    const src = (config: string) => `${config}timeline
      section Foundation
      2020 : Prototype
      section Growth
      2021 : Launch
      section Exit
      2022 : IPO`
    const disabled = render(src('---\nconfig:\n  timeline:\n    disableMulticolor: true\n---\n'))
    const periodFamilies = [...disabled.matchAll(/class="timeline-period"[\s\S]*?data-family="(\d+)"/g)].map(m => m[1])
    expect(periodFamilies).toEqual(['0', '0', '0'])
    const sectionFamilies = [...disabled.matchAll(/<g class="timeline-section"[^>]*data-family="(\d+)"/g)].map(m => m[1])
    expect(sectionFamilies).toEqual(['0', '0', '0'])

    // The default multicolor path is untouched: one family per labeled section.
    const multicolor = render(src(''))
    const defaultFamilies = [...multicolor.matchAll(/<g class="timeline-section"[^>]*data-family="(\d+)"/g)].map(m => m[1])
    expect(defaultFamilies).toEqual(['0', '1', '2'])
  })

  it('wraps long labels automatically without explicit <br> tags', () => {
    const svg = render(`timeline
      2024 : This is a deliberately long event label that should wrap across multiple lines to match Mermaid timeline behavior more closely`)

    expect(svg).toContain('<tspan')
    expect(svg).toContain('This is a deliberately long')
    expect(svg).toContain('match Mermaid timeline')
  })
})

const PALETTE_A: TimelineFamilyPalette = { accent: '#112233', fill: '#445566', label: '#fefefe', line: '#778899' }
const PALETTE_B: TimelineFamilyPalette = { accent: '#224466', fill: '#6688aa', label: '#eeeeee', line: '#99bbdd' }
const STYLE_A = '--tl-accent:#112233;--tl-fill:#445566;--tl-label:#fefefe;--tl-line:#778899;--tl-section-bg:color-mix(in srgb, #445566 6%, var(--bg));--tl-section-band:color-mix(in srgb, #445566 12%, var(--bg));--tl-pill-fill:color-mix(in srgb, #445566 11%, var(--bg));--tl-pill-stroke:color-mix(in srgb, #445566 36%, #778899);--tl-event-fill:color-mix(in srgb, #445566 16%, var(--_node-fill))'

function positionedPaletteTimeline(periodCount: number): PositionedTimelineDiagram {
  return {
    width: 80 * periodCount + 40, height: 200,
    rail: { x1: 20, y1: 80, x2: 80 * periodCount + 20, y2: 80 },
    sections: [{ id: 'S', x: 10, y: 10, width: 80 * periodCount + 20, height: 180, framed: false, headerHeight: 0,
      periods: Array.from({ length: periodCount }, (_, index) => ({
        id: `P${index}`, sectionId: 'S', label: `P${index}界`, centerX: 50 + 80 * index,
        markerX: 50 + 80 * index, markerY: 80,
        pillX: 20 + 80 * index, pillY: 20, pillWidth: 60, pillHeight: 30,
        stem: { x1: 50 + 80 * index, y1: 50, x2: 50 + 80 * index, y2: 80 }, events: [],
      })),
    }],
  }
}

function publicPaletteScene(palettes: readonly TimelineFamilyPalette[], positioned = positionedPaletteTimeline(3)) {
  const lower = getFamily('timeline')?.lowerScene
  if (!lower) throw new Error('public Timeline lowering unavailable')
  return lower({ positioned, colors: { bg: '#ffffff', fg: '#111111' },
    resolved: { renderOptions: {}, familyAppearance: { timelineConfig: {}, familyPalettes: palettes } } })
}

function periodTags(svg: string): string[] {
  return svg.match(/<g class="timeline-period"[^>]*>/g) ?? []
}

describe('public Timeline palette output and request isolation', () => {
  it('projects typed palettes without freezing caller data and snapshots each request', () => {
    const caller = { ...PALETTE_A }
    const palettes = [caller]
    const positioned = positionedPaletteTimeline(3)
    const first = publicPaletteScene(palettes, positioned)
    const svg = DefaultBackend.render(first, { seed: 0 })
    const tags = periodTags(svg)
    expect(tags).toHaveLength(3)
    for (const [index, tag] of tags.entries()) {
      expect(tag).toContain(`data-id="P${index}" data-label="P${index}界" data-family="0"`)
      expect(tag).toContain(`style="${STYLE_A}"`)
    }
    expect(svg).toContain('<line class="timeline-stem" x1="50" y1="50" x2="50" y2="80"')
    expect(Object.isFrozen(caller)).toBe(false)
    expect(Object.isFrozen(palettes)).toBe(false)
    expect(Object.isFrozen(positioned)).toBe(false)
    caller.fill = PALETTE_B.fill
    const changed = DefaultBackend.render(publicPaletteScene(palettes, positioned), { seed: 0 })
    expect(periodTags(changed)[0]).toContain('--tl-fill:#6688aa')
    expect(periodTags(changed)[0]).toContain('--tl-pill-stroke:color-mix(in srgb, #6688aa 36%, #778899)')
    expect(periodTags(svg)[0]).toContain('--tl-fill:#445566')
    expect(DefaultBackend.render(first, { seed: 0 })).toBe(svg)
  })

  it.each(['accent', 'fill', 'label', 'line'] as const)('keeps current %s after a tuple change and an early repeat', field => {
    const changed = { ...PALETTE_A, [field]: PALETTE_B[field] }
    const tags = periodTags(DefaultBackend.render(publicPaletteScene([PALETTE_A, changed, PALETTE_A, PALETTE_A], positionedPaletteTimeline(4)), { seed: 0 }))
    expect(tags).toHaveLength(4)
    expect(tags[0]).toContain(`style="${STYLE_A}"`)
    expect(tags[1]).toContain(`--tl-${field}:${PALETTE_B[field]}`)
    expect(tags[2]).toContain(`style="${STYLE_A}"`)
    expect(tags[3]).toContain(`style="${STYLE_A}"`)
    if (field === 'fill') expect(tags[1]).toContain('--tl-section-bg:color-mix(in srgb, #6688aa 6%, var(--bg))')
    if (field === 'line') expect(tags[1]).toContain('--tl-pill-stroke:color-mix(in srgb, #445566 36%, #99bbdd)')
  })

  it('keeps nested public lowering from a palette getter isolated from its enclosing request', () => {
    let nested = ''
    const caller = { ...PALETTE_A }
    const palette = Object.defineProperty(caller, 'line', { enumerable: true, configurable: true, get() {
      if (!nested) nested = DefaultBackend.render(publicPaletteScene([PALETTE_B], positionedPaletteTimeline(1)), { seed: 0 })
      return PALETTE_A.line
    } })
    const outer = DefaultBackend.render(publicPaletteScene([palette]), { seed: 0 })
    expect(periodTags(nested)[0]).toContain('--tl-accent:#224466;--tl-fill:#6688aa;--tl-label:#eeeeee;--tl-line:#99bbdd')
    expect(periodTags(outer)).toHaveLength(3)
    for (const tag of periodTags(outer)) expect(tag).toContain(`style="${STYLE_A}"`)
    expect(Object.isFrozen(caller)).toBe(false)
  })

  it('preserves finite family numbers across 129 palettes and later repeats', () => {
    const palettes = Array.from({ length: 129 }, (_, index) => ({ ...PALETTE_A,
      accent: index === 128 ? PALETTE_B.accent : PALETTE_A.accent }))
    const tags = periodTags(DefaultBackend.render(publicPaletteScene(palettes, positionedPaletteTimeline(258)), { seed: 0 }))
    expect(tags).toHaveLength(258)
    for (let index = 0; index < 258; index++) {
      const family = index % 129
      expect(tags[index]).toContain(`data-id="P${index}" data-label="P${index}界" data-family="${family}"`)
      expect(tags[index]).toContain(`--tl-accent:${family === 128 ? '#224466' : '#112233'}`)
      expect(tags[index]).toContain('--tl-pill-stroke:color-mix(in srgb, #445566 36%, #778899)')
    }
  })

  it('keeps direct-backend lexical references, final strict refusal and attribute escaping', () => {
    const palettes = [PALETTE_A, { ...PALETTE_A, fill: 'url(https://example.test/paint)' }, PALETTE_A]
    const svg = DefaultBackend.render(publicPaletteScene(palettes), { seed: 0 })
    expect(periodTags(svg)[1]).toContain('--tl-fill:url(https://example.test/paint)')
    expect(applyOutputSecurityPolicy(svg, 'default').diagnostics).toContainEqual({
      code: 'EXTERNAL_REFERENCE', reference: expect.stringContaining('https://example.test/paint'),
    })
    expect(() => applyOutputSecurityPolicy(svg, 'strict')).toThrow('OutputSecurityPolicy strict verification failed')
    const escaped = DefaultBackend.render(publicPaletteScene([{ ...PALETTE_A, fill: 'red" onload="alert(1)' }]), { seed: 0 })
    expect(escaped).toContain('--tl-fill:red&quot; onload=&quot;alert(1)')
    expect(verifyNoExternalRefs(escaped)).toEqual({ ok: true, refs: [] })
    expect(periodTags(DefaultBackend.render(publicPaletteScene([PALETTE_A]), { seed: 0 }))[0]).toContain(`style="${STYLE_A}"`)
  })

  it.each(['expression(alert(1))', 'url(javascript:alert(1))', 'red;fill:url(data:text/plain,active)', 'url(\\6a avascript:alert(1))'])(
    'rejects active CSS at construction or backend admission: %s', fill => {
      expect(() => DefaultBackend.render(publicPaletteScene([{ ...PALETTE_A, fill }], positionedPaletteTimeline(1)), { seed: 0 }))
        .toThrow(/active content|style may only set custom properties/)
    },
  )
})
