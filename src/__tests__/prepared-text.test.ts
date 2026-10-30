import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'
import { applyTextTransform } from '../styles.ts'
import { beforeAll, describe, expect, it } from 'bun:test'
import { concatDisplayText, prepareDisplayText, preparedDisplayTextValue, replaceDisplayTextTokens, resolveLabelContent, writeDisplayText } from '../shared/display-text.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { encodeMermaidEntities } from '../shared/mermaid-entities.ts'
import { prepareCellText } from '../ascii/prepared-text.ts'
import { labelDisplayLength } from '../agent/label-metrics.ts'
import { preparePixelText, fitPixelText } from '../shared/prepared-text.ts'
import { renderMultilineText } from '../multiline-utils.ts'
import { nodeWorldBounds } from '../scene/bounds.ts'
import { drawNative } from '../scene/native-drawing.ts'
import { certifyNativePaint } from '../scene/paint-certification.ts'
import type { DrawingProducer } from '../scene/drawing.ts'
import * as marks from '../scene/marks.ts'
import { nodeProblems } from '../scene/fidelity.ts'
import { transferSceneNodeSerialization } from '../scene/serialization.ts'
import { buildExternalScene } from '../scene/external-scene.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
import { measureRenderedText, renderedTextReady } from './helpers/rendered-text.ts'
import { Resvg } from '@resvg/resvg-js'
import { join } from 'node:path'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'

beforeAll(() => renderedTextReady())
const typography = { fontSize: 18, fontWeight: 600 }

describe('prepared display text', () => {
  it('keeps decoded tags and emphasis literal through fitting, Scene fidelity, metrics and writing', () => {
    const source = '#lt;b#gt;X#lt;/b#gt; <b>Y</b> #42;z#42; #92;n\nEND'
    const decode = (text: string) => replaceDisplayTextTokens(prepareDisplayText(text), /#\w+;/g, decodeMermaidEntities)
    const prepared = decode(source)
    const visible = '<b>X</b> Y *z* \\n\nEND'
    expect(preparedDisplayTextValue(prepared)).toBe(visible)
    expect(prepared.lines[0]!.filter(run => run.bold).map(run => run.text)).toEqual(['Y'])
    expect(prepared.lines[0]![0]!.clusters![0]).toEqual({ text: '<', sourceStart: 0, sourceEnd: 4 })
    const block = preparePixelText(prepared, typography)
    expect(prepareCellText(prepared).lines.join('\n')).toBe(visible)
    expect(labelDisplayLength(prepared)).toBe(visible.split('\n')[0]!.length)
    const svg = renderMultilineText(block, 100, 50, typography.fontSize, 'text-anchor="middle"')
    expect(svg).toContain('&lt;b&gt;X&lt;/b&gt;')
    expect(svg).toMatch(/<tspan\b[^>]*\bfont-weight="(?:bold|700)"[^>]*>Y<\/tspan>/)
    const mark = marks.text({ id: 'decoded-literal', role: 'label', text: block.text, block, x: 100, y: 50, fontSize: typography.fontSize, anchor: 'middle', paint: {} })
    const problems: string[] = []
    nodeProblems(mark, 'decoded-literal', problems)
    expect(problems).toEqual([])
    const encoded = writeDisplayText(prepared, text => encodeMermaidEntities(text, '<*_~\\'))
    const reread = decode(encoded.replaceAll('<br>', '\n'))
    expect(preparedDisplayTextValue(reread)).toBe(visible)
    expect(reread.lines[0]!.filter(run => run.bold).map(run => run.text)).toEqual(['Y'])
    const content = { value: '<b>X</b>', prepared }
    expect(resolveLabelContent(content.value, content)).toBe(prepared)
    expect(resolveLabelContent('changed', content)).toBe('changed')
  })

  it('combines literal adornments with prepared content without losing source ranges or casing context', () => {
    const label = replaceDisplayTextTokens(prepareDisplayText('#lt;b#gt;ß\n<b>end</b>'), /#\w+;/g, decodeMermaidEntities)
    const combined = concatDisplayText(['1. [', label, ']'])
    expect(preparedDisplayTextValue(combined)).toBe('1. [<b>ß\nend]')
    expect(combined.lines[0]![1]!.clusters![0]).toEqual({ text: '<', sourceStart: 4, sourceEnd: 8 })
    const upper = preparePixelText(combined, { ...typography, transform: 'uppercase' })
    expect(upper.lineBlocks.map(line => line.runs.map(run => run.text).join(''))).toEqual(['1. [<B>SS', 'END]'])
    expect(upper.prepared.lines[0]![1]!.clusters!.at(-1)!.sourceEnd).toBe(14)
    expect(prepareDisplayText(upper.prepared)).toBe(upper.prepared)
    expect(() => replaceDisplayTextTokens(upper.prepared, /x/g, value => value)).toThrow(/before text transforms/)
    const inert = replaceDisplayTextTokens(prepareDisplayText('token'), /token/g, () => '\n\u001b')
    expect(preparedDisplayTextValue(inert)).toBe('??')
    expect(inert.lines).toHaveLength(1)
  })

  it('keeps source ranges while preparing inert controls for pixel fitting', () => {
    const source = 'a\t<b>b\u001b</b>\r c\nend'
    const prepared = prepareDisplayText(source, 'formatted', 'uppercase')
    expect(prepared.source).toBe(source)
    expect(prepared.lines.map(line => line.map(run => run.text).join(''))).toEqual(['A B?? C', 'END'])
    expect(prepared.lines[0]![0]!.clusters).toEqual([
      { text: 'A', sourceStart: 0, sourceEnd: 1 },
      { text: ' ', sourceStart: 1, sourceEnd: 2 },
    ])
    expect(prepared.lines[0]![1]!.clusters).toEqual([
      { text: 'B', sourceStart: 5, sourceEnd: 6 },
      { text: '?', sourceStart: 6, sourceEnd: 7 },
    ])
    const pixel = preparePixelText(source, { ...typography, display: 'formatted', transform: 'uppercase' })
    expect(pixel.prepared.source).toBe(source)
    expect(pixel.lineBlocks.map(line => line.runs.map(run => run.text).join(''))).toEqual(['A B?? C', 'END'])
    expect(pixel.lineBlocks.every(line => line.runs.every(run => !/[\u0000-\u001f\u007f-\u009f]/.test(run.text)))).toBe(true)
  })

  it('distinguishes literal content from styled runs without decoding tag-like entities', () => {
    const literal = prepareDisplayText('<b>x</b> #lt;br#gt; &#60;br&#62;', 'literal')
    expect(literal.lines[0]!.map(run => run.text).join('')).toBe('<b>x</b> #lt;br#gt; &#60;br&#62;')
    expect(literal.lines[0]!.every(run => !run.bold)).toBe(true)
    const formatted = prepareDisplayText('<b>x</b> &lt;br&gt;', 'formatted')
    expect(formatted.lines[0]!.map(run => [run.text, run.bold])).toEqual([['x', true], [' &lt;br&gt;', false]])
  })

  it('transforms the complete visible word across formatting boundaries', () => {
    const text = prepareDisplayText('pre<b>fix</b> and s<i>uffix</i>', 'formatted', 'capitalize')
    expect(text.lines[0]!.map(run => run.text).join('')).toBe('Prefix And Suffix')
    expect(text.source).toBe('pre<b>fix</b> and s<i>uffix</i>')
  })

  it('capitalizes Unicode words without treating combining marks or formatting as boundaries', () => {
    const source = 'café ångström niño résumé élève Ελληνικά'
    const expected = 'Café Ångström Niño Résumé Élève Ελληνικά'
    expect(preparePixelText(source, { ...typography, transform: 'capitalize' }).text).toBe(expected)
    expect(applyTextTransform('ca<b>fé</b> ångström', 'capitalize')).toBe('Ca<b>fé</b> Ångström')
  })

  it('retains source ranges when casing expands characters and changes context', () => {
    const text = prepareDisplayText('aß<b>c</b>', 'formatted', 'uppercase')
    expect(text.lines[0]!.map(run => run.text).join('')).toBe('ASSC')
    expect(text.lines[0]![0]!.clusters).toEqual([
      { text: 'A', sourceStart: 0, sourceEnd: 1 },
      { text: 'SS', sourceStart: 1, sourceEnd: 2 },
    ])
    expect(prepareDisplayText('ΟΣ', 'literal', 'lowercase').lines[0]![0]!.text).toBe('ος')
  })

  it('keeps authored empty lines and precise hard-break positions', () => {
    const block = preparePixelText('A\n\nB\n', { ...typography, display: 'literal', maxWidth: 30 })
    expect(block.lines).toEqual(['A', '', 'B', ''])
    expect(block.breaks).toEqual([
      { kind: 'authored', sourceOffset: 1 },
      { kind: 'authored', sourceOffset: 2 },
      { kind: 'authored', sourceOffset: 4 },
    ])
    expect(block.height).toBe(4 * block.lineHeight)
  })

  it('records the whitespace replaced by a soft break instead of losing it', () => {
    const block = preparePixelText('a   b', { fontSize: 12, fontWeight: 500, maxWidth: 15 })
    expect(block.lines).toEqual(['a', 'b'])
    expect(block.breaks).toEqual([{ kind: 'wrap', sourceOffset: 4, replacedText: '   ' }])
  })

  it('does not capitalize synthetic fragments of an authored word', () => {
    const source = 'antidisestablishmentarianism'
    const block = preparePixelText(source, { ...typography, transform: 'capitalize', maxWidth: 80 })
    expect(block.lines.length).toBeGreaterThan(1)
    expect(block.lines.map(line => line.replace(/-$/, '')).join('')).toBe('Antidisestablishmentarianism')
    expect(block.breaks.every(b => b.kind === 'hyphen')).toBe(true)
    expect(block.lineBlocks.every(line => line.width <= 80)).toBe(true)
  })

  for (const source of ['漢字ひらがな漢字ひらがな', 'cafécafécafé', '👩🏽‍💻👨‍👩‍👧‍👦🇨🇳']) {
    it(`wraps whole visible graphemes: ${source}`, () => {
      const block = preparePixelText(source, { ...typography, display: 'literal', maxWidth: 75 })
      expect(block.lines.join('').replace(/-/g, '')).toBe(source)
      const boundaries = new Set([0, ...Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(source), part => part.index + part.segment.length)])
      let offset = 0
      for (const line of block.lines) {
        offset += line.replace(/-$/, '').length
        expect(boundaries.has(offset), `wrap at source offset ${offset}`).toBe(true)
      }
    })
  }

  it('captures mutable prepared input without reinterpreting its decoded content', () => {
    const decoded = replaceDisplayTextTokens(prepareDisplayText('#lt;b#gt;'), /#\w+;/g, decodeMermaidEntities)
    const input = structuredClone(decoded)
    const block = preparePixelText(input, { fontSize: 12, fontWeight: 400 })
    Object.assign(input, { source: 'Forged' })
    Object.assign(input.lines[0]!, { 0: { ...input.lines[0]![0]!, text: 'Lost' } })
    expect(block.prepared.source).toBe('#lt;b#gt;')
    expect(block.lineBlocks[0]!.runs.map(run => run.text).join('')).toBe('<b>')
    expect(block.prepared.lines[0]![0]!.text).toBe('<b>')
    expect(Object.isFrozen(block.prepared)).toBe(true)
    expect(Object.isFrozen(block.prepared.lines[0]![0]!.clusters)).toBe(true)
  })

  it.each([{ nesting: 10, deepest: 48 }, { nesting: 14, deepest: 64 }, { nesting: 15, deepest: 68 }, { nesting: 70, deepest: 288 }])('keeps constructor text at descendant depth $deepest within Native snapshot limits', ({ nesting, deepest }) => {
    const text = 'Read'
    let plan = prepareDisplayText(text, 'literal')
    // Native's text leaf adds one edge to the block. Its ordinary prepared
    // plan reaches scalar data at depth8; each extra plan adds four edges.
    for (let depth = 0; depth < nesting; depth++) {
      const run = { text, bold: false, italic: false, underline: false, strikethrough: false, sourceStart: 0, sourceEnd: text.length, extra: plan }
      plan = prepareDisplayText({ source: text, display: 'literal', lineStarts: [0], lines: [[run]] })
    }
    const context = { positioned: { width: 100, height: 80 }, colors: { bg: '#fff', fg: '#111' }, resolved: { renderOptions: {} } }
    const drawing = (block: ReturnType<typeof preparePixelText>) => {
      const producer: DrawingProducer = factory => ({ family: 'flowchart', width: 100, height: 80, transparent: false, colors: context.colors, parts: [
        factory.documentOpen({ id: 'root', width: 100, height: 80, colors: context.colors, transparent: false, font: 'Inter', hasMonoFont: false }, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" style="--bg:#fff;--fg:#111">'),
        factory.text({ id: 'label', role: 'label', text, block, x: 50, y: 30, fontSize: 12, anchor: 'middle', paint: { fill: '#111' } }),
        factory.documentClose(),
      ] })
      const result = drawNative(producer, context, 'flowchart')
      return { ...result, proof: certifyNativePaint(result.header, result.paint) }
    }
    const ordinary = drawing(preparePixelText(text, { fontSize: 12, fontWeight: 400 }))
    const deep = drawing(preparePixelText(plan, { fontSize: 12, fontWeight: 400 }))
    expect(ordinary.proof.status).toBe('passed')
    expect(deep.svg).toBe(ordinary.svg)
    expect(deep.proof.status).toBe(deepest <= 64 ? 'passed' : 'unverified')
    if (deepest <= 64) expect(deep.proof.issues).toEqual([])
    else expect(deep.proof.issues).toContainEqual(expect.objectContaining({ code: 'CONDITIONAL_PAINT' }))
  })

  it('preserves measurement observations for supplied fragment accessors', () => {
    const style = { bold: false, italic: false, underline: false, strikethrough: false }
    const fragments = [
      { ...style, get text() { fragments.length = 1; return 'A' }, sourceStart: 0, sourceEnd: 1 },
      { ...style, text: 'B', sourceStart: 1, sourceEnd: 2 },
    ]
    const input = { source: 'AB', display: 'literal' as const, lineStarts: [0], lines: [[{ ...style, text: 'AB', sourceStart: 0, sourceEnd: 2, fragments }]] }
    const measured: string[] = []
    const execution = createTextMeasurementExecution({ id: 'test:fragment-accessors', version: '1.0.0', measure: ({ text }) => { measured.push(text); return text.length * 10 } }, 'Inter')
    withTextMeasurementExecution(execution, () => preparePixelText(input, { fontSize: 14, fontWeight: 400, maxWidth: 1000 }))
    expect(measured).toEqual(['AB', 'A'])
  })

  it('keeps monospace metrics distinct from proportional text', () => {
    const block = preparePixelText('iii界', { ...typography, display: 'literal', monospace: true })
    expect(block.width).toBe(5 * 18 * 0.6)
    expect(block.unit).toBe('px')
  })

  it('keeps a visible grapheme atomic across formatting boundaries', () => {
    const block = preparePixelText('e<b>́</b>e<b>́</b>', { ...typography, maxWidth: 13 })
    expect(block.lineBlocks.map(line => line.runs.map(run => run.text).join(''))).toEqual(['é', 'é'])
    expect(block.lineBlocks.every(line => line.runs.some(run => run.bold))).toBe(true)
  })

  it('reconstructs transformed visible source across generated formatting, spaces and wraps', () => {
    fc.assert(fc.property(
      fc.constantFrom('ßeta', 'café', 'antidisestablishmentarianism', 'Ωμέγα', 'Широкий'),
      fc.constantFrom('漢字', '👩🏽‍💻', 'é', 'مرحبا'),
      fc.boolean(), fc.integer({ min: 28, max: 120 }),
      (word, tail, styled, maxWidth) => {
        const source = `a${styled ? `<b>${word}</b>` : word}  ${tail}\n\n${word}`
        const expected = `a${word}  ${tail}\n\n${word}`.toUpperCase()
        const block = preparePixelText(source, { fontSize: 14, fontWeight: 500, transform: 'uppercase', maxWidth })
        const reconstructed = block.lineBlocks.map((line, index) => {
          const at = block.breaks[index]
          const visible = line.runs.map(run => run.text).join('')
          return (at?.kind === 'hyphen' ? visible.slice(0, -1) : visible) + (at?.kind === 'authored' ? '\n' : at?.replacedText ?? '')
        }).join('')
        expect(reconstructed).toBe(expected)
      },
    ), fcParameters({ numRuns: 40 }))
  })

  it('reports unsatisfiable width or height instead of silently claiming a fit', () => {
    expect(fitPixelText('👩‍💻', typography, { width: 1, height: 100 }).kind).toBe('needs-space')
    expect(fitPixelText('A\nB', typography, { width: 100, height: 10 }).kind).toBe('needs-space')
    expect(fitPixelText('A', typography, { width: 100, height: 100 }).kind).toBe('placed')
    expect(() => preparePixelText('A', { fontSize: NaN, fontWeight: 600 })).toThrow(RangeError)
  })

  it('reserves occupied intervals when negative tracking reverses the pen', () => {
    const block = preparePixelText('iiiiiiiiiiii', { ...typography, letterSpacing: -12 })
    expect(block.width).toBeGreaterThan(5)
    expect(block.lineBlocks[0]!.originX).toBeGreaterThan(0)
    expect(fitPixelText('iiiiiiiiiiii', { ...typography, letterSpacing: -12 }, { width: 1, height: 100 }).kind).toBe('needs-space')
    expect(Object.isFrozen(block.lines)).toBe(true)
    expect(Object.isFrozen(block.lineBlocks[0]!.runs[0])).toBe(true)
  })

  it.each([3, -12])('retains the actual glyph allocations for tracking %s across measurement contexts', letterSpacing => {
    const execution = createTextMeasurementExecution({ id: 'test:nonadditive-tracking', version: '1.0.0', measure: ({ text, fontWeight }) => text.length > 1 ? 2 : fontWeight >= 700 ? 9 : 6 }, 'Inter')
    const block = withTextMeasurementExecution(execution, () => preparePixelText('A<b>B</b>CD', { fontSize: 12, fontWeight: 400, letterSpacing }))
    expect(block.width).toBe(letterSpacing === 3 ? 36 : 21)
    const svg = renderMultilineText(block, 10, 20, 12, `text-anchor="start" font-size="12" font-weight="400" letter-spacing="${letterSpacing}"`)
    expect([...svg.matchAll(/textLength="([^"]+)"/g)].map(match => Number(match[1]))).toEqual([6, 9, 6, 6])
    expect(svg.replace(/<[^>]+>/g, '')).toBe('ABCD')
    const node = marks.text({ id: 'tracked', role: 'label', text: block.text, block, x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} })
    const problems: string[] = []
    nodeProblems(node, 'tracked', problems)
    expect(problems).toEqual([])
    expect(Object.isFrozen(block.lineBlocks[0]!.fragments)).toBe(true)
    expect(Object.isFrozen(block.lineBlocks[0]!.fragments![0])).toBe(true)
  })
})

describe('prepared text at the graphical boundary', () => {
  it.each([{ letterSpacing: 0, fontWeight: 400 }, { letterSpacing: 2, fontWeight: 400 }, { letterSpacing: 0, fontWeight: 800 }])('paints retained styled allocations without nested fitting: %j', ({ letterSpacing, fontWeight }) => {
    let measurements = 0
    const execution = createTextMeasurementExecution({ id: 'test:styled-allocations', version: '1.0.0', measure: ({ text }) => { measurements++; return text.length > 1 ? text.length * 10 + 5 : 10 } }, 'Inter')
    const block = withTextMeasurementExecution(execution, () => preparePixelText('This <b>is</b> <i>Markdown</i>', { fontSize: 20, fontWeight, letterSpacing }))
    const preparedMeasurements = measurements
    const markup = withTextMeasurementExecution(execution, () => renderMultilineText(block, 30, 73, 20, `text-anchor="start" font-size="20" font-weight="${fontWeight}"`))
    expect(measurements).toBe(preparedMeasurements)
    expect(block.prepared.source).toBe('This <b>is</b> <i>Markdown</i>')
    expect(block.width).toBe(letterSpacing === 0 ? 175 : 190)
    const fragments = block.lineBlocks[0]!.fragments!
    expect(fragments).toHaveLength(letterSpacing === 0 ? 4 : 16)
    expect(fragments.map(fragment => fragment.text).join('')).toBe('This is Markdown')
    if (letterSpacing === 0) expect(fragments.map(fragment => [fragment.x, fragment.width])).toEqual([[0, 55], [55, 25], [80, 10], [90, 85]])
    const reference = letterSpacing === 0
      ? `<text x="30" y="80" textLength="55" lengthAdjust="spacingAndGlyphs" xml:space="preserve">This </text><text x="85" y="80" textLength="25" lengthAdjust="spacingAndGlyphs" font-weight="${Math.max(700, fontWeight)}">is</text><text x="110" y="80" textLength="10" lengthAdjust="spacingAndGlyphs" xml:space="preserve"> </text><text x="120" y="80" textLength="85" lengthAdjust="spacingAndGlyphs" font-style="italic">Markdown</text>`
      : [...'This is Markdown'].map((text, index) => `<text x="${30 + index * 12}" y="80" textLength="10" lengthAdjust="spacingAndGlyphs" xml:space="preserve"${index >= 5 && index <= 6 ? ' font-weight="bold"' : index >= 8 ? ' font-style="italic"' : ''}>${text}</text>`).join('')
    const wrap = (text: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" font-weight="${fontWeight}"><style>text{font-family:Inter;font-size:20px}</style>${text}</svg>`
    const raster = (text: string) => new Resvg(wrap(text), { font: { loadSystemFonts: false, fontDirs: [join(import.meta.dir, '..', '..', 'assets', 'fonts')], defaultFontFamily: 'Inter' } }).render().pixels
    expect(Buffer.from(raster(markup)).equals(Buffer.from(raster(reference)))).toBe(true)
    const node = marks.text({ id: 'styled-allocations', role: 'label', text: block.text, block, x: 30, y: 73, fontSize: 20, anchor: 'start', paint: {} })
    const problems: string[] = []
    nodeProblems(node, 'styled-allocations', problems)
    expect(problems).toEqual([])
  })

  it.each(['<b>WWW</b>', '<i>WWW</i>', '<u>WWW</u>', '<s>WWW</s>', '<b>A</b> <i>B</i>'])('retains fitted style carriers and zero-width authored whitespace: %s', source => {
    const execution = createTextMeasurementExecution({ id: 'test:zero-space-run', version: '1.0.0', measure: ({ text }) => text.trim() ? 10 : 0 }, 'Inter')
    const block = withTextMeasurementExecution(execution, () => preparePixelText(source, { fontSize: 30, fontWeight: 400 }))
    const markup = renderMultilineText(block, 30, 50, 30, 'text-anchor="start" font-size="30" font-weight="400"')
    const node = marks.text({ id: 'single-style', role: 'label', text: block.text, block, x: 30, y: 50, fontSize: 30, anchor: 'start', paint: {} })
    const problems: string[] = []
    nodeProblems(node, 'single-style', problems)
    expect(problems).toEqual([])
    expect(block.lineBlocks[0]!.fragments!.map(fragment => fragment.width)).toEqual(source.includes(' ') ? [10, 0, 10] : [10])
    const resvg = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><style>text{font-family:Inter}</style>${markup}</svg>`, { font: { loadSystemFonts: false, fontDirs: [join(import.meta.dir, '..', '..', 'assets', 'fonts')], defaultFontFamily: 'Inter' } }).render()
    const pixels = resvg.pixels
    const ink: number[] = []
    for (let y = 0; y < resvg.height; y++) for (let x = 0; x < resvg.width; x++) if (pixels[(y * resvg.width + x) * 4 + 3]) ink.push(x)
    expect(ink.length).toBeGreaterThan(0)
    expect(Math.min(...ink)).toBeGreaterThanOrEqual(29)
    expect(Math.max(...ink)).toBeLessThanOrEqual(source.includes(' ') ? 51 : 41)
  })

  it.each([undefined, 2])('keeps adjacent identical styles in their original whole-run measurement at width %s', maxWidth => {
    const execution = createTextMeasurementExecution({ id: 'test:adjacent-style-runs', version: '1.0.0', measure: ({ text }) => text.length > 1 ? 2 : 9 }, 'Inter')
    for (const source of ['<b>A</b><b>B</b>', concatDisplayText([prepareDisplayText('<b>A</b>'), prepareDisplayText('<b>B</b>')])]) {
      const block = withTextMeasurementExecution(execution, () => preparePixelText(source, { fontSize: 20, fontWeight: 800, maxWidth }))
      expect(block.width).toBe(2)
      expect(block.breaks).toEqual([])
      expect(block.lineBlocks[0]!.runs.map(run => run.text)).toEqual(['A', 'B'])
      expect(block.lineBlocks[0]!.fragments).toEqual([{ runIndex: 0, text: 'AB', x: 0, width: 2 }])
      const markup = renderMultilineText(block, 10, 30, 20, 'text-anchor="start" font-size="20" font-weight="800"')
      const node = marks.text({ id: 'adjacent-style', role: 'label', text: block.text, block, x: 10, y: 30, fontSize: 20, anchor: 'start', paint: {} })
      const problems: string[] = []
      nodeProblems(node, 'adjacent-style', problems)
      expect(problems).toEqual([])
    }
    const unicode = preparePixelText('<b>漢</b>', { fontSize: 20, fontWeight: 800 })
    expect(unicode.lineBlocks[0]!.fragments).toBeUndefined()
    expect(renderMultilineText(unicode, 10, 30, 20, 'text-anchor="start" font-size="20" font-weight="800"')).toMatch(/<tspan\b[^>]*\bfont-weight="800"[^>]*>漢<\/tspan>/)
  })

  it.each(['مرحبا بكم', 'שָׁלוֹם'])('keeps a native RTL single line on its absolute baseline: %s', label => {
    const block = preparePixelText(label, { fontSize: 40, fontWeight: 500 })
    const wrap = (text: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="160"><style>text{font-family:DejaVu Sans;font-size:40px;font-weight:500}</style>${text}</svg>`
    const markup = renderMultilineText(block, 250, 70, 40, 'text-anchor="middle" font-size="40" font-weight="500"')
    const reference = `<text x="250" y="84" text-anchor="middle">${label}</text>`
    const raster = (text: string) => new Resvg(wrap(text), { font: { loadSystemFonts: false, fontDirs: [join(import.meta.dir, '..', '..', 'assets', 'fonts')], defaultFontFamily: 'Inter' } }).render().pixels
    expect(Buffer.from(raster(markup)).equals(Buffer.from(raster(reference)))).toBe(true)
    const node = marks.text({ id: 'rtl-line', role: 'label', text: block.text, block, x: 250, y: 70, fontSize: 40, anchor: 'middle', paint: {} })
    expect(node.textLayout!.offsetY).toBeCloseTo(0)
  })

  it('places every native RTL line like independently positioned text', () => {
    const lines = [...Array<string>(12).fill('مرحبا مرحبا'), 'مرحبا']
    const block = preparePixelText(lines.join('\n'), { fontSize: 13, fontWeight: 500 })
    const wrap = (text: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="450"><style>text{font-family:DejaVu Sans;font-size:13px;font-weight:500}</style>${text}</svg>`
    const markup = renderMultilineText(block, 100, 212.65, 13, 'text-anchor="middle" font-size="13" font-weight="500"')
    const actual = wrap(markup)
    // Separate text elements give each authored line its own native shaping
    // context. Relative dy must not be consumed by reordered RTL fragments.
    const reference = wrap(lines.map((line, i) => `<text x="100" y="${30 + i * 31.2}" text-anchor="middle">${line}</text>`).join(''))
    const raster = (svg: string) => new Resvg(svg, { font: { loadSystemFonts: false, fontDirs: [join(import.meta.dir, '..', '..', 'assets', 'fonts')], defaultFontFamily: 'Inter' } }).render().pixels
    expect(Buffer.from(raster(actual)).equals(Buffer.from(raster(reference)))).toBe(true)
    const node = marks.text({ id: 'rtl-lines', role: 'label', text: block.text, block, x: 100, y: 212.65, fontSize: 13, anchor: 'middle', paint: {} })
    expect(node.textLayout!.offsetY).toBeCloseTo(0)
  })

  it('recomputes external text geometry instead of trusting a supplied band', () => {
    const valid = buildExternalScene({ version: 1, family: 'family:test/text-band', width: 200, height: 100, colors: { bg: '#fff', fg: '#111' }, metadata: { title: 'Measured text' }, parts: [{ kind: 'text', id: 'label', role: 'label', text: 'Visible label', x: 10, y: 30, fontSize: 18 }] })
    expect(validateSceneDoc(valid, { mode: 'external' }).valid).toBe(true)
    const text = valid.parts.find(node => node.kind === 'text')!
    if (text.kind !== 'text') throw new Error('fixture must have text')
    for (const [field, value] of [
      ['owner', { id: 'absent', role: 'node' }],
      ['measurement', 'prepared'], ['prepared', true],
      ['block', { ...text.block!, text: 'Forged content', prepared: { ...text.block!.prepared, source: 'Forged content' } }],
      ['fontWeight', 900], ['letterSpacing', 30], ['display', 'formatted'],
      ['textLayout', { ...text.textLayout, width: 0 }],
      ['textLayout', { ...text.textLayout, offsetY: 10 }],
    ] as const) {
      // A forged copy keeps the original's writer admission, so rejection
      // tests the field, not a missing serialization.
      const forgedText = { ...text, [field]: value }
      transferSceneNodeSerialization(text, forgedText)
      const result = validateSceneDoc({ ...valid, parts: valid.parts.map(node => node === text ? forgedText : node) }, { mode: 'external' })
      expect(result.valid).toBe(false)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: field === 'owner' ? 'SCENE_REFERENCE' : 'SCENE_FIDELITY', path: expect.stringMatching(new RegExp(`\\.${field}$`)) }))
    }
  })
  for (const label of ['WIDE LABEL WITH TRACKING '.repeat(3), '漢字ひらがな É 👩🏽‍💻 👨‍👩‍👧‍👦']) {
    it(`keeps projected ink within the measured band: ${label.slice(0, 16)}`, () => {
      const block = preparePixelText(label, { fontSize: 22, fontWeight: 800, letterSpacing: 2, display: 'literal', safeFont: true })
      const width = block.width + 40
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="100" viewBox="0 0 ${width} 100" style="font-family:Inter;background:white">${renderMultilineText(block, width / 2, 45, 22, 'text-anchor="middle" font-size="22" font-weight="800" letter-spacing="2"')}</svg>`
      const measured = measureRenderedText(svg).texts[0]!
      expect(measured.pixels).toBeGreaterThan(0)
      expect(measured.offCanvasPixels).toBe(0)
      expect(measured.content).toBe(label.trim())
    })
  }

  it.each(['<b> a</b>', 'a <b> </b>b', '<b>a </b>'])('preserves visible spaces across formatting: %s', label => {
    const block = preparePixelText(label, { fontSize: 18, fontWeight: 500 })
    expect(renderMultilineText(block, 10, 20, 18, 'font-size="18"')).toContain('xml:space="preserve"')
  })

  it.each([
    ['e<b>́</b>e<b>́</b>e<b>́</b>', 0],
    ['🇺🇸🇬🇧🇫🇷', 10],
    ['مرحبا بكم', -12],
    ['ΩΩΩΩΩΩ', 0],
    ['ШШШШШШ', 0],
    ['ÄÄÄÄÄÄ', 0],
    ['mmmmmm é', 0],
  ] as const)('contains native shaping ink with tracking: %s (%s)', (label, letterSpacing) => {
    const block = preparePixelText(label, { fontSize: 30, fontWeight: 400, letterSpacing })
    const width = block.width + 2
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="90" viewBox="0 0 ${width} 90" style="font-family:Inter">${renderMultilineText(block, width / 2, 45, 30, `text-anchor="middle" font-size="30" font-weight="400" letter-spacing="${letterSpacing}"`)}</svg>`
    const measured = measureRenderedText(svg).texts[0]!
    expect(measured.pixels).toBeGreaterThan(0)
    expect(measured.offCanvasPixels).toBe(0)
    expect(svg.match(/data-text-fragment="true"/g)).toHaveLength(1)
  })

  it.each(['مرحبا', 'مَرْحَبًا بِكُمْ', 'שָׁלוֹם', 'किंकर्तव्यविमूढ़', '̸', '́́́'])('allocates the full native glyph band: %s', label => {
    const block = preparePixelText(label, { fontSize: 30, fontWeight: 400 })
    const width = block.width + 2
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${block.height}" viewBox="0 0 ${width} ${block.height}" style="font-family:Inter">${renderMultilineText(block, width / 2, block.height / 2, 30, 'text-anchor="middle" font-size="30" font-weight="400"')}</svg>`
    const measured = measureRenderedText(svg).texts[0]!
    expect(measured.pixels).toBeGreaterThan(0)
    expect(measured.offCanvasPixels).toBe(0)
    expect(fitPixelText(label, { fontSize: 30, fontWeight: 400 }, { width: block.width, height: block.height }).kind).toBe('placed')
  })

  it.each(['start', 'middle', 'end'] as const)('contains natural ink bearings with %s anchoring', anchor => {
    for (const label of ['̸', '́́́', 'किंकर्तव्यविमूढ़']) {
      const block = preparePixelText(label, { fontSize: 30, fontWeight: 800 })
      const width = block.width + 4
      const x = anchor === 'start' ? 2 : anchor === 'end' ? width - 2 : width / 2
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${block.height}" viewBox="0 0 ${width} ${block.height}" style="font-family:Inter">${renderMultilineText(block, x, block.height / 2, 30, `text-anchor="${anchor}" font-size="30" font-weight="800"`)}</svg>`
      expect(measureRenderedText(svg).texts[0]!.offCanvasPixels).toBe(0)
    }
  })

  it('retains complete joining-script text in a shaping run', () => {
    const label = 'مرحبا بكم'
    const block = preparePixelText(label, { ...typography, display: 'literal' })
    const svg = renderMultilineText(block, 100, 30, 18, 'text-anchor="middle" font-size="18"')
    expect(svg).toContain('>مرحبا بكم<')
    expect(svg).not.toContain('>م</tspan>')
  })

  it('carries multiline typography into transformed Scene bounds', () => {
    const block = preparePixelText('WIDE\nSECOND\nTHIRD', { fontSize: 24, fontWeight: 800, letterSpacing: 2 })
    const node = marks.text({ id: 'label', role: 'label', text: block.text, block, x: 100, y: 100, fontSize: 24, anchor: 'middle', paint: {}, transform: { kind: 'rotate', angle: 90, cx: 100, cy: 100 } })
    const bounds = nodeWorldBounds(node)!
    expect(bounds.x1 - bounds.x0).toBeCloseTo(3 * 24 * 1.3)
    expect(bounds.y1 - bounds.y0).toBeCloseTo(block.width)
    expect(node.fontWeight).toBe(800)
    expect(node.letterSpacing).toBe(2)
  })
})
