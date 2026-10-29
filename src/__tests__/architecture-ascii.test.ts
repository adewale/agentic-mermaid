import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'
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

describe('renderMermaidASCII – architecture diagrams', () => {
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
