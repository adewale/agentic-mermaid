import { describe, expect, it } from 'bun:test'
import { decodeXML } from 'entities'
import { renderMermaidSVG } from '../index.ts'
import { resolveStyleStackWithFace } from '../scene/style-registry.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutTimelineDiagram } from '../timeline/layout.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutXYChart } from '../xychart/layout.ts'
import { parseXYChart } from '../xychart/parser.ts'

function labels(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map(match => decodeXML(match[0].replace(/<[^>]*>/g, '')))
}

const capitalize = { roles: { node: { textTransform: 'capitalize' as const }, edge: { textTransform: 'capitalize' as const }, group: { textTransform: 'capitalize' as const } } }

describe('prepared sequence and chart labels', () => {
  it('capitalizes visible words across formatting boundaries in every sequence label role', () => {
    const source = `sequenceDiagram
box blue foo<b>bar</b>baz
participant A as foo<b>bar</b>baz
end
participant B
loop foo<b>bar</b>baz
A->>B: foo<b>bar</b>baz
Note over A: foo<b>bar</b>baz
end`
    const text = labels(renderMermaidSVG(source, { style: capitalize }))
    expect(text.filter(label => label.includes('Foobarbaz')).length).toBe(5)
    expect(text.join(' ')).not.toContain('Bar')
  })

  it.each(['', 'title Main diagram\n'])('reserves the complete multiline participant-group title above its headers with %s', title => {
    const source = `sequenceDiagram
${title}
box blue first<br/>second<br/>third
participant A
end
A->>A: work`
    const positioned = layoutSequenceDiagram(parseSequenceDiagram(source.split('\n')))
    const box = positioned.boxes[0]!
    const actor = positioned.actors[0]!
    // Three 12px lines occupy 43.2px; they must end before the actor box.
    expect((box.labelY ?? box.y + 13) + 43.2 / 2).toBeLessThan(actor.y)
    expect((box.labelY ?? box.y + 13) - 43.2 / 2).toBeGreaterThanOrEqual(box.y)
  })

  it('capitalizes formatted Journey sections, tasks and actor labels once', () => {
    const source = `journey
title foo<b>bar</b>baz
section foo<b>bar</b>baz
foo<b>bar</b>baz: 4: foo<b>bar</b>baz`
    const text = labels(renderMermaidSVG(source, { style: capitalize }))
    expect(text.filter(label => label === 'Foobarbaz')).toHaveLength(4)
    expect(text.join(' ')).not.toContain('Bar')
  })

  it('uses tracking and complete multiline header height for literal Timeline text', () => {
    const source = `timeline
section first authored title line<br>second authored title line
2024 : <b>literal</b> 👩‍💻 é`
    const face = resolveStyleStackWithFace({ roles: { group: { fontSize: 30, letterSpacing: 2 }, node: { letterSpacing: 3 } } }).face
    const positioned = layoutTimelineDiagram(parseTimelineDiagram(normalizeMermaidSource(source).lines), {}, face)
    const section = positioned.sections[0]!
    expect(section.headerHeight).toBeGreaterThanOrEqual(72)
    const event = section.periods[0]!.events[0]!
    expect(event.block!.prepared.source).toBe('<b>literal</b> 👩‍💻 é')
    expect(event.block!.lines.join('')).toContain('<b>literal</b>')
    expect(event.block!.width).toBeLessThan(event.width)
    expect(event.block!.height).toBeLessThan(event.height)
  })

  it('retains exact capitalization through soft wraps in Journey group labels', () => {
    const word = 'antidisestablishmentarianism'.repeat(3)
    const source = `journey\nsection ${word}\nwork: 4: person`
    const face = resolveStyleStackWithFace(capitalize).face
    const positioned = layoutJourneyDiagram(parseJourneyDiagram(normalizeMermaidSource(source).lines), resolveJourneyRequestAppearance(), {}, face)
    const expected = word[0]!.toUpperCase() + word.slice(1)
    const group = labels(renderMermaidSVG(source, { style: capitalize })).find(label => label.replace(/-/g, '').startsWith('Antidis'))!
    expect(group.replace(/-/g, '')).toBe(expected)
    expect(positioned.sections[0]!.headerHeight).toBeGreaterThanOrEqual(positioned.sections[0]!.block!.height)
  })

  it('fits XY value labels using absolute tracking rather than scaling it with font size', () => {
    const chart = parseXYChart(['xychart', 'x-axis [A, B, C, D, E, F]', 'y-axis 0 --> 12000', 'bar [10000, 10000, 10000, 10000, 10000, 10000]'])
    chart.config.showDataLabel = true
    const face = resolveStyleStackWithFace({ roles: { node: { letterSpacing: 3 } } }).face
    const positioned = layoutXYChart(chart, {}, face)
    expect(positioned.dataLabels).toHaveLength(6)
    for (const label of positioned.dataLabels) {
      expect(label.block!.width).toBeLessThanOrEqual(label.bar.width - 8)
      expect(label.fontSize).toBeGreaterThanOrEqual(8)
    }
  })

  it('measures XY tick and legend tag characters literally instead of squeezing their visible spelling', () => {
    const source = `xychart\nx-axis ["<b>wide category</b>"]\ny-axis 0 --> 20\nbar "<b>series</b>" [10]\nline other [12]`
    const chart = parseXYChart(normalizeMermaidSource(source).lines)
    const positioned = layoutXYChart(chart)
    const tick = positioned.xAxis.ticks.find(tick => tick.label.includes('wide'))!
    const literalSvg = renderMermaidSVG(source)
    const plainSvg = renderMermaidSVG(source.replaceAll('<b>', '').replaceAll('</b>', ''))
    const tickAdvance = (svg: string) => Number(svg.match(/<text[^>]*xychart-x-label[^>]*>/)![0].match(/textLength="([^"]+)"/)![1])
    expect(tickAdvance(literalSvg)).toBeGreaterThan(tickAdvance(plainSvg) * 1.25)
    expect(tick.block!.prepared.display).toBe('literal')
    expect(tick.block!.prepared.source).toBe('<b>wide category</b>')
    const text = labels(renderMermaidSVG(source))
    expect(text).toContain('<b>wide category</b>')
    expect(text).toContain('<b>series</b>')
    expect(positioned.legend.find(item => item.label === '<b>series</b>')!.block!.prepared.display).toBe('literal')
    const plain = layoutXYChart(parseXYChart(normalizeMermaidSource(source.replaceAll('<b>', '').replaceAll('</b>', '')).lines))
    expect(tick.block!.width).toBeGreaterThan(plain.xAxis.ticks.find(tick => tick.label.includes('wide'))!.block!.width)
  })
})
