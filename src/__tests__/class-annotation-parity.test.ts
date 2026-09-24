import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { asClass, mutate, parseRegisteredMermaid, renderMermaidPNG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { parseClassAnnotationStatement, parseClassDiagram } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'

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
  test('pinned Mermaid 11.16 DB distinguishes one annotation from two', () => {
    // Class DB calls DOMPurify in Node; isolate an identity sanitizer shim in
    // a child process. This probes grammar/DB semantics, never output safety.
    const script = `
      import DOMPurify from 'dompurify'
      DOMPurify.addHook = () => {}
      DOMPurify.sanitize = text => text
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false })
      const sources = ${JSON.stringify([...sources, 'classDiagram\n  class Shape <<interface>>\n  <<abstract>> Shape'])}
      const annotations = []
      for (const source of sources) {
        const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
        annotations.push(diagram.db.getClasses().get('Shape').annotations)
      }
      process.stdout.write(JSON.stringify(annotations))
    `
    const probe = Bun.spawnSync({ cmd: [process.execPath, '-e', script], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual([
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

  test('pinned Mermaid rejects unsupported tokens and separate annotation before a class exists', () => {
    const script = `
      import DOMPurify from 'dompurify'
      DOMPurify.addHook = () => {}
      DOMPurify.sanitize = text => text
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false })
      const sources = ${JSON.stringify([
        'classDiagram\n<<interface>> Shape',
        'classDiagram\nclass Shape <<interface name>>',
        'classDiagram\nclass Shape <<interface-name>>',
      ])}
      const rejected = []
      for (const source of sources) {
        try { await mermaid.mermaidAPI.getDiagramFromText(source); rejected.push(false) }
        catch { rejected.push(true) }
      }
      process.stdout.write(JSON.stringify(rejected))
    `
    const probe = Bun.spawnSync({ cmd: [process.execPath, '-e', script], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual([true, true, true])
  })

  test('body annotations retain Mermaid 11.16 broad raw tokens, including empty and nested delimiters', () => {
    const cases = [
      ['class Shape { << interface >> }', ' interface '],
      ['class Shape {\n<< interface >>\n}', ' interface '],
      ['class Shape {\n<<interface-name>>\n}', 'interface-name'],
      ['class Shape { <<>> }', ''],
      ['class Shape { <<<foo>>> }', '<foo>'],
      ['class Shape {\n<<foo>>bar>>\n}', 'foo>>bar'],
    ] as const
    const script = `
      import DOMPurify from 'dompurify'
      DOMPurify.addHook = () => {}
      DOMPurify.sanitize = text => text
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({ startOnLoad: false })
      const sources = ${JSON.stringify(cases.map(([body]) => `classDiagram\n${body}`))}
      const annotations = []
      for (const source of sources) {
        const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
        annotations.push(diagram.db.getClasses().get('Shape').annotations)
      }
      process.stdout.write(JSON.stringify(annotations))
    `
    const probe = Bun.spawnSync({ cmd: [process.execPath, '-e', script], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual(cases.map(([, annotation]) => [annotation]))

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

  test('direct parser ignores annotation text in full-line comments', () => {
    expect(parseClassDiagram(['classDiagram', '%% note <<interface>>', 'class Shape']).classes.map(node => node.id)).toEqual(['Shape'])
  })

  test('annotation scanning stays linear at the public 64 KiB source limit', () => {
    const malformed = `class ${' '.repeat(65_000)}x`
    const start = performance.now()
    expect(parseClassAnnotationStatement(malformed)).toBeNull()
    expect(performance.now() - start).toBeLessThan(1_000)
  })

  test('the before/after SVGs are honest same-input renderer evidence', () => {
    const source = 'classDiagram\n  class Shape <<interface>>'
    const before = readFileSync(new URL('../../docs/pr-assets/issue-248-class-annotation-before.svg', import.meta.url), 'utf8')
    const after = readFileSync(new URL('../../docs/pr-assets/issue-248-class-annotation-after.svg', import.meta.url), 'utf8')
    const afterPng = readFileSync(new URL('../../docs/pr-assets/issue-248-class-annotation-after.png', import.meta.url))
    expect(before).toContain('width="0" height="0"')
    expect(before).not.toContain('data-annotation=')
    expect(after).toBe(renderMermaidSVG(source, { embedFontImport: false }))
    expect(after).toContain('data-annotation="interface"')
    expect(afterPng).toEqual(Buffer.from(renderMermaidPNG(source)))
  })

  test('the lazy browser route retains the same annotation or specific rejection', async () => {
    expect(await renderMermaidSVGAsync(sources[0]!)).toContain('data-annotation="interface"')
    await expect(renderMermaidSVGAsync('classDiagram\n  class Shape <<interface>>\n  <<abstract>> Shape')).rejects.toThrow(/Multiple annotations/)
  })
})
