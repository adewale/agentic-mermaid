import { describe, expect, test } from 'bun:test'
import { getFamily, knownBuiltinFamilies, replaceFamilyForTest } from '../agent/families.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { colorizeText } from '../ascii/ansi.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { nativeTerminalRenderer, terminalArtifact } from '../ascii/terminal-artifact.ts'
import { TerminalDocument, terminalDocumentOf } from '../ascii/terminal-document.ts'
import { MermaidFamilyDetectionError } from '../family-detection.ts'
import { RENDER_OUTPUT_DESCRIPTORS, resolveRenderRequest } from '../render-contract.ts'
import { connector } from '../scene/marks.ts'
import { prepareDisplayText } from '../shared/display-text.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { resolveTerminalOutputPolicy, TerminalOutputPolicyError } from '../terminal-contract.ts'
import { secureTerminalHtmlOutput } from '../terminal-security.ts'
import { projectTerminalStyle } from '../terminal-style.ts'
import { withoutTerminalColor } from './helpers/terminal-text.ts'

const SOURCE = 'flowchart LR\n  A[Start] --> B[Finish]'
const OSC52 = '\u001b]52;c;dGVybWluYWwtZXhmaWx0cmF0aW9u\u0007'
const C1_OSC = '\u009d52;c;YzEtZXhmaWx0cmF0aW9u\u009c'

const withoutTrustedSgr = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, '')
const containsTerminalControl = (value: string): boolean => /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(value)

describe('terminal text security boundary', () => {
  test('neutralizes OSC 52 and C1 controls before none, ANSI, and HTML projection', () => {
    const hostile = `flowchart LR\n  A["${OSC52}${C1_OSC}"] --> B[Done]`
    const inert = 'flowchart LR\n  A["?]52;c;dGVybWluYWwtZXhmaWx0cmF0aW9u??52;c;YzEtZXhmaWx0cmF0aW9u?"] --> B[Done]'

    for (const colorMode of ['none', 'ansi16', 'html'] as const) {
      const rendered = renderMermaidASCIIWithReceipt(hostile, { useAscii: true, colorMode })
      const expected = renderMermaidASCIIWithReceipt(inert, { useAscii: true, colorMode })
      expect(rendered.text).toBe(expected.text)
      expect(rendered.text).not.toContain('\u001b]')
      expect(rendered.text).not.toContain('\u0007')
      expect(rendered.text).not.toContain('\u009d')
      expect(containsTerminalControl(withoutTrustedSgr(rendered.text))).toBe(false)
      expect(rendered.terminalStyle.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'TERMINAL_CONTROL_CHARACTERS_REPLACED',
          feature: 'terminal-text',
        }),
      )
    }
  })

  test('retains distinct authored whitespace identities before projecting Sankey display text', () => {
    const source = 'sankey-beta\n"A\nB","T\nU",1\n"A B","T U",2\n"A\tB","T\tU",3\n"A\rB","T\rU",4'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const preserved = serializeMermaid(parsed.value)
    const expectedNodes = ['A\nB', 'T\nU', 'A B', 'T U', 'A\tB', 'T\tU', 'A\rB', 'T\rU']
    const expectedEdges = [
      ['A\nB', 'T\nU'],
      ['A B', 'T U'],
      ['A\tB', 'T\tU'],
      ['A\rB', 'T\rU'],
    ]
    const projected = new Map([
      ['A\nB', 'A\nB'],
      ['A B', 'A B'],
      ['A\tB', 'A B'],
      ['A\rB', 'A?B'],
    ])
    for (const input of [source, parsed.value])
      for (const useAscii of [true, false]) {
        for (const colorMode of ['none', 'ansi16', 'html'] as const) {
          const result = renderMermaidASCIIWithMeta(input, { useAscii, colorMode })
          expect(result.regions.filter(region => region.kind === 'node').map(region => region.id)).toEqual(expectedNodes)
          expect(result.regions.filter(region => region.kind === 'edge').map(region => [region.from, region.to])).toEqual(expectedEdges)
          for (const [id, text] of projected) {
            const node = result.regions.find(region => region.kind === 'node' && region.id === id)!
            expect(node.projectedText).toBe(text)
            expect(node.ownedCellSpans!.length).toBeGreaterThan(0)
          }
          expect(containsTerminalControl(withoutTrustedSgr(result.ascii))).toBe(false)
          expect(result.warnings).not.toContainEqual(expect.objectContaining({ code: 'ASCII_RENDER_FAILED' }))
          expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'TERMINAL_CONTROL_CHARACTERS_REPLACED' }))
        }
      }
    expect(serializeMermaid(parsed.value)).toBe(preserved)
  })

  test('keeps quoted CSV blank rows, indentation and directive-like text in authored identities', () => {
    const source = '%% before header\nsankey-beta\n"first\n\nlast",Sink,1\n"first\nlast",Other,2\n"first\n  last",Indented,3\n"first\n%% literal comment\naccTitle: literal title\nlast",Third,4'
    const expectedSources = ['first\n\nlast', 'first\nlast', 'first\n  last', 'first\n%% literal comment\naccTitle: literal title\nlast']
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('opaque')
    expect(serializeMermaid(parsed.value)).toBe(source + '\n')
    for (const input of [source, parsed.value]) {
      const result = renderMermaidASCIIWithMeta(input, { colorMode: 'none' })
      expect(result.regions.filter(region => region.kind === 'node').map(region => region.id)).toEqual([expectedSources[0]!, 'Sink', expectedSources[1]!, 'Other', expectedSources[2]!, 'Indented', expectedSources[3]!, 'Third'])
      expect(result.regions.filter(region => region.kind === 'edge').map(region => [region.from, region.to])).toEqual([
        [expectedSources[0]!, 'Sink'],
        [expectedSources[1]!, 'Other'],
        [expectedSources[2]!, 'Indented'],
        [expectedSources[3]!, 'Third'],
      ])
      expect(result.warnings).not.toContainEqual(expect.objectContaining({ code: 'ASCII_RENDER_FAILED' }))
    }
  })

  test('keeps control-bearing semantic owners distinct from their visible replacements', () => {
    const source = 'sankey-beta\n"A\u001bB",X,1\n"A?B",Y,2\n"A\u009dB",Z,3'
    for (const colorMode of ['none', 'truecolor', 'html'] as const) {
      const result = renderMermaidASCIIWithMeta(source, { colorMode })
      expect(result.regions.filter(region => region.kind === 'node').map(region => region.id)).toEqual(['A\u001bB', 'X', 'A?B', 'Y', 'A\u009dB', 'Z'])
      expect(result.regions.filter(region => region.kind === 'edge').map(region => [region.from, region.to])).toEqual([
        ['A\u001bB', 'X'],
        ['A?B', 'Y'],
        ['A\u009dB', 'Z'],
      ])
      for (const id of ['A\u001bB', 'A?B', 'A\u009dB']) {
        expect(result.regions.find(region => region.id === id && region.kind === 'node')?.projectedText).toBe('A?B')
      }
      expect(containsTerminalControl(withoutTrustedSgr(result.ascii))).toBe(false)
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'TERMINAL_CONTROL_CHARACTERS_REPLACED' }))
    }
  })

  test('retains GitGraph commit identity and parent references when visible labels coincide', () => {
    const source = 'gitGraph LR:\ncommit id:"A\tB"\ncommit id:"A B"'
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const input of [source, parsed.value]) {
      const result = renderMermaidASCIIWithMeta(input, { colorMode: 'none' })
      expect(result.regions.filter(region => region.kind === 'node').map(region => region.id)).toEqual(['A\tB', 'A B'])
      expect(result.regions.filter(region => region.kind === 'node').map(region => region.projectedText)).toEqual(['[A B]', '[A B]'])
      expect(result.regions.filter(region => region.kind === 'edge').map(region => [region.from, region.to])).toEqual([['A\tB', 'A B']])
      expect(result.regions.filter(region => region.kind === 'node').map(region => [region.parentId, region.parentKind])).toEqual([
        ['branch:main', 'lane'],
        ['branch:main', 'lane'],
      ])
      expect(containsTerminalControl(result.ascii)).toBe(false)
    }
  })

  test('diagnoses controls introduced by source admission and preserves structural CRLF', () => {
    const encoded = renderMermaidASCIIWithReceipt('flowchart LR\nA["X&#9;Y"] --> B[Done]', { colorMode: 'none' })
    expect(encoded.text).toContain('X Y')
    expect(encoded.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_CONTROL_CHARACTERS_REPLACED' }))
    const crlf = renderMermaidASCIIWithReceipt('flowchart LR\r\nA[Start] --> B[Done]\r\n', { colorMode: 'none' })
    expect(crlf.text).toContain('Start')
    expect(crlf.terminalStyle.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'TERMINAL_CONTROL_CHARACTERS_REPLACED' }))
  })

  test.each([
    { source: `flowchart LR\nA -- "${OSC52}" --> B`, expected: '?]52;c;dGVybWluYWwtZXhmaWx0cmF0aW9u?', replaced: true },
    { source: 'flowchart LR\nA -- "x&#27;y&#7;z #lt;b#gt;literal#lt;/b#gt; <b>MiXeD</b><br/>next" --> B', expected: 'x?y?z <b>literal</b> MiXeD\nnext', replaced: true },
    { source: 'sequenceDiagram\nA->>B: #lt;b#gt;literal#lt;/b#gt; *MiXeD*\u001b\u009d<br/>next', expected: '<b>literal</b> MiXeD??\nnext', replaced: true },
    { source: 'flowchart LR\nA -- "#lt;b#gt;literal#lt;/b#gt;<br/>#92;n" --> B', expected: '<b>literal</b>\n\\n', replaced: false },
  ])('sanitizes connector receipt labels and provenance as well as emitted cells: $source', ({ source, expected, replaced }) => {
    for (const style of [undefined, { roles: { edge: { textTransform: 'uppercase' as const } } }]) {
      const rendered = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', style })
      const projection = rendered.terminalStyle.connectorProjection
      expect(projection.connectors.flatMap(item => item.labels.map(label => label.text))).toEqual([expected])
      for (const line of expected.split('\n')) expect(rendered.text).toContain(line)
      const serializedProjection = JSON.stringify(projection, (_key, value) => {
        if (typeof value === 'string') expect(containsTerminalControl(value)).toBe(false)
        return value
      })
      expect(serializedProjection).not.toMatch(/\\u00(?:0[0-9b-f]|1[0-9a-f]|7f|[89][0-9a-f])/)
      expect(containsTerminalControl(rendered.text)).toBe(false)
      expect(rendered.terminalStyle.diagnostics.some(item => item.code === 'TERMINAL_CONTROL_CHARACTERS_REPLACED')).toBe(replaced)
    }
  })

  test('terminal evidence copies safe inline label provenance without retaining pixel blocks or changing the Scene', () => {
    const source = '\u001b<b>MiXeD</b>\n<literal>'
    const prepared = prepareDisplayText(source)
    const block = preparePixelText(prepared, { fontSize: 12, fontWeight: 400, transform: 'uppercase' })
    const mark = connector({
      id: 'inline',
      role: 'edge',
      geometry: { kind: 'line', x1: 0, y1: 30, x2: 100, y2: 30 },
      lineStyle: 'solid',
      paint: { stroke: '#111' },
      labels: [{ text: source, textContent: { value: source, prepared, authored: source }, block, anchor: { x: 50, y: 15 }, paint: { fill: '#111' }, fontSize: 12, textAnchor: 'middle', visual: { kind: 'inline' } }],
    })
    const before = JSON.stringify(mark)
    const terminal = projectTerminalStyle(
      resolveRenderRequest(SOURCE, {}, 'ascii'),
      'none',
      {},
      {
        family: 'test',
        width: 100,
        height: 50,
        colors: { bg: '#fff', fg: '#111' },
        transparent: true,
        parts: [mark],
      },
    )
    const label = terminal.connectorProjection.connectors[0]!.labels[0]!
    expect(label.text).toBe('?MiXeD\n<literal>')
    expect(label).not.toHaveProperty('block')
    expect(label.textContent?.authored).toBe('?<b>MiXeD</b>\n<literal>')
    expect(label.textContent?.prepared.source).toBe('?<b>MiXeD</b>\n<literal>')
    expect(label.textContent?.prepared.lines).toEqual(prepared.lines)
    expect(label.textContent?.prepared.lineStarts).toEqual(prepared.lineStarts)
    expect(label.textContent?.prepared).not.toBe(prepared)
    expect(JSON.stringify(terminal.connectorProjection)).not.toContain('\\u001b')
    expect(terminal.diagnostics.filter(item => item.code === 'TERMINAL_CONTROL_CHARACTERS_REPLACED')).toHaveLength(1)
    expect(JSON.stringify(mark)).toBe(before)
    const stale = {
      ...mark,
      terminalProjection: {
        ...mark.terminalProjection,
        labels: mark.terminalProjection.labels.map(item => ({
          ...item,
          textContent: { ...item.textContent!, value: 'outdated' },
        })),
      },
    }
    const staleReceipt = projectTerminalStyle(
      resolveRenderRequest(SOURCE, {}, 'ascii'),
      'none',
      {},
      {
        family: 'test',
        width: 100,
        height: 50,
        colors: { bg: '#fff', fg: '#111' },
        transparent: true,
        parts: [stale],
      },
    )
    const staleLabel = staleReceipt.connectorProjection.connectors[0]!.labels[0]!
    expect(staleLabel).not.toHaveProperty('textContent')
    expect(staleLabel).not.toHaveProperty('block')
    expect(JSON.stringify(staleReceipt.connectorProjection)).not.toContain('\\u001b')
  })

  test('escapes authored HTML while preserving literal text through colored runs', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const pie = renderMermaidASCIIWithReceipt(`pie\n  "${payload}" : 5`, { colorMode: 'html' })
    const quadrant = renderMermaidASCIIWithReceipt(`quadrantChart\n  title ${payload}\n  P: [0.2, 0.8]`, { colorMode: 'html' })

    for (const rendered of [pie, quadrant]) {
      expect(rendered.text).not.toContain(payload)
      expect(rendered.text).not.toContain('<img')
      expect(withoutTerminalColor(rendered.text)).toContain('&lt;img src=x onerror=alert(1)&gt;')
    }
  })

  test('does not mistake an active or attribute-bearing authored span for an internal color span', () => {
    const payload = '<span style="color:#123456"><img src=x onerror=alert(1)></span>'
    const attributePayload = '<span style="color:#123456" onmouseover="alert(1)">hover</span>'
    const rendered = secureTerminalHtmlOutput(`${payload}${attributePayload}`)

    expect(rendered).not.toContain('<img')
    expect(rendered).not.toContain('<span')
    expect(rendered).toContain('&lt;span style="color:#123456"&gt;')
    expect(rendered).toContain('&lt;span style="color:#123456" onmouseover="alert(1)"&gt;')
  })

  test('preserves safe variable-color spans but refuses fetching paint and false-opaque ANSI', () => {
    const variable = colorizeText('<safe>', 'var(--brand)', 'html')
    expect(secureTerminalHtmlOutput(variable)).toBe('<span style="color:var(--brand)">&lt;safe&gt;</span>')
    const fetching = '<span style="color:var(--brand,url(https://evil.invalid/x))">bad</span>'
    expect(secureTerminalHtmlOutput(fetching)).not.toContain('<span')
    expect(secureTerminalHtmlOutput(fetching)).toContain('&lt;span')
    for (const translucent of ['transparent', 'rgba(255,0,0,0)', '#ff000080']) {
      expect(colorizeText('bar', translucent, 'truecolor')).toBe('bar')
      expect(colorizeText('bar', translucent, 'html')).toContain(`style="color:${translucent}"`)
    }
  })

  test('every registered terminal family crosses the final HTML boundary without double-escaping trusted spans', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const trusted = colorizeText('<trusted>', '#123456', 'html')

    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!
      expect(descriptor.example, `${id} example`).toBeDefined()
      expect(descriptor.renderAscii, `${id} terminal renderer`).toBeDefined()
      if (!descriptor.example || !descriptor.renderAscii) continue
      const original = descriptor.renderAscii
      const restore = replaceFamilyForTest(id, {
        ...descriptor,
        renderAscii(context) {
          return `${original(context)}\n${trusted}\n${payload}`
        },
      })
      try {
        const rendered = renderMermaidASCIIWithReceipt(descriptor.example, { colorMode: 'html' })
        expect(rendered.text, id).toContain('<span style="color:#123456">&lt;trusted&gt;</span>')
        expect(rendered.text, id).not.toContain('&lt;span style=')
        expect(rendered.text, id).not.toContain('<img')
        expect(rendered.text, id).toContain('&lt;img src=x onerror=alert(1)&gt;')
      } finally {
        restore()
      }
    }
  })
})

describe('canonical terminal output policy', () => {
  test('native terminal rendering does not depend on optional graphical hooks', () => {
    const descriptor = getFamily('flowchart')!
    const originalAscii = descriptor.renderAscii!
    const restore = replaceFamilyForTest('flowchart', {
      ...descriptor,
      lowerScene() {
        throw new Error('optional Scene projection unavailable')
      },
      renderAscii(context) {
        return originalAscii(context)
      },
    })
    try {
      const rendered = renderMermaidASCIIWithReceipt(SOURCE, { useAscii: true, colorMode: 'none' })
      expect(rendered.text).toContain('Start')
      expect(rendered.terminalStyle.diagnostics).toContainEqual({
        code: 'TERMINAL_CONNECTOR_PROJECTION_UNAVAILABLE',
        feature: 'connectors',
        message: 'Optional Scene connector projection failed; native terminal rendering continued independently.',
      })
      expect(rendered.terminalStyle.connectorProjection.evidence).toBe('unavailable')
    } finally {
      restore()
    }
  })

  test('every registered family preserves terminal semantics in every color mode', () => {
    const plain = (value: string) =>
      value
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/<span style="color:[^"]+">/g, '')
        .replace(/<\/span>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!
      if (!descriptor.example || !descriptor.renderAscii) continue
      for (const useAscii of [false, true]) {
        const baseline = renderMermaidASCIIWithReceipt(descriptor.example, { useAscii, colorMode: 'none' })
        const document = terminalDocumentOf(baseline)!
        expect(document, `${id} native owned drawing`).toBeDefined()
        const baselineRegions = document.regions()
        expect(baselineRegions.length, `${id} owned regions`).toBeGreaterThan(0)
        for (const colorMode of ['none', 'ansi16', 'ansi256', 'truecolor', 'html'] as const) {
          const rendered = renderMermaidASCIIWithReceipt(descriptor.example, { useAscii, colorMode })
          expect(plain(rendered.text), `${id}/${useAscii ? 'ascii' : 'unicode'}/${colorMode}`).toBe(baseline.text)
          expect(terminalDocumentOf(rendered)!.regions(), `${id}/${colorMode} ownership`).toEqual(baselineRegions)
          expect(rendered.receipt.diagnostics, `${id}/${colorMode}`).toEqual(rendered.terminalStyle.diagnostics)
          expect(rendered.terminalStyle.connectorProjection.digest, `${id}/${colorMode}`).toBe(baseline.terminalStyle.connectorProjection.digest)
        }
      }
    }
  })

  test('string-only hooks explicitly decline ownership, including wrappers that alter native output', () => {
    const descriptor = getFamily('flowchart')!
    for (const wrapNative of [true, false]) {
      const restore = replaceFamilyForTest('flowchart', {
        ...descriptor,
        renderAscii(context) {
          return wrapNative ? `${descriptor.renderAscii!(context)}\nextra` : 'external terminal text'
        },
      })
      try {
        const result = renderMermaidASCIIWithMeta(SOURCE, { colorMode: 'none' })
        expect(result.ascii).toContain(wrapNative ? 'extra' : 'external terminal text')
        expect(result.regions).toEqual([])
        expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'TERMINAL_OWNERSHIP_UNAVAILABLE' }))
      } finally {
        restore()
      }
    }
  })

  test('public warnings retain final cell coordinates when a title translates a native drawing', () => {
    const descriptor = getFamily('flowchart')!
    const restore = replaceFamilyForTest('flowchart', {
      ...descriptor,
      renderAscii: nativeTerminalRenderer(context => {
        const drawing = new TerminalDocument(4, 2)
        drawing.text(1, 1, 'X', { owner: { id: 'A', kind: 'node' } })
        drawing.put(1, 1, '─', { owner: { id: 'route', kind: 'edge' } })
        return terminalArtifact(drawing, { colorMode: context.colorMode, theme: context.theme })
      }),
    })
    try {
      const result = renderMermaidASCIIWithMeta(`---\ntitle: Heading\n---\n${SOURCE}`, { colorMode: 'none' })
      expect(result.ascii.split('\n')[3]?.[1]).toBe('X')
      expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'TERMINAL_TEXT_COLLISION', cell: { column: 1, row: 3 } }))
    } finally {
      restore()
    }
  })

  test('native HTML output retains its title, labels and ownership under a width policy', () => {
    const targetWidth = 20
    const rendered = renderMermaidASCIIWithReceipt(`---\ntitle: Heading\n---\n${SOURCE}`, { colorMode: 'html', targetWidth })
    const text = withoutTerminalColor(rendered.text)
    expect(text).toContain('Heading')
    expect(text).toContain('Start')
    expect(text).toContain('Finish')
    expect(Math.max(...text.split('\n').map(line => line.length))).toBeLessThanOrEqual(targetWidth)
    const regions = terminalDocumentOf(rendered)!.regions()
    expect(regions.find(region => region.id === 'title')).toBeDefined()
    expect(regions.filter(region => region.kind === 'node').map(region => region.id)).toEqual(['A', 'B'])
  })

  test('native text avoids optional graphical work and full receipts memoize its evidence', () => {
    const descriptor = getFamily('flowchart')!
    let calls = 0
    const restore = replaceFamilyForTest('flowchart', {
      ...descriptor,
      layout(context) {
        calls++
        return descriptor.layout!(context)
      },
    })
    try {
      const rendered = renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'none' })
      expect(rendered.text).toContain('Start')
      expect(calls).toBe(0)
      expect(rendered.terminalStyle.connectorProjection.evidence).toBe('scene')
      expect(calls).toBe(1)
      const receipt = rendered.receipt
      expect(rendered.receipt).toBe(receipt)
      expect(rendered.terminalStyle.connectorProjection.count).toBeGreaterThan(0)
      expect(calls).toBe(1)
    } finally {
      restore()
    }
  })

  test('native Flowchart and metadata share the same authored parse within one render', () => {
    const descriptor = getFamily('flowchart')!
    const parsed = parseRegisteredMermaid(SOURCE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const canonicalSource = parsed.value.canonicalSource
    let preparations = 0
    const input = {
      ...parsed.value,
      get canonicalSource() {
        preparations++
        return canonicalSource
      },
    }
    let parses = 0
    const restore = replaceFamilyForTest('flowchart', {
      ...descriptor,
      parse(context) {
        parses++
        return descriptor.parse!(context)
      },
    })
    try {
      const result = renderMermaidASCIIWithMeta(input, { colorMode: 'none' })
      expect(result.ascii).toContain('Start')
      expect(result.regions.find(region => region.id === 'A')?.sourceLine).toBe(2)
      expect(parses).toBe(1)
      expect(preparations).toBe(1)
    } finally {
      restore()
    }
  })

  test('metadata rejects a preserved parsed family before recovering drawing failures', () => {
    const parsed = parseRegisteredMermaid('swimlane-beta\n  preserved experimental payload')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.kind).toBe('preserved')
    expect(() => renderMermaidASCIIWithReceipt(parsed.value, { colorMode: 'none' })).toThrow(MermaidFamilyDetectionError)
    expect(() => renderMermaidASCIIWithMeta(parsed.value, { colorMode: 'none' })).toThrow(MermaidFamilyDetectionError)
  })

  test('Gantt defers graphical evidence and retains its captured explicit clock', () => {
    const source = 'gantt\n  dateFormat YYYY-MM-DD\n  Build :build, 2026-10-01, 10d'
    const descriptor = getFamily('gantt')!
    let calls = 0
    let observedClock: string | undefined
    const restore = replaceFamilyForTest('gantt', {
      ...descriptor,
      layout(context) {
        calls++
        observedClock = context.renderOptions.ganttToday
        return descriptor.layout!(context)
      },
    })
    try {
      const options = { colorMode: 'none' as const, ganttToday: '2026-10-05' }
      const delayed = renderMermaidASCIIWithReceipt(source, options)
      const marker = terminalDocumentOf(delayed)!
        .regions()
        .find(region => region.id === 'today-marker')!
      expect(marker.ownedCellSpans!.length).toBeGreaterThan(0)
      expect(calls).toBe(0)
      // Mutating the caller's object before consuming the receipt cannot move
      // its marker or change the date passed to optional graphical layout.
      options.ganttToday = '2026-10-08'
      const delayedStyle = delayed.terminalStyle
      expect(observedClock).toBe('2026-10-05')
      expect(calls).toBe(1)
      const eager = renderMermaidASCIIWithReceipt(source, { colorMode: 'none', ganttToday: '2026-10-05', onProjectionDiagnostic() {} })
      expect(calls).toBe(2)
      expect(eager.text).toBe(delayed.text)
      expect(eager.terminalStyle).toEqual(delayedStyle)
      expect(eager.receipt).toEqual(delayed.receipt)
      expect(calls).toBe(2)
    } finally {
      restore()
    }
  })

  test('model reuse respects admitted entity decoding in labels, headers and grammar', () => {
    const encoded = 'flowchart&#32;LR\nA[&lt;b&gt;Start&lt;/b&gt;] --&gt; B[Finish]'
    const decoded = 'flowchart LR\nA[<b>Start</b>] --> B[Finish]'
    const actual = renderMermaidASCIIWithMeta(encoded, { colorMode: 'none' })
    const expected = renderMermaidASCIIWithMeta(decoded, { colorMode: 'none' })
    expect(actual.ascii).toBe(expected.ascii)
    expect(actual.ascii).toContain('Start')
    const labelOnly = renderMermaidASCIIWithMeta('flowchart&#32;LR\nA[&lt;b&gt;Start&lt;/b&gt;] --> B[Finish]', { colorMode: 'none' })
    expect(labelOnly.ascii).toBe(expected.ascii)
    expect(labelOnly.regions.find(region => region.id === 'A')?.sourceLine).toBe(2)
    expect(actual.regions.filter(region => region.kind === 'edge')).toHaveLength(1)
  })

  test('the output registry records the terminal security gate', () => {
    for (const id of ['ascii', 'unicode', 'html'] as const) {
      const descriptor = RENDER_OUTPUT_DESCRIPTORS.find(output => output.id === id)!
      expect(descriptor.security).toBe('enforced')
      expect(descriptor.evidence).toContain('terminal-output-policy@1')
      expect(descriptor.evidence).toContain('terminal-control-sanitization')
    }
  })

  test('resolves and freezes every executed terminal control', () => {
    const theme = { fg: '#123456' }
    const policy = resolveTerminalOutputPolicy({
      useAscii: true,
      paddingX: 2,
      paddingY: 3,
      boxBorderPadding: 0,
      colorMode: 'none',
      theme,
      targetWidth: 80,
    })
    theme.fg = '#ffffff'
    expect(policy).toEqual({
      version: 1,
      useAscii: true,
      paddingX: 2,
      paddingY: 3,
      boxBorderPadding: 0,
      colorMode: 'none',
      theme: { fg: '#123456' },
      targetWidth: 80,
    })
    expect(Object.isFrozen(policy)).toBe(true)
    expect(Object.isFrozen(policy.theme)).toBe(true)
  })

  test('rejects null, wrong-type, non-finite, negative, fractional, and bogus values', () => {
    const invalid: unknown[] = [
      null,
      [],
      { useAscii: 'true' },
      { useAscii: null },
      { paddingX: -1 },
      { paddingY: Number.NaN },
      { boxBorderPadding: 0.5 },
      { maxWidth: 0 },
      { maxWidth: Number.POSITIVE_INFINITY },
      { targetWidth: -1 },
      { targetWidth: 12.5 },
      { colorMode: 'ansi1024' },
      { colorMode: null },
      { theme: null },
      { theme: [] },
      { theme: { fg: 42 } },
      { theme: { unknown: '#000000' } },
      { maxWidth: 80, targetWidth: 80 },
      { surprise: true },
    ]
    for (const value of invalid) {
      expect(() => resolveTerminalOutputPolicy(value as never), JSON.stringify(value)).toThrow(TerminalOutputPolicyError)
    }
    expect(() => renderMermaidASCIIWithReceipt(SOURCE, { paddingX: -1 })).toThrow(/non-negative finite integer/)
    expect(() => renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'ansi1024' as never })).toThrow(/colorMode/)

    const symbolInput = { colorMode: 'none' } as Record<PropertyKey, unknown>
    symbolInput[Symbol('extra')] = true
    expect(() => resolveTerminalOutputPolicy(symbolInput as never)).toThrow('unknown field "Symbol(extra)"')
    const symbolTheme = { fg: '#000000' } as Record<PropertyKey, unknown>
    symbolTheme[Symbol('extra')] = true
    expect(() => resolveTerminalOutputPolicy({ theme: symbolTheme } as never)).toThrow('unknown field "Symbol(extra)"')
  })

  test('hashes the exact normalized object used for execution', () => {
    const implicit = renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'none' })
    const explicitDefaults = renderMermaidASCIIWithReceipt(SOURCE, {
      useAscii: false,
      paddingX: 5,
      paddingY: 5,
      boxBorderPadding: 1,
      colorMode: 'none',
      theme: {},
    })
    const widerPadding = renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'none', paddingX: 6 })

    expect(implicit.outputPolicy).toEqual(explicitDefaults.outputPolicy)
    expect(implicit.receipt.requestDigest).toBe(explicitDefaults.receipt.requestDigest)
    expect(widerPadding.outputPolicy.paddingX).toBe(6)
    expect(widerPadding.receipt.requestDigest).not.toBe(implicit.receipt.requestDigest)
    expect(widerPadding.text).not.toBe(implicit.text)
  })
})
