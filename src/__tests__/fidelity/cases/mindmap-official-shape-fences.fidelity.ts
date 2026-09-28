import { parseRegisteredMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import { attrs, checkedRoundTrip, facts, fitsMeasuredText, inViewBox, officialFences, parseViewBox, record, same, svgNumber, svgPoints, viewBoxOf } from '../case-helpers.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const { sources, examples } = officialFences('mindmap.md')

type Shape = 'rect' | 'rounded' | 'circle' | 'bang' | 'cloud' | 'hexagon' | 'default'
type Spec = Readonly<{
  index: number; featureId: string; id: string; label: string; shape: Shape
  tag: 'rect' | 'circle' | 'polygon' | 'ellipse'; vertices?: number; corner?: number
}>
const specs: readonly Spec[] = [
  { index: 2, featureId: 'official-doc:mindmap:section:square', id: 'id', label: 'I am a square', shape: 'rect',
    tag: 'rect', corner: 0 },
  { index: 3, featureId: 'official-doc:mindmap:section:rounded-square', id: 'id', label: 'I am a rounded square', shape: 'rounded',
    tag: 'rect', corner: 10 },
  { index: 4, featureId: 'official-doc:mindmap:section:circle', id: 'id', label: 'I am a circle', shape: 'circle',
    tag: 'circle' },
  { index: 5, featureId: 'official-doc:mindmap:section:bang', id: 'id', label: 'I am a bang', shape: 'bang',
    tag: 'polygon', vertices: 12 },
  { index: 6, featureId: 'official-doc:mindmap:section:cloud', id: 'id', label: 'I am a cloud', shape: 'cloud',
    tag: 'ellipse' },
  { index: 7, featureId: 'official-doc:mindmap:section:hexagon', id: 'id', label: 'I am a hexagon', shape: 'hexagon',
    tag: 'polygon', vertices: 6 },
  { index: 8, featureId: 'official-doc:mindmap:section:default', id: 'I am the default shape', label: 'I am the default shape', shape: 'default',
    tag: 'rect', corner: 16 },
]
function polygonContains(points: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index]!, b = points[previous]!
    if ((a[1] > y) !== (b[1] > y)
      && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
function polygonHasShape(points: readonly (readonly [number, number])[], shape: Shape): boolean {
  const turns = points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]!
    const next = points[(index + 1) % points.length]!
    return (point[0] - previous[0]) * (next[1] - point[1])
      - (point[1] - previous[1]) * (next[0] - point[0])
  })
  if (shape === 'hexagon') return turns.every(turn => turn > 1) || turns.every(turn => turn < -1)
  if (shape === 'bang') return turns.every((turn, index) => {
    const next = turns[(index + 1) % turns.length]!
    return Math.abs(turn) > 1 && Math.abs(next) > 1 && Math.sign(turn) !== Math.sign(next)
  })
  return false
}
function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  return parsed.ok && parsed.value.body.kind === 'mindmap'
    ? { root: { id: parsed.value.body.root.id, label: parsed.value.body.root.label,
      shape: parsed.value.body.root.shape, children: parsed.value.body.root.children.map(child => child.id) } }
    : { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
}
function renderFacts(svg: string): FidelityJson {
  const nodes = [...svg.matchAll(/<g\b([^>]*\bclass="mindmap-node depth-0"[^>]*)>([\s\S]*?)<\/g>/g)]
  const node = nodes[0]
  const shapeTags = node ? [...node[2]!.matchAll(/<(rect|circle|polygon|ellipse)\b[^>]*\/>/g)] : []
  const shapeTag = shapeTags[0]
  const shape = shapeTag ? attrs(shapeTag[0]) : {}
  const label = node?.[2]?.match(/<text\b([^>]*)>([\s\S]*?)<\/text>/)
  return {
    viewBox: viewBoxOf(svg),
    nodeCount: nodes.length, node: node ? attrs(node[1]!) : null,
    shapeCount: shapeTags.length, tag: shapeTag?.[1] ?? null, shape,
    labelCount: node ? [...node[2]!.matchAll(/<text\b/g)].length : 0,
    label: label?.[2]?.replace(/<[^>]+>/g, '').trim() ?? null,
    labelAttributes: label ? attrs(label[1]!) : null,
    edgeCount: [...svg.matchAll(/class="mindmap-edge\b/g)].length,
  }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence, spec: Spec): boolean {
  const observed = facts(evidence)
  const view = parseViewBox(observed.viewBox)
  if (!view || observed.nodeCount !== 1 || observed.shapeCount !== 1 || observed.labelCount !== 1
    || observed.edgeCount !== 0 || observed.tag !== spec.tag || observed.label !== spec.label) return false
  const node = record(observed.node)
  const shape = record(observed.shape)
  const label = record(observed.labelAttributes)
  if (node['data-id'] !== spec.id || node['data-label'] !== spec.label || node['data-role'] !== 'node'
    || shape.fill !== '#47474a' || shape.stroke !== '#47474a' || label.fill !== '#FFFFFF') return false
  const inView = (x: number, y: number): boolean => inViewBox(view, x, y)
  const textX = svgNumber(label.x)
  const textY = svgNumber(label.y)
  const textWidth = svgNumber(label.textLength)
  const fontSize = svgNumber(label['font-size'])
  const near = (left: number, right: number): boolean => Number.isFinite(left) && Math.abs(left - right) <= 0.01
  const fits = (x: number, y: number, width: number, height: number): boolean =>
    Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)
    && width >= textWidth + 16 && height >= fontSize + 12
    && inView(x, y) && inView(x + width, y + height)
    && near(textX, x + width / 2) && near(textY, y + height / 2)
  // The label run is fitted to the shared measurement of its own text.
  if (!inView(textX, textY) || fontSize !== 13
    || !fitsMeasuredText(textWidth, observed.label, fontSize, label['font-weight'])
    || label['text-anchor'] !== 'middle' || label.lengthAdjust !== 'spacingAndGlyphs'
    || label['data-font-metrics'] !== 'deterministic-fit') return false
  if (spec.tag === 'rect') {
    const x = svgNumber(shape.x), y = svgNumber(shape.y)
    const width = svgNumber(shape.width), height = svgNumber(shape.height)
    return svgNumber(shape.rx) === spec.corner && svgNumber(shape.ry) === spec.corner && fits(x, y, width, height)
  }
  if (spec.tag === 'circle' || spec.tag === 'ellipse') {
    const x = svgNumber(shape.cx), y = svgNumber(shape.cy)
    const rx = svgNumber(spec.tag === 'circle' ? shape.r : shape.rx)
    const ry = svgNumber(spec.tag === 'circle' ? shape.r : shape.ry)
    return rx > 0 && ry > 0 && fits(x - rx, y - ry, 2 * rx, 2 * ry)
  }
  const points = svgPoints(shape.points)
  if (!points || points.length !== spec.vertices || !points.every(point => inView(point[0], point[1]))) return false
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  const area = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)) / 2
  const labelInside = [
    [textX, textY],
    [textX - textWidth / 2, textY - fontSize / 2],
    [textX + textWidth / 2, textY - fontSize / 2],
    [textX - textWidth / 2, textY + fontSize / 2],
    [textX + textWidth / 2, textY + fontSize / 2],
  ].every(([x, y]) => polygonContains(points, x!, y!))
  return area >= textWidth * fontSize && labelInside && polygonHasShape(points, spec.shape)
    && fits(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
}
export const fidelityCases: readonly FidelityCaseDefinition[] = specs.map(spec => ({
  id: 'mindmap.official.fence-' + spec.index, family: 'mindmap', featureId: spec.featureId,
  source: sources[spec.index]!, upstreamReference: examples[spec.index]!.officialDocs
    ?? 'https://mermaid.ai/open-source/syntax/mindmap.html',
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return same(observed, { root: { id: spec.id, label: spec.label,
        shape: spec.shape, children: [] } }) ? 'native' : 'absent'
    } },
    // Pinned Mermaid 11.16 has different default-theme geometry for every
    // shape; bang/cloud use curved paths, and default has a separate underline.
    render: { applicability: 'applicable', disposition: 'absent',
      evaluate: evidence => renderMatches(evidence, spec) ? 'absent' : 'source-preserved' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.stable === true && same(observed.model, {
        root: { id: spec.id, label: spec.label, shape: spec.shape, children: [] },
      }) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'These pinned shape-only sources classify syntax/rendering; Mindmap node mutation has separate contracts.' },
  },
  observe: () => {
    const source = sources[spec.index]!
    const { verified, serialized, stable } = checkedRoundTrip(source, 'mindmap', 'Pinned Mindmap shape fence')
    if (verified.warnings.length) throw new Error('Pinned Mindmap shape fence must verify without warnings')
    return {
      agent: { status: 'observed' as const, diagnosticCodes: [], semantics: modelFacts(source) },
      render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source)) },
      serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable } },
    }
  },
}))
