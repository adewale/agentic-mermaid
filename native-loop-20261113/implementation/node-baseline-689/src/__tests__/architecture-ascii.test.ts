import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { fcParameters } from './helpers/fc-parameters.ts'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalCell, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'
import { visualWidth } from '../ascii/width.ts'
import { AsciiWidthError } from '../ascii/width-error.ts'

function connectedOwnedInk(doc: TerminalDocument, edge: TerminalRegion): boolean {
  const [start, end] = edge.ports ?? []
  if (!start || !end) return false
  const cells = new Set([...doc.entries()]
    .filter(([, , cell]) => (cell.kind === 'stroke' || cell.kind === 'marker') && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id))
    .map(([x, y]) => `${x},${y}`))
  const first = `${start.x},${start.y}`, last = `${end.x},${end.y}`
  if (!cells.has(first) || !cells.has(last)) return false
  const queue = [first], seen = new Set(queue)
  for (let index = 0; index < queue.length; index++) {
    const [x, y] = queue[index]!.split(',').map(Number)
    for (const [nx, ny] of [[x! - 1, y!], [x! + 1, y!], [x!, y! - 1], [x!, y! + 1]]) {
      const next = `${nx},${ny}`
      if (cells.has(next) && !seen.has(next)) { seen.add(next); queue.push(next) }
    }
  }
  return seen.has(last)
}

/**
 * How far an edge's owned label text sits from its owned route ink, and
 * whether the finished drawing still has an empty one-row seat for the label
 * within two cells of that route (label cells themselves count as empty).
 */
function labelSeat(doc: TerminalDocument, edge: TerminalRegion, label: string): { distance: number; nearSeatFree: boolean } {
  const owned = (cell: TerminalCell) => cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)
  const ink: Array<[number, number]> = [], text = new Set<string>()
  for (const [x, y, cell] of doc.entries()) {
    if (!owned(cell)) continue
    if (cell.kind === 'stroke' || cell.kind === 'marker') ink.push([x, y])
    else if (cell.kind === 'text' && label.includes(cell.glyph)) text.add(`${x},${y}`)
  }
  const near = (x: number, y: number) => Math.min(...ink.map(([ix, iy]) => Math.max(Math.abs(y - iy), ix < x ? x - ix : ix > x + label.length - 1 ? ix - x - label.length + 1 : 0)))
  const distance = Math.min(...[...text].map(key => { const [x, y] = key.split(',').map(Number); return Math.min(...ink.map(([ix, iy]) => Math.max(Math.abs(x! - ix), Math.abs(y! - iy)))) }))
  const empty = (x: number, y: number) => text.has(`${x},${y}`) || !doc.cell(x, y)?.owners.length
  let nearSeatFree = false
  for (const [ix, iy] of ink) for (let y = iy - 2; y <= iy + 2 && !nearSeatFree; y++) for (let x = ix - 1 - label.length; x <= ix + 2 && !nearSeatFree; x++) {
    if (x < 0 || y < 0 || near(x, y) > 2) continue
    nearSeatFree = Array.from({ length: label.length }, (_, index) => empty(x + index, y)).every(Boolean)
  }
  return { distance, nearSeatFree }
}

describe('renderMermaidASCII – architecture diagrams', () => {
  // A label is drawn beside its own route: on the row above or below one of
  // its runs, or one blank column beside a vertical run; never detached below
  // the drawing. Every edge keeps connected owned ink and its arrowheads.
  it.each([false, true])('seats every edge label beside its own connected route (ASCII=%s)', useAscii => {
    const sides = ['L', 'R', 'T', 'B'] as const
    const graph = fc.record({
      services: fc.integer({ min: 2, max: 5 }),
      grouped: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
      edges: fc.uniqueArray(fc.record({
        from: fc.nat(4), to: fc.nat(4), fromSide: fc.constantFrom(...sides), toSide: fc.constantFrom(...sides),
        start: fc.boolean(), end: fc.boolean(), label: fc.stringMatching(/^[a-z]{1,9}$/),
      }), { minLength: 1, maxLength: 4, selector: edge => `${edge.from}:${edge.fromSide}` }),
    })
    fc.assert(fc.property(graph, ({ services, grouped, edges }) => {
      const lines = ['architecture-beta', '  group private(server)[Private]']
      for (let index = 0; index < services; index++) lines.push(`  service s${index}(server)[S${index}]${grouped[index] ? ' in private' : ''}`)
      const authored = edges.map(edge => ({ ...edge, from: edge.from % services, to: edge.to % services })).filter(edge => edge.from !== edge.to)
      fc.pre(authored.length > 0)
      for (const edge of authored) lines.push(`  s${edge.from}:${edge.fromSide} ${edge.start ? '<' : ''}-[${edge.label}]-${edge.end ? '>' : ''} ${edge.toSide}:s${edge.to}`)
      const source = lines.join('\n')
      const rendered = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
      const doc = terminalDocumentOf(rendered)!
      const regions = doc.regions().filter(region => region.kind === 'edge')
      expect(regions, source).toHaveLength(authored.length)
      for (const edge of regions) {
        // Edge owners are numbered in authored order; the generated ids never collide.
        const spec = authored[Number(edge.id.replace('edge:', ''))]!
        // An unroutable edge is reported and keeps its label in an owned
        // endpoint summary instead of a route.
        if (doc.diagnostics.some(diagnostic => diagnostic.feature === `architecture.${edge.id}.route`)) {
          expect(rendered.text, source).toContain(`: ${spec.label}`)
          continue
        }
        expect(connectedOwnedInk(doc, edge), `${source}\n${rendered.text}`).toBe(true)
        const markers = [...doc.entries()].filter(([, , cell]) => cell.kind === 'marker' && cell.owners.some(owner => owner.id === edge.id)).map(([x, y]) => `${x},${y}`)
        expect(markers.includes(`${edge.ports![0]!.x},${edge.ports![0]!.y}`), source).toBe(spec.start)
        expect(markers.includes(`${edge.ports![1]!.x},${edge.ports![1]!.y}`), source).toBe(spec.end)
        expect(rendered.text, source).toContain(`[${spec.label}]`)
        // Only a drawing with no empty seat near the route may push it further.
        const seat = labelSeat(doc, edge, `[${spec.label}]`)
        if (seat.nearSeatFree) expect(seat.distance, `${spec.label} is ${seat.distance} cells from its route\n${source}\n${rendered.text}`).toBeLessThanOrEqual(2)
      }
    }), fcParameters({ numRuns: 40 }))
  })

  const corpus = JSON.parse(readFileSync(new URL('../../eval/mermaid-docs-corpus/corpus.json', import.meta.url), 'utf8')) as Array<{ family: string; index: number; source: string }>
  it.each([false, true])('keeps every aligned and junction relationship connected through visible owned ink (ASCII=%s)', useAscii => {
    for (const backend of ['elk', 'agentic'] as const) for (const [index, endpoints] of [
      [3, [['src_a', 'db_one'], ['src_b', 'db_two'], ['src_c', 'db_three'], ['db_two', 'brief'], ['brief', 'analyst'], ['analyst', 'delivery']]],
      [4, [['left_disk', 'junctionCenter'], ['top_disk', 'junctionCenter'], ['bottom_disk', 'junctionCenter'], ['junctionCenter', 'junctionRight'], ['top_gateway', 'junctionRight'], ['bottom_gateway', 'junctionRight']]],
    ] as const) {
      const source = corpus.find(entry => entry.family === 'architecture' && entry.index === index)!.source
      const rendered = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none', graphLayout: { backend } })
      const doc = terminalDocumentOf(rendered)!, edges = doc.regions().filter(region => region.kind === 'edge')
      expect(edges.map(edge => [edge.from, edge.to]).sort()).toEqual([...endpoints].map(pair => [...pair]).sort())
      for (const edge of edges) {
        expect(connectedOwnedInk(doc, edge), `${backend}/${index}/${edge.id}`).toBe(true)
        for (const port of edge.ports!) {
          const dx = port.side === 'L' ? 1 : port.side === 'R' ? -1 : 0
          const dy = port.side === 'T' ? 1 : port.side === 'B' ? -1 : 0
          expect(doc.cell(port.x + dx, port.y + dy)?.owners.some(owner => owner.id === port.nodeId && owner.kind === 'node')).toBe(true)
        }
      }
      for (const match of source.matchAll(/^\s*align (row|column) ([\w -]+)$/gm)) {
        const values = match[2]!.trim().split(/\s+/).map(id => {
          const node = doc.regions().find(region => region.kind === 'node' && region.id === id)!
          return match[1] === 'row' ? node.canvasRow + ((node.rowSpan ?? 1) - 1) / 2 : (node.canvasColStart + node.canvasColEnd - 1) / 2
        })
        // Integer-cell boxes can differ in parity; rounding may cost half a cell.
        expect(Math.max(...values) - Math.min(...values), `${backend}/${index}/${match[0]}`).toBeLessThanOrEqual(0.5)
      }
      expect(doc.diagnostics).toEqual([])
      expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    }
  })

  it('refuses aligned geometry that cannot fit the caller cell width', () => {
    const source = corpus.find(entry => entry.family === 'architecture' && entry.index === 3)!.source
    expect(() => renderMermaidASCIIWithReceipt(source, { maxWidth: 24, colorMode: 'none' })).toThrow(AsciiWidthError)
  })

  it.each([false, true])('keeps reciprocal container contacts on real frame ink beside wide headers (ASCII=%s)', useAscii => {
    for (const backend of ['elk', 'agentic'] as const) for (const side of ['T', 'R', 'B', 'L'] as const) {
      const source = `architecture-beta
group outer(cloud)[Outer]
group inner(server)[Header 界👩🏽‍💻 complete] in outer
service edge-label-0(server)[入口 界👩🏽‍💻] in inner
junction edge-0 in outer
service external(database)[External]
edge-label-0{group}:${side} <--> L:external
external:R --> ${side}:edge-label-0{group}
edge-label-0:B --> T:edge-0
edge-label-0:B --> T:edge-0`
      const rendered = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none', graphLayout: { backend } })
      const doc = terminalDocumentOf(rendered)!, edges = doc.regions().filter(region => region.kind === 'edge')
      expect(rendered.text).toContain('Header 界👩🏽‍💻 complete')
      expect(rendered.text).toContain('入口 界👩🏽‍💻')
      expect(edges).toHaveLength(4)
      for (const edge of edges) expect(connectedOwnedInk(doc, edge), `${backend}/${side}/${edge.id}`).toBe(true)
      expect(edges.find(edge => edge.from === 'edge-label-0' && edge.to === 'external')?.ports?.[0]).toMatchObject({ nodeId: 'edge-label-0', boundary: { id: 'inner', kind: 'group' }, side })
      expect(edges.find(edge => edge.from === 'external')?.ports?.[1]).toMatchObject({ nodeId: 'edge-label-0', boundary: { id: 'inner', kind: 'group' }, side })
      expect(rendered.receipt.layoutCertification?.status, `${backend}/${side}`).toBe('passed')
      expect(doc.diagnostics).toEqual([])
    }
  })

  it('renders services with icon indicators and group frames', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      group app(cloud)[Application]
      service api(server)[API] in app
      service db(database)[Database]
      api:R --> L:db`, { useAscii: true })

    expect(ascii).toContain('Application')
    expect(ascii).toContain('[server] API')
    expect(ascii).toContain('[database] Database')
    expect(ascii).toContain('+')
    expect(ascii).toContain('>')
  })

  it('renders unicode mode with group frames and skips leading comments', () => {
    const ascii = renderMermaidASCII(`---
config:
  theme: neutral
---
      %%{init: { "theme": "neutral" }}%%
      %% generated sample
      architecture-beta
      group app(cloud)[Application]
      service api(server)[API] in app
      service db(database)[Database]
      api:R --> L:db`)

    expect(ascii).toContain('Application')
    expect(ascii).toContain('[server] API')
    expect(ascii).toContain('Database')
    expect(ascii).toContain('┌')
    expect(ascii).toContain('┐')
  })

  it('derives HTML colors from Mermaid wrapper theme variables', () => {
    const ascii = renderMermaidASCII(`---
config:
  theme: dark
  themeVariables:
    lineColor: "#f59e0b"
    primaryColor: "#38bdf8"
---
      architecture-beta
      service api(server)[API]
      service db(database)[Database]
      api:R --> L:db`, {
      colorMode: 'html',
    })

    expect(ascii).toContain('color:#f59e0b')
    expect(ascii).toContain('color:#38bdf8')
  })

  it('renders align sources (upstream v11.16.0) without erroring', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      service src1(server)[Source 1]
      service src2(server)[Source 2]
      service proc(server)[Processor]
      src1:B --> T:proc
      src2:B --> T:proc
      align row src1 src2`, { useAscii: true })

    expect(ascii).toContain('[server] Source 1')
    expect(ascii).toContain('[server] Source 2')
    expect(ascii).toContain('[server] Processor')
  })

  it('renders junction markers', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      group app(cloud)[Application]
      service api(server)[API] in app
      junction bus in app
      api:B --> T:bus`)

    expect(ascii).toContain('◉')
    expect(ascii).toContain('bus')
    expect(ascii).toContain('[server] API')
  })

  it('renders junction markers in ASCII mode', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      service api(server)[API]
      junction hub
      api:R --> L:hub`, { useAscii: true })

    expect(ascii).toContain('(*)')
    expect(ascii).toContain('hub')
  })

  it('renders edge labels', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      service api(server)[API]
      service db(database)[Database]
      api:R -[reads from]-> L:db`)

    expect(ascii).toContain('reads from')
    expect(ascii).toContain('API')
    expect(ascii).toContain('Database')
  })

  it('renders bidirectional edges', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      service a(server)[Service A]
      service b(server)[Service B]
      a:R <--> L:b`)

    expect(ascii).toContain('◄')
    expect(ascii).toContain('►')
    expect(ascii).toContain('Service A')
    expect(ascii).toContain('Service B')
  })

  it('renders services without icons', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      service plain[Plain Service]`)

    expect(ascii).toContain('Plain Service')
    expect(ascii).not.toContain('[]')
  })

  it('renders LR topology spatially instead of appending an endpoint edge list (A6)', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      service a(server)[A]
      service b(server)[B]
      service c(server)[C]
      a:R --> L:b
      b:R --> L:c`, { useAscii: true })
    const spatialRow = ascii.split('\n').find(line => line.includes('[server] A'))!
    expect(spatialRow).toContain('[server] B')
    expect(spatialRow).toContain('[server] C')
    expect(spatialRow.indexOf('[server] A')).toBeLessThan(spatialRow.indexOf('[server] B'))
    expect(spatialRow.indexOf('[server] B')).toBeLessThan(spatialRow.indexOf('[server] C'))
    expect(ascii).not.toMatch(/A:R|L:B|B:R|L:C/)
  })

  it('draws a group-boundary edge through the authored frame side', () => {
    const rendered = renderMermaidASCIIWithReceipt(`architecture-beta
      group app(cloud)[Application]
      service api(server)[API] in app
      service db(database)[Database]
      api{group}:R -[reads]-> L:db`, { useAscii: true })
    const ascii = rendered.text, doc = terminalDocumentOf(rendered)!, edge = doc.regions().find(region => region.kind === 'edge')!
    expect(ascii).toContain('[reads]')
    expect(ascii).not.toContain('API:R')
    expect(edge.ports?.[0]).toMatchObject({ nodeId: 'api', boundary: { id: 'app', kind: 'group' }, side: 'R' })
    expect(connectedOwnedInk(doc, edge)).toBe(true)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
  })

  it('honors hard display-cell width without splitting CJK or ZWJ graphemes', () => {
    const source = `architecture-beta
      service a(server)["入口 👩🏽‍💻"]
      service b(database)["資料庫"]
      service c(cloud)[Cloud]
      a:R --> L:b
      b:R --> L:c`
    const ascii = renderMermaidASCII(source, { useAscii: true, colorMode: 'none', targetWidth: 56 })
    expect(Math.max(...ascii.split('\n').map(visualWidth))).toBeLessThanOrEqual(56)
    expect(ascii).toContain('入口 👩🏽‍💻')
    expect(ascii).toContain('資料庫')
    expect(ascii).not.toContain('\uFFFD')
    expect(renderMermaidASCII(source, { useAscii: true, colorMode: 'none', targetWidth: 56 })).toBe(ascii)
  })

  it('keeps nested group and service labels indented and spatially contained (Unicode and ASCII)', () => {
    for (const useAscii of [false, true]) {
      const ascii = renderMermaidASCII(`architecture-beta
      group outer(cloud)[Outer]
      group inner(server)[Inner] in outer
      service api(server)[API] in inner`, { useAscii })
      const rows = ascii.split('\n')
      const outerTop = rows.findIndex(line => line.includes('Outer'))
      const innerTop = rows.findIndex(line => line.includes('Inner'))
      const serviceRow = rows.findIndex(line => line.includes('[server] API'))
      expect({ useAscii, outerAboveInner: outerTop >= 0 && outerTop < innerTop, innerAboveService: innerTop < serviceRow })
        .toEqual({ useAscii, outerAboveInner: true, innerAboveService: true })
      expect(rows[innerTop]!.indexOf('Inner')).toBeGreaterThan(rows[outerTop]!.indexOf('Outer'))
      expect(rows[serviceRow]!.indexOf('[server] API')).toBeGreaterThan(rows[innerTop]!.indexOf(useAscii ? '+' : '┌'))
    }
  })
})
