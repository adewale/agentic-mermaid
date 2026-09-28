import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// The 68-link, eight-layer official energy example is a separate large-fixture
// review. The page has eight distinct fences and every identity remains pinned.
const page = readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'skills/agentic-mermaid-diagram-workflow/references/upstream/sankey.md'), 'utf8')
const sources = [...page.matchAll(/^\x60{3}mermaid(?:-example)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n\x60{3}[^\S\r\n]*$/gm)]
  .map(match => match[1]!.trim()).filter((source, index, all) => all.indexOf(source) === index)
const examples = UPSTREAM_MERMAID_MANIFEST.semanticInventory.examples
  .filter(example => example.origin === 'official-syntax/sankey.md' && example.family === 'sankey')
  .sort((left, right) => left.index - right.index)
if (sources.length !== 8 || examples.length !== 8) throw new Error('Pinned Sankey fence inventory changed')
for (const [index, candidate] of sources.entries()) {
  if (examples[index]!.id !== 'sankey:official-syntax/sankey.md#' + index
    || examples[index]!.sourceSha256 !== createHash('sha256').update(candidate).digest('hex')) {
    throw new Error('Pinned Sankey fence ' + index + ' differs from the manifest')
  }
}
const source = sources[0]!
const body = source.split(/\r?\n/)
const header = body.findIndex(line => line.trim() === 'sankey')
if (header < 0) throw new Error('Pinned energy fence lost its header')
// This particular official fixture contains only unquoted, three-column CSV.
// Its independently split authored rows are the oracle for the agent parser.
const rows = body.slice(header + 1).map(line => line.trim()).filter(Boolean)
if (rows.length !== 68) throw new Error('Pinned energy fence link inventory changed')
const authoredLinks = rows.map(row => {
  const cells = row.split(',')
  if (cells.length !== 3 || !Number.isFinite(Number(cells[2]))) throw new Error('Pinned energy row changed')
  return { source: cells[0]!, target: cells[1]!, value: Number(cells[2]) }
})
const values = new Map<string, { incoming: number; outgoing: number }>()
for (const link of authoredLinks) {
  const from = values.get(link.source) ?? { incoming: 0, outgoing: 0 }
  from.outgoing += link.value
  values.set(link.source, from)
  const to = values.get(link.target) ?? { incoming: 0, outgoing: 0 }
  to.incoming += link.value
  values.set(link.target, to)
}
if (values.size !== 48) throw new Error('Pinned energy fence node inventory changed')
const authoredNodes = [...values.keys()]
const expectedLayers = new Map<string, number>()
// Default Sankey justify alignment places sinks at the last column; the
// remaining nodes take their longest-path depth from the authored DAG.
function depth(label: string, visiting = new Set<string>()): number {
  const cached = expectedLayers.get(label)
  if (cached !== undefined) return cached
  if (visiting.has(label)) throw new Error('Pinned energy fence contains a cycle')
  visiting.add(label)
  const parents = authoredLinks.filter(link => link.target === label)
  const result = parents.length ? Math.max(...parents.map(link => depth(link.source, visiting) + 1)) : 0
  visiting.delete(label)
  expectedLayers.set(label, result)
  return result
}
for (const label of authoredNodes) depth(label)
for (const label of authoredNodes) {
  if (!authoredLinks.some(link => link.source === label)) expectedLayers.set(label, 7)
}
if (Math.max(...expectedLayers.values()) !== 7) throw new Error('Pinned energy fence layers changed')
const expectedImbalances = authoredNodes.flatMap(label => {
  const totals = values.get(label)!
  return totals.incoming && totals.outgoing
    && Math.abs(totals.incoming - totals.outgoing) > 1e-9 * Math.max(1, totals.incoming, totals.outgoing)
    ? [{ node: label, inflow: totals.incoming, outflow: totals.outgoing }] : []
})
if (expectedImbalances.length !== 6) throw new Error('Pinned energy fence imbalances changed')
const paintsSha256 = 'cdc69d136fc76600e8d60f7e2d6be1e49e0ffc7d7e74314934e7f6aaa47fb1ab'
const textLengthsSha256 = '15a009c150f577ded681151f762190c61572626f1d152926565bab90ea51171f'
const stylesheetSha256 = '2a5f1233cf2a6f16fe619469307754651f511794d6ceec554185354b5e8c728f'
// This one fixed official fixture can additionally fail closed on any SVG
// structure change. The semantic checks below explain the claim; this digest
// prevents an unobserved wrapper or later CSS block from hiding its paint.
const svgSha256 = '9c8c72ae39db81dcee4f8c1f932ccdbd4bbcb12479736b1e2dede9bc91beb513'

function record(value: FidelityJson | undefined): Readonly<Record<string, FidelityJson>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Energy evidence must be an object')
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
  return [...svg.matchAll(new RegExp('<' + tag + '\\b[^>]*>', 'g'))].map(match => attrs(match[0]))
    .filter(item => (item.class ?? '').split(/\s+/).includes(className))
}
function pathFacts(d: string): FidelityJson {
  const number = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)'
  const pattern = new RegExp('^M (' + number + ') (' + number + ') C (' + number + ') (' + number
    + '), (' + number + ') (' + number + '), (' + number + ') (' + number + ')$')
  const match = d.match(pattern)
  if (!match) return { valid: false }
  return { valid: true, start: [Number(match[1]), Number(match[2])],
    control1: [Number(match[3]), Number(match[4])], control2: [Number(match[5]), Number(match[6])],
    end: [Number(match[7]), Number(match[8])] }
}
function modelFacts(candidate: string): FidelityJson {
  const parsed = parseRegisteredMermaid(candidate)
  if (!parsed.ok || parsed.value.body.kind !== 'sankey') return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  const frontmatter = record(parsed.value.meta.frontmatter as FidelityJson)
  return { config: record(frontmatter.sankey),
    links: parsed.value.body.links.map(link => ({ source: link.source, target: link.target, value: link.value })) }
}
function renderFacts(svg: string): FidelityJson {
  const labels = [...svg.matchAll(/<text\b([^>]*)class="sankey-node-label"([^>]*)>([^<]*)<\/text>/g)]
    .map(match => ({ attributes: attrs(match[1]! + ' ' + match[2]!), text: decodeXml(match[3]!) }))
  const gradients = [...svg.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/g)]
    .map(match => ({ attributes: attrs(match[1]!), stops: [...match[2]!.matchAll(/<stop\b[^>]*>/g)]
      .map(stop => attrs(stop[0])) }))
  return {
    viewBox: svg.match(/<svg\b[^>]*viewBox="([^"]+)"/)?.[1] ?? null,
    root: attrs(svg.match(/<svg\b[^>]*>/)?.[0] ?? ''),
    stylesheetSha256: createHash('sha256').update(svg.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '').digest('hex'),
    styleBlockCount: [...svg.matchAll(/<style\b/g)].length,
    groupCount: [...svg.matchAll(/<g\b/g)].length,
    svgSha256: createHash('sha256').update(svg).digest('hex'),
    nodes: elements(svg, 'rect', 'sankey-node').map(node => ({
      label: node['data-label'] ?? null, id: node['data-id'] ?? null, role: node['data-role'] ?? null,
      value: Number(node['data-value']), layer: Number(node['data-layer']),
      x: Number(node.x), y: Number(node.y), width: Number(node.width), height: Number(node.height), fill: node.fill ?? null,
      fillOpacity: node['fill-opacity'] ?? null, opacity: node.opacity ?? null,
      style: node.style ?? null, display: node.display ?? null, visibility: node.visibility ?? null,
      transform: node.transform ?? null,
    })),
    labels: labels.map(label => ({
      text: label.text, x: Number(label.attributes.x), y: Number(label.attributes.y),
      dy: Number(label.attributes.dy), anchor: label.attributes['text-anchor'] ?? null,
      fontSize: Number(label.attributes['font-size']), fill: label.attributes.fill ?? null,
      textLength: Number(label.attributes.textLength), lengthAdjust: label.attributes.lengthAdjust ?? null,
      opacity: label.attributes.opacity ?? null, fillOpacity: label.attributes['fill-opacity'] ?? null,
      display: label.attributes.display ?? null, visibility: label.attributes.visibility ?? null,
      style: label.attributes.style ?? null, transform: label.attributes.transform ?? null,
    })),
    links: elements(svg, 'path', 'sankey-link').map(link => ({
      source: link['data-source'] ?? null, target: link['data-target'] ?? null, value: Number(link['data-value']),
      id: link['data-id'] ?? null, role: link['data-role'] ?? null,
      relationship: link['data-relationship'] ?? null, direction: link['data-direction'] ?? null,
      path: pathFacts(link.d ?? ''), width: Number(link['stroke-width']), stroke: link.stroke ?? null,
      fill: link.fill ?? null, opacity: link.opacity ?? null, style: link.style ?? null,
      strokeOpacity: link['stroke-opacity'] ?? null, display: link.display ?? null, visibility: link.visibility ?? null,
      transform: link.transform ?? null,
    })),
    gradients: gradients.map(gradient => ({
      id: gradient.attributes.id ?? null, units: gradient.attributes.gradientUnits ?? null,
      x1: Number(gradient.attributes.x1), y1: Number(gradient.attributes.y1),
      x2: Number(gradient.attributes.x2), y2: Number(gradient.attributes.y2),
      stops: gradient.stops.map(stop => ({
        offset: stop.offset ?? null, color: stop['stop-color'] ?? null,
        opacity: stop['stop-opacity'] ?? null, style: stop.style ?? null,
      })),
    })),
  }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence): boolean {
  const facts = semantic(evidence)
  const nodes = facts.nodes
  const labels = facts.labels
  const links = facts.links
  const gradients = facts.gradients
  if (facts.viewBox !== '0 0 648 450.63'
    || !same(facts.root, { xmlns: 'http://www.w3.org/2000/svg', width: '648', height: '450.63',
      viewBox: '0 0 648 450.63', style: '--bg:#FFFFFF;--fg:#27272A;--font:Inter;background:#FFFFFF',
      'aria-roledescription': 'sankey diagram', role: 'img' })
    || facts.stylesheetSha256 !== stylesheetSha256
    || facts.styleBlockCount !== 1 || facts.groupCount !== 0 || facts.svgSha256 !== svgSha256
    || !Array.isArray(nodes) || nodes.length !== 48 || !Array.isArray(labels) || labels.length !== 48
    || !Array.isArray(links) || links.length !== 68 || !Array.isArray(gradients) || gradients.length !== 68) return false
  const nodeMap = new Map<string, Readonly<Record<string, FidelityJson>>>()
  const paints: string[] = []
  const lengths: number[] = []
  for (const [index, nodeValue] of nodes.entries()) {
    const node = record(nodeValue)
    const label = record(labels[index]!)
    const expected = authoredNodes[index]!
    const totals = values.get(expected)!
    const nodeValueExpected = Math.max(totals.incoming, totals.outgoing)
    if (node.label !== expected || node.id !== expected || node.role !== 'bar'
      || Math.abs(Number(node.value) - nodeValueExpected) > 0.001 || node.width !== 10
      || typeof node.layer !== 'number' || !Number.isInteger(node.layer)
      || node.layer !== expectedLayers.get(expected)
      || Math.abs(Number(node.x) - Math.round((24 + 590 * node.layer / 7) * 100) / 100) > 0.01
      || typeof node.y !== 'number' || typeof node.height !== 'number'
      || node.y < 0 || node.height <= 0 || node.y + node.height > 450.63
      || typeof node.fill !== 'string' || !/^#[0-9a-f]{6}$/.test(node.fill)
      || node.fillOpacity !== null || node.opacity !== null || node.style !== null
      || node.display !== null || node.visibility !== null || node.transform !== null
      || label.text !== expected || label.fill !== '#27272A' || label.fontSize !== 13
      || Math.abs(Number(label.y) - (Number(node.y) + Number(node.height) / 2)) > 0.02
      || label.x !== (Number(node.x) < 324 ? Number(node.x) + 16 : Number(node.x) - 6)
      || label.anchor !== (Number(node.x) < 324 ? 'start' : 'end')
      || label.dy !== 4.55 || label.lengthAdjust !== 'spacingAndGlyphs'
      || typeof label.textLength !== 'number' || label.textLength <= 0
      || (label.anchor === 'start' ? Number(label.x) + Number(label.textLength) > 648
        : Number(label.x) - Number(label.textLength) < 0)
      || label.opacity !== null || label.fillOpacity !== null
      || label.display !== null || label.visibility !== null || label.style !== null
      || label.transform !== null) return false
    nodeMap.set(expected, node)
    paints.push(node.fill)
    lengths.push(label.textLength)
  }
  if (createHash('sha256').update(JSON.stringify(paints)).digest('hex') !== paintsSha256
    || createHash('sha256').update(JSON.stringify(lengths)).digest('hex') !== textLengthsSha256) return false
  for (const [index, nodeValue] of nodes.entries()) {
    const node = record(nodeValue)
    for (const previousValue of nodes.slice(0, index)) {
      const previous = record(previousValue)
      if (node.layer === previous.layer
        && Number(node.y) < Number(previous.y) + Number(previous.height) - 0.05
        && Number(previous.y) < Number(node.y) + Number(node.height) - 0.05) return false
    }
  }
  // The fixed default chart has a 0.06055 px/unit baseline. Each rendered
  // ribbon has a 1px visibility floor, so node heights sum painted ribbons,
  // not simply the raw value times this scale.
  const scale = 0.06055
  for (const node of nodeMap.values()) {
    const label = String(node.label)
    const incoming = authoredLinks.filter(link => link.target === label)
      .reduce((sum, link) => sum + Math.max(1, link.value * scale), 0)
    const outgoing = authoredLinks.filter(link => link.source === label)
      .reduce((sum, link) => sum + Math.max(1, link.value * scale), 0)
    if (Math.abs(Number(node.height) - Math.max(1, incoming, outgoing)) > 0.12) return false
  }
  const ribbonSpans = new Map<string, { start: number; end: number }[]>()
  for (const [index, authored] of authoredLinks.entries()) {
    const link = record(links[index]!)
    const path = record(link.path)
    const gradient = record(gradients[index]!)
    const from = nodeMap.get(authored.source)!
    const to = nodeMap.get(authored.target)!
    const start = path.start
    const end = path.end
    const c1 = path.control1
    const c2 = path.control2
    if (link.source !== authored.source || link.target !== authored.target || link.value !== authored.value
      || link.id !== 'link:' + authored.source + '->' + authored.target
      || link.role !== 'edge' || link.relationship !== 'flow' || link.direction !== 'forward'
      || link.stroke !== 'url(#sankey-gradient-' + (index + 1) + ')' || link.fill !== 'none'
      || link.opacity !== '0.5' || link.style !== 'mix-blend-mode:multiply'
      || link.strokeOpacity !== null || link.display !== null || link.visibility !== null
      || link.transform !== null
      || Math.abs(Number(link.width) - Math.max(1, authored.value * scale)) > 0.08
      || path.valid !== true || !Array.isArray(start) || !Array.isArray(end)
      || !Array.isArray(c1) || !Array.isArray(c2)
      || start[0] !== Number(from.x) + 10 || end[0] !== to.x || Number(start[0]) >= Number(end[0])
      || Math.abs(Number(c1[0]) - (Number(start[0]) + Number(end[0])) / 2) > 0.01
      || Math.abs(Number(c2[0]) - (Number(start[0]) + Number(end[0])) / 2) > 0.01
      || c1[1] !== start[1] || c2[1] !== end[1]
      || Number(start[1]) < Number(from.y) - 0.05 || Number(start[1]) > Number(from.y) + Number(from.height) + 0.05
      || Number(end[1]) < Number(to.y) - 0.05 || Number(end[1]) > Number(to.y) + Number(to.height) + 0.05
      || Number(start[1]) - Number(link.width) / 2 < Number(from.y) - 0.1
      || Number(start[1]) + Number(link.width) / 2 > Number(from.y) + Number(from.height) + 0.1
      || Number(end[1]) - Number(link.width) / 2 < Number(to.y) - 0.1
      || Number(end[1]) + Number(link.width) / 2 > Number(to.y) + Number(to.height) + 0.1
      || gradient.id !== 'sankey-gradient-' + (index + 1) || gradient.units !== 'userSpaceOnUse'
      || gradient.x1 !== start[0] || gradient.y1 !== start[1]
      || gradient.x2 !== end[0] || gradient.y2 !== end[1]
      || !same(gradient.stops, [{ offset: '0%', color: from.fill, opacity: null, style: null },
        { offset: '100%', color: to.fill, opacity: null, style: null }])) return false
    for (const [key, center] of [[authored.source + ':out', Number(start[1])],
      [authored.target + ':in', Number(end[1])]] as const) {
      const spans = ribbonSpans.get(key) ?? []
      spans.push({ start: center - Number(link.width) / 2, end: center + Number(link.width) / 2 })
      ribbonSpans.set(key, spans)
    }
  }
  for (const spans of ribbonSpans.values()) {
    spans.sort((left, right) => left.start - right.start)
    for (let index = 1; index < spans.length; index++) {
      // Adjacent authored flows must tile their side of the node: neither
      // hidden overlap nor an unaccounted visual gap is acceptable.
      if (Math.abs(spans[index]!.start - spans[index - 1]!.end) > 0.1) return false
    }
  }
  return true
}

export const fidelityCases: readonly FidelityCaseDefinition[] = [{
  id: 'sankey.official.fence-0', family: 'sankey',
  featureId: 'official-doc:sankey:section:example', source,
  upstreamReference: examples[0]!.officialDocs ?? 'https://mermaid.ai/open-source/syntax/sankey.html',
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native', diagnosticCodes: ['FLOW_IMBALANCE'],
      evaluate: evidence => {
        const facts = semantic(evidence)
        return same(facts.links, authoredLinks) && same(facts.config, { showValues: false })
          && same(facts.flowImbalances, expectedImbalances) ? 'native' : 'absent'
      } },
    render: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => renderMatches(evidence) ? 'native' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const facts = semantic(evidence)
      return facts.stable === true && same(facts.links, authoredLinks)
        && same(facts.config, { showValues: false }) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'This case classifies the pinned energy example; Sankey link mutations have separate semantic receipts.' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'sankey') throw new Error('Pinned energy fence must parse')
    const verified = verifyMermaid(source)
    if (!verified.ok) throw new Error('Pinned energy fence must verify')
    const serialized = serializeMermaid(parsed.value)
    const reparsed = parseRegisteredMermaid(serialized)
    if (!reparsed.ok) throw new Error('Pinned energy fence must reparse')
    const warnings = verified.warnings.map(warning => warning.code)
    const flowImbalances = verified.warnings.filter(warning => warning.code === 'FLOW_IMBALANCE')
      .map(warning => ({ node: warning.node, inflow: warning.inflow, outflow: warning.outflow }))
    return {
      agent: { status: 'observed' as const, diagnosticCodes: [...new Set(warnings)].sort(),
        semantics: { ...record(modelFacts(source)), flowImbalances } },
      render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source)) },
      serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
        ...record(modelFacts(serialized)), stable: serializeMermaid(reparsed.value) === serialized } },
    }
  },
}]
