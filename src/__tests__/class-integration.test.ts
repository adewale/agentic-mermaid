/**
 * Integration tests for class diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG, SceneValidationError } from '../index.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { DefaultBackend, getBackend, getFamily, validateSceneDoc } from '../agent/index.ts'
import type { SceneNode } from '../agent/index.ts'

function lowerPublicClass(positioned: ReturnType<typeof layoutClassDiagram>) {
  return getFamily('class')!.lowerScene!({ positioned, colors: { bg: '#ffffff', fg: '#111111', embedFontImport: false },
    resolved: { renderOptions: {} } })
}

/** The actual public layout/lowering fixture used by the pinned-a9 mutation
 * discovery. No private constructor or emitter participates in the oracle. */
function publicMutationFixture() {
  const text = 'classDiagram\n  class A\n  class B\n  A --> B : link'
  const lines = text.split('\n'), familyLines = lines.map(line => line.trim()).filter(Boolean)
  const source = { originalText: text, text, body: text, lines, familyBody: text, familyText: familyLines.join('\n'), familyLines,
    firstLine: familyLines[0]!, config: {}, frontmatter: {}, initDirectives: [], comments: [], accessibility: {} }
  const family = getFamily('class')!
  const result = family.layout!({ source, renderOptions: {} })
  const positioned = 'positioned' in result ? result.positioned : result
  const scene = family.lowerScene!({ positioned, colors: { bg: '#fff', fg: '#111', embedFontImport: false }, resolved: { renderOptions: {} } })
  const group = scene.parts.find(part => part.kind === 'group' && part.role === 'class-box')
  if (!group || group.kind !== 'group' || group.identity?.id !== 'A') throw new Error('Missing actual Class A group')
  const shape = group.children.find(child => child.node.kind === 'shape' && child.node.role === 'class-box')?.node
  const textMark = group.children.find(child => child.node.kind === 'text' && child.node.id === 'class:A:name')?.node
  const connector = scene.parts.find(part => part.kind === 'connector' && part.role === 'relationship')
  if (!shape || shape.kind !== 'shape' || shape.geometry.kind !== 'rect' || !shape.identity
    || !textMark || textMark.kind !== 'text' || !connector || connector.kind !== 'connector'
    || connector.route.geometry.kind !== 'polyline') throw new Error('Missing actual Class rectangle, text or relationship')
  return { positioned, scene, group, shape, textMark, connector }
}

describe('public Class construction mutation compatibility', () => {
  it.each(['default', 'rough', 'hybrid'])('rejects changed geometry, identity and text anchors before %s drawing', backendId => {
    const backend = getBackend(backendId)!
    for (const [field, message] of [
      ['geometry', 'Scene validation failed: scene: parts[3]/0(shape:class:A:box).x: semantic 47 != crisp 40'],
      ['identity', 'Scene validation failed: scene: parts[3]/0(shape:class:A:box): data-id class:A:box != typed caller-mutated-class-box'],
      ['anchor', 'Scene validation failed: scene: parts[3]/2(text:class:A:name).x: semantic 107 != crisp 100; scene: parts[3]/2(text:class:A:name).placement: outer coordinates differ from the retained text anchor'],
    ] as const) {
      const f = publicMutationFixture()
      if (f.shape.geometry.kind !== 'rect') throw new Error('Expected genuine rectangle')
      expect(f.shape.geometry.x).toBe(40)
      expect(f.textMark.x).toBe(100)
      if (field === 'geometry') f.shape.geometry.x += 7
      else if (field === 'identity') f.shape.identity!.id = 'caller-mutated-class-box'
      else f.textMark.x += 7
      expect(validateSceneDoc(f.scene).valid).toBe(false)
      expect(() => backend.render(f.scene, { seed: 0 })).toThrow(message)
      expect(Object.isFrozen(f.shape.geometry)).toBe(false)
      expect(Object.isFrozen(f.shape.identity)).toBe(false)
      expect(Object.isFrozen(f.textMark)).toBe(false)
    }
    expect(() => backend.render(publicMutationFixture().scene, { seed: 0 })).not.toThrow()
  })

  it('retains original Default ink and composition after each accepted public mutation', () => {
    for (const field of ['shape paint', 'text paint', 'text content', 'join', 'children', 'indent'] as const) {
      const f = publicMutationFixture()
      const pristine = DefaultBackend.render(f.scene, { seed: 0 })
      expect(pristine.length).toBe(5336)
      expect(pristine).toContain('>A</text>')
      if (field === 'shape paint') f.shape.paint.fill = '#123456'
      else if (field === 'text paint') f.textMark.paint.fill = '#123456'
      else if (field === 'text content') f.textMark.text = 'Caller Label'
      else if (field === 'join') f.group.join = ' '
      else if (field === 'children') f.group.children.pop()
      else f.group.children[0]!.indent += 2
      expect(validateSceneDoc(f.scene).valid).toBe(true)
      expect(DefaultBackend.render(f.scene, { seed: 0 })).toBe(pristine)
      expect(Object.isFrozen(f.scene)).toBe(false)
      expect(Object.isFrozen(f.group.children)).toBe(false)
      expect(Object.isFrozen(f.shape.paint)).toBe(false)
      expect(Object.isFrozen(f.textMark.paint)).toBe(false)
    }
  })

  // Styled expectations follow a9's crisp paint extraction plus live semantic
  // redraw/composition. They require actual a9 qualification before acceptance.
  it.each(['rough', 'hybrid'])('keeps crisp paint but recomposes current Group children and join in %s', backendId => {
    const backend = getBackend(backendId)!
    for (const field of ['shape paint', 'text paint', 'text content'] as const) {
      const f = publicMutationFixture()
      const pristine = backend.render(f.scene, { seed: 0 })
      if (field === 'shape paint') f.shape.paint.fill = '#123456'
      else if (field === 'text paint') f.textMark.paint.fill = '#123456'
      else f.textMark.text = 'Caller Label'
      expect(backend.render(f.scene, { seed: 0 })).toBe(pristine)
    }
    for (const field of ['join', 'children', 'indent'] as const) {
      const f = publicMutationFixture()
      const pristine = backend.render(f.scene, { seed: 0 })
      if (field === 'join') f.group.join = ' '
      else if (field === 'children') f.group.children.pop()
      else f.group.children[0]!.indent += 2
      const changed = backend.render(f.scene, { seed: 0 })
      expect(changed).not.toBe(pristine)
      if (field === 'join') expect(changed).toContain(`${f.group.open} `)
      expect(Object.isFrozen(f.group)).toBe(false)
      expect(Object.isFrozen(f.group.children)).toBe(false)
    }
  })

  it.each(['default', 'rough', 'hybrid'])('keeps public Group-opening and connector mutation refusals in %s', backendId => {
    const backend = getBackend(backendId)!
    for (const field of ['open', 'route', 'stroke', 'marker', 'label'] as const) {
      const f = publicMutationFixture()
      if (field === 'open') Object.defineProperty(f.group, 'open', { value: f.group.open.slice(0, -1) + ' data-authored="public-mutation">', writable: true, enumerable: true, configurable: true })
      else if (field === 'route') {
        if (f.connector.route.geometry.kind !== 'polyline') throw new Error('Expected genuine polyline')
        f.connector.route.geometry.points[0]!.x += 7
      } else if (field === 'stroke') f.connector.stroke.color = '#123456'
      else if (field === 'marker') delete f.connector.markers.end
      else f.connector.labels[0]!.text = 'Caller Link'
      const validation = validateSceneDoc(f.scene)
      expect(validation.valid).toBe(false)
      expect(validation.diagnostics).toHaveLength(field === 'route' ? 8 : 1)
      const message = field === 'open' ? 'crisp does not start with open tag'
        : field === 'route' ? 'must equal the endpoint derived from connector geometry'
          : 'must equal the canonical projection derived from connector semantics'
      expect(() => backend.render(f.scene, { seed: 0 })).toThrow(message)
      expect(Object.isFrozen(f.connector.stroke)).toBe(false)
      expect(Object.isFrozen(f.group)).toBe(false)
    }
  })

  it('returns the six-million-byte public opening before the unchanged node refusal and later authored getter', () => {
    const cls = { id: 'A', label: 'A', x: 20, y: 20, width: 140, height: 120, headerHeight: 40, attrHeight: 40,
      methodHeight: 40, attributes: [], methods: [], className: '&'.repeat(600_000) }
    const positioned = { width: 400, height: 180, classes: [cls], notes: [], namespaces: [], relationships: [] }
    const scene = lowerPublicClass(positioned)
    const group = scene.parts.find(part => part.kind === 'group' && part.role === 'class-box')!
    if (group.kind !== 'group') throw new Error('Missing genuine Class group')
    expect(Object.getOwnPropertyDescriptor(group, 'open')).toMatchObject({ writable: true, enumerable: true, configurable: true })
    expect(group.open.length).toBe(6_000_086)
    expect(() => DefaultBackend.render(scene, { seed: 0 })).toThrow('Scene validation failed: scene.parts[2]: has an oversized SVG serialization')
    expect(Object.isFrozen(cls)).toBe(false)
    const reads: string[] = []
    const second = { ...cls, id: 'B', label: 'B', x: 220, className: '' }
    Object.defineProperty(second, 'annotation', { enumerable: true, get() { reads.push('later B annotation'); throw new Error('authored later B annotation') } })
    expect(() => lowerPublicClass({ ...positioned, classes: [cls, second] })).toThrow('authored later B annotation')
    expect(reads).toEqual(['later B annotation'])
    expect(cls.className.length).toBe(600_000)
    expect(() => DefaultBackend.render(publicMutationFixture().scene, { seed: 0 })).not.toThrow()
  })

  it('retains the already captured child operands before native Group-map species publication', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A']))
    const descriptor = Object.getOwnPropertyDescriptor(Array, Symbol.species)!
    let writes = 0
    let scene: ReturnType<typeof lowerPublicClass> | undefined
    try {
      Object.defineProperty(Array, Symbol.species, { configurable: true, value: function (length: number) {
        return new Proxy(new Array<unknown>(length), { defineProperty(target, key, property) {
          const item = property.value as { node?: SceneNode } | undefined
          const node = item?.node
          if (writes === 0 && node?.kind === 'shape' && node.id === 'class:A:box' && node.geometry.kind === 'rect') {
            node.geometry.x += 7
            writes++
          }
          return Reflect.defineProperty(target, key, property)
        } })
      } })
      scene = lowerPublicClass(positioned)
    } finally { Object.defineProperty(Array, Symbol.species, descriptor) }
    expect(writes).toBe(1)
    expect(scene).toBeDefined()
    expect(() => DefaultBackend.render(scene!, { seed: 0 })).toThrow('semantic 47 != crisp 40')
    expect(Object.isFrozen(positioned)).toBe(false)
  })

  it('publishes only the five mutable public children through native Group species', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A']))
    const descriptor = Object.getOwnPropertyDescriptor(Array, Symbol.species)!
    const publications: { slot: string; kind: string; id: string; frozen: boolean; ordinaryPrototype: boolean }[] = []
    const publishedNodes: SceneNode[] = []
    const constructorLengths: number[] = []
    let scene: ReturnType<typeof lowerPublicClass> | undefined
    try {
      Object.defineProperty(Array, Symbol.species, { configurable: true, value: function (length: number) {
        if (constructorLengths.length >= 4096) throw new Error('Bounded species observation exceeded')
        constructorLengths.push(length)
        return new Proxy(new Array<unknown>(length), { defineProperty(target, key, property) {
          const item = property.value as { node?: SceneNode } | undefined
          const node = item?.node
          if (node && (node.kind === 'shape' || node.kind === 'text') && node.id.startsWith('class:A:')) {
            if (publications.length >= 64) throw new Error('Bounded child publication observation exceeded')
            publications.push({ slot: String(key), kind: node.kind, id: node.id, frozen: Object.isFrozen(node), ordinaryPrototype: Object.getPrototypeOf(node) === Object.prototype })
            publishedNodes.push(node)
          }
          return Reflect.defineProperty(target, key, property)
        } })
      } })
      scene = lowerPublicClass(positioned)
    } finally { Object.defineProperty(Array, Symbol.species, descriptor) }
    if (!scene) throw new Error('Missing actual public Class Scene')
    const group = scene.parts.find(part => part.kind === 'group' && part.role === 'class-box')
    if (!group || group.kind !== 'group') throw new Error('Missing actual public Class group')
    const svg = DefaultBackend.render(scene, { seed: 0 })
    expect(publications).toEqual([
      { slot: '0', kind: 'shape', id: 'class:A:box', frozen: false, ordinaryPrototype: true },
      { slot: '1', kind: 'shape', id: 'class:A:header', frozen: false, ordinaryPrototype: true },
      { slot: '2', kind: 'text', id: 'class:A:name', frozen: false, ordinaryPrototype: true },
      { slot: '3', kind: 'shape', id: 'class:A:divider:attrs', frozen: false, ordinaryPrototype: true },
      { slot: '4', kind: 'shape', id: 'class:A:divider:methods', frozen: false, ordinaryPrototype: true },
    ])
    expect(group.children).toHaveLength(5)
    for (let index = 0; index < 5; index++) expect<SceneNode>(publishedNodes[index]!).toBe(group.children[index]!.node)
    expect(svg).toContain('data-id="class:A:box"')
    expect(svg).toContain('>A</text>')
    expect(Object.isFrozen(positioned)).toBe(false)
    expect(Object.isFrozen(group)).toBe(false)
    expect(Object.isFrozen(group.children)).toBe(false)
  })
})

describe('public Class lowering observations', () => {
  it('captures annotation before independent class-name metadata and retains their authored values', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A']))
    const cls = positioned.classes[0]!
    const reads: string[] = []
    let names = 0
    Object.defineProperties(cls, {
      annotation: { enumerable: true, configurable: true, get() { reads.push('annotation'); return 'interface' } },
      className: { enumerable: true, configurable: true, get() {
        reads.push('className')
        return ++names <= 2 ? 'first' : 'second'
      } },
    })
    const svg = DefaultBackend.render(lowerPublicClass(positioned), { seed: 0 })
    expect(reads.slice(0, 6)).toEqual(['annotation', 'annotation', 'className', 'className', 'className', 'className'])
    expect(svg).toContain('class="class-node first"')
    expect(svg).toContain('data-class="second"')
    expect(svg).toContain('data-annotation="interface"')
    expect(Object.isFrozen(cls)).toBe(false)
  })

  it('reports the annotation getter failure before a competing class-name getter failure', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A']))
    Object.defineProperties(positioned.classes[0]!, {
      annotation: { enumerable: true, get() { throw new Error('authored annotation failure') } },
      className: { enumerable: true, get() { throw new Error('later class-name failure') } },
    })
    expect(() => lowerPublicClass(positioned)).toThrow('authored annotation failure')
  })

  it('reads member appearance before a competing authored-text getter failure', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A {', '+id: int', '}']))
    const member = positioned.classes[0]!.attributes[0]!
    Object.defineProperties(member, {
      isAbstract: { enumerable: true, get() { throw new Error('authored abstract appearance failure') } },
      sourceText: { enumerable: true, get() { throw new Error('later member text failure') } },
    })
    expect(() => lowerPublicClass(positioned)).toThrow('authored abstract appearance failure')
  })

  it('retains the later visibility glyph for independent prepared-text fidelity rejection', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A {', '+id: int', '}']))
    const member = positioned.classes[0]!.attributes[0]!
    const reads: string[] = []
    Object.defineProperty(member, 'visibility', { enumerable: true, configurable: true, get() {
      const glyph = reads.length === 5 ? '-' : '+'
      reads.push(glyph)
      return glyph
    } })
    const scene = lowerPublicClass(positioned)
    expect(reads).toEqual(['+', '+', '+', '+', '+', '-'])
    expect(() => DefaultBackend.render(scene, { seed: 0 })).toThrow('retained prepared text differs from actual SVG')
    expect(Object.isFrozen(member)).toBe(false)
  })

  it('captures a relationship lexical label before later cardinality observation', () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'A --> B : semantic']))
    const rel = positioned.relationships[0]!
    let labels = 0
    Object.defineProperty(rel, 'label', { enumerable: true, configurable: true, get() {
      return ++labels === 6 ? 'Lexical & <label>' : 'semantic'
    } })
    const svg = DefaultBackend.render(lowerPublicClass(positioned), { seed: 0 })
    expect(svg).toContain('data-label="Lexical &amp; &lt;label&gt;"')
    expect(svg).toContain('aria-label="A to B: semantic"')
    expect(Object.isFrozen(rel)).toBe(false)
  })
})

// Every class SVG defines all marker ids in <defs>, so marker assertions must
// read the drawn relationship element's own marker reference.
function relationshipTag(svg: string): string {
  const tag = svg.match(/<polyline class="class-relationship"[^>]*>/)?.[0]
  if (!tag) throw new Error('no class-relationship element in SVG')
  return tag
}

describe('public Class original marker resources', () => {
  for (const compound of [false, true]) it(`retains original crisp ink and exact admission diagnostics for a malformed ${compound ? 'compound' : 'root'}`, () => {
    const positioned = layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A']))
    const scene = lowerPublicClass(positioned)
    const definitions = scene.parts.find(part => part.kind === 'document' && part.element === 'definitions')
    if (!definitions || definitions.kind !== 'document' || !definitions.markerResources?.[0]) throw new Error('Missing public Class definitions')
    const original = DefaultBackend.drawNode(definitions, { seed: 0 })
    expect(original).toContain('<polygon points="0 0, 12 5, 0 10" fill="var(--bg)"')
    expect(validateSceneDoc(scene).valid).toBe(true)
    const marker = definitions.markerResources[0] as unknown as { geometry: unknown; paint: unknown }
    marker.paint = { fill: '#123456' }
    marker.geometry = compound
      ? { kind: 'compound', children: [{ kind: 'rect', x: 1, y: 2, width: 3, height: 4 }, { kind: 'unknown' }] }
      : { kind: 'unknown' }
    // Changing the public semantic fields cannot replace the original crisp
    // ink. Admission must still reject the malformed current geometry.
    expect(DefaultBackend.drawNode(definitions, { seed: 0 })).toBe(original)
    const diagnostics = [{ code: 'SCENE_DOCUMENT' as const, path: `scene.parts[1].markerResources[0].geometry${compound ? '.children[1]' : ''}.kind`, message: 'unknown geometry kind "unknown"' }]
    expect(validateSceneDoc(scene)).toEqual({ valid: false, diagnostics })
    let failure: unknown
    try { DefaultBackend.render(scene, { seed: 0 }) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(SceneValidationError)
    if (!(failure instanceof SceneValidationError)) throw new Error('Expected actual Scene admission refusal')
    expect(failure.diagnostics).toEqual(diagnostics)
    expect(Object.isFrozen(positioned)).toBe(false)
    expect(Object.isFrozen(scene)).toBe(false)
    expect(Object.isFrozen(marker)).toBe(false)
    expect(marker.paint).toEqual({ fill: '#123456' })
  })
})

describe('renderMermaidSVG – class diagrams', () => {
  it('renders a basic class diagram to valid SVG', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Animal {
        +String name
        +eat() void
      }`)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Animal')
    expect(svg).toContain('name')
    expect(svg).toContain('eat')
  })

  it('renders ::: styled class identities without a phantom member', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Account
      Account:::highlight`)
    expect(svg).toContain('Account')
    expect(svg).not.toContain('::highlight')
  })

  it('renders class with annotation', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Flyable {
        <<interface>>
        +fly() void
      }`)
    expect(svg).toContain('interface')
    expect(svg).toContain('Flyable')
    expect(svg).toContain('fly')
  })

  it('renders inheritance relationship with triangle marker', () => {
    const svg = renderMermaidSVG(`classDiagram
      Animal <|-- Dog`)
    expect(svg).toContain('Animal')
    expect(svg).toContain('Dog')
    // Inheritance uses a hollow triangle marker at the parent end
    expect(relationshipTag(svg)).toContain('marker-start="url(#cls-inherit)"')
  })

  it('repaints endpoint markers after class boxes so node fills cannot occlude them', () => {
    const svg = renderMermaidSVG(`classDiagram
      Account <|-- Savings
      Account o-- Transaction`)
    const lastClassBox = svg.lastIndexOf('<g class="class"')
    const overlays = [...svg.matchAll(/class="class-marker-overlay"/g)].map(match => match.index)

    expect(svg).toMatch(/<marker id="cls-inherit"[^>]*overflow="visible"/)
    expect(svg).toMatch(/<marker id="cls-aggregation"[^>]*viewBox="0 0 14 12"[^>]*overflow="hidden"/)
    expect(overlays).toHaveLength(2)
    expect(overlays.every(index => index > lastClassBox)).toBe(true)
    expect(svg).toMatch(/class="class-marker-overlay"[^>]*stroke-opacity="0"[^>]*marker-start="url\(#cls-inherit\)"/)
  })

  it('renders composition with filled diamond', () => {
    const svg = renderMermaidSVG(`classDiagram
      Car *-- Engine`)
    expect(relationshipTag(svg)).toContain('marker-start="url(#cls-composition)"')
  })

  it('renders aggregation with hollow diamond', () => {
    const svg = renderMermaidSVG(`classDiagram
      University o-- Department`)
    expect(relationshipTag(svg)).toContain('marker-start="url(#cls-aggregation)"')
  })

  it('renders dependency with dashed line', () => {
    const svg = renderMermaidSVG(`classDiagram
      Service ..> Repository`)
    expect(relationshipTag(svg)).toContain('stroke-dasharray')
    expect(relationshipTag(svg)).toContain('marker-end="url(#cls-arrow)"')
  })

  it('renders realization with dashed line and triangle', () => {
    const svg = renderMermaidSVG(`classDiagram
      Bird ..|> Flyable`)
    expect(relationshipTag(svg)).toContain('stroke-dasharray')
    expect(relationshipTag(svg)).toContain('marker-end="url(#cls-inherit)"')
  })

  it('renders relationship labels', () => {
    const svg = renderMermaidSVG(`classDiagram
      Customer --> Order : places`)
    expect(svg).toContain('places')
  })

  it.each(['</b>', '<b>', '<i></i>'])('retains formatting-only relationship source without inventing painted geometry: %s', label => {
    const source = `classDiagram\nclass A {\n+f(</b>) int\n}\nA <|-- B : ${label}`
    const positioned = layoutClassDiagram(parseClassDiagram(source.split('\n')))
    const relationship = positioned.relationships[0]!
    expect(relationship.label).toBe(label)
    expect(relationship.labelBlock?.prepared.source).toBe(label)
    expect(relationship.labelBlock?.text).toBe('')
    expect(relationship.labelPosition).toBeUndefined()
    const svg = renderMermaidSVG(source)
    // Members use literal display even when relationship text is formatting.
    expect(svg).toContain('&lt;/b&gt;')
    expect(relationshipTag(svg)).toContain('marker-start="url(#cls-inherit)"')
  })

  it('keeps unknown tag-like relationship text visible and measured', () => {
    const source = 'classDiagram\nA --> B : </c>'
    const relationship = layoutClassDiagram(parseClassDiagram(source.split('\n'))).relationships[0]!
    expect(relationship.labelBlock?.text).toBe('</c>')
    expect(relationship.labelPosition).toBeDefined()
    expect(renderMermaidSVG(source)).toContain('&lt;/c&gt;')
  })

  it('renders class compartments with divider lines', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Animal {
        +String name
        +eat() void
      }`)
    // Should have horizontal divider lines between compartments
    const lines = svg.match(/<line /g) ?? []
    // At least 2 dividers (header-attrs, attrs-methods)
    expect(lines.length).toBeGreaterThanOrEqual(2)
  })

  it('renders with dark colors', () => {
    const svg = renderMermaidSVG(`classDiagram
      class A {
        +x int
      }`, { bg: '#18181B', fg: '#FAFAFA' })
    expect(svg).toContain('--bg:#18181B')
  })

  it('renders a complete class hierarchy', () => {
    const svg = renderMermaidSVG(`classDiagram
      class Animal {
        <<abstract>>
        +String name
        +eat() void
      }
      class Dog {
        +String breed
        +bark() void
      }
      class Cat {
        +bool isIndoor
        +meow() void
      }
      Animal <|-- Dog
      Animal <|-- Cat`)
    expect(svg).toContain('Animal')
    expect(svg).toContain('Dog')
    expect(svg).toContain('Cat')
    expect(svg).toContain('abstract')
  })
})
