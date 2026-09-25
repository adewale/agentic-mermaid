import { describe, expect, test } from 'bun:test'
import { asClass, mutate, parseRegisteredMermaid, renderMermaidWithActions, serializeMermaid } from '../agent/index.ts'
import { collectActionRecords } from '../agent/analyze.ts'
import { parseAuthoredClassInteraction, parseClassDiagram, parseClassInteraction } from '../class/parser.ts'
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
      ['A', 'link A "https://example.com/docs" "API reference" _self ""'],
      ['A B', 'link `A B` "https://example.com/docs" "API reference" _self'],
      ['A B', 'click `A B` href "https://example.com/docs" "API reference" garbage'],
      ['A', 'link A~long generic~ "https://example.com/docs" "API reference" garbage'],
    ] as const) {
      const source = `classDiagram\nclass \`${id}\`\n${statement}`
      expect(parseAuthoredClassInteraction(statement)).toBeNull()
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

  test('pinned Mermaid ignores quoted text after a trailing comment', () => {
    const statement = 'link A "https://example.com" "one" %%bad "garbage"'
    const probe = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const diagram = await mermaid.mermaidAPI.getDiagramFromText('classDiagram\\nclass A\\n' + ${JSON.stringify(statement)})
        process.stdout.write(JSON.stringify(diagram.db.getClasses().get('A')?.tooltip))
      `], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(probe.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toBe('one')
    expect(parseClassInteraction(statement)?.tooltip).toBe('one')
    const source = `classDiagram\nclass A\n${statement}`
    expect(renderMermaidSVG(source)).toContain('<title>one</title>')
    expect(renderMermaidWithActions(source, { format: 'svg' }).actionSurface.actions[0]?.tooltip).toBe('one')
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

    const percentSource = 'classDiagram\nclass A\nlink A "https://example.com" "A &quot;quote&quot; %% literal" %% trailing'
    expect(renderMermaidSVG(percentSource)).toContain('<title>A &quot;quote&quot; %% literal</title>')
    expect(renderMermaidWithActions(percentSource, { format: 'svg' }).actionSurface.actions[0]?.tooltip).toBe('A "quote" %% literal')

    const spacedEntity = 'classDiagram\nclass A\nlink A "https://example.com" "A &quot; hello &quot;!"'
    expect(renderMermaidSVG(spacedEntity)).toContain('<title>A &quot; hello &quot;!</title>')
    const spacedParsed = parseRegisteredMermaid(spacedEntity)
    expect(spacedParsed.ok).toBe(true)
    if (spacedParsed.ok) expect(asClass(spacedParsed.value)?.body.classes[0]?.tooltip).toBe('A " hello "!')
    const percentEntity = 'classDiagram\nclass A\nlink A "https://example.com" "A &quot; %% text &quot; after"'
    expect(renderMermaidSVG(percentEntity)).toContain('<title>A &quot; %% text &quot; after</title>')
    const percentParsed = parseRegisteredMermaid(percentEntity)
    expect(percentParsed.ok).toBe(true)
    if (percentParsed.ok) expect(asClass(percentParsed.value)?.body.classes[0]?.tooltip).toBe('A " %% text " after')
    expect(renderMermaidWithActions(percentEntity, { format: 'svg' }).actionSurface.actions[0]?.tooltip).toBe('A " %% text " after')
    expect(renderMermaidWithActions(percentEntity, { format: 'ascii', options: { colorMode: 'none' } }).actionSurface.actions[0]?.tooltip).toBe('A " %% text " after')
    const upstream = Bun.spawnSync({
      cmd: [process.execPath, '-e', `
        import DOMPurify from 'dompurify'
        DOMPurify.addHook = () => {}
        DOMPurify.sanitize = text => text
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({ startOnLoad: false })
        const sources = ${JSON.stringify([spacedEntity, percentEntity])}
        const tooltips = []
        for (const source of sources) {
          const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
          tooltips.push(diagram.db.getClasses().get('A')?.tooltip)
        }
        process.stdout.write(JSON.stringify(tooltips))
      `], cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe',
    })
    expect(upstream.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(upstream.stdout))).toEqual([
      'A &quot; hello &quot;!', 'A &quot; %% text &quot; after',
    ])
  })

  test('entity newlines split Class actions at the same boundary as rendering', () => {
    const introduced = 'classDiagram\nclass A&#10;link A "https://example.com" "Tip"'
    expect(renderMermaidSVG(introduced)).toContain('<title>Tip</title>')
    expect(renderMermaidWithActions(introduced, { format: 'svg' }).actionSurface.actions).toEqual([
      expect.objectContaining({ href: 'https://example.com', tooltip: 'Tip', security: 'safe', line: 2 }),
    ])
    const unrelated = 'classDiagram\nclass A&#10;class B\nlink A "https://example.com" "Tip" _self ""'
    expect(() => renderMermaidSVG(unrelated)).toThrow()
    const unrelatedParsed = parseRegisteredMermaid(unrelated)
    expect(unrelatedParsed.ok).toBe(true)
    if (unrelatedParsed.ok) {
      expect(unrelatedParsed.value.body.kind).toBe('opaque')
      expect(collectActionRecords(unrelatedParsed.value)[0]?.tooltip).toBeUndefined()
    }
    const sameLine = 'classDiagram\nclass A&#10;link A "https://example.com" "Tip" _self ""'
    expect(() => renderMermaidSVG(sameLine)).toThrow()
    const splitTooltip = 'classDiagram\nclass A\nlink A "https://example.com" "First&#10;Second"'
    expect(() => renderMermaidSVG(splitTooltip)).toThrow()
    const parsed = parseRegisteredMermaid(splitTooltip)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(collectActionRecords(parsed.value)).toEqual([])
  })

  test('encoded comments, blank lines, and accessibility directives do not shift link provenance', () => {
    const prefixes = [
      '&#37;&#37; encoded comment',
      '&#32;',
      'accTitle&#58; Diagram',
      'accDescr&#58; Description',
    ]
    for (const prefix of prefixes) {
      const source = `classDiagram\nclass A\n${prefix}\nlink A "https://example.com" "tip"`
      expect(renderMermaidSVG(source)).toContain('<title>tip</title>')
      expect(renderMermaidWithActions(source, { format: 'svg' }).actionSurface.actions).toEqual([
        expect.objectContaining({ target: 'A', href: 'https://example.com', tooltip: 'tip', security: 'safe', line: 4 }),
      ])
    }
    const trailing = 'classDiagram\nclass A\nlink A "https://example.com" "tip" &#37;&#37; trailing'
    expect(renderMermaidSVG(trailing)).toContain('<title>tip</title>')
    expect(renderMermaidWithActions(trailing, { format: 'svg' }).actionSurface.actions).toEqual([
      expect.objectContaining({ target: 'A', href: 'https://example.com', tooltip: 'tip', security: 'safe', line: 3 }),
    ])
    const encodedBrace = 'classDiagram\nclass A\naccDescr {\nhello\n&#125; link A "https://example.com" "tip"'
    expect(renderMermaidSVG(encodedBrace)).toContain('<title>tip</title>')
    // The action scanner retains authored physical provenance here; the agent
    // tooltip gap for an entity-created accDescr closer is tracked separately.
    expect(renderMermaidWithActions(encodedBrace, { format: 'svg' }).actionSurface.actions).toEqual([
      expect.objectContaining({ target: 'A', href: 'https://example.com', security: 'safe', line: 5 }),
    ])
    const notAComment = 'classDiagram\nclass A\nlink A "https://example.com" "tip" &percnt;&percnt; trailing'
    expect(() => renderMermaidSVG(notAComment)).toThrow()
  })

  test('authored quote boundaries survive entities used in otherwise valid link syntax', () => {
    const statements = [
      'link A "https&#58;//example.com" "tip"',
      'link&#32;A "https://example.com" "tip"',
      'link A&#32;"https://example.com" "tip"',
      'link A "https://example.com"&#32;"tip"',
      '&#32;link A "https://example.com" "tip"',
      'link A "https://example.com" "tip"&#32;',
    ]
    for (const statement of statements) {
      const source = `classDiagram\nclass A\n${statement}`
      expect(renderMermaidSVG(source)).toContain('<title>tip</title>')
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(asClass(parsed.value)?.body.classes[0]?.tooltip).toBe('tip')
    }
    expect(() => renderMermaidSVG('classDiagram\nclass A\nlink&#32;A "https://example.com" "tip" _self ""')).toThrow()
    expect(renderMermaidSVG('classDiagram\nclass A\nlink A https&#58;//example.com')).toContain('data-href="https://example.com"')
  })

  test('structured Class URL entities survive serialize and reparse', () => {
    const source = 'classDiagram\nclass A\nlink A "https://example.com/?q=&amp;quot;" "tip"'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asClass(parsed.value)?.body.classes[0]?.href).toBe('https://example.com/?q=&quot;')
    const serialized = serializeMermaid(parsed.value)
    expect(serialized).toContain('https://example.com/?q=&amp;quot;')
    const reparsed = parseRegisteredMermaid(serialized)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(asClass(reparsed.value)?.body.classes[0]?.href).toBe('https://example.com/?q=&quot;')
    expect(renderMermaidSVG(serialized)).toContain('data-href="https://example.com/?q=&amp;quot;"')
  })

  test('an entity for a private-use character remains tooltip and URL content', () => {
    const source = 'classDiagram\nclass A\nlink A "https://example.com/x&#57344;y" "x&#57344;y"'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(asClass(parsed.value)?.body.classes[0]?.href).toBe('https://example.com/x\uE000y')
      expect(asClass(parsed.value)?.body.classes[0]?.tooltip).toBe('x\uE000y')
    }
    expect(renderMermaidSVG(source)).toContain('<title>x\uE000y</title>')
    expect(() => renderMermaidSVG('classDiagram\nclass A\nlink A https://example.com&#34;tail')).toThrow()
    expect(() => renderMermaidSVG('classDiagram\nclass A\nlink A https://example.com"tail"')).toThrow()
    expect(() => renderMermaidSVG('classDiagram\nclass A\nlink A https://example.com "tail"')).toThrow()
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

  test('encoded controls cannot bypass semantic Class validation', () => {
    const encodedControl = 'classDiagram\nclass A\nlink A "https://example.com" "x&#27;y"'
    const controlParsed = parseRegisteredMermaid(encodedControl)
    expect(controlParsed.ok).toBe(true)
    if (controlParsed.ok) {
      expect(controlParsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(controlParsed.value)).toContain('"x&#27;y"')
      expect(serializeMermaid(controlParsed.value)).not.toContain('\u001b')
      expect(collectActionRecords(controlParsed.value)).toEqual([])
    }
    expect(() => renderMermaidSVG(encodedControl)).toThrow()

  })

  test('authored quote provenance separates encoded tooltip text from a raw navigation target', () => {
    const encoded = 'classDiagram\nclass A\nlink A "https://example.com" "tip&quot; _self &quot;"'
    const raw = 'classDiagram\nclass A\nlink A "https://example.com" "tip" _self ""'
    const encodedParsed = parseRegisteredMermaid(encoded)
    expect(encodedParsed.ok).toBe(true)
    if (encodedParsed.ok) expect(asClass(encodedParsed.value)?.body.classes[0]?.tooltip).toBe('tip" _self "')
    expect(renderMermaidSVG(encoded)).toContain('<title>tip&quot; _self &quot;</title>')
    expect(renderMermaidWithActions(encoded, { format: 'svg' }).actionSurface.actions[0]).toEqual(expect.objectContaining({
      href: 'https://example.com', tooltip: 'tip" _self "', executable: false,
    }))
    const rawParsed = parseRegisteredMermaid(raw)
    expect(rawParsed.ok).toBe(true)
    if (rawParsed.ok) expect(rawParsed.value.body.kind).toBe('opaque')
    expect(() => renderMermaidSVG(raw)).toThrow()

    const encodedUrl = 'classDiagram\nclass A\nlink A &quot;https://example.com&quot; "tip"'
    expect(renderMermaidSVG(encodedUrl)).toContain('<title>tip</title>')
    const typedEncoded = parseRegisteredMermaid('classDiagram\nclass A\nlink A &quot;https://example.com&quot; &quot;tip&quot;')
    expect(typedEncoded.ok).toBe(true)
    if (typedEncoded.ok) expect(asClass(typedEncoded.value)?.body.classes[0]?.tooltip).toBe('tip')
    const encodedUrlWithRawTarget = 'classDiagram\nclass A\nlink A &quot;https://example.com&quot; "tip" _self ""'
    expect(() => renderMermaidSVG(encodedUrlWithRawTarget)).toThrow()
    const rejected = parseRegisteredMermaid(encodedUrlWithRawTarget)
    expect(rejected.ok).toBe(true)
    if (rejected.ok) {
      expect(rejected.value.body.kind).toBe('opaque')
      expect(collectActionRecords(rejected.value)[0]?.tooltip).toBeUndefined()
    }
    const fullyEncodedTarget = 'classDiagram\nclass A\nlink A &quot;https://example.com&quot; &quot;tip&quot; _self &quot;&quot;'
    expect(() => renderMermaidSVG(fullyEncodedTarget)).toThrow()
    const encodedRejected = parseRegisteredMermaid(fullyEncodedTarget)
    expect(encodedRejected.ok).toBe(true)
    if (encodedRejected.ok) {
      expect(encodedRejected.value.body.kind).toBe('opaque')
      expect(collectActionRecords(encodedRejected.value)[0]?.tooltip).toBeUndefined()
    }
  })

  test('malformed comment-rich tooltip parsing remains linear-sized', () => {
    const statement = `link A "https://example.com" "unterminated${' %%'.repeat(80_000)}`
    expect(parseClassInteraction(statement)).toBeNull()
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
