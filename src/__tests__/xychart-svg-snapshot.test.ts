import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderMermaidSVG } from '../index.ts'

const snapshotDir = join(import.meta.dir, 'testdata', 'svg')

const ACCESSIBLE_MIXED_XYCHART = `---
config:
  xyChart:
    showDataLabel: true
  themeVariables:
    xyChart:
      backgroundColor: "#f8fafc"
      plotColorPalette: "#ff6b6b, #0ea5e9"
      titleColor: "#123456"
---
xychart
  accTitle: Revenue by quarter
  accDescr {
    Quarterly revenue and forecast
    across two regions.
  }
  title Revenue
  x-axis [Q1, "Q2 Growth", Q3]
  y-axis Users 0 --> 100
  bar [30, 60, 45]
  line [25, 55, 50]`

function normalizeSvg(svg: string): string {
  return svg
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

describe('renderMermaidSVG – xychart snapshots', () => {
  it('matches the accessible mixed xychart golden SVG', () => {
    const actual = renderMermaidSVG(ACCESSIBLE_MIXED_XYCHART, { embedFontImport: false })
    const expected = readFileSync(join(snapshotDir, 'xychart-accessible-mixed.svg'), 'utf-8')
    expect(normalizeSvg(actual)).toBe(normalizeSvg(expected))
  })
})
