/**
 * Class namespaces — render parser, ELK compound layout, and SVG rendering
 * (plan §Class 6; repo #118; upstream #7618).
 *
 * Upstream contract (verified against mermaid.js.org/syntax/classDiagram.html
 * 2026-07): `namespace X { class A }`, nesting both syntactic
 * (`namespace A { namespace B { … } }`) and dot-notation (`namespace A.B.C`
 * auto-creates parents), and display labels `namespace X["Label"]` (v11.15+).
 *
 * Invariant gates (P5 — these judge what the regenerated goldens pin):
 *   - every class box lies inside its namespace's box,
 *   - nested namespace boxes lie inside their parent's box,
 *   - the namespace box carries its label (display label when given).
 */
import { describe, it, expect } from 'bun:test'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { layoutMermaid, mutate, parseRegisteredMermaid as parseMermaid, renderMermaidSVG as renderParsedSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { toMermaidLines } from '../mermaid-source.ts'

const parse = (src: string) => parseClassDiagram(toMermaidLines(src))

const NS_BASIC = `classDiagram
namespace Shapes {
  class Triangle
  class Square {
    +double side
  }
}
class Free
Triangle --> Free`

const NS_NESTED = `classDiagram
namespace Platform {
  namespace Auth {
    class UserService {
      +login()
    }
  }
  namespace Data {
    class Store
  }
}
UserService --> Store`

const NS_DOTTED = `classDiagram
namespace Company.Engineering.Backend {
  class Developer {
    +writeCode()
  }
}
namespace Company.Engineering.Frontend {
  class Designer {
    +designUI()
  }
}`

const NS_LABELED = `classDiagram
namespace Auth["Authentication Service"] {
  class UserService {
    +login()
  }
}`

interface Box { x: number; y: number; width: number; height: number }
const inside = (inner: Box, outer: Box, tol = 0.5): boolean =>
  inner.x >= outer.x - tol && inner.y >= outer.y - tol &&
  inner.x + inner.width <= outer.x + outer.width + tol &&
  inner.y + inner.height <= outer.y + outer.height + tol

describe('class namespaces — render parser', () => {
  it('records membership for flat namespaces', () => {
    const d = parse(NS_BASIC)
    expect(d.classes.map(c => c.id).sort()).toEqual(['Free', 'Square', 'Triangle'])
    const ns = d.namespaces.find(n => n.name === 'Shapes')
    expect(ns).toBeDefined()
    expect([...ns!.classIds].sort()).toEqual(['Square', 'Triangle'])
    // members keep their compartments
    const square = d.classes.find(c => c.id === 'Square')!
    expect(square.attributes.length).toBe(1)
  })

  it('parses syntactic nesting into a namespace tree', () => {
    const d = parse(NS_NESTED)
    const platform = d.namespaces.find(n => n.name === 'Platform')
    expect(platform).toBeDefined()
    const childNames = platform!.children.map(c => c.name).sort()
    expect(childNames).toEqual(['Auth', 'Data'])
    const auth = platform!.children.find(c => c.name === 'Auth')!
    expect(auth.classIds).toEqual(['UserService'])
  })

  it('parses dot notation, sharing auto-created parents', () => {
    const d = parse(NS_DOTTED)
    const company = d.namespaces.find(n => n.name === 'Company')
    expect(company).toBeDefined()
    expect(company!.children.map(c => c.name)).toEqual(['Engineering'])
    const engineering = company!.children[0]!
    expect(engineering.children.map(c => c.name).sort()).toEqual(['Backend', 'Frontend'])
    expect(engineering.children.find(c => c.name === 'Backend')!.classIds).toEqual(['Developer'])
    expect(engineering.children.find(c => c.name === 'Frontend')!.classIds).toEqual(['Designer'])
  })

  it('parses display labels (namespace X["Label"])', () => {
    const d = parse(NS_LABELED)
    const auth = d.namespaces.find(n => n.name === 'Auth')
    expect(auth).toBeDefined()
    expect(auth!.label).toBe('Authentication Service')
    expect(auth!.classIds).toEqual(['UserService'])
  })
})

describe('class namespaces — compound layout invariants', () => {
  it.each(['ns:Domain', 'ns:Domain#1'])('keeps the authored namespace-looking ID %s as a class through rendering and edits', id => {
    const source = `classDiagram\nclass \`${id}\`["Authored card"]\nnote for \`${id}\` "Owned note"`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('class')
    for (const text of [source, serializeMermaid(parsed.value)]) {
      const positioned = layoutClassDiagram(parse(text))
      expect(positioned.classes.map(node => node.id)).toEqual([id])
      expect(positioned.namespaces).toEqual([])
      expect(positioned.notes[0]).toMatchObject({ for: id, text: 'Owned note' })
      expect(positioned.notes[0]!.targetX).toBeDefined()
      expect(renderMermaidSVG(text)).toContain(`class="class-node" data-id="${id}"`)
    }
    expect(layoutMermaid(parsed.value).groups).toEqual([])
    expect(renderParsedSVG(parsed.value)).toBe(renderMermaidSVG(source))
    const renamed = mutate(parsed.value, { kind: 'rename_class', from: id, to: 'ns:Renamed' })
    if (!renamed.ok) throw new Error(JSON.stringify(renamed.error))
    expect(renderParsedSVG(renamed.value)).toContain('class="class-node" data-id="ns:Renamed"')
  })

  it('reserves authored IDs and generated-looking suffixes before allocating a namespace compound', () => {
    const source = 'classDiagram\nnamespace Domain {\nclass `ns:Domain`["First card"]\nclass Peer\n}\nclass `ns:Domain#1`["Suffix card"]\n`ns:Domain` --> Peer : inside relation'
    const positioned = layoutClassDiagram(parse(source))
    expect(positioned.classes.map(node => node.id).sort()).toEqual(['Peer', 'ns:Domain', 'ns:Domain#1'])
    expect(positioned.namespaces.map(group => group.id)).toEqual(['Domain'])
    const group = positioned.namespaces[0]!
    expect(group.classIds).toEqual(['ns:Domain', 'Peer'])
    for (const id of group.classIds) expect(inside(positioned.classes.find(node => node.id === id)!, group)).toBe(true)
    expect(inside(positioned.classes.find(node => node.id === 'ns:Domain#1')!, group)).toBe(false)
    expect(positioned.relationships[0]).toMatchObject({ from: 'ns:Domain', to: 'Peer', label: 'inside relation' })
    expect(positioned.relationships[0]!.points.length).toBeGreaterThanOrEqual(2)
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('>First card</text>')
    expect(svg).toContain('>Suffix card</text>')
    expect(svg).toContain('>inside relation</text>')
  })

  it.each([true, false])('hosts parallel relationships on actual namespace ancestry (hierarchical=%s)', hierarchicalNamespaces => {
    const source = 'classDiagram\nnamespace `Root.Left` {\nclass Left\n}\nnamespace `Root.Right` {\nclass Right\n}\nLeft --> Right : crossing\nLeft --> Right : parallel'
    const positioned = layoutClassDiagram(parse(source), { class: { hierarchicalNamespaces } })
    expect(positioned.classes.map(node => node.id).sort()).toEqual(['Left', 'Right'])
    const left = positioned.namespaces.find(group => group.id === 'Root.Left')!
    const right = positioned.namespaces.find(group => group.id === 'Root.Right')!
    expect(left.parentId).toBeUndefined()
    expect(right.parentId).toBeUndefined()
    expect(inside(positioned.classes.find(node => node.id === 'Left')!, left)).toBe(true)
    expect(inside(positioned.classes.find(node => node.id === 'Right')!, right)).toBe(true)
    expect(positioned.relationships.map(edge => [edge.from, edge.to, edge.label])).toEqual([['Left', 'Right', 'crossing'], ['Left', 'Right', 'parallel']])
    for (const edge of positioned.relationships) expect(edge.points.length).toBeGreaterThanOrEqual(2)
    expect(positioned.relationships[0]!.points).not.toEqual(positioned.relationships[1]!.points)
  })

  it.each([undefined, 'elk', 'agentic'] as const)('places freestanding notes when there are no classes or namespaces (backend=%s)', backend => {
    const source = 'classDiagram\nnote "First freestanding note"\nnote "Second freestanding note"'
    const options = backend ? { graphLayout: { backend, fallback: 'none' as const } } : {}
    const positioned = layoutClassDiagram(parse(source), options)
    expect(positioned.classes).toEqual([])
    expect(positioned.namespaces).toEqual([])
    expect(positioned.notes.map(note => note.text)).toEqual(['First freestanding note', 'Second freestanding note'])
    const [first, second] = positioned.notes
    expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height)
    for (const note of positioned.notes) {
      expect([note.x, note.y, note.width, note.height].every(Number.isFinite)).toBe(true)
      expect(note.width).toBeGreaterThan(0)
      expect(note.height).toBeGreaterThan(0)
      expect(note.x).toBeGreaterThanOrEqual(0)
      expect(note.y).toBeGreaterThanOrEqual(0)
      expect(note.x + note.width).toBeLessThanOrEqual(positioned.width)
      expect(note.y + note.height).toBeLessThanOrEqual(positioned.height)
    }
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const svg = renderParsedSVG(parsed.value, options)
    expect(svg).toBe(renderMermaidSVG(source, options))
    for (const note of positioned.notes) expect(svg).toContain(`>${note.text}</text>`)
  })

  it('every member class box lies inside its namespace box', () => {
    const pos = layoutClassDiagram(parse(NS_BASIC))
    const shapes = pos.namespaces.find(n => n.name === 'Shapes')
    expect(shapes).toBeDefined()
    for (const id of ['Triangle', 'Square']) {
      const cls = pos.classes.find(c => c.id === id)!
      expect({ id, inside: inside(cls, shapes!) }).toEqual({ id, inside: true })
    }
    // the free class stays outside
    const free = pos.classes.find(c => c.id === 'Free')!
    expect(inside(free, shapes!)).toBe(false)
    // cross-boundary relationship still has a real route
    expect(pos.relationships[0]!.points.length).toBeGreaterThanOrEqual(2)
  })

  it('nested namespace boxes lie inside their parent box', () => {
    const pos = layoutClassDiagram(parse(NS_NESTED))
    const platform = pos.namespaces.find(n => n.name === 'Platform')!
    const auth = pos.namespaces.find(n => n.name === 'Auth')!
    const data = pos.namespaces.find(n => n.name === 'Data')!
    expect(inside(auth, platform)).toBe(true)
    expect(inside(data, platform)).toBe(true)
    const userService = pos.classes.find(c => c.id === 'UserService')!
    expect(inside(userService, auth)).toBe(true)
  })

  it('dot notation lays out the shared parent chain once', () => {
    const pos = layoutClassDiagram(parse(NS_DOTTED))
    const companies = pos.namespaces.filter(n => n.name === 'Company')
    const engineerings = pos.namespaces.filter(n => n.name === 'Engineering')
    expect(companies.length).toBe(1)
    expect(engineerings.length).toBe(1)
    expect(inside(engineerings[0]!, companies[0]!)).toBe(true)
  })

  it('members clear the namespace header band', () => {
    const pos = layoutClassDiagram(parse(NS_BASIC))
    const shapes = pos.namespaces.find(n => n.name === 'Shapes')!
    for (const id of ['Triangle', 'Square']) {
      const cls = pos.classes.find(c => c.id === id)!
      expect(cls.y).toBeGreaterThanOrEqual(shapes.y + shapes.headerHeight - 0.5)
    }
  })
})

describe('class namespaces — SVG rendering', () => {
  it('draws the namespace box with its label', () => {
    const svg = renderMermaidSVG(NS_BASIC)
    expect(svg).toContain('class="namespace"')
    expect(svg).toContain('data-id="Shapes"')
    expect(svg).toContain('>Shapes<')
  })

  it('uses the display label when one is given', () => {
    const svg = renderMermaidSVG(NS_LABELED)
    // The drawn title text, not the data-label attribute that also carries it.
    expect(svg).toContain('>Authentication Service</text>')
    expect(svg).not.toContain('>Auth</text>')
  })

  it('namespace-free diagrams render without namespace chrome', () => {
    const svg = renderMermaidSVG('classDiagram\n  class A\n  class B\n  A --> B')
    expect(svg).not.toContain('class="namespace"')
  })
})

describe('class namespaces — agent layout + verify integration', () => {
  it('exposes namespaces as groups with members in the RenderedLayout', () => {
    const r = parseMermaid(NS_BASIC)
    if (!r.ok) throw new Error('parse failed')
    const layout = layoutMermaid(r.value)
    const group = layout.groups.find(g => g.id === 'Shapes')
    expect(group).toBeDefined()
    expect([...group!.members].sort()).toEqual(['Square', 'Triangle'])
  })

  it('verify: namespaced class diagram is clean (no GROUP_BREACH, no opaque warning)', () => {
    const v = verifyMermaid(NS_BASIC)
    expect(v.warnings.filter(w => w.code === 'GROUP_BREACH')).toEqual([])
    expect(v.warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    expect(v.ok).toBe(true)
  })
})
