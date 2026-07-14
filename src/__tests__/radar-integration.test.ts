import { describe, expect, test } from 'bun:test'
import { parseRadarChart } from '../radar/parser.ts'
import { layoutRadarChart } from '../radar/layout.ts'
import { resolveRadarScale } from '../radar/scale.ts'
import { layoutMermaid, parseMermaid } from '../agent/index.ts'

const lines = (src: string): string[] => src.split('\n').map(l => l.trim()).filter(Boolean)
const layout = (src: string, visual = {}) => layoutRadarChart(parseRadarChart(lines(src)), {}, visual)

describe('radar layout — domain metaphor invariants', () => {
  const chart = layout('radar-beta\n  axis a, b, c, d\n  curve x{5, 3, 1, 3}\n  min 0\n  max 5\n  ticks 5')

  test('axis 0 sits at 12 o\'clock; axes proceed clockwise', () => {
    // The first spoke endpoint is directly above the center (x ≈ cx, y < cy).
    const a0 = chart.axes[0]!
    expect(Math.abs(a0.x - chart.cx)).toBeLessThan(0.5)
    expect(a0.y).toBeLessThan(chart.cy)
    // Second axis (n=4) is at 3 o'clock: to the right, level with the center.
    const a1 = chart.axes[1]!
    expect(a1.x).toBeGreaterThan(chart.cx)
    expect(Math.abs(a1.y - chart.cy)).toBeLessThan(0.5)
  })

  test('each vertex lies on its spoke\'s ray at the value-scaled radius', () => {
    const curve = chart.curves[0]!
    const values = [5, 3, 1, 3]
    curve.vertices.forEach((v, i) => {
      const angle = Math.atan2(v.x - chart.cx, -(v.y - chart.cy)) // 0 = up, clockwise
      const expectedAngle = ((2 * Math.PI * i) / 4)
      const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      expect(Math.abs(norm(angle) - norm(expectedAngle))).toBeLessThan(0.02)
      const radius = Math.hypot(v.x - chart.cx, v.y - chart.cy)
      expect(Math.abs(radius - (chart.radius * values[i]!) / 5)).toBeLessThan(0.5)
    })
  })

  test('large value vectors resolve iteratively without argument-list allocation', () => {
    const values = Array.from({ length: 200_000 }, (_, index) => index)
    expect(resolveRadarScale({ curves: [{ id: 'x', label: 'x', values }], min: 0 }).max).toBe(199_999)
  })

  test('larger values map to larger radii, clamped inside the outer ring', () => {
    const curve = chart.curves[0]!
    const radii = curve.vertices.map(v => Math.hypot(v.x - chart.cx, v.y - chart.cy))
    expect(radii[0]).toBeGreaterThan(radii[1]!) // 5 > 3
    expect(radii[1]).toBeGreaterThan(radii[2]!) // 3 > 1
    for (const r of radii) expect(r).toBeLessThanOrEqual(chart.radius + 0.5)
  })

  test('graticule rings are concentric and evenly spaced', () => {
    expect(chart.rings).toHaveLength(5)
    chart.rings.forEach((ring, k) => {
      expect(Math.abs(ring.r - (chart.radius * (k + 1)) / 5)).toBeLessThan(0.5)
    })
    expect(chart.rings.at(-1)!.emphasized).toBe(true)
  })

  test('every element stays within the canvas bounds', () => {
    for (const v of chart.curves[0]!.vertices) {
      expect(v.x).toBeGreaterThanOrEqual(0)
      expect(v.x).toBeLessThanOrEqual(chart.width)
      expect(v.y).toBeGreaterThanOrEqual(0)
      expect(v.y).toBeLessThanOrEqual(chart.height)
    }
  })

  test('dense legends expand the canvas and remain visible to RenderedLayout quality checks', () => {
    const curves = Array.from({ length: 40 }, (_, i) => `  curve c${i}["Curve ${i}"]{1,2,3}`).join('\n')
    const source = `radar-beta\n  title Dense comparison\n  axis a, b, c\n${curves}\n  max 5`
    const positioned = layout(source)
    expect(Math.min(...positioned.legend.map(item => item.y))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...positioned.legend.map(item => item.y + item.swatchSize))).toBeLessThanOrEqual(positioned.height)

    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const rendered = layoutMermaid(parsed.value)
    expect(rendered.nodes.some(node => node.id === 'title')).toBe(true)
    expect(rendered.nodes.filter(node => node.id.startsWith('legend-label#'))).toHaveLength(40)
    expect(rendered.groups.map(group => group.id)).toEqual(['ring:0', 'ring:1', 'ring:2', 'ring:3', 'ring:4'])
    for (const ring of rendered.groups) {
      expect(ring.x).toBeGreaterThanOrEqual(0)
      expect(ring.y).toBeGreaterThanOrEqual(0)
      expect(ring.x + ring.w).toBeLessThanOrEqual(rendered.bounds.w)
      expect(ring.y + ring.h).toBeLessThanOrEqual(rendered.bounds.h)
    }
    for (const node of rendered.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.w).toBeLessThanOrEqual(rendered.bounds.w)
      expect(node.y + node.h).toBeLessThanOrEqual(rendered.bounds.h)
    }
  })

  test('long title furniture expands symmetrically enough to stay on-canvas', () => {
    const title = 'A deliberately long radar title '.repeat(12).trim()
    const source = `radar-beta\n  title ${title}\n  axis a, b, c\n  curve x{1,2,3}\n  max 5`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const rendered = layoutMermaid(parsed.value)
    const titleNode = rendered.nodes.find(node => node.id === 'title')!
    expect(titleNode.x).toBeGreaterThanOrEqual(0)
    expect(titleNode.x + titleNode.w).toBeLessThanOrEqual(rendered.bounds.w)
  })

  test('RenderedLayout honors outward SVG text anchors for side-axis labels', () => {
    const source = 'radar-beta\n  axis top, right["Right label"], bottom, left["Left label"]\n  curve x{1,2,3,4}\n  max 5'
    const positioned = layout(source)
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const rendered = layoutMermaid(parsed.value)
    const right = rendered.nodes.find(node => node.id === 'axis#1:right')!
    const left = rendered.nodes.find(node => node.id === 'axis#3:left')!
    expect(right.x).toBeGreaterThanOrEqual(positioned.axes[1]!.labelX - 0.5)
    expect(left.x + left.w).toBeLessThanOrEqual(positioned.axes[3]!.labelX + 0.5)
  })

  test('polygon graticule produces ring vertices; circle graticule does not', () => {
    const poly = layout('radar-beta\n  axis a, b, c\n  curve x{1,2,3}\n  graticule polygon\n  max 5')
    expect(poly.polygonGraticule).toBe(true)
    expect(poly.rings[0]!.points.length).toBe(3)
    expect(chart.rings[0]!.points.length).toBe(0)
  })

  test('a value-count mismatch is not drawn but is still legended', () => {
    const mixed = layout('radar-beta\n  axis a, b, c\n  curve ok{1,2,3}\n  curve bad{1,2}\n  max 5')
    expect(mixed.curves[1]!.arityMismatch).toBe(true)
    expect(mixed.curves[1]!.vertices).toHaveLength(0)
    expect(mixed.legend.map(l => l.label)).toContain('bad')
  })

  test('tickLabels config draws and publicly projects one ring value label per ring', () => {
    const withTicks = layout('radar-beta\n  axis a, b, c\n  curve x{1,2,3}\n  ticks 5\n  max 5', { tickLabels: true })
    expect(withTicks.tickLabels).toHaveLength(5)
    expect(withTicks.tickLabels.map(t => t.text)).toEqual(['1', '2', '3', '4', '5'])

    const parsed = parseMermaid('---\nconfig:\n  radar:\n    tickLabels: true\n---\nradar-beta\n  axis a, b, c\n  curve x{1,2,3}\n  ticks 5\n  max 5')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(layoutMermaid(parsed.value).nodes.filter(node => node.id.startsWith('tick:'))).toHaveLength(5)
  })

  test('layout is deterministic', () => {
    const a = JSON.stringify(layout('radar-beta\n  axis a, b, c\n  curve x{1,2,3}\n  max 5'))
    const b = JSON.stringify(layout('radar-beta\n  axis a, b, c\n  curve x{1,2,3}\n  max 5'))
    expect(a).toBe(b)
  })
})
