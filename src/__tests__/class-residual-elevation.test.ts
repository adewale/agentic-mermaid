import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { asClass, type ClassMutationOp, type ClassValidDiagram } from '../agent/types.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { renderMermaidSVG as renderAgentSVG } from '../agent/core.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const lines = (source: string) => source.split('\n').map(line => line.trim()).filter(Boolean)

function classDiagram(source: string): ClassValidDiagram {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  const narrowed = asClass(parsed.value)
  if (!narrowed) throw new Error(`expected structured Class body, got ${parsed.value.body.kind}`)
  return narrowed
}

function apply(diagram: ClassValidDiagram, op: ClassMutationOp): ClassValidDiagram {
  const result = mutate(diagram, op)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

describe('Class residual elevation (B08/B10)', () => {
  test('keeps class definitions and lone hyphenated inline paint editable through unrelated edits', async () => {
    const source = `classDiagram
      class A
      B:::hot
      classDef hot fill:#ff0000,stroke:#220000,color:#ffffff
      cssClass A hot
      style A stroke-width:4px`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('class')
    const canonical = serializeMermaid(parsed.value)
    expect(serializeMermaid(classDiagram(canonical))).toBe(canonical)
    const native = parseClassDiagram(lines(source))
    expect(native.classDefs.get('hot')).toEqual({ fill: '#ff0000', stroke: '#220000', color: '#ffffff' })
    expect(native.classes.map(node => [node.id, node.className])).toEqual([['A', 'hot'], ['B', 'hot']])
    expect(native.classes.find(node => node.id === 'A')?.inlineStyle).toEqual({ 'stroke-width': '4px' })
    const svg = renderAgentSVG(parsed.value)
    expect(svg).toBe(renderMermaidSVG(source))
    expect(svg).toContain('class="class-node hot"')
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).toContain('stroke-width="4"')
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_text' }))
    const edited = mutate(parsed.value, { kind: 'set_css_class', class: 'B', className: 'cool' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(edited.error.message)
    expect(asClass(edited.value)!.body.classes.find(node => node.id === 'A')?.style).toEqual({ 'stroke-width': '4px' })
    expect(serializeMermaid(parsed.value)).toBe(canonical)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.publicAccepts(source)).toBe(false)
      expect(await upstream.publicAccepts(canonical)).toBe(true)
      expect(await upstream.publicAccepts(serializeMermaid(edited.value))).toBe(true)
    } finally { upstream.close() }
  })

  test('models and renders classDef, class/cssClass, shorthand, and constructible inline paint', async () => {
    let diagram = classDiagram(`classDiagram
      class A
      B:::hot
      classDef hot fill:#ff0000,stroke:#220000,color:#ffffff
      cssClass A hot
      style A stroke-width:4px,fill:#112233`)
    expect(diagram.body.classDefs?.hot?.fill).toBe('#ff0000')
    expect(diagram.body.classes.find(item => item.id === 'A')?.className).toBe('hot')
    expect(diagram.body.classes.find(item => item.id === 'A')?.style?.['stroke-width']).toBe('4px')
    expect(diagram.body.classes.find(item => item.id === 'B')?.className).toBe('hot')
    const svg = renderMermaidSVG(serializeMermaid(diagram))
    expect(svg).toContain('class="class-node hot"')
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).toContain('fill="#112233"')
    expect(svg).toContain('stroke-width="4"')
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.project(serializeMermaid(diagram), value => value.db.getData().nodes.map((node: { id: string; cssClasses: string; styles: string[] }) => ({ id: node.id, classes: node.cssClasses, styles: node.styles })))).toEqual({
        ok: true, value: [
          { id: 'A', classes: 'default hot', styles: ['fill:#ff0000', 'stroke:#220000', 'color:#ffffff', 'style:', 'stroke-width:4px', 'fill:#112233'] },
          { id: 'B', classes: 'default hot', styles: ['fill:#ff0000', 'stroke:#220000', 'color:#ffffff'] },
        ],
      })
    } finally { upstream.close() }

    diagram = apply(diagram, { kind: 'define_class', name: 'cool', style: 'fill:#abcdef,stroke:#123456' })
    diagram = apply(diagram, { kind: 'set_css_class', class: 'B', className: 'cool' })
    diagram = apply(diagram, { kind: 'set_class_style', class: 'B', style: 'color:#010203' })
    const reparsed = classDiagram(serializeMermaid(diagram))
    expect(reparsed.body.classDefs?.cool?.fill).toBe('#abcdef')
    expect(reparsed.body.classes.find(item => item.id === 'B')).toEqual(expect.objectContaining({ className: 'cool', style: { color: '#010203' } }))
  })

  test('a %% comment after classDef or style paint is a comment, and the paint before it is drawn (BUG-56)', async () => {
    const sources = ['classDiagram\n  class A:::hot\n  classDef hot fill:#f00 %% c', 'classDiagram\n  class A\n  style A fill:#f00 %% c']
    const typed = sources.map(classDiagram)
    expect([typed[0]!.body.classDefs?.hot, typed[1]!.body.classes[0]?.style]).toEqual([{ fill: '#f00' }, { fill: '#f00' }])
    for (const source of sources) expect(renderMermaidSVG(source)).toContain('fill="#f00"')
    expect(sources.map(source => verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : [])))
      .toEqual([['class_style_comment@3'], ['class_style_comment@3']])
    // Mermaid reads the comment into the value, which CSS drops; the output has no comment.
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.projectAll([sources[1]!, serializeMermaid(typed[1]!)], diagram => diagram.db.getClasses().get('A').styles))
        .toEqual([['fill:#f00 %% c'], ['fill:#f00']])
    } finally { upstream.close() }
  })

  test('a class named like an Object.prototype key is an ordinary class', () => {
    const parsed = classDiagram('classDiagram\n  class A\n  classDef __proto__ fill:#ff0000\n  cssClass "A" __proto__')
    const defined = apply(classDiagram('classDiagram\n  class A\n  cssClass "A" __proto__'), { kind: 'define_class', name: '__proto__', style: 'fill:#0000ff' })
    for (const [diagram, fill] of [[parsed, '#ff0000'], [defined, '#0000ff']] as const) {
      expect(Object.entries(diagram.body.classDefs ?? {})).toEqual([['__proto__', { fill }]])
      const reparsed = parseClassDiagram(lines(serializeMermaid(diagram)))
      expect(reparsed.classDefs.get('__proto__')?.fill).toBe(fill)
    }
  })

  test('paint mutations reject line breaks that would create classes', () => {
    const diagram = classDiagram('classDiagram\n  class A')
    for (const operation of [
      { kind: 'define_class', name: 'hot', style: 'fill:#f00\nclass Injected' },
      { kind: 'set_class_style', class: 'A', style: 'fill:#f00\rclass Injected' },
    ] as ClassMutationOp[]) {
      const result = mutate(diagram, operation)
      expect(result.ok, operation.kind).toBe(false)
      if (!result.ok) expect(result.error).toMatchObject({ code: 'INVALID_OP', message: expect.stringContaining('single-line') })
    }
    expect(classDiagram(serializeMermaid(diagram)).body).toEqual(diagram.body)
  })

  test('single-line namespaces enter both parsers and terminal frames', () => {
    const source = 'classDiagram\n  namespace Domain { class Account; class Ledger }\n  Account --> Ledger'
    const parsed = parseClassDiagram(lines(source))
    expect(parsed.namespaces[0]?.classIds).toEqual(['Account', 'Ledger'])
    const typed = classDiagram(source)
    expect(typed.body.classes.map(item => [item.id, item.namespace])).toEqual([
      ['Account', 'Domain'], ['Ledger', 'Domain'],
    ])
    expect(serializeMermaid(typed)).toContain('namespace Domain {')

    const terminal = renderMermaidASCII(source, { useAscii: true, colorMode: 'none' }).split('\n')
    const namespaceRow = terminal.findIndex(row => row.includes('Domain'))
    const accountRow = terminal.findIndex(row => row.includes('Account'))
    const ledgerRow = terminal.findIndex(row => row.includes('Ledger'))
    expect(namespaceRow).toBeGreaterThanOrEqual(0)
    expect(accountRow).toBeGreaterThan(namespaceRow)
    expect(ledgerRow).toBeGreaterThan(namespaceRow)
    expect(terminal[namespaceRow]).toMatch(/\+[-]+ Domain [-]+\+/)
  })

  test('hierarchicalNamespaces:false lays nested namespace compounds out as siblings and is not warned', () => {
    const body = `classDiagram
      namespace Company {
        namespace Platform {
          class API
        }
      }`
    const nested = renderMermaidSVG(body)
    const compactSource = `---
config:
  class:
    hierarchicalNamespaces: false
---
${body}`
    const compact = renderMermaidSVG(compactSource)
    expect(nested).toContain('data-parent-id="Company"')
    expect(compact).not.toContain('data-parent-id="Company"')
    expect(compact).toContain('data-label="Company.Platform"')
    expect(compact.replace(/<[^>]*>/g, '')).toContain('Company.Platform')
    expect(compact).not.toContain('data-id="Company"')
  })

  test('c5-stress allocates every cardinality box without card/card or card/node overlap', () => {
    const spokes = Array.from({ length: 12 }, (_, index) => `Hub "1" --> "0..${index + 1}" Leaf${index} : rel${index}`).join('\n')
    const positioned = layoutClassDiagram(parseClassDiagram(lines(`classDiagram\n${spokes}`)))
    const boxes: Array<{ id: string; x0: number; y0: number; x1: number; y1: number }> = []
    for (const [index, relation] of positioned.relationships.entries()) {
      for (const [side, text, point] of [
        ['from', relation.fromCardinality, relation.fromCardinalityPosition],
        ['to', relation.toCardinality, relation.toCardinalityPosition],
      ] as const) {
        expect(point, `missing ${side} position for relation ${index}`).toBeDefined()
        const metrics = measureMultilineText(text!, 11, 400)
        boxes.push({ id: `${index}:${side}`, x0: point!.x - metrics.width / 2 - 2, y0: point!.y - metrics.height / 2 - 2, x1: point!.x + metrics.width / 2 + 2, y1: point!.y + metrics.height / 2 + 2 })
      }
    }
    const overlaps = (a: typeof boxes[number], b: typeof boxes[number]) =>
      Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5
    for (let left = 0; left < boxes.length; left++) {
      for (let right = left + 1; right < boxes.length; right++) expect(overlaps(boxes[left]!, boxes[right]!)).toBe(false)
      for (const node of positioned.classes) {
        const nodeBox = { id: node.id, x0: node.x, y0: node.y, x1: node.x + node.width, y1: node.y + node.height }
        expect(overlaps(boxes[left]!, nodeBox), `${boxes[left]!.id} overlaps ${node.id}`).toBe(false)
      }
    }
  })

  test('external relationships keep flattened namespace headers clear while retaining orthogonal class endpoints', () => {
    for (const [company, vendor] of [['Company.Platform', 'Vendor.Platform'], ['Company.Engineering.Backend', 'Vendor.Engineering.Backend']]) for (const direction of ['TB', 'BT', 'LR', 'RL']) for (const relationship of ['API --> Worker', 'Worker --> API']) {
      const source = `classDiagram\n direction ${direction}\n namespace ${company} { class API }\n namespace ${vendor} { class Worker }\n ${relationship} : invokes`
      const positioned = layoutClassDiagram(parseClassDiagram(lines(source)), { class: { hierarchicalNamespaces: false } })
      expect(positioned.namespaces.map(ns => ns.label).sort()).toEqual([company!, vendor!])
      for (const relation of positioned.relationships) {
        const source = positioned.classes.find(node => node.id === relation.from)!
        const target = positioned.classes.find(node => node.id === relation.to)!
        for (const [point, node] of [[relation.points[0]!, source], [relation.points.at(-1)!, target]] as const) {
          const onVerticalSide = (Math.abs(point.x - node.x) < 0.01 || Math.abs(point.x - node.x - node.width) < 0.01) && point.y >= node.y - 0.01 && point.y <= node.y + node.height + 0.01
          const onHorizontalSide = (Math.abs(point.y - node.y) < 0.01 || Math.abs(point.y - node.y - node.height) < 0.01) && point.x >= node.x - 0.01 && point.x <= node.x + node.width + 0.01
          expect(onVerticalSide || onHorizontalSide, `${direction} ${relationship} endpoint on ${node.id}`).toBe(true)
        }
        for (let index = 1; index < relation.points.length; index++) {
          const a = relation.points[index - 1]!, b = relation.points[index]!
          expect([a.x, a.y, b.x, b.y].every(Number.isFinite)).toBe(true)
          expect([a, b].every(point => point.x >= 0 && point.y >= 0 && point.x <= positioned.width && point.y <= positioned.height)).toBe(true)
          expect(a.x === b.x || a.y === b.y).toBe(true)
          for (const namespace of positioned.namespaces) {
            const crossesHeader = a.x === b.x
              ? a.x > namespace.x && a.x < namespace.x + namespace.width && Math.max(a.y, b.y) > namespace.y && Math.min(a.y, b.y) < namespace.y + namespace.headerHeight
              : a.y > namespace.y && a.y < namespace.y + namespace.headerHeight && Math.max(a.x, b.x) > namespace.x && Math.min(a.x, b.x) < namespace.x + namespace.width
            expect(crossesHeader, `${direction} ${relationship} crosses ${namespace.id} header`).toBe(false)
          }
        }
      }
    }
  })

  test('zero configured namespace padding still reserves shaft and arrow clearance', () => {
    const source = 'classDiagram\n namespace Company.Platform { class API }\n namespace Vendor.Platform { class Worker }\n API --> Worker : invokes'
    const options = { class: { hierarchicalNamespaces: false }, style: { roles: { group: { paddingY: 0 } } } }
    const positioned = layoutClassDiagram(parseClassDiagram(lines(source)), options)
    expect(positioned.namespaces.map(namespace => namespace.id)).toEqual(['Company.Platform', 'Vendor.Platform'])
    expect(positioned.relationships).toHaveLength(1)
    const relation = positioned.relationships[0]!
    expect([relation.from, relation.to, relation.label]).toEqual(['API', 'Worker', 'invokes'])
    const target = positioned.classes.find(node => node.id === 'Worker')!
    const header = positioned.namespaces.find(namespace => namespace.id === 'Vendor.Platform')!
    const end = relation.points.at(-1)!, previous = relation.points.at(-2)!
    expect(end.y).toBe(target.y)
    expect(end.x).toBeGreaterThan(target.x)
    expect(end.x).toBeLessThan(target.x + target.width)
    expect(previous.x).toBe(end.x)
    expect(previous.y).toBeLessThan(end.y)
    // The emitted open arrow reaches eight units behind its tip. Its 1.5-unit
    // butt stroke adds this normal component at each open tail, beyond the
    // centreline envelope that the former zero-padding layout overlooked.
    expect(end.y - header.y - header.headerHeight).toBeGreaterThan(8 + 0.75 * 3 / Math.hypot(8, 3))
    for (let index = 1; index < relation.points.length; index++) {
      const a = relation.points[index - 1]!, b = relation.points[index]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
      for (const namespace of positioned.namespaces) {
        const crossesHeader = a.x === b.x
          ? a.x > namespace.x - 0.5 && a.x < namespace.x + namespace.width + 0.5 && Math.max(a.y, b.y) > namespace.y - 0.5 && Math.min(a.y, b.y) < namespace.y + namespace.headerHeight + 0.5
          : a.y > namespace.y - 0.5 && a.y < namespace.y + namespace.headerHeight + 0.5 && Math.max(a.x, b.x) > namespace.x - 0.5 && Math.min(a.x, b.x) < namespace.x + namespace.width + 0.5
        expect(crossesHeader, `shaft enters ${namespace.id} header`).toBe(false)
      }
    }
    const svg = renderMermaidSVG(source, options)
    expect(svg).toContain('data-label="invokes"')
    expect(svg).toContain('data-from="API" data-to="Worker"')
    const result = verifyMermaid(source, { renderOptions: options })
    expect(result.ok).toBe(true)
    expect(result.warnings.some(warning => warning.code === 'INTERNAL_ERROR')).toBe(false)
  })

  test.each(['elk', 'agentic'] as const)('official namespace fanout retains full paths and clears headers with sharp or rounded corners with %s', backend => {
    // Rounded bypass corners need room before the arrowhead and before a
    // nested header that the same route crosses.
    for (const hierarchicalNamespaces of [false, true]) for (const bendRadius of [0, 8]) for (const direction of ['TB', 'BT', 'LR', 'RL']) {
      const variant = `${direction} nested=${hierarchicalNamespaces} radius=${bendRadius}`
      const source = `classDiagram
direction ${direction}
namespace Company.Engineering.Backend {
  class Developer {
    +writeCode()
  }
}
namespace Company.Engineering.Frontend {
  class Designer {
    +createMockup()
  }
}
namespace Company {
  class CEO {
    +makeDecisions()
  }
}
CEO --> Developer : oversees
CEO --> Designer : oversees`
      const options = { graphLayout: { backend }, class: { hierarchicalNamespaces }, style: { roles: { edge: { bendRadius } } } }
      const positioned = layoutClassDiagram(parseClassDiagram(lines(source)), options)
      const svg = renderMermaidSVG(source, options)
      expect(positioned.namespaces.map(namespace => [namespace.id, namespace.label]).sort(), variant).toEqual(hierarchicalNamespaces
        ? [['Company', 'Company'], ['Company.Engineering', 'Engineering'], ['Company.Engineering.Backend', 'Backend'], ['Company.Engineering.Frontend', 'Frontend']]
        : [['Company', 'Company'], ['Company.Engineering.Backend', 'Company.Engineering.Backend'], ['Company.Engineering.Frontend', 'Company.Engineering.Frontend']])
      for (const label of ['Developer', 'Designer', 'CEO', 'writeCode()', 'createMockup()', 'makeDecisions()']) expect(svg.replace(/<[^>]*>/g, '')).toContain(label)
      expect(positioned.relationships.map(relation => [relation.from, relation.to])).toEqual([['CEO', 'Developer'], ['CEO', 'Designer']])
      for (const relation of positioned.relationships) for (let index = 1; index < relation.points.length; index++) {
        const a = relation.points[index - 1]!, b = relation.points[index]!
        expect([a.x, a.y, b.x, b.y].every(Number.isFinite)).toBe(true)
        expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true)
        for (const namespace of positioned.namespaces) {
          const crossesHeader = Math.abs(a.x - b.x) < 0.01
            ? a.x > namespace.x + 0.01 && a.x < namespace.x + namespace.width - 0.01 && Math.max(a.y, b.y) > namespace.y + 0.01 && Math.min(a.y, b.y) < namespace.y + namespace.headerHeight - 0.01
            : a.y > namespace.y + 0.01 && a.y < namespace.y + namespace.headerHeight - 0.01 && Math.max(a.x, b.x) > namespace.x + 0.01 && Math.min(a.x, b.x) < namespace.x + namespace.width - 0.01
          expect(crossesHeader, `${variant}: ${relation.from} -> ${relation.to} crosses ${namespace.id}`).toBe(false)
        }
      }
    }
  })
})

describe('Class header bypass carrier ownership', () => {
  test.each([
    { width: 1, markerX: 1000, lane: 31.5, before: 35.5, after: 64.5 },
    { width: 1, markerX: 30, lane: 68.5, before: 35.5, after: 64.5 },
    { width: 8, markerX: 1000, lane: 28, before: 32, after: 68 },
    { width: 8, markerX: 30, lane: 72, before: 32, after: 68 },
  ])('retains the admitted bypass around marker x=$markerX at width=$width', async ({ width, markerX, lane, before, after }) => {
    const { repairClassHeaderRoutes, classRelationshipPaintBoxes, classCarrierEntersMarker, classSegmentEntersBox } = await import('../class/owned-surfaces.ts')
    const { CLASS_STYLE_DEFAULTS } = await import('../class/layout.ts')
    const { resolveRenderStyle } = await import('../styles.ts')
    for (const transpose of [false, true]) {
      const point = (x: number, y: number) => transpose ? { x: y, y: x } : { x, y }
      const diagram: import('../class/types.ts').PositionedClassDiagram = {
        width: 1200, height: 1200, classes: [], notes: [],
        namespaces: [{ id: 'G', name: 'G', label: 'G', classIds: [], x: 40, y: 40, width: 20, height: 20, headerHeight: 20 }],
        relationships: [
          { from: 'S', to: 'T', type: 'link-solid', markerAt: 'none', points: [point(50, 0), point(50, 100)] },
          { from: 'M', to: 'N', type: 'inheritance', markerAt: 'from', points: [point(markerX, 50), point(markerX - 20, 50)] },
        ],
      }
      const style = { ...resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), lineWidth: width },
        original = structuredClone(diagram.relationships), changed = repairClassHeaderRoutes(diagram, style)
      // These are the original admitted routes: the nearby triangle excludes
      // the first side, while the distant triangle leaves that side available.
      expect([...changed]).toEqual([0])
      expect(diagram.relationships[0]!.points).toEqual([
        point(50, 0), point(50, before), point(lane, before), point(lane, after), point(50, after), point(50, 100),
      ])
      expect(diagram.relationships[1]).toEqual(original[1])
      const marker = classRelationshipPaintBoxes(diagram, style, true, undefined, false).find(p => p.edge === 1)!
      const route = diagram.relationships[0]!.points
      for (let i = 1; i < route.length; i++) {
        expect(classCarrierEntersMarker(route[i - 1]!, route[i]!, marker.pieces!, width)).toBe(false)
        expect(classSegmentEntersBox(route[i - 1]!, route[i]!, { x: 40, y: 40, width: 20, height: 20 })).toBe(false)
      }
    }
  })

  test.each(['vertical', 'horizontal'] as const)('keeps unrelated %s header detours visually distinct', async direction => {
    const { repairClassHeaderRoutes, classOwnedSurfaceViolations } = await import('../class/owned-surfaces.ts')
    const { finalClassHeaderNumericSeed } = await import('../class/header-lanes.ts')
    const { createClassMarkerAdmissionWork, chargeClassMarkerAdmissionWork } = await import('../class/marker-admission.ts')
    const { CLASS_STYLE_DEFAULTS } = await import('../class/layout.ts')
    const { resolveRenderStyle } = await import('../styles.ts')
    const card = (id: string, x: number, y: number) => ({ id, label: id, x, y, width: 120, height: 60, headerHeight: 40, attrHeight: 10, methodHeight: 10, attributes: [], methods: [] })
    const p: import('../class/types.ts').PositionedClassDiagram = direction === 'vertical'
      ? {
          width: 1000, height: 600, notes: [],
          classes: [card('S1', 120, 100), card('S2', 300, 100), card('T1', 120, 300), card('T2', 300, 300)],
          namespaces: [{ id: 'G', name: 'G', label: 'G', classIds: ['T1', 'T2'], x: 100, y: 200, width: 800, height: 200, headerHeight: 28 }],
          relationships: [
            { from: 'S1', to: 'T1', type: 'inheritance', markerAt: 'from', points: [{ x: 180, y: 160 }, { x: 180, y: 300 }] },
            { from: 'S2', to: 'T2', type: 'association', markerAt: 'to', points: [{ x: 360, y: 160 }, { x: 360, y: 300 }] },
          ],
        }
      : {
          width: 1600, height: 500, notes: [],
          classes: [card('S1', 20, 180), card('S2', 160, 180), card('T1', 1250, 180), card('T2', 1400, 180)],
          namespaces: [{ id: 'G', name: 'G', label: 'G', classIds: [], x: 400, y: 200, width: 800, height: 200, headerHeight: 28 }],
          relationships: [
            { from: 'S1', to: 'T1', type: 'inheritance', markerAt: 'from', points: [{ x: 140, y: 206 }, { x: 150, y: 206 }, { x: 150, y: 160 }, { x: 320, y: 160 }, { x: 320, y: 206 }, { x: 1250, y: 206 }] },
            { from: 'S2', to: 'T2', type: 'association', markerAt: 'to', points: [{ x: 280, y: 212 }, { x: 1220, y: 212 }, { x: 1220, y: 260 }, { x: 1390, y: 260 }, { x: 1390, y: 212 }, { x: 1400, y: 212 }] },
          ],
        }
    const before = structuredClone(p), style = resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), work = createClassMarkerAdmissionWork(), capture = {}
    repairClassHeaderRoutes(p, style, work, capture)
    const seed = finalClassHeaderNumericSeed(capture, p.relationships, style, () => chargeClassMarkerAdmissionWork(work))!
    expect(seed).toBeDefined()
    for (let i = 0; i < p.relationships.length; i++) {
      expect(seed.routes[i]!.raw).toEqual(p.relationships[i]!.points)
      expect(seed.routes[i]!.raw).not.toBe(p.relationships[i]!.points)
    }
    expect(seed.routes.some((route, i) => route.raw.length !== before.relationships[i]!.points.length)).toBe(true)
    expect(classOwnedSurfaceViolations(p, style)).toEqual([])
    const [one, two] = p.relationships
    let parallelInk = false
    for (let i = 1; i < one!.points.length; i++) for (let j = 1; j < two!.points.length; j++) {
      const a = one!.points[i - 1]!, b = one!.points[i]!, c = two!.points[j - 1]!, d = two!.points[j]!
      const vertical = a.x === b.x
      if (vertical !== (c.x === d.x)) continue
      const main = vertical ? 'y' : 'x', fixed = vertical ? 'x' : 'y'
      if (Math.abs(a[fixed] - c[fixed]) < style.lineWidth && Math.max(Math.min(a[main], b[main]), Math.min(c[main], d[main])) < Math.min(Math.max(a[main], b[main]), Math.max(c[main], d[main]))) parallelInk = true
    }
    expect(parallelInk, 'unrelated relationships co-own a positive-length painted trunk').toBe(false)
    expect(p.classes).toEqual(before.classes)
    expect(p.namespaces).toEqual(before.namespaces)
    expect(p.relationships.map(r => [r.from, r.to, r.type, r.markerAt, r.points[0], r.points.at(-1)])).toEqual(before.relationships.map(r => [r.from, r.to, r.type, r.markerAt, r.points[0], r.points.at(-1)]))
  })

  test('retains proper crossings and common endpoint contacts without sharing positive stems', async () => {
    const { classHeaderPeerClear, classHeaderDetourCandidates } = await import('../class/header-lanes.ts')
    const { createClassMarkerAdmissionWork, chargeClassMarkerAdmissionWork } = await import('../class/marker-admission.ts')
    const { CLASS_STYLE_DEFAULTS } = await import('../class/layout.ts')
    const { resolveRenderStyle } = await import('../styles.ts')
    const style = resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), work = createClassMarkerAdmissionWork(), charge = () => chargeClassMarkerAdmissionWork(work)
    const rel = (from: string, to: string, points: import('../types.ts').Point[]): import('../class/types.ts').PositionedClassRelationship => ({ from, to, type: 'link-solid', markerAt: 'none', points })
    const crossing = [rel('A', 'B', [{ x: 10, y: 50 }, { x: 90, y: 50 }]), rel('C', 'D', [{ x: 50, y: 10 }, { x: 50, y: 90 }])]
    expect(classHeaderPeerClear(crossing[0]!.points, 0, crossing, style, charge)).toBe(true)
    const candidates = classHeaderDetourCandidates({ header: { x: 40, y: 40, width: 20, height: 20 }, a: crossing[0]!.points[0]!, b: crossing[0]!.points[1]!, owner: 0, relationships: crossing, width: 120, height: 120, style, gap: 4, escape: 8, charge })
    const first = candidates.next().value!, cached = first.peerContext
    expect(first.peerProof.clear(crossing[0]!.points)).toBe(true)
    const forged = Object.create(Object.getPrototypeOf(first.peerProof)) as typeof first.peerProof
    expect(() => forged.clear(crossing[0]!.points)).toThrow()
    expect(() => Reflect.construct(Object.getPrototypeOf(first.peerProof).constructor, [Symbol('forged'), { active: true }, 0, cached, charge])).toThrow('Unauthorized Class header candidate proof')
    const second = candidates.next().value!
    expect(() => first.peerProof.clear(crossing[0]!.points)).toThrow('Stale Class header candidate proof')
    expect(second.peerProof.clear(crossing[0]!.points)).toBe(true)
    candidates.return(undefined)
    expect(() => second.peerProof.clear(crossing[0]!.points)).toThrow('Stale Class header candidate proof')
    // A request-local index must observe in-place peer edits, not rely on
    // unchanged point-array identity or reuse a previous successful result.
    Object.assign(crossing[1]!.points[0]!, { x: 10, y: 50 })
    Object.assign(crossing[1]!.points[1]!, { x: 90, y: 50 })
    expect(classHeaderPeerClear(crossing[0]!.points, 0, crossing, style, charge, cached)).toBe(false)
    Object.assign(crossing[1]!.points[0]!, { x: 50, y: 10 })
    Object.assign(crossing[1]!.points[1]!, { x: 50, y: 90 })
    expect(classHeaderPeerClear(crossing[0]!.points, 0, crossing, style, charge, cached)).toBe(true)
    const shared = [rel('S', 'A', [{ x: 10, y: 10 }, { x: 10, y: 50 }, { x: 0, y: 50 }, { x: 0, y: 80 }]), rel('S', 'B', [{ x: 10, y: 10 }, { x: 10, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 80 }])]
    expect(classHeaderPeerClear(shared[0]!.points, 0, shared, style, charge)).toBe(false)
    const unrelated = shared.map((r, i) => ({ ...r, from: `U${i}` }))
    expect(classHeaderPeerClear(unrelated[0]!.points, 0, unrelated, style, charge)).toBe(false)
    const endpoint = [rel('S', 'A', [{ x: 10, y: 10 }, { x: 90, y: 10 }]), rel('S', 'B', [{ x: 10, y: 10 }, { x: 10, y: 90 }])]
    expect(classHeaderPeerClear(endpoint[0]!.points, 0, endpoint, style, charge)).toBe(true)
    const differentPort = [endpoint[0]!, rel('S', 'B', [{ x: 10, y: 0 }, { x: 10, y: 90 }])]
    expect(classHeaderPeerClear(differentPort[0]!.points, 0, differentPort, style, charge)).toBe(false)
    const dashed = shared.map(r => ({ ...r, lineStyle: 'dashed' as const }))
    expect(classHeaderPeerClear(dashed[0]!.points, 0, dashed, style, charge)).toBe(false)
    const mixed = [shared[0]!, { ...shared[0]!, lineStyle: 'dashed' as const }]
    expect(classHeaderPeerClear(mixed[0]!.points, 0, mixed, style, charge)).toBe(false)
    const reversed = [dashed[0]!, { ...dashed[0]!, from: dashed[0]!.to, to: dashed[0]!.from, points: [...dashed[0]!.points].reverse() }]
    expect(classHeaderPeerClear(reversed[0]!.points, 0, reversed, style, charge)).toBe(false)
  })
})

describe('final served Class sharp contact admission', () => {
  const card = (id: string, x: number, y: number, width = 10, height = 20) => ({ id, label: id, x, y, width, height, headerHeight: height, attrHeight: 0, methodHeight: 0, attributes: [], methods: [] })
  const rel = (from: string, to: string, points: { x: number; y: number }[]) => ({ from, to, type: 'association' as const, markerAt: 'none' as const, points })
  const parallel = (): import('../class/types.ts').PositionedClassDiagram => ({ width: 140, height: 60, notes: [], namespaces: [], classes: [card('S', -10, -10), card('T', 100, -10)], relationships: [rel('S', 'T', [{ x: 0, y: 2e-11 }, { x: 100, y: 2e-11 }]), rel('S', 'T', [{ x: 0, y: 1.00000000002 }, { x: 100, y: 1.00000000002 }])] })
  test('rechecks all final served rows after a common Number translation creates positive ink', async () => {
    const { finalizeClassOwnedSurfaces, CLASS_STYLE_DEFAULTS } = await import('../class/layout.ts')
    const { createClassMarkerAdmissionWork } = await import('../class/marker-admission.ts')
    const { resolveRenderStyle } = await import('../styles.ts')
    const { formatSvgNumber } = await import('../shared/svg-number.ts')
    const style = { ...resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), lineWidth: 1, edgeBendRadius: 0, cornerRadius: 0 }, scene = parallel(), work = createClassMarkerAdmissionWork()
    expect(() => finalizeClassOwnedSurfaces(scene, style, work)).not.toThrow()
    const before = work.operations
    // The title/note owners use this same Number addition. Both original
    // served rows are exactly one pixel apart, with no positive strip overlap.
    for (const c of scene.classes) c.y += 20
    for (const r of scene.relationships) for (const p of r.points) p.y += 20
    expect(scene.relationships.map(r => formatSvgNumber(r.points[0]!.y))).toEqual(['20.00000000002', '21'])
    const unchanged = structuredClone(scene)
    expect(() => finalizeClassOwnedSurfaces(scene, style, work)).toThrow('uncertified shared contact')
    expect(work.operations).toBeGreaterThan(before)
    expect(scene).toEqual(unchanged)
  })
  test('keeps proper crossings and a legitimate common physical corner contact', async () => {
    const { finalizeClassOwnedSurfaces, CLASS_STYLE_DEFAULTS } = await import('../class/layout.ts')
    const { createClassMarkerAdmissionWork } = await import('../class/marker-admission.ts')
    const { resolveRenderStyle } = await import('../styles.ts')
    const style = { ...resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), lineWidth: 1, edgeBendRadius: 0, cornerRadius: 0 }
    const crossed: import('../class/types.ts').PositionedClassDiagram = { width: 140, height: 140, notes: [], namespaces: [], classes: [card('A', -10, 45, 10, 10), card('B', 100, 45, 10, 10), card('C', 45, -10, 10, 10), card('D', 45, 100, 10, 10)], relationships: [rel('A', 'B', [{ x: 0, y: 50 }, { x: 100, y: 50 }]), rel('C', 'D', [{ x: 50, y: 0 }, { x: 50, y: 100 }])] }
    const corner: import('../class/types.ts').PositionedClassDiagram = { width: 140, height: 140, notes: [], namespaces: [], classes: [card('S', -10, 0), card('T', 100, -10), card('U', -10, -110, 20, 10)], relationships: [rel('S', 'T', [{ x: 0, y: 0 }, { x: 100, y: 0 }]), rel('S', 'U', [{ x: 0, y: 0 }, { x: 0, y: -100 }])] }
    for (const scene of [crossed, corner]) {
      const before = structuredClone(scene), work = createClassMarkerAdmissionWork()
      expect(() => finalizeClassOwnedSurfaces(scene, style, work)).not.toThrow()
      expect(scene).toEqual(before)
      expect(work.operations).toBeGreaterThan(0)
    }
  })
  test('retains rounded geometry scope and spends only the existing request work', async () => {
    const { finalizeClassOwnedSurfaces, CLASS_STYLE_DEFAULTS } = await import('../class/layout.ts')
    const { createClassMarkerAdmissionWork } = await import('../class/marker-admission.ts')
    const { MAX_OCCLUSION_OPERATIONS } = await import('../scene/paint-certification.ts')
    const { resolveRenderStyle } = await import('../styles.ts')
    const scene = parallel(), style = { ...resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), lineWidth: 1, edgeBendRadius: 0, cornerRadius: 0 }
    for (const c of scene.classes) c.y += 20
    for (const r of scene.relationships) for (const p of r.points) p.y += 20
    expect(() => finalizeClassOwnedSurfaces(structuredClone(scene), { ...style, edgeBendRadius: 8 })).not.toThrow()
    const work = createClassMarkerAdmissionWork(); work.operations = MAX_OCCLUSION_OPERATIONS - 1
    const before = structuredClone(scene)
    expect(() => finalizeClassOwnedSurfaces(scene, style, work)).toThrow('work limit')
    expect(work.exhausted).toBe(true)
    expect(work.operations).toBe(MAX_OCCLUSION_OPERATIONS)
    expect(scene).toEqual(before)
  })
})


describe('final Class header numeric snapshots', () => {
  async function fixture() {
    const api = await import('../class/header-lanes.ts')
    const { CLASS_STYLE_DEFAULTS } = await import('../class/layout.ts')
    const { resolveRenderStyle } = await import('../styles.ts')
    const style = { ...resolveRenderStyle({}, CLASS_STYLE_DEFAULTS), lineWidth: 1, edgeBendRadius: 0 }
    const relationships: import('../class/types.ts').PositionedClassRelationship[] = [
      { from: 'A', to: 'B', type: 'link-solid', markerAt: 'none', points: [{ x: 10, y: 30 }, { x: 90, y: 30 }] },
      { from: 'C', to: 'D', type: 'link-solid', markerAt: 'none', points: [{ x: 50, y: 10 }, { x: 50, y: 90 }] },
    ]
    const candidates = api.classHeaderDetourCandidates({ header: { x: 40, y: 20, width: 20, height: 20 }, a: relationships[0]!.points[0]!, b: relationships[0]!.points[1]!, owner: 0, relationships, width: 120, height: 120, style, gap: 4, escape: 8, charge: () => true })
    const context = candidates.next().value!.peerContext
    candidates.return(undefined)
    const capture = {}
    api.captureClassHeaderNumericContext(capture, context)
    return { api, style, relationships, context, capture }
  }
  const tuples = (entries: readonly { key: number; piece: { owner: number; segment: number } }[]) => entries.map(entry => [entry.key, entry.piece.owner, entry.piece.segment])

  test('borrows unchanged prepared numeric rows and consumes the request-local capture', async () => {
    const { api, style, relationships, context, capture } = await fixture()
    const seed = api.finalClassHeaderNumericSeed(capture, relationships, style, () => true)!
    expect(seed.routes).toBe(context.routes)
    expect(seed.horizontal).toBe(context.horizontal)
    expect(seed.verticalEnds).toBe(context.verticalEnds)
    expect('pieces' in seed).toBe(false)
    expect('half' in seed).toBe(false)
    expect('peerProof' in seed).toBe(false)
    expect(tuples(seed.horizontal)).toEqual([[30, 0, 0]])
    expect(tuples(seed.vertical)).toEqual([[50, 1, 0]])
    expect(tuples(seed.horizontalEnds)).toEqual([[10, 0, 0], [90, 0, 0]])
    expect(tuples(seed.verticalEnds)).toEqual([[10, 1, 0], [90, 1, 0]])
    expect(api.finalClassHeaderNumericSeed(capture, relationships, style, () => true)).toBeUndefined()
  })
  test('refreshes in-place coordinates with exact canonical spelling and complete sorted endpoint lists', async () => {
    const { api, style, relationships, context, capture } = await fixture()
    relationships[1]!.points[0] = { x: 60.12345678901234, y: 15 }
    Object.assign(relationships[1]!.points[1]!, { x: 60.12345678901234, y: 95 })
    const seed = api.finalClassHeaderNumericSeed(capture, relationships, style, () => true)!
    expect(seed.routes[0]).toBe(context.routes[0])
    expect(seed.routes[1]!.raw).toEqual([{ x: 60.12345678901234, y: 15 }, { x: 60.12345678901234, y: 95 }])
    expect(seed.routes[1]!.points).toEqual([{ x: 60.123456789, y: 15 }, { x: 60.123456789, y: 95 }])
    expect(tuples(seed.vertical)).toEqual([[60.123456789, 1, 0]])
    expect(tuples(seed.verticalEnds)).toEqual([[15, 1, 0], [95, 1, 0]])
    expect(seed.horizontal[0]).toBe(context.horizontal[0])
    relationships[1]!.points[0]!.x = 70
    expect(seed.routes[1]!.raw[0]!.x).toBe(60.12345678901234)
    expect(seed.routes[1]!.points[0]!.x).toBe(60.123456789)
  })
  test('refreshes a replaced route with changed arity and interleaved axis entries', async () => {
    const { api, style, relationships, capture } = await fixture()
    relationships[0]!.points = [{ x: 10, y: 30 }, { x: 70, y: 30 }, { x: 70, y: 80 }]
    const seed = api.finalClassHeaderNumericSeed(capture, relationships, style, () => true)!
    expect(tuples(seed.horizontal)).toEqual([[30, 0, 0]])
    expect(tuples(seed.vertical)).toEqual([[50, 1, 0], [70, 0, 1]])
    expect(tuples(seed.horizontalEnds)).toEqual([[10, 0, 0], [70, 0, 0]])
    expect(tuples(seed.verticalEnds)).toEqual([[10, 1, 0], [30, 0, 1], [80, 0, 1], [90, 1, 0]])
    expect(seed.routes[0]!.raw).not.toBe(relationships[0]!.points)
    relationships[0]!.points[0]!.x = 20
    expect(seed.routes[0]!.points[0]!.x).toBe(10)
  })
  test.each(['identity', 'stroke', 'radius', 'count'] as const)('declines numeric reuse after %s dependency changes', async kind => {
    const { api, style, relationships, capture } = await fixture()
    if (kind === 'identity') relationships[0]!.from = 'changed'
    if (kind === 'stroke') style.lineWidth = 2
    if (kind === 'radius') style.edgeBendRadius = 8
    if (kind === 'count') relationships.pop()
    expect(api.finalClassHeaderNumericSeed(capture, relationships, style, () => true)).toBeUndefined()
    expect(api.finalClassHeaderNumericSeed(capture, relationships, { ...style, lineWidth: 1, edgeBendRadius: 0 }, () => true)).toBeUndefined()
  })
  test('charges newly formatted rows before publication and never caches an exhausted partial refresh', async () => {
    const { api, style, relationships, capture } = await fixture()
    for (const point of relationships[1]!.points) point.x = 60.12345678901234
    let remaining = 250
    expect(() => api.finalClassHeaderNumericSeed(capture, relationships, style, () => --remaining >= 0)).toThrow('work limit')
    expect(remaining).toBeLessThan(0)
    expect(api.finalClassHeaderNumericSeed(capture, relationships, style, () => true)).toBeUndefined()
  })
})
