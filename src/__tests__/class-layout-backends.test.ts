import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { releaseBenchCases } from '../../eval/benchmark/release-bench-cases.ts'
import { missingSvgLabels } from '../../eval/benchmark/release-bench-fidelity.ts'
import { withRenderStageObserver } from '../render-stages.ts'
import { renderMermaidASCII } from '../ascii/index.ts'

const native = { graphLayout: { backend: 'agentic' as const } }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/class-backends.mmd', import.meta.url), 'utf8')
const compoundFixture = readFileSync(new URL('../../eval/layout-compare/fixtures/class-compound-backends.mmd', import.meta.url), 'utf8')

describe('Class layout backends', () => {
  test.each(['TB', 'BT', 'LR', 'RL'])('retains member compartments, notes, cardinalities and relationship meaning in %s', direction => {
    const source = fixture.replace('direction LR', `direction ${direction}`)
    const model = parseClassDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutClassDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutClassDiagram(model, native)).toEqual(placed)
    expect(placed.classes.map(cls => [cls.id, cls.label, cls.annotation, cls.attributes, cls.methods])).toEqual(model.classes.map(cls => [cls.id, cls.label, cls.annotation, cls.attributes, cls.methods]))
    expect(placed.relationships.map(({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label }) => ({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label }))).toEqual(model.relationships.map(({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label }) => ({ from, to, type, fromType, toType, markerAt, lineStyle, fromCardinality, toCardinality, label })))
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
    const options = { ...native, nodeSpacing: 51 }, stages: string[] = [], parsed = parseRegisteredMermaid(fixture)
    if (!parsed.ok) throw new Error('fixture must parse')
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(fixture, options))
    expect(stages).toContain('agentic')
    expect(stages).not.toContain('elk')
    expect(renderMermaidSVGWithReceipt(parsed.value, options).svg).toBe(result.svg)
    expect(layoutMermaidWithReceipt(fixture, options).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    const png = renderMermaidPNGWithReceipt(fixture, options)
    expect(png.png.length).toBeGreaterThan(0)
    expect(png.receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    expect(renderMermaidSVGWithReceipt(fixture, { graphLayout: { backend: 'elk' } }).svg).toBe(renderMermaidSVGWithReceipt(fixture).svg)
  })

  test.each([
    ['lollipop', 'classDiagram\nConsumer --() API : uses'],
    ['authored prefix and edge', 'classDiagram\nclass `ns:Authored`\nclass B\n`ns:Authored` --> B'],
    ['authored prefix and note', 'classDiagram\nclass `ns:Domain`["Authored card"]\nnote for `ns:Domain` "owned note"'],
    ['namespace collision', 'classDiagram\nnamespace Domain {\nclass `ns:Domain`["Authored card"]\nclass `ns:Domain#1`\nclass B\n}\n`ns:Domain` --> B : relation\nnote for `ns:Domain` "owned note"'],
    ['nested namespace collision', 'classDiagram\nnamespace Outer {\nnamespace Domain {\nclass `ns:Outer.Domain`["Nested card"]\nclass `ns:Outer.Domain#1`\nclass B\n}\n}\n`ns:Outer.Domain` --> B : relation\nnote for `ns:Outer.Domain` "owned note"'],
  ].flatMap(([name, source]) => (['elk', 'agentic'] as const).map(backend => ({ name, source: source!, backend }))))('retains $name with $backend', ({ source, backend }) => {
    const options = { graphLayout: { backend, fallback: 'none' as const } }
    const parsed = parseClassDiagram(toMermaidLines(source)), placed = layoutClassDiagram(parsed, options)
    expect(placed.classes.map(cls => [cls.id, cls.label, cls.isInterface])).toEqual(parsed.classes.map(cls => [cls.id, cls.label, cls.isInterface || undefined]))
    expect(placed.namespaces.map(ns => ns.id)).toEqual(source.includes('namespace Outer') ? ['Outer', 'Outer.Domain'] : source.includes('namespace Domain') ? ['Domain'] : [])
    expect(placed.notes.map(note => [note.for, note.text])).toEqual(parsed.notes.map(note => [note.for, note.text]))
    const result = renderMermaidSVGWithReceipt(source, options)
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    for (const cls of parsed.classes.filter(cls => !cls.isInterface)) expect(result.svg).toContain(cls.label)
    if (source.includes('owned note')) expect(result.svg).toContain('owned note')
    if (source.includes('relation')) expect(result.svg).toContain('relation')
  })

  test.each(['TB', 'BT', 'LR', 'RL'])('retains independent namespace frames, members and labels in %s', direction => {
    const source = compoundFixture.replace('direction TB', `direction ${direction}`)
    const model = parseClassDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutClassDiagram(model, native)
    expect(model).toEqual(original)
    expect(layoutClassDiagram(model, native)).toEqual(placed)
    expect(placed.classes.map(cls => [cls.id, cls.label, cls.attributes, cls.methods, cls.annotation, Boolean(cls.isInterface)]))
      .toEqual(model.classes.map(cls => [cls.id, cls.label, cls.attributes, cls.methods, cls.annotation, Boolean(cls.isInterface)]))
    expect(placed.classes.map(cls => cls.id)).toContain('class-namespace:Platform')
    expect(placed.namespaces.map(ns => [ns.id, ns.parentId])).toEqual([
      ['Platform', undefined], ['Platform.Domain', 'Platform'], ['Audit', undefined],
    ])
    expect(placed.relationships.map(rel => [rel.from, rel.to, rel.type, rel.label, rel.fromCardinality, rel.toCardinality]))
      .toEqual(model.relationships.map(rel => [rel.from, rel.to, rel.type, rel.label, rel.fromCardinality, rel.toCardinality]))
    const boxes = new Map([...placed.classes, ...placed.namespaces].map(box => [box.id, box]))
    for (const frame of placed.namespaces) {
      for (const id of [...frame.classIds, ...placed.namespaces.filter(child => child.parentId === frame.id).map(child => child.id)]) {
        const child = boxes.get(id)!
        expect(child.x).toBeGreaterThanOrEqual(frame.x - .01)
        expect(child.y).toBeGreaterThanOrEqual(frame.y + frame.headerHeight - .01)
        expect(child.x + child.width).toBeLessThanOrEqual(frame.x + frame.width + .01)
        expect(child.y + child.height).toBeLessThanOrEqual(frame.y + frame.height + .01)
      }
    }
    const stages: string[] = []
    const options = { ...native, nodeSpacing: 53 }
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(source, options))
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
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(grouped, native))
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

  test.each([
    { name: 'literal siblings', declarations: 'namespace `Domain.Left`["Left namespace"] {\nclass `ns:Domain.Left`["Left card"]\n}\nnamespace `Domain.Right`["Right namespace"] {\nclass `class-namespace:Domain.Right`["Right card"]\n}',
      groups: [['Domain.Left', undefined, ['ns:Domain.Left']], ['Domain.Right', undefined, ['class-namespace:Domain.Right']]] },
    { name: 'literal parent', declarations: 'namespace `Domain.Root`["Left namespace"] {\nclass `ns:Domain.Left`["Left card"]\nnamespace Child["Right namespace"] {\nclass `class-namespace:Domain.Right`["Right card"]\n}\n}',
      groups: [['Domain.Root', undefined, ['ns:Domain.Left']], ['Domain.Root.Child', 'Domain.Root', ['class-namespace:Domain.Right']]] },
    { name: 'literal and syntactic siblings', declarations: 'namespace `Domain.Left`["Left namespace"] {\nclass `ns:Domain.Left`["Left card"]\n}\nnamespace Domain {\nnamespace Right["Right namespace"] {\nclass `class-namespace:Domain.Right`["Right card"]\n}\n}',
      groups: [['Domain.Left', undefined, ['ns:Domain.Left']], ['Domain', undefined, []], ['Domain.Right', 'Domain', ['class-namespace:Domain.Right']]] },
  ].flatMap(example => (['elk', 'agentic'] as const).map(backend => ({ ...example, backend }))))('routes $name without inventing ancestors with $backend', ({ declarations, groups, backend }) => {
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
      const coordinates = shaft.match(/\bpoints="([^"]+)"/)![1]!.split(' ').map(pair => pair.split(',').map(Number))
      for (const [id, point] of [['ns:Domain.Left', coordinates[0]!], ['class-namespace:Domain.Right', coordinates.at(-1)!]] as const) {
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
    const model = parseClassDiagram(toMermaidLines(source)), placed = layoutClassDiagram(model, native)
    expect(placed.relationships.map(rel => [rel.from, rel.to, rel.label])).toEqual(model.relationships.map(rel => [rel.from, rel.to, rel.label]))
    for (const relation of placed.relationships) {
      const points = relation.points
      for (const [id, endpoint, next] of [[relation.from, points[0]!, points[1]!], [relation.to, points.at(-1)!, points.at(-2)!]] as const) {
        const box = placed.classes.find(cls => cls.id === id)!
        const outward = Math.abs(endpoint.x - box.x) < 1e-7 && next.y === endpoint.y && next.x < endpoint.x
          || Math.abs(endpoint.x - box.x - box.width) < 1e-7 && next.y === endpoint.y && next.x > endpoint.x
          || Math.abs(endpoint.y - box.y) < 1e-7 && next.x === endpoint.x && next.y < endpoint.y
          || Math.abs(endpoint.y - box.y - box.height) < 1e-7 && next.x === endpoint.x && next.y > endpoint.y
        expect(outward).toBe(true)
        expect(Math.abs(next.x - endpoint.x) + Math.abs(next.y - endpoint.y)).toBeGreaterThanOrEqual(8)
      }
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!
        expect(a.x === b.x || a.y === b.y).toBe(true)
        for (let j = i + 2; j < points.length; j++) {
          const c = points[j - 1]!, d = points[j]!
          const meets = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
            && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
          expect(meets).toBe(false)
        }
      }
    }
    const result = renderMermaidSVGWithReceipt(source, native)
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    expect(result.svg.match(/class="class-relationship"/g)).toHaveLength(5)
    for (const label of ['owns entry', 'translates request payload', 'sends a notification payload']) expect(result.svg).toContain(label)
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
      if (hierarchicalNamespaces) for (const inner of placed.namespaces.filter(frame => frame.parentId !== undefined)) {
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
      if (backend === 'default' && hierarchicalNamespaces) for (const useAscii of [true, false]) {
        const terminal = renderMermaidASCII(`---\ntitle: Empty namespace title\n---\n${source}`, { useAscii })
        expect(terminal).toContain('Empty namespace title')
        for (const label of ['Outer empty label', 'Inner empty label', 'Leaf empty label', 'Standalone empty label', 'Empty frame note']) expect(terminal).toContain(label)
      }
      const publicLayout = layoutMermaidWithReceipt(source, options).layout
      expect(publicLayout.nodes).toEqual([])
      expect(publicLayout.groups.map(group => [group.id, group.parentId, group.members])).toEqual([
        ['Outer', undefined, []], ['Outer.Inner', hierarchicalNamespaces ? 'Outer' : undefined, []], ['Outer.Inner.Leaf', hierarchicalNamespaces ? 'Outer.Inner' : undefined, []], ['Empty', undefined, []],
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
