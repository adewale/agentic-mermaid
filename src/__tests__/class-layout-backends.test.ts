
import { describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import * as classLayoutModule from '../class/layout.ts'
import { CLASS_STYLE_DEFAULTS, classTextBlock, finalizeClassOwnedSurfaces, layoutClassDiagram } from '../class/layout.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { assertClassElkSelfContactsClear, constructClassElkSelfContacts } from '../class/elk-contacts.ts'
import { createClassMarkerAdmissionWork } from '../class/marker-admission.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { missingSvgLabels } from './helpers/svg-labels.ts'
import { measureQuality } from '../agent/quality.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/class-backends.mmd', import.meta.url), 'utf8')
const compoundFixture = readFileSync(new URL('../../eval/layout-compare/fixtures/class-compound-backends.mmd', import.meta.url), 'utf8')

describe('Class layout backends', () => {
  test.each(['TB', 'BT', 'LR', 'RL'])('renders a long native Class chain with exact card contacts in %s', direction => {
    const source = `classDiagram\ndirection ${direction}\n` + Array.from({ length: 127 }, (_, i) => `N${i} --> N${i + 1}`).join('\n')
    let rendered!: ReturnType<typeof renderMermaidSVGWithReceipt>
    expect(() => { rendered = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic', fallback: 'none' } }) }).not.toThrow()
    expect(rendered.receipt.layoutCertification).toMatchObject({ status: 'passed', issues: [] })
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', fallback: 'none' })])
    expect(rendered.svg.match(/class="class-node"/g)).toHaveLength(128)
    expect(rendered.svg.match(/class="class-relationship"/g)).toHaveLength(127)
    expect(rendered.svg).toContain('data-id="N127"')
  })

  test.each([4, 5].flatMap(children => ['TB', 'BT', 'LR', 'RL'].map(direction => ({ children, direction }))))('reserves independent inheritance fan channels for $children siblings in $direction', ({ children, direction }) => {
    const ids = Array.from({ length: children }, (_, index) => `Child${children - index - 1}`)
    const source = `classDiagram\ndirection ${direction}\n${ids.map(id => `Root <|-- ${id}`).join('\n')}`
    const rendered = renderMermaidSVGWithReceipt(source, native)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    const painted = (rendered.svg.match(/<polyline\b[^>]*>/g) ?? []).filter(tag => tag.includes('data-type="inheritance"'))
    expect(painted).toHaveLength(children)
    expect(painted.every(tag => /\smarker-start=/.test(tag))).toBe(true)
    const { layout } = layoutMermaidWithReceipt(source, native), quality = measureQuality(layout)
    expect(layout.edges.map(edge => [edge.from, edge.to])).toEqual(ids.map(id => ['Root', id]))
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.routeOverlaps).toEqual({ parallel: 0, opposing: 0 })
    const boxes = new Map(layout.nodes.map(node => [node.id, node]))
    const horizontal = direction === 'LR' || direction === 'RL', reverse = direction === 'RL' || direction === 'BT'
    let previousPort = -Infinity
    for (const edge of layout.edges) {
      const from = boxes.get(edge.from)!, to = boxes.get(edge.to)!, start = edge.path[0]!, end = edge.path.at(-1)!
      const port = horizontal ? start[1] : start[0]
      expect(port).toBeGreaterThan(previousPort)
      previousPort = port
      if (horizontal) {
        expect(start[0]).toBeCloseTo(from.x + (reverse ? 0 : from.w), 8)
        expect(end[0]).toBeCloseTo(to.x + (reverse ? to.w : 0), 8)
        expect(port).toBeGreaterThan(from.y)
        expect(port).toBeLessThan(from.y + from.h)
      } else {
        expect(start[1]).toBeCloseTo(from.y + (reverse ? 0 : from.h), 8)
        expect(end[1]).toBeCloseTo(to.y + (reverse ? to.h : 0), 8)
        expect(port).toBeGreaterThan(from.x)
        expect(port).toBeLessThan(from.x + from.w)
      }
    }
  })

  test.each(['TB', 'BT', 'LR', 'RL'])('keeps inherited sibling routes ordered after seating arrowheads in %s', direction => {
    const source = `classDiagram
direction ${direction}
Animal <|-- Duck
Animal <|-- Fish
Animal <|-- Zebra
Animal : +int age
Animal : +String gender
Animal : +isMammal()
Animal : +mate()
Duck : +String beakColor
Duck : +swim()
Duck : +quack()
Fish : -int sizeInFeet
Fish : -canEat()
Zebra : +bool is_wild
Zebra : +run()
note for Duck "can fly<br>can swim<br>can dive<br>can help in debugging"`
    const result = layoutMermaidWithReceipt(source, native), quality = measureQuality(result.layout)
    expect(result.layout.edges.map(edge => [edge.from, edge.to])).toEqual([['Animal', 'Duck'], ['Animal', 'Fish'], ['Animal', 'Zebra']])
    expect(quality.edgeCrossings).toBe(0)
    expect(quality.routeOverlaps).toEqual({ parallel: 0, opposing: 0 })
    expect(renderMermaidSVGWithReceipt(source, native).receipt.layoutCertification?.status).toBe('passed')
  })

  test.each(['TB', 'BT', 'LR', 'RL'])('retains member compartments, notes, cardinalities and relationship meaning in %s', direction => {
    const source = fixture.replace('direction LR', `direction ${direction}`)
    const model = parseClassDiagram(toMermaidLines(source)),
      original = structuredClone(model)
    const placed = layoutClassDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutClassDiagram(model, native)).toEqual(placed)
    expect(placed.classes.map(cls => [cls.id, cls.label, cls.annotation, cls.attributes, cls.methods])).toEqual(model.classes.map(cls => [cls.id, cls.label, cls.annotation, cls.attributes, cls.methods]))
    expect(placed.relationships.map(({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label }) => ({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label }))).toEqual(
      model.relationships.map(({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label }) => ({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label })),
    )
    expect(placed.notes.map(note => [note.for, note.text])).toEqual(model.notes.map(note => [note.for, note.text]))
    for (const relation of placed.relationships) {
      expect(relation.points.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < relation.points.length; i++) expect(relation.points[i - 1]!.x === relation.points[i]!.x || relation.points[i - 1]!.y === relation.points[i]!.y).toBe(true)
      if (relation.fromCardinality) expect(relation.fromCardinalityPosition).toBeDefined()
      if (relation.toCardinality) expect(relation.toCardinalityPosition).toBeDefined()
    }
    const rendered = renderMermaidSVGWithReceipt(source, native)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'primary' })])
    for (const label of ['Account', 'Audit', 'Repository', 'Retain prepared note text', 'records', 'reviews', 'belongs', 'delegates', 'stores']) expect(rendered.svg).toContain(label)
  })

  test('uses the selected producer across source/parsed/layout/PNG surfaces and retains explicit ELK bytes', () => {
    const options = { ...native, nodeSpacing: 51 },
      stages: string[] = [],
      parsed = parseRegisteredMermaid(fixture)
    if (!parsed.ok) throw new Error('fixture must parse')
    const result = withRenderStageObserver(
      sample => stages.push(sample.stage),
      () => renderMermaidSVGWithReceipt(fixture, options),
    )
    expect(stages).toContain('agentic')
    expect(stages).not.toContain('elk')
    expect(renderMermaidSVGWithReceipt(parsed.value, options).svg).toBe(result.svg)
    expect(layoutMermaidWithReceipt(fixture, options).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    const png = renderMermaidPNGWithReceipt(fixture, options)
    expect(png.png.length).toBeGreaterThan(0)
    expect(png.receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    expect(renderMermaidSVGWithReceipt(fixture, { graphLayout: { backend: 'elk' } }).svg).toBe(renderMermaidSVGWithReceipt(fixture).svg)
  })

  test.each(
    [
      ['lollipop', 'classDiagram\nConsumer --() API : uses'],
      ['authored prefix and edge', 'classDiagram\nclass `ns:Authored`\nclass B\n`ns:Authored` --> B'],
      ['authored prefix and note', 'classDiagram\nclass `ns:Domain`["Authored card"]\nnote for `ns:Domain` "owned note"'],
      ['namespace collision', 'classDiagram\nnamespace Domain {\nclass `ns:Domain`["Authored card"]\nclass `ns:Domain#1`\nclass B\n}\n`ns:Domain` --> B : relation\nnote for `ns:Domain` "owned note"'],
      ['nested namespace collision', 'classDiagram\nnamespace Outer {\nnamespace Domain {\nclass `ns:Outer.Domain`["Nested card"]\nclass `ns:Outer.Domain#1`\nclass B\n}\n}\n`ns:Outer.Domain` --> B : relation\nnote for `ns:Outer.Domain` "owned note"'],
    ].flatMap(([name, source]) => (['elk', 'agentic'] as const).map(backend => ({ name, source: source!, backend }))),
  )('retains $name with $backend', ({ source, backend }) => {
    const options = { graphLayout: { backend, fallback: 'none' as const } }
    const parsed = parseClassDiagram(toMermaidLines(source)),
      placed = layoutClassDiagram(parsed, options)
    expect(placed.classes.map(cls => [cls.id, cls.label, cls.isInterface])).toEqual(parsed.classes.map(cls => [cls.id, cls.label, cls.isInterface || undefined]))
    expect(placed.namespaces.map(ns => ns.id)).toEqual(source.includes('namespace Outer') ? ['Outer', 'Outer.Domain'] : source.includes('namespace Domain') ? ['Domain'] : [])
    expect(placed.notes.map(note => [note.for, note.text])).toEqual(parsed.notes.map(note => [note.for, note.text]))
    // Independent literal note core: a passing receipt must not hide a shaft
    // through the filled rectangle inside the note's two-pixel rounded corners.
    for (const note of placed.notes)
      for (const rel of placed.relationships)
        for (let i = 1; i < rel.points.length; i++) {
          const a = rel.points[i - 1]!,
            b = rel.points[i]!,
            left = note.x + 2,
            right = note.x + note.width - 2,
            top = note.y + 2,
            bottom = note.y + note.height - 2
          const crosses = a.x === b.x ? a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom : a.y === b.y ? a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right : false
          expect(crosses, `${rel.from}->${rel.to} crosses the owned note for ${note.for}`).toBe(false)
        }
    const result = renderMermaidSVGWithReceipt(source, options)
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    for (const cls of parsed.classes.filter(cls => !cls.isInterface)) expect(result.svg).toContain(cls.label)
    if (source.includes('owned note')) expect(result.svg).toContain('owned note')
    if (source.includes('relation')) expect(result.svg).toContain('relation')
  })

  test.each(['TB', 'BT', 'LR', 'RL'])('retains independent namespace frames, members and labels in %s', direction => {
    const source = compoundFixture.replace('direction TB', `direction ${direction}`)
    const model = parseClassDiagram(toMermaidLines(source)),
      original = structuredClone(model)
    const placed = layoutClassDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutClassDiagram(model, native)).toEqual(placed)
    expect(placed.classes.map(cls => [cls.id, cls.label, cls.attributes, cls.methods, cls.annotation, Boolean(cls.isInterface)])).toEqual(model.classes.map(cls => [cls.id, cls.label, cls.attributes, cls.methods, cls.annotation, Boolean(cls.isInterface)]))
    expect(placed.classes.map(cls => cls.id)).toContain('class-namespace:Platform')
    expect(placed.namespaces.map(ns => [ns.id, ns.parentId])).toEqual([
      ['Platform', undefined],
      ['Platform.Domain', 'Platform'],
      ['Audit', undefined],
    ])
    expect(placed.relationships.map(rel => [rel.from, rel.to, rel.type, rel.label, rel.fromCardinality, rel.toCardinality])).toEqual(model.relationships.map(rel => [rel.from, rel.to, rel.type, rel.label, rel.fromCardinality, rel.toCardinality]))
    const boxes = new Map([...placed.classes, ...placed.namespaces].map(box => [box.id, box]))
    for (const frame of placed.namespaces) {
      for (const id of [...frame.classIds, ...placed.namespaces.filter(child => child.parentId === frame.id).map(child => child.id)]) {
        const child = boxes.get(id)!
        expect(child.x).toBeGreaterThanOrEqual(frame.x - 0.01)
        expect(child.y).toBeGreaterThanOrEqual(frame.y + frame.headerHeight - 0.01)
        expect(child.x + child.width).toBeLessThanOrEqual(frame.x + frame.width + 0.01)
        expect(child.y + child.height).toBeLessThanOrEqual(frame.y + frame.height + 0.01)
      }
    }
    const stages: string[] = []
    const options = { ...native, nodeSpacing: 53 }
    const result = withRenderStageObserver(
      sample => stages.push(sample.stage),
      () => renderMermaidSVGWithReceipt(source, options),
    )
    expect(stages).not.toContain('elk')
    const reference = renderMermaidSVGWithReceipt(source, { ...options, graphLayout: { backend: 'elk' } })
    expect(reference.receipt.layoutCertification?.status).toBe('passed')
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', attempts: [{ backend: 'agentic', outcome: 'selected' }] })])
    const expected = ['Platform & API', 'Domain records', 'Audit history', 'class-namespace:Platform', 'Store', 'User', 'Account', 'Event', 'Record', 'Outside', 'Protocol', 'Retain scoped note', 'delegates', 'owns', 'logs', 'uses', '1', 'many', '+String id', '+ fetch()', '+String state', '+ save()', '+UUID id', '+UUID owner', '+String action', '+String key']
    expect(missingSvgLabels(result.svg, expected)).toEqual([])
    expect(missingSvgLabels(reference.svg, expected)).toEqual([])
  })

  test('retains namespace geometry across public surfaces, flattened grouping and empty frames', () => {
    const parsed = parseRegisteredMermaid(compoundFixture)
    if (!parsed.ok) throw new Error('compound fixture must parse')
    const result = renderMermaidSVGWithReceipt(compoundFixture, native)
    expect(renderMermaidSVGWithReceipt(parsed.value, native).svg).toBe(result.svg)
    expect(layoutMermaidWithReceipt(compoundFixture, native).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    expect(renderMermaidPNGWithReceipt(compoundFixture, native).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    const flat = layoutClassDiagram(parseClassDiagram(toMermaidLines(compoundFixture)), { ...native, class: { hierarchicalNamespaces: false } })
    expect(flat.namespaces).toHaveLength(3)
    expect(flat.namespaces.every(ns => ns.parentId === undefined)).toBe(true)
    for (const source of ['classDiagram\nnamespace Empty {\n}', '---\ntitle: Empty namespaces\n---\nclassDiagram\nnamespace Outer {\nnamespace Inner {\n}\n}']) {
      const empty = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic', fallback: 'elk' } })
      expect(empty.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
      expect(empty.svg).toContain(source.includes('Outer') ? 'Inner' : 'Empty')
    }
  })

  test('routes cross-namespace relationships while retaining native empty diagrams', () => {
    const grouped = 'classDiagram\nnamespace Left {\nclass A\n}\nnamespace Right {\nclass B\n}\nA --> B'
    const stages: string[] = []
    const result = withRenderStageObserver(
      sample => stages.push(sample.stage),
      () => renderMermaidSVGWithReceipt(grouped, native),
    )
    expect(stages).not.toContain('elk')
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
    expect(renderMermaidPNGWithReceipt(grouped, native).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    expect(layoutMermaidWithReceipt(grouped, native).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    for (const source of ['classDiagram', '---\ntitle: Empty Class title\n---\nclassDiagram']) {
      const result = renderMermaidSVGWithReceipt(source, native)
      expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
      expect(result.svg).toBe(renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk' } }).svg)
      if (source.includes('title:')) expect(result.svg).toContain('Empty Class title')
    }
  })

  test.each(
    [
      {
        name: 'literal siblings',
        declarations: 'namespace `Domain.Left`["Left namespace"] {\nclass `ns:Domain.Left`["Left card"]\n}\nnamespace `Domain.Right`["Right namespace"] {\nclass `class-namespace:Domain.Right`["Right card"]\n}',
        groups: [
          ['Domain.Left', undefined, ['ns:Domain.Left']],
          ['Domain.Right', undefined, ['class-namespace:Domain.Right']],
        ],
      },
      {
        name: 'literal parent',
        declarations: 'namespace `Domain.Root`["Left namespace"] {\nclass `ns:Domain.Left`["Left card"]\nnamespace Child["Right namespace"] {\nclass `class-namespace:Domain.Right`["Right card"]\n}\n}',
        groups: [
          ['Domain.Root', undefined, ['ns:Domain.Left']],
          ['Domain.Root.Child', 'Domain.Root', ['class-namespace:Domain.Right']],
        ],
      },
      {
        name: 'literal and syntactic siblings',
        declarations: 'namespace `Domain.Left`["Left namespace"] {\nclass `ns:Domain.Left`["Left card"]\n}\nnamespace Domain {\nnamespace Right["Right namespace"] {\nclass `class-namespace:Domain.Right`["Right card"]\n}\n}',
        groups: [
          ['Domain.Left', undefined, ['ns:Domain.Left']],
          ['Domain', undefined, []],
          ['Domain.Right', 'Domain', ['class-namespace:Domain.Right']],
        ],
      },
    ].flatMap(example => (['elk', 'agentic'] as const).map(backend => ({ ...example, backend }))),
  )('routes $name without inventing ancestors with $backend', ({ declarations, groups, backend }) => {
    const source = `classDiagram\n${declarations}\n\`ns:Domain.Left\` "1" --> "many" \`class-namespace:Domain.Right\` : first relation\n\`ns:Domain.Left\` -- \`class-namespace:Domain.Right\` : parallel relation`
    const options = { graphLayout: { backend, fallback: 'none' as const } }
    const placed = layoutClassDiagram(parseClassDiagram(toMermaidLines(source)), options)
    expect(placed.namespaces.map(ns => [ns.id, ns.parentId, ns.classIds])).toEqual(groups)
    expect(placed.relationships.map(rel => [rel.from, rel.to, rel.label])).toEqual([
      ['ns:Domain.Left', 'class-namespace:Domain.Right', 'first relation'],
      ['ns:Domain.Left', 'class-namespace:Domain.Right', 'parallel relation'],
    ])
    const rendered = renderMermaidSVGWithReceipt(source, options)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    const shafts = rendered.svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/g) ?? []
    expect(shafts).toHaveLength(2)
    for (const shaft of shafts) {
      const coordinates = shaft
        .match(/\bpoints="([^"]+)"/)![1]!
        .split(' ')
        .map(pair => pair.split(',').map(Number))
      for (const [id, point] of [
        ['ns:Domain.Left', coordinates[0]!],
        ['class-namespace:Domain.Right', coordinates.at(-1)!],
      ] as const) {
        const box = placed.classes.find(cls => cls.id === id)!
        const [x, y] = point
        expect(x!).toBeGreaterThanOrEqual(box.x - 0.01)
        expect(x!).toBeLessThanOrEqual(box.x + box.width + 0.01)
        expect(y!).toBeGreaterThanOrEqual(box.y - 0.01)
        expect(y!).toBeLessThanOrEqual(box.y + box.height + 0.01)
        expect(Math.min(Math.abs(x! - box.x), Math.abs(x! - box.x - box.width), Math.abs(y! - box.y), Math.abs(y! - box.y - box.height))).toBeLessThan(0.01)
      }
    }
    for (const label of ['Left namespace', 'Right namespace', 'Left card', 'Right card', 'first relation', 'parallel relation']) expect(rendered.svg).toContain(label)
  })

  test('retains labelled cross-namespace branches when removing a closed route excursion', () => {
    const source = `classDiagram
namespace Left {
  class A["CatalogRepository 👩‍💻"] {
    +String value0
    +step0()
  }
  class B["AuditRecord"] {
    +String value1
  }
  class C["Unit"] {
    +String value2
    +step2()
  }
}
namespace Right {
  class D["TranslationService 👩‍💻"] {
    +String value3
  }
  class E["ClientSubscription"] {
    +String value4
    +step4()
  }
  class F["Wire"] {
    +String value5
  }
}
A ..|> B : owns entry
A *-- C
B ..|> D : translates request payload
B ..|> E
C ..|> F : sends a notification payload`
    const model = parseClassDiagram(toMermaidLines(source)),
      placed = layoutClassDiagram(model, native)
    expect(placed.relationships.map(rel => [rel.from, rel.to, rel.label])).toEqual(model.relationships.map(rel => [rel.from, rel.to, rel.label]))
    for (const relation of placed.relationships) {
      const points = relation.points
      for (const [id, endpoint, next] of [
        [relation.from, points[0]!, points[1]!],
        [relation.to, points.at(-1)!, points.at(-2)!],
      ] as const) {
        const box = placed.classes.find(cls => cls.id === id)!
        const outward =
          (Math.abs(endpoint.x - box.x) < 1e-7 && next.y === endpoint.y && next.x < endpoint.x) ||
          (Math.abs(endpoint.x - box.x - box.width) < 1e-7 && next.y === endpoint.y && next.x > endpoint.x) ||
          (Math.abs(endpoint.y - box.y) < 1e-7 && next.x === endpoint.x && next.y < endpoint.y) ||
          (Math.abs(endpoint.y - box.y - box.height) < 1e-7 && next.x === endpoint.x && next.y > endpoint.y)
        expect(outward).toBe(true)
        expect(Math.abs(next.x - endpoint.x) + Math.abs(next.y - endpoint.y)).toBeGreaterThanOrEqual(8)
      }
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!
        expect(a.x === b.x || a.y === b.y).toBe(true)
        for (let j = i + 2; j < points.length; j++) {
          const c = points[j - 1]!,
            d = points[j]!
          const meets = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
          expect(meets).toBe(false)
        }
      }
    }
    const result = renderMermaidSVGWithReceipt(source, native)
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    expect(result.svg.match(/class="class-relationship"/g)).toHaveLength(5)
    for (const label of ['owns entry', 'translates request payload', 'sends a notification payload']) expect(result.svg).toContain(label)
  })

  test.each(['agentic','elk'] as const)('retains labelled nested fan contacts with %s when default owned escape rays are exhausted', backend => {
    const source = `classDiagram
direction BT
namespace Root {
  class \`ns:Domain\`["Card 37-0 WWWWWWWW 👩‍💻"] {
    +String value0
    +step0()
  }
  class \`class-namespace:Domain\`["Card 37-1 WW"] {
    +String value1
    +step1()
  }
  class \`__interface_0\`["Card 37-2 WWWWWWWW"] {
    +String value2
  }
  class \`C3\`["Card 37-3 WWWWWWWW 👩‍💻"] {
    +String value3
  }
  class \`C4\`["Card 37-4 "] {
    +String value4
  }
  class \`C5\`["Card 37-5 WWWW"] {
    +String value5
  }
  class \`C6\`["Card 37-6 WW 👩‍💻"] {
    +String value6
  }
  class \`C7\`["Card 37-7 W"] {
    +String value7
    +step7()
  }
  class \`C8\`["Card 37-8 WW"] {
    +String value8
  }
  namespace Domain {
    class \`C9\`["Card 37-9 WWWWW 👩‍💻"] {
      +String value9
    }
    class \`C10\`["Card 37-10 WWWWW"] {
      +String value10
      +step10()
    }
    class \`C11\`["Card 37-11 WWWWWWWWWWW"] {
      +String value11
    }
    class \`C12\`["Card 37-12 WWWWWWWWWWWW 👩‍💻"] {
      +String value12
      +step12()
    }
    class \`C13\`["Card 37-13 "] {
      +String value13
      +step13()
    }
    class \`C14\`["Card 37-14 WWWWWWWWWWW"] {
      +String value14
      +step14()
    }
    class \`C15\`["Card 37-15 WWWWWW 👩‍💻"] {
      +String value15
      +step15()
    }
    class \`C16\`["Card 37-16 WWWWW"] {
      +String value16
      +step16()
    }
    class \`C17\`["Card 37-17 WWWWWWWWWW"] {
      +String value17
      +step17()
    }
  }
}
\`ns:Domain\` --> \`class-namespace:Domain\`
\`ns:Domain\` <|-- \`__interface_0\`
\`ns:Domain\` ..|> \`C3\`
\`ns:Domain\` ..> \`C4\`
\`ns:Domain\` o-- \`C5\`
\`ns:Domain\` --> \`C6\` : edge 5 xxxxxxxxxxxxxxxxxxxxxxxx
\`ns:Domain\` ..> \`C7\`
\`ns:Domain\` -- \`C8\`
\`ns:Domain\` --> \`C9\` : edge 8 xxxxxxxxxxxxxxxxxxxxx
\`ns:Domain\` o-- \`C10\`
\`ns:Domain\` ..> \`C11\` : edge 10 xxxxxxxxxxxxxxxxxxx
\`ns:Domain\` ..> \`C12\` : edge 11 xxxxxxxxxxxxxxxxxxxx
\`ns:Domain\` *-- \`C13\` : edge 12 xxxxxxxxxx
\`ns:Domain\` o-- \`C14\` : edge 13 xxxxx
\`ns:Domain\` *-- \`C15\` : edge 14 xxxxxxxxx
\`ns:Domain\` *-- \`C16\` : edge 15 xxxxxxxxxxxxxxxxxxx
\`ns:Domain\` ..|> \`C17\`
\`class-namespace:Domain\` -- \`C17\` : edge 17 xxxxxxxxxxxxxxxxxxxxxxxx
\`__interface_0\` --> \`C17\` : edge 18 xxxxxx
\`C3\` <|-- \`C17\`
\`C4\` --> \`C17\`
\`C5\` ..|> \`C17\` : edge 21 xxxxxxxxxxxxxxxxx
\`C6\` ..|> \`C17\`
\`C7\` <|-- \`C17\` : edge 23 xxxxxx
\`C8\` <|-- \`C17\` : edge 24 x
\`C9\` --> \`C17\` : edge 25 xxxxxxxxxxxxxxxxxxxx
\`C10\` <|-- \`C17\`
\`C11\` ..> \`C17\` : edge 27 xxxxxxxxxxxxxxxxxxxxxx
\`C12\` <|-- \`C17\` : edge 28 xxxxxxxxxxxxxxxxx
\`C13\` ..|> \`C17\`
\`C14\` <|-- \`C17\` : edge 30 xxx
\`C15\` ..> \`C17\` : edge 31 xxxxxxxxxxxxxxxxx
\`C16\` --> \`C17\`
\`class-namespace:Domain\` <|-- \`ns:Domain\`
note for \`ns:Domain\` "owned note 37<br/>second line"
note "free note 37"
`
    const options = { graphLayout: { backend, fallback: 'none' as const } }
    const model = parseClassDiagram(toMermaidLines(source)),
      original = structuredClone(model)
    const placed = layoutClassDiagram(model, options)
    expect(model).toEqual(original)
    expect(layoutClassDiagram(model, options)).toEqual(placed)
    expect(placed.relationships.map(rel => [rel.from, rel.to, rel.label])).toEqual(model.relationships.map(rel => [rel.from, rel.to, rel.label]))
    const rendered = renderMermaidSVGWithReceipt(source, options)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: backend, role: 'primary' })])
    const boxes = new Map<string, { x: number; y: number; width: number; height: number }>()
    const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1]!, match[2]!]))
    for (const match of rendered.svg.matchAll(/<g\b[^>]*class="class-node"[^>]*>\s*(<rect\b[^>]*>)/g)) {
      const parent = attributes(match[0]!.slice(0, match[0]!.indexOf('>') + 1)),
        box = attributes(match[1]!)
      boxes.set(parent['data-id']!, { x: Number(box.x), y: Number(box.y), width: Number(box.width), height: Number(box.height) })
    }
    const shafts = [...rendered.svg.matchAll(/<polyline\b[^>]*class="class-relationship"[^>]*>/g)]
    expect(shafts).toHaveLength(model.relationships.length)
    for (const match of shafts) {
      const shaft = attributes(match[0]),
        points = shaft.points!.split(/\s+/).map(pair => pair.split(',').map(Number))
      for (const [id, endpoint, next] of [
        [shaft['data-from']!, points[0]!, points[1]!],
        [shaft['data-to']!, points.at(-1)!, points.at(-2)!],
      ] as const) {
        const box = boxes.get(id)!,
          [x, y] = endpoint,
          [nx, ny] = next
        expect(box).toBeDefined()
        expect(x!).toBeGreaterThanOrEqual(box.x - 1e-7)
        expect(x!).toBeLessThanOrEqual(box.x + box.width + 1e-7)
        expect(y!).toBeGreaterThanOrEqual(box.y - 1e-7)
        expect(y!).toBeLessThanOrEqual(box.y + box.height + 1e-7)
        expect((Math.abs(x! - box.x) < 1e-7 && ny === y && nx! < x!) || (Math.abs(x! - box.x - box.width) < 1e-7 && ny === y && nx! > x!) || (Math.abs(y! - box.y) < 1e-7 && nx === x && ny! < y!) || (Math.abs(y! - box.y - box.height) < 1e-7 && nx === x && ny! > y!)).toBe(true)
        expect(Math.abs(nx! - x!) + Math.abs(ny! - y!)).toBeGreaterThanOrEqual(8)
      }
    }
    for (const label of ['edge 24 x', 'owned note 37', 'free note 37']) expect(rendered.svg).toContain(label)
  })

  test.each(['default', 'elk', 'agentic'] as const)('retains authored empty namespace frames with %s', backend => {
    const source = 'classDiagram\nnamespace Outer["Outer empty label"] {\nnamespace Inner["Inner empty label"] {\nnamespace Leaf["Leaf empty label"] {\n}\n}\n}\nnamespace Empty["Standalone empty label"] {\n}\nnote "Empty frame note"'
    for (const hierarchicalNamespaces of [true, false]) {
      const options = { ...(backend === 'default' ? {} : { graphLayout: { backend } }), class: { hierarchicalNamespaces } }
      const placed = layoutClassDiagram(parseClassDiagram(toMermaidLines(source)), options)
      expect(placed.classes).toEqual([])
      expect(placed.namespaces.map(ns => [ns.id, ns.parentId, ns.label, ns.classIds])).toEqual([
        ['Outer', undefined, 'Outer empty label', []],
        ['Outer.Inner', hierarchicalNamespaces ? 'Outer' : undefined, 'Inner empty label', []],
        ['Outer.Inner.Leaf', hierarchicalNamespaces ? 'Outer.Inner' : undefined, 'Leaf empty label', []],
        ['Empty', undefined, 'Standalone empty label', []],
      ])
      for (const frame of placed.namespaces) {
        expect(frame.width).toBeGreaterThan(0)
        expect(frame.height).toBeGreaterThanOrEqual(frame.headerHeight)
      }
      if (hierarchicalNamespaces)
        for (const inner of placed.namespaces.filter(frame => frame.parentId !== undefined)) {
          const outer = placed.namespaces.find(frame => frame.id === inner.parentId)!
          expect(inner!.x).toBeGreaterThanOrEqual(outer!.x)
          expect(inner!.y).toBeGreaterThanOrEqual(outer!.y + outer!.headerHeight)
          expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width)
          expect(inner!.y + inner!.height).toBeLessThanOrEqual(outer!.y + outer!.height)
        }
      const result = renderMermaidSVGWithReceipt(source, options)
      expect(result.receipt.layoutCertification?.status).toBe('passed')
      expect(result.svg.match(/class="namespace"/g)).toHaveLength(4)
      expect(result.svg).not.toContain('class="class-node"')
      for (const label of ['Outer empty label', 'Inner empty label', 'Leaf empty label', 'Standalone empty label', 'Empty frame note']) expect(result.svg).toContain(label)
      if (backend === 'default' && hierarchicalNamespaces)
        for (const useAscii of [true, false]) {
          const terminal = renderMermaidASCII(`---\ntitle: Empty namespace title\n---\n${source}`, { useAscii })
          expect(terminal).toContain('Empty namespace title')
          for (const label of ['Outer empty label', 'Inner empty label', 'Leaf empty label', 'Standalone empty label', 'Empty frame note']) expect(terminal).toContain(label)
        }
      const publicLayout = layoutMermaidWithReceipt(source, options).layout
      expect(publicLayout.nodes).toEqual([])
      expect(publicLayout.groups.map(group => [group.id, group.parentId, group.members])).toEqual([
        ['Outer', undefined, []],
        ['Outer.Inner', hierarchicalNamespaces ? 'Outer' : undefined, []],
        ['Outer.Inner.Leaf', hierarchicalNamespaces ? 'Outer.Inner' : undefined, []],
        ['Empty', undefined, []],
      ])
    }
  })

  test('emits freestanding notes without class cards across source, typed and terminal surfaces', () => {
    const source = 'classDiagram\nnote "First standalone note"\nnote "Second standalone note"'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('notes-only Class must parse')
    for (const backend of ['elk', 'agentic'] as const) {
      const options = { graphLayout: { backend } }
      const placed = layoutClassDiagram(parseClassDiagram(toMermaidLines(source)), options)
      expect(placed.classes).toEqual([])
      expect(placed.namespaces).toEqual([])
      expect(placed.notes.map(note => note.text)).toEqual(['First standalone note', 'Second standalone note'])
      const result = renderMermaidSVGWithReceipt(source, options)
      expect(result.receipt.layoutCertification?.status).toBe('passed')
      expect(renderMermaidSVGWithReceipt(parsed.value, options).svg).toBe(result.svg)
      expect(result.svg).not.toContain('class="class-node"')
      for (const label of ['First standalone note', 'Second standalone note']) expect(result.svg).toContain(label)
    }
    for (const useAscii of [true, false]) {
      const terminal = renderMermaidASCII(source, { useAscii })
      for (const label of ['First standalone note', 'Second standalone note']) expect(terminal).toContain(label)
      expect(renderMermaidASCII('classDiagram', { useAscii })).toBe('')
    }
  })
})

import { classCarrierEntersMarker, classMarkerEntersBox, classMarkerHeaderInsets, classNewMiterEntersMarker, classSegmentEntersBox, repairClassHeaderRoutes, repairClassNoteSeats } from '../class/owned-surfaces.ts'
import { classMarkerPieces } from '../class/relationship-paint.ts'
import * as elk from '../elk-instance.ts'
import { diagramTitleBand, resolveRenderStyle } from '../styles.ts'

describe('complete Class owned surfaces', () => {
  const inside = (a: any, b: any, r: any) => (a.x === b.x ? a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height : a.y === b.y ? a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width : false)
  function fixed(graph: any, kind: string) {
    const children = graph.children.map((c: any) => ({ ...c })),
      g = children.find((c: any) => c.children),
      byId = new Map<string, any>(children.map((c: any) => [c.id, c]))
    let points: any[]
    if (kind === 'note') {
      for (const [id, x] of [
        ['S', 40],
        ['T', 500],
        ['U', 644],
      ] as const)
        Object.assign(byId.get(id), { x, y: 100 })
      const s: any = byId.get('S'),
        t: any = byId.get('T')
      points = [
        { x: s.x + s.width, y: s.y + s.height / 2 },
        { x: t.x, y: t.y + t.height / 2 },
      ]
    } else if (kind === 'horizontal') {
      Object.assign(g, { x: 240, y: 40, width: 280, height: 240 })
      g.children = g.children.map((c: any) => ({ ...c, x: 60, y: 80 }))
      const a: any = byId.get('A'),
        b: any = byId.get('B')
      Object.assign(a, { x: 40, y: 40 })
      Object.assign(b, { x: 640, y: 40 })
      points = [
        { x: a.x + a.width, y: a.y + a.height / 2 },
        { x: b.x, y: b.y + b.height / 2 },
      ]
    } else {
      Object.assign(g, { x: 40, y: 40, width: 300, height: 240 })
      const top = kind === 'marker' ? Number(/top=([\d.]+)/.exec(g.layoutOptions['elk.padding'])![1]) : 80
      g.children = g.children.map((c: any) => ({ ...c, x: 100, y: top }))
      const a = g.children[0],
        b: any = byId.get('B')
      Object.assign(b, { x: 500, y: 40 })
      const start = { x: 40 + a.x + a.width / 2, y: 40 + a.y }
      points = kind === 'marker' ? [start, { x: start.x, y: 69 }, { x: 480, y: 69 }, { x: 480, y: 140 }, { x: b.x + b.width / 2, y: 140 }, { x: b.x + b.width / 2, y: b.y + b.height }] : [start, { x: start.x, y: 20 }, { x: b.x + b.width / 2, y: 20 }, { x: b.x + b.width / 2, y: b.y }]
    }
    return { ...graph, width: 850, height: 320, children, edges: graph.edges.map((e: any) => ({ ...e, sections: [{ id: 'section', startPoint: points[0], bendPoints: points.slice(1, -1), endPoint: points.at(-1) }] })) }
  }
  for (const kind of ['note', 'vertical', 'horizontal', 'marker'])
    test(`complete Class owned surfaces: ${kind}`, () => {
      const source =
        kind === 'note'
          ? 'classDiagram\ndirection LR\nclass S\nclass T\nclass U\nS --> T\nnote for T "owned note"'
          : kind === 'horizontal'
            ? 'classDiagram\ndirection LR\nnamespace G {\nclass C\n}\nclass A\nclass B\nA --> B'
            : `classDiagram\ndirection BT\nnamespace G {\nclass A\n}\nclass B\nA ${kind === 'marker' ? '<|--' : '-->'} B`
      const model = parseClassDiagram(toMermaidLines(source)),
        before = structuredClone(model),
        calls: any[] = []
      const spy = spyOn(elk, 'elkLayoutSync').mockImplementation((graph: any) => {
        calls.push(structuredClone(graph))
        return fixed(graph, kind)
      })
      try {
        const p = layoutClassDiagram(model, { graphLayout: { backend: 'elk', fallback: 'none' } })
        expect(model).toEqual(before)
        expect(p.relationships).toHaveLength(1)
        expect(p.relationships[0]!.from).toBe(kind === 'note' ? 'S' : 'A')
        expect(p.relationships[0]!.to).toBe(kind === 'note' ? 'T' : 'B')
        const points = p.relationships[0]!.points
        for (const h of p.namespaces) for (let i = 1; i < points.length; i++) expect(inside(points[i - 1], points[i], { ...h, height: h.headerHeight })).toBe(false)
        for (const note of p.notes) for (let i = 1; i < points.length; i++) expect(inside(points[i - 1], points[i], { x: note.x + 2, y: note.y + 2, width: note.width - 4, height: note.height - 4 })).toBe(false)
        if (kind === 'note') {
          expect(points).toEqual([
            { x: 160, y: 124.45 },
            { x: 500, y: 124.45 },
          ])
          expect(p.notes[0]!.for).toBe('T')
          expect(p.notes[0]!.targetX).toBeDefined()
        }
        if (kind === 'marker') {
          const a = p.classes.find((c: any) => c.id === 'A')!,
            g = p.namespaces[0]!
          // Actual triangle vertices extend12px along the outgoing normal, plus.75px stroke.
          expect(a.y - 12.75).toBeGreaterThanOrEqual(g.y + g.headerHeight)
          expect(calls.length).toBeLessThanOrEqual(3)
        }
      } finally {
        spy.mockRestore()
      }
    })
})

test.each(['A', 'C'])('a note for %s can clear marked faces and adjacent columns through a corner seat', targetId => {
  const classes = [
    { id: 'A', x: 40, y: 40 }, { id: 'B', x: 40, y: 148.9 },
    { id: 'C', x: 180, y: 40 }, { id: 'D', x: 180, y: 148.9 },
    { id: 'E', x: 320, y: 40 }, { id: 'F', x: 320, y: 148.9 },
  ].map(node => ({ ...node, label: node.id, width: 120, height: 48.9, headerHeight: 32.9, attrHeight: 8, methodHeight: 8, attributes: [], methods: [] }))
  const target = classes.find(node => node.id === targetId)!
  const diagram: import('../class/types.ts').PositionedClassDiagram = {
    width: 634, height: 240, classes, namespaces: [],
    relationships: [
      { from: 'A', to: 'B', type: 'inheritance', markerAt: 'both', points: [{ x: 100, y: 88.9 }, { x: 100, y: 148.9 }] },
      { from: 'C', to: 'D', type: 'composition', markerAt: 'both', points: [{ x: 240, y: 88.9 }, { x: 240, y: 148.9 }] },
      { from: 'E', to: 'F', type: 'dependency', markerAt: 'both', points: [{ x: 380, y: 88.9 }, { x: 380, y: 148.9 }] },
    ],
    notes: [{ for: targetId, text: 'base type', x: 504, y: 40, width: 90, height: 40, targetX: target.x + target.width, targetY: 64.45, noteX: 504, noteY: 60 }],
  }
  const relationships = structuredClone(diagram.relationships)
  repairClassNoteSeats(diagram, resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), 40)
  expect(diagram.relationships).toEqual(relationships)
  const note = diagram.notes[0]!
  expect([note.for, note.text]).toEqual([targetId, 'base type'])
  expect(note.targetY).toBe(target.y + target.height)
  expect(note.targetX!).toBeGreaterThan(target.x + 66)
  expect(note.targetX!).toBeLessThan(target.x + target.width)
  // The gap between the two marked columns is literal independent evidence:
  // left marker ink ends before x+66; the next marker begins after x+193.
  expect(note.x).toBeGreaterThan(target.x + 66)
  expect(note.x + note.width).toBeLessThan(target.x + 193)
  expect(note.y).toBeGreaterThan(88.9)
  expect(note.y + note.height).toBeLessThan(148.9)
  expect(note.noteX).toBeGreaterThanOrEqual(note.x + 2)
  expect(note.noteX).toBeLessThanOrEqual(note.x + note.width - 2)
  expect(note.noteY).toBe(note.y)
})

test('header detour cannot cross the preserved source prefix', () => {
  const points = [
      { x: 30, y: 55 },
      { x: 45, y: 55 },
      { x: 45, y: 30 },
      { x: 55, y: 30 },
      { x: 55, y: 70 },
    ],
    diagram: any = {
      width: 100,
      height: 100,
      classes: [
        { id: 'S', x: 20, y: 50, width: 10, height: 10 },
        { id: 'T', x: 50, y: 70, width: 10, height: 10 },
      ],
      namespaces: [{ id: 'G', x: 50, y: 50, width: 10, height: 40, headerHeight: 10, classIds: ['T'] }],
      notes: [],
      relationships: [{ from: 'S', to: 'T', type: 'link-solid', markerAt: 'none', points: structuredClone(points) }],
    }
  repairClassHeaderRoutes(diagram, resolveRenderStyle({}, CLASS_STYLE_DEFAULTS))
  const route = diagram.relationships[0].points
  expect(route.slice(0, 4)).toEqual(points.slice(0, 4))
  expect(route.at(-1)).toEqual({ x: 55, y: 70 })
  // Literal independent crossing witness: no later V may enter the unchanged
  // first H's strict interior(30,45) at y55. The old left detour crossed x42.
  expect(route.some((p: any, i: number) => i > 1 && p.x === route[i - 1].x && p.x > 30 && p.x < 45 && Math.min(p.y, route[i - 1].y) < 55 && Math.max(p.y, route[i - 1].y) > 55)).toBe(false)
})
test('canonical triangle empty AABB corner is clear, real fill/base stroke is occupied', () => {
  const descriptor: any = {
    id: 'triangle',
    shape: 'triangle',
    orient: 'auto',
    geometry: {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 12, y: 5 },
        { x: 0, y: 10 },
      ],
    },
    paint: { fill: '#fff', stroke: '#000', strokeWidth: '1.5' },
  }
  const pieces = classMarkerPieces(descriptor, { x: 0, y: 0 }, { x: 1, y: 0 }, 'end', 1)
  expect(classMarkerEntersBox(pieces, { x: 11, y: -28, width: 30, height: 29 })).toBe(false)
  expect(classMarkerEntersBox(pieces, { x: 1, y: 3, width: 1, height: 2 })).toBe(true)
  expect(classMarkerEntersBox(pieces, { x: -0.5, y: 3, width: 0.25, height: 2 })).toBe(true)
})
test('serialized rectangle faces use exact decimal equality, not a clearance epsilon', () => {
  const box = { x: 398.529, y: 100, width: 135.33, height: 50 }
  expect(classSegmentEntersBox({ x: 533.859, y: 110 }, { x: 540, y: 110 }, box)).toBe(false)
  expect(classSegmentEntersBox({ x: 533.8589, y: 110 }, { x: 533.8589, y: 120 }, box)).toBe(true)
  expect(classSegmentEntersBox({ x: 533.859, y: 110 }, { x: 533.859, y: 120 }, box)).toBe(false)
})

test('new orthogonal miter ink includes the corner outside both butt strips', async () => {
  const pieces: any = [
      {
        kind: 'polygon',
        points: [
          { x: 10.2, y: -0.3 },
          { x: 10.3, y: -0.3 },
          { x: 10.3, y: -0.2 },
          { x: 10.2, y: -0.2 },
        ],
      },
    ],
    route = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]
  expect(classCarrierEntersMarker(route[0]!, route[1]!, pieces, 1)).toBe(false)
  expect(classCarrierEntersMarker(route[1]!, route[2]!, pieces, 1)).toBe(false)
  expect(classNewMiterEntersMarker(route, [], pieces, 1)).toBe(true)
  expect(classNewMiterEntersMarker(route, route, pieces, 1)).toBe(false)
})

test('rounded header detour cannot cut through a foreign card and uses the opposite lane', async () => {
  const { projectRoundedConnectorPath } = await import('../scene/connector-geometry.ts')
  const diagram: any = {
    width: 300,
    height: 450,
    classes: [
      { id: 'S', x: 90, y: 80, width: 20, height: 20 },
      { id: 'T', x: 90, y: 360, width: 20, height: 20 },
      { id: 'foreign', x: 90, y: 235, width: 5, height: 5 },
    ],
    namespaces: [{ id: 'G', x: 50, y: 250, width: 100, height: 100, headerHeight: 60, classIds: [] }],
    notes: [],
    relationships: [
      {
        from: 'S',
        to: 'T',
        type: 'link-solid',
        markerAt: 'none',
        points: [
          { x: 100, y: 100 },
          { x: 100, y: 360 },
        ],
      },
    ],
  }
  // Old left Q: start(100,221), control(100,246), end(75,246).
  // Its Bernstein midpoint(93.75,239.75) is strictly inside foreign.
  expect(93.75 > 90 && 93.75 < 95 && 239.75 > 235 && 239.75 < 240).toBe(true)
  const style = resolveRenderStyle({ styleFace: { edge: { bendRadius: 25 } } }, CLASS_STYLE_DEFAULTS)
  repairClassHeaderRoutes(diagram, style)
  const route = diagram.relationships[0].points,
    projection = projectRoundedConnectorPath(route, 25, { metric: 'manhattan' })
  const d = (projection.geometry as any).d
  let start: any
  for (const m of d.matchAll(/([MLQ])([^MLQ]+)/g)) {
    const v = m[2]!.trim().split(/[ ,]+/).map(Number)
    if (m[1] === 'Q') {
      const point = { x: (start.x + 2 * v[0]! + v[2]!) / 4, y: (start.y + 2 * v[1]! + v[3]!) / 4 }
      expect(point.x > 90 && point.x < 95 && point.y > 235 && point.y < 240).toBe(false)
      start = { x: v[2], y: v[3] }
    } else start = { x: v[0], y: v[1] }
  }
  expect(route.some((p: any) => p.x > 150)).toBe(true)
  expect(route[0]).toEqual({ x: 100, y: 100 })
  expect(route.at(-1)).toEqual({ x: 100, y: 360 })
})

test.each(['elk', 'agentic'] as const)('retains a proved note seat outside obstructed columns with %s', backend => {
  const source = 'classDiagram\nAnimal <|--|> Zebra\nWhole *--o Part\nCaller <..> Callee\nSearchable ()-- Index\nnote for Animal "base type"\nclick Animal href "https://example.com/animal"'
  const model = parseClassDiagram(toMermaidLines(source))
  if (backend === 'agentic') model.title = 'Owned note title'
  const before = structuredClone(model),
    options = { graphLayout: { backend, fallback: 'none' as const }, embedFontImport: false }
  const placed = layoutClassDiagram(model, options),
    retained = structuredClone(placed)
  expect(layoutClassDiagram(model, options)).toEqual(retained)
  expect(placed).toEqual(retained)
  expect(model).toEqual(before)
  expect(placed.classes.map(node => [node.id, node.label, node.href, node.isInterface])).toEqual(model.classes.map(node => [node.id, node.label, node.href, node.isInterface || undefined]))
  expect(placed.relationships.map(rel => [rel.from, rel.to, rel.type, rel.fromType, rel.toType, rel.markerAt])).toEqual(model.relationships.map(rel => [rel.from, rel.to, rel.type, rel.fromType, rel.toType, rel.markerAt]))
  const note = placed.notes[0]!
  expect([note.for, note.text]).toEqual(['Animal', 'base type'])
  expect([note.targetX, note.targetY, note.noteX, note.noteY].every(Number.isFinite)).toBe(true)
  const a = { x: note.targetX!, y: note.targetY! },
    b = { x: note.noteX!, y: note.noteY! }
  const crosses = (box: { x: number; y: number; width: number; height: number }): boolean => {
    let low = 0,
      high = 1
    for (const [origin, delta, lo, hi] of [
      [a.x, b.x - a.x, box.x, box.x + box.width],
      [a.y, b.y - a.y, box.y, box.y + box.height],
    ]) {
      if (delta === 0) {
        if (origin! <= lo! || origin! >= hi!) return false
      } else {
        const first = (lo! - origin!) / delta!,
          last = (hi! - origin!) / delta!
        low = Math.max(low, Math.min(first, last))
        high = Math.min(high, Math.max(first, last))
      }
    }
    return low < high
  }
  for (const node of placed.classes) {
    expect(note.x < node.x + node.width && note.x + note.width > node.x && note.y < node.y + node.height && note.y + note.height > node.y, `note clears ${node.id}, including the lollipop label allocation`).toBe(false)
    expect(crosses(node), `annotation connector clears ${node.id}`).toBe(false)
  }
  for (const rel of placed.relationships)
    for (let i = 1; i < rel.points.length; i++) {
      const a = rel.points[i - 1]!,
        b = rel.points[i]!
      const hit =
        a.x === b.x ? a.x > note.x + 2 && a.x < note.x + note.width - 2 && Math.max(a.y, b.y) > note.y + 2 && Math.min(a.y, b.y) < note.y + note.height - 2 : a.y === b.y ? a.y > note.y + 2 && a.y < note.y + note.height - 2 && Math.max(a.x, b.x) > note.x + 2 && Math.min(a.x, b.x) < note.x + note.width - 2 : false
      expect(hit, 'actual relationship clears filled note core').toBe(false)
    }
  if (model.title) expect(placed.title?.x).toBe(placed.width / 2)
  const renderSource = model.title ? `---\ntitle: ${model.title}\n---\n${source}` : source
  const rendered = renderMermaidSVGWithReceipt(renderSource, options),
    repeated = renderMermaidSVGWithReceipt(renderSource, options)
  expect(repeated.svg).toBe(rendered.svg)
  expect(repeated.receipt.graphicalProjectionDigest).toBe(rendered.receipt.graphicalProjectionDigest)
  expect(rendered.receipt.layoutCertification?.status, JSON.stringify(rendered.receipt.layoutCertification)).toBe('passed')
  for (const text of ['Animal', 'Zebra', 'Whole', 'Part', 'Caller', 'Callee', 'Searchable', 'Index', 'base type']) expect(rendered.svg).toContain(text)
  expect(rendered.svg).toContain('marker-start=')
  expect(rendered.svg).toContain('marker-end=')
})

import * as classMarkerAdmission from '../class/marker-admission.ts'
import * as nativeClassProducer from '../layout/agentic-layered.ts'
import { LayoutCertificationError, withGraphLayoutDecisionObserver } from '../layout/backend.ts'
import { resolveRenderRequest } from '../render-contract.ts'

describe('Class marker meaning before producer selection', () => {
  const modelSource = 'classDiagram\nclass S\nclass T\nS o-- T\nS <|-- T'
  const paths = (separation: number) => [
    [
      { x: 200, y: 120 },
      { x: 180, y: 120 },
      { x: 180, y: 80 },
      { x: 580, y: 80 },
      { x: 580, y: 120 },
      { x: 600, y: 120 },
    ],
    [
      { x: 200, y: 120 + separation },
      { x: 170, y: 120 + separation },
      { x: 170, y: 60 },
      { x: 560, y: 60 },
      { x: 560, y: 130 },
      { x: 600, y: 130 },
    ],
  ]
  function controlled(separation: number, elkSeparation = separation) {
    let nativeCalls = 0,
      elkCalls = 0
    const native = spyOn(nativeClassProducer, 'layoutAgenticGraph').mockImplementation((_graph: any): any => {
      nativeCalls++
      return {
        width: 900,
        height: 300,
        nodes: [
          { x: 200, y: 100 },
          { x: 600, y: 100 },
        ],
        groups: [],
        edges: paths(separation).map(points => ({ points })),
      }
    })
    const stock = spyOn(elk, 'elkLayoutSync').mockImplementation((graph: any): any => {
      elkCalls++
      const routes = paths(elkSeparation)
      return {
        ...graph,
        width: 900,
        height: 300,
        children: graph.children.map((child: any, index: number) => ({ ...child, x: index ? 600 : 200, y: 100 })),
        edges: graph.edges.map((edge: any, index: number) => ({ ...edge, sections: [{ id: 'section', startPoint: routes[index]![0], bendPoints: routes[index]!.slice(1, -1), endPoint: routes[index]!.at(-1) }] })),
      }
    })
    return {
      native,
      stock,
      counts: () => ({ nativeCalls, elkCalls }),
      restore: () => {
        native.mockRestore()
        stock.mockRestore()
      },
    }
  }
  test.each(['agentic', 'elk'] as const)('rejects real later-fill marker loss in %s before recording selected', backend => {
    const producer = controlled(3.865),
      decisions: unknown[] = []
    try {
      // Earlier aggregation's lower-left stroke midpoint is(191,122.5).
      // All three independent half-plane distances place it in the later
      // triangle's opaque fill, beyond its own .75px outline.
      const triangle = [
          { x: 188, y: 118.865 },
          { x: 200, y: 123.865 },
          { x: 188, y: 128.865 },
        ],
        witness = { x: 191, y: 122.5 }
      for (let i = 0; i < triangle.length; i++) {
        const a = triangle[i]!,
          b = triangle[(i + 1) % triangle.length]!,
          dx = b.x - a.x,
          dy = b.y - a.y
        expect((dx * (witness.y - a.y) - dy * (witness.x - a.x)) / Math.hypot(dx, dy)).toBeGreaterThan(0.75)
      }
      expect(() =>
        withGraphLayoutDecisionObserver(
          d => decisions.push(d),
          () => layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource)), { graphLayout: { backend, fallback: 'none' } }),
        ),
      ).toThrow(LayoutCertificationError)
      expect(decisions).toEqual([])
      expect(producer.counts()).toEqual({ nativeCalls: backend === 'agentic' ? 1 : 0, elkCalls: backend === 'elk' ? 1 : 0 })
    } finally {
      producer.restore()
    }
  })
  test.each(['agentic', 'elk'] as const)('does not exempt distinct glyph meanings merely because anchors coincide in %s', backend => {
    const producer = controlled(0)
    try {
      expect(() => layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource)), { graphLayout: { backend, fallback: 'none' } })).toThrow(LayoutCertificationError)
    } finally {
      producer.restore()
    }
  })
  test.each(['agentic', 'elk'] as const)('retains separated marker ink but refuses shared positive carrier stems in %s', async backend => {
    const separated = controlled(20)
    try {
      expect(layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource)), { graphLayout: { backend, fallback: 'none' } }).relationships).toHaveLength(2)
    } finally {
      separated.restore()
    }
    const shared = controlled(0)
    try {
      const identical = parseClassDiagram(toMermaidLines(modelSource.replace('o--', '<|--')))
      // Identical coincident marker repaint is sound in the marker-only proof.
      // These controlled branches ALSO share a positive carrier stem; that
      // unrelated scaffold is not an admission exception for the whole output.
      const { resolveDiagramColors } = await import('../color-resolver.ts')
      const style = resolveRenderStyle({}, CLASS_STYLE_DEFAULTS)
      expect(() => classMarkerAdmission.assertClassMarkerMeaning({ width: 900, height: 300, classes: [], notes: [], namespaces: [], relationships: identical.relationships.map((rel, i) => ({ ...rel, points: paths(0)[i]! })) }, style, resolveDiagramColors({}, {}))).not.toThrow()
      expect(() => layoutClassDiagram(identical, { graphLayout: { backend, fallback: 'none' } })).toThrow('uncertified shared contact')
    } finally {
      shared.restore()
    }
  })
  test('uses effective transparent and unknown palette paint without inventing opaque fill', () => {
    const producer = controlled(3.865)
    try {
      for (const bg of ['transparent', 'rgba(255,255,255,0.5)']) {
        const request = resolveRenderRequest(modelSource, { graphLayout: { backend: 'agentic', fallback: 'none' }, style: { colors: { bg } } })
        expect(request.renderOptions.bg).toBe(bg)
        expect(layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource)), request.renderOptions, request.appearance.face).relationships).toHaveLength(2)
      }
      // Direct unpainted callers can carry unresolved paint. It is not an
      // opaque-cover proof, nor a claim this token is public Style input.
      expect(layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource)), { graphLayout: { backend: 'agentic', fallback: 'none' }, bg: 'var(--unknown-background)' }).relationships).toHaveLength(2)
    } finally {
      producer.restore()
    }
  })
  test('retains canonical first-party marker authority and leaves unknown custom paint uncertain', () => {
    const producer = controlled(3.865)
    try {
      for (const backend of ['backend:default', 'backend:rough', 'backend:hybrid']) expect(() => layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource)), { graphLayout: { backend: 'agentic', fallback: 'none' } }, undefined, backend)).toThrow(LayoutCertificationError)
      expect(layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource)), { graphLayout: { backend: 'agentic', fallback: 'none' } }, undefined, 'backend:unknown-host').relationships).toHaveLength(2)
    } finally {
      producer.restore()
    }
  })
  test('typed marker rejection belongs to requested Native→ELK fallback and palette is resolved once', () => {
    const producer = controlled(3.865, 20),
      decisions: any[] = [],
      proofCalls: { ledger: classMarkerAdmission.ClassMarkerAdmissionWork; before: number; after: number }[] = []
    const originalAdmission = classMarkerAdmission.assertClassMarkerMeaning,
      proof = spyOn(classMarkerAdmission, 'assertClassMarkerMeaning').mockImplementation((diagram, style, colors, ledger) => {
        const call = { ledger: ledger!, before: ledger!.operations, after: ledger!.operations }
        proofCalls.push(call)
        try {
          return originalAdmission(diagram, style, colors, ledger)
        } finally {
          call.after = ledger!.operations
        }
      })
    let paletteReads = 0
    const options = {
      graphLayout: { backend: 'agentic' as const, fallback: 'elk' as const },
      get bg() {
        paletteReads++
        return '#FFFFFF'
      },
    }
    try {
      const result = withGraphLayoutDecisionObserver(
        d => decisions.push(d),
        () => layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource)), options),
      )
      expect(result.relationships).toHaveLength(2)
      expect(producer.counts()).toEqual({ nativeCalls: 1, elkCalls: 1 })
      expect(decisions).toHaveLength(1)
      expect(decisions[0].selected).toBe('elk')
      expect(decisions[0].attempts.map((attempt: any) => [attempt.backend, attempt.outcome])).toEqual([
        ['agentic', 'candidate-rejected'],
        ['elk', 'selected'],
      ])
      expect(paletteReads).toBe(1)
      expect(proofCalls).toHaveLength(2)
      expect(proofCalls[0]!.ledger).toBe(proofCalls[1]!.ledger)
      expect(proofCalls[0]!.after).toBeGreaterThan(proofCalls[0]!.before)
      // ELK's measured face reservation also debits this request ledger before its final ink proof.
      expect(proofCalls[1]!.before).toBeGreaterThan(proofCalls[0]!.after)
      expect(proofCalls[1]!.after).toBeGreaterThan(proofCalls[1]!.before)
    } finally {
      proof.mockRestore()
      producer.restore()
    }
  })
})

import { classElkMarkerMinimums, classNativeMarkerMinimums } from '../class/marker-port-capacity.ts'
import type { PositionedClassDiagram, PositionedClassRelationship } from '../class/types.ts'

describe('Native Class premeasured marker capacity',()=>{
  const cards=[{id:'A'},{id:'B'},{id:'I',isInterface:true}]
  const rels=[{from:'A',to:'B'},{from:'A',to:'A'},{from:'I',to:'B'}]
  const templates=[{start:[{kind:'polygon' as const,points:[{x:0,y:-2},{x:6,y:0},{x:0,y:3}]}]},{},{start:[{kind:'circle' as const,cx:0,cy:0,r:100}]}]
  test.each([1,2])('counts all roles and both loop ends with actual stroke %s before one placement',width=>{
    const before=structuredClone({cards,rels,templates}),work=classMarkerAdmission.createClassMarkerAdmissionWork()
    const minima=classNativeMarkerMinimums(cards,rels,templates,width,'LR',work)
    // Three A incidences, including both loop ends. Literal template occupies
    // [-2,3]; adding one shaft width gives pitch6 (or7), four uniform gaps.
    expect(minima.get('A')).toEqual({width:0,height:width===1?24:28,portSpacing:width===1?6:7})
    expect(minima.has('B')).toBe(false);expect(minima.has('I')).toBe(false)
    expect({cards,rels,templates}).toEqual(before)
    expect(work.operations).toBeGreaterThan(0);expect(work.exhausted).toBe(false)
  })
  test.each(['TB','BT','LR','RL'] as const)('reserves only the actual primary-face cross dimension for %s',direction=>{
    const minimum=classNativeMarkerMinimums(cards,rels,templates,1,direction,classMarkerAdmission.createClassMarkerAdmissionWork()).get('A')!
    expect(minimum).toEqual({width:direction==='LR'||direction==='RL'?0:24,height:direction==='LR'||direction==='RL'?24:0,portSpacing:6})
  })
  test('never resets spent shared admission work or grows a markerless card',()=>{
    const work=classMarkerAdmission.createClassMarkerAdmissionWork();work.exhausted=true
    expect(()=>classNativeMarkerMinimums(cards,rels,templates,1,'TB',work)).toThrow()
    expect(work.exhausted).toBe(true)
    expect(classNativeMarkerMinimums(cards,rels,[{},{},{}],1,'TB',classMarkerAdmission.createClassMarkerAdmissionWork()).size).toBe(0)
  })
})

describe('ELK Class measured marker face capacity', () => {
  const card = (id: string, x: number, y: number, height: number) => ({ id, label: id, attributes: [], methods: [], x, y, width: 120, height, headerHeight: 32.9, attrHeight: 8, methodHeight: height - 40.9 })
  const relation = (y: number, marked: boolean): PositionedClassRelationship => ({
    from: 'ns:Domain',
    to: 'T',
    type: marked ? 'aggregation' : 'link-solid',
    markerAt: marked ? 'from' : 'none',
    lineStyle: 'solid',
    points: [
      { x: 220, y },
      { x: 500, y },
    ],
  })
  const placed = (height: number, relationships: PositionedClassRelationship[]): PositionedClassDiagram => ({ width: 800, height: 600, namespaces: [], notes: [], classes: [card('ns:Domain', 100, 100, height), card('T', 500, 0, 400)], relationships })
  test('reserves real authored-card ink and all self-loop endpoint incidences without mutating the placement', () => {
    const p = placed(48.9, [relation(110, true), relation(120, true), relation(130, false), relation(135, false)]),
      style = resolveRenderStyle({}, CLASS_STYLE_DEFAULTS),
      before = structuredClone(p),
      work = classMarkerAdmission.createClassMarkerAdmissionWork(),
      first = classElkMarkerMinimums(p, style, work)
    expect(first.get('ns:Domain')!.height).toBeGreaterThan(p.classes[0]!.height)
    expect(first.has('T')).toBe(false)
    expect(p).toEqual(before)
    p.relationships.push({
      from: 'ns:Domain',
      to: 'ns:Domain',
      type: 'link-solid',
      markerAt: 'none',
      lineStyle: 'solid',
      points: [
        { x: 220, y: 140 },
        { x: 260, y: 140 },
        { x: 260, y: 145 },
        { x: 220, y: 145 },
      ],
    })
    const second = classElkMarkerMinimums(p, style, work)
    expect(second.get('ns:Domain')!.height).toBeGreaterThan(first.get('ns:Domain')!.height)
    expect(work.operations).toBeGreaterThan(0)
    expect(work.exhausted).toBe(false)
  })
  test('retains a clear nonuniform mixed-marker face instead of imposing a common pitch', () => {
    const p = placed(60, [relation(110, true), relation(122, true), ...Array.from({ length: 8 }, (_, index) => relation(136 + 2 * index, false))]),
      before = structuredClone(p),
      work = classMarkerAdmission.createClassMarkerAdmissionWork()
    // Both diamond outlines fit within six pixels of their actual anchors;
    // the remaining half-pixel stems have disjoint, deliberately denser seats.
    expect(classElkMarkerMinimums(p, resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), work).size).toBe(0)
    expect(p).toEqual(before)
    expect(work.exhausted).toBe(false)
  })
})

test.each([{ name: 'Native', backend: 'agentic', hierarchicalNamespaces: true }, { name: 'ELK', backend: 'elk', hierarchicalNamespaces: false }] as const)('strict $name completes dense compound relationships with distinct visible markers', ({ backend, hierarchicalNamespaces }) => {
 const source = "---\ntitle: Class compact 33\n---\nclassDiagram\ndirection TB\nnamespace Root {\n  class `ns:Domain`[\"Card 33-0 WWW 👩‍💻\"] {\n    +String value0\n    +step0()\n  }\n  class `class-namespace:Domain`[\"Card 33-1 WWWWWWWWW\"] {\n    +String value1\n    +step1()\n  }\n  class `__interface_0`[\"Card 33-2 W\"] {\n    +String value2\n    +step2()\n  }\n  class `C3`[\"Card 33-3  👩‍💻\"] {\n    +String value3\n  }\n  class `C4`[\"Card 33-4 WWWW\"] {\n    +String value4\n    +step4()\n  }\n  class `C5`[\"Card 33-5 WWWWWWWWWWWW\"] {\n    +String value5\n  }\n  class `C6`[\"Card 33-6 WWWWWWWWWW 👩‍💻\"] {\n    +String value6\n    +step6()\n  }\n  class `C7`[\"Card 33-7 WWWWWWWWWWWW\"] {\n    +String value7\n  }\n  class `C8`[\"Card 33-8 \"] {\n    +String value8\n  }\n  class `C9`[\"Card 33-9 WWWWWWWWWW 👩‍💻\"] {\n    +String value9\n  }\n  class `C10`[\"Card 33-10 WWWWWWWWW\"] {\n    +String value10\n    +step10()\n  }\n  namespace Domain {\n    class `C11`[\"Card 33-11 WWW\"] {\n      +String value11\n    }\n    class `C12`[\"Card 33-12 WWWWWWWW 👩‍💻\"] {\n      +String value12\n    }\n    class `C13`[\"Card 33-13 \"] {\n      +String value13\n    }\n    class `C14`[\"Card 33-14 WWWWWWWWWWWW\"] {\n      +String value14\n      +step14()\n    }\n    class `C15`[\"Card 33-15 WWWWWWW 👩‍💻\"] {\n      +String value15\n      +step15()\n    }\n    class `C16`[\"Card 33-16 WWWWWWW\"] {\n      +String value16\n    }\n    class `C17`[\"Card 33-17 WWWWWWW\"] {\n      +String value17\n      +step17()\n    }\n    class `C18`[\"Card 33-18 WWWWWWW 👩‍💻\"] {\n      +String value18\n    }\n    class `C19`[\"Card 33-19 WWWWWWWWWWWW\"] {\n      +String value19\n    }\n    class `C20`[\"Card 33-20 WW\"] {\n      +String value20\n      +step20()\n    }\n    class `C21`[\"Card 33-21 WWWW 👩‍💻\"] {\n      +String value21\n    }\n    class `C22`[\"Card 33-22 WWWW\"] {\n      +String value22\n    }\n  }\n}\n`ns:Domain` \"1..*\" *-- `class-namespace:Domain` : edge 0 xxxxxxxx\n`ns:Domain` \"0..1\" ..> `__interface_0`\n`ns:Domain` \"1..*\" o-- `C3` : edge 2 xxxxxxxxxxxx\n`ns:Domain` \"1\" *-- `C4`\n`ns:Domain` \"1..*\" -- `C5` : edge 4 xxxxx\n`ns:Domain` \"1..*\" --> `C6`\n`ns:Domain` \"1\" <|-- `C7`\n`ns:Domain` \"0..1\" ..> `C8`\n`ns:Domain` \"*\" -- `C9` : edge 8 xxxxxxxxxxxx\n`ns:Domain` \"0..1\" *-- `C10`\n`ns:Domain` \"1\" --> `C11`\n`ns:Domain` \"0..1\" ..|> `C12`\n`ns:Domain` \"0..1\" --> `C13` : edge 12 xxxxxxxxxxxxxxx\n`ns:Domain` \"1\" ..|> `C14` : edge 13 x\n`ns:Domain` \"*\" ..|> `C15`\n`ns:Domain` \"1\" ..> `C16` : edge 15 xxxxxxxxxxxxxxxx\n`ns:Domain` \"0..1\" o-- `C17`\n`ns:Domain` \"*\" <|-- `C18`\n`ns:Domain` \"1\" *-- `C19` : edge 18 xxxxxxx\n`ns:Domain` \"0..1\" -- `C20`\n`ns:Domain` \"1\" ..|> `C21`\n`ns:Domain` \"*\" -- `C22`\n`class-namespace:Domain` \"0..1\" ..> `C22`\n`__interface_0` \"*\" ..|> `C22` : edge 23 xxxxxxxxxxxxxxxxxxxxxx\n`C3` \"*\" ..> `C22` : edge 24 \n`C4` \"1..*\" ..|> `C22` : edge 25 xxxxxxxxxxxxxxxxxxxx\n`C5` \"1..*\" -- `C22` : edge 26 xxxxxxxx\n`C6` \"1\" -- `C22` : edge 27 xxxxx\n`C7` \"0..1\" *-- `C22` : edge 28 xxxxxxxxxxxxxxxxxxxx\n`C8` \"*\" -- `C22`\n`C9` \"0..1\" ..> `C22` : edge 30 xxxx\n`C10` \"1\" ..> `C22` : edge 31 xxxxxxxxxxxxxxxxxxx\n`C11` \"1..*\" *-- `C22` : edge 32 xxxxxxxx\n`C12` \"0..1\" ..> `C22`\n`C13` \"1..*\" o-- `C22` : edge 34 xxxxxxxxxxxx\n`C14` \"1\" *-- `C22`\n`C15` \"1..*\" -- `C22` : edge 36 xxxxx\n`C16` \"1..*\" --> `C22`\n`C17` \"1\" <|-- `C22`\n`C18` \"0..1\" ..> `C22`\n`C19` \"*\" -- `C22` : edge 40 xxxxxxxxxxxx\n`C20` \"0..1\" *-- `C22`\n`C21` \"1\" --> `C22`\n`C22` \"0..1\" ..|> `C22`\nnote for `ns:Domain` \"owned note 33<br/>second line\"\nnote \"free note 33\"\n"
 const options = { ...(hierarchicalNamespaces ? { class: { hierarchicalNamespaces: true } } : {}), graphLayout: { backend, fallback: 'none' as const } }
 const model = parseClassDiagram(toMermaidLines(source.slice(source.indexOf('classDiagram')))), before = structuredClone(model)
 const positioned = layoutClassDiagram(model, options)
 expect(model).toEqual(before)
 const actualClasses = positioned.classes.map(c => [c.id,c.label,c.attributes,c.methods] as const), authoredClasses = model.classes.map(c => [c.id,c.label,c.attributes,c.methods] as const)
 if (backend === 'elk') {
   // ELK extracts nested classes in hierarchy traversal order. Compare every
   // authored payload by identity; Native keeps its original ordered check.
   expect(actualClasses.toSorted((a,b) => a[0].localeCompare(b[0]))).toEqual(authoredClasses.toSorted((a,b) => a[0].localeCompare(b[0])))
 } else expect(actualClasses).toEqual(authoredClasses)
 expect(positioned.relationships.map(r => [r.from,r.to,r.type,r.markerAt,r.fromCardinality,r.toCardinality,r.label])).toEqual(model.relationships.map(r => [r.from,r.to,r.type,r.markerAt,r.fromCardinality,r.toCardinality,r.label]))
 expect(positioned.classes).toHaveLength(23)
 expect(positioned.relationships).toHaveLength(44)
 expect(positioned.namespaces).toHaveLength(2)
 expect(positioned.notes).toHaveLength(2)
 const rendered = renderMermaidSVGWithReceipt(source,options)
 expect(rendered.receipt.layoutCertification?.status).toBe('passed')
 expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({selected:backend,role:'primary'})])
 expect(rendered.svg).toContain('owned note 33')
 expect(rendered.svg).toContain('free note 33')
})


describe('Class annotations preserve endpoint marker ink', () => {
  test.each(['from', 'to', 'caption', 'fallback caption'] as const)('seats %s text away from actual marker outlines and retains clear seats', role => {
    const card = (id: string, y: number) => ({ id, label: id, attributes: [], methods: [], x: 200, y, width: 120, height: 60, headerHeight: 40, attrHeight: 10, methodHeight: 10 })
    const reversed = role === 'to',
      caption = role === 'caption' || role === 'fallback caption'
    const points = (x: number) =>
      reversed
        ? [
            { x, y: 500 },
            { x, y: 260 },
          ]
        : [
            { x, y: 260 },
            { x, y: 500 },
          ]
    const text = role === 'fallback caption' ? { label: '0..1' } : role === 'caption' ? { label: '0..1', labelPosition: { x: 250, y: 278 } } : role === 'to' ? { toCardinality: '0..1', toCardinalityPosition: { x: 250, y: 270 } } : { fromCardinality: '0..1', fromCardinalityPosition: { x: 250, y: 270 } }
    const p: PositionedClassDiagram = {
      width: 600,
      height: 650,
      namespaces: [],
      notes: [],
      classes: [card('S', 200), card('T', 500)],
      relationships: [
        { from: reversed ? 'T' : 'S', to: reversed ? 'S' : 'T', type: 'inheritance', markerAt: reversed ? 'to' : 'from', points: points(240) },
        {
          from: reversed ? 'T' : 'S',
          to: reversed ? 'S' : 'T',
          type: 'link-solid',
          markerAt: 'none',
          points:
            role === 'fallback caption'
              ? [
                  { x: 260, y: 260 },
                  { x: 260, y: 278 },
                  { x: 250, y: 278 },
                  { x: 250, y: 500 },
                ]
              : points(260),
          ...text,
        },
        {
          from: 'S',
          to: 'T',
          type: 'link-solid',
          markerAt: 'none',
          points: [
            { x: 280, y: 260 },
            { x: 280, y: 500 },
          ],
          fromCardinality: '1',
          fromCardinalityPosition: { x: 300, y: 330 },
        },
      ],
    }
    const style = resolveRenderStyle({}, CLASS_STYLE_DEFAULTS),
      relation = p.relationships[1]!,
      block = classTextBlock('0..1', style, 'edge'),
      before = structuredClone(p),
      halfWidth = block.width / 2 + 1.5,
      halfHeight = block.height / 2 + 1.5
    // Literal inheritance edge: tip(240,260), base(235,272),(245,272).
    // Its right-edge midpoint is actual painted ink, not an AABB corner.
    const witness = { x: 242.5, y: 266 }
    expect(Math.abs(witness.x - 250)).toBeLessThan(halfWidth)
    expect(Math.abs(witness.y - 270)).toBeLessThan(halfHeight)
    finalizeClassOwnedSurfaces(p, style)
    const anchor = caption ? (relation.labelPosition ?? relation.points[Math.floor(relation.points.length / 2)]!) : role === 'to' ? relation.toCardinalityPosition! : relation.fromCardinalityPosition!
    const center = { x: anchor.x, y: anchor.y - (caption ? 8 : 0) }
    // Independently test the WHOLE measured row/halo against the literal
    // triangle's three stroked edges by their segment bounding rectangles.
    for (const [a, b] of [
      [
        { x: 240, y: 260 },
        { x: 235, y: 272 },
      ],
      [
        { x: 235, y: 272 },
        { x: 245, y: 272 },
      ],
      [
        { x: 245, y: 272 },
        { x: 240, y: 260 },
      ],
    ]) {
      const overlaps = center.x - halfWidth < Math.max(a!.x, b!.x) + 0.75 && center.x + halfWidth > Math.min(a!.x, b!.x) - 0.75 && center.y - halfHeight < Math.max(a!.y, b!.y) + 0.75 && center.y + halfHeight > Math.min(a!.y, b!.y) - 0.75
      expect(overlaps, 'annotation halo covers actual inheritance outline').toBe(false)
    }
    expect(p.relationships.map(r => r.points)).toEqual(before.relationships.map(r => r.points))
    expect(p.classes).toEqual(before.classes)
    expect(p.relationships[2]!.fromCardinalityPosition).toEqual({ x: 300, y: 330 })
    expect(p.relationships.map(r => [r.from, r.to, r.label, r.fromCardinality, r.toCardinality])).toEqual(before.relationships.map(r => [r.from, r.to, r.label, r.fromCardinality, r.toCardinality]))
  })
})

test('Class annotation repair reserves the prepared title before choosing a north-side replacement', () => {
  const p: PositionedClassDiagram = {
    width: 700,
    height: 650,
    namespaces: [],
    notes: [],
    title: { text: 'Title', x: 270, y: 16, block: diagramTitleBand('Title', resolveRenderStyle({}, CLASS_STYLE_DEFAULTS))!.block },
    classes: ['S', 'T'].map((id, i) => ({ id, label: id, x: 200, y: i ? 500 : 40, width: 120, height: 60, headerHeight: 40, attrHeight: 10, methodHeight: 10, attributes: [], methods: [] })),
    relationships: [
      {
        from: 'S',
        to: 'T',
        type: 'inheritance',
        markerAt: 'from',
        points: [
          { x: 240, y: 40 },
          { x: 240, y: 0 },
          { x: 500, y: 0 },
          { x: 500, y: 480 },
          { x: 240, y: 480 },
          { x: 240, y: 500 },
        ],
      },
      {
        from: 'S',
        to: 'T',
        type: 'link-solid',
        markerAt: 'none',
        fromCardinality: '0..1',
        fromCardinalityPosition: { x: 250, y: 30 },
        points: [
          { x: 260, y: 40 },
          // A distinct lower row keeps this scaffold clear of the other
          // relationship's y=0 trunk and the actual title text above y=30.
          { x: 260, y: 30 },
          { x: 520, y: 30 },
          { x: 520, y: 470 },
          { x: 260, y: 470 },
          { x: 260, y: 500 },
        ],
      },
    ],
  }
  const before = structuredClone(p),
    style = resolveRenderStyle({}, CLASS_STYLE_DEFAULTS)
  finalizeClassOwnedSurfaces(p, style)
  const point = p.relationships[1]!.fromCardinalityPosition!,
    block = classTextBlock('0..1', style, 'edge'),
    title = p.title!,
    titleBlock = title.block!
  expect(Math.abs(point.x - title.x) >= block.width / 2 + 1.5 + titleBlock.width / 2 || Math.abs(point.y - title.y) >= block.height / 2 + 1.5 + titleBlock.height / 2).toBe(true)
  expect(p.title).toEqual(before.title)
  expect(p.relationships.map(r => r.points)).toEqual(before.relationships.map(r => r.points))
})

test('Class header repair includes the actual shaft half-width outside a header edge', () => {
  const card = (id: string, y: number) => ({ id, label: id, x: 30, y, width: 40, height: 20, headerHeight: 12, attrHeight: 4, methodHeight: 4, attributes: [], methods: [] })
  const p: PositionedClassDiagram = { width: 240, height: 220, classes: [card('S',0),card('T',160)], notes: [], namespaces: [{id:'G',name:'G',label:'G',classIds:[],x:50,y:50,width:100,height:100,headerHeight:60}], relationships: [{from:'S',to:'T',type:'link-solid',markerAt:'none',points:[{x:49.75,y:20},{x:49.75,y:160}]}] }
  const original=structuredClone(p),style=resolveRenderStyle({},CLASS_STYLE_DEFAULTS)
  repairClassHeaderRoutes(p,style)
  for(let i=1;i<p.relationships[0]!.points.length;i++){
    const a=p.relationships[0]!.points[i-1]!,b=p.relationships[0]!.points[i]!
    // Literal full header inflated by the actual .5px shaft radius. The
    // original centerline x49.75 misses x50 yet its real stroke enters it.
    const enters=a.x===b.x ? a.x>49.5&&a.x<150.5&&Math.max(a.y,b.y)>49.5&&Math.min(a.y,b.y)<110.5 : a.y===b.y&&a.y>49.5&&a.y<110.5&&Math.max(a.x,b.x)>49.5&&Math.min(a.x,b.x)<150.5
    expect(enters,'actual shaft ink enters the full reserved header').toBe(false)
  }
  const points=p.relationships[0]!.points
  expect(points[0]).toEqual(original.relationships[0]!.points[0])
  expect(points.at(-1)).toEqual(original.relationships[0]!.points.at(-1))
  expect(points[1]!.x).toBe(points[0]!.x)
  expect(points[1]!.y).toBeGreaterThan(points[0]!.y)
  expect(points.at(-2)!.x).toBe(points.at(-1)!.x)
  expect(points.at(-2)!.y).toBeLessThan(points.at(-1)!.y)
  expect(p.classes).toEqual(original.classes)
  expect(p.namespaces).toEqual(original.namespaces)
})

test.each(['elk', 'agentic'].flatMap(backend => [false, true].map(titled => ({ backend, titled }))))('Class contacts use the exact written rectangle face after title=$titled with $backend', ({ backend, titled }) => {
  const source=(titled?'---\ntitle: Exact rectangle\n---\n':'')+'classDiagram\n'+(titled?'direction TB':'direction LR')+'\nclass S\nclass T\nS -- T'
  const produce=(input:any)=>{
    const graph=structuredClone(input),vertical=titled
    graph.children ??= graph.nodes
    Object.assign(graph,{width:1700,height:1700})
    Object.assign(graph.children.find((n:any)=>n.id==='S'),{x:vertical?400:909.6033333333332,y:vertical?932.8666666666666:289.4166666666667,width:120,height:backend === 'elk' ? 88.9 : input.nodes[0].height})
    Object.assign(graph.children.find((n:any)=>n.id==='T'),{x:vertical?400:1383.8199999999997,y:vertical?1383.8199999999997:289.4166666666667,width:120,height:backend === 'elk' ? 88.9 : input.nodes[0].height})
    const a=graph.children.find((n:any)=>n.id==='S'),b=graph.children.find((n:any)=>n.id==='T'),points=vertical?[{x:a.x+60,y:a.y+a.height},{x:b.x+60,y:b.y}]:[{x:a.x+a.width,y:a.y+44.45},{x:b.x,y:b.y+44.45}]
    graph.edges[0].sections=[{id:'section',startPoint:points[0],endPoint:points[1]}]
    return backend === 'elk' ? graph : { width:graph.width, height:graph.height, nodes:graph.children, edges:[{points}] }
  }
  const spy = backend === 'elk' ? spyOn(elk, 'elkLayoutSync').mockImplementation(produce) : spyOn(nativeClassProducer, 'layoutAgenticGraph').mockImplementation(produce)
  try {
    let rendered!: ReturnType<typeof renderMermaidSVGWithReceipt>
    expect(() => { rendered=renderMermaidSVGWithReceipt(source,{graphLayout:{backend:backend as 'elk' | 'agentic',fallback:'none'}}) }).not.toThrow()
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    const carrier=rendered.svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/)![0],
      points=carrier.match(/\spoints="([^"]+)"/)![1]!.trim().split(/[ ,]+/).map(Number)
    // Exact decimal sums of the actual rectangle fields. The old independent
    // long-tail endpoint spelling rounds inward/outward at the1000 boundary.
    expect(points[titled?1:0]).toBe(titled?(backend === 'elk' ? 1057.166666667 : 1017.166666667):1029.603333333)
    expect(points[titled?0:1]).toBe(points[titled?2:3])
    expect(rendered.svg).toContain('data-id="S"')
    expect(rendered.svg).toContain('data-id="T"')
  } finally {spy.mockRestore()}
})

describe('ELK rectangular self-loop endpoint construction', () => {
  const fixture = (): PositionedClassDiagram => ({
    width: 15000, height: 1000, namespaces: [], notes: [],
    classes: [{id:'C2',label:'C2',x:13038.936000000002,y:248.7,width:464.11,height:96.7,headerHeight:32.9,attrHeight:28,methodHeight:35.8,attributes:[],methods:[]}],
    relationships: [{from:'C2',to:'C2',type:'link-solid',markerAt:'none',points:[{x:13348.342666666667,y:248.7},{x:13348.34266666667,y:238.7},{x:13193.639333333334,y:238.7},{x:13193.639333333334,y:248.7}]}],
  })
  const style = () => ({...resolveRenderStyle({},CLASS_STYLE_DEFAULTS),cornerRadius:0,edgeBendRadius:0,lineWidth:1})
  for (const transpose of [false, true]) for (const reflected of [false, true]) for (const drift of [false, true]) {
    test(`keeps literal normal contacts transpose=${transpose} reflected=${reflected} drift=${drift}`, () => {
      const source = `classDiagram\nnamespace G_${Number(transpose)}${Number(reflected)}${Number(drift)} {\nclass C2\n}\nC2 -- C2`
      const original = classLayoutModule.layoutClassDiagram
      let placed: PositionedClassDiagram | undefined
      const observer = spyOn(classLayoutModule, 'layoutClassDiagram').mockImplementation((...args: Parameters<typeof original>) => {
        placed = original(...args)
        return placed
      })
      const solver = spyOn(elk, 'elkLayoutSync').mockImplementation((input: any) => {
        const graph = structuredClone(input), group = graph.children[0], node = group.children[0]
        const point = (x: number, y: number) => transpose ? { x: reflected ? 500 - y : y, y: x } : { x, y: reflected ? 500 - y : y }
        const rectangle = (x: number, y: number, width: number, height: number) => {
          const low = point(x, reflected ? y + height : y)
          return { ...low, width: transpose ? height : width, height: transpose ? width : height }
        }
        Object.assign(graph, { width: transpose ? 1000 : 15000, height: transpose ? 15000 : 1000 })
        Object.assign(group, transpose ? { x: 176.7, y: 4865.066000000001, width: 500, height: 9000 } : { x: 4865.066000000001, y: 176.7, width: 9000, height: 500 })
        Object.assign(node, rectangle(8173.870000000001, 72, 464.11, 96.7))
        group.edges[0].sections = [{ id: 'loop-section', startPoint: point(8483.276666666667, 72), bendPoints: [point(drift ? 8483.276666666668 : 8483.276666666667, 61.99999999999999), point(8328.573333333334, 61.99999999999999)], endPoint: point(8328.573333333334, 72) }]
        return graph
      })
      try {
        const rendered = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'elk', fallback: 'none' }, style: { formatVersion: 1, name: 'self-normal', stroke: 'crisp', strokeWidth: 1 } })
        expect(rendered.receipt.layoutCertification?.status).toBe('passed')
        const points = rendered.svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*\spoints="([^"]+)"/)![1]!.split(' ').map(point => point.split(',').map(Number))
        const cross = transpose ? 1 : 0, main = transpose ? 0 : 1
        expect(points).toHaveLength(4)
        expect(points[0]![cross]).toBe(points[1]![cross])
        expect(points[2]![cross]).toBe(points[3]![cross])
        expect(points[1]![main]).toBe(points[2]![main])
        expect(Math.sign(points[1]![main]! - points[0]![main]!)).toBe(reflected ? 1 : -1)
        expect(placed!.relationships[0]!.points[0]).toEqual(transpose ? { x: reflected ? 604.7 : 248.7, y: 13348.342666666667 } : { x: 13348.342666666667, y: reflected ? 604.7 : 248.7 })
      } finally { observer.mockRestore(); solver.mockRestore() }
    })
  }
  test.each(['rounded-carrier','rounded-card','corner','label','marker','cardinality','nonparallel-inner','reversed-inner','narrow-loop','nonself'] as const)('retains the original unsupported %s loop', kind => {
    const scene=fixture(),paint=style(),rel=scene.relationships[0]!,node=scene.classes[0]!
    if(kind==='rounded-carrier')paint.edgeBendRadius=8
    if(kind==='rounded-card')paint.cornerRadius=8
    if(kind==='corner')rel.points[0]!.x=node.x
    if(kind==='label')rel.label='retained spine'
    if(kind==='marker')rel.markerAt='to'
    if(kind==='cardinality')rel.fromCardinality='1'
    if(kind==='nonparallel-inner')rel.points[2]!.y+=1
    if(kind==='reversed-inner')rel.points[2]!.x=rel.points[1]!.x+1
    if(kind==='narrow-loop'){rel.points[3]!.x=rel.points[0]!.x-.25;rel.points[2]!.x=rel.points[3]!.x}
    if(kind==='nonself')rel.to='Other'
    const before=structuredClone(scene),points=rel.points
    expect(constructClassElkSelfContacts(scene,paint,createClassMarkerAdmissionWork())).toBeUndefined()
    expect(scene).toEqual(before)
    expect(rel.points).toBe(points)
  })
  test.each([0,1000])('exhaustion with %s work left publishes no candidate', remaining => {
    const scene=fixture(),before=structuredClone(scene),work=createClassMarkerAdmissionWork()
    work.operations=400000-remaining
    expect(()=>constructClassElkSelfContacts(scene,style(),work)).toThrow('work limit')
    expect(work.exhausted).toBe(true)
    expect(scene).toEqual(before)
  })
  test('keeps an already-written axial original array and point records', () => {
    const scene=fixture(),rel=scene.relationships[0]!
    rel.points[1]!.x=rel.points[0]!.x
    const before=structuredClone(scene),points=rel.points,bend=points[1]
    expect(constructClassElkSelfContacts(scene,style(),createClassMarkerAdmissionWork())).toBeUndefined()
    expect(scene).toEqual(before)
    expect(rel.points).toBe(points)
    expect(rel.points[1]).toBe(bend)
  })
  test('rechecks a newly constructed self carrier against a final foreign marker', () => {
    const scene=fixture(),paint=style(),work=createClassMarkerAdmissionWork(),changed=constructClassElkSelfContacts(scene,paint,work)
    expect([...changed!]).toEqual([0])
    const x=(scene.relationships[0]!.points[0]!.x+scene.relationships[0]!.points[3]!.x)/2
    const card=(id:string,y:number)=>({id,label:id,x:x-10,y,width:20,height:2,headerHeight:2,attrHeight:0,methodHeight:0,attributes:[],methods:[]})
    scene.classes.push(card('F',200),card('T',244.7))
    scene.relationships.push({from:'F',to:'T',type:'inheritance',markerAt:'to',points:[{x,y:202},{x,y:244.7}]})
    expect(()=>assertClassElkSelfContactsClear(scene,paint,changed,work)).toThrow('unproved final support')
  })
})

test('a Class caption follows its own repaired header spine instead of remaining free-floating', () => {
 const style=resolveRenderStyle({},CLASS_STYLE_DEFAULTS),card=(id:string,x:number,y:number,width:number,height:number)=>({id,label:id,x,y,width,height,headerHeight:height,attrHeight:0,methodHeight:0,attributes:[],methods:[]})
 const p:PositionedClassDiagram={width:600,height:600,classes:[card('S',200,40,100,60),card('T',200,400,100,60),card('B',255,180,20,20)],namespaces:[{id:'G',name:'G',label:'G',classIds:[],x:150,y:200,width:100,height:100,headerHeight:60}],notes:[],relationships:[{from:'S',to:'T',type:'inheritance',markerAt:'from',points:[{x:249,y:100},{x:249,y:400}],label:'x',labelBlock:classTextBlock('x',style,'edge'),labelPosition:{x:256,y:238}}]}
 const before=structuredClone(p.relationships[0]!)
 finalizeClassOwnedSurfaces(p,style)
 const rel=p.relationships[0]!,pos=rel.labelPosition!,block=rel.labelBlock!,left=pos.x-block.width/2-1.5-8,right=pos.x+block.width/2+1.5+8,top=pos.y-8-block.height/2-1.5-8,bottom=pos.y-8+block.height/2+1.5+8
 const associated=rel.points.some((b,i)=>{if(!i)return false;const a=rel.points[i-1]!;return a.x===b.x?a.x>left&&a.x<right&&Math.max(a.y,b.y)>top&&Math.min(a.y,b.y)<bottom:a.y===b.y&&a.y>top&&a.y<bottom&&Math.max(a.x,b.x)>left&&Math.min(a.x,b.x)<right})
 expect(associated,'occupied caption row is no longer associated with its own actual route').toBe(true)
 expect(rel.points[0]).toEqual(before.points[0])
 expect(rel.points.at(-1)).toEqual(before.points.at(-1))
 expect(rel.label).toBe(before.label)
 expect(rel.labelBlock).toEqual(before.labelBlock)
})


test('Class own-header bypass reservation measures distinct marked incidences without growing already-clear space', () => {
 const style=resolveRenderStyle({},CLASS_STYLE_DEFAULTS)
 const placement=(count:number,inset:number):PositionedClassDiagram=>{
  const classes=Array.from({length:6},(_,i)=>({id:'S'+i,label:'S'+i,x:100+i*150,y:68+inset,width:120,height:60,headerHeight:40,attrHeight:10,methodHeight:10,attributes:[],methods:[]}))
  return{width:1240,height:300,classes:[...classes,{id:'T',label:'T',x:0,y:0,width:1200,height:20,headerHeight:20,attrHeight:0,methodHeight:0,attributes:[],methods:[]}],namespaces:[{id:'G',name:'G',label:'G',classIds:classes.map(c=>c.id),x:40,y:40,width:1100,height:220,headerHeight:28}],notes:[],relationships:Array.from({length:count},(_,i)=>({from:'S'+Math.floor(i/2),to:'T',type:'inheritance',markerAt:'from',points:[{x:100+Math.floor(i/2)*150+(i%2?80:40),y:68+inset},{x:100+Math.floor(i/2)*150+(i%2?80:40),y:20}]}))}
 }
 const crowded=placement(11,20),before=structuredClone(crowded),current=new Map([['G',20]])
 expect(classMarkerHeaderInsets(crowded,style,current).get('G')).toBeGreaterThan(20)
 expect(crowded).toEqual(before)
 expect(current.get('G')).toBe(20)
 expect(classMarkerHeaderInsets(placement(2,20),style,new Map([['G',20]])).get('G')).toBe(20)
 expect(classMarkerHeaderInsets(placement(11,32),style,new Map([['G',32]])).get('G')).toBe(32)
})


test('ELK seats a crowded RTL owned note with real leading vertical room and fresh contacts', () => {
 const source=readFileSync(new URL('./fixtures/class-crowded-rtl-note.mmd',import.meta.url),'utf8'),capture:{positioned?:PositionedClassDiagram}={},original=classLayoutModule.layoutClassDiagram
 const observer=spyOn(classLayoutModule,'layoutClassDiagram').mockImplementation((...args:Parameters<typeof original>)=>{const p=original(...args);capture.positioned=p;return p})
 try{
  const result=renderMermaidSVGWithReceipt(source,{class:{hierarchicalNamespaces:true},graphLayout:{backend:'elk',fallback:'none'}})
  expect(result.receipt.layoutCertification?.status).toBe('passed')
  if(!capture.positioned)throw new Error('The Class owning boundary was not observed')
  const p=capture.positioned,note=p.notes[0]!,node=p.classes.find(c=>c.id===note.for)!
  expect(p.title?.text).toBe('Class compact 15')
  expect(p.title?.y).toBe(51.7)
  expect(note.y).toBeGreaterThanOrEqual(75.4)
  expect(note.y+note.height).toBeLessThan(node.y)
  expect(note.targetY).toBe(node.y)
  expect(note.noteY).toBe(124.6)
  expect(note.text).toBe('owned note 15\nsecond line')
  expect(result.svg).toContain('owned note 15')
  expect(result.svg).toContain('second line')
  expect(p.classes).toHaveLength(14)
  expect(p.relationships).toHaveLength(16)
  // The public carrier uses canonical decimal spelling; raw retained binary
  // sums can differ by one ULP after the exact rigid translation.
  const carriers=[...result.svg.matchAll(/<polyline\b[^>]*class="class-relationship"[^>]*\spoints="([^"]+)"/g)]
  expect(carriers).toHaveLength(p.relationships.length)
  for(const carrier of carriers){const points=carrier[1]!.trim().split(/[ ,]+/).map(Number);for(let i=2;i<points.length;i+=2)expect(points[i-2]===points[i]||points[i-1]===points[i+1]).toBe(true)}
 }finally{observer.mockRestore()}
})

test('Class annotation connectors do not co-own an unrelated horizontal carrier', () => {
 const card=(id:string,x:number,y:number)=>({id,label:id,x,y,width:120,height:49.2,headerHeight:33.2,attrHeight:8,methodHeight:8,attributes:[],methods:[]})
 const p:PositionedClassDiagram={width:500,height:340,namespaces:[],classes:[card('S',80,100),card('U',145,40),card('V',155,240)],relationships:[{from:'U',to:'V',type:'link-solid',markerAt:'none',points:[{x:205,y:89.2},{x:205,y:124.6},{x:215,y:124.6},{x:215,y:240}]}],notes:[{for:'S',text:'two lines',x:224,y:100,width:90,height:49.2,targetX:200,targetY:124.6,noteX:224,noteY:124.6}]}
 const before=structuredClone(p)
 repairClassNoteSeats(p,resolveRenderStyle({},CLASS_STYLE_DEFAULTS),40)
 const n=p.notes[0]!,sameRow=n.targetY===124.6&&n.noteY===124.6,overlap=sameRow&&Math.min(n.targetX!,n.noteX!)<215&&Math.max(n.targetX!,n.noteX!)>205
 expect(overlap,'dashed annotation and foreign solid carrier share real ink').toBe(false)
 expect(p.relationships).toEqual(before.relationships)
 expect(p.classes).toEqual(before.classes)
 expect(n.for).toBe('S')
 expect(n.text).toBe('two lines')
})


test('Class header bypasses reserve tight turn spans before flexible carriers', () => {
  const card = (id: string, x: number, y: number) => ({ id, label: id, x, y, width: 60, height: 50, headerHeight: 30, attrHeight: 10, methodHeight: 10, attributes: [], methods: [] })
  const p: PositionedClassDiagram = {
    width: 1100, height: 450, notes: [],
    namespaces: [{ id: 'G', name: 'G', label: 'G', classIds: [], x: 100, y: 200, width: 800, height: 150, headerHeight: 28 }],
    classes: [card('S1', 270, 300), card('S2', 370, 300), card('S3', 470, 300), card('T1', 570, 50), card('T2', 670, 50), card('T3', 770, 50)],
    relationships: [
      { from: 'S1', to: 'T1', type: 'link-solid', markerAt: 'none', points: [{ x: 300, y: 300 }, { x: 300, y: 150 }, { x: 600, y: 150 }, { x: 600, y: 100 }] },
      { from: 'S2', to: 'T2', type: 'link-solid', markerAt: 'none', points: [{ x: 400, y: 300 }, { x: 400, y: 160 }, { x: 700, y: 160 }, { x: 700, y: 100 }] },
      { from: 'S3', to: 'T3', type: 'link-solid', markerAt: 'none', points: [{ x: 500, y: 300 }, { x: 500, y: 195.5 }, { x: 800, y: 195.5 }, { x: 800, y: 100 }] },
    ],
  }, before = structuredClone(p), style = { ...resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), lineWidth: 0.1 }
  repairClassHeaderRoutes(p, style)
  for (const rel of p.relationships) for (let i = 1; i < rel.points.length; i++) {
    const a = rel.points[i - 1]!, b = rel.points[i]!, vertical = a.x === b.x
    expect(vertical || a.y === b.y).toBe(true)
    // Independent full-header band expanded by the real 0.05px shaft radius.
    const enters = vertical ? a.x > 99.95 && a.x < 900.05 && Math.max(a.y, b.y) > 199.95 && Math.min(a.y, b.y) < 228.05 : a.y > 199.95 && a.y < 228.05 && Math.max(a.x, b.x) > 99.95 && Math.min(a.x, b.x) < 900.05
    expect(enters, 'a tight old turn was stranded behind flexible bypass owners').toBe(false)
  }
  expect(p.classes).toEqual(before.classes)
  expect(p.namespaces).toEqual(before.namespaces)
  expect(p.relationships.map(r => [r.from, r.to, r.type, r.points[0], r.points.at(-1)])).toEqual(before.relationships.map(r => [r.from, r.to, r.type, r.points[0], r.points.at(-1)]))
})


test('strict Native preserves the public Animal inheritance example and both notes', () => {
 const source = "---\ntitle: Animal example\n---\nclassDiagram\n    note \"From Duck till Zebra\"\n    Animal <|-- Duck\n    note for Duck \"can fly<br>can swim<br>can dive<br>can help in debugging\"\n    Animal <|-- Fish\n    Animal <|-- Zebra\n    Animal : +int age\n    Animal : +String gender\n    Animal: +isMammal()\n    Animal: +mate()\n    class Duck{\n        +String beakColor\n        +swim()\n        +quack()\n    }\n    class Fish{\n        -int sizeInFeet\n        -canEat()\n    }\n    class Zebra{\n        +bool is_wild\n        +run()\n    }"
 const result = renderMermaidSVGWithReceipt(source, { graphLayout: { backend: 'agentic', fallback: 'none' } })
 expect(result.receipt.layoutCertification?.status).toBe('passed')
 expect(result.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'primary' })])
 expect(result.svg.match(/class="class-relationship"/g)).toHaveLength(3)
 for (const text of ['Animal', 'Duck', 'Fish', 'Zebra', 'From Duck till Zebra', 'can help in debugging']) expect(result.svg).toContain(text)
})
