import { createHash } from 'node:crypto'
import { parseRegisteredMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import { checkedRoundTrip, classTexts, cssRule, facts, officialFences, record, same, svgPoints, tags } from '../case-helpers.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const { sources, examples } = officialFences('architecture.md')
type Group = Readonly<{ id: string; label: string; icon: string }>
type Service = Readonly<{ id: string; label: string; icon: string; parentId: string | null }>
type Edge = Readonly<{ source: string; sourceSide: string; target: string; targetSide: string }>
type Alignment = Readonly<{ axis: 'row' | 'column'; members: readonly string[] }>
type Spec = Readonly<{
  index: 1 | 2 | 3
  featureId: string
  groups: readonly Group[]
  services: readonly Service[]
  edges: readonly Edge[]
  alignments: readonly Alignment[]
  alignmentFulfilled: readonly boolean[]
  viewBox: string
  svgSha256: string
}>
const specs: readonly Spec[] = [
  { index: 1, featureId: 'official-doc:architecture:section:aligning-siblings-v11-16-0',
    groups: [{ id: 'api', label: 'API', icon: 'cloud' }],
    services: [
      { id: 'db1', label: 'DB1', icon: 'database', parentId: 'api' },
      { id: 'db2', label: 'DB2', icon: 'database', parentId: 'api' },
      { id: 'db3', label: 'DB3', icon: 'database', parentId: 'api' },
      { id: 'mcp', label: 'MCP', icon: 'server', parentId: 'api' },
    ], edges: [
      { source: 'db1', sourceSide: 'R', target: 'mcp', targetSide: 'L' },
      { source: 'db2', sourceSide: 'R', target: 'mcp', targetSide: 'L' },
      { source: 'db3', sourceSide: 'R', target: 'mcp', targetSide: 'L' },
    ], alignments: [{ axis: 'column', members: ['db1', 'db2', 'db3'] }],
    alignmentFulfilled: [true], viewBox: '0 0 410 358',
    svgSha256: '581d4ed329d6be7daf0f8b8299f6ec88842906081a0fdfefee6fda0d214192ea' },
  { index: 2, featureId: 'official-doc:architecture:section:aligning-siblings-v11-16-0', groups: [],
    services: [
      { id: 'src1', label: 'Source 1', icon: 'server', parentId: null },
      { id: 'src2', label: 'Source 2', icon: 'server', parentId: null },
      { id: 'src3', label: 'Source 3', icon: 'server', parentId: null },
      { id: 'proc', label: 'Processor', icon: 'server', parentId: null },
    ], edges: [
      { source: 'src1', sourceSide: 'B', target: 'proc', targetSide: 'T' },
      { source: 'src2', sourceSide: 'B', target: 'proc', targetSide: 'T' },
      { source: 'src3', sourceSide: 'B', target: 'proc', targetSide: 'T' },
    ], alignments: [{ axis: 'row', members: ['src1', 'src2', 'src3'] }],
    alignmentFulfilled: [true], viewBox: '0 0 537.683 232',
    svgSha256: '647dec138c495916b7e6a746761b004c37d060fa1fbe2caf304fed61e06290f7' },
  { index: 3, featureId: 'official-doc:architecture:section:grid-layouts-combining-row-and-column',
    groups: [
      { id: 'sources', label: 'Sources', icon: 'cloud' },
      { id: 'storage', label: 'Storage', icon: 'database' },
      { id: 'output', label: 'Output', icon: 'disk' },
    ], services: [
      { id: 'src_a', label: 'Source A', icon: 'server', parentId: 'sources' },
      { id: 'src_b', label: 'Source B', icon: 'server', parentId: 'sources' },
      { id: 'src_c', label: 'Source C', icon: 'server', parentId: 'sources' },
      { id: 'db_one', label: 'DB One', icon: 'database', parentId: 'storage' },
      { id: 'db_two', label: 'DB Two', icon: 'database', parentId: 'storage' },
      { id: 'db_three', label: 'DB Three', icon: 'database', parentId: 'storage' },
      { id: 'brief', label: 'Brief', icon: 'disk', parentId: 'output' },
      { id: 'analyst', label: 'Analyst', icon: 'server', parentId: 'output' },
      { id: 'delivery', label: 'Delivery', icon: 'cloud', parentId: 'output' },
    ], edges: [
      { source: 'src_a', sourceSide: 'B', target: 'db_one', targetSide: 'T' },
      { source: 'src_b', sourceSide: 'B', target: 'db_two', targetSide: 'T' },
      { source: 'src_c', sourceSide: 'B', target: 'db_three', targetSide: 'T' },
      { source: 'db_two', sourceSide: 'B', target: 'brief', targetSide: 'T' },
      { source: 'brief', sourceSide: 'R', target: 'analyst', targetSide: 'L' },
      { source: 'analyst', sourceSide: 'R', target: 'delivery', targetSide: 'L' },
    ], alignments: [
      { axis: 'row', members: ['src_a', 'src_b', 'src_c'] },
      { axis: 'row', members: ['db_one', 'db_two', 'db_three'] },
      { axis: 'row', members: ['brief', 'analyst', 'delivery'] },
      { axis: 'column', members: ['src_a', 'db_one'] },
      { axis: 'column', members: ['src_b', 'db_two', 'brief'] },
      { axis: 'column', members: ['src_c', 'db_three'] },
    ], alignmentFulfilled: [true, true, false, true, true, true],
    viewBox: '0 0 882.7764999999999 626',
    svgSha256: '1072b6cc82fd5bfee3bf3b2db91ab1df548795e219c10d646026b6c6fa2928c2' },
]
function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'architecture') {
    return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  }
  const body = parsed.value.body
  return {
    groups: body.groups.map(item => ({ id: item.id, label: item.label, icon: item.icon ?? null,
      parentId: item.parentId ?? null })),
    services: body.services.map(item => ({ id: item.id, label: item.label, icon: item.icon ?? null,
      parentId: item.parentId ?? null })),
    edges: body.edges.map(item => ({ source: item.source.id, sourceSide: item.source.side,
      target: item.target.id, targetSide: item.target.side,
      sourceBoundary: item.source.boundary ?? 'item', targetBoundary: item.target.boundary ?? 'item',
      label: item.label ?? null, hasArrowStart: item.hasArrowStart, hasArrowEnd: item.hasArrowEnd })),
    junctions: body.junctions.map(item => ({ id: item.id, parentId: item.parentId ?? null })),
    alignments: (body.alignments ?? []).map(item => ({ axis: item.axis, members: [...item.members] })),
  }
}
function expectedModel(spec: Spec): FidelityJson {
  return { groups: spec.groups.map(item => ({ ...item, parentId: null })), services: spec.services,
    edges: spec.edges.map(item => ({ ...item, sourceBoundary: 'item', targetBoundary: 'item',
      label: null, hasArrowStart: false, hasArrowEnd: true })),
    junctions: [], alignments: spec.alignments }
}
function renderFacts(svg: string, alignments: readonly Alignment[]): FidelityJson {
  const cards = tags(svg, 'rect', 'architecture-service-card').map(item => ({
    id: item['data-id']?.replace(/^service-card:/, '') ?? null, x: Number(item.x), y: Number(item.y),
    width: Number(item.width), height: Number(item.height) }))
  const byId = new Map(cards.map(card => [card.id, card]))
  const alignmentFulfilled = alignments.map(alignment => {
    const members = alignment.members.map(id => byId.get(id))
    if (members.some(item => !item)) return false
    const centers = members.map(item => ({ x: item!.x + item!.width / 2, y: item!.y + item!.height / 2 }))
    const sameCoordinate = alignment.axis === 'row' ? 'y' : 'x'
    const orderedCoordinate = alignment.axis === 'row' ? 'x' : 'y'
    return centers.every(point => Math.abs(point[sameCoordinate] - centers[0]![sameCoordinate]) <= 0.01)
      && centers.slice(1).every((point, index) => point[orderedCoordinate] > centers[index]![orderedCoordinate] + 0.01)
  })
  return { viewBox: svg.match(/<svg\b[^>]*viewBox="([^"]+)"/)?.[1] ?? null,
    svgSha256: createHash('sha256').update(svg).digest('hex'),
    groups: tags(svg, 'g', 'architecture-group').map(item => ({ id: item['data-id'] ?? null,
      label: item['data-label'] ?? null })),
    services: tags(svg, 'g', 'architecture-service').map(item => ({ id: item['data-id'] ?? null,
      label: item['data-label'] ?? null })),
    icons: tags(svg, 'g', 'architecture-icon').map(item => item['data-icon'] ?? null),
    cards, alignmentFulfilled,
    frames: tags(svg, 'rect', 'architecture-group-frame').map(item => ({
      id: item['data-id']?.replace(/^group-frame:/, '') ?? null, x: Number(item.x), y: Number(item.y),
      width: Number(item.width), height: Number(item.height) })),
    groupLabels: classTexts(svg, 'architecture-group-label'),
    serviceLabels: classTexts(svg, 'architecture-service-label'),
    groupFramePaint: cssRule(svg, 'architecture-group-frame'),
    groupOutlinePaint: cssRule(svg, 'architecture-group-outline'),
    serviceCardPaint: cssRule(svg, 'architecture-service-card'),
    serviceOutlinePaint: cssRule(svg, 'architecture-service-outline'),
    arrowMarkerPresent: /<marker\b[^>]*id="architecture-arrow-end"[^>]*>/.test(svg),
    edges: tags(svg, 'polyline', 'architecture-edge').map(item => ({
      source: item['data-from'] ?? null, sourceSide: item['data-from-side'] ?? null,
      target: item['data-to'] ?? null, targetSide: item['data-to-side'] ?? null,
      direction: item['data-direction'] ?? null, points: item.points ?? null,
      markerStart: item['marker-start'] ?? null, markerEnd: item['marker-end'] ?? null })) }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence, spec: Spec): boolean {
  const observed = facts(evidence)
  const paintedFill = (rule: FidelityJson | undefined): boolean =>
    typeof rule === 'string' && /^fill: #[0-9a-f]{6};/i.test(rule)
  if (observed.viewBox !== spec.viewBox || observed.svgSha256 !== spec.svgSha256
    || !same(observed.groups, spec.groups.map(item => ({ id: item.id, label: item.label })))
    || !same(observed.services, spec.services.map(item => ({ id: item.id, label: item.label })))
    || !same(observed.icons, [...spec.groups, ...spec.services].map(item => item.icon))
    || !same(observed.alignmentFulfilled, spec.alignmentFulfilled)
    || observed.arrowMarkerPresent !== true
    || !same(observed.groupLabels, spec.groups.map(item => item.label))
    || !same(observed.serviceLabels, spec.services.map(item => item.label))
    // Pinned Mermaid 11.16 uses unfilled dashed node/group backgrounds.
    || !paintedFill(observed.groupFramePaint) || !paintedFill(observed.serviceCardPaint)
    || typeof observed.groupOutlinePaint !== 'string' || observed.groupOutlinePaint.includes('stroke-dasharray')
    || typeof observed.serviceOutlinePaint !== 'string' || observed.serviceOutlinePaint.includes('stroke-dasharray')) return false
  const cards = observed.cards
  const frames = observed.frames
  const edges = observed.edges
  if (!Array.isArray(cards) || cards.length !== spec.services.length
    || !Array.isArray(frames) || frames.length !== spec.groups.length
    || !Array.isArray(edges) || edges.length !== spec.edges.length) return false
  const cardMap = new Map(cards.map(item => {
    const card = record(item)
    return [card.id, card]
  }))
  const [viewX, viewY, viewWidth, viewHeight] = spec.viewBox.split(' ').map(Number)
  const inView = (x: number, y: number): boolean => Number.isFinite(x) && Number.isFinite(y)
    && x >= viewX! - 0.01 && x <= viewX! + viewWidth! + 0.01
    && y >= viewY! - 0.01 && y <= viewY! + viewHeight! + 0.01
  const serviceBoxes = cards.map(item => record(item))
  const overlaps = (a: Readonly<Record<string, FidelityJson>>, b: Readonly<Record<string, FidelityJson>>): boolean =>
    typeof a.x === 'number' && typeof a.y === 'number'
    && typeof a.width === 'number' && typeof a.height === 'number'
    && typeof b.x === 'number' && typeof b.y === 'number'
    && typeof b.width === 'number' && typeof b.height === 'number'
    && a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01
    && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01
  for (const [index, expected] of spec.services.entries()) {
    const card = cardMap.get(expected.id)
    if (!card || typeof card.x !== 'number' || typeof card.y !== 'number'
      || typeof card.width !== 'number' || typeof card.height !== 'number'
      || !inView(card.x, card.y) || !inView(card.x + card.width, card.y + card.height)
      || card.width <= 0 || card.height <= 0
      || serviceBoxes.slice(index + 1).some(other => overlaps(card, other))) return false
  }
  const frameMap = new Map(frames.map(item => {
    const frame = record(item)
    return [frame.id, frame]
  }))
  const groupFrames = frames.map(item => record(item))
  for (const [index, expected] of spec.groups.entries()) {
    const frame = groupFrames[index]!
    if (frame.id !== expected.id || typeof frame.x !== 'number' || typeof frame.y !== 'number'
      || typeof frame.width !== 'number' || typeof frame.height !== 'number'
      || !inView(frame.x, frame.y) || !inView(frame.x + frame.width, frame.y + frame.height)
      || frame.width <= 0 || frame.height <= 0
      || groupFrames.slice(index + 1).some(other => overlaps(frame, other))) return false
  }
  for (const service of spec.services) {
    if (!service.parentId) continue
    const card = cardMap.get(service.id)!
    const frame = frameMap.get(service.parentId)
    if (!frame || typeof frame.x !== 'number' || typeof frame.y !== 'number'
      || typeof frame.width !== 'number' || typeof frame.height !== 'number'
      || typeof card.x !== 'number' || typeof card.y !== 'number'
      || typeof card.width !== 'number' || typeof card.height !== 'number'
      || card.x < frame.x || card.y < frame.y
      || card.x + card.width > frame.x + frame.width
      || card.y + card.height > frame.y + frame.height) return false
  }
  const anchor = (id: string, side: string): readonly [number, number] | null => {
    const card = cardMap.get(id)
    if (!card || typeof card.x !== 'number' || typeof card.y !== 'number'
      || typeof card.width !== 'number' || typeof card.height !== 'number') return null
    if (side === 'L') return [card.x, card.y + card.height / 2]
    if (side === 'R') return [card.x + card.width, card.y + card.height / 2]
    if (side === 'T') return [card.x + card.width / 2, card.y]
    if (side === 'B') return [card.x + card.width / 2, card.y + card.height]
    return null
  }
  const near = (a: number, b: number): boolean => Number.isFinite(a) && Math.abs(a - b) <= 0.01
  const crossesInterior = (a: readonly number[], b: readonly number[], box: Readonly<Record<string, FidelityJson>>): boolean => {
    if (typeof box.x !== 'number' || typeof box.y !== 'number'
      || typeof box.width !== 'number' || typeof box.height !== 'number') return true
    if (near(a[1]!, b[1]!)) return a[1]! > box.y + 0.01 && a[1]! < box.y + box.height - 0.01
      && Math.min(a[0]!, b[0]!) < box.x + box.width - 0.01
      && Math.max(a[0]!, b[0]!) > box.x + 0.01
    if (near(a[0]!, b[0]!)) return a[0]! > box.x + 0.01 && a[0]! < box.x + box.width - 0.01
      && Math.min(a[1]!, b[1]!) < box.y + box.height - 0.01
      && Math.max(a[1]!, b[1]!) > box.y + 0.01
    return true
  }
  for (const [index, expected] of spec.edges.entries()) {
    const edge = record(edges[index]!)
    if (edge.source !== expected.source || edge.sourceSide !== expected.sourceSide
      || edge.target !== expected.target || edge.targetSide !== expected.targetSide
      || edge.direction !== 'forward' || edge.markerStart !== null
      || edge.markerEnd !== 'url(#architecture-arrow-end)'
      || typeof edge.points !== 'string') return false
    const points = svgPoints(edge.points)
    const from = anchor(expected.source, expected.sourceSide)
    const to = anchor(expected.target, expected.targetSide)
    if (!from || !to || !points || points.some(point => !inView(point[0], point[1]))) return false
    const first = points[0]!
    const last = points.at(-1)!
    if (!near(first[0]!, from[0]) || !near(first[1]!, from[1])
      || !near(last[0]!, to[0]) || !near(last[1]!, to[1])
      || points.slice(1).some((point, i) => !near(point[0]!, points[i]![0]!)
        && !near(point[1]!, points[i]![1]!))
      || serviceBoxes.some(box => points.slice(1).some((point, i) =>
        crossesInterior(points[i]!, point, box)))) return false
  }
  return true
}
export const fidelityCases: readonly FidelityCaseDefinition[] = specs.map(spec => ({
  id: 'architecture.official.fence-' + spec.index, family: 'architecture', featureId: spec.featureId,
  source: sources[spec.index]!, upstreamReference: examples[spec.index]!.officialDocs
    ?? 'https://mermaid.ai/open-source/syntax/architecture.html',
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => same(facts(evidence), expectedModel(spec)) ? 'native' : 'absent' },
    // All three have non-upstream filled/solid card paint. Additionally the
    // grid example places `analyst` below its explicitly row-aligned peers.
    render: { applicability: 'applicable', disposition: 'absent',
      evaluate: evidence => renderMatches(evidence, spec) ? 'absent' : 'source-preserved' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.stable === true && same(observed.model, expectedModel(spec)) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'This case classifies official source examples; typed Architecture mutations have separate operation tests.' },
  },
  observe: () => {
    const source = sources[spec.index]!
    const { verified, serialized, stable } = checkedRoundTrip(source, 'architecture', 'Pinned Architecture align fence')
    return {
      agent: { status: 'observed' as const, diagnosticCodes: verified.warnings.map(warning => warning.code),
        semantics: modelFacts(source) },
      render: { status: 'observed' as const, diagnosticCodes: [],
        semantics: renderFacts(renderMermaidSVG(source), spec.alignments) },
      serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable } },
    }
  },
}))
