import { describe, expect, it, spyOn } from 'bun:test'
import fc from 'fast-check'
import { SaxesParser } from 'saxes'
import { fcParameters } from './helpers/fc-parameters.ts'
import { classDevelopmentCase } from './helpers/family-conformance-profiles.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import * as classLayout from '../class/layout.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'

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
  it('auto-creates referenced actors and keeps every message in order', () => {
    // Prefix names so the generator cannot emit Sequence keywords such as Par.
    const sequenceArb = fc.uniqueArray(idArb.map(id => `Actor${id}`), { minLength: 2, maxLength: 5 }).chain(ids =>
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

        expect(diagram.messages.map(message => [message.from, message.to, message.label]))
          .toEqual(messages.map(message => [message.from, message.to, message.label]))
        for (const message of messages) {
          expect(actorIds.has(message.from)).toBe(true)
          expect(actorIds.has(message.to)).toBe(true)
        }
      }),
      fcParameters({ numRuns: PROPERTY_RUNS }),
    )
  })
})

describe('property-based timeline parsing', () => {
  it('keeps every period and event in order and assigns unique ids', () => {
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
        const expectedPeriods: Array<[string, string[]]> = []

        for (const section of sections) {
          if (section.label) lines.push(`section ${section.label}`)
          for (const period of section.periods) {
            lines.push(`${period.label} : ${period.firstEvent}`)
            for (const continuationEvent of period.continuationEvents) lines.push(`: ${continuationEvent}`)
            expectedPeriods.push([period.label, [period.firstEvent, ...period.continuationEvents]])
          }
        }

        const diagram = parseTimelineDiagram(toLines(lines.join('\n')))
        const periods = diagram.sections.flatMap(section => section.periods)
        const events = periods.flatMap(period => period.events)

        expect(periods.map(period => [period.label, period.events.map(event => event.text)])).toEqual(expectedPeriods)
        expect(new Set(periods.map(period => period.id)).size).toBe(periods.length)
        expect(new Set(events.map(event => event.id)).size).toBe(events.length)
      }),
      fcParameters({ numRuns: PROPERTY_RUNS }),
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
      fcParameters({ numRuns: PROPERTY_RUNS }),
    )
  })

  it('retains independently authored larger Class models, including identical occurrences and immediate parents', () => {
    // These 8–24-class development cases earn source/model coverage only.
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 24 }), fc.integer({ min: 0, max: 7 }), fc.boolean(), (count, variant, directed) => {
        const sample = classDevelopmentCase(count, variant, directed)
        const diagram = parseClassDiagram(normalizeMermaidSource(sample.source).familyLines)
        expect(diagram.classes.map(cls => ({ id: cls.id, label: cls.label, attributes: cls.attributes.map(member => member.sourceText), methods: cls.methods.map(member => [member.visibility, member.name, member.type]) }))).toEqual(
          sample.expected.classes.map((cls, index) => ({ id: cls.id, label: cls.label, attributes: [cls.attribute], methods: [['+', `read${index}`, 'String']] })),
        )
        expect(diagram.direction ?? 'TB').toBe(sample.expected.direction)
        const namespaces: Array<{ id: string; parentId?: string; classIds: string[] }> = []
        const visit = (entries: typeof diagram.namespaces, parent?: string): void => {
          for (const ns of entries) {
            const id = parent ? `${parent}.${ns.name}` : ns.name
            namespaces.push({ id, parentId: parent, classIds: ns.classIds })
            visit(ns.children, id)
          }
        }
        visit(diagram.namespaces)
        expect(namespaces).toEqual(sample.expected.namespaces.map(ns => ({ id: ns.id, parentId: ns.parentId, classIds: ns.classIds })))
        expect(diagram.relationships.map(rel => [rel.from, rel.to, rel.type, rel.markerAt, rel.label, rel.fromCardinality, rel.toCardinality])).toEqual(sample.expected.relationships.map(rel => [rel.from, rel.to, rel.type, rel.markerAt, rel.label, rel.fromCardinality, rel.toCardinality]))
        expect(diagram.notes.map(note => ({ for: note.for, text: note.text }))).toEqual(sample.expected.notes)
        const parsed = parseRegisteredMermaid(sample.source)
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) throw new Error('Authored Class source must parse')
        if (directed) {
          // The typed Class body has no direction slot: preserve this supported
          // renderer syntax exactly instead of silently dropping its direction.
          expect(parsed.value.body.kind).toBe('opaque')
          if (parsed.value.body.kind !== 'opaque') throw new Error('Expected lossless direction boundary')
          expect(parsed.value.body.source).toBe(sample.bodySource)
          return
        }
        if (parsed.value.body.kind !== 'class') throw new Error('Undirected Class source must remain structured')
        const body = parsed.value.body
        expect(body.classes.map(cls => ({ id: cls.id, label: cls.label, namespace: cls.namespace, members: cls.members }))).toEqual(sample.expected.classes.map(cls => ({ id: cls.id, label: cls.label, namespace: cls.namespace, members: [cls.attribute, cls.method] })))
        expect(body.namespaces?.map(ns => ns.name)).toEqual(sample.expected.namespaces.map(ns => ns.id))
        expect(body.relations.map(rel => [rel.from, rel.to, rel.kind, rel.markerAt, rel.label, rel.fromCardinality, rel.toCardinality])).toEqual(sample.expected.relationships.map(rel => [rel.from, rel.to, rel.type, rel.markerAt, rel.label, rel.fromCardinality, rel.toCardinality]))
        expect(body.notes.map(note => ({ for: note.for, text: note.text }))).toEqual(sample.expected.notes)
      }),
      fcParameters({
        numRuns: 24,
        examples: [
          [8, 0, true],
          [8, 0, false],
          [16, 1, false],
          [24, 2, true],
        ],
      }),
    )
  })

  for (const variant of [0, 1, 2])
    for (const backend of ['agentic', 'elk'] as const) {
      it(`retains authored 8-class occurrences, ${backend}, wrapper ${variant}`, () => {
        const sample = classDevelopmentCase(8, variant),
          expected = sample.expected
        const original = classLayout.layoutClassDiagram
        let model: Parameters<typeof original>[0] | undefined, before: typeof model, positioned: ReturnType<typeof original> | undefined
        const observer = spyOn(classLayout, 'layoutClassDiagram').mockImplementation((...args: Parameters<typeof original>) => {
          model = args[0]
          before = structuredClone(model)
          expect(model.title).toBe(variant % 3 === 2 ? 'Class development' : undefined)
          expect(args[2]?.edge?.lineWidth).toBe(1)
          positioned = original(...args)
          return positioned
        })
        let result: ReturnType<typeof renderMermaidSVGWithReceipt>
        try {
          result = renderMermaidSVGWithReceipt(sample.source, {
            graphLayout: { backend, fallback: 'none' },
            embedFontImport: false,
            seed: 608,
            style: { formatVersion: 1, name: 'class-development', stroke: 'crisp', strokeWidth: 1 },
          })
        } finally {
          observer.mockRestore()
        }
        expect(model).toEqual(before)
        expect(positioned).toBeDefined()
        expect(result.receipt.layoutCertification?.status).toBe('passed')
        expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ requested: backend, selected: backend, fallback: 'none', role: 'primary' })])
        const placed = positioned!
        expect(placed.classes.map(cls => cls.id).sort()).toEqual(expected.classes.map(cls => cls.id).sort())
        expect(placed.namespaces.map(ns => [ns.id, ns.parentId, [...ns.classIds].sort()]).sort()).toEqual(expected.namespaces.map(ns => [ns.id, ns.parentId, [...ns.classIds].sort()]).sort())
        expect(placed.relationships.map(rel => [rel.from, rel.to, rel.type, rel.markerAt, rel.label, rel.fromCardinality, rel.toCardinality])).toEqual(expected.relationships.map(rel => [rel.from, rel.to, rel.type, rel.markerAt, rel.label, rel.fromCardinality, rel.toCardinality]))

        // Read the actual XML, independently of parser/layout semantic metadata.
        type Element = { name: string; attrs: Record<string, string>; text: string; parent?: Element }
        const elements: Element[] = [],
          stack: Element[] = []
        const xml = new SaxesParser({ xmlns: false })
        xml.on('opentag', tag => {
          const element = { name: tag.name, attrs: tag.attributes, text: '', parent: stack.at(-1) }
          elements.push(element)
          stack.push(element)
        })
        xml.on('text', text => {
          for (const element of stack) element.text += text
        })
        xml.on('closetag', () => {
          stack.pop()
        })
        xml.write(result.svg).close()
        const visible = (element: Element) => {
          const rows = elements.filter(child => child.parent === element && child.name === 'tspan' && (child.attrs.dy !== undefined || child.attrs.y !== undefined))
          return rows.length > 1 ? rows.map(row => row.text).join(' ') : element.text
        }
        const body = (owner: Element) => {
          const rectangles = elements.filter(el => el.parent === owner && el.name === 'rect')
          expect(rectangles).toHaveLength(1)
          for (const field of ['x', 'y', 'width', 'height']) expect(Number.isFinite(Number(rectangles[0]!.attrs[field]))).toBe(true)
          expect(Number(rectangles[0]!.attrs.width)).toBeGreaterThan(0)
          expect(Number(rectangles[0]!.attrs.height)).toBeGreaterThan(0)
          expect(rectangles[0]!.attrs.fill).not.toBe('none')
        }
        const cards = elements.filter(el => el.attrs.class?.split(' ').includes('class-node'))
        const titles = elements.filter(el => el.name === 'text' && (el.attrs['data-role'] === 'title' || el.attrs.class === 'diagram-title'))
        expect(titles.map(visible)).toEqual(variant % 3 === 2 ? ['Class development'] : [])
        expect(cards.map(el => el.attrs['data-id']).sort()).toEqual(expected.classes.map(cls => cls.id).sort())
        for (const cls of expected.classes) {
          const card = cards.find(el => el.attrs['data-id'] === cls.id)!
          body(card)
          expect(card.attrs['data-label']).toBe(cls.label)
          expect(elements.filter(el => el.name === 'text' && el.parent === card).map(visible)).toEqual([cls.label, cls.attribute, cls.methodDisplay])
        }
        const namespaces = elements.filter(el => el.attrs.class === 'namespace')
        expect(namespaces.map(el => [el.attrs['data-id'], el.attrs['data-parent-id']]).sort()).toEqual(expected.namespaces.map(ns => [ns.id, ns.parentId]).sort())
        for (const ns of expected.namespaces) {
          const group = namespaces.find(el => el.attrs['data-id'] === ns.id)!
          body(group)
          expect(elements.filter(el => el.name === 'text' && el.parent === group).map(visible)).toEqual([ns.name])
        }
        const carriers = elements.filter(el => el.attrs.class === 'class-relationship')
        expect(carriers).toHaveLength(expected.relationships.length)
        const occurrence = new Map<string, number>()
        for (let index = 0; index < expected.relationships.length; index++) {
          const rel = expected.relationships[index]!,
            attrs = carriers[index]!.attrs,
            pair = `${rel.from}->${rel.to}`,
            ordinal = occurrence.get(pair) ?? 0
          occurrence.set(pair, ordinal + 1)
          expect([attrs['data-id'], attrs['data-from'], attrs['data-to'], attrs['data-type'], attrs['data-marker-at'], attrs['data-label'], attrs['data-from-cardinality'], attrs['data-to-cardinality']]).toEqual([
            `rel:${pair}#${ordinal}`,
            rel.from,
            rel.to,
            rel.type,
            rel.markerAt,
            rel.label,
            rel.fromCardinality,
            rel.toCardinality,
          ])
          expect(attrs['stroke-width']).toBe('1')
          expect(carriers[index]!.name).toBe('polyline')
          const points = attrs
            .points!.trim()
            .split(/\s+/)
            .map(point => point.split(',').map(Number))
          expect(points.length).toBeGreaterThanOrEqual(2)
          expect(points.every(point => point.length === 2 && point.every(Number.isFinite))).toBe(true)
          expect(points.some(point => point[0] !== points[0]![0] || point[1] !== points[0]![1])).toBe(true)
          expect(attrs.stroke).not.toBe('none')
          expect(Number(attrs['stroke-opacity'] ?? 1)).toBeGreaterThan(0)
          expect(attrs['marker-start']).toBe(rel.markerAt === 'from' && rel.marker !== undefined ? `url(#${rel.marker})` : undefined)
          expect(attrs['marker-end']).toBe(rel.markerAt === 'to' && rel.marker !== undefined ? `url(#${rel.marker})` : undefined)
        }
        const notes = elements.filter(el => el.attrs.class === 'class-note')
        for (const note of notes) body(note)
        expect(notes.map(el => ({ for: el.attrs['data-for'], text: visible(elements.find(text => text.name === 'text' && text.parent === el)!) }))).toEqual(expected.notes)
        const relationTexts = elements.filter(el => el.name === 'text' && el.parent?.name === 'svg' && el.attrs['data-role'] !== 'title' && el.attrs.class !== 'diagram-title')
        const expectedTexts = expected.relationships.flatMap((rel, index) => {
          if (rel.label === undefined) return []
          const placedRel = placed.relationships[index]!,
            pair = `${rel.from}->${rel.to}`
          const ordinal = expected.relationships.slice(0, index).filter(previous => previous.from === rel.from && previous.to === rel.to).length
          return [
            { text: rel.label, id: undefined, position: placedRel.labelPosition!, offset: 8 },
            { text: rel.fromCardinality!, id: `rel-card:${pair}#${ordinal}:from`, position: placedRel.fromCardinalityPosition!, offset: 0 },
            { text: rel.toCardinality!, id: `rel-card:${pair}#${ordinal}:to`, position: placedRel.toCardinalityPosition!, offset: 0 },
          ]
        })
        expect(relationTexts).toHaveLength(expectedTexts.length)
        for (let index = 0; index < expectedTexts.length; index++) {
          const text = relationTexts[index]!,
            authored = expectedTexts[index]!
          expect(visible(text)).toBe(authored.text)
          if (authored.id) expect(text.attrs['data-id']).toBe(authored.id)
          // This is emitted-to-positioned ownership, not a geometric safety
          // oracle: the shared numeric spelling is the writer's public boundary.
          expect(text.attrs.x).toBe(formatSvgNumber(authored.position.x))
          expect(text.attrs.y).toBe(formatSvgNumber(authored.position.y - authored.offset))
        }
      })
    }
})
