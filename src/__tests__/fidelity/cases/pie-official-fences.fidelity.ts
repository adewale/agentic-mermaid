import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import { facts, officialFences, record, same, textTags, viewBoxOf } from '../case-helpers.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// All distinct executable fences in the pinned official Pie syntax page.
const { sources, examples: manifestExamples } = officialFences('pie.md')

type Slice = Readonly<{ label: string; value: number }>
type Spec = Readonly<{
  featureId: string
  title: string
  showData: boolean
  slices: readonly Slice[]
  frontmatter: FidelityJson
  donutHole: number
  textPosition: number
  highlighted: string | null
  outerStrokeWidth: string | null
  colors: readonly string[]
}>
const specs: readonly Spec[] = [
  { featureId: 'official-doc:pie:section:pie-chart-diagrams', title: 'Pets adopted by volunteers',
    showData: false, slices: [{ label: 'Dogs', value: 386 }, { label: 'Cats', value: 85 }, { label: 'Rats', value: 15 }],
    frontmatter: null, donutHole: 0, textPosition: 0.75, highlighted: null, outerStrokeWidth: null,
    colors: ['#3b82f6', '#0d5ba5', '#5f79f2'] },
  { featureId: 'official-doc:pie:section:example', title: 'Key elements in Product X', showData: true,
    slices: [{ label: 'Calcium', value: 42.96 }, { label: 'Potassium', value: 50.05 },
      { label: 'Magnesium', value: 10.01 }, { label: 'Iron', value: 5 }],
    frontmatter: { pie: { textPosition: 0.5, donutHole: 0.2, highlightSlice: 'Potassium' },
      themeVariables: { pieOuterStrokeWidth: '5px' } },
    donutHole: 0.2, textPosition: 0.5, highlighted: 'Potassium', outerStrokeWidth: '5',
    colors: ['#3b82f6', '#0d5ba5', '#5f79f2', '#0a5076'] },
]

function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'pie') return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  const body = parsed.value.body
  return { title: body.title ?? null, showData: body.showData,
    slices: body.slices.map(slice => ({ label: slice.label, value: slice.value })),
    frontmatter: (parsed.value.meta.frontmatter as unknown as FidelityJson | undefined) ?? null }
}
export function piePathGeometry(d: string): Readonly<Record<string, FidelityJson>> {
  const coordinate = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
  const solid = new RegExp(`^M ${coordinate} ${coordinate} L ${coordinate} ${coordinate} A ${coordinate} ${coordinate} 0 [01] 1 ${coordinate} ${coordinate} Z$`)
  const donut = new RegExp(`^M ${coordinate} ${coordinate} A ${coordinate} ${coordinate} 0 [01] 1 ${coordinate} ${coordinate} L ${coordinate} ${coordinate} A ${coordinate} ${coordinate} 0 [01] 0 ${coordinate} ${coordinate} Z$`)
  if (!solid.test(d) && !donut.test(d)) return { validShape: false }
  const match = d.match(/^M (-?[\d.]+) (-?[\d.]+)(?: L (-?[\d.]+) (-?[\d.]+))? A ([\d.]+) ([\d.]+) 0 ([01]) 1 (-?[\d.]+) (-?[\d.]+)/)
  if (!match) return { validShape: false }
  const innerArc = d.match(/ L (-?[\d.]+) (-?[\d.]+) A ([\d.]+) ([\d.]+) 0 ([01]) 0 (-?[\d.]+) (-?[\d.]+) Z$/)
  return { validShape: true, start: [Number(match[3] ?? match[1]), Number(match[4] ?? match[2])],
    end: [Number(match[8]), Number(match[9])], outerRadii: [Number(match[5]), Number(match[6])],
    innerRadii: innerArc ? [Number(innerArc[3]), Number(innerArc[4])] : null,
    innerStart: innerArc ? [Number(innerArc[1]), Number(innerArc[2])] : null,
    innerEnd: innerArc ? [Number(innerArc[6]), Number(innerArc[7])] : null,
    innerLargeArc: innerArc ? Number(innerArc[5]) : null,
    largeArc: Number(match[7]), centerMove: match[3] ? [Number(match[1]), Number(match[2])] : null }
}
function renderFacts(svg: string): FidelityJson {
  const paths = textTags(svg, 'path', 'pie-slice')
  const swatches = textTags(svg, 'rect', 'pie-legend-swatch')
  const legends = textTags(svg, 'text', 'pie-legend-text')
  const outer = textTags(svg, 'circle', 'pie-outer-circle')[0]
  return {
    viewBox: viewBoxOf(svg),
    title: textTags(svg, 'text', 'pie-title').map(item => ({ text: item.text,
      x: Number(item.attributes.x), y: Number(item.attributes.y), fontSize: item.attributes['font-size'] ?? null })),
    paths: paths.map(item => ({ ...piePathGeometry(item.attributes.d ?? ''),
      label: item.attributes['data-label'] ?? null, value: item.attributes['data-value'] ?? null,
      percent: item.attributes['data-percent'] ?? null, id: item.attributes['data-id'] ?? null,
      role: item.attributes['data-role'] ?? null, fill: item.attributes.fill ?? null,
      highlighted: item.attributes['data-highlighted'] === 'true',
      highlightClass: (item.attributes.class ?? '').split(/\s+/).includes('highlighted'),
      dimmed: (item.attributes.class ?? '').split(/\s+/).includes('pie-dim') })),
    swatches: swatches.map(item => ({ fill: item.attributes.fill ?? null,
      x: Number(item.attributes.x), y: Number(item.attributes.y),
      width: Number(item.attributes.width), height: Number(item.attributes.height),
      dimmed: (item.attributes.class ?? '').split(/\s+/).includes('pie-dim') })),
    legends: legends.map(item => ({ text: item.text, weight: item.attributes['font-weight'] ?? null,
      x: Number(item.attributes.x), y: Number(item.attributes.y), fontSize: item.attributes['font-size'] ?? null })),
    sliceLabels: textTags(svg, 'text', 'pie-slice-label').map(item => ({ text: item.text,
      x: Number(item.attributes.x), y: Number(item.attributes.y),
      fontSize: item.attributes['font-size'] ?? null, fill: item.attributes.fill ?? null })),
    outer: outer ? { cx: Number(outer.attributes.cx), cy: Number(outer.attributes.cy), r: Number(outer.attributes.r),
      fill: outer.attributes.fill ?? null } : null,
    outerStrokeWidth: svg.match(/\.pie-outer-circle \{[^}]*stroke-width: ([^;]+);/)?.[1] ?? null,
    outerStrokeColor: svg.match(/\.pie-outer-circle \{ stroke: ([^;]+);/)?.[1] ?? null,
    highlightRule: (() => {
      const match = svg.match(/\.pie-slice\.highlighted \{ stroke: ([^;]+); stroke-width: ([^;]+); opacity: ([^;]+); \}/)
      return match ? { stroke: match[1]!, width: match[2]!, opacity: match[3]! } : null
    })(),
    dimSliceOpacity: svg.match(/\.pie-slice\.pie-dim \{ opacity: ([^;]+); \}/)?.[1] ?? null,
    dimSwatchOpacity: svg.match(/\.pie-legend-swatch\.pie-dim \{ opacity: ([^;]+); \}/)?.[1] ?? null,
    slicePaint: svg.match(/\.pie-slice \{[^}]*stroke-width: ([^;]+);/)?.[1] ?? null,
  }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence, spec: Spec): boolean {
  const actual = facts(evidence)
  if (actual.slicePaint !== '1.5'
    || actual.outerStrokeWidth !== spec.outerStrokeWidth
    || actual.outerStrokeColor !== (spec.outerStrokeWidth ? '#d4d4d4' : null)) return false
  if (spec.highlighted && (!same(actual.highlightRule, { stroke: '#27272A', width: '2.5', opacity: '1' })
    || actual.dimSliceOpacity !== '0.4' || actual.dimSwatchOpacity !== '0.4')) return false
  const viewBox = typeof actual.viewBox === 'string' ? actual.viewBox.split(' ').map(Number) : []
  if (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2]! <= 0 || viewBox[3]! <= 0) return false
  const title = actual.title
  if (!Array.isArray(title) || title.length !== 1) return false
  const titleText = record(title[0]!)
  if (titleText.text !== spec.title || titleText.fontSize !== '18'
    || typeof titleText.x !== 'number' || typeof titleText.y !== 'number'
    || titleText.x < 0 || titleText.y < 0 || titleText.x > viewBox[2]! || titleText.y > viewBox[3]!) return false
  const paths = actual.paths
  const swatches = actual.swatches
  const legends = actual.legends
  const labels = actual.sliceLabels
  if (!Array.isArray(paths) || paths.length !== spec.slices.length
    || !Array.isArray(swatches) || swatches.length !== spec.slices.length
    || !Array.isArray(legends) || legends.length !== spec.slices.length
    || !Array.isArray(labels)) return false
  const outer = actual.outer == null ? null : record(actual.outer)
  const firstPath = record(paths[0]!)
  const center = spec.donutHole > 0 ? [outer?.cx, outer?.cy] : firstPath.centerMove
  if (!Array.isArray(center) || center.length !== 2 || center.some(value => typeof value !== 'number' || !Number.isFinite(value))) return false
  const [cx, cy] = center as number[]
  if (cx! <= 0 || cy! <= 0 || cx! >= viewBox[2]! || cy! >= viewBox[3]!) return false
  const paintedRadius = spec.donutHole > 0 ? 97.5 + Number(spec.outerStrokeWidth) / 2 : 95 + 1.5 / 2
  if (cx! - paintedRadius < 0 || cy! - paintedRadius < 0
    || cx! + paintedRadius > viewBox[2]! || cy! + paintedRadius > viewBox[3]!) return false
  if (spec.donutHole > 0 && (!outer || outer.fill !== 'none' || outer.r !== 97.5)) return false
  if (spec.donutHole === 0 && outer) return false
  const angle = (x: number, y: number): number => (Math.atan2(x - cx!, cy! - y) + Math.PI * 2) % (Math.PI * 2)
  const circularDistance = (left: number, right: number): number => Math.min(
    Math.abs(left - right), Math.abs(left - right + Math.PI * 2), Math.abs(left - right - Math.PI * 2))
  const total = spec.slices.reduce((sum, slice) => sum + slice.value, 0)
  let cumulative = 0
  const expectedTexts: string[] = []
  for (const [index, slice] of spec.slices.entries()) {
    const path = record(paths[index]!)
    const swatch = record(swatches[index]!)
    const legend = record(legends[index]!)
    const start = path.start
    const end = path.end
    if (!Array.isArray(start) || !Array.isArray(end) || start.length !== 2 || end.length !== 2) return false
    const [sx, sy] = start as number[]
    const [ex, ey] = end as number[]
    const radii = path.outerRadii
    const inner = path.innerRadii
    const innerStart = path.innerStart
    const innerEnd = path.innerEnd
    const share = slice.value / total
    const percent = `${(share * 100).toFixed(1)}%`
    const shouldHighlight = slice.label === spec.highlighted
    const expectedLegend = `${slice.label}${spec.showData ? ` [${slice.value}]` : ''} (${percent})`
    const inView = (x: unknown, y: unknown): boolean => typeof x === 'number' && Number.isFinite(x)
      && typeof y === 'number' && Number.isFinite(y) && x >= 0 && y >= 0 && x <= viewBox[2]! && y <= viewBox[3]!
    if (path.validShape !== true || path.label !== slice.label || path.value !== String(slice.value) || path.percent !== percent
      || path.id !== `slice:${slice.label}` || path.role !== 'pie-slice'
      || path.fill !== spec.colors[index]
      || path.fill !== swatch.fill || path.highlighted !== shouldHighlight
      || path.highlightClass !== shouldHighlight
      || path.dimmed !== (spec.highlighted !== null && !shouldHighlight)
      || swatch.dimmed !== (spec.highlighted !== null && !shouldHighlight)
      || legend.text !== expectedLegend || legend.weight !== (shouldHighlight ? '700' : '500')
      || legend.fontSize !== '13' || !inView(swatch.x, swatch.y) || !inView(legend.x, legend.y)
      || swatch.width !== 14 || swatch.height !== 14
      || typeof swatch.x !== 'number' || typeof swatch.y !== 'number'
      || typeof legend.x !== 'number' || typeof legend.y !== 'number'
      || swatch.x + swatch.width > viewBox[2]! || swatch.y + swatch.height > viewBox[3]!
      || swatch.x <= cx! + paintedRadius
      || legend.x < swatch.x + swatch.width || Math.abs(legend.y - (swatch.y + swatch.height / 2)) > 0.2
      || (index > 0 && (typeof record(swatches[index - 1]!).y !== 'number'
        || (record(swatches[index - 1]!).y as number) + 14 > swatch.y))
      || !same(radii, [95, 95]) || !same(inner, spec.donutHole > 0 ? [19, 19] : null)
      || !same(path.centerMove, spec.donutHole > 0 ? null : [cx, cy])
      || path.innerLargeArc !== (spec.donutHole > 0 ? (share > 0.5 ? 1 : 0) : null)
      || (spec.donutHole === 0 && (innerStart !== null || innerEnd !== null))
      || (spec.donutHole > 0 && (!Array.isArray(innerStart) || !Array.isArray(innerEnd)
        || innerStart.length !== 2 || innerEnd.length !== 2
        || Math.abs(Math.hypot(Number(innerStart[0]) - cx!, Number(innerStart[1]) - cy!) - 19) > 0.02
        || Math.abs(Math.hypot(Number(innerEnd[0]) - cx!, Number(innerEnd[1]) - cy!) - 19) > 0.02
        || circularDistance(angle(Number(innerStart[0]), Number(innerStart[1])), (cumulative + slice.value) * Math.PI * 2 / total) > 0.001
        || circularDistance(angle(Number(innerEnd[0]), Number(innerEnd[1])), cumulative * Math.PI * 2 / total) > 0.001))
      || path.largeArc !== (share > 0.5 ? 1 : 0)
      || [sx, sy, ex, ey].some(value => typeof value !== 'number' || !Number.isFinite(value)
        || value < 0 || value > Math.max(viewBox[2]!, viewBox[3]!))
      || Math.abs(Math.hypot(sx! - cx!, sy! - cy!) - 95) > 0.02
      || Math.abs(Math.hypot(ex! - cx!, ey! - cy!) - 95) > 0.02
      || circularDistance(angle(sx!, sy!), cumulative * Math.PI * 2 / total) > 0.001
      || circularDistance(angle(ex!, ey!), (cumulative + slice.value) * Math.PI * 2 / total) > 0.001) return false
    expectedTexts.push(`${Math.round(share * 100)}%`)
    cumulative += slice.value
  }
  if (labels.length !== (spec.donutHole > 0 ? 3 : 2)) return false
  let previousIndex = -1
  for (const labelValue of labels) {
    const label = record(labelValue)
    const index = expectedTexts.findIndex((text, candidate) => candidate > previousIndex && text === label.text)
    if (index < 0 || label.fontSize !== '12' || (label.fill !== '#FFFFFF' && label.fill !== '#27272A')
      || typeof label.x !== 'number' || typeof label.y !== 'number') return false
    const x = label.x
    const y = label.y
    const before = spec.slices.slice(0, index).reduce((sum, slice) => sum + slice.value, 0)
    const expectedMidpoint = (before + spec.slices[index]!.value / 2) * Math.PI * 2 / total
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > viewBox[2]! || y > viewBox[3]!
      || Math.abs(Math.hypot(x - cx!, y - cy!) - 95 * spec.textPosition) > 0.2
      || circularDistance(angle(x, y), expectedMidpoint) > 0.01) return false
    previousIndex = index
  }
  return true
}

export const fidelityCases: readonly FidelityCaseDefinition[] = specs.map((spec, index) => ({
  id: `pie.official.fence-${index}`, family: 'pie', featureId: spec.featureId, source: sources[index]!,
  upstreamReference: `${manifestExamples[index]!.officialDocs}#${spec.featureId.split(':section:')[1]}`,
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.title === spec.title && observed.showData === spec.showData
        && same(observed.slices, spec.slices) && same(observed.frontmatter, spec.frontmatter) ? 'native' : 'absent'
    } },
    render: { applicability: 'applicable', disposition: 'native', evaluate: evidence => renderMatches(evidence, spec) ? 'native' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.roundtrip === true && same(observed.model, { title: spec.title, showData: spec.showData,
        slices: spec.slices, frontmatter: spec.frontmatter }) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'These cases classify official syntax, not a mutation operation; set_slice_value has separate Pie receipts.' },
  },
  observe: () => {
    const source = sources[index]!
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'pie') throw new Error(`Official Pie fence ${index} must parse as Pie`)
    const verified = verifyMermaid(source)
    if (!verified.ok) throw new Error(`Official Pie fence ${index} must verify`)
    const model = modelFacts(source)
    const serialized = serializeMermaid(parsed.value)
    const reparsed = modelFacts(serialized)
    return {
      agent: { status: 'observed', diagnosticCodes: verified.warnings.map(warning => warning.code), semantics: model },
      render: { status: 'observed', diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source)) },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { roundtrip: same(model, reparsed), model: reparsed } },
    }
  },
}))
