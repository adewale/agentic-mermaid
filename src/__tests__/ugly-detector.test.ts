// Tests for the ugly-layout detector (eval/ugly-detector/detect.ts), the tool
// specified by docs/design/system/ugly-layouts.md. Covers each detector on synthetic
// inputs, the SVG/ASCII adapters on real renderer output, and regressions for
// the two false positives the project audit surfaced (cylinder multi-primitive
// footprint, sub-pixel clip-floor jog).
import { describe, test, expect } from 'bun:test'
import {
  detect, detectSvg, detectAscii, parseSvg, detectPngPixels,
  type Rendered, type Finding,
} from '../../eval/ugly-detector/detect.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

const rect = (id: string, x: number, y: number, w = 40, h = 20) =>
  ({ id, shape: 'rectangle' as const, x, y, w, h })
const kinds = (fs: Finding[]) => fs.map(f => f.kind).sort()

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

  test('label punctuation (hyphen / pipe / plus) is not a line glyph', () => {
    const regions = [{ kind: 'node', id: 'A', canvasRow: 0, canvasColStart: 0, canvasColEnd: 5 }]
    expect(detectAscii('a-b+', regions)).toEqual([])
  })
})

describe('detectPngPixels — raster sanity', () => {
  test('a blank/too-sparse raster yields no finding', () => {
    const data = new Uint8Array(40 * 40 * 4).fill(255) // all white
    expect(detectPngPixels({ data, width: 40, height: 40 }, [], 2)).toEqual([])
  })
})
