import { beforeAll, describe, expect, it } from 'bun:test'
import { Resvg } from '@resvg/resvg-wasm'
import { BUILTIN_FAMILY_METADATA, getFamily } from '../agent/families.ts'
import type { DiagramKind } from '../agent/types.ts'
import { renderMermaidSVG } from '../index.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequest, resolvedFamilyRenderContextOf } from '../render-contract.ts'
import { getBackend } from '../scene/backend.ts'
import type { ConnectorMark, SceneNode, ShapeMark } from '../scene/ir.ts'
import * as marks from '../scene/marks.ts'
import { toHex, wcagContrastRatio } from '../shared/color-math.ts'
import { apcaContrast, deltaEOK, minPairwiseDeltaEOK } from '../shared/perceptual-color.ts'
import { inlineResolvedColors } from '../theme.ts'
import type { PositionedPieChart } from '../pie/types.ts'
import type { RenderOptions } from '../types.ts'
import { honestyCorpus, HONESTY_STYLES } from './helpers/chart-honesty.ts'
import { renderedTextReady } from './helpers/rendered-text.ts'

type ColorMark = ShapeMark | ConnectorMark
type ColorPolicy = { readonly mark: (node: ColorMark) => boolean; readonly explanation: string } | { readonly explanation: string }
// A category channel alone does not promise a categorical color: e.g. ER
// cardinalities and sequence participants are identified by geometry and text.
// These policies specify which marks actually use hue to identify peers.
const CATEGORY_COLORS: Record<DiagramKind, ColorPolicy> = {
  zenuml: { explanation: 'Participants and lexical control scopes use geometry and labels for identity.' },
  eventmodeling: { explanation: 'Frame type and namespace are identified by text and lane membership.' },
  pie: { mark: n => n.role === 'pie-slice' || n.role === 'legend', explanation: 'slice fills and keyed legend swatches' },
  radar: { mark: n => n.role === 'point' || n.role === 'legend', explanation: 'opaque vertex dots and keyed legend swatches; overlapping area washes are secondary' },
  xychart: { mark: n => n.role === 'bar' || n.role === 'series' || n.role === 'point' || n.role === 'legend', explanation: 'bar fills, line strokes, point dots and keyed legend samples' },
  journey: { mark: n => n.role === 'actor', explanation: 'actor dots on tasks and in the keyed actor legend' },
  mindmap: { mark: n => n.kind === 'connector' && n.role === 'edge', explanation: 'opaque branch strokes; node tints are secondary' },
  gitgraph: { mark: n => n.role === 'rail', explanation: 'branch rails; commit shapes and labels provide additional identity' },
  sankey: { mark: n => n.role === 'bar', explanation: 'node fills; gradient ribbons encode flow between separately named nodes' },
  treemap: { mark: n => n.role === 'bar', explanation: 'top-level category fills inherited by descendant cells' },
  flowchart: { explanation: 'node/edge identity uses text and connectivity; source classes control authored color' },
  state: { explanation: 'state identity uses text and connectivity; status uses geometry' },
  sequence: { explanation: 'participant identity uses names and lifeline position' },
  timeline: { explanation: 'sections use headings and position; background tints are decorative' },
  class: { explanation: 'class identity uses names; relationship kinds use marker geometry' },
  er: { explanation: 'entity identity uses names; cardinalities use marker geometry' },
  architecture: { explanation: 'service identity uses names, icons and connectivity' },
  quadrant: { explanation: 'quadrant identity uses headings and position; background tints are decorative' },
  gantt: { explanation: 'sections use headings and position; task status uses explicit status styling' },
  c4: { explanation: 'element kinds use labels and stereotypes; source styles are authored' },
  packet: { explanation: 'fields use labels, bit ranges and position' },
  kanban: { explanation: 'columns and tasks use labels and position' },
  requirement: { explanation: 'requirements use identifiers and explicit relationship labels' },
  ishikawa: { explanation: 'causes use labels and connectivity' },
  block: { explanation: 'blocks use labels, shapes and explicit grid placement' },
}

interface PaintSample { category: string; id: string; key: boolean; color: string }

/** Render each real category mark at a standard, non-overlapping size through
 * its selected backend, preserving its paint, semantic role and channels.
 * resvg, rather than our palette/compositing code, supplies the observed RGB.
 * Normalization deliberately removes layout/occlusion from this paint check.
 */
function categoryPaint(kind: DiagramKind, source: string, options: RenderOptions): { samples: PaintSample[]; bg: string; authoredEmphasis?: boolean } {
  const request = resolveRenderRequest(source, { ...options, embedFontImport: false }, 'svg')
  const positioned = positionResolvedFamily(kind, request).positioned
  const scene = getFamily(kind)!.lowerScene!({ positioned, colors: request.appearance.colors, resolved: resolvedFamilyRenderContextOf(request) })
  const policy = CATEGORY_COLORS[kind]
  if (!('mark' in policy)) return { samples: [], bg: scene.colors.bg }
  const selected: ColorMark[] = []
  const visit = (nodes: readonly SceneNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'group') visit(node.children.map(child => child.node))
      else if ((node.kind === 'shape' || node.kind === 'connector') && node.channels?.category !== undefined && policy.mark(node)) selected.push(node)
    }
  }
  visit(scene.parts)
  if (!selected.length) return { samples: [], bg: scene.colors.bg }
  const backend = getBackend(request.appearance.inferredBackend)!
  const context = { seed: 17, ...(request.appearance.style ? { style: request.appearance.style } : {}) }
  const cell = 48, columns = Math.min(12, selected.length), rows = Math.ceil(selected.length / columns)
  const fragments = selected.map((node, index) => {
    const x = index % columns * cell + 8, y = Math.floor(index / columns) * cell + 8
    const geometry = node.kind === 'connector' || node.geometry.kind === 'line'
      ? { kind: 'line' as const, x1: x, y1: y + 16, x2: x + 32, y2: y + 16 }
      : { kind: 'rect' as const, x, y, width: 32, height: 32 }
    const normalized = node.kind === 'shape'
      ? marks.shape({ ...node, geometry, transform: undefined, paint: geometry.kind === 'line' ? node.paint : { ...node.paint, stroke: 'none' } })
      : marks.connector({ id: node.id, role: node.role, geometry: geometry as { kind: 'line'; x1: number; y1: number; x2: number; y2: number }, lineStyle: node.lineStyle, paint: {}, channels: node.channels, attributes: node.attributes, stroke: node.stroke })
    return backend.drawNode(normalized, context)
  })
  const prelude = scene.parts.filter(node => node.kind === 'document' && node.element === 'open')
  // Keep family CSS/custom properties, but use a small atlas viewport.
  const shell = prelude.map(node => getBackend('default')!.drawNode(node, context)).join('\n')
    .replace(/\bwidth="[^"]*"/, `width="${columns * cell}"`)
    .replace(/\bheight="[^"]*"/, `height="${rows * cell}"`)
    .replace(/\bviewBox="[^"]*"/, `viewBox="0 0 ${columns * cell} ${rows * cell}"`)
  const svg = inlineResolvedColors(`${shell}<rect width="100%" height="100%" fill="${scene.colors.bg}"/>${fragments.join('\n')}</svg>`, scene.colors)
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: 4 }, font: { loadSystemFonts: false } })
  const rendered = resvg.render()
  try {
    const pixels = rendered.pixels
    const samples = selected.map((node, index) => {
      const histogram = new Map<string, number>()
      const ox = index % columns * cell, oy = Math.floor(index / columns) * cell
      const line = node.kind === 'connector' || node.geometry.kind === 'line'
      // The interior avoids borders; a narrow strip captures line ink rather
      // than allowing its much larger page area to win the histogram.
      for (let y = (oy + (line ? 20 : 16)) * 4; y < (oy + (line ? 28 : 32)) * 4; y++) {
        for (let x = (ox + 16) * 4; x < (ox + 32) * 4; x++) {
          const at = (y * rendered.width + x) * 4
          const color = toHex(pixels[at]!, pixels[at + 1]!, pixels[at + 2]!)
          if (color !== scene.colors.bg.toLowerCase()) histogram.set(color, (histogram.get(color) ?? 0) + 1)
        }
      }
      const ink = [...histogram].filter(([, count]) => count >= 4)
      const strongest = Math.max(...ink.map(([color]) => deltaEOK(color, scene.colors.bg)!))
      const color = ink.filter(([color]) => deltaEOK(color, scene.colors.bg)! >= strongest - 0.005).sort((a, b) => b[1] - a[1])[0]?.[0] ?? scene.colors.bg
      return { category: node.channels!.category!, id: node.id, key: node.role === 'legend' || node.id.startsWith('actor-legend-dot:'), color }
    })
    return { samples, bg: scene.colors.bg, authoredEmphasis: kind === 'pie' && Boolean((positioned as PositionedPieChart).visual.highlightSlice && (positioned as PositionedPieChart).visual.highlightSlice !== 'hover') }
  } finally { rendered.free(); resvg.free() }
}

beforeAll(renderedTextReady)

function expectCategoryPaint(kind: DiagramKind, source: string, options: RenderOptions, where: string, count?: number): void {
  const { samples, bg, authoredEmphasis } = categoryPaint(kind, source, options)
  expect(samples.length, where).toBeGreaterThan(0)
  const categories = new Map<string, PaintSample[]>()
  for (const paint of samples) categories.set(paint.category, [...categories.get(paint.category) ?? [], paint])
  if (count !== undefined) expect(categories.size, where).toBe(count)
  const representative = [...categories.values()].map(paints => paints.find(p => p.key) ?? paints[0]!)
  // Authored Pie emphasis intentionally dims peers. Match the dimmed keys to
  // their marks, but do not promise an opaque palette's separation floor.
  if (!authoredEmphasis && representative.length > 1) expect(minPairwiseDeltaEOK(representative.map(p => p.color)), `${where}: ${JSON.stringify(representative)}`).toBeGreaterThanOrEqual(0.10)
  for (const paint of authoredEmphasis ? [] : representative) {
    expect(wcagContrastRatio(paint.color, bg)!, `${where}/${paint.id} ${paint.color} vs ${bg}`).toBeGreaterThanOrEqual(1.25)
    expect(Math.abs(apcaContrast(paint.color, bg)!), `${where}/${paint.id}`).toBeGreaterThanOrEqual(15)
  }
  for (const [category, paints] of categories) {
    const keys = paints.filter(p => p.key), marks = paints.filter(p => !p.key)
    for (const key of keys) for (const mark of marks) expect(deltaEOK(key.color, mark.color)!, `${where}/${category}: ${key.id} ${key.color} vs ${mark.id} ${mark.color}`).toBeLessThanOrEqual(0.01)
  }
}

function categorySource(kind: DiagramKind, count: number): string {
  const entries = Array.from({ length: count }, (_, index) => index)
  switch (kind) {
    case 'pie': return `pie\n${entries.map(i => `"Category ${i}": ${i + 1}`).join('\n')}`
    case 'radar': return `radar-beta\naxis a,b,c\n${entries.map(i => `curve C${i}{${i + 1},${count - i},${i + 2}}`).join('\n')}`
    case 'xychart': return `xychart-beta\nx-axis [A,B]\n${entries.map(i => `line "Category ${i}" [${i + 1},${i + 2}]`).join('\n')}`
    case 'journey': return `journey\nsection Team\n${entries.map(i => `Task ${i}:3:Actor ${i}`).join('\n')}`
    case 'mindmap': return `mindmap\n root((Root))\n${entries.map(i => `  Category ${i}`).join('\n')}`
    case 'gitgraph': return `gitGraph LR:\ncommit id: "root"\n${entries.slice(1).map(i => `branch B${i}\ncommit id: "C${i}"\ncheckout main`).join('\n')}`
    case 'sankey': return `sankey-beta\n${entries.slice(1).map(i => `C${i - 1},C${i},1`).join('\n')}`
    case 'treemap': return `treemap\n${entries.map(i => `"Category ${i}": ${i + 1}`).join('\n')}`
    default: throw new Error(`${kind} does not generate peer colors`)
  }
}

describe('category color as drawn', () => {
  it('legend keys follow effective category paint after semantic role overrides', () => {
    const cases = [
      { kind: 'pie', source: categorySource('pie', 2), roles: { 'pie-slice': { fillColor: '#b42318' } } },
      { kind: 'radar', source: categorySource('radar', 2), roles: { 'pie-slice': { fillColor: '#b42318' } } },
      { kind: 'xychart', source: 'xychart-beta\nx-axis [A,B]\nbar "Actual" [1,2]\nline "Forecast" [2 "First",3 "Second"]', roles: { bar: { fillColor: '#b42318' }, series: { strokeColor: '#087443' } } },
    ] as const
    for (const { kind, source, roles } of cases) for (const interactive of [false, true]) {
      const { samples } = categoryPaint(kind, source, { interactive, style: { roles } })
      const keys = samples.filter(sample => sample.key)
      expect(keys.length, kind).toBeGreaterThan(0)
      for (const key of keys) {
        const marks = samples.filter(sample => !sample.key && sample.category === key.category)
        expect(marks.length, `${kind}/${key.category}`).toBeGreaterThan(0)
        for (const mark of marks) expect(mark.color, `${kind}/${key.category}/${mark.id}`).toBe(key.color)
      }
    }
  })
  it('XY point dots inherit series paint while explicit point paint and authored palettes retain precedence', () => {
    for (const interactive of [false, true]) for (const single of [false, true]) {
      const chart = `xychart-beta\nx-axis [${single ? 'A' : 'A,B'}]\nline "Forecast" [${single ? '2 "First"' : '2 "First",3 "Second"'}]`
      for (const authored of [false, true]) for (const pointOverride of ['none', 'role', 'binding'] as const) {
        const source = authored ? `---\nconfig:\n  themeVariables:\n    xyChart:\n      plotColorPalette: "#7c3aed"\n---\n${chart}` : chart
        const seriesColor = authored ? '#7c3aed' : '#087443'
        const hasPointOverride = pointOverride !== 'none'
        const pointColor = !authored && hasPointOverride ? '#b42318' : seriesColor
        const pointStyle = { fillColor: '#b42318', strokeColor: '#442211', lineWidth: 3 }
        const options = { interactive, embedFontImport: false, style: {
          roles: { series: { strokeColor: '#087443' }, ...(pointOverride === 'role' ? { point: pointStyle } : {}) },
          ...(pointOverride === 'binding' ? {
            semanticSlots: { selected: pointStyle },
            bindings: [{ channel: 'category' as const, value: 'line-0', slot: 'selected', role: 'point' as const }],
          } : {}),
        } }
        const svg = renderMermaidSVG(source, options)
        const dots = [...svg.matchAll(/<circle\b[^>]*class="xychart-dot [^"]*"[^>]*>/g)].map(match => match[0])
        const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
        expect(dots).toHaveLength((single ? 1 : 2) * (interactive ? 2 : 1))
        for (const dot of dots) {
          expect(attribute(dot, 'fill')).toBe(pointColor)
          expect(attribute(dot, 'stroke')).toBe(hasPointOverride ? '#442211' : '#FFFFFF')
          expect(attribute(dot, 'stroke-width')).toBe(hasPointOverride ? '3' : '2')
        }
        const labels = [...svg.matchAll(/<text\b[^>]*class="xychart-point-label [^"]*"[^>]*>/g)]
        expect(labels).toHaveLength(single ? 1 : 2)
        for (const [label] of labels) expect(attribute(label, 'fill')).toBe(seriesColor)
        // A point-specific override is intentional. The series key still
        // identifies the line, while default points must match that key.
        const key = svg.match(/<circle\b[^>]*class="xychart-legend-dot"[^>]*>/)?.[0]
        expect(key).toBeDefined()
        expect(attribute(key!, 'fill')).toBe(seriesColor)
        if (!single) expect(svg.match(/<path\b[^>]*class="xychart-line [^"]*"[^>]*>/)?.[0]).toContain(`stroke="${seriesColor}"`)
        const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: 4 }, font: { loadSystemFonts: false } })
        const rendered = resvg.render()
        try {
          // Observe actual SVG paint at each dot center, including the real
          // family stylesheet and overlap of labelled/interactive markers.
          for (const dot of dots) {
            const x = Math.round(Number(attribute(dot, 'cx')) * 4), y = Math.round(Number(attribute(dot, 'cy')) * 4)
            const at = (y * rendered.width + x) * 4
            expect(toHex(rendered.pixels[at]!, rendered.pixels[at + 1]!, rendered.pixels[at + 2]!)).toBe(pointColor)
          }
        } finally { rendered.free(); resvg.free() }
      }
    }
  })
  for (const family of BUILTIN_FAMILY_METADATA) {
    const policy = CATEGORY_COLORS[family.id]
    if (!('mark' in policy)) continue
    it(`${family.id}: ${policy.explanation}, every corpus sample and registered style`, () => {
      for (const sample of honestyCorpus(family.id)) {
        for (const style of HONESTY_STYLES) {
          const where = `${family.id}/${sample.name}/${style ?? 'default'}`
          expectCategoryPaint(family.id, sample.source, style ? { style } : {}, where)
        }
      }
    }, 120_000)
    it(`${family.id}: palette path boundaries on light, dark and middle backgrounds through crisp, wash and hatch backends`, () => {
      for (const count of [2, 6, 7, 24]) for (const bg of ['#ffffff', '#000000', '#808080']) for (const style of ['crisp', 'watercolor', 'patent-drawing']) {
        const options = { style: [style, { colors: { bg, fg: bg === '#000000' ? '#ffffff' : '#111111', accent: '#1d4ed8' } }] }
        expectCategoryPaint(family.id, categorySource(family.id, count), options, `${family.id}/${count}/${bg}/${style}`, count)
      }
    }, 120_000)
  }
})
