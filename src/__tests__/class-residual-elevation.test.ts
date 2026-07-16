import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { asClass, type ClassMutationOp, type ClassValidDiagram } from '../agent/types.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCII } from '../ascii/index.ts'
import { measureMultilineText } from '../text-metrics.ts'

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
  test('models and renders classDef, class/cssClass, shorthand, and inline paint', () => {
    let diagram = classDiagram(`classDiagram
      class A
      B:::hot
      classDef hot fill:#ff0000,stroke:#220000,color:#ffffff
      cssClass A hot
      style A stroke-width:4px`)
    expect(diagram.body.classDefs?.hot?.fill).toBe('#ff0000')
    expect(diagram.body.classes.find(item => item.id === 'A')?.className).toBe('hot')
    expect(diagram.body.classes.find(item => item.id === 'A')?.style?.['stroke-width']).toBe('4px')
    expect(diagram.body.classes.find(item => item.id === 'B')?.className).toBe('hot')
    const svg = renderMermaidSVG(serializeMermaid(diagram))
    expect(svg).toContain('class="class-node hot"')
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).toContain('stroke-width="4"')

    diagram = apply(diagram, { kind: 'define_class', name: 'cool', style: 'fill:#abcdef,stroke:#123456' })
    diagram = apply(diagram, { kind: 'set_css_class', class: 'B', className: 'cool' })
    diagram = apply(diagram, { kind: 'set_class_style', class: 'B', style: 'color:#010203' })
    const reparsed = classDiagram(serializeMermaid(diagram))
    expect(reparsed.body.classDefs?.cool?.fill).toBe('#abcdef')
    expect(reparsed.body.classes.find(item => item.id === 'B')).toEqual(expect.objectContaining({ className: 'cool', style: { color: '#010203' } }))
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
})
