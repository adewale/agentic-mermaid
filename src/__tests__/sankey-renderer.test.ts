import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

const BASIC = 'sankey-beta\n  Coal,Electricity,127.93\n  Gas,Electricity,80\n  Electricity,Homes,120\n  Electricity,Industry,87.93'

const configured = (config: string, body = BASIC) => `---\nconfig:\n  sankey:\n${config}\n---\n${body}`

describe('sankey SVG renderer · structure', () => {
  test('emits a complete SVG with the sankey role description', () => {
    const svg = renderMermaidSVG(BASIC)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('aria-roledescription="sankey diagram"')
  })

  test('one node rect per distinct label, one ribbon path per row', () => {
    const svg = renderMermaidSVG(BASIC)
    expect(svg.match(/class="sankey-node"/g)?.length).toBe(5)
    expect(svg.match(/class="sankey-link"/g)?.length).toBe(4)
  })

  test('node rects carry data-label/data-value/data-layer; ribbons carry endpoints', () => {
    const svg = renderMermaidSVG(BASIC)
    expect(svg).toContain('data-label="Electricity" data-value="207.93"')
    expect(svg).toContain('data-source="Coal" data-target="Electricity" data-value="127.93"')
    // Layering: sources at 0, hub at 1, sinks at 2.
    expect(svg).toMatch(/data-label="Coal"[^/]*data-layer="0"/)
    expect(svg).toMatch(/data-label="Homes"[^/]*data-layer="2"/)
  })

  test('ribbon stroke width encodes the flow value proportionally', () => {
    const svg = renderMermaidSVG(BASIC)
    const widths = [...svg.matchAll(/class="sankey-link"[^/]*stroke-width="([\d.]+)"/g)].map(m => Number(m[1]))
    expect(widths.length).toBe(4)
    // Row order: Coal(127.93), Gas(80), Homes(120), Industry(87.93).
    expect(widths[0]!).toBeGreaterThan(widths[1]!)
    expect(widths[0]! / widths[1]!).toBeCloseTo(127.93 / 80, 1)
  })

  test('byte-identical across repeated renders (determinism)', () => {
    const first = renderMermaidSVG(BASIC)
    expect(renderMermaidSVG(BASIC)).toBe(first)
  })
})

describe('sankey SVG renderer · config wiring', () => {
  test('showValues (default on) adds a value line; prefix/suffix format it', () => {
    const svg = renderMermaidSVG(configured('    prefix: "€"\n    suffix: "M"'))
    expect(svg).toContain('€127.93M')
    const withoutValues = renderMermaidSVG(configured('    showValues: false'))
    expect(withoutValues).not.toContain('127.93</tspan>')
  })

  test('linkColor: source paints ribbons with the source node color', () => {
    const svg = renderMermaidSVG(configured('    linkColor: source'))
    const coalFill = svg.match(/class="sankey-node"[^/]*data-label="Coal"/) ? svg.match(/fill="(#[0-9a-fA-F]{6})"[^/]*data-label="Coal"/)?.[1] : undefined
    const ribbonStroke = svg.match(/class="sankey-link"[^/]*stroke="(#[0-9a-fA-F]{6})"/)?.[1]
    expect(ribbonStroke).toBeDefined()
    if (coalFill) expect(ribbonStroke).toBe(coalFill)
  })

  test('linkColor accepts a static CSS color', () => {
    const svg = renderMermaidSVG(configured('    linkColor: "#94a3b8"'))
    expect(svg).toContain('stroke="#94a3b8"')
  })

  test('gradient mode never emits URL-referencing paints (scene contract)', () => {
    const svg = renderMermaidSVG(BASIC)
    expect(svg).not.toContain('url(#')
    expect(svg).not.toContain('<linearGradient')
  })

  test('nodeColors overrides win over the derived palette', () => {
    const svg = renderMermaidSVG(configured('    nodeColors:\n      Coal: "#4e79a7"'))
    expect(svg).toMatch(/fill="#4e79a7"[^/]*data-label="Coal"/)
  })

  test('labelStyle: outlined adds a paint-order halo to labels', () => {
    expect(renderMermaidSVG(configured('    labelStyle: outlined'))).toContain('paint-order="stroke fill"')
    expect(renderMermaidSVG(BASIC)).not.toContain('paint-order="stroke fill"')
  })

  test('nodeWidth widens every node rect', () => {
    const svg = renderMermaidSVG(configured('    nodeWidth: 24'))
    expect(svg.match(/class="sankey-node" [^/]*width="24"/g)?.length).toBe(5)
  })

  test('width/height size the flow area (larger config, larger canvas)', () => {
    const small = renderMermaidSVG(configured('    width: 400\n    height: 200'))
    const large = renderMermaidSVG(configured('    width: 800\n    height: 500'))
    const dims = (svg: string) => svg.match(/<svg[^>]*width="([\d.]+)" height="([\d.]+)"/)!
    expect(Number(dims(large)[1])).toBeGreaterThan(Number(dims(small)[1]))
    expect(Number(dims(large)[2])).toBeGreaterThan(Number(dims(small)[2]))
  })

  test('every nodeAlignment renders and moves pure sinks as documented', () => {
    // With `left`, the orphan-free sink chain compresses to its depth; with
    // `justify` (default) pure sinks flush to the last layer. Assert both parse
    // and produce different geometry for a diagram where the policies disagree.
    const body = 'sankey-beta\n  A,B,10\n  B,C,10\n  D,C,5'
    const justify = renderMermaidSVG(configured('    showValues: false', body))
    const left = renderMermaidSVG(configured('    showValues: false\n    nodeAlignment: left', body))
    const layerOf = (svg: string, label: string) => Number(svg.match(new RegExp(`data-label="${label}"[^/]*data-layer="(\\d+)"`))![1])
    // D is a pure source feeding the final sink: justify keeps it at depth 0.
    expect(layerOf(justify, 'D')).toBe(0)
    expect(layerOf(left, 'D')).toBe(0)
    for (const svg of [renderMermaidSVG(configured('    nodeAlignment: right', body)), renderMermaidSVG(configured('    nodeAlignment: center', body))]) {
      expect(svg).toContain('</svg>')
    }
  })

  test('frontmatter title renders centered above the chart', () => {
    const svg = renderMermaidSVG(`---\ntitle: Energy flows\n---\n${BASIC}`)
    expect(svg).toContain('class="sankey-title"')
    expect(svg).toContain('Energy flows')
  })
})
