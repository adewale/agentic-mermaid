import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// The paired example/preview blocks in the official Radar page are three
// distinct executable fences, not six independent cases.
const page = readFileSync(join(import.meta.dir, '..', '..', '..', '..',
  'skills/agentic-mermaid-diagram-workflow/references/upstream/radar.md'), 'utf8')
const sources = [...page.matchAll(/^\x60{3}mermaid(?:-example)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n\x60{3}[^\S\r\n]*$/gm)]
  .map(match => match[1]!.trim()).filter((source, index, all) => all.indexOf(source) === index)
const examples = UPSTREAM_MERMAID_MANIFEST.semanticInventory.examples
  .filter(example => example.origin === 'official-syntax/radar.md' && example.family === 'radar')
  .sort((left, right) => left.index - right.index)
if (sources.length !== 3 || examples.length !== 3) throw new Error('Pinned Radar fence inventory changed')
for (const [index, source] of sources.entries()) {
  if (examples[index]!.id !== 'radar:official-syntax/radar.md#' + index
    || examples[index]!.sourceSha256 !== createHash('sha256').update(source).digest('hex')) {
    throw new Error('Pinned Radar fence ' + index + ' differs from the manifest')
  }
}
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
  viewBox: string
  svgSha256: string
  center: readonly [number, number]
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
    viewBox: '0 0 481.73 370.5', center: [207.62, 202.25],
    svgSha256: '6ad3a994cd07a87730d72635bf62ed3acd0461c90bb8f7c822ecbd2e61d90839',
    colors: ['#3b82f6', '#0d5ba5'], opacity: '0.5', axisScale: 1 },
  { featureId: 'official-doc:radar:section:examples', title: 'Restaurant Comparison', renderTitle: 'Restaurant Comparison',
    axes: restaurantAxes, curves: [
      { id: 'a', label: 'Restaurant A', values: [4, 3, 2, 4] },
      { id: 'b', label: 'Restaurant B', values: [3, 4, 3, 3] },
      { id: 'c', label: 'Restaurant C', values: [2, 3, 4, 2] },
      { id: 'd', label: 'Restaurant D', values: [2, 2, 4, 3] },
    ], min: 0, max: 5, graticule: 'polygon', frontmatter: null,
    viewBox: '0 0 555.45 370.5', center: [217.58, 202.25],
    svgSha256: '4661aeefb780b4f5b8f830f73699c1d2d87667b4c86a80e2a4575ead2d214ec6',
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
    viewBox: '0 0 396.35 310.25', center: [163.79, 168.25],
    svgSha256: '5645bbc27b8632a3e602ebd14f4e26ef8b8201837cd201d6dc984bf4c0aa7da3',
    colors: ['#FF0000', '#00FF00', '#0000FF'], opacity: '0', axisScale: 0.25 },
]
function record(value: FidelityJson | undefined): Readonly<Record<string, FidelityJson>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Radar evidence must be an object')
  return value as Readonly<Record<string, FidelityJson>>
}
function semantic(evidence: ObservedFidelitySurfaceEvidence): Readonly<Record<string, FidelityJson>> {
  return record(evidence.semantics)
}
function same(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, canonical(item)]))
      : value
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}
function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, entity: string) => ({
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
  })[entity]!)
}
function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)]
    .map(match => [match[1]!, decodeXml(match[2]!)]))
}
function tags(svg: string, tag: string, className: string): Record<string, string>[] {
  return [...svg.matchAll(new RegExp('<' + tag + '\\b[^>]*>', 'g'))].map(match => attrs(match[0]))
    .filter(item => (item.class ?? '').split(/\s+/).includes(className))
}
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
    viewBox: svg.match(/<svg\b[^>]*viewBox="([^"]+)"/)?.[1] ?? null,
    svgSha256: createHash('sha256').update(svg).digest('hex'),
    tensionReferenceSvgSha256: tensionReference === undefined ? null
      : createHash('sha256').update(tensionReference).digest('hex'),
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
  const facts = semantic(evidence)
  const circle = spec.graticule === 'circle'
  if (facts.viewBox !== spec.viewBox || facts.svgSha256 !== spec.svgSha256
    || !same(facts.circleRings, circle ? [24, 48, 72, 96, 120] : [])
    || facts.polygonRingCount !== (circle ? 0 : 5)
    || !same(facts.axisLabels, spec.axes.map(axis => axis.label))
    || !same(facts.legends, spec.curves.map(curve => curve.label))
    || !same(facts.title, spec.renderTitle ? [spec.renderTitle] : [])
    || facts.curveOpacityRule !== spec.opacity
    || facts.tensionReferenceSvgSha256 !== (spec.axisScale < 1
      ? '639c0fe94f5df871278b24a7147cae2963c8a1df17b79e2df144dc3f0b2243a0' : null)
    || facts.tensionReferenceAreaCount !== (spec.axisScale < 1 ? 3 : null)
    || !same(facts.curveTensionChangedPerCurve,
      spec.axisScale < 1 ? [true, true, true] : null)) return false
  const axes = facts.axes
  const areas = facts.areas
  const dots = facts.dots
  const swatches = facts.swatches
  const [cx, cy] = spec.center
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
      const facts = semantic(evidence)
      return facts.title === spec.title && same(facts.axes, spec.axes) && same(facts.curves, spec.curves)
        && facts.min === spec.min && facts.max === spec.max && facts.ticks === 5
        && facts.graticule === spec.graticule && facts.showLegend === true
        && same(facts.frontmatter, spec.frontmatter) ? 'native' : 'absent'
    } },
    // Pinned Mermaid draws only one path/polygon per curve. The local renderer
    // additionally draws opaque vertex dots, including when curveOpacity=0.
    render: { applicability: 'applicable', disposition: 'absent',
      evaluate: evidence => renderMatches(evidence, spec) ? 'absent' : 'source-preserved' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const facts = semantic(evidence)
      return facts.stable === true && same(facts.model, {
        title: spec.title, axes: spec.axes, curves: spec.curves, min: spec.min, max: spec.max,
        ticks: 5, graticule: spec.graticule, showLegend: true, frontmatter: spec.frontmatter,
      }) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'This case classifies official source examples; typed Radar mutations have separate operation tests.' },
  },
  observe: () => {
    const source = sources[index]!
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'radar') throw new Error('Pinned Radar fence must parse')
    const verified = verifyMermaid(source)
    if (!verified.ok) throw new Error('Pinned Radar fence must verify')
    const serialized = serializeMermaid(parsed.value)
    const reparsed = parseRegisteredMermaid(serialized)
    if (!reparsed.ok) throw new Error('Pinned Radar fence must reparse')
    return {
      agent: { status: 'observed' as const, diagnosticCodes: verified.warnings.map(warning => warning.code),
        semantics: modelFacts(source) },
      render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source),
        index === 2 ? renderMermaidSVG(source.replace('curveTension: 0.1', 'curveTension: 0.17')) : undefined) },
      serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable: serializeMermaid(reparsed.value) === serialized } },
    }
  },
}))
