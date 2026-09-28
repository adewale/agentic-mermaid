import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// This slice reviews the four short CSV grammar fences. The large energy
// example and the three configuration fences remain separate review work.
const page = readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'skills/agentic-mermaid-diagram-workflow/references/upstream/sankey.md'), 'utf8')
const sources = [...page.matchAll(/^```mermaid(?:-example)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*$/gm)]
  .map(match => match[1]!.trim()).filter((source, index, all) => all.indexOf(source) === index)
const examples = UPSTREAM_MERMAID_MANIFEST.semanticInventory.examples
  .filter(example => example.origin === 'official-syntax/sankey.md' && example.family === 'sankey')
  .sort((left, right) => left.index - right.index)
if (sources.length !== 8 || examples.length !== 8) throw new Error('Pinned Sankey fence inventory changed; review every fence')
for (const [index, source] of sources.entries()) {
  if (examples[index]!.id !== `sankey:official-syntax/sankey.md#${index}`
    || examples[index]!.sourceSha256 !== createHash('sha256').update(source).digest('hex')) {
    throw new Error(`Pinned Sankey fence ${index} differs from the manifest`)
  }
}

type Link = Readonly<{ source: string; target: string; value: number }>
type Spec = Readonly<{ index: number; featureId: string; links: readonly Link[] }>
const specs: readonly Spec[] = [
  { index: 1, featureId: 'official-doc:sankey:section:basic', links: [
    { source: 'Electricity grid', target: 'Over generation / exports', value: 104.453 },
    { source: 'Electricity grid', target: 'Heating and cooling - homes', value: 113.726 },
    { source: 'Electricity grid', target: 'H2 conversion', value: 27.14 },
  ] },
  { index: 2, featureId: 'official-doc:sankey:section:empty-lines', links: [
    { source: 'Bio-conversion', target: 'Losses', value: 26.862 },
    { source: 'Bio-conversion', target: 'Solid', value: 280.322 },
    { source: 'Bio-conversion', target: 'Gas', value: 81.144 },
  ] },
  { index: 3, featureId: 'official-doc:sankey:section:commas', links: [
    { source: 'Pumped heat', target: 'Heating and cooling, homes', value: 193.026 },
    { source: 'Pumped heat', target: 'Heating and cooling, commercial', value: 70.672 },
  ] },
  { index: 4, featureId: 'official-doc:sankey:section:double-quotes', links: [
    { source: 'Pumped heat', target: 'Heating and cooling, "homes"', value: 193.026 },
    { source: 'Pumped heat', target: 'Heating and cooling, "commercial"', value: 70.672 },
  ] },
]
// These fences use the pinned default light theme. Keep the expected fills
// independent of the renderer so a near-monochrome palette cannot retain a
// visual-native claim merely by preserving distinct CSS strings.
const defaultNodePaints = ['#3b82f6', '#0d5ba5', '#5f79f2', '#0a5076'] as const

function record(value: FidelityJson | undefined): Readonly<Record<string, FidelityJson>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Sankey evidence must be an object')
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
  return value.replace(/&(quot|amp|lt|gt|apos|#39);/g, (_, entity: string) => ({
    quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", '#39': "'",
  })[entity]!)
}
function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)]
    .map(match => [match[1]!, decodeXml(match[2]!)]))
}
function elements(svg: string, tag: string, className: string): Record<string, string>[] {
  return [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(match => attrs(match[0]))
    .filter(item => (item.class ?? '').split(/\s+/).includes(className))
}
function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'sankey') return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  return { links: parsed.value.body.links.map(link => ({ source: link.source, target: link.target, value: link.value })) }
}
function pathFacts(d: string): FidelityJson {
  const number = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
  const match = d.match(new RegExp(`^M (${number}) (${number}) C (${number}) (${number}), (${number}) (${number}), (${number}) (${number})$`))
  if (!match) return { validShape: false }
  return { validShape: true, start: [Number(match[1]), Number(match[2])],
    control1: [Number(match[3]), Number(match[4])], control2: [Number(match[5]), Number(match[6])],
    end: [Number(match[7]), Number(match[8])] }
}
function renderFacts(svg: string): FidelityJson {
  const gradients = [...svg.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/g)]
    .map(match => ({ attributes: attrs(match[1]!), stops: [...match[2]!.matchAll(/<stop\b[^>]*>/g)]
      .map(stop => attrs(stop[0])) }))
  const labels = [...svg.matchAll(/<text\b([^>]*)class="sankey-node-label"([^>]*)>([\s\S]*?)<\/text>/g)]
    .map(match => ({ attributes: attrs(`${match[1]!} ${match[2]!}`), spans: [...match[3]!.matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>/g)]
      .map(line => ({ attributes: attrs(line[1]!), text: decodeXml(line[2]!) })) }))
  return {
    viewBox: svg.match(/<svg\b[^>]*viewBox="([^"]+)"/)?.[1] ?? null,
    links: elements(svg, 'path', 'sankey-link').map(link => ({
      source: link['data-source'] ?? null, target: link['data-target'] ?? null,
      value: Number(link['data-value']), id: link['data-id'] ?? null,
      role: link['data-role'] ?? null, relationship: link['data-relationship'] ?? null,
      direction: link['data-direction'] ?? null, stroke: link.stroke ?? null,
      fill: link.fill ?? null, width: Number(link['stroke-width']), opacity: link.opacity ?? null,
      style: link.style ?? null, path: pathFacts(link.d ?? ''),
    })),
    nodes: elements(svg, 'rect', 'sankey-node').map(node => ({
      label: node['data-label'] ?? null, id: node['data-id'] ?? null,
      role: node['data-role'] ?? null, value: Number(node['data-value']),
      x: Number(node.x), y: Number(node.y), width: Number(node.width), height: Number(node.height),
      fill: node.fill ?? null,
    })),
    labels: labels.map(label => ({ x: Number(label.attributes.x), y: Number(label.attributes.y),
      fill: label.attributes.fill ?? null, fontSize: Number(label.attributes['font-size']),
      anchor: label.attributes['text-anchor'] ?? null, lines: label.spans.map(span => span.text),
      linePositions: label.spans.map(span => ({ x: Number(span.attributes.x), dy: Number(span.attributes.dy) })) })),
    gradients: gradients.map(gradient => ({ id: gradient.attributes.id ?? null, units: gradient.attributes.gradientUnits ?? null,
      x1: Number(gradient.attributes.x1), y1: Number(gradient.attributes.y1), x2: Number(gradient.attributes.x2), y2: Number(gradient.attributes.y2),
      stops: gradient.stops.map(stop => ({ offset: stop.offset ?? null, color: stop['stop-color'] ?? null })) })),
  }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence, spec: Spec): boolean {
  const actual = semantic(evidence)
  const renderedLinks = actual.links
  const nodes = actual.nodes
  const labels = actual.labels
  const gradients = actual.gradients
  if (actual.viewBox !== '0 0 648 448' || !Array.isArray(renderedLinks) || renderedLinks.length !== spec.links.length
    || !Array.isArray(nodes) || !Array.isArray(labels) || !Array.isArray(gradients)
    || gradients.length !== spec.links.length) return false
  const expectedValues = new Map<string, { incoming: number; outgoing: number }>()
  for (const link of spec.links) {
    const source = expectedValues.get(link.source) ?? { incoming: 0, outgoing: 0 }
    source.outgoing += link.value
    expectedValues.set(link.source, source)
    const target = expectedValues.get(link.target) ?? { incoming: 0, outgoing: 0 }
    target.incoming += link.value
    expectedValues.set(link.target, target)
  }
  if (nodes.length !== expectedValues.size || labels.length !== expectedValues.size) return false
  // The source bar is the largest value in these one-source fences; using its
  // unrounded value avoids magnifying a small ribbon's two-decimal rounding.
  const sourceBar = record(nodes[0]!)
  const scale = Number(sourceBar.height) / Number(sourceBar.value)
  if (!Number.isFinite(scale) || scale <= 0 || Number(sourceBar.height) < 300) return false
  const renderedNodes = new Map<string, Readonly<Record<string, FidelityJson>>>()
  for (const [index, nodeValue] of nodes.entries()) {
    const node = record(nodeValue)
    const label = record(labels[index]!)
    if (typeof node.label !== 'string' || !expectedValues.has(node.label) || renderedNodes.has(node.label)
      || node.id !== node.label || node.role !== 'bar'
      || typeof node.x !== 'number' || typeof node.y !== 'number'
      || typeof node.height !== 'number' || node.width !== 10 || node.height <= 0
      || Math.abs(node.height - Math.max(expectedValues.get(node.label)!.incoming,
        expectedValues.get(node.label)!.outgoing) * scale) > 0.05
      || node.x < 0 || node.x + 10 > 648 || node.y < 0 || node.y + node.height > 448
      || node.fill !== defaultNodePaints[index]
      || typeof node.value !== 'number' || Math.abs(node.value - Math.max(
        expectedValues.get(node.label)!.incoming, expectedValues.get(node.label)!.outgoing)) > 0.001
      || typeof label.x !== 'number' || typeof label.y !== 'number'
      || label.x < 0 || label.x > 648 || label.y < 0 || label.y > 448
      || Math.abs(label.y - (node.y + node.height / 2)) > 0.02
      || label.x !== (node.x < 324 ? node.x + 16 : node.x - 6)
      || label.fill !== '#27272A' || label.fontSize !== 13
      || label.anchor !== (node.x < 324 ? 'start' : 'end')
      || !Array.isArray(label.lines) || label.lines.length !== 2
      || !Array.isArray(label.linePositions) || label.linePositions.length !== 2
      || label.lines[0] !== node.label || Math.abs(Number(label.lines[1]) - node.value) > 0.01) return false
    const firstLine = record(label.linePositions[0]!)
    const secondLine = record(label.linePositions[1]!)
    if (firstLine.x !== label.x || secondLine.x !== label.x
      || Math.abs(Number(firstLine.dy) + 3.9) > 0.01
      || Math.abs(Number(secondLine.dy) - 16.9) > 0.01
      || Number(label.y) + Number(firstLine.dy) < 0
      || Number(label.y) + Number(firstLine.dy) + Number(secondLine.dy) > 448) return false
    for (const previous of renderedNodes.values()) {
      if (node.x < Number(previous.x) + 10 && Number(previous.x) < node.x + 10
        && node.y < Number(previous.y) + Number(previous.height)
        && Number(previous.y) < node.y + node.height) return false
    }
    renderedNodes.set(node.label, node)
  }
  const ribbons = new Map<string, { start: number; end: number }[]>()
  const routes: { source: string; sy: number; ey: number }[] = []
  for (const [index, expected] of spec.links.entries()) {
    const link = record(renderedLinks[index]!)
    const path = record(link.path)
    const gradient = record(gradients[index]!)
    const source = renderedNodes.get(expected.source)!
    const target = renderedNodes.get(expected.target)!
    const start = path.start
    const end = path.end
    const control1 = path.control1
    const control2 = path.control2
    if (link.source !== expected.source || link.target !== expected.target || link.value !== expected.value
      || link.id !== `link:${expected.source}->${expected.target}` || link.role !== 'edge'
      || link.relationship !== 'flow' || link.direction !== 'forward'
      || link.stroke !== `url(#sankey-gradient-${index + 1})`
      || link.fill !== 'none'
      || link.opacity !== '0.5' || link.style !== 'mix-blend-mode:multiply'
      || typeof link.width !== 'number' || link.width <= 0 || !Number.isFinite(link.width)
      || Math.abs(link.width - expected.value * scale) > 0.05
      || path.validShape !== true || !Array.isArray(start) || !Array.isArray(end)
      || !Array.isArray(control1) || !Array.isArray(control2)
      || start.length !== 2 || end.length !== 2 || control1.length !== 2 || control2.length !== 2) return false
    const [sx, sy] = start as number[]
    const [ex, ey] = end as number[]
    const [c1x, c1y] = control1 as number[]
    const [c2x, c2y] = control2 as number[]
    const middle = (sx! + ex!) / 2
    if (sx !== Number(source.x) + 10 || ex !== target.x || sx! >= ex! || ex! - sx! < 500
      || sy! < Number(source.y) || sy! > Number(source.y) + Number(source.height)
      || ey! < Number(target.y) || ey! > Number(target.y) + Number(target.height)
      || c1x !== middle || c2x !== middle || c1y !== sy || c2y !== ey
      || gradient.id !== `sankey-gradient-${index + 1}` || gradient.units !== 'userSpaceOnUse'
      || gradient.x1 !== sx || gradient.y1 !== sy || gradient.x2 !== ex || gradient.y2 !== ey
      || !same(gradient.stops, [{ offset: '0%', color: source.fill }, { offset: '100%', color: target.fill }])) return false
    routes.push({ source: expected.source, sy: sy!, ey: ey! })
    for (const [node, center] of [[source, sy], [target, ey]] as const) {
      const start = center! - Number(link.width) / 2
      const end = center! + Number(link.width) / 2
      if (start < Number(node.y) - 0.05 || end > Number(node.y) + Number(node.height) + 0.05) return false
      const spans = ribbons.get(String(node.label)) ?? []
      spans.push({ start, end })
      ribbons.set(String(node.label), spans)
    }
  }
  for (const spans of ribbons.values()) {
    spans.sort((left, right) => left.start - right.start)
    if (spans.some((span, index) => index > 0 && span.start < spans[index - 1]!.end - 0.05)) return false
  }
  // In these one-source official examples, link order and target order agree.
  // A permutation of source slots must not introduce avoidable crossings.
  for (const [index, route] of routes.entries()) {
    for (const later of routes.slice(index + 1)) {
      if (route.source === later.source && (route.sy - later.sy) * (route.ey - later.ey) < 0) return false
    }
  }
  return true
}

export const fidelityCases: readonly FidelityCaseDefinition[] = specs.map(spec => {
  const source = sources[spec.index]!
  return {
    id: `sankey.official.fence-${spec.index}`, family: 'sankey', featureId: spec.featureId, source,
    upstreamReference: examples[spec.index]!.officialDocs ?? 'https://mermaid.ai/open-source/syntax/sankey.html',
    upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
    expected: {
      agent: { applicability: 'applicable', disposition: 'native',
        diagnosticCodes: spec.index === 1 ? ['COMMENT_DROPPED'] : [], evaluate: evidence =>
        same(semantic(evidence).links, spec.links) ? 'native' : 'absent' },
      render: { applicability: 'applicable', disposition: 'native', evaluate: evidence =>
        renderMatches(evidence, spec) ? 'native' : 'absent' },
      serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
        const facts = semantic(evidence)
        return facts.stable === true && same(facts.links, spec.links) ? 'native' : 'absent'
      } },
      mutate: { applicability: 'not-applicable', rationale: 'This case classifies official CSV syntax; link mutations have separate semantic receipts.' },
    },
    observe: () => {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok || parsed.value.body.kind !== 'sankey') throw new Error('Pinned official Sankey fence must parse')
      const verified = verifyMermaid(source)
      if (!verified.ok) throw new Error('Pinned official Sankey fence must verify')
      const serialized = serializeMermaid(parsed.value)
      const reparsed = parseRegisteredMermaid(serialized)
      if (!reparsed.ok) throw new Error('Pinned official Sankey fence must reparse')
      return {
        agent: { status: 'observed' as const, diagnosticCodes: verified.warnings.map(warning => warning.code), semantics: modelFacts(source) },
        render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source)) },
        serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
          links: record(modelFacts(serialized)).links!, stable: serializeMermaid(reparsed.value) === serialized } },
      }
    },
  }
})
