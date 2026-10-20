import { describe, expect, test } from 'bun:test'
import {
  authoredMermaidSlice, cleanupMermaidSource, originalMermaidOffset, originalMermaidRange,
} from '../shared/mermaid-cleanup.ts'

describe('shared Mermaid cleanup receipt', () => {
  test('ordinary source keeps identity mappings and immutable snapshot data', () => {
    const source = 'flowchart LR\n  A[Hello] --> B'
    const receipt = cleanupMermaidSource(source)
    expect(receipt.text).toBe(source)
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
      // A raw CR is normalized before XML decoding, matching cleanup order.
      const expected = authored === '\r&#10;' ? 'A\n\nB' : 'A\nB'
      expect(receipt.text).toBe(expected)
      expect(authoredMermaidSlice(receipt, 1, receipt.text.length - 1)).toBe(authored)
    }
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
    expect(receipt.upstreamText).toBe('style A fill:ﬂ°f00¶ß; classDef c fill:#fff\nA["ﬂ°quot¶ß ﬂ°°59¶ß ﬂ°°35¶ß"]')
    const deletedAt = receipt.prepassedText.indexOf('\n')
    expect(authoredMermaidSlice(receipt, deletedAt, deletedAt, 'prepassedText')).toBe(';;')
    const markerAt = receipt.upstreamText.indexOf('ﬂ°quot¶ß')
    expect(authoredMermaidSlice(receipt, markerAt, markerAt + 8, 'upstreamText')).toBe('#quot;')
  })

  test('unknown XML names stay authored and named Mermaid codes stay protected', () => {
    const receipt = cleanupMermaidSource('&hearts; &unknown; #quot; #59; #notit; #x41;')
    expect(receipt.text).toBe('&hearts; &unknown; #quot; #59; #notit; #x41;')
    expect(receipt.upstreamText).toBe('&hearts; &unknown; ﬂ°quot¶ß ﬂ°°59¶ß ﬂ°notit¶ß ﬂ°x41¶ß')
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
    for (const offset of [-1, 4, 0.5, NaN]) expect(() => originalMermaidOffset(receipt, offset)).toThrow(RangeError)
    expect(() => originalMermaidRange(receipt, 2, 1)).toThrow(RangeError)
  })
})

describe('cleanup at public source boundaries', () => {
  test('render requests retain exact authored slices after transport decoding', async () => {
    const { resolveRenderRequest } = await import('../render-contract.ts')
    const { renderMermaidSVG } = await import('../index.ts')
    const source = '\uFEFF---\r\ntitle: Map\r\n---\r\nflowchart LR\r\n  A["&lt;literal&gt; &#x1F600;"] --> B'
    const request = resolveRenderRequest(source, {}, 'svg')
    expect(request.source.originalText).toBe(source)
    const receipt = request.source.cleanup!
    const start = receipt.text.indexOf('<literal>')
    expect(authoredMermaidSlice(receipt, start, start + '<literal> 😀'.length)).toBe('&lt;literal&gt; &#x1F600;')
    expect(request.source.authoredFamilyLines?.[1]).toContain('&lt;literal&gt;')
    expect(renderMermaidSVG('flowchart LR\rA --> B')).toBe(renderMermaidSVG('flowchart LR\nA --> B'))
  })

  test('all families report cleanup once per authored line and retain payload meaning', async () => {
    const { verifyMermaid } = await import('../agent/verify.ts')
    const cases = [
      ['flowchart TD\nA -->|"<a="| B["b"] --> C', 2],
      ['sequenceDiagram\nA->>B: <a href="x" title="y">text</a>', 2],
      ['pie\n"<a href=\\"x\\">text</a>" : 1', 2],
      ['stateDiagram-v2\nA : style:#f00; x', 2],
      ['---\ntitle: Caption\n---\nsequenceDiagram\nA->>B: <a href="x">text</a>', 5],
    ] as const
    for (const [source, line] of cases) {
      const warnings = verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'mermaid_cleanup')
      // Pie's escaped quotes remain escaped through cleanup, so the upstream
      // attribute rule does not read them as a quoted attribute pair.
      expect(warnings).toHaveLength(source.startsWith('pie') ? 0 : 1)
      if (warnings.length) expect(warnings[0]).toMatchObject({ line, message: expect.stringContaining("Mermaid's cleanup changed this line") })
    }
    const source = '---\ntitle: style A fill:#fff;\n---\nstateDiagram-v2\n%% style A fill:#fff;\nA --> B\nstyle A fill:#fff;'
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'mermaid_cleanup')).toEqual([])
  })
})
