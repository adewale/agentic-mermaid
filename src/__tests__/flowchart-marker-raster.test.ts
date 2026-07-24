import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
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
    const edge = svg.match(/<polyline class="edge"[^>]*points="([^"]+)"[^>]*marker-end="url\(#arrowhead-23ff0000\)"/)
    const circle = svg.match(/<g class="node" data-id="B"[\s\S]*?<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/)
    const marker = svg.match(/<marker id="arrowhead-23ff0000"[^>]*refX="([\d.]+)"[^>]*>[\s\S]*?<polygon points="([^"]+)"/)
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
    expect(svg).not.toContain('auto-start-reverse')
    expect(svg).toMatch(/id="arrowhead-start"[^>]*refX="0"[^>]*orient="auto"/)
    expect(svg).toContain('<polygon points="8 0, 0 2.5, 8 5"')
    expect(svg).toMatch(/id="arrowhead-start-23ff0000"[^>]*refX="0"[^>]*orient="auto"/)

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
    expect(svg).toMatch(/id="crosshead-start-23ff0000"[^>]*refX="1.25"[^>]*orient="auto"/)
    expect(svg).toMatch(/id="crosshead-23ff0000"[^>]*refX="6.75"[^>]*orient="auto"/)

    const { startX, endX, y } = edgeEndpoints(svg)
    const start = colorPixelBox(svg, redPixel, { left: Math.floor(startX - 1), right: Math.ceil(startX + 15), top: Math.floor(y - 14), bottom: Math.ceil(y + 14) })
    const end = colorPixelBox(svg, redPixel, { left: Math.floor(endX - 15), right: Math.ceil(endX + 1), top: Math.floor(y - 14), bottom: Math.ceil(y + 14) })
    expect(start.width).toBeGreaterThanOrEqual(12)
    expect(end.width).toBeGreaterThanOrEqual(12)
    expect(Math.abs(start.width - end.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(start.height - end.height)).toBeLessThanOrEqual(1)
  })
})
