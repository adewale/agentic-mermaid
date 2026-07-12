import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII } from '../ascii/index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { visualWidth, WIDE_CHAR_CONTINUATION } from '../ascii/width.ts'
import { renderMermaidPNG, renderMermaidSVG } from '../agent/index.ts'
import { decodePng } from './helpers/png-pixels.ts'

const widths = (output: string): number[] => output.split('\n').map(visualWidth)
const render = (source: string): string => renderMermaidASCII(source, { colorMode: 'none' })

function expectSameGeometry(unicodeSource: string, equalWidthAsciiSource: string): string {
  const unicode = render(unicodeSource)
  const ascii = render(equalWidthAsciiSource)
  expect(unicode).not.toContain(WIDE_CHAR_CONTINUATION)
  expect(widths(unicode)).toEqual(widths(ascii))
  return unicode
}

describe('grapheme/display-cell geometry across terminal families', () => {
  test('Pie aligns CJK and ZWJ labels by display width', () => {
    const output = expectSameGeometry(
      'pie\n  "日本" : 2\n  "👩‍💻" : 1',
      'pie\n  "ABCD" : 2\n  "XY" : 1',
    )
    expect(output).toContain('日本')
    expect(output).toContain('👩‍💻')
  })

  test('Quadrant places wide labels without changing the fixed grid', () => {
    const output = expectSameGeometry(
      'quadrantChart\n  title 日本\n  quadrant-1 👩‍💻\n  日本: [0.8, 0.8]',
      'quadrantChart\n  title ABCD\n  quadrant-1 XY\n  ABCD: [0.8, 0.8]',
    )
    expect(output).toContain('日本')
    expect(output).toContain('👩‍💻')
    for (const line of output.split('\n').filter(line => /^[┌│├└]/.test(line))) {
      expect(visualWidth(line)).toBe(43)
    }
  })

  test('XYChart centers wide titles/categories and keeps axes invariant', () => {
    const output = expectSameGeometry(
      'xychart-beta\n  title "日本"\n  x-axis ["👩‍💻", "日本"]\n  bar [1, 2]',
      'xychart-beta\n  title "ABCD"\n  x-axis ["XY", "ABCD"]\n  bar [1, 2]',
    )
    expect(output).toContain('日本')
    expect(output).toContain('👩‍💻')
  })

  test('Sequence block headers and Flowchart subgraph labels stay grapheme-safe', () => {
    const sequence = expectSameGeometry(
      'sequenceDiagram\n  participant A\n  participant B\n  loop 日本👩‍💻\n    A->>B: 処理\n  end',
      'sequenceDiagram\n  participant A\n  participant B\n  loop ABCDXY\n    A->>B: WXYZ\n  end',
    )
    expect(sequence).toContain('日本👩‍💻')

    const flow = expectSameGeometry(
      'flowchart TD\n  subgraph G[日本👩‍💻]\n    A --> B\n  end',
      'flowchart TD\n  subgraph G[ABCDXY]\n    A --> B\n  end',
    )
    expect(flow).toContain('日本👩‍💻')
  })

  test('SVG measurement and PNG bounds account for wide CJK deterministically', () => {
    const cjk = '日本語日本語日本語日本語'
    const latin = 'ABCDEFGHIJKL'
    const cjkSource = `flowchart TD\n  A["${cjk}"] --> B[Done]`
    const latinSource = `flowchart TD\n  A["${latin}"] --> B[Done]`
    const viewBox = (svg: string): number[] => (svg.match(/viewBox="([^"]+)"/)?.[1] ?? '').split(' ').map(Number)
    const cjkBox = viewBox(renderMermaidSVG(cjkSource, { embedFontImport: false }))
    const latinBox = viewBox(renderMermaidSVG(latinSource, { embedFontImport: false }))
    expect(cjkBox[2]!).toBeGreaterThan(latinBox[2]!)
    const first = renderMermaidPNG(cjkSource, { scale: 1, onWarning: () => {} })
    const second = renderMermaidPNG(cjkSource, { scale: 1, onWarning: () => {} })
    expect(first).toEqual(second)
    const image = decodePng(first)
    expect(image.width).toBe(Math.ceil(cjkBox[2]!))
    expect(image.height).toBe(Math.ceil(cjkBox[3]!))
  })

  test('TUI metadata reports display-cell columns, not UTF-16 offsets', () => {
    const source = 'flowchart TD\n  A["日本👩‍💻"]'
    const result = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    const region = result.regions.find(item => item.id === 'A')
    expect(region).toBeDefined()
    expect(region!.canvasColEnd - region!.canvasColStart).toBe(visualWidth('日本👩‍💻'))
  })
})
