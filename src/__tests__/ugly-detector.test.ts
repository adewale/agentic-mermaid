// Real renderer output judged by the ugly-layout detector
// (eval/ugly-detector/detect.ts, specified by docs/design/system/ugly-layouts.md).
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { detect, detectAscii, detectSvg } from '../../eval/ugly-detector/detect.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

describe('rendered output has no ugly-layout defects', () => {
  test('clean built-in flows have no hard defects', () => {
    for (const [src, nodes, edges] of [
      ['flowchart TD\n  A --> B\n  A --> C', ['A', 'B', 'C'], [['A', 'B'], ['A', 'C']]],
      ['flowchart LR\n  A --> B\n  B --> A', ['A', 'B'], [['A', 'B'], ['B', 'A']]],
      ['flowchart TD\n  Q{Decide} -- a --> P[One]\n  Q -- b --> R[Two]', ['P', 'Q', 'R'], [['Q', 'P'], ['Q', 'R']]],
    ] as const) {
      const svg = renderMermaidSVG(src, { embedFontImport: false })
      expect([...svg.matchAll(/<g class="node" data-id="([^"]+)"/g)].map(match => match[1]).sort()).toEqual([...nodes])
      expect([...svg.matchAll(/<(?:path|polyline)\b[^>]*class="edge"[^>]*>/g)].map(([tag]) => [tag.match(/data-from="([^"]+)"/)?.[1], tag.match(/data-to="([^"]+)"/)?.[1]])).toEqual(edges.map(pair => [...pair]))
      expect(detectSvg(svg).filter(f => f.severity === 'hard')).toEqual([])
    }
  })

  test('requires a clear straight alternative before calling a crowded short jog a hitch', () => {
    const source = readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-15.mmd', import.meta.url), 'utf8')
    expect(detectSvg(renderMermaidSVG(source)).filter(f => f.kind === 'hitch')).toEqual([])
    for (const vertical of [false, true]) {
      const point = (x: number, y: number) => vertical ? { x: y, y: x } : { x, y }
      const nodes = [
        { id: 'A', shape: 'rectangle' as const, x: 0, y: 0, w: 40, h: 40 },
        { id: 'B', shape: 'rectangle' as const, ...point(200, 0), w: 40, h: 40 },
      ]
      const edges = [{ from: 'A', to: 'B', pts: [point(40, 20), point(100, 20), point(100, 23), point(200, 23)] }]
      expect(detect({ nodes, edges }).filter(f => f.kind === 'hitch')).toHaveLength(1)
      const label = { ...point(70, 13), w: vertical ? 14 : 60, h: vertical ? 60 : 14 }
      expect(detect({ nodes, edges, labels: [label] }).filter(f => f.kind === 'hitch')).toEqual([])
    }
  })

  test('CJK Gantt label regions do not include timeline glyphs', () => {
    const source = 'gantt\n  dateFormat YYYY-MM-DD\n  section 设计阶段\n    界面设计 :ui, 2024-04-01, 5d'
    const rendered = renderMermaidASCIIWithMeta(source, { useAscii: false })
    expect(rendered.ascii).toContain('设计阶段')
    expect(rendered.ascii).toContain('界面设计')
    const task = rendered.regions.find(region => region.projectedText?.includes('界面设计'))
    expect(task?.authoredTextCells?.length).toBeGreaterThan(0)
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
