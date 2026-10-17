import fc from 'fast-check'
import { applyTextTransform } from '../styles.ts'
import { beforeAll, describe, expect, it } from 'bun:test'
import { prepareDisplayText } from '../shared/display-text.ts'
import { preparePixelText, fitPixelText } from '../shared/prepared-text.ts'
import { renderMultilineText } from '../multiline-utils.ts'
import { nodeWorldBounds } from '../scene/bounds.ts'
import * as marks from '../scene/marks.ts'
import { nodeProblems } from '../scene/fidelity.ts'
import { buildExternalScene } from '../scene/external-scene.ts'
import { validateSceneDoc } from '../scene/scene-validation.ts'
import { attachSceneNodeSerialization, sceneNodeSerialization } from '../scene/serialization.ts'
import { measureRenderedText, renderedTextReady } from './helpers/rendered-text.ts'
import { Resvg } from '@resvg/resvg-js'
import { join } from 'node:path'

beforeAll(() => renderedTextReady())
const typography = { fontSize: 18, fontWeight: 600 }

describe('prepared display text', () => {
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
      for (const line of block.lines) expect(line).not.toMatch(/^(?:\p{M}|\u200d)|\u200d$/u)
    })
  }

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
    ), { numRuns: 40 })
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
})

describe('prepared text at the graphical boundary', () => {
  it.each(['مرحبا بكم', 'שָׁלוֹם'])('keeps a native RTL single line on its absolute baseline: %s', label => {
    const block = preparePixelText(label, { fontSize: 40, fontWeight: 500 })
    const wrap = (text: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="160"><style>text{font-family:DejaVu Sans;font-size:40px;font-weight:500}</style>${text}</svg>`
    const markup = renderMultilineText(block, 250, 70, 40, 'text-anchor="middle" font-size="40" font-weight="500"')
    const reference = `<text x="250" y="84" text-anchor="middle">${label}</text>`
    const raster = (text: string) => new Resvg(wrap(text), { font: { loadSystemFonts: false, fontDirs: [join(import.meta.dir, '..', '..', 'assets', 'fonts')], defaultFontFamily: 'Inter' } }).render().pixels
    expect(Buffer.from(raster(markup)).equals(Buffer.from(raster(reference)))).toBe(true)
    const node = marks.text({ id: 'rtl-line', role: 'label', text: block.text, block, x: 250, y: 70, fontSize: 40, anchor: 'middle', paint: {} }, markup)
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
    const node = marks.text({ id: 'rtl-lines', role: 'label', text: block.text, block, x: 100, y: 212.65, fontSize: 13, anchor: 'middle', paint: {} }, markup)
    expect(node.textLayout!.offsetY).toBeCloseTo(0)
  })

  it('recomputes external text geometry instead of trusting a supplied band', () => {
    const valid = buildExternalScene({ version: 1, family: 'family:test/text-band', width: 200, height: 100, colors: { bg: '#fff', fg: '#111' }, metadata: { title: 'Measured text' }, parts: [{ kind: 'text', id: 'label', role: 'label', text: 'Visible label', x: 10, y: 30, fontSize: 18 }] })
    expect(validateSceneDoc(valid, { mode: 'external' }).valid).toBe(true)
    const text = valid.parts.find(node => node.kind === 'text')!
    if (text.kind !== 'text') throw new Error('fixture must have text')
    for (const [field, value] of [
      ['fontWeight', 900], ['letterSpacing', 30], ['display', 'formatted'],
      ['textLayout', { ...text.textLayout, width: 0 }],
      ['textLayout', { ...text.textLayout, offsetY: 10 }],
    ] as const) {
      // Preserve the real serialization carrier so rejection tests the
      // geometry mismatch, not an unrelated missing-crisp diagnostic.
      const forgedText = attachSceneNodeSerialization({ ...text, [field]: value }, sceneNodeSerialization(text))
      const result = validateSceneDoc({ ...valid, parts: valid.parts.map(node => node === text ? forgedText : node) }, { mode: 'external' })
      expect(result.valid).toBe(false)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SCENE_FIDELITY', path: expect.stringMatching(new RegExp(`\\.${field}$`)) }))
    }
  })
  it('compares the complete prepared label instead of accepting only its first word', () => {
    const block = preparePixelText('First word and important suffix', typography)
    const node = marks.text({ id: 'label', role: 'label', text: block.text, block, x: 10, y: 20, fontSize: 18, anchor: 'start', paint: {} }, '<text x="10" y="20" font-size="18">First word</text>')
    const problems: string[] = []
    nodeProblems(node, 'label', problems)
    expect(problems.join('\n')).toContain('prepared text')
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
    const node = marks.text({ id: 'label', role: 'label', text: block.text, block, x: 100, y: 100, fontSize: 24, anchor: 'middle', paint: {}, transform: { kind: 'rotate', angle: 90, cx: 100, cy: 100 } }, renderMultilineText(block, 100, 100, 24, 'text-anchor="middle" font-size="24" font-weight="800" letter-spacing="2" transform="rotate(90 100 100)"'))
    const bounds = nodeWorldBounds(node)!
    expect(bounds.x1 - bounds.x0).toBeCloseTo(3 * 24 * 1.3)
    expect(bounds.y1 - bounds.y0).toBeCloseTo(block.width)
    expect(node.fontWeight).toBe(800)
    expect(node.letterSpacing).toBe(2)
  })
})
