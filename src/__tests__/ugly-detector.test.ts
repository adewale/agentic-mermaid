// Tests for the ugly-layout detector (eval/ugly-detector/detect.ts), the tool
// specified by docs/design/system/ugly-layouts.md. Covers each detector on synthetic
// inputs, the SVG/ASCII adapters on real renderer output, and regressions for
// the two false positives the project audit surfaced (cylinder multi-primitive
// footprint, sub-pixel clip-floor jog).
import { describe, test, expect } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  detect, detectSvg, detectAscii, parseSvg, detectPngPixels,
  type Rendered, type Finding,
} from '../../eval/ugly-detector/detect.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { parseAsciiGoldenFixture } from '../../scripts/ascii-golden-fixture.ts'
import { auditOne, collectCorpusDiagrams } from '../../eval/ugly-detector/audit.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

const rect = (id: string, x: number, y: number, w = 40, h = 20) =>
  ({ id, shape: 'rectangle' as const, x, y, w, h })
const kinds = (fs: Finding[]) => fs.map(f => f.kind).sort(compareCodePointStrings)

function mermaidFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => compareCodePointStrings(a.name, b.name))
    .flatMap(entry => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? mermaidFilesUnder(path) : entry.name.endsWith('.mmd') ? [path] : []
    })
}

describe('detect — geometric core', () => {
  test('a clean orthogonal edge between two boxes is not ugly', () => {
    const d: Rendered = {
      nodes: [rect('A', 0, 0), rect('B', 100, 0)],
      edges: [{ from: 'A', to: 'B', pts: [{ x: 40, y: 10 }, { x: 100, y: 10 }] }],
    }
    expect(detect(d)).toEqual([])
  })

  test('a diagonal segment is flagged', () => {
    const d: Rendered = {
      nodes: [rect('A', 0, 0), rect('B', 100, 60)],
      edges: [{ from: 'A', to: 'B', pts: [{ x: 40, y: 10 }, { x: 100, y: 70 }] }],
    }
    expect(kinds(detect(d))).toContain('diagonal-segment')
  })

  test('an endpoint off the node outline is a floating endpoint', () => {
    const d: Rendered = {
      nodes: [rect('A', 0, 0), rect('B', 100, 0)],
      // A-end starts at (20,10): inside A, not on its outline
      edges: [{ from: 'A', to: 'B', pts: [{ x: 20, y: 10 }, { x: 100, y: 10 }] }],
    }
    expect(kinds(detect(d))).toContain('floating-endpoint')
  })

  test('an edge crossing a third node is flagged', () => {
    const d: Rendered = {
      nodes: [rect('A', 0, 0), rect('B', 200, 0), rect('M', 90, 0)],
      edges: [{ from: 'A', to: 'B', pts: [{ x: 40, y: 10 }, { x: 200, y: 10 }] }],
    }
    expect(kinds(detect(d))).toContain('edge-through-node')
  })

  test('overlapping node footprints are flagged', () => {
    const d: Rendered = { nodes: [rect('A', 0, 0), rect('B', 20, 5)], edges: [] }
    expect(kinds(detect(d))).toContain('node-overlap')
  })

  test('a visible jog between two long collinear runs is a hitch', () => {
    const d: Rendered = {
      nodes: [rect('A', 0, 0), rect('B', 200, 0)],
      edges: [{ from: 'A', to: 'B', pts: [
        { x: 40, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 15 }, { x: 200, y: 15 },
      ] }],
    }
    expect(kinds(detect(d))).toContain('hitch')
  })

  test('a sub-pixel jog (curved-shape clip floor) is NOT a hitch', () => {
    // <=1.5px wobble from clipping an endpoint onto a circle/diamond outline.
    const d: Rendered = {
      nodes: [rect('A', 0, 0), rect('B', 200, 0)],
      edges: [{ from: 'A', to: 'B', pts: [
        { x: 40, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 10.9 }, { x: 200, y: 10.9 },
      ] }],
    }
    expect(kinds(detect(d))).not.toContain('hitch')
  })
})

describe('parseSvg — real renderer output', () => {
  test('round-trips nodes and orthogonal edges from a simple flow', () => {
    const svg = renderMermaidSVG('flowchart LR\n  A --> B', { embedFontImport: false })
    const r = parseSvg(svg)
    expect(r.nodes.map(n => n.id).sort()).toEqual(['A', 'B'])
    expect(r.edges.length).toBe(1)
    expect(r.edges[0]!.pts.length).toBeGreaterThanOrEqual(2)
  })

  test('a cylinder footprint unions its cap ellipses (no false float)', () => {
    // Regression: the cylinder body rect stops above the bottom cap; the
    // reciprocal edge attaches on the cap, which must read as on-outline.
    const svg = renderMermaidSVG('flowchart LR\n  A[(A)] -- p --> B[(B)]\n  B -- q --> A', { embedFontImport: false })
    expect(detectSvg(svg).filter(f => f.kind === 'floating-endpoint')).toEqual([])
  })

  test('clean built-in flows have no hard defects', () => {
    for (const src of [
      'flowchart TD\n  A --> B\n  A --> C',
      'flowchart LR\n  A --> B\n  B --> A',
      'flowchart TD\n  Q{Decide} -- a --> P[One]\n  Q -- b --> R[Two]',
    ]) {
      expect(detectSvg(renderMermaidSVG(src, { embedFontImport: false })).filter(f => f.severity === 'hard')).toEqual([])
    }
  })
})

describe('detectAscii — glyph grid', () => {
  test('a clean ASCII flow has no through-node glyphs', () => {
    const { ascii, regions } = renderMermaidASCIIWithMeta('flowchart TD\n  A --> B')
    expect(detectAscii(ascii, regions)).toEqual([])
  })

  test('a line glyph on a node label band is flagged', () => {
    const regions = [{ kind: 'node', id: 'A', canvasRow: 0, canvasColStart: 0, canvasColEnd: 3 }]
    expect(kinds(detectAscii('─X', regions))).toContain('ascii-edge-through-node')
  })

  test('display-cell coordinates do not reinterpret a wide label as following route ink', () => {
    const regions = [{ kind: 'node', id: 'A', canvasRow: 0, canvasColStart: 0, canvasColEnd: 2, projectedText: '界' }]
    expect(detectAscii('界─', regions)).toEqual([])
  })

  test('plain ASCII route glyphs are detected unless they belong to authored label text', () => {
    const line = [{ kind: 'node', id: 'A', canvasRow: 0, canvasColStart: 0, canvasColEnd: 2, projectedText: 'X' }]
    expect(kinds(detectAscii('|X', line, { useAscii: true }))).toContain('ascii-edge-through-node')

    const punctuation = [{
      kind: 'node', id: 'B', canvasRow: 0, canvasColStart: 0, canvasColEnd: 4, projectedText: 'a-b+',
      authoredTextCells: [
        { row: 0, column: 0, glyph: 'a' }, { row: 0, column: 1, glyph: '-' },
        { row: 0, column: 2, glyph: 'b' }, { row: 0, column: 3, glyph: '+' },
      ],
    }]
    expect(detectAscii('a-b+', punctuation, { useAscii: true })).toEqual([])

    const injected = [{
      kind: 'node', id: 'C', canvasRow: 0, canvasColStart: 0, canvasColEnd: 3, projectedText: '-X',
      authoredTextCells: [{ row: 0, column: 0, glyph: '-' }, { row: 0, column: 1, glyph: 'X' }],
    }]
    expect(kinds(detectAscii('--X', injected, { useAscii: true }))).toContain('ascii-edge-through-node')
  })

  test('CJK Gantt label regions do not include timeline glyphs', () => {
    const source = 'gantt\n  dateFormat YYYY-MM-DD\n  section 设计阶段\n    界面设计 :ui, 2024-04-01, 5d'
    const rendered = renderMermaidASCIIWithMeta(source, { useAscii: false })
    expect(detectAscii(rendered.ascii, rendered.regions)).toEqual([])
  })
})

describe('ASCII/Unicode golden fixture admission', () => {
  test('option prelude is not passed to graphical renderers as Mermaid source', () => {
    const fixture = parseAsciiGoldenFixture('paddingX=2\npaddingY=3\nflowchart LR\n  A --> B\n---\nexpected\n')
    expect(fixture).toEqual(expect.objectContaining({
      mermaid: 'flowchart LR\n  A --> B\n',
      paddingX: 2,
      paddingY: 3,
    }))
    expect(() => parseAsciiGoldenFixture('flowchart LR\n  A --> B\n')).toThrow(/missing --- separator/)
  })
})

describe('whole-corpus audit admission', () => {
  test('automatically enrolls every authored eval Mermaid fixture', () => {
    const evalRoot = join(import.meta.dir, '..', '..', 'eval')
    const expected = mermaidFilesUnder(evalRoot)
      .map(path => relative(evalRoot, path).replaceAll('\\', '/'))
      .sort(compareCodePointStrings)
    const enrolled = collectCorpusDiagrams()
      .filter(diagram => diagram.corpus === 'fixtures' || diagram.corpus.startsWith('eval-'))
      .map(diagram => diagram.name)
      .sort(compareCodePointStrings)
    expect(enrolled).toEqual(expected)
    expect(enrolled.filter(name => name.startsWith('mindmap-gitgraph-content-corpus/'))).toHaveLength(13)
  })

  test('non-flowchart families carry renderer-layout structural admission', () => {
    const results = auditOne({
      corpus: 'test', name: 'sequence',
      source: 'sequenceDiagram\n  Alice->>Bob: hello',
    })
    expect(results.find(result => result.format === 'svg')?.structuralAdmission)
      .toEqual(expect.objectContaining({ source: 'rendered-layout', nodes: expect.any(Number), edges: expect.any(Number) }))
    expect(results.find(result => result.format === 'svg')?.structuralAdmission?.nodes).toBeGreaterThan(0)
  })

  test('terminal render failures become audit errors rather than empty passing grids', () => {
    const results = auditOne({ corpus: 'test', name: 'invalid', source: 'not a diagram' })
    for (const format of ['ascii', 'unicode']) {
      expect(results.find(result => result.format === format)?.error).toMatch(/failed/i)
    }
  })
})

describe('detectPngPixels — raster sanity', () => {
  test('a blank/too-sparse raster yields no finding', () => {
    const data = new Uint8Array(40 * 40 * 4).fill(255) // all white
    expect(detectPngPixels({ data, width: 40, height: 40 }, [], 2)).toEqual([])
  })
})
