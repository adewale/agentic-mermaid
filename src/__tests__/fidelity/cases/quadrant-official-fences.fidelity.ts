import { parseRegisteredMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import { checkedRoundTrip, facts, inViewBox, isRecord, officialFences, parseViewBox, record, same, textTags, viewBoxOf } from '../case-helpers.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// The three distinct executable fences in the pinned official Quadrant page.
const { sources, examples } = officialFences('quadrantChart.md')

type Point = Readonly<{ label: string; x: number; y: number; radius: number; className: string | null; style: string | null }>
type Spec = Readonly<{
  featureId: string
  title: string | null
  axes: readonly string[]
  quadrants: readonly string[]
  points: readonly Point[]
  modelPoints: FidelityJson
  classDefs: FidelityJson
  frontmatter: FidelityJson
  themeTextNoOp?: boolean
  strokeNoWidthDivergence?: boolean
}>
const commonAxes = ['Low Reach', 'High Reach', 'Low Engagement', 'High Engagement']
const commonQuadrants = ['We should expand', 'Need to promote', 'Re-evaluate', 'May be improved']
const plain = (label: string, x: number, y: number): Point => ({ label, x, y, radius: 6, className: null, style: null })
const basicPoints = [plain('Campaign A', 0.3, 0.6), plain('Campaign B', 0.45, 0.23),
  plain('Campaign C', 0.57, 0.69), plain('Campaign D', 0.78, 0.34),
  plain('Campaign E', 0.4, 0.34), plain('Campaign F', 0.35, 0.78)]
const styledPoints: readonly Point[] = [
  { label: 'Campaign A', x: 0.9, y: 0, radius: 12, className: null, style: null },
  { label: 'Campaign B', x: 0.8, y: 0.1, radius: 10, className: 'class1', style: 'fill:#ff3300' },
  { label: 'Campaign C', x: 0.7, y: 0.2, radius: 25, className: null, style: 'fill:#00ff33;stroke:#10f0f0' },
  { label: 'Campaign D', x: 0.6, y: 0.3, radius: 15, className: null,
    style: 'fill:#ff33f0;stroke:#00ff0f;stroke-width:5px' },
  { label: 'Campaign E', x: 0.5, y: 0.4, radius: 10, className: 'class2',
    style: 'fill:#908342;stroke:#310085;stroke-width:10px' },
  { label: 'Campaign F', x: 0.4, y: 0.5, radius: 10, className: 'class3', style: 'fill:#0000ff' },
]
const defaultPointModel = basicPoints.map(({ label, x, y }) => ({ label, x, y }))
const styledPointModel: FidelityJson = [
  { label: 'Campaign A', x: 0.9, y: 0, style: { radius: 12 } },
  { label: 'Campaign B', x: 0.8, y: 0.1, className: 'class1', style: { color: '#ff3300', radius: 10 } },
  { label: 'Campaign C', x: 0.7, y: 0.2, style: { radius: 25, color: '#00ff33', strokeColor: '#10f0f0' } },
  { label: 'Campaign D', x: 0.6, y: 0.3, style: {
    radius: 15, strokeColor: '#00ff0f', strokeWidth: '5px', color: '#ff33f0' } },
  { label: 'Campaign E', x: 0.5, y: 0.4, className: 'class2' },
  { label: 'Campaign F', x: 0.4, y: 0.5, className: 'class3', style: { color: '#0000ff' } },
]
const classDefs = {
  class1: { color: '#109060' },
  class2: { color: '#908342', radius: 10, strokeColor: '#310085', strokeWidth: '10px' },
  class3: { color: '#f00fff', radius: 10 },
}
const specs: readonly Spec[] = [
  { featureId: 'official-doc:quadrant:section:example', title: 'Reach and engagement of campaigns',
    axes: commonAxes, quadrants: commonQuadrants, points: basicPoints, modelPoints: defaultPointModel,
    classDefs: null, frontmatter: null },
  { featureId: 'official-doc:quadrant:section:example-on-config-and-theme', title: null,
    axes: ['Urgent', 'Not Urgent', 'Not Important', 'Important ❤'],
    quadrants: ['Plan', 'Do', 'Delegate', 'Delete'], points: [], modelPoints: [],
    classDefs: null, frontmatter: { quadrantChart: { chartWidth: 400, chartHeight: 400 },
      themeVariables: { quadrant1TextFill: 'ff0000' } },
    themeTextNoOp: true },
  { featureId: 'official-doc:quadrant:section:example-on-styling', title: 'Reach and engagement of campaigns',
    axes: commonAxes, quadrants: commonQuadrants, points: styledPoints, modelPoints: styledPointModel,
    classDefs, frontmatter: null,
    strokeNoWidthDivergence: true },
]

function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'quadrant') {
    return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  }
  const body = parsed.value.body
  return { title: body.title ?? null, axes: [body.xAxis?.near ?? null, body.xAxis?.far ?? null,
      body.yAxis?.near ?? null, body.yAxis?.far ?? null],
    quadrants: body.quadrants.map(label => label ?? null), points: body.points as unknown as FidelityJson,
    classDefs: (body.classDefs as unknown as FidelityJson | undefined) ?? null,
    frontmatter: (parsed.value.meta.frontmatter as FidelityJson | undefined) ?? null }
}
function renderFacts(svg: string): FidelityJson {
  const points = textTags(svg, 'circle', 'quadrant-point')
  return {
    viewBox: viewBoxOf(svg),
    regions: textTags(svg, 'rect', 'quadrant-region').map(item => ({
      quadrant: Number(item.attributes['data-quadrant']), x: Number(item.attributes.x),
      y: Number(item.attributes.y), width: Number(item.attributes.width),
      height: Number(item.attributes.height), fill: item.attributes.fill ?? null })),
    labels: textTags(svg, 'text', 'quadrant-label').map(item => ({
      text: item.text, x: Number(item.attributes.x), y: Number(item.attributes.y),
      fill: item.attributes.fill ?? null, style: item.attributes.style ?? null })),
    axes: textTags(svg, 'text', 'quadrant-axis-label').map(item => item.text),
    title: textTags(svg, 'text', 'quadrant-title').map(item => item.text),
    points: points.map(item => ({
      label: item.attributes['data-label'] ?? null, x: Number(item.attributes['data-x']),
      y: Number(item.attributes['data-y']), cx: Number(item.attributes.cx), cy: Number(item.attributes.cy),
      radius: Number(item.attributes.r), className: item.attributes.class?.split(/\s+/)[1] ?? null,
      style: item.attributes.style ?? null })),
    pointLabels: textTags(svg, 'text', 'quadrant-point-label').map(item => item.text),
    quadrantLabelFill: svg.match(/\.quadrant-label \{ fill: ([^;]+); \}/)?.[1] ?? null,
    pointStrokeWidth: svg.match(/\.quadrant-point \{[^}]*stroke-width: ([^;]+); \}/)?.[1] ?? null,
  }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence, spec: Spec): boolean {
  const observed = facts(evidence)
  const top = spec.title ? 60 : 24
  const size = spec.title ? 380 : 324
  // Authored chartWidth/chartHeight size the canvas; otherwise the grid must
  // simply fit inside it.
  const view = parseViewBox(observed.viewBox)
  const chart = isRecord(spec.frontmatter) && isRecord(spec.frontmatter.quadrantChart) ? spec.frontmatter.quadrantChart : null
  if (!view || (chart && (view.width !== chart.chartWidth || view.height !== chart.chartHeight))
    || !inViewBox(view, 52, top) || !inViewBox(view, 52 + size, top + size)
    || !same(observed.title, spec.title ? [spec.title] : [])
    || !same(observed.axes, spec.axes) || !same(observed.pointLabels, spec.points.map(point => point.label))
    || observed.quadrantLabelFill !== '#575759' || observed.pointStrokeWidth !== '1') return false
  const regions = observed.regions
  const labels = observed.labels
  const points = observed.points
  if (!Array.isArray(regions) || regions.length !== 4 || !Array.isArray(labels) || labels.length !== 4
    || !Array.isArray(points) || points.length !== spec.points.length) return false
  for (const [index, number] of [2, 1, 3, 4].entries()) {
    const region = record(regions[index]!)
    const label = record(labels[index]!)
    const expectedX = 52 + (number === 1 || number === 4 ? size / 2 : 0)
    const expectedY = top + (number === 3 || number === 4 ? size / 2 : 0)
    if (region.quadrant !== number || region.x !== expectedX || region.y !== expectedY
      || region.width !== size / 2 || region.height !== size / 2
      || region.fill !== (number === 1 || number === 3 ? '#ededed' : '#f6f6f6')
      || label.text !== spec.quadrants[number - 1]
      || label.x !== expectedX + size / 4 || label.y !== expectedY + size / 4
      || label.fill !== null || label.style !== null) return false
  }
  for (const [index, authored] of spec.points.entries()) {
    const point = record(points[index]!)
    if (point.label !== authored.label || point.x !== authored.x || point.y !== authored.y
      || Math.abs(Number(point.cx) - (52 + size * authored.x)) > 0.01
      || Math.abs(Number(point.cy) - (top + size * (1 - authored.y))) > 0.01
      || point.radius !== authored.radius || point.className !== authored.className
      || point.style !== authored.style) return false
  }
  return true
}

export const fidelityCases: readonly FidelityCaseDefinition[] = specs.map((spec, index) => ({
  id: 'quadrant.official.fence-' + index, family: 'quadrant', featureId: spec.featureId,
  source: sources[index]!, upstreamReference: examples[index]!.officialDocs ?? 'https://mermaid.ai/open-source/syntax/quadrantChart.html',
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.title === spec.title && same(observed.axes, spec.axes)
        && same(observed.quadrants, spec.quadrants) && same(observed.points, spec.modelPoints)
        && same(observed.classDefs, spec.classDefs) && same(observed.frontmatter, spec.frontmatter)
        ? 'native' : 'absent'
    } },
    render: { applicability: 'applicable', disposition: spec.themeTextNoOp || spec.strokeNoWidthDivergence ? 'absent' : 'native',
      evaluate: evidence => renderMatches(evidence, spec)
        ? spec.themeTextNoOp || spec.strokeNoWidthDivergence ? 'absent' : 'native' : 'source-preserved' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.stable === true && same(observed.model, {
        title: spec.title, axes: spec.axes, quadrants: spec.quadrants, points: spec.modelPoints,
        classDefs: spec.classDefs, frontmatter: spec.frontmatter }) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'These cases classify the pinned official source; Quadrant point mutation has separate operation tests.' },
  },
  observe: () => {
    const source = sources[index]!
    const { verified, serialized, stable } = checkedRoundTrip(source, 'quadrant', 'Pinned Quadrant fence')
    return {
      agent: { status: 'observed' as const, diagnosticCodes: verified.warnings.map(warning => warning.code),
        semantics: modelFacts(source) },
      render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source)) },
      serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable } },
    }
  },
}))
