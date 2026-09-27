import { expect, test } from 'bun:test'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG } from '../index.ts'

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
