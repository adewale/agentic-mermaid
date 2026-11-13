/**
 * Direct layout invariants for journey diagrams.
 */
import { describe, it, expect } from 'bun:test'
import { preprocessMermaidLines } from '../mermaid-source.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'
import { preparedDisplayTextValue } from '../shared/display-text.ts'
import { lowerJourneyScene } from '../journey/renderer.ts'
import { visitSceneNodes } from '../scene/walk.ts'
import type { SceneNode } from '../scene/ir.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'

function layout(text: string) {
  const parsed = parseJourneyDiagram(preprocessMermaidLines(text))
  return layoutJourneyDiagram(parsed, resolveJourneyRequestAppearance())
}

describe('layoutJourneyDiagram', () => {
  it('keeps literal encoded markup and formatted actor identities connected to their own legend entries', () => {
    const source = 'journey\nFirst: 3: &lt;b&gt;Alice&lt;/b&gt;\nSecond: 4: <b>Alice</b>\nThird: 5: &lt;b&gt;Alice&lt;/b&gt;, <b>Alice</b>\nFourth: 3: &lt;b&gt;Alice&lt;/b&gt;, &lt;b&gt;Alice&lt;/b&gt;'
    const parsed = parseJourneyDiagram(source.split('\n'))
    const appearance = resolveJourneyRequestAppearance()
    const diagram = layoutJourneyDiagram(parsed, appearance)
    expect(diagram.actors.map(actor => preparedDisplayTextValue(actor.block!.prepared))).toEqual(['<b>Alice</b>', 'Alice'])
    expect(diagram.sections[0]!.tasks.map(task => task.actorDots.map(dot => dot.colorIndex))).toEqual([[0], [1], [0, 1], [0, 0]])
    const scene = lowerJourneyScene({ positioned: diagram, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {}, familyAppearance: { ...appearance } } })
    const actors: SceneNode[] = []
    const identities: string[] = []
    visitSceneNodes(scene.parts, node => {
      identities.push(node.id)
      if (node.role === 'actor') actors.push(node)
    })
    expect(actors).toHaveLength(8)
    expect(new Set(actors.map(actor => actor.channels?.category))).toEqual(new Set(['<b>Alice</b>']))
    expect(new Set(identities).size).toBe(identities.length)
    expect(validateSceneDoc(scene, { mode: 'internal' }).diagnostics.filter(diagnostic => diagnostic.code === 'SCENE_ID')).toEqual([])
  })

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
