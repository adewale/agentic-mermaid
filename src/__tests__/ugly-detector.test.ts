// Real renderer output judged by the ugly-layout detector
// (eval/ugly-detector/detect.ts, specified by docs/design/system/ugly-layouts.md).
import { describe, test, expect } from 'bun:test'
import { detectAscii, detectSvg } from '../../eval/ugly-detector/detect.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

describe('rendered output has no ugly-layout defects', () => {
  test('clean built-in flows have no hard defects', () => {
    for (const src of [
      'flowchart TD\n  A --> B\n  A --> C',
      'flowchart LR\n  A --> B\n  B --> A',
      'flowchart TD\n  Q{Decide} -- a --> P[One]\n  Q -- b --> R[Two]',
    ]) {
      expect(detectSvg(renderMermaidSVG(src, { embedFontImport: false })).filter(f => f.severity === 'hard')).toEqual([])
    }
  })

  test('CJK Gantt label regions do not include timeline glyphs', () => {
    const source = 'gantt\n  dateFormat YYYY-MM-DD\n  section 设计阶段\n    界面设计 :ui, 2024-04-01, 5d'
    const rendered = renderMermaidASCIIWithMeta(source, { useAscii: false })
    expect(detectAscii(rendered.ascii, rendered.regions)).toEqual([])
  })

  test('terminal audit distinguishes card borders and literal punctuation from corrupted label cells', () => {
    for (const source of ['classDiagram\nclass Account {\n +String name\n}', 'flowchart TD\nA["literal + - | 界"]']) {
      for (const useAscii of [true, false]) {
        const rendered = renderMermaidASCIIWithMeta(source, { colorMode: 'none', useAscii })
        expect(detectAscii(rendered.ascii, rendered.regions, { useAscii })).toEqual([])
        const cell = rendered.regions.find(region => region.kind === 'node')!.authoredTextCells![0]!
        const lines = rendered.ascii.split('\n')
        // Both fixtures start their label in ASCII, so this deliberate damaged
        // artifact replaces one visible source character without changing metadata.
        lines[cell.row] = lines[cell.row]!.slice(0, cell.column) + '|' + lines[cell.row]!.slice(cell.column + 1)
        expect(detectAscii(lines.join('\n'), rendered.regions, { useAscii })).toEqual([
          expect.objectContaining({ kind: 'ascii-label-corrupted', severity: 'hard' }),
        ])
      }
    }
  })
})
