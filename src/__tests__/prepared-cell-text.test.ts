import { describe, expect, it } from 'bun:test'
import { prepareCellText } from '../ascii/prepared-text.ts'
import { wrapText } from '../ascii/wrap.ts'
import { visualWidth } from '../ascii/width.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

describe('prepared cell text', () => {
  it('preserves interior spaces while recording the separator replaced by wrapping', () => {
    const block = prepareCellText('A  B   C  D', { maxWidth: 5 })
    expect(block.lines).toEqual(['A  B', 'C  D'])
    expect(block.breaks).toEqual([{ kind: 'wrap', sourceOffset: 7, replacedText: '   ' }])
    expect(wrapText('A  B   C  D', 5)).toEqual(['A  B', 'C  D'])
  })

  it('interprets and transforms before fitting, retaining authored blank lines and ranges', () => {
    const block = prepareCellText('a<b>bc</b> def\n\n漢字', { display: 'formatted', transform: 'capitalize', maxWidth: 4 })
    expect(block.lines).toEqual(['Abc', 'Def', '', '漢字'])
    expect(block.breaks.map(b => b.kind)).toEqual(['wrap', 'authored', 'authored'])
    expect(block.breaks[0]!.sourceOffset).toBe(11)
    expect(block.unit).toBe('cell')
    expect(block.lineWidths).toEqual([3, 3, 0, 4])
  })

  it.each([
    ['漢字ひらがな', ['漢', '字', 'ひ', 'ら', 'が', 'な']],
    ['éééé', ['éé', 'éé']],
    ['👩🏽‍💻👨‍👩‍👧‍👦🇨🇳', ['👩🏽‍💻', '👨‍👩‍👧‍👦', '🇨🇳']],
  ] as const)('never splits a grapheme: %s', (source, expected) => {
    const block = prepareCellText(source, { maxWidth: 2, hyphenate: false })
    expect(block.lines).toEqual(expected)
    expect(block.lines.join('')).toBe(source)
    expect(block.lineWidths.every(width => width <= 2)).toBe(true)
    expect(block.width).toBe(Math.max(...block.lines.map(visualWidth)))
  })

  it('neutralizes display controls before wrapping while preserving authored source spans', () => {
    const source = 'A\t界\u001bB\u009dC'
    const block = prepareCellText(source, { maxWidth: 4, hyphenate: false })
    expect(block.prepared.source).toBe(source)
    expect(block.lines).toEqual(['A', '界?B', '?C'])
    expect(block.lineWidths).toEqual([1, 4, 2])
    expect(block.breaks).toEqual([
      { kind: 'wrap', sourceOffset: 2, replacedText: ' ' },
      { kind: 'wrap', sourceOffset: 5 },
    ])
    expect(block.prepared.lines[0]![0]!.clusters).toEqual([
      { text: 'A', sourceStart: 0, sourceEnd: 1 },
      { text: ' ', sourceStart: 1, sourceEnd: 2 },
      { text: '界', sourceStart: 2, sourceEnd: 3 },
      { text: '?', sourceStart: 3, sourceEnd: 4 },
      { text: 'B', sourceStart: 4, sourceEnd: 5 },
      { text: '?', sourceStart: 5, sourceEnd: 6 },
      { text: 'C', sourceStart: 6, sourceEnd: 7 },
    ])
    expect(prepareCellText('A\rB\nC\tD').lines).toEqual(['A?B', 'C D'])
  })

  it('retains literal tags and an indivisible cluster that exceeds the budget', () => {
    const block = prepareCellText('<b>👩‍💻</b>', { maxWidth: 1, hyphenate: false })
    expect(block.lines.join('')).toBe('<b>👩‍💻</b>')
    expect(block.width).toBe(2)
    expect(prepareCellText('👩‍💻', { maxWidth: 1 }).breaks).toEqual([])
    expect(Object.isFrozen(block.lines)).toBe(true)
  })

  it('keeps locale-independent grapheme cells through the public terminal renderer', async () => {
    const entry = new URL('../index.ts', import.meta.url).href
    const source = 'flowchart LR\nA["界 é 👩🏽‍💻 🇨🇳"] --> B["Ω Ш"]'
    const code = `import { renderMermaidASCII } from ${JSON.stringify(entry)}; process.stdout.write(renderMermaidASCII(${JSON.stringify(source)}, { colorMode: 'none' }))`
    const outputs: string[] = []
    for (const locale of ['C', 'en_US.UTF-8', 'ja_JP.UTF-8']) {
      const result = await runChild(process.execPath, ['-e', code], { env: { ...process.env, LANG: locale, LC_ALL: locale } })
      expect(result.status).toBe(0)
      outputs.push(result.stdout)
    }
    expect(outputs[0]).toContain('界 é 👩🏽‍💻 🇨🇳')
    expect(outputs[1]).toBe(outputs[0])
    expect(outputs[2]).toBe(outputs[0])
  })

  it('keeps all-space content and exact authored trailing spaces', () => {
    expect(prepareCellText('      ', { maxWidth: 2 }).lines).toEqual(['  ', '  ', '  '])
    expect(prepareCellText('A  ', { maxWidth: 4 }).lines).toEqual(['A  '])
  })
})


describe('terminal discretionary Unicode breaks', () => {
  it.each([
    ['ab\u00adcd', 3, ['ab-', 'cd'], 'hyphen', '\u00ad'],
    ['ab\u200bcd', 2, ['ab', 'cd'], 'wrap', '\u200b'],
  ] as const)('retains the authored break in %s', (source, maxWidth, lines, kind, replacedText) => {
    const block = prepareCellText(source, { maxWidth })
    expect(block.lines).toEqual([...lines])
    expect(block.breaks).toEqual([{ kind, sourceOffset: 3, replacedText }])
    expect(block.lineWidths.every(width => width <= maxWidth)).toBe(true)
    expect(block.prepared.source).toBe(source)
  })

  it('omits unused and leading hints while keeping blank authored lines', () => {
    const source = '\u00adab\u200bcd\n\n\u200b'
    expect(visualWidth('ab\u00adcd')).toBe(4)
    expect(prepareCellText(source).lines).toEqual(['abcd', '', ''])
    expect(prepareCellText(source, { maxWidth: 8 }).prepared.source).toBe(source)
  })
})
