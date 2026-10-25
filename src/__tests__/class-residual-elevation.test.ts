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
  test('preserves native classDef, class/cssClass, shorthand and lone hyphenated inline paint without claiming editable output', () => {
    const source = `classDiagram
      class A
      B:::hot
      classDef hot fill:#ff0000,stroke:#220000,color:#ffffff
      cssClass A hot
      style A stroke-width:4px`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source + '\n')
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
    expect(mutate(parsed.value, { kind: 'set_css_class', class: 'B', className: 'cool' }).ok).toBe(false)
    expect(serializeMermaid(parsed.value)).toBe(source + '\n')
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
          { id: 'A', classes: 'default hot', styles: ['fill:#ff0000', 'stroke:#220000', 'color:#ffffff', 'fill:#112233', 'stroke-width:4px'] },
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

  test('a flattened header with no safe detour is a diagnosed layout failure', () => {
    const source = 'classDiagram\n namespace Company.Platform { class API }\n namespace Vendor.Platform { class Worker }\n API --> Worker : invokes'
    const options = { class: { hierarchicalNamespaces: false }, style: { roles: { group: { paddingY: 0 } } } }
    expect(() => renderMermaidSVG(source, options)).toThrow('cannot safely avoid namespace header Vendor.Platform')
    const result = verifyMermaid(source, { renderOptions: options })
    expect(result.ok).toBe(false)
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'INTERNAL_ERROR', reason: expect.stringContaining('cannot safely avoid namespace header Vendor.Platform'), defaultRender: 'fails' }))
  })

  test('official flattened namespace fanout renders and keeps rounded ELK shafts outside headers', () => {
    for (const direction of ['TB', 'BT', 'LR', 'RL']) {
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
      const positioned = layoutClassDiagram(parseClassDiagram(lines(source)), { class: { hierarchicalNamespaces: false } })
      const svg = renderMermaidSVG(source, { class: { hierarchicalNamespaces: false } })
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
          expect(crossesHeader, `${direction}: ${relation.from} -> ${relation.to} crosses ${namespace.id}`).toBe(false)
        }
      }
    }
  })
})
