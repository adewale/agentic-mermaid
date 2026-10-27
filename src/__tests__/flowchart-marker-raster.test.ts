import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { colorPixelBox, redPixel } from './helpers/raster.ts'

function styled(sourceLine: string): string {
  return renderMermaidSVG(`flowchart LR
  ${sourceLine}
  linkStyle 0 stroke:#ff0000,stroke-width:2px`, { embedFontImport: false })
}

function edgeEndpoints(svg: string): { startX: number; endX: number; y: number } {
  const match = svg.match(/<polyline class="edge"[^>]*points="([\d.]+),([\d.]+) ([\d.]+),([\d.]+)"/)
  if (!match) throw new Error('expected a straight flowchart edge')
  return { startX: Number(match[1]), y: Number(match[2]), endX: Number(match[3]) }
}

describe('raster-safe Flowchart endpoint markers', () => {
  test('anchors the arrow tip itself at an exact circle outline', () => {
    const svg = styled('A --> B@{ shape: sm-circ, label: "" }')
    const edge = svg.match(/<polyline class="edge"[^>]*points="([^"]+)"[^>]*marker-end="url\(#arrowhead-23ff0000-fixed\)"/)
    const circle = svg.match(/<g class="node" data-id="B"[\s\S]*?<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/)
    const marker = svg.match(/<marker id="arrowhead-23ff0000-fixed"[^>]*refX="([\d.]+)"[^>]*markerUnits="userSpaceOnUse"[^>]*>[\s\S]*?<polygon points="([^"]+)"/)
    expect(edge).not.toBeNull()
    expect(circle).not.toBeNull()
    expect(marker).not.toBeNull()

    const points = edge![1]!.trim().split(/\s+/).map(value => value.split(',').map(Number))
    const endpointX = points.at(-1)![0]!
    const outlineX = Number(circle![1]) - Number(circle![3])
    const tipX = Math.max(...marker![2]!.split(/,\s*/).map(pair => Number(pair.trim().split(/\s+/)[0])))
    const refX = Number(marker![1])

    expect(endpointX).toBeCloseTo(outlineX, 8)
    expect(tipX - refX).toBe(0)
  })

  test('pre-rotates start arrows instead of relying on auto-start-reverse', () => {
    const svg = styled('A <--> B')
    const edge = svg.match(/<polyline class="edge"[^>]*>/)?.[0]
    expect(edge).toContain('marker-start="url(#arrowhead-start-23ff0000-fixed)"')
    expect(edge).toContain('marker-end="url(#arrowhead-23ff0000-fixed)"')
    expect(svg).not.toContain('auto-start-reverse')
    expect(svg).toMatch(/id="arrowhead-start-23ff0000-fixed"[^>]*refX="0"[^>]*orient="auto"[^>]*markerUnits="userSpaceOnUse"/)
    expect(svg).toContain('<polygon points="8 0, 0 4, 8 8"')

    const { startX, endX, y } = edgeEndpoints(svg)
    const start = colorPixelBox(svg, redPixel, { left: Math.floor(startX - 1), right: Math.ceil(startX + 15), top: Math.floor(y - 14), bottom: Math.ceil(y + 14) })
    const end = colorPixelBox(svg, redPixel, { left: Math.floor(endX - 15), right: Math.ceil(endX + 1), top: Math.floor(y - 14), bottom: Math.ceil(y + 14) })
    // Both heads are fully visible on the route side of their attachment.
    expect(start.width).toBeGreaterThanOrEqual(12)
    expect(end.width).toBeGreaterThanOrEqual(12)
    expect(Math.abs(start.height - end.height)).toBeLessThanOrEqual(1)
  })

  test('keeps start/end cross markers equally visible rather than clipping one into a node', () => {
    const svg = styled('A x--x B')
    const edge = svg.match(/<polyline class="edge"[^>]*>/)?.[0]
    expect(edge).toContain('marker-start="url(#crosshead-start-23ff0000-fixed)"')
    expect(edge).toContain('marker-end="url(#crosshead-23ff0000-fixed)"')
    expect(svg).toMatch(/id="crosshead-start-23ff0000-fixed"[^>]*refX="0.625"[^>]*orient="auto"[^>]*markerUnits="userSpaceOnUse"/)
    expect(svg).toMatch(/id="crosshead-23ff0000-fixed"[^>]*refX="7.375"[^>]*orient="auto"[^>]*markerUnits="userSpaceOnUse"/)

    const { startX, endX, y } = edgeEndpoints(svg)
    const start = colorPixelBox(svg, redPixel, { left: Math.floor(startX - 1), right: Math.ceil(startX + 15), top: Math.floor(y - 14), bottom: Math.ceil(y + 14) })
    const end = colorPixelBox(svg, redPixel, { left: Math.floor(endX - 15), right: Math.ceil(endX + 1), top: Math.floor(y - 14), bottom: Math.ceil(y + 14) })
    expect(start.width).toBeGreaterThanOrEqual(12)
    expect(end.width).toBeGreaterThanOrEqual(12)
    expect(Math.abs(start.width - end.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(start.height - end.height)).toBeLessThanOrEqual(1)
  })

  for (const backend of ['agentic', 'elk'] as const) for (const direction of ['LR', 'RL', 'TB', 'BT'] as const) {
    test(`${backend} ${direction} keeps every actual cross cap on the route side of both endpoint faces`, () => {
      for (const fixed of [false, true]) {
        const source = `flowchart ${direction}\nA x--x B${fixed ? '\nlinkStyle 0 stroke:#ff0000,stroke-width:4px' : ''}`
        const result = renderMermaidSVGWithReceipt(source, { embedFontImport: false, graphLayout: { backend, fallback: 'none' }, style: { roles: { edge: { lineWidth: 2 } } } })
        expect(result.receipt.layoutCertification?.status).not.toBe('failed')
        const edge = result.svg.match(/<polyline class="edge"[^>]*>/)?.[0]
        expect(edge).toBeDefined()
        const attr = (tag: string, name: string): string => {
          const value = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]+)"`))?.[1]
          if (value === undefined) throw new Error(`missing ${name}`)
          return value
        }
        const points = attr(edge!, 'points').split(/\s+/).map(pair => pair.split(',').map(Number))
        expect(points.length).toBe(2)
        const [start, end] = points
        expect(start![0] === end![0] || start![1] === end![1]).toBe(true)
        for (const endpoint of ['start', 'end'] as const) {
          const id = attr(edge!, `marker-${endpoint}`).slice(5, -1)
          const marker = result.svg.match(new RegExp(`<marker id="${id}"[^>]*>[\\s\\S]*?</marker>`))?.[0]
          expect(marker).toBeDefined()
          const ref = Number(attr(marker!, 'refX'))
          const units = marker!.includes('markerUnits="userSpaceOnUse"') ? 1 : Number(attr(edge!, 'stroke-width'))
          const lines = [...marker!.matchAll(/<line\s[^>]*\/>/g)].map(match => match[0])
          expect(lines.length).toBe(2)
          for (const line of lines) {
            expect(attr(line, 'stroke-linecap')).toBe('round')
            const radius = Number(attr(line, 'stroke-width')) / 2
            const min = Math.min(Number(attr(line, 'x1')), Number(attr(line, 'x2'))) - radius
            const max = Math.max(Number(attr(line, 'x1')), Number(attr(line, 'x2'))) + radius
            // Auto orientation maps local +x along the actual cardinal shaft.
            // Thus these full cap extents must stay outward of the node face.
            expect((endpoint === 'start' ? min - ref : ref - max) * units).toBeGreaterThanOrEqual(0)
          }
        }
      }
    })
  }
})
