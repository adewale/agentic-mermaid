import { describe, expect, test } from 'bun:test'
import { asClass, mutate, parseRegisteredMermaid, renderMermaidWithActions, serializeMermaid } from '../agent/index.ts'
import { collectActionRecords } from '../agent/analyze.ts'
import { parseClassDiagram, parseClassInteraction } from '../class/parser.ts'
import { renderMermaidSVG } from '../index.ts'

const links = [
  'link A "https://example.com/docs" "API reference"',
  'click A href "https://example.com/docs" "API reference"',
] as const

describe('Class safe-link tooltip fidelity', () => {
  test('pinned Mermaid 11.16 assigns both safe-link forms the same tooltip', () => {
    const probe = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const result = []
        for (const statement of ${JSON.stringify(links)}) {
          const diagram = await mermaid.mermaidAPI.getDiagramFromText('classDiagram\\nclass A\\n' + statement)
          const cls = diagram.db.getClasses().get('A')
          result.push({ link: cls?.link, tooltip: cls?.tooltip })
        }
        process.stdout.write(JSON.stringify(result))
      `],
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual([
      { link: 'https://example.com/docs', tooltip: 'API reference' },
      { link: 'https://example.com/docs', tooltip: 'API reference' },
    ])
  })

  test.each([...links])('%s retains tooltip across native, agent, serialize, and action surfaces', statement => {
    const source = `classDiagram\nclass A\n${statement}\nclass B`
    expect(parseClassInteraction(statement)).toEqual({ id: 'A', href: 'https://example.com/docs', tooltip: 'API reference' })
    expect(parseClassDiagram(source.split('\n')).classes.find(cls => cls.id === 'A')).toEqual(expect.objectContaining({
      href: 'https://example.com/docs', tooltip: 'API reference',
    }))
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asClass(parsed.value)?.body.classes.find(cls => cls.id === 'A')).toEqual(expect.objectContaining({
      href: 'https://example.com/docs', tooltip: 'API reference',
    }))
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain('click A href "https://example.com/docs" "API reference"')
    expect(parseClassDiagram(serialized.split('\n')).classes.find(cls => cls.id === 'A')?.tooltip).toBe('API reference')
    const renamed = mutate(parsed.value, { kind: 'rename_class', from: 'B', to: 'Branch' })
    expect(renamed.ok).toBe(true)
    if (renamed.ok) expect(asClass(renamed.value)?.body.classes.find(cls => cls.id === 'A')?.tooltip).toBe('API reference')
    const svg = renderMermaidSVG(source)
    expect(svg).toMatch(/<g class="class-node" data-id="A"[^>]*>\s*<title>API reference<\/title>/)
    for (const format of ['svg', 'png', 'ascii'] as const) {
      const artifact = format === 'ascii'
        ? renderMermaidWithActions(source, { format, options: { colorMode: 'none' } })
        : renderMermaidWithActions(source, { format })
      expect(artifact.actionSurface.actions[0]).toEqual(expect.objectContaining({
        target: 'A', href: 'https://example.com/docs', tooltip: 'API reference', executable: false,
      }))
    }
  })

  test('malformed trailing text cannot silently disappear', () => {
    const statement = 'link A "https://example.com/docs" "API reference" garbage'
    expect(parseClassInteraction(statement)).toBeNull()
    expect(() => parseClassDiagram(`classDiagram\nclass A\n${statement}`.split('\n'))).toThrow()
    const parsed = parseRegisteredMermaid(`classDiagram\nclass A\n${statement}`)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.body.kind).toBe('opaque')
  })

  test('Mermaid-valid navigation targets remain diagnosed, not silently omitted', () => {
    for (const [id, statement] of [
      ['A', 'link A "https://example.com/docs" "API reference" _self'],
      ['A B', 'link `A B` "https://example.com/docs" "API reference" _self'],
      ['A B', 'click `A B` href "https://example.com/docs" "API reference" garbage'],
      ['A', 'link A~long generic~ "https://example.com/docs" "API reference" garbage'],
    ] as const) {
      const source = `classDiagram\nclass \`${id}\`\n${statement}`
      expect(parseClassInteraction(statement)).toBeNull()
      expect(() => parseClassDiagram(source.split('\n'))).toThrow()
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.value.body.kind).toBe('opaque')
    }
  })

  test('Mermaid-valid trailing comments stay inert, including tooltip text containing %%', () => {
    for (const statement of [
      'link A "https://example.com/docs" "API %% reference" %% trailing',
      'click A href "https://example.com/docs" "API %% reference" %% trailing',
    ]) {
      expect(parseClassInteraction(statement)).toEqual({ id: 'A', href: 'https://example.com/docs', tooltip: 'API %% reference' })
      expect(parseClassDiagram(`classDiagram\nclass A\n${statement}`.split('\n')).classes[0]?.tooltip).toBe('API %% reference')
    }
  })

  test('a later URL without hover text retains the last authored tooltip, like Mermaid', () => {
    const source = 'classDiagram\nclass A\nlink A "https://one.example" "First"\nlink A "https://two.example"'
    const native = parseClassDiagram(source.split('\n')).classes[0]
    expect(native?.href).toBe('https://two.example')
    expect(native?.tooltip).toBe('First')
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(asClass(parsed.value)?.body.classes[0]?.tooltip).toBe('First')
    const withEmptyTooltip = `${source} ""`
    expect(parseClassDiagram(withEmptyTooltip.split('\n')).classes[0]?.tooltip).toBe('First')
    const rendered = renderMermaidWithActions(source, { format: 'svg' })
    expect(rendered.actionSurface.actions).toEqual([
      expect.objectContaining({ href: 'https://one.example', tooltip: 'First', disposition: 'sidecar-only' }),
      expect.objectContaining({ href: 'https://two.example', tooltip: 'First', disposition: 'embedded-inert' }),
    ])
  })

  test('pinned Mermaid and local models preserve literal tooltip backslashes and tight token boundaries', () => {
    const statements = [
      String.raw`link A "https://example.com" "A\\B"`,
      'link A "https://example.com" "Tip"%%comment',
      'link A "https://example.com""Tip"',
      String.raw`link A "https://example.com" "Tip\"%%comment`,
    ]
    const probe = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const result = []
        for (const statement of ${JSON.stringify(statements)}) {
          const diagram = await mermaid.mermaidAPI.getDiagramFromText('classDiagram\\nclass A\\n' + statement)
          result.push(diagram.db.getClasses().get('A')?.tooltip)
        }
        process.stdout.write(JSON.stringify(result))
      `],
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(probe.exitCode).toBe(0)
    const upstream = JSON.parse(new TextDecoder().decode(probe.stdout)) as string[]
    expect(statements.map(statement => parseClassInteraction(statement)?.tooltip)).toEqual(upstream)
    expect(upstream).toEqual([String.raw`A\\B`, 'Tip', 'Tip', 'Tip\\'])
    const parsed = parseRegisteredMermaid(`classDiagram\nclass A\n${statements[0]}`)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(asClass(parsed.value)?.body.classes[0]?.tooltip).toBe(String.raw`A\\B`)
      const serialized = serializeMermaid(parsed.value)
      expect(serialized).toContain(String.raw`"A\\B"`)
    }
  })

  test('action records classify the full URL and decode the same entity-quoted syntax as rendering', () => {
    const unsafeWhitespace = 'classDiagram\nclass A\nlink A "https://ok.example\tjavascript:evil" "tip"'
    expect(parseClassInteraction('link A "https://ok.example\tjavascript:evil" "tip"')).toBeNull()
    expect(() => parseClassDiagram(unsafeWhitespace.split('\n'))).toThrow()
    const unsafeParsed = parseRegisteredMermaid(unsafeWhitespace)
    expect(unsafeParsed.ok).toBe(true)
    if (unsafeParsed.ok) expect(collectActionRecords(unsafeParsed.value)[0]).toEqual(expect.objectContaining({
      href: 'https://ok.example\tjavascript:evil', security: 'unsafe', executable: false,
    }))

    const encoded = 'classDiagram\nclass A\nlink A &quot;https://example.com&quot; &quot;tip&quot;'
    const rendered = renderMermaidWithActions(encoded, { format: 'svg' })
    expect(rendered.actionSurface.actions[0]).toEqual(expect.objectContaining({
      href: 'https://example.com', tooltip: 'tip', security: 'safe', disposition: 'embedded-inert',
    }))
    const encodedUnsafe = parseRegisteredMermaid('classDiagram\nclass A\nlink A &quot;javascript:alert(1)&quot; &quot;tip&quot;')
    expect(encodedUnsafe.ok).toBe(true)
    if (encodedUnsafe.ok) expect(collectActionRecords(encodedUnsafe.value)[0]).toEqual(expect.objectContaining({
      href: 'javascript:alert(1)', security: 'unsafe', executable: false,
    }))
  })

  test('entity-quoted text inside a tooltip stays coherent across the structured and rendered surfaces', () => {
    const statement = 'link A "https://example.com" "A &quot;quote&quot;"'
    const source = `classDiagram\nclass A\n${statement}`
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asClass(parsed.value)?.body.classes[0]?.tooltip).toBe('A "quote"')
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain('"A &quot;quote&quot;"')
    expect(renderMermaidSVG(source)).toContain('<title>A &quot;quote&quot;</title>')
    expect(renderMermaidWithActions(source, { format: 'svg' }).actionSurface.actions[0]?.tooltip).toBe('A "quote"')
  })

  test('entity newlines split Class actions at the same boundary as rendering', () => {
    const introduced = 'classDiagram\nclass A&#10;link A "https://example.com" "Tip"'
    expect(renderMermaidSVG(introduced)).toContain('<title>Tip</title>')
    expect(renderMermaidWithActions(introduced, { format: 'svg' }).actionSurface.actions).toEqual([
      expect.objectContaining({ href: 'https://example.com', tooltip: 'Tip', security: 'safe' }),
    ])
    const splitTooltip = 'classDiagram\nclass A\nlink A "https://example.com" "First&#10;Second"'
    expect(() => renderMermaidSVG(splitTooltip)).toThrow()
    const parsed = parseRegisteredMermaid(splitTooltip)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(collectActionRecords(parsed.value)).toEqual([])
  })

  test('literal percent pairs in an unquoted URL preserve the pre-existing destination', () => {
    const statement = 'link A https://example.com/foo%%bar'
    expect(parseClassInteraction(statement)?.href).toBe('https://example.com/foo%%bar')
    expect(parseClassDiagram(`classDiagram\nclass A\n${statement}`.split('\n')).classes[0]?.href).toBe('https://example.com/foo%%bar')
  })

  test('control characters in tooltip cannot become trusted action text or invalid XML', () => {
    const source = 'classDiagram\nclass A\nlink A "https://example.com" "x\u0001y"'
    expect(parseClassInteraction(source.split('\n')[2]!)).toBeNull()
    expect(() => renderMermaidSVG(source)).toThrow()
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.body.kind).toBe('opaque')
      expect(collectActionRecords(parsed.value)[0]?.tooltip).toBeUndefined()
    }
  })

  test('tooltip content stays inert XML text', () => {
    const source = 'classDiagram\nclass A\nlink A "https://example.com" "<script>alert(1)</script> & docs"'
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt; &amp; docs</title>')
    expect(svg).not.toContain('<script>')
    const strict = renderMermaidWithActions(source, { format: 'svg', options: { security: 'strict' } })
    if (strict.format !== 'svg') throw new Error('Expected SVG output')
    expect(strict.output).not.toContain('<title>')
    expect(strict.actionSurface.actions[0]).toEqual(expect.objectContaining({
      tooltip: '<script>alert(1)</script> & docs', disposition: 'sidecar-only', executable: false,
    }))
  })
})
