import { join } from 'node:path'
import { parseRegisteredMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import { attrs, checkedRoundTrip, decodeXml, facts, inViewBox, officialFences, parseViewBox, record, same, tags, viewBoxOf } from '../case-helpers.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// The paired example/preview blocks in the official Radar page are three
// distinct executable fences, not six independent cases.
const { sources, examples } = officialFences('radar.md')
type Axis = Readonly<{ id: string; label: string }>
type Curve = Readonly<{ id: string; label: string; values: readonly number[] }>
type Spec = Readonly<{
  featureId: string
  title: string | null
  renderTitle: string | null
  axes: readonly Axis[]
  curves: readonly Curve[]
  min: number | null
  max: number | null
  graticule: 'circle' | 'polygon'
  frontmatter: FidelityJson
  colors: readonly string[]
  opacity: string
  axisScale: number
}>
const schoolAxes = [{ id: 'm', label: 'Math' }, { id: 's', label: 'Science' },
  { id: 'e', label: 'English' }, { id: 'h', label: 'History' },
  { id: 'g', label: 'Geography' }, { id: 'a', label: 'Art' }]
const restaurantAxes = [{ id: 'food', label: 'Food Quality' }, { id: 'service', label: 'Service' },
  { id: 'price', label: 'Price' }, { id: 'ambiance', label: 'Ambiance' }]
const specs: readonly Spec[] = [
  { featureId: 'official-doc:radar:section:examples', title: null, renderTitle: 'Grades',
    axes: schoolAxes, curves: [
      { id: 'a', label: 'Alice', values: [85, 90, 80, 70, 75, 90] },
      { id: 'b', label: 'Bob', values: [70, 75, 85, 80, 90, 85] },
    ], min: 0, max: 100, graticule: 'circle', frontmatter: { title: 'Grades' },
    colors: ['#3b82f6', '#0d5ba5'], opacity: '0.5', axisScale: 1 },
  { featureId: 'official-doc:radar:section:examples', title: 'Restaurant Comparison', renderTitle: 'Restaurant Comparison',
    axes: restaurantAxes, curves: [
      { id: 'a', label: 'Restaurant A', values: [4, 3, 2, 4] },
      { id: 'b', label: 'Restaurant B', values: [3, 4, 3, 3] },
      { id: 'c', label: 'Restaurant C', values: [2, 3, 4, 2] },
      { id: 'd', label: 'Restaurant D', values: [2, 2, 4, 3] },
    ], min: 0, max: 5, graticule: 'polygon', frontmatter: null,
    colors: ['#3b82f6', '#0d5ba5', '#5f79f2', '#0a5076'], opacity: '0.5', axisScale: 1 },
  { featureId: 'official-doc:radar:section:example-on-config-and-theme', title: null, renderTitle: null,
    axes: ['A', 'B', 'C', 'D', 'E'].map(id => ({ id, label: id })), curves: [
      { id: 'c1', label: 'c1', values: [1, 2, 3, 4, 5] },
      { id: 'c2', label: 'c2', values: [5, 4, 3, 2, 1] },
      { id: 'c3', label: 'c3', values: [3, 3, 3, 3, 3] },
    ], min: 0, max: null, graticule: 'circle',
    frontmatter: { radar: { axisScaleFactor: 0.25, curveTension: 0.1 }, theme: 'base',
      themeVariables: { cScale0: '#FF0000', cScale1: '#00FF00', cScale2: '#0000FF',
        radar: { curveOpacity: 0 } } },
    colors: ['#FF0000', '#00FF00', '#0000FF'], opacity: '0', axisScale: 0.25 },
]
function texts(svg: string, className: string): string[] {
  return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
    .filter(match => (attrs(match[1]!).class ?? '').split(/\s+/).includes(className))
    .map(match => {
      const spans = [...match[2]!.matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/g)].map(tspan => tspan[1]!)
      return decodeXml(attrs(match[1]!)['aria-label'] ?? (spans.length ? spans.join('') : match[2]!))
    })
}
function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'radar') return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  const body = parsed.value.body
  return { title: body.title ?? null, axes: body.axes.map(axis => ({ id: axis.id, label: axis.label })),
    curves: body.curves.map(curve => ({ id: curve.id, label: curve.label, values: [...curve.values] })),
    min: body.min ?? null, max: body.max ?? null, ticks: body.ticks, graticule: body.graticule,
    showLegend: body.showLegend, frontmatter: (parsed.value.meta.frontmatter as FidelityJson | undefined) ?? null }
}
function renderFacts(svg: string, tensionReference?: string): FidelityJson {
  const areas = [...tags(svg, 'path', 'radar-area'), ...tags(svg, 'polygon', 'radar-area')]
  const referenceAreas = tensionReference === undefined ? null : tags(tensionReference, 'path', 'radar-area')
  return {
    viewBox: viewBoxOf(svg),
    tensionReferenceAreaCount: referenceAreas?.length ?? null,
    curveTensionChangedPerCurve: referenceAreas === null ? null
      : tags(svg, 'path', 'radar-area').map((item, index) =>
        item.d !== referenceAreas[index]?.d),
    circleRings: tags(svg, 'circle', 'radar-ring').map(item => Number(item.r)),
    polygonRingCount: tags(svg, 'polygon', 'radar-ring').length,
    axes: tags(svg, 'line', 'radar-axis-line').map(item => ({
      x1: Number(item.x1), y1: Number(item.y1), x2: Number(item.x2), y2: Number(item.y2) })),
    areas: areas.map(item => ({
      id: item['data-id'] ?? null, label: item['data-curve'] ?? null, role: item['data-role'] ?? null,
      fill: item.fill ?? null, stroke: item.stroke ?? null, opacity: item['fill-opacity'] ?? null,
      shape: item.d ? 'path' : 'polygon', shapeData: item.d ?? item.points ?? null })),
    dots: tags(svg, 'circle', 'radar-dot').map(item => ({
      id: item['data-id'] ?? null, role: item['data-role'] ?? null,
      x: Number(item.cx), y: Number(item.cy), radius: Number(item.r), fill: item.fill ?? null })),
    axisLabels: texts(svg, 'radar-axis-label'),
    legends: texts(svg, 'radar-legend-text'),
    swatches: tags(svg, 'rect', 'radar-legend-swatch').map(item => ({
      fill: item.fill ?? null, opacity: item['fill-opacity'] ?? null })),
    title: texts(svg, 'radar-title'),
    curveOpacityRule: svg.match(/\.radar-area \{[^}]*fill-opacity: ([^;]+);/)?.[1] ?? null,
  }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence, spec: Spec): boolean {
  const observed = facts(evidence)
  const circle = spec.graticule === 'circle'
  const view = parseViewBox(observed.viewBox)
  if (!view
    || !same(observed.circleRings, circle ? [24, 48, 72, 96, 120] : [])
    || observed.polygonRingCount !== (circle ? 0 : 5)
    || !same(observed.axisLabels, spec.axes.map(axis => axis.label))
    || !same(observed.legends, spec.curves.map(curve => curve.label))
    || !same(observed.title, spec.renderTitle ? [spec.renderTitle] : [])
    || observed.curveOpacityRule !== spec.opacity
    || observed.tensionReferenceAreaCount !== (spec.axisScale < 1 ? 3 : null)
    || !same(observed.curveTensionChangedPerCurve,
      spec.axisScale < 1 ? [true, true, true] : null)) return false
  const axes = observed.axes
  const areas = observed.areas
  const dots = observed.dots
  const swatches = observed.swatches
  // Every axis radiates from one center; the full-scale graticule fits the canvas.
  const origin = Array.isArray(axes) && axes.length > 0 ? record(axes[0]!) : null
  const cx = Number(origin?.x1)
  const cy = Number(origin?.y1)
  if (!inViewBox(view, cx - 120, cy - 120) || !inViewBox(view, cx + 120, cy + 120)) return false
  const max = spec.max ?? Math.max(...spec.curves.flatMap(curve => curve.values))
  const near = (left: unknown, right: number): boolean => typeof left === 'number'
    && Number.isFinite(left) && Math.abs(left - right) <= 0.02
  if (!Array.isArray(axes) || axes.length !== spec.axes.length
    || !Array.isArray(areas) || areas.length !== spec.curves.length
    || !Array.isArray(dots) || dots.length !== spec.curves.length * spec.axes.length
    || !Array.isArray(swatches) || swatches.length !== spec.curves.length) return false
  for (const [index, item] of axes.entries()) {
    const axis = record(item)
    const angle = -Math.PI / 2 + 2 * Math.PI * index / spec.axes.length
    if (!near(axis.x1, cx) || !near(axis.y1, cy)
      || !near(axis.x2, cx + 120 * spec.axisScale * Math.cos(angle))
      || !near(axis.y2, cy + 120 * spec.axisScale * Math.sin(angle))) return false
  }
  for (const [curveIndex, curve] of spec.curves.entries()) {
    const area = record(areas[curveIndex]!)
    const swatch = record(swatches[curveIndex]!)
    const color = spec.colors[curveIndex]!
    if (area.id !== 'curve:' + curve.id || area.label !== curve.label || area.role !== 'pie-slice'
      || area.fill !== color || area.stroke !== color || area.opacity !== spec.opacity
      || area.shape !== (circle ? 'path' : 'polygon') || typeof area.shapeData !== 'string'
      || swatch.fill !== color || swatch.opacity !== spec.opacity) return false
    const roundedDots: string[] = []
    for (const [axisIndex, value] of curve.values.entries()) {
      const dot = record(dots[curveIndex * spec.axes.length + axisIndex]!)
      const angle = -Math.PI / 2 + 2 * Math.PI * axisIndex / spec.axes.length
      const expectedX = cx + 120 * (value - (spec.min ?? 0)) / (max - (spec.min ?? 0)) * Math.cos(angle)
      const expectedY = cy + 120 * (value - (spec.min ?? 0)) / (max - (spec.min ?? 0)) * Math.sin(angle)
      if (dot.id !== 'dot:' + curve.id + ':' + axisIndex || dot.role !== 'point'
        || dot.radius !== 3 || dot.fill !== color || !near(dot.x, expectedX) || !near(dot.y, expectedY)) return false
      roundedDots.push(String(dot.x) + ',' + String(dot.y))
    }
    if (circle) {
      const d = String(area.shapeData)
      if (!d.startsWith('M ' + roundedDots[0]!.replace(',', ' '))
        || !d.endsWith(roundedDots[0]!.replace(',', ' ') + ' Z')
        || !roundedDots.every(point => d.includes(point.replace(',', ' ')))) return false
    } else if (area.shapeData !== roundedDots.join(' ')) return false
  }
  return true
}
export const fidelityCases: readonly FidelityCaseDefinition[] = specs.map((spec, index) => ({
  id: 'radar.official.fence-' + index, family: 'radar', featureId: spec.featureId,
  source: sources[index]!, upstreamReference: examples[index]!.officialDocs ?? 'https://mermaid.ai/open-source/syntax/radar.html',
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.title === spec.title && same(observed.axes, spec.axes) && same(observed.curves, spec.curves)
        && observed.min === spec.min && observed.max === spec.max && observed.ticks === 5
        && observed.graticule === spec.graticule && observed.showLegend === true
        && same(observed.frontmatter, spec.frontmatter) ? 'native' : 'absent'
    } },
    // Pinned Mermaid draws only one path/polygon per curve. The local renderer
    // additionally draws opaque vertex dots, including when curveOpacity=0.
    render: { applicability: 'applicable', disposition: 'absent',
      evaluate: evidence => renderMatches(evidence, spec) ? 'absent' : 'source-preserved' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.stable === true && same(observed.model, {
        title: spec.title, axes: spec.axes, curves: spec.curves, min: spec.min, max: spec.max,
        ticks: 5, graticule: spec.graticule, showLegend: true, frontmatter: spec.frontmatter,
      }) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'This case classifies official source examples; typed Radar mutations have separate operation tests.' },
  },
  observe: () => {
    const source = sources[index]!
    const { verified, serialized, stable } = checkedRoundTrip(source, 'radar', 'Pinned Radar fence')
    return {
      agent: { status: 'observed' as const, diagnosticCodes: verified.warnings.map(warning => warning.code),
        semantics: modelFacts(source) },
      render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source),
        index === 2 ? renderMermaidSVG(source.replace('curveTension: 0.1', 'curveTension: 0.17')) : undefined) },
      serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable } },
    }
  },
}))
