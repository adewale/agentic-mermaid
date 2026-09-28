import { parseRegisteredMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import { attrs, checkedRoundTrip, facts, officialFences, record, ribbonPath, same, tags } from '../case-helpers.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

// The large energy fence remains separate. These are the three distinct
// official frontmatter examples, pinned to the same reviewed upstream page.
const { sources, examples } = officialFences('sankey.md')

type Spec = Readonly<{ index: 5 | 6 | 7; featureId: string; config: Readonly<Record<string, FidelityJson>>;
  width: number; padding: number; paints: readonly string[]; outlined: boolean }>
const links = [
  { source: 'Electricity grid', target: 'Heating and cooling - homes', value: 113.726 },
  { source: 'Electricity grid', target: 'Industry', value: 342.165 },
  { source: 'Electricity grid', target: 'Losses', value: 56.691 },
] as const
const labels = ['Electricity grid', 'Heating and cooling - homes', 'Industry', 'Losses'] as const
const basePaints = ['#3b82f6', '#0d5ba5', '#5f79f2', '#0a5076'] as const
const specs: readonly Spec[] = [
  { index: 5, featureId: 'official-doc:sankey:section:label-style-v11-15-0',
    config: { showValues: false, labelStyle: 'outlined' }, width: 10, padding: 12,
    paints: basePaints, outlined: true },
  { index: 6, featureId: 'official-doc:sankey:section:node-width-and-padding-v11-15-0',
    config: { showValues: false, nodeWidth: 15, nodePadding: 20 }, width: 15, padding: 20,
    paints: basePaints, outlined: false },
  { index: 7, featureId: 'official-doc:sankey:section:custom-node-colors-v11-15-0',
    config: { showValues: false, nodeColors: { 'Electricity grid': '#4e79a7', Industry: '#e15759', Losses: '#bab0ab' } },
    width: 10, padding: 12, paints: ['#4e79a7', '#0d5ba5', '#e15759', '#bab0ab'], outlined: false },
]
function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'sankey') return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  const frontmatter = record(parsed.value.meta.frontmatter as FidelityJson)
  return { config: record(frontmatter.sankey),
    links: parsed.value.body.links.map(link => ({ source: link.source, target: link.target, value: link.value })) }
}
function renderFacts(svg: string): FidelityJson {
  const texts = [...svg.matchAll(/<text\b([^>]*)class="sankey-node-label"([^>]*)>([^<]*)<\/text>/g)]
    .map(match => ({ attributes: attrs(match[1]! + ' ' + match[2]!), text: match[3]! }))
  const gradients = [...svg.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/g)]
    .map(match => ({ attrs: attrs(match[1]!), stops: [...match[2]!.matchAll(/<stop\b[^>]*>/g)].map(stop => attrs(stop[0])) }))
  return {
    viewBox: svg.match(/<svg\b[^>]*viewBox="([^"]+)"/)?.[1] ?? null,
    nodes: tags(svg, 'rect', 'sankey-node').map(node => ({
      label: node['data-label'] ?? null, role: node['data-role'] ?? null, value: Number(node['data-value']),
      x: Number(node.x), y: Number(node.y), width: Number(node.width), height: Number(node.height), fill: node.fill ?? null,
      fillOpacity: node['fill-opacity'] ?? null, opacity: node.opacity ?? null,
      style: node.style ?? null, display: node.display ?? null,
      visibility: node.visibility ?? null, transform: node.transform ?? null,
    })),
    labels: texts.map(label => ({
      text: label.text, x: Number(label.attributes.x), y: Number(label.attributes.y), dy: Number(label.attributes.dy),
      anchor: label.attributes['text-anchor'] ?? null, fill: label.attributes.fill ?? null,
      fontSize: Number(label.attributes['font-size']), stroke: label.attributes.stroke ?? null,
      strokeWidth: label.attributes['stroke-width'] ?? null,
      paintOrder: label.attributes['paint-order'] ?? null, textLength: Number(label.attributes.textLength),
      lengthAdjust: label.attributes.lengthAdjust ?? null,
      strokeOpacity: label.attributes['stroke-opacity'] ?? null,
      fillOpacity: label.attributes['fill-opacity'] ?? null,
      opacity: label.attributes.opacity ?? null,
      display: label.attributes.display ?? null,
      visibility: label.attributes.visibility ?? null,
      style: label.attributes.style ?? null,
      transform: label.attributes.transform ?? null,
    })),
    links: tags(svg, 'path', 'sankey-link').map(link => ({
      source: link['data-source'] ?? null, target: link['data-target'] ?? null, value: Number(link['data-value']),
      width: Number(link['stroke-width']), stroke: link.stroke ?? null, fill: link.fill ?? null,
      opacity: link.opacity ?? null, style: link.style ?? null, path: ribbonPath(link.d ?? ''),
      strokeOpacity: link['stroke-opacity'] ?? null, display: link.display ?? null,
      visibility: link.visibility ?? null, transform: link.transform ?? null,
    })),
    gradients: gradients.map(gradient => ({
      id: gradient.attrs.id ?? null, units: gradient.attrs.gradientUnits ?? null,
      x1: Number(gradient.attrs.x1), y1: Number(gradient.attrs.y1),
      x2: Number(gradient.attrs.x2), y2: Number(gradient.attrs.y2),
      stops: gradient.stops.map(stop => ({ offset: stop.offset ?? null, color: stop['stop-color'] ?? null,
        opacity: stop['stop-opacity'] ?? null, style: stop.style ?? null })),
    })),
  }
}
function renderMatches(evidence: ObservedFidelitySurfaceEvidence, spec: Spec): boolean {
  const observed = facts(evidence)
  const nodes = observed.nodes
  const renderedLabels = observed.labels
  const renderedLinks = observed.links
  const gradients = observed.gradients
  const viewWidth = spec.outlined ? 816.75 : 648
  if (observed.viewBox !== '0 0 ' + viewWidth + ' 448'
    || !Array.isArray(nodes) || nodes.length !== 4 || !Array.isArray(renderedLabels) || renderedLabels.length !== 4
    || !Array.isArray(renderedLinks) || renderedLinks.length !== 3
    || !Array.isArray(gradients) || gradients.length !== 3) return false
  const source = record(nodes[0]!)
  const scale = Number(source.height) / 512.582
  if (!Number.isFinite(scale) || Number(source.height) < 350) return false
  const values = [512.582, 113.726, 342.165, 56.691] as const
  const expectedTextLengths = [87.165, 162.747, 50.856, 47.892] as const
  for (let index = 0; index < 4; index++) {
    const node = record(nodes[index]!)
    const label = record(renderedLabels[index]!)
    const x = index === 0 ? 24 : 624 - spec.width
    const labelRight = spec.outlined || index === 0
    if (node.label !== labels[index] || node.role !== 'bar' || node.value !== values[index]
      || node.x !== x || node.width !== spec.width
      || typeof node.y !== 'number' || typeof node.height !== 'number' || node.height <= 0
      || node.y < 0 || node.y + node.height > 448
      || Math.abs(node.height - values[index]! * scale) > 0.05 || node.fill !== spec.paints[index]
      || node.fillOpacity !== null || node.opacity !== null || node.style !== null
      || node.display !== null || node.visibility !== null || node.transform !== null
      || label.text !== labels[index] || label.fill !== '#27272A' || label.fontSize !== 13
      || Math.abs(Number(label.y) - (Number(node.y) + Number(node.height) / 2)) > 0.02
      || label.dy !== 4.55 || label.x !== (labelRight ? x + spec.width + 6 : x - 6)
      || label.anchor !== (labelRight ? 'start' : 'end')
      || label.stroke !== (spec.outlined ? '#FFFFFF' : null)
      || label.strokeWidth !== (spec.outlined ? '3' : null)
      || label.paintOrder !== (spec.outlined ? 'stroke fill' : null)
      || label.strokeOpacity !== null || label.fillOpacity !== null || label.opacity !== null
      || label.display !== null || label.visibility !== null || label.style !== null
      || label.transform !== null
      || label.lengthAdjust !== 'spacingAndGlyphs'
      || Math.abs(Number(label.textLength) - expectedTextLengths[index]!) > 0.02
      || (labelRight ? Number(label.x) + Number(label.textLength) > viewWidth
        : Number(label.x) - Number(label.textLength) < 0)) return false
    if (index > 1) {
      const previous = record(nodes[index - 1]!)
      if (Math.abs(Number(node.y) - Number(previous.y) - Number(previous.height) - spec.padding) > 0.05) return false
    }
  }
  let previousSourceEnd = Number(source.y)
  for (const [index, authored] of links.entries()) {
    const link = record(renderedLinks[index]!)
    const gradient = record(gradients[index]!)
    const target = record(nodes[index + 1]!)
    const path = record(link.path)
    const start = path.start
    const end = path.end
    const control1 = path.control1
    const control2 = path.control2
    if (link.source !== authored.source || link.target !== authored.target || link.value !== authored.value
      || link.stroke !== 'url(#sankey-gradient-' + (index + 1) + ')' || link.fill !== 'none'
      || link.opacity !== '0.5' || link.style !== 'mix-blend-mode:multiply'
      || link.strokeOpacity !== null || link.display !== null
      || link.visibility !== null || link.transform !== null
      || Math.abs(Number(link.width) - authored.value * scale) > 0.05
      || path.valid !== true || !Array.isArray(start) || !Array.isArray(end)
      || !Array.isArray(control1) || !Array.isArray(control2)
      || start[0] !== 24 + spec.width || end[0] !== 624 - spec.width
      || Math.abs(Number(end[1]) - (Number(target.y) + Number(target.height) / 2)) > 0.02
      || Number(start[1]) - Number(link.width) / 2 < Number(source.y) - 0.05
      || Number(start[1]) + Number(link.width) / 2 > Number(source.y) + Number(source.height) + 0.05
      || Number(end[1]) - Number(link.width) / 2 < Number(target.y) - 0.05
      || Number(end[1]) + Number(link.width) / 2 > Number(target.y) + Number(target.height) + 0.05
      || end[0] - start[0] < 500
      || !same(control1, [(Number(start[0]) + Number(end[0])) / 2, start[1]])
      || !same(control2, [(Number(start[0]) + Number(end[0])) / 2, end[1]])
      || gradient.id !== 'sankey-gradient-' + (index + 1) || gradient.units !== 'userSpaceOnUse'
      || gradient.x1 !== start[0] || gradient.y1 !== start[1]
      || gradient.x2 !== end[0] || gradient.y2 !== end[1]
      || !same(gradient.stops, [{ offset: '0%', color: spec.paints[0], opacity: null, style: null },
        { offset: '100%', color: spec.paints[index + 1], opacity: null, style: null }])) return false
    const spanStart = Number(start[1]) - Number(link.width) / 2
    const spanEnd = Number(start[1]) + Number(link.width) / 2
    if (Math.abs(spanStart - previousSourceEnd) > 0.1) return false
    previousSourceEnd = spanEnd
  }
  if (Math.abs(previousSourceEnd - (Number(source.y) + Number(source.height))) > 0.1) return false
  return true
}

export const fidelityCases: readonly FidelityCaseDefinition[] = specs.map(spec => {
  const source = sources[spec.index]!
  const matchesModel = (evidence: ObservedFidelitySurfaceEvidence): boolean => {
    const observed = facts(evidence)
    return same(observed.config, spec.config) && same(observed.links, links)
  }
  return {
    id: 'sankey.official.fence-' + spec.index, family: 'sankey', featureId: spec.featureId, source,
    upstreamReference: examples[spec.index]!.officialDocs ?? 'https://mermaid.ai/open-source/syntax/sankey.html',
    upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
    expected: {
      agent: { applicability: 'applicable', disposition: 'native', diagnosticCodes: [], evaluate: evidence =>
        matchesModel(evidence) ? 'native' : 'absent' },
      render: { applicability: 'applicable', disposition: 'native', evaluate: evidence =>
        renderMatches(evidence, spec) ? 'native' : 'absent' },
      serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence =>
        facts(evidence).stable === true && matchesModel(evidence) ? 'native' : 'absent' },
      mutate: { applicability: 'not-applicable', rationale: 'These classify official frontmatter examples; config mutation is not a structured Sankey operation.' },
    },
    observe: () => {
      const { verified, serialized, stable } = checkedRoundTrip(source, 'sankey', 'Pinned official Sankey config fence')
      return {
        agent: { status: 'observed' as const, diagnosticCodes: verified.warnings.map(warning => warning.code), semantics: modelFacts(source) },
        render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source)) },
        serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
          ...record(modelFacts(serialized)), stable } },
      }
    },
  }
})
