/**
 * Direct layout invariants for journey diagrams.
 */
import { describe, it, expect } from 'bun:test'
import { preprocessMermaidLines } from '../mermaid-source.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'

function layout(text: string) {
  const parsed = parseJourneyDiagram(preprocessMermaidLines(text))
  return layoutJourneyDiagram(parsed, resolveJourneyRequestAppearance())
}

describe('layoutJourneyDiagram', () => {
  it('places named sections side by side without overlap', () => {
    const diagram = layout(`journey
      title My working day
      section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      section Go home
      Go downstairs: 5: Me`)

    expect(diagram.sections).toHaveLength(2)
    const first = diagram.sections[0]!
    const second = diagram.sections[1]!

    expect(first.framed).toBe(true)
    expect(second.framed).toBe(true)
    expect(first.headerHeight).toBeGreaterThan(0)
    expect(first.x + first.width).toBeLessThan(second.x)
    expect(first.y).toBe(second.y)
  })

  it('keeps score markers, tracks, and actor dots aligned to each task column', () => {
    const diagram = layout(`journey
      section Work
      Prototype<br>review: 3: Design, Eng
      Ship: 5: Eng, QA`)

    const task = diagram.sections[0]!.tasks[0]!

    expect(task.track.x).toBe(task.centerX)
    expect(task.track.y1).toBeGreaterThanOrEqual(task.y + task.height)
    expect(task.track.y2).toBe(diagram.scoreGuide.baseline.y1)
    expect(task.marker.cx).toBe(task.centerX)
    expect(task.marker.cy).toBe(diagram.scoreGuide.ticks.find(tick => tick.score === 3)!.y)

    for (const dot of task.actorDots) {
      expect(dot.x - dot.r).toBeGreaterThanOrEqual(task.x)
      expect(dot.y - dot.r).toBeGreaterThanOrEqual(task.y)
      expect(dot.x + dot.r).toBeLessThanOrEqual(task.x + task.width)
      expect(dot.y + dot.r).toBeLessThanOrEqual(task.y + task.height)
    }
  })

  it('leaves a single implicit section unframed while ordering tasks left-to-right', () => {
    const diagram = layout(`journey
      Wake up: 3: Me
      Make coffee: 5: Me`)

    expect(diagram.sections).toHaveLength(1)
    const section = diagram.sections[0]!

    expect(section.framed).toBe(false)
    expect(section.headerHeight).toBe(0)
    expect(section.tasks[0]!.y).toBe(section.tasks[1]!.y)
    expect(section.tasks[0]!.x + section.tasks[0]!.width).toBeLessThan(section.tasks[1]!.x)
  })
})
