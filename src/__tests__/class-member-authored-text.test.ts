import { expect, test } from 'bun:test'
import { describeMermaidFacts, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'

const source = `classDiagram
  class Account {
    +id: string
    int count
    +List~int~ position
    ~List~str~ privateItems
  }
`

function drawnTexts(input: string): string[] {
  return [...renderMermaidSVG(input).matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map(match => match[1]!.replace(/<[^>]+>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').trim())
    .filter(Boolean)
}

test('class attributes keep authored order and Mermaid generic display text', () => {
  const expected = ['+id: string', 'int count', '+List<int> position', '~List<str> privateItems']
  expect(drawnTexts(source)).toEqual(['Account', ...expected])

  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.value.body.kind).toBe('class')
  if (parsed.value.body.kind !== 'class') return
  expect(parsed.value.body.classes[0]?.members).toEqual(['+id: string', 'int count', '+List~int~ position', '~List~str~ privateItems'])
  expect(verifyMermaid(parsed.value).ok).toBe(true)
  expect(drawnTexts(serializeMermaid(parsed.value))).toEqual(['Account', ...expected])
})

test('inline class attributes use the same authored display contract', () => {
  const inline = 'classDiagram\n  Account : +id: string\n  Account : +List~int~ position\n'
  expect(drawnTexts(inline)).toEqual(['Account', '+id: string', '+List<int> position'])
})

test('nested and comma-separated Mermaid generic members render without losing text', () => {
  const nested = 'classDiagram\n  class Box {\n    +List~List~int~~ data\n    +Map~string,int~ index\n  }\n'
  expect(drawnTexts(nested)).toEqual(['Box', '+List<List<int>> data', '+Map<string,int> index'])
  const parsed = parseRegisteredMermaid(nested)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(drawnTexts(serializeMermaid(parsed.value))).toEqual(['Box', '+List<List<int>> data', '+Map<string,int> index'])
})

test('repeated and mixed nested/comma generics retain every authored member fragment', () => {
  const cases = [
    ['+Map~string,int~ first,Map~str,bool~ second', '+Map<string,int> first,Map<str,bool> second'],
    ['+Map~a,b~ first, Map~c,d~ second', '+Map<a,b> first, Map<c,d> second'],
    ['+Map~string,List~int~~ field', '+Map<string,List<int>> field'],
    ['+Map~List~int~,str~ values', '+Map<List<int>,str> values'],
  ] as const
  for (const [authored, displayed] of cases) {
    const source = `classDiagram\n  class Box {\n    ${authored}\n  }\n`
    expect(drawnTexts(source)).toEqual(['Box', displayed])
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) continue
    expect(drawnTexts(serializeMermaid(parsed.value))).toEqual(['Box', displayed])
  }
})

test('authored member display keeps UML modifiers and SVG escaping', () => {
  const source = 'classDiagram\n  class Safe {\n    +int count$\n    +name: <script>evil</script>\n  }\n'
  const svg = renderMermaidSVG(source)
  expect(drawnTexts(source)).toEqual(['Safe', '+int count', '+name: <script>evil</script>'])
  expect(svg).toContain('text-decoration="underline"')
  expect(svg).toContain('&lt;script&gt;')
  expect(svg).not.toContain('<script>')
})

// Mermaid reads a method classifier after `)` or at the end of its return
// type; it styles the member and is never drawn or read back as text.
test('method classifiers style the member on every surface and are never shown as text', () => {
  const source = 'classDiagram\n  class Animal {\n    +speak()* void\n    +make()$ A\n    +run() int*\n  }\n'
  const shown = ['+ speak(): void', '+ make(): A', '+ run(): int']
  expect(drawnTexts(source)).toEqual(['Animal', ...shown])
  const svg = renderMermaidSVG(source)
  const memberTag = (name: string) => svg.match(new RegExp(`<text\\b[^>]*data-id="member:Animal:${name}"[^>]*>`))?.[0] ?? ''
  expect(['speak', 'make', 'run'].map(name => [/font-style="italic"/.test(memberTag(name)), /text-decoration="underline"/.test(memberTag(name))]))
    .toEqual([[true, false], [false, true], [true, false]])
  const ascii = renderMermaidASCII(source)
  for (const text of shown) expect(ascii).toContain(text)
  expect(ascii).not.toMatch(/[*$]/)

  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('parse')
  const members = describeMermaidFacts(parsed.value).filter(fact => fact.startsWith('member '))
  expect(members).toEqual([
    'member Animal +make() A', 'member Animal +make() A static',
    'member Animal +run() int', 'member Animal +run() int abstract',
    'member Animal +speak() void', 'member Animal +speak() void abstract',
  ])
  // The writer keeps the authored classifiers, so the source round-trips.
  for (const member of ['+speak()* void', '+make()$ A', '+run() int*']) expect(serializeMermaid(parsed.value)).toContain(member)
})

test('equal member presentation profiles keep each class label, color and UML modifier', () => {
  const input = `classDiagram
class A {
+int count
+int score$
+int total*
+int extended
}
class B {
+int first
+int other$
+int third*
}
class C {
+int ninth
+int sixth$
+int tenth*
}
style A color:#112233
style B color:#445566
style C color:#112233`
  const members = (svg: string) => [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
    .filter(match => match[1]!.includes('data-role="member"'))
    .map(match => ({
      id: match[1]!.match(/\bdata-id="([^"]+)"/)?.[1],
      text: match[2]!.replace(/<[^>]+>/g, ''),
      fills: [match[1]!.match(/\bfill="([^"]+)"/)?.[1], ...[...match[2]!.matchAll(/\bfill="([^"]+)"/g)].map(fill => fill[1])].filter((fill): fill is string => fill !== undefined),
      italic: match[1]!.includes('font-style="italic"'),
      underline: match[1]!.includes('text-decoration="underline"'),
      position: [match[1]!.match(/\bx="([^"]+)"/)?.[1], match[1]!.match(/\by="([^"]+)"/)?.[1]].join(','),
    }))
  const expected = [
    ['member:A:count', '+int count', '#112233', false, false],
    ['member:A:score', '+int score', '#112233', false, true],
    ['member:A:total', '+int total', '#112233', true, false],
    ['member:A:extended', '+int extended', '#112233', false, false],
    ['member:B:first', '+int first', '#445566', false, false],
    ['member:B:other', '+int other', '#445566', false, true],
    ['member:B:third', '+int third', '#445566', true, false],
    ['member:C:ninth', '+int ninth', '#112233', false, false],
    ['member:C:sixth', '+int sixth', '#112233', false, true],
    ['member:C:tenth', '+int tenth', '#112233', true, false],
  ] as const
  const rows = members(renderMermaidSVG(input))
  expect(rows).toHaveLength(10)
  expect(new Set(rows.map(row => row.position)).size).toBe(10)
  for (const [id, text, color, italic, underline] of expected) {
    const row = rows.find(candidate => candidate.id === id)
    expect(row, id).toMatchObject({ text, italic, underline })
    expect(row!.fills.length, id).toBeGreaterThan(0)
    expect(new Set(row!.fills), id).toEqual(new Set([color]))
  }
  const next = members(renderMermaidSVG(input.replace('+int count', '+int fresh').replace('style A color:#112233', 'style A color:#556677')))
  expect(next.find(row => row.id === 'member:A:fresh')).toMatchObject({ text: '+int fresh', italic: false, underline: false })
  expect(next.find(row => row.id === 'member:B:first')).toMatchObject({ text: '+int first' })
  for (const [id, color] of [['member:A:fresh', '#556677'], ['member:B:first', '#445566']] as const) {
    const row = next.find(row => row.id === id)!
    expect(row.fills.length, id).toBeGreaterThan(0)
    expect(new Set(row.fills), id).toEqual(new Set([color]))
  }
  expect(next.some(row => row.id === 'member:A:count')).toBe(false)
})

test('every member is painted in the member ink, including lines drawn without highlight runs', () => {
  // Abstract members (italic runs), non-ASCII members (native shaping) and
  // static members (underlined) are not split into highlight runs; their text
  // element's own fill paints them, else SVG's default black would.
  const svg = renderMermaidSVG('classDiagram\n  class A {\n    +draw()*\n    +String näme\n    +total()$ int\n    +int plain\n  }\n')
  const fills = [...svg.matchAll(/<text\b[^>]*\bdata-role="member"[^>]*>/g)].map(match => match[0].match(/\sfill="([^"]*)"/)?.[1])
  expect(fills).toHaveLength(4)
  expect(fills[0]).toBeDefined()
  expect(fills[0]).not.toMatch(/^(?:#000(?:000)?|black)$/i)
  expect(new Set(fills).size).toBe(1)
})

test('Class member entities expand after visibility, methods, modifiers and generics are parsed', async () => {
  const members = ['+#9829;', '#35;literal', '#protected', '+call#40;#41;', '+call(#lt;b#gt;) #quot;type#quot;', '+Map~str,int~ #126;literal#126;', '+#42;literal#42;', '+#lt;b#gt;tag#lt;/b#gt;']
  const source = `classDiagram\nclass A {\n${members.join('\n')}\n}`
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'class') throw new Error('structured Class required')
  // Typed members are authored grammar strings, not decoded display labels.
  expect(parsed.value.body.classes[0]?.members).toEqual(members)
  const native = parseClassDiagram(source.split('\n')).classes[0]!
  expect(native.attributes[1]?.visibility).toBe('')
  expect(native.attributes[2]?.visibility).toBe('#')
  expect(native.attributes[3]?.isMethod).toBe(false)
  expect(native.attributes[5]?.isAbstract).toBe(false)
  expect(native.methods).toHaveLength(1)
  const edited = mutate(parsed.value, { kind: 'add_class', id: 'B' })
  if (!edited.ok) throw new Error('edit refused')
  const written = serializeMermaid(edited.value)
  const reloaded = parseRegisteredMermaid(written)
  expect(reloaded.ok && reloaded.value.body.kind === 'class' && reloaded.value.body.classes[0]?.members).toEqual(members)
  const expected = ['+♥', '#literal', '#protected', '+call()', '+Map<str,int> ~literal~', '+*literal*', '+<b>tag</b>', '+ call(<b>): "type"']
  for (const input of [source, written]) {
    const svg = renderMermaidSVG(input)
    const texts = drawnTexts(input).map(text => text.replaceAll('&quot;', '"'))
    const terminal = renderMermaidASCII(input)
    for (const label of expected) {
      expect(texts).toContain(label)
      expect(terminal).toContain(label)
    }
    expect(svg).toContain('&lt;b&gt;tag&lt;/b&gt;')
    expect(svg).not.toContain('font-style="italic"')
  }
  const upstream = startUpstreamMermaid()
  try { expect(await upstream.accepts(source)).toBe(true); expect(await upstream.accepts(written)).toBe(true) } finally { await upstream.close() }
})

test('Class body annotations decode their displayed text after the annotation grammar', () => {
  const source = 'classDiagram\nclass A {\n<<#lt;b#gt;tag#lt;/b#gt; #9829;>>\n}'
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'class') throw new Error('structured Class required')
  expect(parsed.value.body.classes[0]?.members).toEqual(['<<#lt;b#gt;tag#lt;/b#gt; #9829;>>'])
  expect(parseClassDiagram(source.split('\n')).classes[0]?.annotation).toBe('<b>tag</b> ♥')
  expect(drawnTexts(source)).toContain('<<<b>tag</b> ♥>>')
  expect(renderMermaidASCII(source)).toContain('<<<b>tag</b> ♥>>')
  expect(renderMermaidSVG(source)).toContain('&lt;&lt;&lt;b&gt;tag&lt;/b&gt; ♥&gt;&gt;')
  expect(renderMermaidSVG(source)).toContain('data-annotation="&lt;b&gt;tag&lt;/b&gt; ♥"')
})

test('Class member overflow measures the same literal text as native layout and paint', () => {
  const members = ['+#9829;', '+#lt;b#gt;x#lt;/b#gt;', '#protected', '+List~int~ value', '<<#9829;>>', '+value$']
  const parsed = parseRegisteredMermaid(`classDiagram\nclass A {\n${members.join('\n')}\n}`)
  if (!parsed.ok) throw new Error('fixture rejected')
  const warnings = verifyMermaid(parsed.value, { labelCharCap: 1 }).warnings
    .filter(warning => warning.code === 'LABEL_OVERFLOW')
    .map(warning => [warning.target, warning.charCount])
  expect(warnings).toEqual([
    ['A#m0', '+♥'.length], ['A#m1', '+<b>x</b>'.length], ['A#m2', '#protected'.length],
    ['A#m3', '+List<int> value'.length], ['A#m4', '<<♥>>'.length], ['A#m5', '+value'.length],
  ])
})

test('a %%{…}%% directive in a member is removed before the member is read, as Mermaid removes it', async () => {
  // Mermaid's preprocessing removes every directive from the source before
  // its grammar reads it, a `}` in it too, and applies an init's config.
  const sources = [
    'classDiagram\n  class A {\n    +literal(%%{init: {}}%%)\n  }',
    'classDiagram\n  class A\n  A : +x %%{wrap}%%',
    'classDiagram\n  class A\n  A : +x %%{init: {"theme": "dark"}}%%',
  ]
  const members = (source: string): string[] => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'class') throw new Error(`structured Class required: ${source}`)
    return parsed.value.body.classes[0]!.members
  }
  expect(sources.map(members)).toEqual([['+literal()'], ['+x'], ['+x']])
  expect(sources.map(source => drawnTexts(source).slice(1))).toEqual([['+ literal()'], ['+x'], ['+x']])
  expect(sources.map(source => verifyMermaid(source).warnings.flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : [])))
    .toEqual([[], [], []])
  // A warning on such a line names its authored line, though the line is read without the directive.
  expect(verifyMermaid('---\ntitle: t\n---\nclassDiagram\n  class A\n  A : a:b %%{init: {"theme": "dark"}}%%').warnings
    .flatMap(warning => warning.code === 'UNSUPPORTED_SYNTAX' ? [`${warning.syntax}@${warning.line}`] : [])).toEqual(['class_member_text@6'])
  const upstream = startUpstreamMermaid()
  try {
    expect(await upstream.projectAll(sources, diagram => {
      const node = diagram.db.getClasses().get('A')
      return [...node.members, ...node.methods].map((member: { getDisplayDetails(): { displayText: string } }) => member.getDisplayDetails().displayText)
    })).toEqual([['+literal()'], ['+x'], ['+x']])
    // Text an edit adds keeps its `%%{`: the writer spells the brace `#123;`.
    const parsed = parseRegisteredMermaid('classDiagram\n  class A')
    if (!parsed.ok) throw new Error('fixture rejected')
    const edited = mutate(parsed.value, { kind: 'add_note', for: 'A', text: 'a %%{x}%% b' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const written = serializeMermaid(edited.value)
    const reloaded = parseRegisteredMermaid(written)
    expect(reloaded.ok && reloaded.value.body.kind === 'class' && reloaded.value.body.notes.map(note => note.text)).toEqual(['a %%{x}%% b'])
    expect((await upstream.projectAll([written], diagram => [...diagram.db.getNotes().values()].map((note: { text: string }) => note.text))).map(texts => texts.map(text => projectEntityMarkers(text))))
      .toEqual([['a %%{x}%% b']])
  } finally { upstream.close() }
})
