import { serializeTerminalArtifact, type TerminalArtifact } from '../ascii/terminal-artifact.ts'
import { describe, expect, test } from 'bun:test'
import { DEFAULT_ASCII_THEME } from '../ascii/ansi.ts'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderGanttTerminal as renderGanttAscii } from '../ascii/gantt.ts'
import { renderJourneyTerminal as renderJourneyAscii } from '../ascii/journey.ts'
import { renderPieTerminal as renderPieAscii } from '../ascii/pie.ts'
import { renderQuadrantTerminal as renderQuadrantAscii } from '../ascii/quadrant.ts'
import { renderRadarTerminal as renderRadarAscii } from '../ascii/radar.ts'
import { renderSankeyTerminal as renderSankeyAscii } from '../ascii/sankey.ts'
import { renderTimelineTerminal as renderTimelineAscii } from '../ascii/timeline.ts'
import { terminalDocumentOf, type TerminalDocument } from '../ascii/terminal-document.ts'
import type { AsciiConfig } from '../ascii/types.ts'
import { visualWidth, WIDE_CHAR_CONTINUATION } from '../ascii/width.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { renderMermaidWithActions } from '../agent/index.ts'

function capture(render: (config: AsciiConfig) => TerminalArtifact): TerminalDocument {
  const config: AsciiConfig = { useAscii: false, paddingX: 5, paddingY: 5, boxBorderPadding: 1, graphDirection: 'TD' }
  const artifact = render(config)
  serializeTerminalArtifact(artifact)
  return artifact.document
}

function authored(document: TerminalDocument, id: string): Array<{ x: number; y: number; glyph: string }> {
  return [...document.entries()]
    .filter(([, , cell]) => cell.kind === 'text' && cell.glyph !== WIDE_CHAR_CONTINUATION && cell.owners.some(owner => owner.id === id))
    .map(([x, y, cell]) => ({ x, y, glyph: cell.glyph }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

describe('terminal outline and chart ownership', () => {
  test.each([false, true])('anonymous Gantt tasks cannot capture an authored task action (ASCII=%s)', useAscii => {
    const source = 'gantt\ndateFormat YYYY-MM-DD\nFirst :2024-01-01, 1d\nSecond :task-0, 2024-01-03, 1d\nclick task-0 href "https://example.com"'
    const options = { useAscii, colorMode: 'none' as const }
    const rendered = renderMermaidASCIIWithMeta(source, options)
    const explicit = rendered.regions.find(region => region.kind === 'node' && region.id === 'task-0')!
    const anonymous = rendered.regions.find(region => region.kind === 'node' && region.projectedText === 'First')!
    expect(explicit.projectedText).toBe('Second')
    expect(anonymous.id).not.toBe(explicit.id)
    expect(explicit.canvasRow).toBe(1)
    expect(explicit.rowSpan ?? 1).toBe(1)
    const artifact = renderMermaidWithActions(source, { format: useAscii ? 'ascii' : 'unicode', options })
    const action = artifact.actionSurface.actions[0]!
    expect(action.target).toBe('task-0')
    expect(action.region?.bounds).toMatchObject({ y: 1, h: 1 })
    expect(action.region?.cellSpans?.every(span => span.row === 1)).toBe(true)
  })

  test('Radar keeps duplicate axis and curve occurrences distinct through legends and numeric cells', () => {
    const source = 'radar-beta\naxis a["First axis"], a["Second axis"]\ncurve x["First series"]{1,2}\ncurve x["Second series"]{2,1}\nmax 3'
    for (const prefix of ['', 'curve y["Inserted"]{1,1}\n']) {
      const rendered = renderMermaidASCIIWithMeta(source.replace('curve x["First series"]', `${prefix}curve x["First series"]`), { colorMode: 'none' })
      const region = (id: string) => rendered.regions.find(region => region.id === id)!
      expect(region('a#0')?.projectedText).toBe('First axis')
      expect(region('a#1')?.projectedText).toBe('Second axis')
      expect(region('x#0')?.projectedText).toBe('First series')
      expect(region('x#1')?.projectedText).toBe('Second series')
      for (const [id, value, magnitude] of [['x#0:a#0', '1', 8], ['x#0:a#1', '2', 16], ['x#1:a#0', '2', 16], ['x#1:a#1', '1', 8]] as const) {
        const bar = region(id)
        expect(bar?.parentId).toBe(id.slice(0, 3))
        expect(bar?.ownedCellSpans?.reduce((sum, span) => sum + span.end - span.start, 0)).toBe(magnitude)
        expect(region(`${id}:value`)?.projectedText?.trim()).toBe(value)
      }
    }
  })

  test('Radar distinguishes an axis and curve sharing an authored ID while retaining unique authored IDs', () => {
    const rendered = renderMermaidASCIIWithMeta('radar-beta\naxis same["Axis"], other["Other"]\ncurve same["Series"]{1,2}', { colorMode: 'none' })
    const nodes = rendered.regions.filter(region => region.kind === 'node')
    expect(nodes.map(region => [region.id, region.projectedText])).toEqual([
      ['curve:same', 'Series'], ['axis:same', 'Axis'], ['other', 'Other'],
    ])
    expect(rendered.regions.find(region => region.id === 'curve:same:axis:same')?.parentId).toBe('curve:same')
  })

  test('repeated outline text keeps native event/task identities and opaque authored spaces', () => {
    const timeline = capture(config => renderTimelineAscii('timeline\n2026 : Same name\n2027 : Same name'.split('\n'), config))
    const journey = capture(config => renderJourneyAscii('journey\nSame name: 3: Person\nSame name: 4: Person', config))
    for (const [document, first, second] of [[timeline, 'event-0', 'event-1'], [journey, 'task-0', 'task-1']] as const) {
      const a = authored(document, first), b = authored(document, second)
      expect(a.map(cell => cell.glyph).join('')).toBe('Same name')
      expect(b.map(cell => cell.glyph).join('')).toBe('Same name')
      expect(a[0]!.y).toBeLessThan(b[0]!.y)
      expect(a.some(cell => cell.glyph === ' ')).toBe(true)
    }
  })

  test('compact Gantt labels and individual bar intervals retain each task owner', () => {
    const document = capture(config => renderGanttAscii(
      ['gantt', 'dateFormat YYYY-MM-DD', 'First task :a, 2024-01-01, 1d', 'Next task :b, 2024-01-03, 1d'],
      config, 'none', DEFAULT_ASCII_THEME, { config: { gantt: { displayMode: 'compact' } } },
    ))
    expect(authored(document, 'a').map(cell => cell.glyph).join('')).toBe('First task')
    expect(authored(document, 'b').map(cell => cell.glyph).join('')).toBe('Next task')
    const bars = [...document.entries()].filter(([, , cell]) => cell.kind === 'mark' && cell.glyph === '█')
    for (const id of ['a', 'b']) expect(bars.some(([, , cell]) => cell.owners.some(owner => owner.id === id))).toBe(true)
  })

  test('Gantt topAxis places the owned time scale before tasks without changing task meaning', () => {
    const source = ['gantt', 'dateFormat YYYY-MM-DD', 'section Work', 'First task :a, 2024-01-01, 2d']
    const bottom = capture(config => renderGanttAscii(source, config))
    const top = capture(config => renderGanttAscii([source[0]!, 'topAxis', ...source.slice(1)], config))
    const region = (document: TerminalDocument, id: string) => document.regions().find(region => region.id === id)!
    expect(region(bottom, 'time-axis').canvasRow).toBeGreaterThan(region(bottom, 'a').canvasRow)
    expect(region(top, 'time-axis').canvasRow).toBeLessThan(region(top, 'a').canvasRow)
    expect(authored(top, 'a').map(cell => cell.glyph).join('')).toBe(authored(bottom, 'a').map(cell => cell.glyph).join(''))
    expect(region(top, 'section#0').members).toEqual(['a'])
  })

  test('literal Gantt and Radar labels wrap their visible characters without multiplying authored tags', () => {
    const label = '<b>This is a long literal label for the delivery team</b>'
    const gantt = capture(config => renderGanttAscii(['gantt', 'dateFormat YYYY-MM-DD', `${label} :a, 2024-01-01, 1d`], config, 'none', DEFAULT_ASCII_THEME, {}, { maxWidth: 70 }))
    const radar = capture(config => renderRadarAscii(['radar-beta', 'axis a["Axis"]', `curve c["${label}"]{1}`], config, 'none', DEFAULT_ASCII_THEME, {}, 50))
    for (const [document, id] of [[gantt, 'a'], [radar, 'c']] as const) {
      const region = document.regions().find(region => region.id === id)!
      expect(region.rowSpan).toBeGreaterThan(1)
      expect(region.projectedText?.match(/<b>/g)).toHaveLength(1)
      expect(region.projectedText?.match(/<\/b>/g)).toHaveLength(1)
      expect(region.projectedText).not.toContain('<br/>')
      expect(region.projectedText?.replace(/\s+/g, ' ')).toBe(label)
    }
  })

  test('Pie and Radar keep palette paint on owned data rather than encoded label strings', () => {
    const pie = capture(config => renderPieAscii(['pie', '"日本 name" : 2', '"Other" : 1'], config, 'none', DEFAULT_ASCII_THEME))
    expect(authored(pie, 'slice-0').map(cell => cell.glyph).join('')).toBe('日本 name')
    const pieBars = [...pie.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.id === 'slice-0:bar'))
    expect(pieBars.length).toBeGreaterThan(0)
    expect(pieBars.every(([, , cell]) => cell.kind === 'mark' && cell.color !== undefined)).toBe(true)

    const radar = capture(config => renderRadarAscii(['radar-beta', 'axis a["Same"], b["Same"]', 'curve x["Curve name"]{1,2}'], config, 'none', DEFAULT_ASCII_THEME))
    expect(authored(radar, 'a').map(cell => cell.glyph).join('')).toBe('Same')
    expect(authored(radar, 'b').map(cell => cell.glyph).join('')).toBe('Same')
    expect([...radar.entries()].some(([, , cell]) => cell.kind === 'mark' && cell.color !== undefined && cell.owners.some(owner => owner.parent?.id === 'x' && owner.parent.kind === 'node'))).toBe(true)
    const rings = radar.regions().filter(region => region.kind === 'ring')
    expect(rings).toHaveLength(5)
    expect(rings.every(region => region.ownedCellSpans.length === 1)).toBe(true)
    const lastRing = rings.find(region => region.id === 'ring:4')!
    const maximumBar = [...radar.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.id === 'x:b'))
    expect(lastRing.canvasColStart).toBe(Math.max(...maximumBar.map(([x]) => x)))
  })

  test('zero-valued Pie slices keep labels and numbers without inventing bar magnitude', () => {
    for (const entries of [['"Zero" : 0', '"Positive" : 1'], ['"Zero" : 0']]) {
      const document = capture(config => renderPieAscii(['pie showData', ...entries], config, 'none', DEFAULT_ASCII_THEME))
      expect(authored(document, 'slice-0').map(cell => cell.glyph).join('')).toBe('Zero')
      expect(document.regions().find(region => region.id === 'slice-0:bar')).toBeUndefined()
      expect(authored(document, 'slice-0:value').map(cell => cell.glyph).join('')).toContain('0.0%  [0]')
    }
    const empty = capture(config => renderPieAscii(['pie'], config, 'none', DEFAULT_ASCII_THEME))
    expect(empty.serialize({ colorMode: 'none' })).toBe('')
    expect(empty.regions()).toEqual([])
  })

  test('highlighted zero Pie entries reserve marker and raw-value width before wrapping', () => {
    const source = '---\nconfig:\n  pie:\n    highlightSlice: Zero entry\n---\npie showData\n"Zero entry" : 0'
    const hard = renderMermaidASCII(source, { targetWidth: 50, colorMode: 'none' })
    expect(hard.replace(/[-\s>]/g, '')).toContain('Zeroentry')
    expect(hard).toContain('> ')
    expect(hard).toContain('0.0%  [0]')
    expect(hard).not.toContain('█')
    expect(Math.max(...hard.split('\n').map(visualWidth))).toBeLessThanOrEqual(50)
    expect(() => renderMermaidASCII(source, { maxWidth: 1, colorMode: 'none' })).not.toThrow()
  })

  test('Sankey parallel relationships own separate branches even when their labels repeat', () => {
    const document = capture(config => renderSankeyAscii(['sankey-beta', 'Source,Target,2', 'Source,Target,1'], config, 'none', DEFAULT_ASCII_THEME))
    const edges = document.regions().filter(region => region.kind === 'edge')
    expect(edges.map(region => region.id).sort()).toEqual(['link:Source->Target', 'link:Source->Target#1'])
    const footprints = edges.map(edge => new Set([...document.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).map(([x, y]) => `${x},${y}`)))
    for (const [index, footprint] of footprints.entries()) {
      expect(footprint.size).toBeGreaterThan(0)
      expect([...footprint].some(cell => !footprints[1 - index]!.has(cell))).toBe(true)
    }
    expect(authored(document, 'Target').map(cell => cell.glyph).join('')).toBe('TargetTarget')
  })

  test('a quadrant moves the complete label away from data without corrupting a wide grapheme', () => {
    const document = capture(config => renderQuadrantAscii(['quadrantChart', 'quadrant-1 "日本語"', 'Point: [0.8, 0.95]'], config, 'none', DEFAULT_ASCII_THEME))
    const marks = [...document.entries()].filter(([, , cell]) => cell.kind === 'marker' && cell.owners.some(owner => owner.id === 'point-0'))
    expect(marks).toHaveLength(1)
    expect(marks[0]![2].glyph).toBe('●')
    const text = authored(document, 'quadrant-label#1')
    expect(text.map(cell => cell.glyph).join('')).toBe('日本語')
    for (const cell of text) expect(document.cell(cell.x + 1, cell.y)?.glyph).toBe(WIDE_CHAR_CONTINUATION)
  })

  test('a quadrant label larger than its fixed region gets a complete attributed lane', () => {
    const label = 'required label '.repeat(40).trim()
    const document = capture(config => renderQuadrantAscii(['quadrantChart', `quadrant-1 "${label}"`], config, 'none', DEFAULT_ASCII_THEME, 43))
    const region = document.regions().find(region => region.id === 'quadrant-label#1')!
    expect(region.canvasRow).toBeGreaterThan(22)
    expect(region.projectedText?.replace(/\s+/g, ' ')).toBe(label)
    expect(document.serialize({ colorMode: 'none' })).toContain('quadrant-1: ')
  })

  test('Quadrant direct point paints override classes at both owned marker occurrences', () => {
    const document = capture(config => renderQuadrantAscii([
      'quadrantChart',
      'classDef painted color: #ff0000, stroke-color: #00ff00, radius: 12',
      'Class point:::painted: [0.2, 0.8]',
      'Direct point:::painted: [0.8, 0.8] color: #0000ff',
      'Hollow point:::painted: [0.2, 0.2] color: none',
      'Plain point: [0.8, 0.2]',
    ], config, 'none', DEFAULT_ASCII_THEME))
    for (const [id, color, glyph] of [['point-0', '#ff0000', '●'], ['point-1', '#0000ff', '●'], ['point-2', '#00ff00', '○']] as const) {
      for (const owner of [id, `${id}:legend`]) {
        const marker = [...document.entries()].find(([, , cell]) => cell.kind === 'marker' && cell.owners.some(value => value.id === owner))![2]
        expect(marker.color).toBe(color)
        expect(marker.glyph).toBe(glyph)
      }
      expect(authored(document, id).length).toBeGreaterThan(0)
      // Point fill is marker paint. As in SVG, it is not a text-color override.
      expect([...document.entries()].filter(([, , cell]) => cell.kind === 'text' && cell.owners.some(owner => owner.id === id)).every(([, , cell]) => cell.color === undefined)).toBe(true)
    }
    expect(document.diagnostics.some(diagnostic => diagnostic.feature === 'quadrant.point-0.radius' && diagnostic.message.includes('12px'))).toBe(true)
    expect(document.diagnostics.some(diagnostic => diagnostic.feature.startsWith('quadrant.point-3.'))).toBe(false)
    expect(document.serialize({ colorMode: 'html' })).toContain('color:#0000ff')
  })

  test('Pie reports actual geometric losses after config resolution while preserving authored text paints', () => {
    const source = ['pie showData', 'title Shares', '"One" : 1']
    const ordinary = capture(config => renderPieAscii(source, config, 'none', DEFAULT_ASCII_THEME))
    expect(ordinary.diagnostics).toEqual([])
    const invalid = capture(config => renderPieAscii(source, config, 'none', DEFAULT_ASCII_THEME, { pie: { donutHole: 2, legendPosition: 'diagonal' } }))
    expect(invalid.diagnostics).toEqual([])
    const document = capture(config => renderPieAscii(source, config, 'none', DEFAULT_ASCII_THEME, {
      pie: { donutHole: 0.4, legendPosition: 'bottom', textPosition: 0.2 },
      themeVariables: { pieOuterStrokeWidth: '3px', pieStrokeColor: '#123456', pieOpacity: 0.5, pieTitleTextColor: '#aabbcc', pieLegendTextColor: '#112233', pieSectionTextColor: '#445566' },
    }))
    expect(document.diagnostics.map(diagnostic => diagnostic.feature).sort()).toEqual([
      'pie.donutHole', 'pie.legendPosition', 'pie.textPosition', 'themeVariables.pieOpacity', 'themeVariables.pieOuterStrokeWidth', 'themeVariables.pieStrokeColor',
    ])
    for (const [id, glyph, color] of [['title', 'S', '#aabbcc'], ['slice-0', 'O', '#112233'], ['slice-0:value', '%', '#445566']] as const) {
      expect([...document.entries()].some(([, , cell]) => cell.glyph === glyph && cell.color === color && cell.owners.some(owner => owner.id === id))).toBe(true)
    }
    expect(authored(document, 'slice-0:value').map(cell => cell.glyph).join('')).toContain('100.0%  [1]')
  })

  test('Radar and Gantt scope projection diagnostics to represented geometry and valid configured values', () => {
    const radar = capture(config => renderRadarAscii(['radar-beta', 'axis a', 'curve c{1}', 'graticule polygon'], config, 'none', DEFAULT_ASCII_THEME, {
      radar: { width: 500, curveTension: 0.8, tickLabels: true },
      themeVariables: { radar: { axisColor: '#abcdef', graticuleColor: '#123456', graticuleStrokeWidth: 4 } },
    }))
    expect(radar.diagnostics.map(diagnostic => diagnostic.feature).sort()).toEqual(['radar.graticule', 'radar.tickLabels', 'radar.width', 'themeVariables.radar.graticuleStrokeWidth'])
    expect([...radar.entries()].some(([, , cell]) => cell.glyph === '┬' && cell.color === '#123456')).toBe(true)
    expect([...radar.entries()].some(([, , cell]) => cell.glyph === '│' && cell.color === '#abcdef')).toBe(true)

    const source = ['gantt', 'dateFormat YYYY-MM-DD', 'todayMarker stroke:#00ff00,stroke-width:3px', 'Work :a, 2024-01-01, 5d']
    const withoutClock = capture(config => renderGanttAscii(source, config, 'none', DEFAULT_ASCII_THEME))
    expect(withoutClock.diagnostics).toEqual([])
    const gantt = capture(config => renderGanttAscii(source, config, 'none', DEFAULT_ASCII_THEME, { gantt: { barHeight: 36 } }, { today: '2024-01-02' }))
    expect(gantt.diagnostics.map(diagnostic => diagnostic.feature).sort()).toEqual(['gantt.barHeight', 'gantt.todayMarker.stroke-width'])
    expect([...gantt.entries()].some(([, , cell]) => cell.kind === 'marker' && cell.glyph === '╎' && cell.color === '#00ff00' && cell.owners.some(owner => owner.id === 'today-marker'))).toBe(true)
    const off = capture(config => renderGanttAscii([...source.slice(0, 2), 'todayMarker off', source[3]!], config, 'none', DEFAULT_ASCII_THEME, {}, { today: '2024-01-02' }))
    expect(off.diagnostics).toEqual([])
  })

  test('native literal frontmatter titles wrap owned display cells and yield to inline titles', () => {
    const title = '<b>日本語 title that stays literal across a narrow terminal and wraps once</b>'
    const fixtures = [
      { header: 'timeline', body: '2026 : Event', inline: '<i>Inline title</i>' },
      { header: 'gantt', body: 'dateFormat YYYY-MM-DD\nTask :a, 2024-01-01, 1d', inline: '<i>Inline title</i>' },
      { header: 'pie', body: '"Slice" : 1', inline: '<i>Inline title</i>' },
      { header: 'xychart-beta', body: 'x-axis [A,B]\nbar [1,2]', inline: '"<i>Inline title</i>"' },
    ]
    for (const fixture of fixtures) {
      const frontmatter = `---\ntitle: ${JSON.stringify(title)}\n---\n`
      const result = renderMermaidASCIIWithReceipt(`${frontmatter}${fixture.header}\n${fixture.body}`, { targetWidth: 50, colorMode: 'none' })
      const document = terminalDocumentOf(result)!
      const region = document.regions().find(region => region.id === 'title')!
      expect(region.rowSpan).toBeGreaterThan(1)
      expect(region.projectedText?.replace(/\s+/g, ' ')).toBe(title)
      expect(Math.max(...result.text.split('\n').map(visualWidth))).toBeLessThanOrEqual(50)
      const inline = renderMermaidASCIIWithReceipt(`${frontmatter}${fixture.header}\ntitle ${fixture.inline}\n${fixture.body}`, { targetWidth: 50, colorMode: 'none' })
      expect(terminalDocumentOf(inline)!.regions().filter(region => region.id === 'title').map(region => region.projectedText)).toEqual(['<i>Inline title</i>'])
    }
    const empty = renderMermaidASCIIWithReceipt('---\ntitle: "<b>Empty literal title</b>"\n---\nxychart-beta', { targetWidth: 30, colorMode: 'none' })
    expect(terminalDocumentOf(empty)!.regions().find(region => region.id === 'title')?.projectedText).toBe('<b>Empty literal title</b>')
  })

  test('native and common title policies prepare display text exactly once before ownership and width', () => {
    const source = (title: string, body: string) => `---\ntitle: ${JSON.stringify(title)}\n---\n${body}`
    for (const body of ['graph TD\nA --> B', 'sankey-beta\nA,B,1']) {
      const result = renderMermaidASCIIWithReceipt(source('<b>日本</b> <i>small title</i>', body), { targetWidth: 45, colorMode: 'none' })
      const region = terminalDocumentOf(result)!.regions().find(region => region.id === 'title')!
      expect(region.projectedText).toBe('日本 small title')
      expect(region.rowSpan ?? 1).toBe(1)
      expect(region.canvasColEnd - region.canvasColStart).toBe(16)
      expect(Math.max(...result.text.split('\n').map(visualWidth))).toBeLessThanOrEqual(45)
    }
    const radar = renderMermaidASCIIWithReceipt(source('<b>Literal radar</b>', 'radar-beta\naxis a\ncurve c{1}'), { colorMode: 'none' })
    expect(terminalDocumentOf(radar)!.regions().find(region => region.id === 'title')?.projectedText).toBe('<b>Literal radar</b>')
    const pieBody = renderMermaidASCIIWithReceipt(source('Fallback #65;', 'pie\ntitle Body #65;\n"Slice" : 1'), { colorMode: 'none' })
    expect(terminalDocumentOf(pieBody)!.regions().find(region => region.id === 'title')?.projectedText).toBe('Body A')
    const pieFallback = renderMermaidASCIIWithReceipt(source('Fallback #65;', 'pie\n"Slice" : 1'), { colorMode: 'none' })
    expect(terminalDocumentOf(pieFallback)!.regions().find(region => region.id === 'title')?.projectedText).toBe('Fallback #65;')
  })

  test('XY title visibility is respected by the public bridge independently for chart and both axes', () => {
    for (const orientation of ['', ' horizontal']) {
      for (const [showChartTitle, showAxisTitles] of [[true, true], [false, true], [true, false], [false, false]] as const) {
        const source = [
          '---', 'title: "Frontmatter title"', 'config:', '  xyChart:',
          `    showTitle: ${showChartTitle}`, '    xAxis:', `      showTitle: ${showAxisTitles}`,
          '    yAxis:', `      showTitle: ${showAxisTitles}`, '---',
          `xychart-beta${orientation}`, 'title "Inline title"',
          'x-axis "Category heading" [A,B]', 'y-axis "Value heading" 0 --> 4', 'bar [1,2]',
        ].join('\n')
        const result = renderMermaidASCIIWithReceipt(source, { colorMode: 'none' })
        const regions = terminalDocumentOf(result)!.regions()
        for (const [id, title, visible] of [['title', 'Inline title', showChartTitle], ['x-axis', 'Category heading', showAxisTitles], ['y-axis', 'Value heading', showAxisTitles]] as const) {
          const region = regions.find(region => region.kind === 'label' && region.id === id)
          expect(region?.projectedText).toBe(visible ? title : undefined)
          expect(result.text.includes(title)).toBe(visible)
        }
        expect(result.text).not.toContain('Frontmatter title')
        expect(regions.some(region => region.id === 'series-0')).toBe(true)
      }
      // The fallback bridge must not resurrect a title when no native title
      // cell exists, whether the chart has a series or is intentionally empty.
      for (const body of ['', '\nx-axis [A,B]\nbar [1,2]']) {
        const source = `---\ntitle: "<b>Hidden frontmatter</b>"\nconfig:\n  xyChart:\n    showTitle: false\n---\nxychart-beta${orientation}${body}`
        const result = renderMermaidASCIIWithReceipt(source, { colorMode: 'none' })
        expect(result.text).not.toContain('Hidden frontmatter')
        expect(terminalDocumentOf(result)!.regions().some(region => region.id === 'title' && region.kind === 'label')).toBe(false)
      }
    }
  })
})
