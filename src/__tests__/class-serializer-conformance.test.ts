/**
 * Class serializer → RENDERER-parser conformance guard (P3 pattern, scoped to
 * the constructs the namespace elevation added — repo #118's class-namespace
 * half; flowchart-parser-conformance.test.ts / sequence-serializer-conformance
 * are the pattern being extended).
 *
 * The fidelity contract: any form the agent serializer emits after a
 * SUCCEEDING op must re-parse through the renderer's parser
 * (src/class/parser.ts) to the same namespace structure the op promised —
 * membership lives in one grammar consumed by both sides, so the serializer
 * cannot emit a namespace block the renderer would drop.
 */
import { describe, expect, test } from 'bun:test'
import { decodeXML } from 'entities'
import { asClass, describeMermaidFacts, layoutMermaid, mutate, parseRegisteredMermaid as parseMermaid, renderMermaidASCII, renderMermaidSVG, serializeMermaid, synthesizeFromGraph, verifyMermaid } from '../agent/index.ts'
import type { ClassMutationOp, ClassValidDiagram } from '../agent/types.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { parseClassDiagram } from '../class/parser.ts'
import type { ClassNamespace } from '../class/types.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

function classDiagram(src: string): ClassValidDiagram {
  const r = parseMermaid(src)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  const c = asClass(r.value)
  if (!c) throw new Error('not a structured class body')
  return c
}

function apply(d: ClassValidDiagram, op: ClassMutationOp): ClassValidDiagram {
  const r = mutate(d, op)
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.value
}

/** Re-parse serialized agent output through the RENDERER parser. */
function renderParse(source: string) {
  const lines = source
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseClassDiagram(lines)
}

test('lollipop endpoints are separate named interface occurrences, not invented or shared class boxes', async () => {
  const cases = [
    { source: 'classDiagram\nbar ()-- foo', classes: ['foo'], interfaces: ['bar'] },
    { source: 'classDiagram\nclass Class01 {\nint amount\ndraw()\n}\nClass01 --() bar\nClass02 --() bar\nfoo ()-- Class01', classes: ['Class01', 'Class02'], interfaces: ['bar', 'bar', 'foo'] },
    { source: 'classDiagram\nclass interface0\nclass bar\nbar ()-- foo', classes: ['bar', 'foo', 'interface0'], interfaces: ['bar'] },
    { source: 'classDiagram\nPort~T~ ()-- Service', classes: ['Service'], interfaces: ['Port~T~'] },
    { source: 'classDiagram\nA ()--() B', classes: ['A', 'B'], interfaces: [] },
    { source: 'classDiagram\nnamespace Domain {\nclass A\n}\nA --() API', classes: ['A'], interfaces: ['API'] },
  ]
  const upstream = startUpstreamMermaid()
  try {
    for (const entry of cases) {
      const diagram = classDiagram(entry.source)
      const native = renderParse(entry.source)
      const interfaceNodes = native.classes.filter(node => node.isInterface)
      expect(
        native.classes
          .filter(node => !node.isInterface)
          .map(node => node.id)
          .sort(),
      ).toEqual(entry.classes)
      expect(interfaceNodes.map(node => node.label)).toEqual(entry.interfaces)
      expect(new Set(native.classes.map(node => node.id)).size).toBe(native.classes.length)
      expect(diagram.body.classes.filter(node => node.isInterface).map(node => node.label)).toEqual(entry.interfaces)
      const canonical = serializeMermaid(diagram)
      expect(classDiagram(canonical).body).toEqual(diagram.body)
      const projected = await upstream.projectAll([entry.source, canonical], d => ({
        classes: [...d.db.getClasses().keys()].sort(),
        interfaces: d.db
          .getData()
          .nodes.filter((node: any) => node.cssStyles?.includes('opacity: 0;'))
          .map((node: any) => node.label),
      }))
      expect(projected).toEqual([
        { classes: entry.classes, interfaces: entry.interfaces },
        { classes: entry.classes, interfaces: entry.interfaces },
      ])
      for (const input of [entry.source, canonical]) {
        const svg = renderMermaidSVG(input, { embedFontImport: false })
        for (const node of interfaceNodes) {
          const group = [...svg.matchAll(/<g\b[^>]*\bclass="class-interface"[^>]*>([\s\S]*?)<\/g>/g)].find(match => match[0].includes(`data-id="${node.id}"`))
          expect(group, node.id).not.toBeNull()
          expect(group?.[1]).not.toContain('<rect')
          expect(group?.[1]).toContain(node.label)
        }
        const terminal = renderMermaidASCII(input)
        for (const label of entry.interfaces) expect(terminal).toContain(label)
        expect(verifyMermaid(input).warnings.filter(w => w.code === 'RENDER_FAILED')).toEqual([])
      }
      if (entry.source.includes('namespace Domain')) expect(native.namespaces[0]?.classIds).toEqual(['A'])
    }
  } finally {
    upstream.close()
  }
})

test('public layout reports each interface circle at its actual marker geometry, separate from its name', () => {
  for (const direction of ['TB', 'LR', 'BT', 'RL'] as const) {
    for (const side of ['from', 'to'] as const) {
      const source = `classDiagram\ndirection ${direction}\n${side === 'from' ? 'NamedInterface ()-- Service' : 'Service --() NamedInterface'}`
      const parsed = parseMermaid(source)
      if (!parsed.ok) throw new Error('Expected parseable class source')
      const layout = layoutMermaid(parsed.value)
      const node = layout.nodes.find(node => node.id === 'interface0')!
      expect(node.shape).toBe('circle')
      expect(Number(node.w)).toBe(10)
      expect(Number(node.h)).toBe(10)
      const route = layout.edges[0]!.path!
      const endpoint = side === 'from' ? route[0]! : route.at(-1)!
      const neighbour = side === 'from' ? route[1]! : route.at(-2)!
      const length = Math.hypot(neighbour[0] - endpoint[0], neighbour[1] - endpoint[1])
      const towardConnector = [(neighbour[0] - endpoint[0]) / length, (neighbour[1] - endpoint[1]) / length]
      // The pinned marker is a radius5 circle, tangent at refX12 (cx7),
      // scaled by the default1 connector stroke, on the connector's side.
      const cx = endpoint[0] + towardConnector[0]! * 5
      const cy = endpoint[1] + towardConnector[1]! * 5
      expect(Math.abs(node.x + node.w / 2 - cx)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(node.y + node.h / 2 - cy)).toBeLessThanOrEqual(0.5)
      expect(node.label).toBe('NamedInterface')
      expect(node.labelBounds).toBeDefined()
      expect(node.labelBounds!.w).toBeGreaterThan(node.w)
      expect(layout.nodes.find(node => node.id === 'Service')?.shape).toBe('rectangle')
    }
  }
})

test('add_interface explicitly creates independent portable endpoints without retargeting existing classes', async () => {
  const original = classDiagram('classDiagram\nnamespace Domain {\nclass Service\n}\nclass Shared\nclass interface0')
  const mistaken = mutate(original, { kind: 'add_relation', from: 'Service', to: 'Shared', relKind: 'lollipop', markerAt: 'to' })
  expect(mistaken).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('use add_interface') } })
  let current = apply(original, { kind: 'add_interface', class: 'Service', label: 'Shared' })
  current = apply(current, { kind: 'add_interface', class: 'Service', label: 'Shared', side: 'from' })
  current = apply(current, { kind: 'add_interface', class: 'Service', label: 'Payment API' })
  expect(
    current.body.classes
      .filter(node => !node.isInterface)
      .map(node => node.id)
      .sort(),
  ).toEqual(['Service', 'Shared', 'interface0'])
  expect(current.body.classes.filter(node => node.isInterface).map(node => node.label)).toEqual(['Shared', 'Shared', 'Payment API'])
  expect(current.body.classes.filter(node => node.isInterface).some(node => node.id === 'interface0')).toBe(false)
  expect(current.body.classes.find(node => node.id === 'Service')?.namespace).toBe('Domain')
  expect(current.body.classes.filter(node => node.isInterface).every(node => node.namespace === undefined)).toBe(true)
  expect(current.body.relations.map(relation => [relation.from, relation.to])).toEqual([
    ['Service', 'interface0#1'],
    ['interface1', 'Service'],
    ['Service', 'interface2'],
  ])
  const canonical = serializeMermaid(current)
  expect(classDiagram(canonical).body).toEqual(current.body)
  const upstream = startUpstreamMermaid()
  try {
    expect(
      await upstream.project(canonical, d => ({
        classes: [...d.db.getClasses().keys()].sort(),
        interfaces: d.db
          .getData()
          .nodes.filter((node: any) => node.cssStyles?.includes('opacity: 0;'))
          .map((node: any) => node.label),
      })),
    ).toEqual({ ok: true, value: { classes: ['Service', 'Shared', 'interface0'], interfaces: ['Shared', 'Shared', 'Payment API'] } })
  } finally {
    upstream.close()
  }
  for (const label of ['', 'bad\nclass Injected', 'bad`name', 'Bad~T~']) {
    expect(mutate(original, { kind: 'add_interface', class: 'Service', label }).ok, label).toBe(false)
  }
  const literal = apply(original, { kind: 'add_interface', class: 'Service', label: 'A --> Injected', relationLabel: 'say \"hi\"; literal #quot;', lineStyle: 'dashed' })
  expect(literal.body.classes.filter(node => node.isInterface).map(node => node.label)).toEqual(['A --> Injected'])
  expect(literal.body.classes.some(node => node.id === 'Injected')).toBe(false)
  expect(literal.body.relations.at(-1)?.label).toBe('say \"hi\"; literal #quot;')
  expect(classDiagram(serializeMermaid(literal)).body).toEqual(literal.body)
  expect(original.body.classes.some(node => node.isInterface)).toBe(false)
})

test('typed class edits retain lollipop occurrences and remove only interfaces orphaned by their relationship', () => {
  let diagram = classDiagram('classDiagram\nclass A\nclass B\nA --() Shared\nB --() Shared')
  const interfaces = diagram.body.classes.filter(node => node.isInterface)
  expect(interfaces).toHaveLength(2)
  expect(diagram.body.relations.map(relation => relation.to)).toEqual(interfaces.map(node => node.id))
  const invalid = mutate(diagram, { kind: 'add_member', class: interfaces[0]!.id, text: '+invented' })
  expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('interface occurrence') } })
  diagram = apply(diagram, { kind: 'add_member', class: 'B', text: '+real' })
  expect(diagram.body.classes.filter(node => node.isInterface)).toHaveLength(2)
  expect(classDiagram(serializeMermaid(diagram)).body).toEqual(diagram.body)
  diagram = apply(diagram, { kind: 'remove_relation', index: 0 })
  expect(diagram.body.classes.filter(node => node.isInterface)).toHaveLength(1)
  expect(diagram.body.relations[0]?.from).toBe('B')
  expect(classDiagram(serializeMermaid(diagram)).body).toEqual(diagram.body)
  expect(diagram.body.classes.filter(node => !node.isInterface).map(node => node.id)).toEqual(['A', 'B'])
})

test('note edits write valid Mermaid while keeping literal quotes, backslashes and entity text', async () => {
  const text = 'A "quote", \\ path, and literal &quot;'
  const edited = apply(classDiagram('classDiagram\nclass A'), { kind: 'add_note', for: 'A', text })
  const source = serializeMermaid(edited)
  const upstream = startUpstreamMermaid()
  try {
    expect(await upstream.accepts(source)).toBe(true)
  } finally {
    await upstream.close()
  }
  expect(classDiagram(source).body.notes).toEqual([{ for: 'A', text }])
  expect(renderParse(source).notes).toEqual([{ for: 'A', text }])
})

test('Class entity text stays literal in labels, namespace titles, relations, cards and notes after an edit', async () => {
  const source = `classDiagram
namespace N["#lt;u#gt;group#lt;/u#gt;"] {
class A["#lt;b#gt;box#lt;/b#gt;"]
class B
}
A "#lt;i#gt;one#lt;/i#gt;" --> "#quot;many#quot;" B : #lt;s#gt;edge#lt;/s#gt;
note for A "#lt;b#gt;note#lt;/b#gt;"`
  const diagram = classDiagram(source)
  expect(diagram.body.classes[0]?.label).toBe('<b>box</b>')
  expect(diagram.body.namespaces?.[0]?.label).toBe('<u>group</u>')
  expect(diagram.body.relations[0]).toMatchObject({ label: '<s>edge</s>', fromCardinality: '<i>one</i>', toCardinality: '"many"' })
  expect(diagram.body.notes[0]?.text).toBe('<b>note</b>')
  const edited = apply(diagram, { kind: 'add_member', class: 'B', text: '+value' })
  const serialized = serializeMermaid(edited)
  const reparsed = classDiagram(serialized)
  expect(reparsed.body).toEqual(edited.body)
  expect(serializeMermaid(reparsed)).toBe(serialized)
  for (const current of [diagram, reparsed]) {
    const svg = renderMermaidSVG(current)
    const terminal = renderMermaidASCII(current)
    for (const text of ['<b>box</b>', '<u>group</u>', '<s>edge</s>', '<i>one</i>', '<b>note</b>']) {
      expect(svg).toContain(text.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      expect(terminal).toContain(text)
    }
  }
  const upstream = startUpstreamMermaid()
  try {
    expect(await upstream.accepts(serialized)).toBe(true)
  } finally {
    await upstream.close()
  }
})

test('Class typed labels and relationship text escape literal entity-looking text and quotes', async () => {
  let diagram = classDiagram('classDiagram\nclass A')
  diagram = apply(diagram, { kind: 'add_class', id: 'B', label: 'say "hi" and literal #quot;' })
  diagram = apply(diagram, { kind: 'add_relation', from: 'A', to: 'B', relKind: 'association', label: 'literal #quot;: end;' })
  diagram = apply(diagram, { kind: 'add_note', for: 'A', text: 'literal #quot; and "quote"' })
  const source = serializeMermaid(diagram)
  const reparsed = classDiagram(source)
  expect(reparsed.body.classes.find(node => node.id === 'B')?.label).toBe('say "hi" and literal #quot;')
  expect(reparsed.body.relations[0]?.label).toBe('literal #quot;: end;')
  expect(reparsed.body.notes[0]?.text).toBe('literal #quot; and "quote"')
  expect(describeMermaidFacts(reparsed)).toEqual(describeMermaidFacts(diagram))
  const upstream = startUpstreamMermaid()
  try {
    expect(await upstream.accepts(source)).toBe(true)
  } finally {
    await upstream.close()
  }
})

test('Class labels preserve real formatting beside literal entity-produced markup and measure the visible text', () => {
  const source = 'classDiagram\nclass A["**real** #42;literal#42; #lt;b#gt;tag#lt;/b#gt;"]'
  const diagram = classDiagram(source)
  const edited = apply(diagram, { kind: 'add_member', class: 'A', text: '+value' })
  const written = serializeMermaid(edited)
  expect(classDiagram(written).body.classes[0]?.label).toBe('**real** *literal* <b>tag</b>')
  expect(renderMermaidASCII(written)).toContain('real *literal* <b>tag</b>')
  expect(renderMermaidSVG(written)).toContain('&lt;b&gt;tag&lt;/b&gt;')
  expect(verifyMermaid(edited, { labelCharCap: 20 }).warnings.some(warning => warning.code === 'LABEL_OVERFLOW' && warning.target === 'A')).toBe(true)
})

test.each([
  ['literal heart', 'Top<br/>Bottom ♥', 'Bottom ♥', false],
  ['numeric heart', 'Top<br/>Bottom #9829;', 'Bottom ♥', false],
  ['mixed formatting and encoded breaks', '**Top**<br/>Bottom #9829; #lt;br#gt; #92;n', 'Bottom ♥ <br> \\n', false],
  ['updated declaration', '**Top**<br/>Bottom #9829; #lt;br#gt; #92;n', 'Bottom ♥ <br> \\n', true],
] as const)('namespace title round-trip: %s', (_name, authored, bottom, redeclared) => {
  const source = `classDiagram\n${redeclared ? 'namespace G["Earlier"] { class Old }\n' : ''}namespace G["${authored}"] {\nclass A\n}`
  const edited = apply(classDiagram(source), { kind: 'add_member', class: 'A', text: '+value' })
  const written = serializeMermaid(edited)
  const reloaded = classDiagram(written)
  expect(describeMermaidFacts(reloaded)).toEqual(describeMermaidFacts(edited))
  expect(reloaded.body.namespaces?.[0]?.label).toBe(`${authored.startsWith('**') ? '**Top**' : 'Top'}<br/>${bottom}`)
  expect(serializeMermaid(reloaded)).toBe(written)
  for (const current of [source, written]) {
    const positioned = layoutClassDiagram(renderParse(current))
    const namespace = positioned.namespaces[0]!
    const block = namespace.labelBlock!
    expect(block.prepared.lines.map(line => line.map(run => run.text).join(''))).toEqual(['Top', bottom])
    expect(namespace.headerHeight).toBeGreaterThanOrEqual(block.height)
    for (const cls of positioned.classes) expect(cls.y).toBeGreaterThanOrEqual(namespace.y + namespace.headerHeight)
    const drawn = [...renderMermaidSVG(current).matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!.replace(/<[^>]*>/g, '')))
    expect(drawn).toContain(`Top${bottom}`)
    for (const useAscii of [false, true]) {
      const rows = renderMermaidASCII(current, { colorMode: 'none', useAscii }).split('\n')
      expect(rows.some(row => row.includes('Top') && !row.includes('Bottom'))).toBe(true)
      expect(rows.some(row => row.includes(bottom) && !row.includes('Top'))).toBe(true)
    }
  }
  expect(verifyMermaid(reloaded, { labelCharCap: bottom.length - 1 }).warnings).toContainEqual({
    code: 'LABEL_OVERFLOW',
    target: 'namespace:G',
    charCount: bottom.length,
    limit: bottom.length - 1,
  })
})

test.each([
  ['#9829; #35; #amp;', '♥ # &'],
  ['literal #92;n', 'literal \\n'],
  ['a#quot;b', 'a"b'],
  ['literal #35;quot#59;', 'literal #quot;'],
])('Class display entities keep %s through edit and reload', async (authored, expected) => {
  const diagram = classDiagram(`classDiagram\nclass A["${authored}"]\nA --> B : ${authored}\nnote for A "${authored}"`)
  const edited = apply(diagram, { kind: 'add_member', class: 'B', text: '+value' })
  const source = serializeMermaid(edited)
  const reparsed = classDiagram(source)
  expect(reparsed.body.classes[0]?.label).toBe(expected)
  expect(reparsed.body.relations[0]?.label).toBe(expected)
  expect(reparsed.body.notes[0]?.text).toBe(expected)
  expect(describeMermaidFacts(reparsed)).toEqual(describeMermaidFacts(edited))
  expect(renderMermaidASCII(source)).toContain(expected)
  const upstream = startUpstreamMermaid()
  try {
    expect(await upstream.accepts(source)).toBe(true)
  } finally {
    await upstream.close()
  }
})

test('literal braces in inline members remain text through class serialization', async () => {
  const upstream = startUpstreamMermaid()
  try {
    for (const declaration of ['class A', 'namespace N {\nclass A\n}']) {
      const source = `classDiagram\n${declaration}\nA : String map{key}\nA : +run() Result}\nA : {literal`
      const original = classDiagram(source)
      expect(original.body.classes[0]!.members).toEqual(['String map{key}', '+run() Result}', '{literal'])
      const serialized = serializeMermaid(original)
      expect(await upstream.accepts(source)).toBe(true)
      expect(await upstream.accepts(serialized)).toBe(true)
      expect(classDiagram(serialized).body.classes).toEqual(original.body.classes)
      expect(renderParse(serialized).classes).toEqual(renderParse(source).classes)
      expect(renderParse(serialized).namespaces).toEqual(renderParse(source).namespaces)
    }
  } finally {
    upstream.close()
  }
})

test('mixed member syntax keeps order, class identity and namespace across serialization', async () => {
  const source = 'classDiagram\nnamespace N["Domain"] {\nclass A~T~["Display"] {\n<<interface>>\n+foo : string\n}\n}\nA : String map{key}\nclass A {\n+bar : int\n}\nA : +run() Result}\nclass A {\n+last : bool\n}'
  const original = classDiagram(source)
  expect(original.body.classes).toEqual([
    {
      id: 'A',
      namespace: 'N',
      label: 'Display',
      generic: 'T',
      members: ['<<interface>>', '+foo : string', 'String map{key}', '+bar : int', '+run() Result}', '+last : bool'],
    },
  ])
  const serialized = serializeMermaid(original)
  const upstream = startUpstreamMermaid()
  try {
    expect(await upstream.accepts(source)).toBe(true)
    expect(await upstream.accepts(serialized)).toBe(true)
  } finally {
    upstream.close()
  }
  expect(classDiagram(serialized).body.classes).toEqual(original.body.classes)
  expect(classDiagram(serialized).body.namespaces).toEqual(original.body.namespaces)
  expect(renderParse(serialized).classes).toEqual(renderParse(source).classes)
  expect(renderParse(serialized).namespaces).toEqual(renderParse(source).namespaces)
})

/** Flatten a namespace tree to { path → classIds } for structural equality. */
function membershipByPath(namespaces: ClassNamespace[], prefix = ''): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const ns of namespaces) {
    const path = prefix ? `${prefix}.${ns.name}` : ns.name
    out.set(path, [...ns.classIds].sort())
    for (const [k, v] of membershipByPath(ns.children, path)) out.set(k, v)
  }
  return out
}

const NAMESPACED = `classDiagram
namespace Shapes {
  class Triangle
  class Square {
    +double side
    +area() double
  }
}
class Free
Triangle --> Free : points at`

describe('class labeled declaration conformance', () => {
  test('portable Class direction text retains labels and members across keyword tokens', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const label of ['direction RL', 'prefix direction LRbel', 'direction TB', 'direction BT', 'DIRECTION RL', 'direction#32;RL']) {
        const source = `classDiagram\nnamespace N["${label}"] {\nclass A["${label}"] {\n+x\n}\n}\nA --> B : ${label}`
        const diagram = classDiagram(source)
        const edited = apply(diagram, { kind: 'add_class', id: 'Other' })
        const written = serializeMermaid(edited, { wrapper: 'canonical' })
        expect(await upstream.publicAccepts(written), written).toBe(true)
        const reloaded = classDiagram(written)
        const classes = (body: typeof edited.body) => body.classes.map(({ id, label, members, namespace }) => ({ id, label, members, namespace })).sort((a, b) => a.id.localeCompare(b.id))
        expect(classes(reloaded.body)).toEqual(classes(edited.body))
        expect(reloaded.body.namespaces?.map(({ name, label }) => ({ name, label }))).toEqual(edited.body.namespaces?.map(({ name, label }) => ({ name, label })))
        expect(reloaded.body.relations.map(({ from, to, label }) => ({ from, to, label }))).toEqual(edited.body.relations.map(({ from, to, label }) => ({ from, to, label })))
        expect(reloaded.body.classes.find(node => node.id === 'A')?.members).toEqual(['+x'])
        const projection = await upstream.project(written, d => ({ label: d.db.getClasses().get('A').label, members: d.db.getClasses().get('A').members.length }))
        expect(projection.ok).toBe(true)
        if (projection.ok) {
          expect(decodeXML(projection.value.label.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';'))).toBe(label.replace('#32;', ' '))
          expect(projection.value.members).toBe(1)
        }
      }
    } finally { upstream.close() }
  })

  test('explicit empty Class labels remain readable and refuse lossy typed exports', async () => {
    const source = 'classDiagram\nclass A[""]:::s\nA --> B\n'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error('Class source must remain readable')
    expect(parseClassDiagram(source.split('\n')).classes.find(node => node.id === 'A')?.label).toBe('')
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source)
    expect(renderMermaidSVG(parsed.value)).toBe(renderMermaidSVG(source))
    expect(renderMermaidASCII(parsed.value)).toBe(renderMermaidASCII(source))
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'class_empty_label' }))
    expect(mutate(parsed.value, { kind: 'add_class', id: 'Other' }).ok).toBe(false)
    const editable = classDiagram('classDiagram\nclass A')
    expect(mutate(editable, { kind: 'add_class', id: 'Empty', label: '' }).ok).toBe(false)
    expect(synthesizeFromGraph({ kind: 'class', body: { ...editable.body, classes: [{ id: 'A', label: '', members: [] }] } }).ok).toBe(false)
    for (const label of [undefined, ' ', 'Text']) expect(mutate(editable, { kind: 'add_class', id: 'Control', ...(label === undefined ? {} : { label }) }).ok).toBe(true)
  })

  test('unrepresentable Class direction identities and inline members cannot silently disappear', () => {
    for (const [statement, syntax] of [
      ['class `direction RL`', 'class_direction_identity'],
      ['namespace `direction RL` {\nclass A\n}', 'class_direction_identity'],
      ['class A\nA : direction RL{x', 'class_member_direction'],
      ['namespace `~`{class `P`}', 'class_namespace_generic'],
      ['namespace `~T~A::B` {\n\tclass `IPC::Sender`\n}', 'class_namespace_generic'],
      ['namespace Root {\nnamespace `~T~` {\nclass A\n}\n}', 'class_namespace_generic'],
    ]) {
      const source = `classDiagram\n${statement}\n`
      const parsed = parseMermaid(source)
      if (!parsed.ok) throw new Error('Native Class source must remain readable')
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source)
      expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax }))
      expect(mutate(parsed.value, { kind: 'add_class', id: 'Other' }).ok).toBe(false)
    }
    expect(classDiagram('classDiagram\nclass A {\ndirection RL\n}').body.classes[0]!.members).toEqual(['direction RL'])
  })

  test('quoted namespace content consumes embedded tildes while keeping exact public identities and membership', async () => {
    const wrapper = '---\ntitle: Namespace metadata\n---\n%% leading comment\n'
    const upstream = startUpstreamMermaid()
    try {
      for (const [body, parent, namespaceIds] of [
        ['namespace `x~` {\nclass A\n}', 'x~', ['x~']],
        ['namespace `x~T~A::B` {\nclass A\n}', 'x~T~A::B', ['x~T~A::B']],
        ['namespace ` x~` {\nclass A\n}', ' x~', [' x~']],
        ['namespace Root {\nnamespace `x~` {\nnamespace `y~` {\nclass A\n}\n}\n}', 'Root.x~.y~', ['Root', 'Root.x~', 'Root.x~.y~']],
        ['namespace Root["Root title"] {\n%% keep namespace comment\nnamespace `x~`["Child title"] {\nclass A\n}\n}', 'Root.x~', ['Root', 'Root.x~']],
      ] satisfies Array<[string, string, string[]]>) {
        const source = `${wrapper}classDiagram\n${body}\n`
        const diagram = classDiagram(source)
        expect(diagram.meta.frontmatter?.title).toBe('Namespace metadata')
        expect(diagram.body.classes.find(node => node.id === 'A')?.namespace).toBe(parent)
        expect(verifyMermaid(diagram).warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
        const edited = apply(diagram, { kind: 'add_member', class: 'A', text: '+read()' })
        const saved = serializeMermaid(edited)
        expect(saved.startsWith(wrapper)).toBe(true)
        if (body.includes('%% keep namespace comment')) expect(saved.match(/%% keep namespace comment/g)).toHaveLength(1)
        const reloaded = classDiagram(saved)
        expect(reloaded.body).toEqual(edited.body)
        expect(serializeMermaid(reloaded)).toBe(saved)
        expect(edited.body.namespaces).toEqual(diagram.body.namespaces)
        expect(edited.body.classes.find(node => node.id === 'A')).toMatchObject({ namespace: parent, members: ['+read()'] })
        for (const input of [source, saved]) {
          expect(await upstream.project(input, d => ({
            namespaces: [...d.db.getNamespaces().keys()],
            parent: d.db.getClasses().get('A').parent,
            owners: [...d.db.getNamespaces().values()].filter(ns => ns.classes.has('A')).map(ns => ns.id),
          }))).toEqual({ ok: true, value: { namespaces: namespaceIds, parent, owners: [parent] } })
        }
      }
    } finally { upstream.close() }
  })

  test.each([
    ['<--', 'association', 'from'],
    ['-->', 'association', 'to'],
    ['<..', 'dependency', 'from'],
    ['..>', 'dependency', 'to'],
    ['<|--', 'inheritance', 'from'],
    ['--|>', 'inheritance', 'to'],
    ['<|..', 'realization', 'from'],
    ['..|>', 'realization', 'to'],
    ['*--', 'composition', 'from'],
    ['--*', 'composition', 'to'],
    ['o--', 'aggregation', 'from'],
    ['--o', 'aggregation', 'to'],
  ] as const)('keeps the marked endpoint when serializing %s', (arrow, kind, markerAt) => {
    const source = `classDiagram\nA "one" ${arrow} "many" B : relates`
    const diagram = classDiagram(source)
    const expected = { from: 'A', to: 'B', kind, markerAt, fromCardinality: 'one', toCardinality: 'many', label: 'relates' }
    expect(diagram.body.relations).toEqual([expected])
    const serialized = serializeMermaid(diagram)
    expect(classDiagram(serialized).body.relations).toEqual([expected])
    expect(renderParse(serialized).relationships).toEqual([
      expect.objectContaining({
        from: 'A',
        to: 'B',
        type: kind,
        markerAt,
        fromCardinality: 'one',
        toCardinality: 'many',
        label: 'relates',
      }),
    ])
  })

  test('serializer labels resolve to one logical renderer class and relations attach to it', () => {
    let d = classDiagram('classDiagram\n  class B')
    d = apply(d, { kind: 'add_class', id: 'A', label: 'Alpha' })
    d = apply(d, { kind: 'add_relation', from: 'A', to: 'B', relKind: 'association' })
    const parsed = renderParse(serializeMermaid(d))
    expect(parsed.classes.map(cls => cls.id).sort()).toEqual(['A', 'B'])
    expect(parsed.classes.find(cls => cls.id === 'A')?.label).toBe('Alpha')
    expect(parsed.relationships[0]).toMatchObject({ from: 'A', to: 'B' })
  })
})

describe('class namespaces — structured agent body (#118)', () => {
  test('keeps first-seen namespace order when a labeled parent has direct classes', () => {
    const diagram = classDiagram('classDiagram\nnamespace Parent.Child {\nclass B\n}\nnamespace Parent["Keep"] {\nclass A\n}')
    const serialized = serializeMermaid(diagram)
    expect(serialized).toBe('classDiagram\n  namespace Parent.Child {\n    class B\n  }\n  namespace Parent["Keep"] {\n    class A\n  }\n')
    expect(classDiagram(serialized).body.classes).toEqual(diagram.body.classes)
  })

  test.each([
    { kind: 'remove_class', id: 'A' },
    { kind: 'set_class_namespace', class: 'A', namespace: null },
    { kind: 'set_class_namespace', class: 'A', namespace: 'Other2' },
  ] as const)('preserves child-before-parent namespaces and trailing siblings after $kind', async op => {
    const diagram = classDiagram('classDiagram\nnamespace Parent.Child {\nclass B\n}\nnamespace Parent["Keep label"] {\nclass A\n}\nnamespace Other1 {\nclass D\n}\nnamespace Other2 {\nclass E\n}')
    const edited = apply(diagram, op)
    const source = serializeMermaid(edited)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
    const reparsed = classDiagram(source)
    const byId = (nodes: typeof edited.body.classes) => [...nodes].sort((a, b) => a.id.localeCompare(b.id))
    const byName = (namespaces: NonNullable<typeof edited.body.namespaces>) => [...namespaces].sort((a, b) => a.name.localeCompare(b.name))
    expect(byId(reparsed.body.classes)).toEqual(byId(edited.body.classes))
    expect(byName(reparsed.body.namespaces!)).toEqual(byName(edited.body.namespaces!))
    expect(source.match(/class B\b/g)).toHaveLength(1)
    expect(serializeMermaid(reparsed)).toBe(source)
  })

  test.each([
    { parent: 'Parent', sibling: true },
    { parent: 'Parent.Middle', sibling: true },
    { parent: 'Parent', sibling: false },
  ])('writes a later labeled ancestor $parent with sibling=$sibling', async ({ parent, sibling }) => {
    const source = `classDiagram\nnamespace ${parent}.Child {\nclass B\n}\nnamespace ${parent}["Keep label"] {\nnamespace Other {\nclass A\n}\n}${sibling ? '\nnamespace Sibling {\nclass C\n}' : ''}`
    const diagram = classDiagram(source)
    const serialized = serializeMermaid(diagram)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      await upstream.close()
    }
    const reparsed = classDiagram(serialized)
    expect(reparsed.body.classes).toEqual(diagram.body.classes)
    const labeled = renderParse(serialized).namespaces[0]!
    expect(parent === 'Parent' ? labeled.label : labeled.children[0]?.label).toBe('Keep label')
    expect(serialized.match(/class B\b/g)).toHaveLength(1)
    expect(serializeMermaid(reparsed)).toBe(serialized)
  })

  test.each([
    { kind: 'remove_class', id: 'A' },
    { kind: 'set_class_namespace', class: 'A', namespace: null },
  ] as const)('keeps a labeled parent with surviving descendants valid after $kind', async op => {
    const diagram = classDiagram('classDiagram\nnamespace Parent["Keep this label"] {\nclass A\nnamespace Child {\nclass B\n}\n}\nclass C')
    const edited = apply(diagram, op)
    const source = serializeMermaid(edited)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
    const reparsed = classDiagram(source)
    const byId = (nodes: typeof edited.body.classes) => [...nodes].sort((a, b) => a.id.localeCompare(b.id))
    expect(byId(reparsed.body.classes)).toEqual(byId(edited.body.classes))
    expect(reparsed.body.namespaces).toEqual(edited.body.namespaces)
    expect(renderParse(source).namespaces[0]?.label).toBe('Keep this label')
    expect(serializeMermaid(reparsed)).toBe(source)
  })

  test.each([
    { kind: 'remove_class', id: 'A' },
    { kind: 'set_class_namespace', class: 'A', namespace: null },
    { kind: 'set_class_namespace', class: 'A', namespace: 'Other' },
  ] as const)('prunes empty unlabeled namespaces after $kind and exports valid Mermaid', async op => {
    const diagram = classDiagram('classDiagram\nnamespace N {\nclass A\n}\nclass B')
    const edited = apply(diagram, op)
    expect(edited.body.namespaces?.some(namespace => namespace.name === 'N') ?? false).toBe(false)
    const source = serializeMermaid(edited)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
    const reparsed = classDiagram(source)
    expect(reparsed.body.classes).toEqual(edited.body.classes)
    expect(reparsed.body.classes.find(node => node.id === 'B')).toEqual({ id: 'B', members: [] })
    expect(serializeMermaid(reparsed)).toBe(source)
  })

  test.each([
    { kind: 'remove_class', id: 'A' },
    { kind: 'set_class_namespace', class: 'A', namespace: 'Other' },
  ] as const)('refuses $kind when it would discard an explicit namespace label', op => {
    const diagram = classDiagram('classDiagram\nnamespace N["Meaningful group"] {\nclass A\n}\nclass B')
    const before = serializeMermaid(diagram)
    const result = mutate(diagram, op)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ code: 'INVALID_OP', message: expect.stringContaining('N') })
    expect(serializeMermaid(diagram)).toBe(before)
  })

  test.each(['namespace N {\n}', 'namespace N["Meaningful group"] {\n}'].flatMap(namespace => [false, true].map(withClass => ({ namespace, withClass }))))('preserves and draws directly authored empty namespaces as opaque source: $namespace (withClass=$withClass)', ({ namespace, withClass }) => {
    const source = `classDiagram\n${namespace}${withClass ? '\nclass B' : ''}`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(asClass(parsed.value)).toBeNull()
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    const positioned = layoutClassDiagram(renderParse(source))
    expect(positioned.namespaces).toHaveLength(1)
    const frame = positioned.namespaces[0]!
    expect(frame.width).toBeGreaterThan(0)
    expect(frame.height).toBeGreaterThan(frame.headerHeight)
    expect(renderMermaidSVG(parsed.value)).toContain(`>${frame.label}</text>`)
  })

  test('repeated declarations across namespaces preserve authored source and every rendered group', async () => {
    const source = `classDiagram
namespace First { class Shared }
namespace Second { class Shared
}
namespace Third {
class Shared {
+String name
}
class Other
}`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    const native = renderParse(source)
    expect(native.classes.map(node => node.id)).toEqual(['Shared', 'Other'])
    expect([...membershipByPath(native.namespaces)]).toEqual([
      ['First', ['Shared']],
      ['Second', []],
      ['Third', ['Other']],
    ])
    expect(native.classes[0]!.attributes.map(member => member.name)).toEqual(['name'])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  test('repeated declarations within the same namespace remain editable', () => {
    const diagram = classDiagram('classDiagram\nnamespace First { class Shared }\nnamespace First { class Shared }')
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([{ id: 'Shared', namespace: 'First' }])
  })

  test.each([
    ['class Shared', 'class Shared hot'],
    ['class Shared hot', 'class Shared'],
  ])('a style/declaration claim across namespaces stays source-preserved in either order: %s then %s', async (first, second) => {
    const source = `classDiagram\nnamespace First { ${first} }\nnamespace Second { ${second} }\nclassDef hot fill:red`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    const native = renderParse(source)
    expect([...membershipByPath(native.namespaces)]).toEqual([
      ['First', ['Shared']],
      ['Second', []],
    ])
    expect(native.classes.map(node => ({ id: node.id, className: node.className }))).toEqual([{ id: 'Shared', className: 'hot' }])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  // Pinned Mermaid reads only braces after a block's `}` on its line.
  test.each([
    ['class A {\n+x } class Free', undefined, 'class_statement_after_class_close', 3],
    ['class A {+x} class Free', undefined, 'class_statement_after_class_close', 2],
    ['class A {\n+x\n} class Free', undefined, 'class_statement_after_class_close', 4],
    ['namespace Outer {\nclass A\n} class Free', 'Outer', 'class_statement_after_namespace_close', 4],
  ] as const)('a statement after a closing brace on its line is read and diagnosed: %j', async (body, namespace, syntax, line) => {
    const source = `classDiagram\n${body}`
    const diagram = classDiagram(source)
    const expected = [
      { id: 'A', namespace },
      { id: 'Free', namespace: undefined },
    ]
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual(expected)
    expect(renderMermaidSVG(source)).toMatch(/<text\b[^>]*>Free<\/text>/)
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([expect.objectContaining({ syntax, line })])
    const serialized = serializeMermaid(diagram)
    expect(verifyMermaid(serialized).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(false)
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  test.each([' class Free', 'class Free', '; class Free', ';class Free', '\nclass Free'])('a statement after a compact namespace retains meaning and diagnoses nonportable separation: %j', async suffix => {
    const source = `classDiagram\nnamespace Outer { class First }${suffix}`
    const diagram = classDiagram(source)
    const expected = [
      { id: 'First', namespace: 'Outer' },
      { id: 'Free', namespace: undefined },
    ]
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual(expected)
    const svg = renderMermaidSVG(source)
    expect(svg).toMatch(/<text\b[^>]*>First<\/text>/)
    expect(svg).toMatch(/<text\b[^>]*>Free<\/text>/)
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual(suffix.startsWith('\n') ? [] : [expect.objectContaining({ syntax: 'class_statement_after_namespace_close', line: 2 })])
    const serialized = serializeMermaid(diagram)
    expect(classDiagram(serialized).body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual(expected)
    expect(verifyMermaid(serialized).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(suffix.startsWith('\n'))
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  test.each([
    { body: 'class First; class Second', ids: ['First', 'Second'], unsupported: true },
    { body: 'class First;', ids: ['First'], unsupported: true },
    { body: '; class First', ids: ['First'], unsupported: true },
    { body: ';; class First', ids: ['First'], unsupported: true },
    { body: 'class First["before; after"]', ids: ['First'], unsupported: false },
    { body: 'class First', ids: ['First'], unsupported: false },
  ])('compact namespace semicolons are diagnosed as syntax, not quoted data: $body', async ({ body, ids, unsupported }) => {
    const source = `classDiagram\nnamespace Outer { ${body} }`
    const diagram = classDiagram(source)
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual(ids.map(id => ({ id, namespace: 'Outer' })))
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual(unsupported ? [expect.objectContaining({ syntax: 'class_compact_semicolon_statement_extension', line: 2 })] : [])
    const serialized = serializeMermaid(diagram)
    expect(verifyMermaid(serialized).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(!unsupported)
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  test('an empty separator inside a namespace is diagnosed even without an adjacent statement', async () => {
    const source = 'classDiagram\nnamespace Outer { ; }'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(verifyMermaid(source).warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_SYNTAX',
        syntax: 'class_compact_semicolon_statement_extension',
        line: 2,
      }),
    )
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(false)
    } finally {
      await upstream.close()
    }
    // Empty namespaces stay source-preserved rather than becoming editable
    // bodies whose canonical export would be rejected by Mermaid.
  })

  test('a trailing comment after a compact namespace is diagnosed for portability', async () => {
    const source = 'classDiagram\nnamespace Outer { class First } %% tail'
    expect(classDiagram(source).body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([{ id: 'First', namespace: 'Outer' }])
    expect(verifyMermaid(source).warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_SYNTAX',
        syntax: 'class_trailing_comment',
        line: 2,
      }),
    )
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(false)
      const serialized = serializeMermaid(classDiagram(source))
      expect(await upstream.accepts(serialized)).toBe(true)
      expect(verifyMermaid(serialized).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([])
    } finally {
      await upstream.close()
    }
  })

  test.each([
    {
      name: 'a quoted name is one namespace atom, not a hierarchy',
      source: 'classDiagram\nnamespace `A::B` {\nclass `IPC::Sender`\n}',
      classes: [{ id: 'IPC::Sender', namespace: 'A::B' }],
      membership: [['A::B', ['IPC::Sender']]],
    },
    {
      name: 'a statement may follow its namespace opener on the same physical line',
      source: 'classDiagram\nnamespace Domain { class First\nclass Second\n}\nclass Free',
      classes: [
        { id: 'First', namespace: 'Domain' },
        { id: 'Second', namespace: 'Domain' },
        { id: 'Free', namespace: undefined },
      ],
      membership: [['Domain', ['First', 'Second']]],
    },
    {
      // Mermaid's lexer reads `}` after a statement as the namespace's end.
      name: 'a statement may share a line with the brace that closes its namespace',
      source: 'classDiagram\nnamespace Domain { class First\nclass Second }\nnamespace Other {\nclass Third <<interface>> }\nclass Free',
      classes: [
        { id: 'First', namespace: 'Domain' },
        { id: 'Second', namespace: 'Domain' },
        { id: 'Third', namespace: 'Other' },
        { id: 'Free', namespace: undefined },
      ],
      membership: [
        ['Domain', ['First', 'Second']],
        ['Other', ['Third']],
      ],
    },
    {
      name: 'one line may close a class body and the namespaces around it',
      source: 'classDiagram\nnamespace Outer {\nnamespace Inner {\nclass First\nclass Last:::hot {+id} }}\nclass Free\nclassDef hot fill:red',
      classes: [
        { id: 'First', namespace: 'Outer.Inner' },
        { id: 'Last', namespace: 'Outer.Inner' },
        { id: 'Free', namespace: undefined },
      ],
      membership: [
        ['Outer', []],
        ['Outer.Inner', ['First', 'Last']],
      ],
    },
    {
      name: 'a nested quoted atom remains a child namespace after serialization',
      source: 'classDiagram\nnamespace Outer {\nnamespace `A::B` { class `IPC::Sender`\n}\n}',
      classes: [{ id: 'IPC::Sender', namespace: 'Outer.A::B' }],
      membership: [
        ['Outer', []],
        ['Outer.A::B', ['IPC::Sender']],
      ],
    },
  ])('$name', async ({ source, classes, membership }) => {
    const diagram = classDiagram(source)
    const expectedMembership: Array<[string, string[]]> = membership.map(([path, ids]) => [path, [...ids]])
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([...classes])
    expect([...membershipByPath(renderParse(source).namespaces)]).toEqual(expectedMembership)
    const edited = apply(diagram, { kind: 'add_member', class: classes[0]!.id, text: '+String name' })
    const serialized = serializeMermaid(edited)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(serialized)).toBe(true)
    } finally {
      await upstream.close()
    }
    expect([...membershipByPath(renderParse(serialized).namespaces)]).toEqual(expectedMembership)
    expect(classDiagram(serialized).body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([...classes])
    expect(classDiagram(serialized).body.classes[0]!.members).toEqual(['+String name'])
  })

  test('a literal dot in a quoted namespace remains source-preserved when the typed path cannot represent it', () => {
    const source = 'classDiagram\nnamespace `A.B` {\nclass First\n}'
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(renderParse(source).namespaces).toEqual([{ name: 'A.B', classIds: ['First'], children: [] }])
  })

  test.each(['namespace `A.B` { class First }\nnamespace A.B { class Second }', 'namespace A.B { class Second }\nnamespace `A.B` { class First }'])('rejects a quoted-name/hierarchy collision rather than placing a class in the wrong namespace: %s', body => {
    const source = `classDiagram\n${body}`
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value).trimEnd()).toBe(source)
    expect(() => renderParse(source)).toThrow('Class namespace path collision "A.B"')
  })

  test('namespaced source parses structured, not opaque', () => {
    const d = classDiagram(NAMESPACED)
    expect(d.body.classes.map(c => c.id).sort()).toEqual(['Free', 'Square', 'Triangle'])
    const triangle = d.body.classes.find(c => c.id === 'Triangle')!
    expect(triangle.namespace).toBe('Shapes')
    const square = d.body.classes.find(c => c.id === 'Square')!
    expect(square.namespace).toBe('Shapes')
    expect(square.members).toEqual(['+double side', '+area() double'])
    const free = d.body.classes.find(c => c.id === 'Free')!
    expect(free.namespace).toBeUndefined()
  })

  test('nested namespaces parse to dot paths', () => {
    const d = classDiagram('classDiagram\nnamespace Platform {\n  namespace Auth {\n    class UserService\n  }\n}')
    expect(d.body.classes.find(c => c.id === 'UserService')!.namespace).toBe('Platform.Auth')
  })

  test('serialize → render-parse reproduces namespace membership', () => {
    const d = classDiagram(NAMESPACED)
    const rendered = renderParse(serializeMermaid(d))
    const membership = membershipByPath(rendered.namespaces)
    expect(membership.get('Shapes')).toEqual(['Square', 'Triangle'])
    expect(rendered.classes.map(c => c.id).sort()).toEqual(['Free', 'Square', 'Triangle'])
    // the relationship survives alongside the namespace block
    expect(rendered.relationships).toHaveLength(1)
    // members survive inside the namespace block
    expect(rendered.classes.find(c => c.id === 'Square')!.attributes).toHaveLength(1)
    expect(rendered.classes.find(c => c.id === 'Square')!.methods).toHaveLength(1)
  })

  test('round-trip is byte-stable (serialize∘parse idempotent)', () => {
    const d = classDiagram(NAMESPACED)
    const once = serializeMermaid(d)
    const again = serializeMermaid(classDiagram(once))
    expect(again).toBe(once)
  })

  test('add_class with namespace + set_class_namespace round-trip through the renderer parser', () => {
    let d = classDiagram(NAMESPACED)
    d = apply(d, { kind: 'add_class', id: 'Circle', namespace: 'Shapes', members: ['+double r'] })
    d = apply(d, { kind: 'add_class', id: 'Loose' })
    d = apply(d, { kind: 'set_class_namespace', class: 'Loose', namespace: 'Extras.Bag' })
    d = apply(d, { kind: 'set_class_namespace', class: 'Triangle', namespace: null })
    const rendered = renderParse(serializeMermaid(d))
    const membership = membershipByPath(rendered.namespaces)
    expect(membership.get('Shapes')).toEqual(['Circle', 'Square'])
    expect(membership.get('Extras.Bag')).toEqual(['Loose'])
    // Triangle left its namespace but still renders as a class
    expect(rendered.classes.map(c => c.id).sort()).toEqual(['Circle', 'Free', 'Loose', 'Square', 'Triangle'])
  })

  test('classes inside namespaces stay mutable (add_member on a namespaced class)', () => {
    let d = classDiagram(NAMESPACED)
    d = apply(d, { kind: 'add_member', class: 'Triangle', text: '+rotate()' })
    const rendered = renderParse(serializeMermaid(d))
    const triangle = rendered.classes.find(c => c.id === 'Triangle')!
    expect(triangle.methods.map(m => m.name)).toContain('rotate')
    expect(membershipByPath(rendered.namespaces).get('Shapes')).toContain('Triangle')
  })

  test('set_class_namespace rejects an unknown class', () => {
    const d = classDiagram(NAMESPACED)
    const r = mutate(d, { kind: 'set_class_namespace', class: 'Ghost', namespace: 'Shapes' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('CLASS_NOT_FOUND')
  })

  test('namespace labels round-trip through the renderer parser', () => {
    const d = classDiagram('classDiagram\nnamespace Auth["Authentication Service"] {\n  class UserService\n}')
    const rendered = renderParse(serializeMermaid(d))
    const auth = rendered.namespaces.find(n => n.name === 'Auth')
    expect(auth).toBeDefined()
    expect(auth!.label).toBe('Authentication Service')
    expect(auth!.classIds).toEqual(['UserService'])
  })

  test('membership is queryable via facts', () => {
    const d = classDiagram(NAMESPACED)
    const facts = describeMermaidFacts(d)
    expect(facts.some(f => f.includes('namespace Shapes'))).toBe(true)
    expect(facts.some(f => f.includes('Triangle') && f.includes('Shapes'))).toBe(true)
  })
})

// Mermaid's cssClass names classes by their ids as written and styles only
// classes declared before it, and Mermaid reads `class A c` as one class `Ac`.
// Ours keeps the style class each form means, declares no class for a
// cssClass, warns where Mermaid reads the source otherwise, and writes
// `cssClass "A" c`, which Mermaid reads as written.
test.each<[string, Array<[string, string | null]>, string[]]>([
  ['class `my class`\ncssClass "my class" hot', [['my class', 'hot']], []],
  ['class A\ncssClass "B" hot', [['A', null]], []],
  ['cssClass "A" hot\nclass A', [['A', 'hot']], ['class_css_class_before_class']],
  ['class A\nclass A hot', [['A', 'hot']], ['class_style_assignment']],
  ['class A\ncssClass A hot', [['A', 'hot']], ['class_style_assignment']],
])('the style class of %j', async (body, expected, syntax) => {
  const source = `classDiagram\n${body}\nclassDef hot fill:#f00`
  expect(renderParse(source).classes.map(({ id, className }) => [id, className ?? null])).toEqual(expected)
  const diagram = classDiagram(source)
  expect(diagram.body.classes.map(({ id, className }) => [id, className ?? null])).toEqual(expected)
  expect(verifyMermaid(source).warnings.flatMap(warning => (warning.code === 'UNSUPPORTED_SYNTAX' ? [warning.syntax] : []))).toEqual(syntax)
  const written = serializeMermaid(diagram)
  const upstream = startUpstreamMermaid()
  try {
    const classes = await upstream.project(written, mermaid => [...(mermaid.db as unknown as { getClasses(): Map<string, { id: string; cssClasses: string }> }).getClasses().values()].map(({ id, cssClasses }) => [id, cssClasses.split(' ').find(name => name && name !== 'default') ?? null]))
    expect({ written, classes }).toEqual({ written, classes: { ok: true, value: expected } })
  } finally {
    await upstream.close()
  }
})
