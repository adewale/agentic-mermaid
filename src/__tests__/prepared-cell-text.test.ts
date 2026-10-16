import { describe, expect, it } from 'bun:test'
import { prepareCellText } from '../ascii/prepared-text.ts'
import { wrapText } from '../ascii/wrap.ts'
import { visualWidth } from '../ascii/width.ts'

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

  it.each(['漢字ひらがな', 'éééé', '👩🏽‍💻👨‍👩‍👧‍👦🇨🇳'])('never splits a grapheme: %s', source => {
    const block = prepareCellText(source, { maxWidth: 2, hyphenate: false })
    expect(block.lines.join('')).toBe(source)
    expect(block.lineWidths.every(width => width <= 2)).toBe(true)
    expect(block.width).toBe(Math.max(...block.lines.map(visualWidth)))
  })

  it('retains literal tags and an indivisible cluster that exceeds the budget', () => {
    const block = prepareCellText('<b>👩‍💻</b>', { maxWidth: 1, hyphenate: false })
    expect(block.lines.join('')).toBe('<b>👩‍💻</b>')
    expect(block.width).toBe(2)
    expect(prepareCellText('👩‍💻', { maxWidth: 1 }).breaks).toEqual([])
    expect(Object.isFrozen(block.lines)).toBe(true)
  })

  it('keeps locale-independent grapheme cells through the public terminal renderer', () => {
    const entry = new URL('../index.ts', import.meta.url).href
    const source = 'flowchart LR\nA["界 é 👩🏽‍💻 🇨🇳"] --> B["Ω Ш"]'
    const code = `import { renderMermaidASCII } from ${JSON.stringify(entry)}; process.stdout.write(renderMermaidASCII(${JSON.stringify(source)}, { colorMode: 'none' }))`
    const outputs = ['C', 'en_US.UTF-8', 'ja_JP.UTF-8'].map(locale => {
      const result = Bun.spawnSync([process.execPath, '-e', code], { env: { ...process.env, LANG: locale, LC_ALL: locale }, stdout: 'pipe', stderr: 'pipe' })
      expect(result.exitCode).toBe(0)
      return new TextDecoder().decode(result.stdout)
    })
    expect(outputs[0]).toContain('界 é 👩🏽‍💻 🇨🇳')
    expect(outputs[1]).toBe(outputs[0])
    expect(outputs[2]).toBe(outputs[0])
  })

  it('keeps all-space content and exact authored trailing spaces', () => {
    expect(prepareCellText('      ', { maxWidth: 2 }).lines).toEqual(['  ', '  ', '  '])
    expect(prepareCellText('A  ', { maxWidth: 4 }).lines).toEqual(['A  '])
  })
})
