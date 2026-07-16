import { describe, expect, it } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { getSeriesColor } from '../xychart/colors.ts'
import { wcagContrastRatio } from '../shared/color-math.ts'
import { apcaContrast, minPairwiseDeltaEOK } from '../shared/perceptual-color.ts'

const sources = {
  xychart: `xychart-beta
  x-axis [A, B]
  y-axis 0 --> 10
  line [1, 2]
  line [2, 3]
  line [3, 4]
  line [4, 5]
  line [5, 6]
  line [6, 7]
  line [7, 8]
  line [8, 9]`,
  journey: `journey
  section One
    A: 1: Ada
    B: 2: Ben
    C: 3: Cy
    D: 4: Dee
  section Two
    E: 5: Eve
    F: 4: Fox
    G: 3: Gia
    H: 2: Hal`,
  mindmap: `mindmap
  root((Root))
    A
    B
    C
    D
    E
    F
    G
    H`,
  gitgraph: `gitGraph LR:
  commit id: "root"
  branch a order: 1
  commit id: "a"
  checkout main
  branch b order: 2
  commit id: "b"
  checkout main
  branch c order: 3
  commit id: "c"
  checkout main
  branch d order: 4
  commit id: "d"
  checkout main
  branch e order: 5
  commit id: "e"
  checkout main
  branch f order: 6
  commit id: "f"
  checkout main
  branch g order: 7
  commit id: "g"`,
} as const

function colorsFromSvg(family: keyof typeof sources, svg: string): string[] {
  if (family === 'xychart') {
    return [...svg.matchAll(/--xychart-color-(\d+):\s*(#[0-9a-f]{6})/gi)]
      .sort((a, b) => Number(a[1]) - Number(b[1])).map(match => match[2]!.toLowerCase())
  }
  if (family === 'journey') {
    return [...svg.matchAll(/\.journey-actor-(\d+)\s*\{\s*fill:\s*(#[0-9a-f]{6})/gi)]
      .sort((a, b) => Number(a[1]) - Number(b[1])).map(match => match[2]!.toLowerCase())
  }
  if (family === 'mindmap') {
    const byIndex = new Map<number, string>()
    for (const tag of svg.matchAll(/<path class="mindmap-edge"[^>]+>/gi)) {
      const index = tag[0].match(/data-branch-index="(\d+)"/)?.[1]
      const color = tag[0].match(/stroke="(#[0-9a-f]{6})"/i)?.[1]
      if (index && color) byIndex.set(Number(index), color.toLowerCase())
    }
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, color]) => color)
  }
  return [...svg.matchAll(/<line class="git-branch-line"[^>]*stroke="(#[0-9a-f]{6})"/gi)].map(match => match[1]!.toLowerCase())
}

describe('controlled {1,2,3} categorical palette rollout', () => {
  it('keeps the legacy ladder byte-for-byte for diagrams with at most six categories', () => {
    for (let count = 1; count <= 6; count++) {
      const expected = Array.from({ length: count }, (_unused, index) => getSeriesColor(index, '#0969da', '#ffffff'))
      expect(categoricalPalette(count, { accent: '#0969da', bg: '#ffffff' })).toEqual(expected)
    }
  })

  it("keeps Journey's established low-cardinality actor colors", () => {
    const svg = renderMermaidSVG(`journey
  section Existing
    A: 1: Ada
    B: 2: Ben
    C: 3: Cy
    D: 4: Dee
    E: 5: Eve`, { embedFontImport: false })
    expect(colorsFromSvg('journey', svg)).toEqual([
      '#34438d', '#8d3f34', '#348d59', '#74348d', '#8d8d34',
    ])
  })

  it('reaches each selected SVG family and clears the perceptual contracts', () => {
    for (const [family, source] of Object.entries(sources) as Array<[keyof typeof sources, string]>) {
      const colors = colorsFromSvg(family, renderMermaidSVG(source, { style: 'dracula', embedFontImport: false }))
      expect(colors, family).toHaveLength(8)
      expect(new Set(colors).size, family).toBe(8)
      expect(minPairwiseDeltaEOK(colors), family).toBeGreaterThanOrEqual(0.10)
      for (const color of colors) {
        expect(wcagContrastRatio(color, '#282a36')!, `${family}: ${color}`).toBeGreaterThanOrEqual(1.25)
        expect(Math.abs(apcaContrast(color, '#282a36')!), `${family}: ${color}`).toBeGreaterThanOrEqual(15)
      }
    }
  })

  it('repairs an invisible XY accent consistently in SVG and terminal output', () => {
    const style = { colors: { bg: '#ffffff', fg: '#111111', accent: '#ffffff' } } as const
    const expected = categoricalPalette(8, { accent: '#ffffff', bg: '#ffffff' })
    const svg = renderMermaidSVG(sources.xychart, { style, embedFontImport: false })
    const svgColors = colorsFromSvg('xychart', svg)
    const terminal = renderMermaidASCII(sources.xychart, { style, colorMode: 'html' })

    expect(expected[0]).toBe('#aee2ff')
    expect(svgColors).toEqual(expected)
    expect(terminal).toContain('color:#aee2ff')
    expect(wcagContrastRatio(svgColors[0]!, '#ffffff')).toBeGreaterThanOrEqual(1.25)
    expect(apcaContrast(svgColors[0]!, '#ffffff')).toBeGreaterThanOrEqual(15)
  })

  it('is deterministic and does not use a fixed-size modulo palette', () => {
    const first = categoricalPalette(24, { accent: '#4493f8', bg: '#0d1117' })
    expect(first).toEqual(categoricalPalette(24, { accent: '#4493f8', bg: '#0d1117' }))
    expect(new Set(first).size).toBe(24)
  })
})
