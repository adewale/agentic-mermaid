import { describe, expect, test } from 'bun:test'
import mermaid from 'mermaid'
import { asTimeline, mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { describeMermaid } from '../agent/describe.ts'
import { renderMermaidSVG } from '../index.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'

const source = (comment: string) => `timeline
  2020 : Launch
  ${comment}
  2021 : Scale`

function nativePeriods(input: string) {
  return parseTimelineDiagram(normalizeMermaidSource(input).lines)
    .sections.flatMap(section => section.periods)
    .map(period => ({ label: period.label, events: period.events.map(event => event.text) }))
}

describe('Timeline full-line comments match pinned Mermaid 11.16.0', () => {
  test('both native and agent projections ignore %, %% and # lines without changing neighboring periods', async () => {
    mermaid.initialize({ startOnLoad: false })
    for (const comment of ['% authored note', '%% authored note', '# legacy note']) {
      const input = source(comment)
      const expected = [
        { label: '2020', events: ['Launch'] },
        { label: '2021', events: ['Scale'] },
      ]
      const upstream = await mermaid.mermaidAPI.getDiagramFromText(input)
      const db = upstream.db as unknown as { getTasks(): Array<{ task: string; events: string[] }> }
      expect(db.getTasks().map(task => ({ label: task.task.trim(), events: task.events }))).toEqual(expected)
      expect(nativePeriods(input)).toEqual(expected)
      expect(parseTimelineDiagram(input.split('\n').map(line => line.trim()))
        .sections.flatMap(section => section.periods).map(period => period.label)).toEqual(['2020', '2021'])

      const parsed = parseRegisteredMermaid(input)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const body = asTimeline(parsed.value)?.body
      expect(body?.sections.flatMap(section => section.periods).map(period => ({
        label: period.label, events: period.events.map(event => event.text),
      }))).toEqual(expected)

      const canonical = serializeMermaid(parsed.value)
      expect(nativePeriods(canonical)).toEqual(expected)
      const changed = mutate(parsed.value, {
        kind: 'set_event_text', sectionIndex: 0, periodIndex: 1, eventIndex: 0, text: 'Scaled',
      })
      expect(changed.ok).toBe(true)
      if (changed.ok) expect(nativePeriods(serializeMermaid(changed.value))).toEqual([
        expected[0]!, { label: '2021', events: ['Scaled'] },
      ])

      const svg = renderMermaidSVG(input)
      expect(svg).toContain('Launch')
      expect(svg).toContain('Scale')
      expect(svg).not.toContain('authored note')
      expect(svg).not.toContain('legacy note')
    }
  })

  test('comment markers inside an event remain literal text', async () => {
    const input = 'timeline\n  2020 : Launch % staged %% staged #internal'
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(input)
    const db = upstream.db as unknown as { getTasks(): Array<{ events: string[] }> }
    expect(db.getTasks()[0]?.events).toEqual(['Launch % staged %% staged #internal'])
    expect(nativePeriods(input)[0]?.events).toEqual(['Launch % staged %% staged #internal'])
    const parsed = parseRegisteredMermaid(input)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(asTimeline(parsed.value)?.body.sections[0]?.periods[0]?.events[0]?.text).toBe('Launch % staged %% staged #internal')
  })

  test('%{ at the start of a period is not a comment', async () => {
    const input = 'timeline\n  %{not-directive}\n  2020 : Launch'
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(input)
    const db = upstream.db as unknown as { getTasks(): Array<{ task: string }> }
    expect(db.getTasks().map(task => task.task.trim())).toEqual(['%{not-directive}', '2020'])
    expect(nativePeriods(input).map(period => period.label)).toEqual(['%{not-directive}', '2020'])
    const parsed = parseRegisteredMermaid(input)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(asTimeline(parsed.value)?.body.sections.flatMap(section => section.periods).map(period => period.label))
      .toEqual(['%{not-directive}', '2020'])
  })

  test('opaque Timeline summaries do not promote a comment with a colon into a label', () => {
    const parsed = parseRegisteredMermaid('timeline EXTRA\n  # ghost marker : should not describe\n  2020 : Launch')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('opaque')
    expect(describeMermaid(parsed.value)).toContain('Launch')
    expect(describeMermaid(parsed.value)).not.toContain('ghost marker')
    expect(describeMermaid(parsed.value)).not.toContain('should not describe')
  })
})
