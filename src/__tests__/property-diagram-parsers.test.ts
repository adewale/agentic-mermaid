import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { parseClassDiagram } from '../class/parser.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { parseTimelineDiagram } from '../timeline/parser.ts'

const PROPERTY_RUNS = 50
const ID_HEAD = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
const ID_TAIL = [...'abcdefghijklmnopqrstuvwxyz0123456789']
const WORD_CHARS = [...'abcdefghijklmnopqrstuvwxyz']

const idArb = fc
  .tuple(
    fc.constantFrom(...ID_HEAD),
    fc.array(fc.constantFrom(...ID_TAIL), { maxLength: 5 }),
  )
  .map(([head, tail]) => `${head}${tail.join('')}`)

const wordArb = fc
  .array(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 8 })
  .map(chars => chars.join(''))

const labelArb = fc
  .array(wordArb, { minLength: 1, maxLength: 3 })
  .map(parts => parts.join(' '))

function toLines(source: string): string[] {
  return source
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('%%'))
}

describe('property-based sequence parsing', () => {
  it('auto-creates referenced actors and preserves message count', () => {
    const sequenceArb = fc.uniqueArray(idArb, { minLength: 2, maxLength: 5 }).chain(ids =>
      fc.record({
        ids: fc.constant(ids),
        declaredIds: fc.subarray(ids, { maxLength: ids.length }),
        messages: fc.array(
          fc.record({
            from: fc.constantFrom(...ids),
            to: fc.constantFrom(...ids),
            label: labelArb,
          }),
          { minLength: 1, maxLength: 6 },
        ),
      }),
    )

    fc.assert(
      fc.property(sequenceArb, ({ declaredIds, messages }) => {
        const source = [
          'sequenceDiagram',
          ...declaredIds.map(id => `participant ${id}`),
          ...messages.map(message => `${message.from}->>${message.to}: ${message.label}`),
        ].join('\n')

        const diagram = parseSequenceDiagram(toLines(source))
        const actorIds = new Set(diagram.actors.map(actor => actor.id))

        expect(diagram.messages).toHaveLength(messages.length)
        for (const message of messages) {
          expect(actorIds.has(message.from)).toBe(true)
          expect(actorIds.has(message.to)).toBe(true)
        }
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

describe('property-based timeline parsing', () => {
  it('preserves total periods and events and assigns unique ids', () => {
    const sectionArb = fc.record({
      label: fc.option(labelArb, { nil: undefined }),
      periods: fc.array(
        fc.record({
          label: labelArb,
          firstEvent: labelArb,
          continuationEvents: fc.array(labelArb, { maxLength: 2 }),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    })

    fc.assert(
      fc.property(fc.array(sectionArb, { minLength: 1, maxLength: 3 }), (sections) => {
        const lines = ['timeline']
        let expectedPeriodCount = 0
        let expectedEventCount = 0

        for (const section of sections) {
          if (section.label) lines.push(`section ${section.label}`)
          for (const period of section.periods) {
            lines.push(`${period.label} : ${period.firstEvent}`)
            expectedPeriodCount++
            expectedEventCount++
            for (const continuationEvent of period.continuationEvents) {
              lines.push(`: ${continuationEvent}`)
              expectedEventCount++
            }
          }
        }

        const diagram = parseTimelineDiagram(toLines(lines.join('\n')))
        const periods = diagram.sections.flatMap(section => section.periods)
        const events = periods.flatMap(period => period.events)

        expect(periods).toHaveLength(expectedPeriodCount)
        expect(events).toHaveLength(expectedEventCount)
        expect(new Set(periods.map(period => period.id)).size).toBe(periods.length)
        expect(new Set(events.map(event => event.id)).size).toBe(events.length)
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

describe('property-based class parsing', () => {
  it('materializes relationship endpoints and keeps namespace membership valid', () => {
    const relationshipArb = fc.constantFrom('<|--', '*--', 'o--', '-->', '..>', '..|>')
    const classArb = fc.uniqueArray(idArb, { minLength: 2, maxLength: 5 }).chain(ids =>
      fc.record({
        ids: fc.constant(ids),
        // Only some classes are declared up front, so relationships must
        // materialize the rest.
        declared: fc.subarray(ids),
        namespaceNames: fc.uniqueArray(wordArb.map(word => `${word.toUpperCase()}Space`), { minLength: 2, maxLength: 2 }),
        // Each class joins at most one namespace (-1 = none).
        namespaceOf: fc.array(fc.integer({ min: -1, max: 1 }), { minLength: ids.length, maxLength: ids.length }),
        relationships: fc.array(
          fc.record({
            from: fc.constantFrom(...ids),
            to: fc.constantFrom(...ids),
            arrow: relationshipArb,
            label: fc.option(labelArb, { nil: undefined }),
          }).filter(entry => entry.from !== entry.to),
          { minLength: 1, maxLength: 5 },
        ),
      }),
    )

    fc.assert(
      fc.property(classArb, ({ ids, declared, namespaceNames, namespaceOf, relationships }) => {
        const lines = ['classDiagram', ...declared.map(id => `class ${id}`)]

        const namespaces = namespaceNames
          .map((name, index) => ({ name, members: ids.filter((_, i) => namespaceOf[i] === index) }))
          .filter(namespace => namespace.members.length > 0)
        for (const namespace of namespaces) {
          lines.push(`namespace ${namespace.name} {`)
          for (const member of namespace.members) {
            lines.push(`class ${member}`)
          }
          lines.push('}')
        }

        for (const relationship of relationships) {
          lines.push(
            `${relationship.from} ${relationship.arrow} ${relationship.to}${relationship.label ? ` : ${relationship.label}` : ''}`,
          )
        }

        const diagram = parseClassDiagram(toLines(lines.join('\n')))

        // Every relationship survives, in order, with its endpoints.
        expect(diagram.relationships.map(r => `${r.from}->${r.to}`))
          .toEqual(relationships.map(r => `${r.from}->${r.to}`))
        // Exactly the declared, namespaced and referenced classes exist:
        // undeclared endpoints are materialized and nothing phantom appears.
        const expectedClasses = new Set([
          ...declared,
          ...namespaces.flatMap(namespace => namespace.members),
          ...relationships.flatMap(r => [r.from, r.to]),
        ])
        expect(diagram.classes.map(node => node.id).sort()).toEqual([...expectedClasses].sort())
        // Namespace membership is exactly what was authored.
        expect(Object.fromEntries(diagram.namespaces.map(namespace => [namespace.name, [...namespace.classIds].sort()])))
          .toEqual(Object.fromEntries(namespaces.map(namespace => [namespace.name, [...namespace.members].sort()])))
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})
