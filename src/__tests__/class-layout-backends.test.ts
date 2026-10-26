import { describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { releaseBenchCases } from '../../eval/shared/release-bench-cases.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { CLASS_STYLE_DEFAULTS, layoutClassDiagram } from '../class/layout.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { missingSvgLabels } from './helpers/svg-labels.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/class-backends.mmd', import.meta.url), 'utf8')
const compoundFixture = readFileSync(new URL('../../eval/layout-compare/fixtures/class-compound-backends.mmd', import.meta.url), 'utf8')

describe('Class layout backends', () => {
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
    const expected = releaseBenchCases().find(input => input.id === 'class:compound-namespaces')!.expectedSvgLabels
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

  test('retains labelled nested fan contacts when default owned escape rays are exhausted', () => {
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
    const options = { graphLayout: { backend: 'agentic' as const, fallback: 'none' as const } }
    const model = parseClassDiagram(toMermaidLines(source)),
      original = structuredClone(model)
    const placed = layoutClassDiagram(model, options)
    expect(model).toEqual(original)
    expect(layoutClassDiagram(model, options)).toEqual(placed)
    expect(placed.relationships.map(rel => [rel.from, rel.to, rel.label])).toEqual(model.relationships.map(rel => [rel.from, rel.to, rel.label]))
    const rendered = renderMermaidSVGWithReceipt(source, options)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic', role: 'primary' })])
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

import { classCarrierEntersMarker, classMarkerEntersBox, classNewMiterEntersMarker, classSegmentEntersBox, repairClassHeaderRoutes, repairClassNoteSeats } from '../class/owned-surfaces.ts'
import { classMarkerPieces } from '../class/relationship-paint.ts'
import * as elk from '../elk-instance.ts'
import { resolveRenderStyle } from '../styles.ts'

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
    projection = projectRoundedConnectorPath(route, 25, { metric: 'manhattan', precision: 3 })
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
  test.each(['agentic', 'elk'] as const)('retains separated markers and exact shared identical glyphs in %s', backend => {
    const separated = controlled(20)
    try {
      expect(layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource)), { graphLayout: { backend, fallback: 'none' } }).relationships).toHaveLength(2)
    } finally {
      separated.restore()
    }
    const shared = controlled(0)
    try {
      expect(layoutClassDiagram(parseClassDiagram(toMermaidLines(modelSource.replace('o--', '<|--'))), { graphLayout: { backend, fallback: 'none' } }).relationships).toHaveLength(2)
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
      expect(proofCalls[1]!.before).toBe(proofCalls[0]!.after)
      expect(proofCalls[1]!.after).toBeGreaterThan(proofCalls[1]!.before)
    } finally {
      proof.mockRestore()
      producer.restore()
    }
  })
})
