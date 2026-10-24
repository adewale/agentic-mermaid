import { describe, expect, test } from 'bun:test'
import { renderMermaidWithActions } from '../agent/index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { visualWidth } from '../ascii/width.ts'

function render(source: string, targetWidth?: number) {
  const result = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', targetWidth })
  return { ...result, document: terminalDocumentOf(result)! }
}

describe('native terminal semantic projection regressions', () => {
  test('an authored Gantt task ID cannot acquire an anonymous task action footprint', () => {
    const source = 'gantt\ndateFormat YYYY-MM-DD\nFirst :2024-01-01, 1d\nSecond :task-0, 2024-01-03, 1d\nclick task-0 href "https://example.com"'
    const meta = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    const nodes = meta.regions.filter(region => region.kind === 'node')
    expect(nodes).toHaveLength(2)
    expect(new Set(nodes.map(region => region.id)).size).toBe(2)
    expect(nodes.find(region => region.id === 'task-0')?.projectedText).toBe('Second')
    const result = renderMermaidWithActions(source, { format: 'unicode', options: { colorMode: 'none' } })
    if (result.format !== 'unicode') throw new Error('expected terminal output')
    const rows = result.output.split('\n')
    const spans = result.actionSurface.actions[0]!.region!.cellSpans!
    expect(spans.some(span => span.row === rows.findIndex(row => row.includes('Second')))).toBe(true)
    expect(spans.some(span => span.row === rows.findIndex(row => row.includes('First')))).toBe(false)
  })

  test('Sankey adjacency regions retain parallel endpoints and avoid authored label identities', () => {
    const source = '---\ntitle: Heading\n---\nsankey-beta\ntitle,Source,3\nSource,Target,2\nSource,Target,1\nSource:value,link:Source->Target,1\nA->B,C,1\nA,B->C,1\nA,B:value,1\nlink:A->B,X,1'
    const result = render(source)
    const regions = result.document.regions()
    expect(new Set(regions.map(region => region.id)).size).toBe(regions.length)
    expect(result.text.match(/Heading/g)).toHaveLength(1)
    const parallel = regions.filter(region => region.kind === 'edge' && region.from === 'Source' && region.to === 'Target')
    expect(parallel).toHaveLength(2)
    expect(parallel[0]!.ownedCellSpans.every(span => parallel[1]!.ownedCellSpans.every(other => other.row !== span.row))).toBe(true)
    for (const edge of regions.filter(region => region.kind === 'edge')) {
      expect(regions.some(region => region.kind === 'node' && region.id === edge.from)).toBe(true)
      expect(regions.some(region => region.kind === 'node' && region.id === edge.to)).toBe(true)
    }
  })

  test('Sankey solid link policies paint the actual owned bars and gradient loss is explicit', () => {
    for (const [policy, expected] of [['source', '#ff0000'], ['target', '#00ff00'], ['#123456', '#123456']] as const) {
      const result = render(`---\nconfig:\n  sankey:\n    linkColor: "${policy}"\n    nodeColors:\n      Source: "#ff0000"\n      Target: "#00ff00"\n---\nsankey-beta\nSource,Target,2`)
      const bars = [...result.document.entries()].filter(([, , cell]) => cell.glyph === '█')
      expect(bars.length).toBeGreaterThan(0)
      expect(bars.every(([, , cell]) => cell.color === expected && cell.owners.some(owner => owner.kind === 'edge'))).toBe(true)
      expect(result.terminalStyle.diagnostics.some(diagnostic => diagnostic.feature === 'sankey.linkColor')).toBe(false)
    }
    expect(render('sankey-beta\nSource,Target,2').terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
      code: 'TERMINAL_FAMILY_PROJECTION', feature: 'sankey.linkColor', message: expect.stringContaining('gradient'),
    }))
  })

  test('Sankey reports admitted pixel/layer settings without treating invalid settings as effective', () => {
    const configured = render('---\nconfig:\n  sankey:\n    width: 900\n    height: 500\n    nodeWidth: 30\n    nodePadding: 20\n    nodeAlignment: right\n    labelStyle: outlined\n---\nsankey-beta\nA,B,1')
    for (const feature of ['sankey.width', 'sankey.height', 'sankey.nodeWidth', 'sankey.nodePadding', 'sankey.nodeAlignment', 'sankey.labelStyle']) {
      expect(configured.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature }))
    }
    const invalid = render('---\nconfig:\n  sankey:\n    width: -1\n    nodeWidth: -2\n    nodeAlignment: diagonal\n    labelStyle: blurry\n---\nsankey-beta\nA,B,1')
    expect(invalid.terminalStyle.diagnostics.filter(diagnostic => ['sankey.width', 'sankey.nodeWidth', 'sankey.nodeAlignment', 'sankey.labelStyle'].includes(diagnostic.feature))).toEqual([])
  })

  test('Sankey reports unresolved and translucent ANSI ink while retaining safe HTML paint', () => {
    for (const paint of ['rgba(255,0,0,0.4)', 'var(--brand)']) {
      const source = `---\nconfig:\n  sankey:\n    linkColor: "${paint}"\n---\nsankey-beta\nA,B,1`
      const ansi = renderMermaidASCIIWithReceipt(source, { colorMode: 'truecolor' })
      expect(ansi.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_COLOR_UNREPRESENTABLE', feature: 'sankey.linkColor' }))
      expect(ansi.text).toContain('████')
      const html = renderMermaidASCIIWithReceipt(source, { colorMode: 'html' })
      expect(html.text).toContain(`color:${paint}`)
      expect(html.terminalStyle.diagnostics.some(diagnostic => diagnostic.code === 'TERMINAL_COLOR_UNREPRESENTABLE' && diagnostic.feature === 'sankey.linkColor')).toBe(false)
    }
    const opaque = renderMermaidASCIIWithReceipt('---\nconfig:\n  sankey:\n    linkColor: "#ff0000"\n---\nsankey-beta\nA,B,1', { colorMode: 'truecolor' })
    expect(opaque.text).toContain('\x1b[38;2;255;0;0m████')
    expect(opaque.terminalStyle.diagnostics.some(diagnostic => diagnostic.feature === 'sankey.linkColor')).toBe(false)
  })

  test('Sankey absent link paint projects to transparent HTML ink and retains its authored ANSI diagnostic', () => {
    for (const [linkColor, nodeColors, feature] of [
      ['none', {}, 'sankey.linkColor'],
      ['source', { toString: 'none' }, 'sankey.nodeColors.toString'],
      ['target', { hasOwnProperty: 'none' }, 'sankey.nodeColors.hasOwnProperty'],
    ] as const) {
      const source = `%%{init: ${JSON.stringify({ sankey: { linkColor, nodeColors } })}}%%\nsankey-beta\ntoString,hasOwnProperty,1`
      for (const useAscii of [true, false]) {
        const barGlyph = useAscii ? '#' : '█'
        const html = renderMermaidASCIIWithReceipt(source, { colorMode: 'html', useAscii })
        expect(html.text).toContain(`<span style="color:transparent">${barGlyph.repeat(20)}</span>`)
        expect(html.text).not.toContain('color:none')
        const bars = [...terminalDocumentOf(html)!.entries()].filter(([, , cell]) => cell.glyph === barGlyph)
        expect(bars).toHaveLength(20)
        expect(bars.every(([, , cell]) => cell.color === 'transparent' && cell.owners.some(owner => owner.kind === 'edge'))).toBe(true)
        const ansi = renderMermaidASCIIWithReceipt(source, { colorMode: 'truecolor', useAscii })
        expect(ansi.text).toContain(barGlyph.repeat(20))
        expect(ansi.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
          code: 'TERMINAL_COLOR_UNREPRESENTABLE', feature,
          message: expect.stringContaining(`${feature}="none"`),
        }))
      }
    }
  })

  test('authored Timeline orientation has an explicit outline projection', () => {
    for (const direction of ['LR', 'TD']) {
      const result = render(`timeline ${direction}\n2026 : Start\n2027 : Finish`)
      expect(result.text).toContain('Start')
      expect(result.text).toContain('Finish')
      expect(result.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
        code: 'TERMINAL_FAMILY_PROJECTION', feature: 'timeline.direction', message: expect.stringContaining(`timeline ${direction}`),
      }))
    }
    expect(render('timeline\n2026 : Start').terminalStyle.diagnostics.some(diagnostic => diagnostic.feature === 'timeline.direction')).toBe(false)
  })

  test('XY pixel settings are diagnosed independently of native width and visibility policies', () => {
    const result = render('---\nconfig:\n  xyChart:\n    width: 900\n    height: 500\n    titleFontSize: 50\n    plotReservedSpacePercent: 70\n    showDataLabel: true\n    showDataLabelOutsideBar: false\n    xAxis:\n      tickLength: 20\n      tickWidth: 5\n---\nxychart-beta\ntitle "Title"\nx-axis [A,B]\nbar [1,2]', 50)
    for (const feature of ['xyChart.width', 'xyChart.height', 'xyChart.titleFontSize', 'xyChart.plotReservedSpacePercent', 'xyChart.showDataLabelOutsideBar', 'xyChart.xAxis.tickLength', 'xyChart.xAxis.tickWidth']) {
      expect(result.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature }))
    }
    expect(Math.max(...result.text.split('\n').map(visualWidth))).toBeLessThanOrEqual(50)
    const hidden = render('---\nconfig:\n  xyChart:\n    showTitle: false\n    titleFontSize: 50\n    xAxis:\n      showTick: false\n      tickLength: 20\n---\nxychart-beta\ntitle "Hidden"\nx-axis [A,B]\nbar [1,2]')
    expect(hidden.text).not.toContain('Hidden')
    expect(hidden.terminalStyle.diagnostics.filter(diagnostic => diagnostic.feature === 'xyChart.titleFontSize' || diagnostic.feature === 'xyChart.xAxis.tickLength')).toEqual([])
  })

  test('implicit Timeline and Journey sections have real containing bands', () => {
    for (const source of ['timeline\n2026 : Event', 'journey\nTask : 3: Me']) {
      const result = render(source)
      const regions = result.document.regions()
      const child = regions.find(region => region.parentId === 'section-0')!
      const section = regions.find(region => region.id === child.parentId)!
      expect(section?.kind).toBe('band')
      expect(section.members).toContain(child.id)
      for (const span of child.ownedCellSpans) {
        expect(span.row).toBeGreaterThanOrEqual(section.canvasRow)
        expect(span.row).toBeLessThan(section.canvasRow + (section.rowSpan ?? 1))
        expect(span.start).toBeGreaterThanOrEqual(section.canvasColStart)
        expect(span.end).toBeLessThanOrEqual(section.canvasColEnd)
      }
      expect(regions.filter(region => region.parentId && !regions.some(parent => parent.id === region.parentId))).toEqual([])
    }
  })
})
