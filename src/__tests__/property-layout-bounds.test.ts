import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { toMermaidLines } from '../mermaid-source.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'
import { layoutTimelineDiagram } from '../timeline/layout.ts'
import { parseJourneyDiagram } from '../journey/parser.ts'
import { layoutJourneyDiagram, resolveJourneyRequestAppearance } from '../journey/layout.ts'

const PROPERTY_RUNS = 50

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const WORD_CHARS = [...'abcdefghijklmnopqrstuvwxyz']

const wordArb = fc
  .array(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 8 })
  .map(chars => chars.join(''))

/** Assert that a number is finite */
function expectFinite(value: number, label: string): void {
  expect(Number.isFinite(value)).toBe(true)
}

/** Assert that a rectangle has finite, non-negative dimensions */
function expectFiniteRect(rect: { x: number; y: number; width: number; height: number }, label: string): void {
  expectFinite(rect.x, `${label}.x`)
  expectFinite(rect.y, `${label}.y`)
  expectFinite(rect.width, `${label}.width`)
  expectFinite(rect.height, `${label}.height`)
  expect(rect.width >= 0).toBe(true)
  expect(rect.height >= 0).toBe(true)
}

/** Assert that a rectangle is within canvas bounds (with small epsilon tolerance) */
function expectWithinCanvas(
  rect: { x: number; y: number; width: number; height: number },
  canvas: { width: number; height: number },
  label: string,
): void {
  expectFiniteRect(rect, label)
  expect(rect.x >= -0.5).toBe(true)
  expect(rect.y >= -0.5).toBe(true)
  expect(rect.x + rect.width <= canvas.width + 0.5).toBe(true)
  expect(rect.y + rect.height <= canvas.height + 0.5).toBe(true)
}

// ---------------------------------------------------------------------------
// Architecture diagram arbitraries
// ---------------------------------------------------------------------------

const archSideArb = fc.constantFrom<'L' | 'R' | 'T' | 'B'>('L', 'R', 'T', 'B')

/** Generate a minimal architecture diagram with 2-4 services and edges between them. */
const archDiagramArb = fc
  .integer({ min: 2, max: 4 })
  .chain(numServices =>
    fc.record({
      serviceNames: fc.array(wordArb, { minLength: numServices, maxLength: numServices }),
      edges: fc.array(
        fc.record({
          fromIdx: fc.integer({ min: 0, max: numServices - 1 }),
          toIdx: fc.integer({ min: 0, max: numServices - 1 }),
          fromSide: archSideArb,
          toSide: archSideArb,
        }),
        { minLength: 1, maxLength: numServices },
      ),
    })
  )
  .map(({ serviceNames, edges }) => {
    // Ensure unique service names
    const uniqueNames = [...new Set(serviceNames)]
    if (uniqueNames.length < 2) {
      uniqueNames.push(uniqueNames[0] + 'b')
    }
    return { serviceNames: uniqueNames, edges }
  })
  .filter(({ serviceNames, edges }) =>
    // Ensure at least one edge has different source/target
    edges.some(e => {
      const from = Math.min(e.fromIdx, serviceNames.length - 1)
      const to = Math.min(e.toIdx, serviceNames.length - 1)
      return from !== to
    })
  )

/** Generate an architecture diagram with a group containing services. */
const archWithGroupArb = fc
  .record({
    groupName: wordArb,
    serviceNames: fc.array(wordArb, { minLength: 2, maxLength: 3 }),
    outerServiceName: wordArb,
    edgeSides: fc.record({
      fromSide: archSideArb,
      toSide: archSideArb,
    }),
  })
  .map(({ groupName, serviceNames, outerServiceName, edgeSides }) => {
    // Ensure all names are unique
    const names = new Set<string>()
    const ensureUnique = (name: string): string => {
      let result = name
      let suffix = 0
      while (names.has(result)) {
        result = name + String.fromCharCode(97 + suffix)
        suffix++
      }
      names.add(result)
      return result
    }
    const group = ensureUnique(groupName)
    const services = serviceNames.map(s => ensureUnique(s))
    const outer = ensureUnique(outerServiceName)
    return { group, services, outer, edgeSides }
  })

// ---------------------------------------------------------------------------
// Sequence diagram arbitraries
// ---------------------------------------------------------------------------

const seqActorIdArb = wordArb.map(w => w.slice(0, 6))

const seqDiagramArb = fc
  .integer({ min: 2, max: 4 })
  .chain(numActors =>
    fc.record({
      actorIds: fc.array(seqActorIdArb, { minLength: numActors, maxLength: numActors }),
      numMessages: fc.integer({ min: 1, max: 5 }),
    })
  )
  .chain(({ actorIds, numMessages }) => {
    // Ensure unique actor IDs
    const uniqueIds = [...new Set(actorIds)]
    while (uniqueIds.length < 2) uniqueIds.push(uniqueIds[0] + 'x')
    const ids = uniqueIds

    return fc.record({
      actorIds: fc.constant(ids),
      messages: fc.array(
        fc.record({
          fromIdx: fc.integer({ min: 0, max: ids.length - 1 }),
          toIdx: fc.integer({ min: 0, max: ids.length - 1 }),
          label: wordArb,
        }),
        { minLength: numMessages, maxLength: numMessages },
      ),
    })
  })

// ---------------------------------------------------------------------------
// Timeline diagram arbitraries
// ---------------------------------------------------------------------------

const timelineDiagramArb = fc
  .record({
    hasTitle: fc.boolean(),
    title: wordArb,
    sections: fc.array(
      fc.record({
        label: wordArb,
        periods: fc.array(
          fc.record({
            label: wordArb,
            events: fc.array(wordArb, { minLength: 1, maxLength: 3 }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  })

// ---------------------------------------------------------------------------
// Journey diagram arbitraries
// ---------------------------------------------------------------------------

const journeyDiagramArb = fc
  .record({
    hasTitle: fc.boolean(),
    title: wordArb,
    sections: fc.array(
      fc.record({
        label: wordArb,
        tasks: fc.array(
          fc.record({
            text: wordArb,
            score: fc.integer({ min: 1, max: 5 }),
            actors: fc.array(wordArb, { minLength: 0, maxLength: 2 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  })

// ============================================================================
// Architecture layout bounds
// ============================================================================

describe('property-based architecture layout bounds', () => {
  it('all services and junctions have finite, non-negative coordinates', () => {
    fc.assert(
      fc.property(archDiagramArb, ({ serviceNames, edges }) => {
        const serviceLines = serviceNames.map(name => `service ${name}[${name}]`)
        const edgeLines = edges
          .map(e => {
            const from = serviceNames[Math.min(e.fromIdx, serviceNames.length - 1)]!
            const to = serviceNames[Math.min(e.toIdx, serviceNames.length - 1)]!
            if (from === to) return null
            return `${from}:${e.fromSide} --> ${e.toSide}:${to}`
          })
          .filter(Boolean)

        if (edgeLines.length === 0) return // skip degenerate case

        const lines = toMermaidLines(
          ['architecture-beta', ...serviceLines, ...edgeLines].join('\n'),
        )

        const diagram = parseArchitectureDiagram(lines)
        const positioned = layoutArchitectureDiagram(diagram)

        expect(positioned.width > 0).toBe(true)
        expect(positioned.height > 0).toBe(true)

        for (const service of positioned.services) {
          expectFiniteRect(service, `service(${service.id})`)
          expect(service.x >= 0).toBe(true)
          expect(service.y >= 0).toBe(true)
        }

        for (const junction of positioned.junctions) {
          expectFiniteRect(junction, `junction(${junction.id})`)
          expect(junction.x >= 0).toBe(true)
          expect(junction.y >= 0).toBe(true)
        }

        for (const edge of positioned.edges) {
          for (const point of edge.points) {
            expectFinite(point.x, 'edge.point.x')
            expectFinite(point.y, 'edge.point.y')
          }
          if (edge.labelPosition) {
            expectFinite(edge.labelPosition.x, 'edge.labelPosition.x')
            expectFinite(edge.labelPosition.y, 'edge.labelPosition.y')
          }
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('services inside groups are within group bounds', () => {
    fc.assert(
      fc.property(archWithGroupArb, ({ group, services, outer, edgeSides }) => {
        const lines = toMermaidLines(
          [
            'architecture-beta',
            `group ${group}[${group}]`,
            ...services.map(s => `service ${s}[${s}] in ${group}`),
            `service ${outer}[${outer}]`,
            `${services[0]}:${edgeSides.fromSide} --> ${edgeSides.toSide}:${outer}`,
          ].join('\n'),
        )

        const diagram = parseArchitectureDiagram(lines)
        const positioned = layoutArchitectureDiagram(diagram)

        expect(positioned.groups.length).toBeGreaterThanOrEqual(1)

        const positionedGroup = positioned.groups.find(g => g.id === group)
        expect(positionedGroup).toBeDefined()

        for (const service of positioned.services) {
          if (service.parentId === group) {
            expectFiniteRect(service, `service(${service.id})`)
            // Service should be within the group bounds (with small tolerance)
            expect(service.x >= positionedGroup!.x - 0.5).toBe(true)
            expect(service.y >= positionedGroup!.y - 0.5).toBe(true)
            expect(service.x + service.width <= positionedGroup!.x + positionedGroup!.width + 0.5).toBe(true)
            expect(service.y + service.height <= positionedGroup!.y + positionedGroup!.height + 0.5).toBe(true)
          }
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('edge points are finite for diagrams with groups and boundary edges', () => {
    fc.assert(
      fc.property(archWithGroupArb, ({ group, services, outer, edgeSides }) => {
        const lines = toMermaidLines(
          [
            'architecture-beta',
            `group ${group}[${group}]`,
            ...services.map(s => `service ${s}[${s}] in ${group}`),
            `service ${outer}[${outer}]`,
            `${services[0]}{group}:${edgeSides.fromSide} --> ${edgeSides.toSide}:${outer}`,
          ].join('\n'),
        )

        const diagram = parseArchitectureDiagram(lines)
        const positioned = layoutArchitectureDiagram(diagram)

        for (const edge of positioned.edges) {
          expect(edge.points.length).toBeGreaterThanOrEqual(2)
          for (const point of edge.points) {
            expectFinite(point.x, 'edge.point.x')
            expectFinite(point.y, 'edge.point.y')
          }
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// Sequence layout bounds
// ============================================================================

describe('property-based sequence layout bounds', () => {
  it('all actors, messages, and lifelines have finite coordinates', () => {
    fc.assert(
      fc.property(seqDiagramArb, ({ actorIds, messages }) => {
        const actorLines = actorIds.map(id => `participant ${id}`)
        const messageLines = messages.map(m => {
          const from = actorIds[m.fromIdx]!
          let to = actorIds[m.toIdx]!
          // Allow self-messages but ensure we have at least some non-self messages
          if (from === to && actorIds.length > 1) {
            to = actorIds[(m.toIdx + 1) % actorIds.length]!
          }
          return `${from}->>${to}: ${m.label}`
        })

        const lines = toMermaidLines(
          ['sequenceDiagram', ...actorLines, ...messageLines].join('\n'),
        )

        const diagram = parseSequenceDiagram(lines)
        const positioned = layoutSequenceDiagram(diagram)

        expect(positioned.width > 0).toBe(true)
        expect(positioned.height > 0).toBe(true)

        for (const actor of positioned.actors) {
          expectFiniteRect(
            { x: actor.x - actor.width / 2, y: actor.y, width: actor.width, height: actor.height },
            `actor(${actor.id})`,
          )
          expectFinite(actor.x, `actor(${actor.id}).x`)
          expectFinite(actor.y, `actor(${actor.id}).y`)
        }

        for (const msg of positioned.messages) {
          expectFinite(msg.x1, `message.x1`)
          expectFinite(msg.x2, `message.x2`)
          expectFinite(msg.y, `message.y`)
        }

        for (const lifeline of positioned.lifelines) {
          expectFinite(lifeline.x, `lifeline.x`)
          expectFinite(lifeline.topY, `lifeline.topY`)
          expectFinite(lifeline.bottomY, `lifeline.bottomY`)
          expect(lifeline.bottomY >= lifeline.topY).toBe(true)
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('blocks and notes have finite coordinates', () => {
    fc.assert(
      fc.property(seqDiagramArb, ({ actorIds, messages }) => {
        const actorLines = actorIds.map(id => `participant ${id}`)

        // Build message lines and wrap in a loop block
        const messageLines = messages.map(m => {
          const from = actorIds[m.fromIdx]!
          let to = actorIds[m.toIdx]!
          if (from === to && actorIds.length > 1) {
            to = actorIds[(m.toIdx + 1) % actorIds.length]!
          }
          return `${from}->>${to}: ${m.label}`
        })

        const lines = toMermaidLines(
          [
            'sequenceDiagram',
            ...actorLines,
            'loop repeat',
            ...messageLines,
            'end',
            `Note over ${actorIds[0]}: memo`,
          ].join('\n'),
        )

        const diagram = parseSequenceDiagram(lines)
        const positioned = layoutSequenceDiagram(diagram)

        for (const block of positioned.blocks) {
          expectFiniteRect(block, `block(${block.type})`)
          expect(block.width > 0).toBe(true)
          expect(block.height > 0).toBe(true)
          for (const divider of block.dividers) {
            expectFinite(divider.y, 'divider.y')
          }
        }

        for (const note of positioned.notes) {
          expectFiniteRect(note, `note`)
          expect(note.width > 0).toBe(true)
          expect(note.height > 0).toBe(true)
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('activation boxes have finite coordinates when present', () => {
    fc.assert(
      fc.property(seqDiagramArb, ({ actorIds }) => {
        // Generate a simple activate/deactivate pair
        const a = actorIds[0]!
        const b = actorIds.length > 1 ? actorIds[1]! : actorIds[0]! + 'y'

        const lines = toMermaidLines(
          [
            'sequenceDiagram',
            `participant ${a}`,
            `participant ${b}`,
            `${a}->>+${b}: request`,
            `${b}-->>-${a}: response`,
          ].join('\n'),
        )

        const diagram = parseSequenceDiagram(lines)
        const positioned = layoutSequenceDiagram(diagram)

        for (const activation of positioned.activations) {
          expectFinite(activation.x, 'activation.x')
          expectFinite(activation.topY, 'activation.topY')
          expectFinite(activation.bottomY, 'activation.bottomY')
          expectFinite(activation.width, 'activation.width')
          expect(activation.width > 0).toBe(true)
          expect(activation.bottomY >= activation.topY).toBe(true)
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// Timeline layout bounds
// ============================================================================

describe('property-based timeline layout bounds', () => {
  it('all sections, periods, and events stay within canvas bounds', () => {
    fc.assert(
      fc.property(timelineDiagramArb, ({ hasTitle, title, sections }) => {
        const sectionLines = sections.flatMap(section => {
          const header = `section ${section.label}`
          const periodLines = section.periods.flatMap(period => {
            const eventStr = period.events.map(e => `: ${e}`).join(' ')
            return [`${period.label} ${eventStr}`]
          })
          return [header, ...periodLines]
        })

        const titleLine = hasTitle ? [`title ${title}`] : []

        const lines = toMermaidLines(
          ['timeline', ...titleLine, ...sectionLines].join('\n'),
        )

        const diagram = parseTimelineDiagram(lines)
        const positioned = layoutTimelineDiagram(diagram)

        expect(positioned.width > 0).toBe(true)
        expect(positioned.height > 0).toBe(true)

        const canvas = { width: positioned.width, height: positioned.height }

        // Rail should be within canvas
        expectFinite(positioned.rail.x1, 'rail.x1')
        expectFinite(positioned.rail.x2, 'rail.x2')
        expectFinite(positioned.rail.y1, 'rail.y1')
        expectFinite(positioned.rail.y2, 'rail.y2')
        expect(positioned.rail.y1 >= 0).toBe(true)
        expect(positioned.rail.y1 <= canvas.height + 0.5).toBe(true)
        expect(positioned.rail.y2 >= 0).toBe(true)
        expect(positioned.rail.y2 <= canvas.height + 0.5).toBe(true)

        // Title should be within canvas
        if (positioned.title) {
          expectFinite(positioned.title.x, 'title.x')
          expectFinite(positioned.title.y, 'title.y')
          expect(positioned.title.x >= 0).toBe(true)
          expect(positioned.title.y >= 0).toBe(true)
        }

        for (const section of positioned.sections) {
          expectWithinCanvas(section, canvas, `section(${section.id})`)

          for (const period of section.periods) {
            // Period pill should be within canvas
            expectFiniteRect(
              { x: period.pillX, y: period.pillY, width: period.pillWidth, height: period.pillHeight },
              `period(${period.id}).pill`,
            )
            expect(period.pillX >= -0.5).toBe(true)
            expect(period.pillY >= -0.5).toBe(true)
            expect(period.pillX + period.pillWidth <= canvas.width + 0.5).toBe(true)
            expect(period.pillY + period.pillHeight <= canvas.height + 0.5).toBe(true)

            // Marker and stem
            expectFinite(period.centerX, `period(${period.id}).centerX`)
            expectFinite(period.markerX, `period(${period.id}).markerX`)
            expectFinite(period.markerY, `period(${period.id}).markerY`)
            expectFinite(period.stem.x1, `period(${period.id}).stem.x1`)
            expectFinite(period.stem.y1, `period(${period.id}).stem.y1`)
            expectFinite(period.stem.x2, `period(${period.id}).stem.x2`)
            expectFinite(period.stem.y2, `period(${period.id}).stem.y2`)

            for (const event of period.events) {
              expectWithinCanvas(event, canvas, `event(${event.id})`)
            }
          }
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('periods and events have positive dimensions', () => {
    fc.assert(
      fc.property(timelineDiagramArb, ({ hasTitle, title, sections }) => {
        const sectionLines = sections.flatMap(section => {
          const header = `section ${section.label}`
          const periodLines = section.periods.flatMap(period => {
            const eventStr = period.events.map(e => `: ${e}`).join(' ')
            return [`${period.label} ${eventStr}`]
          })
          return [header, ...periodLines]
        })

        const titleLine = hasTitle ? [`title ${title}`] : []

        const lines = toMermaidLines(
          ['timeline', ...titleLine, ...sectionLines].join('\n'),
        )

        const diagram = parseTimelineDiagram(lines)
        const positioned = layoutTimelineDiagram(diagram)

        for (const section of positioned.sections) {
          expect(section.width > 0).toBe(true)
          expect(section.height > 0).toBe(true)

          for (const period of section.periods) {
            expect(period.pillWidth > 0).toBe(true)
            expect(period.pillHeight > 0).toBe(true)

            for (const event of period.events) {
              expect(event.width > 0).toBe(true)
              expect(event.height > 0).toBe(true)
            }
          }
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

// ============================================================================
// Journey layout bounds
// ============================================================================

describe('property-based journey layout bounds', () => {
  it('all sections and tasks stay within canvas bounds', () => {
    fc.assert(
      fc.property(journeyDiagramArb, ({ hasTitle, title, sections }) => {
        const sectionLines = sections.flatMap(section => {
          const header = `section ${section.label}`
          const taskLines = section.tasks.map(task => {
            const actorPart = task.actors.length > 0 ? `: ${task.actors.join(', ')}` : ''
            return `${task.text}: ${task.score}${actorPart}`
          })
          return [header, ...taskLines]
        })

        const titleLine = hasTitle ? [`title ${title}`] : []

        const lines = toMermaidLines(
          ['journey', ...titleLine, ...sectionLines].join('\n'),
        )

        const diagram = parseJourneyDiagram(lines)
        const positioned = layoutJourneyDiagram(diagram, resolveJourneyRequestAppearance())

        expect(positioned.width > 0).toBe(true)
        expect(positioned.height > 0).toBe(true)

        const canvas = { width: positioned.width, height: positioned.height }

        // Title should be within canvas
        if (positioned.title) {
          expectFinite(positioned.title.x, 'title.x')
          expectFinite(positioned.title.y, 'title.y')
          expect(positioned.title.x >= 0).toBe(true)
          expect(positioned.title.y >= 0).toBe(true)
          expect(positioned.title.x <= canvas.width + 0.5).toBe(true)
          expect(positioned.title.y <= canvas.height + 0.5).toBe(true)
        }

        for (const section of positioned.sections) {
          expectWithinCanvas(section, canvas, `section(${section.id})`)

          for (const task of section.tasks) {
            expectWithinCanvas(task, canvas, `task(${task.id})`)

            // Text coordinates should be finite
            expectFinite(task.textX, `task(${task.id}).textX`)
            expectFinite(task.textY, `task(${task.id}).textY`)

            // Score marker and track should be finite and within canvas
            expectFinite(task.centerX, `task(${task.id}).centerX`)
            expectFinite(task.track.x, `track(${task.id}).x`)
            expectFinite(task.track.y1, `track(${task.id}).y1`)
            expectFinite(task.track.y2, `track(${task.id}).y2`)
            expect(task.track.y1 >= -0.5).toBe(true)
            expect(task.track.y2 <= canvas.height + 0.5).toBe(true)
            expectFinite(task.marker.cx, `marker(${task.id}).cx`)
            expectFinite(task.marker.cy, `marker(${task.id}).cy`)
            expectFinite(task.marker.r, `marker(${task.id}).r`)
            expect(task.marker.r > 0).toBe(true)
            expect(task.marker.cx - task.marker.r >= -0.5).toBe(true)
            expect(task.marker.cx + task.marker.r <= canvas.width + 0.5).toBe(true)
            expect(task.marker.cy - task.marker.r >= -0.5).toBe(true)
            expect(task.marker.cy + task.marker.r <= canvas.height + 0.5).toBe(true)

            // Actor dots should be finite
            for (const dot of task.actorDots) {
              expectFinite(dot.x, `actorDot(${dot.label}).x`)
              expectFinite(dot.y, `actorDot(${dot.label}).y`)
              expectFinite(dot.r, `actorDot(${dot.label}).r`)
              expect(dot.r > 0).toBe(true)
              expect(dot.x - dot.r >= -0.5).toBe(true)
              expect(dot.y - dot.r >= -0.5).toBe(true)
              expect(dot.x + dot.r <= canvas.width + 0.5).toBe(true)
              expect(dot.y + dot.r <= canvas.height + 0.5).toBe(true)
            }
          }
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })

  it('tasks and score cells have positive dimensions', () => {
    fc.assert(
      fc.property(journeyDiagramArb, ({ hasTitle, title, sections }) => {
        const sectionLines = sections.flatMap(section => {
          const header = `section ${section.label}`
          const taskLines = section.tasks.map(task => {
            const actorPart = task.actors.length > 0 ? `: ${task.actors.join(', ')}` : ''
            return `${task.text}: ${task.score}${actorPart}`
          })
          return [header, ...taskLines]
        })

        const titleLine = hasTitle ? [`title ${title}`] : []

        const lines = toMermaidLines(
          ['journey', ...titleLine, ...sectionLines].join('\n'),
        )

        const diagram = parseJourneyDiagram(lines)
        const positioned = layoutJourneyDiagram(diagram, resolveJourneyRequestAppearance())

        for (const section of positioned.sections) {
          expect(section.width > 0).toBe(true)
          expect(section.height > 0).toBe(true)

          for (const task of section.tasks) {
            expect(task.width > 0).toBe(true)
            expect(task.height > 0).toBe(true)
            expect(task.marker.r > 0).toBe(true)
            expect(task.track.y2).toBeGreaterThan(task.track.y1)
          }
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})
