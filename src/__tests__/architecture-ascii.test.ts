import { describe, expect, it } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { visualWidth } from '../ascii/width.ts'

describe('renderMermaidASCII – architecture diagrams', () => {
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

  it('renders nested groups with indentation', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      group outer(cloud)[Outer]
      group inner(server)[Inner] in outer
      service api(server)[API] in inner`)

    expect(ascii).toContain('Outer')
    expect(ascii).toContain('Inner')
    expect(ascii).toContain('[server] API')
    // Inner group should be indented relative to outer
    const outerLine = ascii.split('\n').find((l: string) => l.includes('Outer'))!
    const innerLine = ascii.split('\n').find((l: string) => l.includes('Inner'))!
    expect(innerLine.indexOf('Inner')).toBeGreaterThan(outerLine.indexOf('Outer'))
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
    const ascii = renderMermaidASCII(`architecture-beta
      group app(cloud)[Application]
      service api(server)[API] in app
      service db(database)[Database]
      api{group}:R -[reads]-> L:db`, { useAscii: true })
    expect(ascii).toContain('[reads]')
    expect(ascii).not.toContain('API:R')
    const labelRow = ascii.split('\n').find(line => line.includes('[reads]'))!
    expect(labelRow).toMatch(/[|+][-+]*\[reads\][-+>]*[+|]/)
  })

  it('honors hard display-cell width without splitting CJK or ZWJ graphemes', () => {
    const source = `architecture-beta
      service a(server)[入口 👩🏽‍💻]
      service b(database)[資料庫]
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

  it('keeps nested group and service labels spatially contained', () => {
    const ascii = renderMermaidASCII(`architecture-beta
      group outer(cloud)[Outer]
      group inner(server)[Inner] in outer
      service api(server)[API] in inner`, { useAscii: true })
    const rows = ascii.split('\n')
    const outerTop = rows.findIndex(line => line.includes('Outer'))
    const innerTop = rows.findIndex(line => line.includes('Inner'))
    const serviceRow = rows.findIndex(line => line.includes('[server] API'))
    expect(outerTop).toBeLessThan(innerTop)
    expect(innerTop).toBeLessThan(serviceRow)
    expect(rows[innerTop]!.indexOf('Inner')).toBeGreaterThan(rows[outerTop]!.indexOf('Outer'))
    expect(rows[serviceRow]!.indexOf('[server] API')).toBeGreaterThan(rows[innerTop]!.indexOf('+'))
  })
})
