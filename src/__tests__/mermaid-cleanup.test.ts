import { describe, expect, test } from 'bun:test'
import {
  authoredMermaidSlice, cleanedMermaidOffset, cleanupMermaidSource, originalMermaidOffset, originalMermaidRange,
} from '../shared/mermaid-cleanup.ts'

describe('shared Mermaid cleanup receipt', () => {
  test('ordinary source keeps identity mappings and immutable snapshot data', () => {
    const source = 'flowchart LR\n  A[Hello] --> B'
    const receipt = cleanupMermaidSource(source)
    expect(receipt.text).toBe(source)
    expect(receipt.payloadText).toBe(source)
    expect(receipt.upstreamText).toBe(source)
    expect(receipt.prepassedText).toBe(source)
    expect(receipt.changes).toEqual([])
    expect(receipt.mappings).toEqual([])
    expect(originalMermaidRange(receipt, 15, 23)).toEqual({ start: 15, end: 23 })
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.changes)).toBe(true)
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt)
  })

  test('XML contractions and supplementary characters map to their whole authored references', () => {
    const source = 'flowchart LR\r\n A[&lt;&#x1F600;&amp;] --> B\rC'
    const receipt = cleanupMermaidSource(source)
    expect(receipt.text).toBe('flowchart LR\n A[<😀&] --> B\nC')
    const start = receipt.text.indexOf('<')
    expect(authoredMermaidSlice(receipt, start, start + 4)).toBe('&lt;&#x1F600;&amp;')
    expect(originalMermaidOffset(receipt, start + 2, 'start')).toBe(source.indexOf('&#x1F600;'))
    expect(originalMermaidOffset(receipt, start + 2, 'end')).toBe(source.indexOf('&#x1F600;') + 9)
    expect(authoredMermaidSlice(receipt, receipt.text.indexOf('B'), receipt.text.length)).toBe('B\rC')
    expect(receipt.changes.find(change => change.reason === 'xml-entity' && change.originalStart === source.indexOf('&lt;')))
      .toMatchObject({ line: 2, col: 4 })
  })

  test('entity-created CRLF is normalized once while retaining both source tokens', () => {
    for (const authored of ['&#13;\n', '&#13;&#10;', '\r&#10;']) {
      const receipt = cleanupMermaidSource(`A${authored}B`)
      expect(receipt.payloadText).toBe('A\nB')
      expect(receipt.text).toBe('A\nB')
      expect(authoredMermaidSlice(receipt, 1, receipt.text.length - 1)).toBe(authored)
    }
  })

  test('payload views normalize original CRLF once and preserve lone CR with shared offset maps', () => {
    const source = 'A\r\r\nB&#13;&#10;C\rD'
    const receipt = cleanupMermaidSource(source)
    expect(receipt.payloadText).toBe('A\r\nB\nC\rD')
    expect(receipt.authoredPayloadText).toBe('A\r\nB&#13;&#10;C\rD')
    expect(receipt.payloadText.length).toBe(receipt.text.length)
    expect(receipt.authoredPayloadText.length).toBe(receipt.lineText.length)
    expect(authoredMermaidSlice(receipt, 1, 3, 'payloadText')).toBe('\r\r\n')
    const newline = receipt.payloadText.indexOf('\n', receipt.payloadText.indexOf('B'))
    expect(authoredMermaidSlice(receipt, newline, newline + 1, 'payloadText')).toBe('&#13;&#10;')
    const rawEntity = receipt.authoredPayloadText.indexOf('&#13;')
    expect(authoredMermaidSlice(receipt, rawEntity, rawEntity + 10, 'authoredPayloadText')).toBe('&#13;&#10;')
    for (const view of ['payloadText', 'authoredPayloadText'] as const) {
      const start = cleanedMermaidOffset(receipt, source.indexOf('D'), 'start', view)
      expect(authoredMermaidSlice(receipt, start, start + 1, view)).toBe('D')
    }
  })

  test('the payload view retains CSV identities and maps authored wrapper boundaries', () => {
    const source = '---\r\ntitle: &amp;\r\n---\r\nsankey-beta\r\n"A\rB",C,1\n"A\nB",C,2'
    const receipt = cleanupMermaidSource(source)
    expect(receipt.payloadText).toBe('---\ntitle: &\n---\nsankey-beta\n"A\rB",C,1\n"A\nB",C,2')
    const originalBoundary = source.indexOf('sankey-beta')
    const payloadBoundary = cleanedMermaidOffset(receipt, originalBoundary, 'start', 'payloadText')
    expect(payloadBoundary).toBe(receipt.payloadText.indexOf('sankey-beta'))
    expect(originalMermaidOffset(receipt, payloadBoundary, 'start', 'payloadText')).toBe(originalBoundary)
    const payloadStart = receipt.payloadText.indexOf('"A\rB"')
    expect(authoredMermaidSlice(receipt, payloadStart, payloadStart + 5, 'payloadText')).toBe('"A\rB"')
    const insideReference = source.indexOf('&amp;') + 2
    expect(cleanedMermaidOffset(receipt, insideReference, 'start', 'payloadText')).toBe(receipt.payloadText.indexOf('&'))
    expect(cleanedMermaidOffset(receipt, insideReference, 'end', 'payloadText')).toBe(receipt.payloadText.indexOf('&') + 1)
    const plainXml = cleanupMermaidSource('A[&lt; #quot; #59;]')
    expect(plainXml.payloadText).toBe('A[< #quot; #59;]')
  })

  test('upstream tag quote changes preserve exact interior label offsets', () => {
    const source = 'pie\r\n "<a href="https://x" title="two\nlines">Hi</a>" : 1'
    const receipt = cleanupMermaidSource(source)
    expect(receipt.text).toBe(source.replace('\r\n', '\n'))
    expect(receipt.upstreamText).toBe('pie\n "<a href=\'https://x\' title=\'two\nlines\'>Hi</a>" : 1')
    const labelStart = receipt.upstreamText.indexOf('https')
    expect(authoredMermaidSlice(receipt, labelStart, labelStart + 9, 'upstreamText')).toBe('https://x')
    const changes = receipt.changes.filter(change => change.reason === 'html-attribute-quotes')
    expect(changes).toHaveLength(4)
    expect(changes[0]).toMatchObject({ line: 2, col: 11, view: 'upstreamText' })
    expect(changes.at(-1)).toMatchObject({ line: 3, col: 6 })
    expect(cleanupMermaidSource('<a href = "x"> <a href=\'x\'> </a href="x">').upstreamText)
      .toBe('<a href = "x"> <a href=\'x\'> </a href="x">')
  })

  test('style cleanup protects source punctuation and maps deleted adjacent semicolons', () => {
    const source = 'style A fill:#f00;; classDef c fill:#fff;;\nA["#quot; #59; #35;"]'
    const receipt = cleanupMermaidSource(source)
    expect(receipt.text).toBe(source)
    expect(receipt.prepassedText).toBe('style A fill:#f00;; classDef c fill:#fff\nA["#quot; #59; #35;"]')
    expect(receipt.upstreamText).toBe(source)
    const deletedAt = receipt.prepassedText.indexOf('\n')
    expect(authoredMermaidSlice(receipt, deletedAt, deletedAt, 'prepassedText')).toBe(';;')
  })

  test('unknown XML names and Mermaid codes retain their authored spelling', () => {
    const receipt = cleanupMermaidSource('&hearts; &unknown; #quot; #59; #notit; #x41;')
    expect(receipt.text).toBe('&hearts; &unknown; #quot; #59; #notit; #x41;')
    expect(receipt.upstreamText).toBe('&hearts; &unknown; #quot; #59; #notit; #x41;')
    expect(receipt.changes.filter(change => change.reason === 'xml-entity')).toHaveLength(0)
  })

  test('long malformed tags and repeated style keywords finish with sparse mappings', () => {
    const noClose = '<word'.repeat(20_000)
    expect(cleanupMermaidSource(noClose).changes).toEqual([])
    const source = `${'style x:#x '.repeat(10_000)};`
    const receipt = cleanupMermaidSource(source)
    expect(receipt.prepassedText).toBe(source.slice(0, -1))
    expect(receipt.prepassedMappings).toHaveLength(1)
    expect(receipt.prepassedMappings[0]!.edits).toHaveLength(1)
  })

  test('mapping rejects invalid UTF-16 boundaries and reversed ranges', () => {
    const receipt = cleanupMermaidSource('ABC')
    for (const offset of [-1, 4, 0.5, NaN]) {
      expect(() => originalMermaidOffset(receipt, offset)).toThrow(RangeError)
      expect(() => cleanedMermaidOffset(receipt, offset)).toThrow(RangeError)
    }
    expect(() => originalMermaidRange(receipt, 2, 1)).toThrow(RangeError)
  })
})

describe('cleanup at public source boundaries', () => {
  test('render requests retain exact authored slices after transport decoding', async () => {
    const { resolveRenderRequest } = await import('../render-contract.ts')
    const { renderMermaidSVG } = await import('../index.ts')
    const source = '\uFEFF---\r\ntitle: Map\r\n---\r\n%%{init: {flowchart: {rankSpacing: 80}}}%%\r\nflowchart LR\r\n%% Keep this note\r\n  A["&lt;b&gt;literal&lt;/b&gt; &#x1F600;"] --> B'
    const request = resolveRenderRequest(source, {}, 'svg')
    expect(request.source.originalText).toBe(source)
    const receipt = request.source.cleanup!
    const start = receipt.text.indexOf('<b>literal</b>')
    expect(authoredMermaidSlice(receipt, start, start + '<b>literal</b> 😀'.length)).toBe('&lt;b&gt;literal&lt;/b&gt; &#x1F600;')
    expect(request.source.authoredFamilyBody).toContain('&lt;b&gt;literal&lt;/b&gt;')
    const svg = renderMermaidSVG(source)
    const text = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]).join('')
    expect(text).toContain('&lt;b&gt;literal&lt;/b&gt; 😀')
    expect(svg).not.toContain('Keep this note')
    const { parseRegisteredMermaid } = await import('../agent/parse.ts')
    const { serializeMermaid } = await import('../agent/serialize.ts')
    const { readC4Source } = await import('../c4/parser.ts')
    for (const ending of ['\r', '\r\n', '\n']) {
      expect(readC4Source(['C4Context', 'accDescr {', 'one', 'two', '}', 'Person(a, "A")'].join(ending)).accessibilityDescription).toBe('one\ntwo')
    }
    for (const body of ['flowchart LR\nA["literal"] --> B', 'pie\n"A" : 1', 'sequenceDiagram\nA->>B: text', 'C4Context\nPerson(a, "A")']) {
      for (const ending of ['\r', '\r\n']) {
        const source = `---\ntitle: Map\n---\n${body}`.replaceAll('\n', ending)
        const parsed = parseRegisteredMermaid(source)
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
        expect(serializeMermaid(parsed.value)).toStartWith(`---${ending}title: Map${ending}---${ending}`)
        expect(parsed.value.source.spans?.preserved.header.start.line).toBe(4)
        // C4's source-preserving model participates in its CSS scope digest.
        const svg = (text: string) => renderMermaidSVG(text).replace(/am-[a-z0-9]+/g, 'am-scope')
        expect(svg(source)).toBe(svg(`---\ntitle: Map\n---\n${body}`))
        if (parsed.value.kind === 'flowchart') {
          const label = parsed.value.source.spans!.labels.get('node:A')!
          expect(source.slice(label.start.offset, label.end.offset)).toBe('literal')
          expect(label.start.line).toBe(5)
        }
      }
    }
  })

  test('init directive provenance cannot be captured by matching text in YAML', async () => {
    const { normalizeMermaidSource } = await import('../mermaid-source.ts')
    const directive = '  %%{init: {theme: base}}%%'
    const source = `\uFEFF---\r\nnote: |\r\n${directive}\r\n---\r\n${directive}\rflowchart LR\rA-->B`
    const normalized = normalizeMermaidSource(source)
    expect(normalized.initDirectives[0]!.raw).toBe(directive + '\r')
    expect(normalized.wrapperSource).toBe(source.slice(0, source.indexOf('flowchart')))
  })

  test('families report cleanup once per authored line', async () => {
    const { verifyMermaid } = await import('../agent/verify.ts')
    const cases = [
      ['flowchart TD\nA -->|"<a="| B["b"] --> C', 2],
      ['sequenceDiagram\nA->>B: <a href="x" title="y">text</a>', 2],
      ['pie\ntitle <a href="x">text</a>\n"Slice" : 1', 2],
      ['stateDiagram-v2\nA : style:#f00; x', 2],
      ['stateDiagram-v2\nstate A\nnote right of A\nstyle A fill:#f00;\nend note', 4],
      ['stateDiagram&#45;v2\nstate A\nnote right of A\nstyle A fill:#f00;\nend note', 4],
      ['flowchart TD\nA["hello\nstyle A fill:#f00;\nworld"]', 3],
      ['flowchart&#32;TD\nA["hello\nstyle A fill:#f00;\nworld"]', 3],
      ['flowchart LR\nA-->B\nstyle A fill:#f00; C["hello;"]', 3],
      ['flowchart LR\nA-->B\nclassDef c fill:#f00; C["hello;"]', 3],
      ['classDiagram\nclass A {\nstyle A fill:#f00;\n}', 3],
      ['classDiagram\nclass A {\nclassDef c fill:#f00;\n}', 3],
      ['classDiagram\nnamespace N {\nclass A {\nclassDef c fill:#f00; } style A fill:#fff;\n}', 4],
      ['classDiagram\nclass A\nstyle A fill:#fff;stroke:#000', 3],
      ['erDiagram\nA\nstyle A fill:#fff;stroke:#000', 3],
      ['erDiagram\nA {\nstring id "before\nstyle A fill:#f00;\nafter"\n}', 4],
      ['erDiagram\nA {\nstring id "before\nclassDef c fill:#f00;\nafter"\n}', 4],
      ['sankey-beta\n"hello\nstyle A fill:#f00;\nworld",B,1', 3],
      ['sankey-beta\n"hello\nclassDef c fill:#f00;\nworld",B,1', 3],
      ['C4Context\nSystem(a,"hello\nstyle A fill:#f00;\nworld")', 3],
      ['quadrantChart\n"hello\nstyle A fill:#f00;\nworld": [0.5, 0.5]', 3],
      ['block-beta\nA["before\nstyle A fill:#f00;\nafter"]', 3],
      ['block-beta\nA["before\nclassDef c fill:#f00;\nafter"]', 3],
      ['requirementDiagram\nrequirement A {\nid: 1\ntext: "before\nstyle A fill:#f00;\nafter"\nrisk: high\nverifymethod: test\n}', 5],
      ['requirementDiagram\nrequirement A {\nid: 1\ntext: "before\nclassDef c fill:#f00;\nafter"\nrisk: high\nverifymethod: test\n}', 5],
      ['quadrantChart\n"hello\nclassDef c fill:#f00;\nworld": [0.5, 0.5]', 3],
      ['---\ntitle: Caption\n---\nsequenceDiagram\nA->>B: <a href="x">text</a>', 5],
      ['flowchart TD\nA["<span style=\'color:#0b66c3;font-weight:700\'>PCK</span>"]', 2],
      ['---\nconfig:\n  htmlLabels: false\n---\nflowchart TD\nB --> C{Let <span style="color:red">me</span> think}', 6],
    ] as const
    for (const [source, line] of cases) {
      const warnings = verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'mermaid_cleanup')
      expect(warnings).toHaveLength(1)
      if (warnings.length) expect(warnings[0]).toMatchObject({ line, message: expect.stringContaining("Mermaid's cleanup changed this line") })
    }
    // A line whose quote rewrite changes nothing names only its semicolon.
    expect(verifyMermaid('flowchart TD\nSP[Power<br/><span style="font-size:12px;color:#666;">x</span>]').warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'mermaid_cleanup'))
      .toEqual([expect.objectContaining({ line: 2, message: expect.stringMatching(/it removes a style\/classDef semicolon before/) })])
    for (const source of [
      '---\ntitle: style A fill:#fff;\n---\nstateDiagram-v2\n%% style A fill:#fff;\nA --> B\nstyle A fill:#fff;',
      'flowchart LR\nA --> B\nstyle A fill:#fff;\nclassDef c fill:#fff;',
      'classDiagram\nclass A\nstyle A fill:#fff;\nclassDef c fill:#fff;',
      'classDiagram\nnamespace N {\nclass A\nstyle A fill:#fff;\nclassDef c fill:#fff;\n}',
      'erDiagram\nA\nstyle A fill:#fff;\nclassDef c fill:#fff;',
      'erDiagram\nsubgraph G\nA\nstyle A fill:#fff;\nclassDef c fill:#fff;\nend',
      'quadrantChart\nA:::c: [0.5, 0.5]\nclassDef c color:#fff;',
      'block-beta\nA["Hello"]\nstyle A fill:#fff;\nclassDef c fill:#fff;',
      'requirementDiagram\nrequirement A {\nid: 1\ntext: "Hi"\nrisk: high\nverifymethod: test\n}\nstyle A fill:#fff;\nclassDef c fill:#fff;',
      ...['\n', '\r', '\r\n'].map(ending => '---\ntitle: requirementDiagram\n---\n%% preamble\n%%{init: {}}%%\nrequirement&#68;iagram\nrequirement A {\nid: 1\ntext: "Hi"\nrisk: high\nverifymethod: test\n}\nstyle A fill:#fff;\nclassDef c fill:#fff;'.replaceAll('\n', ending)),
      'treemap-beta\n"Leaf":1\nclassDef c fill:#fff;',
      // The dropped `;` only ends a style statement sharing its row, or a
      // statement Mermaid rejects whatever it does (`} classDef`).
      'graph TD;style Q background:#fff;',
      'flowchart LR\nA-->B;style A fill:#f00;',
      'classDiagram\nclass A {\nstyle A fill:#f00; } classDef c fill:#fff;',
      // Tag quotes inside one label, which Mermaid draws as HTML.
      'flowchart TD\nB --> C{Let <span style="background-color:#ddd">me</span> think}',
      'flowchart TD\nA -->|<span style="color:red">m</span>| B\nsubgraph S[Title<br/><span style="font-size:12px">sub</span>]\nC\nend',
    ]) {
      expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'mermaid_cleanup')).toEqual([])
    }
  })
})

test('shared cleanup and protected entities agree with pinned Mermaid grammar text', async () => {
  const { startUpstreamMermaid } = await import('./helpers/upstream-mermaid.ts')
  const upstream = startUpstreamMermaid()
  try {
    const cases = [
      ['sequenceDiagram\rA->>B: <a href="x">text</a>', "sequenceDiagram\nA->>B: <a href='x'>text</a>\n"],
      ['sequenceDiagram\r\nA->>B: <a href = "x">text</a>', 'sequenceDiagram\nA->>B: <a href = "x">text</a>\n'],
      ['flowchart LR\nstyle A fill:#fff;', 'flowchart LR\nstyle A fill:#fff\n'],
      ['sequenceDiagram\nA->>B: #quot; #59; #9829;', 'sequenceDiagram\nA->>B: ﬂ°quot¶ß ﬂ°°59¶ß ﬂ°°9829¶ß\n'],
    ] as const
    expect(await upstream.projectAll(cases.map(([source]) => source), diagram => diagram.text)).toEqual(cases.map(([, expected]) => expected))
    expect(cleanupMermaidSource(cases[0][0]).upstreamText + '\n').toBe(cases[0][1])
    expect(cleanupMermaidSource(cases[1][0]).upstreamText + '\n').toBe(cases[1][1])
    expect(cleanupMermaidSource(cases[2][0]).prepassedText + '\n').toBe(cases[2][1])
  } finally { upstream.close() }
})
