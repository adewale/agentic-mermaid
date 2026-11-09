import { describe, expect, test } from 'bun:test'
import { SaxesParser } from 'saxes'
import { Resvg } from '@resvg/resvg-js'
import { prepareResvgMarkerOrientation } from '../resvg-marker-orientation.ts'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { colorPixelBox, redPixel, renderSvgPixels } from './helpers/raster.ts'

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
  test.each([{ direction: 'LR', count: 10 }, ...['LR', 'RL', 'TB', 'BT'].map(direction => ({ direction, count: 16 }))])('keeps crowded labelled arrowheads distinct in $direction ($count)', ({ direction, count }) => {
    const source = `flowchart ${direction}\nT[Target]\n` + Array.from({ length: count }, (_, index) => `s${index}[S${index}] -->|Message ${index}| T`).join('\n')
    const result = renderMermaidSVGWithReceipt(source, { embedFontImport: false, graphLayout: { backend: 'agentic', fallback: 'none' } })
    const carriers = [...result.svg.matchAll(/<polyline\b[^>]*\/>/g)].map(match => match[0]).filter(tag => tag.includes('data-to="T"'))
    expect(carriers).toHaveLength(count)
    const ends = carriers.map(tag => /points="([^"]+)"/.exec(tag)![1]!.trim().split(/\s+/).at(-1)!.split(',').map(Number))
    const cross = direction === 'LR' || direction === 'RL' ? 1 : 0
    const coordinates = ends.map(point => point[cross]!).sort((a, b) => a - b)
    // Read the emitted marker viewport and stroke, independently of the
    // producer's footprint or port certificate. Every target head needs room.
    const marker = /<marker id="arrowhead"[^>]*markerHeight="([^"]+)"/.exec(result.svg)!
    const shaft = Number(/stroke-width="([^"]+)"/.exec(carriers[0]!)![1])
    for (let index = 1; index < coordinates.length; index++) expect(coordinates[index]! - coordinates[index - 1]!).toBeGreaterThan(Number(marker[1]) * shaft)

    // Selected-pair subtraction checks actual painted ink as well as anchors.
    // The other heads, shafts, labels and bodies remain in all four variants.
    const selected = carriers[0]!, peer = carriers[1]!, strip = (tag: string) => tag.replace(/ marker-end="[^"]*"/, '')
    const variants = [result.svg, result.svg.replace(selected, strip(selected)), result.svg.replace(peer, strip(peer)), result.svg.replace(selected, strip(selected)).replace(peer, strip(peer))]
    const images = variants.map(svg => new Resvg(prepareResvgMarkerOrientation(svg), { background: '#ffffff', fitTo: { mode: 'zoom', value: 3 } }).render())
    const a = ends[0]!, b = ends[1]!, pixels = images.map(image => image.pixels)
    const delta = (first: Uint8Array, second: Uint8Array, offset: number) => Math.abs(first[offset]! - second[offset]!) + Math.abs(first[offset + 1]! - second[offset + 1]!) + Math.abs(first[offset + 2]! - second[offset + 2]!)
    let exposed = 0, hidden = 0
    for (let y = Math.floor((Math.min(a[1]!, b[1]!) - 12) * 3); y < Math.ceil((Math.max(a[1]!, b[1]!) + 12) * 3); y++) {
      for (let x = Math.floor((Math.min(a[0]!, b[0]!) - 12) * 3); x < Math.ceil((Math.max(a[0]!, b[0]!) + 12) * 3); x++) {
        const offset = (y * images[0]!.width + x) * 4
        if (delta(pixels[2]!, pixels[3]!, offset) >= 6) {
          exposed++
          if (delta(pixels[0]!, pixels[1]!, offset) < 6) hidden++
        }
      }
    }
    expect(exposed).toBeGreaterThan(100)
    expect(hidden).toBe(0)
    expect(result.receipt.layoutCertification?.status).toBe('passed')
  })

  test.each(['agentic', 'elk'] as const)('%s retains distinct source markers beside formatted Unicode labels', backend => {
    for (const start of ['o', 'x'] as const) {
      const source = `flowchart LR\nA["<b>Read</b> 界 é"] ${start}-->|queue 界| B[Store]\nlinkStyle 0 stroke:#ff0000,stroke-width:2px`
      const result = renderMermaidSVGWithReceipt(source, { embedFontImport: false, graphLayout: { backend, fallback: 'none' } })
      const texts: string[] = [], nodes = new Map<string, { x: number; y: number; width: number; height: number }>()
      const groups: Array<string | undefined> = []
      let text: string | undefined, edge: Record<string, string> | undefined
      const parser = new SaxesParser({ xmlns: true })
      parser.on('opentag', tag => {
        const attrs = Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, value.value]))
        if (tag.local === 'g') groups.push(attrs.class === 'node' ? attrs['data-id'] : undefined)
        if (tag.local === 'rect' && groups.at(-1)) nodes.set(groups.at(-1)!, { x: Number(attrs.x), y: Number(attrs.y), width: Number(attrs.width), height: Number(attrs.height) })
        if (tag.local === 'polyline' && attrs.class === 'edge') edge = attrs
        if (tag.local === 'text') text = ''
      })
      parser.on('text', value => { if (text !== undefined) text += value })
      parser.on('closetag', tag => {
        if (tag.local === 'g') groups.pop()
        if (tag.local === 'text') { texts.push(text!); text = undefined }
      })
      parser.write(result.svg).close()
      expect(texts).toEqual(expect.arrayContaining(['Read 界 é', 'Store', 'queue 界']))
      expect([...nodes.keys()]).toEqual(['A', 'B'])
      expect(edge).toBeDefined()
      const points = edge!.points!.split(/\s+/).map(pair => pair.split(',').map(Number))
      const first = points[0]!, last = points.at(-1)!, a = nodes.get('A')!, b = nodes.get('B')!
      expect(first[0]).toBeCloseTo(a.x + a.width, 10)
      expect(first[1]! >= a.y && first[1]! <= a.y + a.height).toBe(true)
      expect(last[0]).toBe(b.x)
      expect(last[1]! >= b.y && last[1]! <= b.y + b.height).toBe(true)
      expect(edge!['marker-start']).toContain(start === 'o' ? 'circlehead-start-' : 'crosshead-start-')
      expect(edge!['marker-end']).toContain('arrowhead-')
      const pixels = Buffer.from(renderSvgPixels(result.svg).pixels)
      for (const end of ['start', 'end']) {
        const actual = `marker-${end}="${edge![`marker-${end}`]}"`
        expect(result.svg).toContain(actual)
        expect(Buffer.compare(pixels, Buffer.from(renderSvgPixels(result.svg.replace(actual, '')).pixels))).not.toBe(0)
      }
      expect(result.receipt.layoutDecisions?.[0]?.selected).toBe(backend)
    }
  })

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
