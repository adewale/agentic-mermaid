import { createHash } from 'node:crypto'
import { parseRegisteredMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import { attrs, checkedRoundTrip, facts, officialFences, record, same, svgPoints, tags } from '../case-helpers.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const { sources, examples } = officialFences('architecture.md')
const source = sources[5]!
const groups = [{ id: 'api', label: 'API', icon: 'logos:aws-lambda', parentId: null }]
const services = [
  { id: 'db', label: 'Database', icon: 'logos:aws-aurora', parentId: 'api' },
  { id: 'disk1', label: 'Storage', icon: 'logos:aws-glacier', parentId: 'api' },
  { id: 'disk2', label: 'Storage', icon: 'logos:aws-s3', parentId: 'api' },
  { id: 'server', label: 'Server', icon: 'logos:aws-ec2', parentId: 'api' },
]
const edges = [
  { source: 'db', sourceSide: 'L', target: 'server', targetSide: 'R' },
  { source: 'disk1', sourceSide: 'T', target: 'server', targetSide: 'B' },
  { source: 'disk2', sourceSide: 'T', target: 'db', targetSide: 'B' },
]
const expectedModel = {
  groups, services, junctions: [], alignments: [],
  edges: edges.map(edge => ({ ...edge, sourceBoundary: 'item', targetBoundary: 'item',
    label: null, hasArrowStart: false, hasArrowEnd: false })),
}
const glyphs = [
  { icon: 'logos:aws-lambda', pathSha256: '2da9bb173c1a79c0104b92b2eeb1b870a603c4138096ccf3011340f388e5f580' },
  { icon: 'logos:aws-aurora', pathSha256: '1377d326e78e01aa4a3ece4b6e2a2faff0c2e95b43dc913efb9b399754eca8e7' },
  { icon: 'logos:aws-glacier', pathSha256: '5fe0ca13506971b9c57fb848480d957b1521ce919a9704af86e4d72c4dc921ca' },
  { icon: 'logos:aws-s3', pathSha256: 'b93588b414e0aa1130a8bf3facad1125f16c8904c3a4ea8763547a9f99e9894a' },
  { icon: 'logos:aws-ec2', pathSha256: '357fa789c74d3f9eeb5ff84acb31b73ab07b4041eb30ac484c02c169979e2bea' },
]
function modelFacts(input: string): FidelityJson {
  const parsed = parseRegisteredMermaid(input)
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
function renderFacts(svg: string): FidelityJson {
  const iconElements = [...svg.matchAll(/<g\b([^>]*\bclass="architecture-icon"[^>]*)>([\s\S]*?)<\/g>/g)]
  return {
    svgSha256: createHash('sha256').update(svg).digest('hex'),
    viewBox: svg.match(/<svg\b[^>]*viewBox="([^"]+)"/)?.[1] ?? null,
    groups: tags(svg, 'g', 'architecture-group').map(item => ({ id: item['data-id'] ?? null, label: item['data-label'] ?? null })),
    services: tags(svg, 'g', 'architecture-service').map(item => ({ id: item['data-id'] ?? null, label: item['data-label'] ?? null })),
    cards: tags(svg, 'rect', 'architecture-service-card').map(item => ({ id: item['data-id'] ?? null,
      x: Number(item.x), y: Number(item.y), width: Number(item.width), height: Number(item.height) })),
    frames: tags(svg, 'rect', 'architecture-group-frame').map(item => ({ id: item['data-id'] ?? null,
      x: Number(item.x), y: Number(item.y), width: Number(item.width), height: Number(item.height) })),
    edges: tags(svg, 'polyline', 'architecture-edge').map(item => ({ source: item['data-from'] ?? null,
      target: item['data-to'] ?? null, sourceSide: item['data-from-side'] ?? null,
      targetSide: item['data-to-side'] ?? null, points: item.points ?? null })),
    glyphs: iconElements.map(match => {
      const item = attrs(match[1]!)
      const paths = tags(match[2]!, 'path', 'architecture-icon-glyph')
      return { icon: item['data-icon'] ?? null, source: item['data-icon-source'] ?? null,
        license: item['data-icon-license'] ?? null,
        pathCount: paths.length,
        pathSha256: paths.length === 1 ? createHash('sha256').update(paths[0]!.d ?? '').digest('hex') : null,
        fallback: match[2]!.includes('architecture-icon-fallback') }
    }),
    groupFramePaint: svg.match(/\.architecture-group-frame \{([^}]*)\}/)?.[1]?.trim() ?? null,
    serviceCardPaint: svg.match(/\.architecture-service-card \{([^}]*)\}/)?.[1]?.trim() ?? null,
  }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence): boolean {
  const observed = facts(evidence)
  if (observed.svgSha256 !== 'a2ea32308a347d92043218e59a361047693c2914be8d5254e9b1d1e84786f224'
    || observed.viewBox !== '0 0 721.0139999999999 442'
    || !same(observed.groups, groups.map(group => ({ id: group.id, label: group.label })))
    || !same(observed.services, services.map(service => ({ id: service.id, label: service.label })))
    || !same(observed.glyphs, glyphs.map(glyph => ({ ...glyph, source: '@iconify-json/mdi@1.2.3',
      license: 'Apache-2.0', pathCount: 1, fallback: false })))
    // Local aliases use curated MDI glyphs rather than the registered Iconify logos pack;
    // the pinned Mermaid 11.16 cards are unfilled and dashed, not filled and solid.
    || typeof observed.groupFramePaint !== 'string' || !observed.groupFramePaint.includes('fill: #')
    || typeof observed.serviceCardPaint !== 'string' || !observed.serviceCardPaint.includes('fill: #')) return false
  if (!Array.isArray(observed.edges) || observed.edges.length !== edges.length
    || !Array.isArray(observed.cards) || observed.cards.length !== services.length
    || !Array.isArray(observed.frames) || observed.frames.length !== 1) return false
  const frame = record(observed.frames[0]!)
  const cards = observed.cards.map(item => record(item))
  const inView = (x: number, y: number): boolean => Number.isFinite(x) && Number.isFinite(y)
    && x >= 0 && y >= 0 && x <= 721.014 && y <= 442
  const overlaps = (a: Readonly<Record<string, FidelityJson>>, b: Readonly<Record<string, FidelityJson>>): boolean =>
    typeof a.x === 'number' && typeof a.y === 'number'
    && typeof a.width === 'number' && typeof a.height === 'number'
    && typeof b.x === 'number' && typeof b.y === 'number'
    && typeof b.width === 'number' && typeof b.height === 'number'
    && a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01
    && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01
  if (frame.id !== 'group-frame:api' || typeof frame.x !== 'number'
    || typeof frame.y !== 'number' || typeof frame.width !== 'number'
    || typeof frame.height !== 'number' || frame.width <= 0 || frame.height <= 0
    || !inView(frame.x, frame.y) || !inView(frame.x + frame.width, frame.y + frame.height)) return false
  for (const [index, box] of cards.entries()) {
    if (box.id !== 'service-card:' + services[index]!.id || typeof box.x !== 'number'
      || typeof box.y !== 'number' || typeof box.width !== 'number' || typeof box.height !== 'number'
      || box.width <= 0 || box.height <= 0 || !inView(box.x, box.y)
      || !inView(box.x + box.width, box.y + box.height)
      || typeof frame.x !== 'number' || typeof frame.y !== 'number'
      || typeof frame.width !== 'number' || typeof frame.height !== 'number'
      || box.x < frame.x || box.y < frame.y
      || box.x + box.width > frame.x + frame.width || box.y + box.height > frame.y + frame.height
      || cards.slice(index + 1).some(other => overlaps(box, other))) return false
  }
  const near = (left: number, right: number): boolean => Number.isFinite(left) && Math.abs(left - right) <= 0.01
  const anchor = (id: string, side: string): readonly [number, number] | null => {
    const box = cards.find(item => item.id === 'service-card:' + id)
    if (!box || typeof box.x !== 'number' || typeof box.y !== 'number'
      || typeof box.width !== 'number' || typeof box.height !== 'number') return null
    if (side === 'L') return [box.x, box.y + box.height / 2]
    if (side === 'R') return [box.x + box.width, box.y + box.height / 2]
    if (side === 'T') return [box.x + box.width / 2, box.y]
    if (side === 'B') return [box.x + box.width / 2, box.y + box.height]
    return null
  }
  const crossesCard = (a: readonly number[], b: readonly number[], box: Readonly<Record<string, FidelityJson>>): boolean => {
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
  for (const [index, expected] of edges.entries()) {
    const edge = record(observed.edges[index]!)
    if (edge.source !== expected.source || edge.target !== expected.target
      || edge.sourceSide !== expected.sourceSide || edge.targetSide !== expected.targetSide
      || typeof edge.points !== 'string') return false
    const points = svgPoints(edge.points)
    const start = anchor(expected.source, expected.sourceSide)
    const end = anchor(expected.target, expected.targetSide)
    if (!start || !end || !points
      || points.some(point => !inView(point[0], point[1]))
      || !near(points[0]![0]!, start[0]) || !near(points[0]![1]!, start[1])
      || !near(points.at(-1)![0]!, end[0]) || !near(points.at(-1)![1]!, end[1])
      || points.slice(1).some((point, i) => !near(point[0]!, points[i]![0]!)
        && !near(point[1]!, points[i]![1]!))
      || cards.some(box => points.slice(1).some((point, i) => crossesCard(points[i]!, point, box)))) return false
  }
  return true
}

export const fidelityCases: readonly FidelityCaseDefinition[] = [{
  id: 'architecture.official.fence-5', family: 'architecture',
  featureId: 'official-doc:architecture:section:icons', source,
  upstreamReference: examples[5]!.officialDocs ?? 'https://mermaid.ai/open-source/syntax/architecture.html',
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => same(facts(evidence), expectedModel) ? 'native' : 'absent' },
    // The source models correctly, but local MDI alias glyphs and solid filled
    // cards do not reproduce the registered logos pack or Mermaid 11.16 paint.
    render: { applicability: 'applicable', disposition: 'absent',
      evaluate: evidence => renderMatches(evidence) ? 'absent' : 'source-preserved' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const observed = facts(evidence)
      return observed.stable === true && same(observed.model, expectedModel) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'The pinned official icon example has no mutation operation; icon mutations have separate contracts.' },
  },
  observe: () => {
    const { verified, serialized, stable } = checkedRoundTrip(source, 'architecture', 'Pinned Architecture icon fence')
    if (verified.warnings.length) throw new Error('Pinned Architecture icon fence must verify without warnings')
    return {
      agent: { status: 'observed' as const, diagnosticCodes: [], semantics: modelFacts(source) },
      render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source)) },
      serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable } },
    }
  },
}]
