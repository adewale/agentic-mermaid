import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, renderMermaidASCIIWithReceipt } from '../index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { visualWidth } from '../ascii/width.ts'
import { measureRenderedText, renderedTextReady } from './helpers/rendered-text.ts'

const SOURCE = `C4Container
Person(user,"User")
Container(api,"API","Go")
ContainerDb_Ext(db,"Store","SQL")
Rel(user,api,"Calls","HTTPS")
Rel(api,db,"Reads","SQL")`

// These test presentation choices at the public outputs: no source mutation,
// optional chrome, executable paint, and independently allocated cell routes.
describe('C4 presentation', () => {
  test('invalid row settings warn without disabling compact terminal reflow', () => {
    const options = { colorMode: 'none' as const, targetWidth: 60, mermaidConfig: { c4: { compact: true, typeLegend: false } } }
    const baseline = renderMermaidASCIIWithReceipt(SOURCE, options).text
    for (const c4ShapeInRow of [0, 1.5, 'bad']) {
      const fields: string[] = []
      const configured = renderMermaidASCIIWithReceipt(SOURCE, {
        ...options, mermaidConfig: { c4: { ...options.mermaidConfig.c4, c4ShapeInRow } } as never,
        onConfigDiagnostic: diagnostic => fields.push(diagnostic.field),
      })
      expect(fields).toEqual(['c4.c4ShapeInRow'])
      expect(configured.text).toBe(baseline)
    }
  })
  test('automatic type legends can be omitted without hiding card semantics', () => {
    const options = { mermaidConfig: { c4: { typeLegend: false } } }
    const svg = renderMermaidSVG(SOURCE, options), text = renderMermaidASCIIWithReceipt(SOURCE, { ...options, colorMode: 'none' }).text
    expect(svg).not.toContain('class="c4-legend"')
    expect(text).not.toContain('Legend')
    for (const label of ['User', 'Person', 'API', 'Go', 'Store', 'External Container', 'Database', 'SQL']) {
      expect(svg).toContain(label)
      expect(text).toContain(label)
    }
    expect(renderMermaidSVG(SOURCE)).toContain('class="c4-legend"')
  })

  test('explicit authored legends survive the automatic type legend switch', () => {
    const source = SOURCE + '\nAddElementTag("critical",$bgColor="#fecaca",$legendText="Critical service")\nSHOW_LEGEND()'
    const options = { mermaidConfig: { c4: { typeLegend: false } } }
    const svg = renderMermaidSVG(source, options), text = renderMermaidASCIIWithReceipt(source, { ...options, colorMode: 'none' }).text
    const legend = svg.slice(svg.indexOf('<g class="c4-legend"'))
    expect(legend).toContain('Critical service')
    expect(legend).toContain('fill="#fecaca"')
    expect(legend).toContain('>Person<')
    expect(text).toContain('Critical service')
  })

  test('legend role paint is executed while authored and configured swatches retain authority', () => {
    const source = SOURCE + '\nUpdateElementStyle(api,$bgColor="#123456")'
    const svg = renderMermaidSVG(source, { style: { roles: { legend: { fillColor: '#22c55e', borderColor: '#f43f5e', textColor: '#0f172a', lineWidth: 3 } } }, mermaidConfig: { c4: { external_container_db_bg_color: '#aabbcc' } } })
    expect(svg).toMatch(/<rect\b[^>]*fill="#123456"[^>]*data-id="c4:api:surface"/)
    const legend = svg.slice(svg.indexOf('<g class="c4-legend"'))
    expect(legend).toContain('fill="#22c55e"')
    expect(legend).toContain('fill="#123456"')
    expect(legend).toContain('fill="#aabbcc"')
    expect(legend).toContain('stroke="#f43f5e" stroke-width="3"')
    expect(legend).toContain('fill="#0f172a"')
    expect(legend).toContain('<circle')
    expect(legend).toContain('<ellipse')
    expect(legend).toContain('stroke-dasharray="5 3"')
  })

  test('palette and node/group/edge style faces paint C4 surfaces and retain no-color type cues', () => {
    const palette = renderMermaidSVG('C4Context\nSystem(a,"A")', { style: { colors: { bg: '#0b1020', fg: '#f1f5f9', surface: '#172554', border: '#3b82f6' } } })
    expect(palette).toMatch(/<rect\b[^>]*fill="#172554"[^>]*stroke="#3b82f6"[^>]*data-id="c4:a:surface"/)
    const source = 'C4Container\nSystem_Boundary(app,"Application") {\nPerson(user,"User")\nContainerDb_Ext(db,"Store","SQL")\n}\nRel(user,db,"Reads")'
    const svg = renderMermaidSVG(source, { style: { colors: { bg: '#ffffff', fg: '#111827', surface: '#eff6ff', border: '#2563eb' }, roles: { node: { fillColor: '#dbeafe', borderColor: '#1d4ed8', lineWidth: 2 }, group: { fillColor: '#f8fafc', headerFillColor: '#e2e8f0', borderColor: '#64748b' }, edge: { strokeColor: '#7c3aed', lineWidth: 3 } } } })
    expect(svg).toMatch(/<path\b[^>]*fill="#dbeafe"[^>]*stroke="#1d4ed8"[^>]*stroke-width="2"/)
    expect(svg).toMatch(/<rect\b[^>]*fill="#f8fafc"[^>]*stroke="#64748b"/)
    expect(svg).toMatch(/<path\b[^>]*fill="#e2e8f0"/)
    expect(svg).toMatch(/<polyline\b[^>]*stroke="#7c3aed"[^>]*stroke-width="3"/)
    const text = renderMermaidASCIIWithReceipt(source, { colorMode: 'none' }).text
    for (const cue of ['Person', 'External Container', 'Database', 'System Boundary', '/|\\']) expect(text).toContain(cue)
  })

  test('global label typography is measured and rendered in legend headings and wrapped entries', async () => {
    const source = SOURCE + '\nAddElementTag("critical",$legendText="Critical customer-facing data systems")\nSHOW_LEGEND()'
    const svg = renderMermaidSVG(source, { style: { roles: { label: { fontSize: 24, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' } } }, mermaidConfig: { c4: { maxWidth: 500, compact: true } } })
    const legendAt = svg.indexOf('<g class="c4-legend"'), legend = svg.slice(legendAt)
    const tags = [...legend.matchAll(/<text\b[^>]*>/g)].map(match => match[0])
    expect(tags).toHaveLength(5)
    for (const tag of tags) {
      expect(tag).toContain('font-size="24"')
      expect(tag).toContain('font-weight="700"')
      expect(tag).toContain('letter-spacing="1.5"')
    }
    await renderedTextReady()
    const census = measureRenderedText(svg), preceding = [...svg.slice(0, legendAt).matchAll(/<text\b/g)].length, labels = census.texts.slice(preceding)
    expect(labels[0]!.content).toBe('LEGEND')
    expect(labels.at(-1)!.content).toBe('CRITICAL CUSTOMER-FACING DATA SYSTEMS')
    expect(labels.at(-1)!.box!.height).toBeGreaterThan(24)
    for (const [index, label] of labels.entries()) {
      expect(label.offCanvasPixels).toBe(0)
      expect(label.pixels).toBeGreaterThan(0)
      if (index) expect(label.box!.y).toBeGreaterThan(labels[index - 1]!.box!.y + labels[index - 1]!.box!.height)
    }
  })

  for (const fixture of [
    { source: SOURCE, budget: 60, edges: 2, labels: ['User', 'API', 'Store', 'Calls', 'Reads', 'HTTPS', 'SQL'] },
    { source: 'C4Deployment\nNode(prod,"Production","Linux") {\nContainer(api,"API 界","Go")\nContainerDb(db,"Store","SQL")\n}\nPerson(user,"User")\nRel(user,api,"Calls","HTTPS")\nBiRel(api,db,"Sync")\nRel_Back(api,db,"Returns")\nRel(api,api,"Retries")', budget: 100, edges: 4, labels: ['Production', 'Linux', 'User', 'API 界', 'Store', 'Calls', 'Sync', 'Returns', 'Retries', 'HTTPS', 'SQL'] },
  ]) test.each([false, true])(`compact terminal packing fits ${fixture.budget} cells with complete owned routes (ASCII=%s)`, useAscii => {
    const options = { useAscii, colorMode: 'none' as const, targetWidth: fixture.budget, mermaidConfig: { c4: { typeLegend: false } } }
    expect(() => renderMermaidASCIIWithReceipt(fixture.source, options)).toThrow(`Cannot render c4 within ${fixture.budget} terminal cells`)
    const rendered = renderMermaidASCIIWithReceipt(fixture.source, { ...options, mermaidConfig: { c4: { compact: true, typeLegend: false } } })
    expect(Math.max(...rendered.text.split('\n').map(visualWidth))).toBeLessThanOrEqual(fixture.budget)
    for (const text of fixture.labels) expect(rendered.text).toContain(text)
    const document = terminalDocumentOf(rendered)!, edges = document.regions().filter(region => region.kind === 'edge')
    expect(edges).toHaveLength(fixture.edges)
    for (const edge of edges) {
      const cells = new Map([...document.entries()].filter(([, , cell]) => (cell.kind === 'stroke' || cell.kind === 'marker') && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).map(([x, y, cell]) => [String(`${x},${y}`), cell] as const))
      const start = edge.ports!.find(port => port.end === 'start')!, end = edge.ports!.find(port => port.end === 'end')!
      const pending = [`${start.x},${start.y}`], seen = new Set(pending)
      for (let i = 0; i < pending.length; i++) {
        const at = pending[i]!, [x, y] = at.split(',').map(Number), cell = cells.get(at)
        const mask = cell?.kind === 'marker' ? 15 : cell?.stroke?.mask ?? 0
        for (const [dx, dy, bit, reverse] of [[0, -1, 1, 4], [1, 0, 2, 8], [0, 1, 4, 1], [-1, 0, 8, 2]]) {
          const next = `${x! + dx!},${y! + dy!}`, neighbor = cells.get(next), nextMask = neighbor?.kind === 'marker' ? 15 : neighbor?.stroke?.mask ?? 0
          if ((mask & bit!) && (nextMask & reverse!) && !seen.has(next)) { seen.add(next); pending.push(next) }
        }
      }
      expect(seen.has(`${end.x},${end.y}`), `owned ink must connect ${edge.from} to ${edge.to}`).toBe(true)
    }
    expect(() => renderMermaidASCIIWithReceipt(fixture.source, { ...options, targetWidth: 8, mermaidConfig: { c4: { compact: true } } })).toThrow('Cannot render c4 within 8 terminal cells')
  })
})
