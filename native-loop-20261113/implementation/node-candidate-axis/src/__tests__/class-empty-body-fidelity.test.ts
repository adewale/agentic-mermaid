import { expect, test } from 'bun:test'
import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'

// Mermaid's lexer lets a class block's braces share a line with its members.
// Members on the brace line may be separated by `;`, where Mermaid reads
// `{+x; +y()}` as one method named `x; +y` (docs/project/divergences.md).
test.each<{ declaration: string; members: string[]; attributes: string[]; methods: string[] }>([
  { declaration: 'class EmptyClass {}', members: [], attributes: [], methods: [] },
  { declaration: 'class EmptyClass { }', members: [], attributes: [], methods: [] },
  { declaration: 'class EmptyClass {+int x}', members: ['+int x'], attributes: ['+int x'], methods: [] },
  { declaration: 'class EmptyClass~T~ { +T x }', members: ['+T x'], attributes: ['+T x'], methods: [] },
  { declaration: 'class EmptyClass:::hot { +x }', members: ['+x'], attributes: ['+x'], methods: [] },
  { declaration: 'class EmptyClass["Label"] { +x }', members: ['+x'], attributes: ['+x'], methods: [] },
  { declaration: 'class EmptyClass {+y\n}', members: ['+y'], attributes: ['+y'], methods: [] },
  { declaration: 'class EmptyClass {+x; +y()}', members: ['+x', '+y()'], attributes: ['+x'], methods: ['y'] },
  { declaration: 'class EmptyClass { +String name; +eat() void }', members: ['+String name', '+eat() void'], attributes: ['+String name'], methods: ['eat'] },
  { declaration: 'class EmptyClass {+call(a; b) #lt;T#gt;}', members: ['+call(a; b) #lt;T#gt;'], attributes: [], methods: ['call'] },
])('an inline class body keeps its class identity and members across public surfaces: $declaration', ({ declaration, members, attributes, methods }) => {
  const source = `classDiagram\n  ${declaration}\n`
  const native = parseClassDiagram(source.trim().split('\n').map(line => line.trim()))
  expect(native.classes.map(node => node.id)).toEqual(['EmptyClass'])
  expect(native.classes[0]!.attributes.map(member => member.sourceText)).toEqual(attributes)
  expect(native.classes[0]!.methods.map(member => member.name)).toEqual(methods)

  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('class')
  if (parsed.value.body.kind === 'class') expect(parsed.value.body.classes[0]?.members).toEqual(members)
  expect(verifyMermaid(parsed.value).ok).toBe(true)
  expect(renderMermaidSVG(source)).toMatch(/class="class-node[^"]*" data-id="EmptyClass"/)

  // Written back, each member has a line of its own.
  const serialized = serializeMermaid(parsed.value)
  expect(serialized.split('\n').map(line => line.trim()).filter(line => members.includes(line))).toEqual(members)
  const reparsed = parseRegisteredMermaid(serialized)
  expect(reparsed.ok).toBe(true)
  if (reparsed.ok) expect(reparsed.value.body.kind).toBe('class')
  if (reparsed.ok && reparsed.value.body.kind === 'class') {
    expect(reparsed.value.body.classes.map(node => ({ id: node.id, members: node.members }))).toEqual([{ id: 'EmptyClass', members }])
  }

  const renamed = mutate(parsed.value, { kind: 'rename_class', from: 'EmptyClass', to: 'RenamedClass' })
  expect(renamed.ok).toBe(true)
  if (renamed.ok) expect(renderMermaidSVG(serializeMermaid(renamed.value))).toContain('data-id="RenamedClass"')
})

test('an inline empty body does not consume the next class declaration', () => {
  const source = 'classDiagram\n  class EmptyClass {}\n  class NextClass\n'
  const expectedIds = ['EmptyClass', 'NextClass']
  const native = parseClassDiagram(source.trim().split('\n').map(line => line.trim()))
  expect(native.classes.map(node => node.id)).toEqual(expectedIds)
  expect(native.classes.every(node => node.attributes.length === 0 && node.methods.length === 0)).toBe(true)

  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) expect(parsed.value.body.kind).toBe('class')
  if (!parsed.ok || parsed.value.body.kind !== 'class') return
  expect(parsed.value.body.classes.map(node => node.id)).toEqual(expectedIds)
  expect(parsed.value.body.classes.every(node => node.members.length === 0)).toBe(true)

  const serialized = serializeMermaid(parsed.value)
  const reparsed = parseRegisteredMermaid(serialized)
  expect(reparsed.ok).toBe(true)
  if (reparsed.ok) expect(reparsed.value.body.kind).toBe('class')
  if (reparsed.ok && reparsed.value.body.kind === 'class') {
    expect(reparsed.value.body.classes.map(node => node.id)).toEqual(expectedIds)
  }
})
