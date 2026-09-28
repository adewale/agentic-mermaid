import { createHash } from 'node:crypto'
import { parseRegisteredMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import { checkedRoundTrip, classTexts, cssRule, facts, officialFences, record, same, svgPoints, tags } from '../case-helpers.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// The paired example/preview blocks are six distinct executable sources.
// This narrow slice covers the basic grouped-services example and junction fan-in.
const { sources, examples } = officialFences('architecture.md')

type Group = Readonly<{ id: string; label: string; icon: string }>
type Service = Readonly<{ id: string; label: string; icon: string; parentId: string | null }>
type Edge = Readonly<{ source: string; sourceSide: string; target: string; targetSide: string }>
type Spec = Readonly<{
  index: 0 | 4
  featureId: string
  groups: readonly Group[]
  services: readonly Service[]
  junctions: readonly string[]
  edges: readonly Edge[]
  svgSha256: string
  viewBox: string
}>
const coreEdges: readonly Edge[] = [
  { source: 'db', sourceSide: 'L', target: 'server', targetSide: 'R' },
  { source: 'disk1', sourceSide: 'T', target: 'server', targetSide: 'B' },
  { source: 'disk2', sourceSide: 'T', target: 'db', targetSide: 'B' },
]
const specs: readonly Spec[] = [
  { index: 0, featureId: 'official-doc:architecture:section:example',
    groups: [{ id: 'api', label: 'API', icon: 'cloud' }],
    services: [
      { id: 'db', label: 'Database', icon: 'database', parentId: 'api' },
      { id: 'disk1', label: 'Storage', icon: 'disk', parentId: 'api' },
      { id: 'disk2', label: 'Storage', icon: 'disk', parentId: 'api' },
      { id: 'server', label: 'Server', icon: 'server', parentId: 'api' },
    ], junctions: [], edges: coreEdges,
    svgSha256: '731ec2739af56c171a9fce767c97f83e711133c9dd78db9a8e0bc14c33b68836',
    viewBox: '0 0 721.0139999999999 442' },
  { index: 4, featureId: 'official-doc:architecture:section:junctions', groups: [],
    services: [
      { id: 'left_disk', label: 'Disk', icon: 'disk', parentId: null },
      { id: 'top_disk', label: 'Disk', icon: 'disk', parentId: null },
      { id: 'bottom_disk', label: 'Disk', icon: 'disk', parentId: null },
      { id: 'top_gateway', label: 'Gateway', icon: 'internet', parentId: null },
      { id: 'bottom_gateway', label: 'Gateway', icon: 'internet', parentId: null },
    ], junctions: ['junctionCenter', 'junctionRight'], edges: [
      { source: 'left_disk', sourceSide: 'R', target: 'junctionCenter', targetSide: 'L' },
      { source: 'top_disk', sourceSide: 'B', target: 'junctionCenter', targetSide: 'T' },
      { source: 'bottom_disk', sourceSide: 'T', target: 'junctionCenter', targetSide: 'B' },
      { source: 'junctionCenter', sourceSide: 'R', target: 'junctionRight', targetSide: 'L' },
      { source: 'top_gateway', sourceSide: 'B', target: 'junctionRight', targetSide: 'T' },
      { source: 'bottom_gateway', sourceSide: 'T', target: 'junctionRight', targetSide: 'B' },
    ], svgSha256: 'd55fb62161a4e62e5de6f92ccb760af047c351b24b73f24488470a00fd2ac11f',
    viewBox: '0 0 964.6759999999999 592' },
]
function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'architecture') {
    return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  }
  const body = parsed.value.body
  return {
    groups: body.groups.map(group => ({ id: group.id, label: group.label, icon: group.icon ?? null,
      parentId: group.parentId ?? null })),
    services: body.services.map(service => ({ id: service.id, label: service.label, icon: service.icon ?? null,
      parentId: service.parentId ?? null })),
    junctions: body.junctions.map(junction => ({ id: junction.id, parentId: junction.parentId ?? null })),
    edges: body.edges.map(edge => ({ source: edge.source.id, sourceSide: edge.source.side,
      sourceBoundary: edge.source.boundary ?? 'item', target: edge.target.id,
      targetSide: edge.target.side, targetBoundary: edge.target.boundary ?? 'item',
      label: edge.label ?? null, hasArrowStart: edge.hasArrowStart, hasArrowEnd: edge.hasArrowEnd })),
    alignments: (body.alignments ?? []).map(alignment => ({ axis: alignment.axis, members: [...alignment.members] })),
  }
}
function expectedModel(spec: Spec): FidelityJson {
  return {
    groups: spec.groups.map(group => ({ ...group, parentId: null })),
    services: spec.services,
    junctions: spec.junctions.map(id => ({ id, parentId: null })),
    edges: spec.edges.map(edge => ({ ...edge, sourceBoundary: 'item', targetBoundary: 'item',
      label: null, hasArrowStart: false, hasArrowEnd: false })),
    alignments: [],
  }
}
function renderFacts(svg: string): FidelityJson {
  const groups = tags(svg, 'g', 'architecture-group').map(item => ({ id: item['data-id'] ?? null,
    label: item['data-label'] ?? null, role: item['data-role'] ?? null }))
  const services = tags(svg, 'g', 'architecture-service').map(item => ({ id: item['data-id'] ?? null,
    label: item['data-label'] ?? null, role: item['data-role'] ?? null }))
  const junctions = tags(svg, 'g', 'architecture-junction').map(item => ({ id: item['data-id'] ?? null,
    role: item['data-role'] ?? null }))
  const edges = tags(svg, 'polyline', 'architecture-edge').map(item => ({
    source: item['data-from'] ?? null, target: item['data-to'] ?? null,
    sourceSide: item['data-from-side'] ?? null, targetSide: item['data-to-side'] ?? null,
    sourceBoundary: item['data-from-boundary'] ?? null, targetBoundary: item['data-to-boundary'] ?? null,
    direction: item['data-direction'] ?? null, role: item['data-role'] ?? null,
    points: item.points ?? null,
  }))
  const frames = tags(svg, 'rect', 'architecture-group-frame').map(item => ({
    id: item['data-id'] ?? null, x: Number(item.x), y: Number(item.y),
    width: Number(item.width), height: Number(item.height) }))
  const cards = tags(svg, 'rect', 'architecture-service-card').map(item => ({
    id: item['data-id'] ?? null, x: Number(item.x), y: Number(item.y),
    width: Number(item.width), height: Number(item.height) }))
  const cores = tags(svg, 'circle', 'architecture-junction-core').map(item => ({
    id: item['data-id'] ?? null, x: Number(item.cx), y: Number(item.cy), radius: Number(item.r) }))
  const rings = tags(svg, 'circle', 'architecture-junction-ring').map(item => ({
    id: item['data-id'] ?? null, x: Number(item.cx), y: Number(item.cy), radius: Number(item.r) }))
  return { viewBox: svg.match(/<svg\b[^>]*viewBox="([^"]+)"/)?.[1] ?? null,
    svgSha256: createHash('sha256').update(svg).digest('hex'), groups, services, junctions, edges,
    frames, cards, cores, rings, icons: tags(svg, 'g', 'architecture-icon').map(item => item['data-icon'] ?? null),
    groupLabels: classTexts(svg, 'architecture-group-label'),
    serviceLabels: classTexts(svg, 'architecture-service-label'),
    groupFramePaint: cssRule(svg, 'architecture-group-frame'),
    groupOutlinePaint: cssRule(svg, 'architecture-group-outline'),
    serviceCardPaint: cssRule(svg, 'architecture-service-card'),
    serviceOutlinePaint: cssRule(svg, 'architecture-service-outline'),
    junctionRingPaint: cssRule(svg, 'architecture-junction-ring'),
    junctionCorePaint: cssRule(svg, 'architecture-junction-core') }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence, spec: Spec): boolean {
  const observed = facts(evidence)
  const paintedFill = (rule: FidelityJson | undefined): boolean =>
    typeof rule === 'string' && /^fill: #[0-9a-f]{6};/i.test(rule)
  if (observed.viewBox !== spec.viewBox || observed.svgSha256 !== spec.svgSha256
    || !same(observed.groups, spec.groups.map(group => ({ id: group.id, label: group.label, role: 'group' })))
    || !same(observed.services, spec.services.map(service => ({ id: service.id, label: service.label, role: 'service' })))
    || !same(observed.junctions, spec.junctions.map(id => ({ id, role: 'junction' })))
    || !same(observed.icons, [...spec.groups, ...spec.services].map(item => item.icon))
    || !same(observed.groupLabels, spec.groups.map(group => group.label))
    || !same(observed.serviceLabels, spec.services.map(service => service.label))
    // Pinned Mermaid 11.16 paints unfilled dashed node/group backgrounds;
    // local filled cards and solid outlines are an observed render divergence.
    || !paintedFill(observed.groupFramePaint)
    || typeof observed.groupOutlinePaint !== 'string' || observed.groupOutlinePaint.includes('stroke-dasharray')
    || !paintedFill(observed.serviceCardPaint)
    || typeof observed.serviceOutlinePaint !== 'string' || observed.serviceOutlinePaint.includes('stroke-dasharray')
    || !paintedFill(observed.junctionRingPaint) || !paintedFill(observed.junctionCorePaint)) return false
  const edges = observed.edges
  const frames = observed.frames
  const cards = observed.cards
  const cores = observed.cores
  const rings = observed.rings
  if (!Array.isArray(edges) || edges.length !== spec.edges.length
    || !Array.isArray(frames) || frames.length !== spec.groups.length
    || !Array.isArray(cards) || cards.length !== spec.services.length
    || !Array.isArray(cores) || cores.length !== spec.junctions.length
    || !Array.isArray(rings) || rings.length !== spec.junctions.length) return false
  const [viewX, viewY, viewWidth, viewHeight] = spec.viewBox.split(' ').map(Number)
  const inView = (x: number, y: number): boolean => Number.isFinite(x) && Number.isFinite(y)
    && x >= viewX! - 0.01 && x <= viewX! + viewWidth! + 0.01
    && y >= viewY! - 0.01 && y <= viewY! + viewHeight! + 0.01
  const serviceBoxes = cards.map(item => record(item))
  const rectanglesOverlap = (a: Readonly<Record<string, FidelityJson>>, b: Readonly<Record<string, FidelityJson>>): boolean =>
    typeof a.x === 'number' && typeof a.y === 'number'
    && typeof a.width === 'number' && typeof a.height === 'number'
    && typeof b.x === 'number' && typeof b.y === 'number'
    && typeof b.width === 'number' && typeof b.height === 'number'
    && a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01
    && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01
  for (const [index, box] of serviceBoxes.entries()) {
    if (typeof box.x !== 'number' || typeof box.y !== 'number'
      || typeof box.width !== 'number' || typeof box.height !== 'number'
      || !inView(box.x, box.y) || !inView(box.x + box.width, box.y + box.height)
      || box.width <= 0 || box.height <= 0
      || serviceBoxes.slice(index + 1).some(other => rectanglesOverlap(box, other))) return false
  }
  for (const [index, junctionId] of spec.junctions.entries()) {
    const core = record(cores[index]!)
    const ring = record(rings[index]!)
    if (core.id !== 'junction-core:' + junctionId || ring.id !== 'junction-ring:' + junctionId
      || core.radius !== 4.5 || ring.radius !== 8
      || typeof core.x !== 'number' || typeof core.y !== 'number'
      || core.x !== ring.x || core.y !== ring.y || !inView(core.x - 14, core.y - 14)
      || !inView(core.x + 14, core.y + 14)) return false
  }
  const boxes = new Map<string, Readonly<Record<string, FidelityJson>>>()
  for (const item of [...frames, ...cards, ...cores]) {
    const box = record(item)
    if (typeof box.id !== 'string') return false
    boxes.set(box.id.replace(/^(group-frame:|service-card:|junction-core:)/, ''), box)
  }
  const near = (left: number, right: number): boolean => Number.isFinite(left) && Math.abs(left - right) <= 0.01
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
  const anchor = (id: string, side: string): readonly [number, number] | null => {
    const box = boxes.get(id)
    if (!box || typeof box.x !== 'number' || typeof box.y !== 'number') return null
    const { x, y } = box
    if (id.startsWith('junction')) {
      if (side === 'L') return [x - 14, y]
      if (side === 'R') return [x + 14, y]
      if (side === 'T') return [x, y - 14]
      if (side === 'B') return [x, y + 14]
    }
    if (typeof box.width !== 'number' || typeof box.height !== 'number') return null
    if (side === 'L') return [x, y + box.height / 2]
    if (side === 'R') return [x + box.width, y + box.height / 2]
    if (side === 'T') return [x + box.width / 2, y]
    if (side === 'B') return [x + box.width / 2, y + box.height]
    return null
  }
  for (const [index, expected] of spec.edges.entries()) {
    const edge = record(edges[index]!)
    if (edge.source !== expected.source || edge.target !== expected.target
      || edge.sourceSide !== expected.sourceSide || edge.targetSide !== expected.targetSide
      || edge.sourceBoundary !== 'item' || edge.targetBoundary !== 'item'
      || edge.direction !== 'undirected' || edge.role !== 'edge'
      || typeof edge.points !== 'string') return false
    const points = svgPoints(edge.points)
    if (!points || points.some(point => !inView(point[0], point[1]))) return false
    const sourceAnchor = anchor(expected.source, expected.sourceSide)
    const targetAnchor = anchor(expected.target, expected.targetSide)
    const first = points[0]!
    const last = points.at(-1)!
    if (!sourceAnchor || !targetAnchor || !near(first[0]!, sourceAnchor[0]) || !near(first[1]!, sourceAnchor[1])
      || !near(last[0]!, targetAnchor[0]) || !near(last[1]!, targetAnchor[1])
      || points.slice(1).some((point, i) => !near(point[0]!, points[i]![0]!)
        && !near(point[1]!, points[i]![1]!))
      || serviceBoxes.some(box => points.slice(1).some((point, i) =>
        crossesInterior(points[i]!, point, box)))) return false
  }
  if (spec.groups.length) {
    const frame = record(frames[0]!)
    if (spec.services.some(service => {
      const box = boxes.get(service.id)
      return !box || typeof box.x !== 'number' || typeof box.y !== 'number'
        || typeof box.width !== 'number' || typeof box.height !== 'number'
        || typeof frame.x !== 'number' || typeof frame.y !== 'number'
        || typeof frame.width !== 'number' || typeof frame.height !== 'number'
        || box.x < frame.x || box.y < frame.y || box.x + box.width > frame.x + frame.width
        || box.y + box.height > frame.y + frame.height
    })) return false
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
    // Mermaid 11.16 uses unfilled dashed cards; its junctions have only an
    // invisible rect. The local renderer paints filled solid cards and visible
    // junction rings/cores, with links 6px short of those rings.
    render: { applicability: 'applicable', disposition: 'absent',
      evaluate: evidence => renderMatches(evidence, spec) ? 'absent' : 'source-preserved' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.stable === true && same(observed.model, expectedModel(spec)) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'These cases classify pinned official sources; architecture mutation operations have separate tests.' },
  },
  observe: () => {
    const source = sources[spec.index]!
    const { verified, serialized, stable } = checkedRoundTrip(source, 'architecture', 'Pinned Architecture fence')
    return {
      agent: { status: 'observed' as const, diagnosticCodes: verified.warnings.map(warning => warning.code),
        semantics: modelFacts(source) },
      render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source)) },
      serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable } },
    }
  },
}))
