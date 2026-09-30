import { afterAll, describe, expect, test } from 'bun:test'
import { asClass, mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { parseClassAnnotationStatement, parseClassDiagram } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { expectNearLinearGrowth } from './helpers/complexity.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

const upstream = startUpstreamMermaid()
afterAll(() => upstream.close())

// Mermaid 11.16 official syntax: classDiagram.html#annotations-on-classes.
const sources = [
  'classDiagram\n  class Shape <<interface>>\n  class Other\n  Shape --> Other',
  'classDiagram\n  class Shape\n  <<interface>> Shape\n  class Other\n  Shape --> Other',
  'classDiagram\n  class Shape {\n    <<interface>>\n  }\n  class Other\n  Shape --> Other',
  'classDiagram\n  class Shape<<interface>>\n  class Other\n  Shape --> Other',
  'classDiagram\n  class Shape\n  <<interface>>Shape\n  class Other\n  Shape --> Other',
  'classDiagram\n  class Shape["Thing"] <<interface>>\n  class Other\n  Shape --> Other',
  'classDiagram\n  class Shape << interface >>\n  class Other\n  Shape --> Other',
  'classDiagram\n  class Shape\n  << interface >>Shape\n  class Other\n  Shape --> Other',
]

describe('Class official annotation forms', () => {
  test('pinned Mermaid 11.16 DB distinguishes one annotation from two', async () => {
    const annotations = await upstream.projectAll([...sources, 'classDiagram\n  class Shape <<interface>>\n  <<abstract>> Shape'],
      diagram => diagram.db.getClasses().get('Shape').annotations)
    expect(annotations).toEqual([
      ['interface'], ['interface'], ['interface'], ['interface'], ['interface'], ['interface'], ['interface'], ['interface'], ['interface', 'abstract'],
    ])
  })

  test('inline, separate, and body forms retain the same class meaning and rendered annotation', () => {
    for (const source of sources) {
      const native = parseClassDiagram(source.split('\n').map(line => line.trim()))
      expect(native.classes.find(node => node.id === 'Shape')?.annotation).toBe('interface')
      if (source.includes('["Thing"]')) expect(native.classes.find(node => node.id === 'Shape')?.label).toBe('Thing')
      expect(native.relationships.map(relation => [relation.from, relation.to])).toEqual([['Shape', 'Other']])
      const svg = renderMermaidSVG(source)
      expect(svg).toContain('data-annotation="interface"')
      expect(svg).toContain('&lt;&lt;interface&gt;&gt;')

      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const body = asClass(parsed.value)?.body
      expect(body?.classes.find(node => node.id === 'Shape')?.members).toContain('<<interface>>')
      if (source.includes('["Thing"]')) expect(body?.classes.find(node => node.id === 'Shape')?.label).toBe('Thing')
      expect(verifyMermaid(parsed.value).ok).toBe(true)

      const serialized = serializeMermaid(parsed.value)
      const reparsed = parseRegisteredMermaid(serialized)
      expect(reparsed.ok).toBe(true)
      if (reparsed.ok) {
        expect(asClass(reparsed.value)?.body.classes.find(node => node.id === 'Shape')?.members).toContain('<<interface>>')
        expect(parseClassDiagram(serialized.trim().split('\n').map(line => line.trim())).classes.find(node => node.id === 'Shape')?.annotation).toBe('interface')
      }
    }
  })

  test('renaming the class preserves its annotation and unrelated relation', () => {
    const parsed = parseRegisteredMermaid(sources[0]!)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const structured = asClass(parsed.value)
    expect(structured).not.toBeNull()
    if (!structured) return
    const renamed = mutate(structured, { kind: 'rename_class', from: 'Shape', to: 'Form' })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const source = serializeMermaid(renamed.value)
    const native = parseClassDiagram(source.trim().split('\n').map(line => line.trim()))
    expect(native.classes.find(node => node.id === 'Form')?.annotation).toBe('interface')
    expect(native.relationships.map(relation => [relation.from, relation.to])).toEqual([['Form', 'Other']])
  })

  test('multiple or malformed annotations fail loudly while the agent preserves authored source', () => {
    for (const source of [
      'classDiagram\n  class Shape <<interface>>\n  <<abstract>> Shape',
      'classDiagram\n  class Shape\n  <<interface>> Shape extra',
      'classDiagram\n  <<interface>> Shape',
      'classDiagram\n  class Shape <<interface name>>',
      'classDiagram\n  class Shape <<interface-name>>',
    ]) {
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(`${source}\n`)
      const verified = verifyMermaid(parsed.value)
      expect(verified.ok).toBe(false)
      expect(verified.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RENDER_FAILED' })]))
      expect(() => renderMermaidSVG(source)).toThrow(/annotation/i)
    }
  })

  test('pinned Mermaid rejects unsupported tokens and separate annotation before a class exists', async () => {
    const sources = [
      'classDiagram\n<<interface>> Shape',
      'classDiagram\nclass Shape <<interface name>>',
      'classDiagram\nclass Shape <<interface-name>>',
    ]
    expect(await Promise.all(sources.map(upstream.accepts))).toEqual([false, false, false])
  })

  test('body annotations retain Mermaid 11.16 broad raw tokens, including empty and nested delimiters', async () => {
    const cases = [
      ['class Shape { << interface >> }', ' interface '],
      ['class Shape {\n<< interface >>\n}', ' interface '],
      ['class Shape {\n<<interface-name>>\n}', 'interface-name'],
      ['class Shape { <<>> }', ''],
      ['class Shape { <<<foo>>> }', '<foo>'],
      ['class Shape {\n<<foo>>bar>>\n}', 'foo>>bar'],
    ] as const
    expect(await upstream.projectAll(cases.map(([body]) => `classDiagram\n${body}`), diagram => diagram.db.getClasses().get('Shape').annotations))
      .toEqual(cases.map(([, annotation]) => [annotation]))

    for (const [body, annotation] of cases) {
      const source = `classDiagram\n${body}`
      const native = parseClassDiagram(source.split('\n').map(line => line.trim()))
      expect(native.classes.find(node => node.id === 'Shape')?.annotation).toBe(annotation)
      const svg = renderMermaidSVG(source)
      expect(svg).toContain('data-annotation=')
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(asClass(parsed.value)?.body.classes.find(node => node.id === 'Shape')?.members).toContain(`<<${annotation}>>`)
      expect(verifyMermaid(parsed.value).ok).toBe(true)
      const serialized = serializeMermaid(parsed.value)
      expect(parseClassDiagram(serialized.trim().split('\n').map(line => line.trim())).classes.find(node => node.id === 'Shape')?.annotation).toBe(annotation)
    }

    const repeated = 'classDiagram\nclass Shape {\n<<interface-name>>\n<<foo.bar>>\n}'
    expect(() => renderMermaidSVG(repeated)).toThrow(/Multiple annotations/)
    const parsed = parseRegisteredMermaid(repeated)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.body.kind).toBe('opaque')
  })

  test('annotation delimiter is outside quoted labels, generics, and backtick IDs', async () => {
    const cases = [
      { source: 'classDiagram\nclass Shape["<<Vector>>"] <<interface>>', id: 'Shape', label: '<<Vector>>', renders: true },
      { source: 'classDiagram\nclass Box~List<<T>>~ <<interface>>', id: 'Box', label: 'Box', renders: false },
      { source: 'classDiagram\nclass `A<<B>>` <<interface>>', id: 'A<<B>>', label: 'A<<B>>', renders: false },
    ] as const
    expect(await upstream.projectAll(cases.map(entry => entry.source), diagram => {
      const [id, cls] = [...diagram.db.getClasses()][0]
      return { id, label: cls.label, annotations: cls.annotations }
    })).toEqual(cases.map(entry => ({
      id: entry.id, label: entry.label, annotations: ['interface'],
    })))

    for (const { source, id, renders } of cases) {
      const native = parseClassDiagram(source.split('\n'))
      expect(native.classes.find(node => node.id === id)?.annotation).toBe('interface')
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(asClass(parsed.value)?.body.classes.find(node => node.id === id)?.members).toContain('<<interface>>')
      const verified = verifyMermaid(parsed.value)
      if (renders) {
        expect(verified.ok).toBe(true)
        expect(renderMermaidSVG(source)).toContain('data-annotation="interface"')
      } else {
        // These angle-bearing class labels already hit Scene validation on
        // the base without annotations; preserve a public diagnostic here.
        expect(verified.ok).toBe(false)
        expect(verified.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RENDER_FAILED' })]))
        expect(() => renderMermaidSVG(source)).toThrow(/Scene validation failed/)
      }
      const serialized = serializeMermaid(parsed.value)
      expect(parseClassDiagram(serialized.trim().split('\n').map(line => line.trim())).classes.find(node => node.id === id)?.annotation).toBe('interface')
    }
  })

  test('angle-bearing backtick IDs remain diagnosed rather than silently losing label text', () => {
    const source = 'classDiagram\nclass `A<<B>>`'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const verified = verifyMermaid(parsed.value)
    expect(verified.ok).toBe(false)
    expect(verified.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RENDER_FAILED' })]))
    expect(() => renderMermaidSVG(source)).toThrow(/Scene validation failed/)
  })

  test('direct parser ignores annotation text in full-line comments', () => {
    expect(parseClassDiagram(['classDiagram', '%% note <<interface>>', 'class Shape']).classes.map(node => node.id)).toEqual(['Shape'])
  })

  test('annotation scanning stays linear at the public 64 KiB source limit', () => {
    expectNearLinearGrowth('malformed annotation statement', size => {
      expect(parseClassAnnotationStatement(`class ${' '.repeat(size)}x`)).toBeNull()
    }, 65_000)
    expectNearLinearGrowth('annotation after a delimiter-heavy label', size => {
      expect(parseClassAnnotationStatement(`class Shape["${'<<'.repeat(size)}"] <<interface>>`)?.annotation).toBe('interface')
    }, 30_000)
  })

  test('a lone inline-annotated class renders a sized box carrying its stereotype', () => {
    const svg = renderMermaidSVG('classDiagram\n  class Shape <<interface>>', { embedFontImport: false })
    const [, width, height] = svg.match(/<svg\b[^>]*\bwidth="([0-9.]+)" height="([0-9.]+)"/) ?? []
    expect(Number(width)).toBeGreaterThan(0)
    expect(Number(height)).toBeGreaterThan(0)
    expect(svg).toContain('data-annotation="interface"')
    expect(svg).toContain('&lt;&lt;interface&gt;&gt;')
  })

  test('the lazy browser route retains the same annotation or specific rejection', async () => {
    expect(await renderMermaidSVGAsync(sources[0]!)).toContain('data-annotation="interface"')
    await expect(renderMermaidSVGAsync('classDiagram\n  class Shape <<interface>>\n  <<abstract>> Shape')).rejects.toThrow(/Multiple annotations/)
  })
})
