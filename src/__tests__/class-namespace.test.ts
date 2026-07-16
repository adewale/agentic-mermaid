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
import { layoutMermaid, parseRegisteredMermaid as parseMermaid, verifyMermaid } from '../agent/index.ts'
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
    expect(svg).toContain('Authentication Service')
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
