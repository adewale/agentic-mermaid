import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG, verifyNoExternalRefs } from '../../../index.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../../../upstream-mermaid-manifest.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const page = readFileSync(join(import.meta.dir, '..', '..', '..', '..',
  'skills/agentic-mermaid-diagram-workflow/references/upstream/mindmap.md'), 'utf8')
const sources = [...page.matchAll(/^\x60{3}mermaid(?:-example)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n\x60{3}[^\S\r\n]*$/gm)]
  .map(match => match[1]!.trim()).filter((source, index, all) => all.indexOf(source) === index)
const examples = UPSTREAM_MERMAID_MANIFEST.semanticInventory.examples
  .filter(example => example.origin === 'official-syntax/mindmap.md' && example.family === 'mindmap')
  .sort((left, right) => left.index - right.index)
if (sources.length !== 13 || examples.length !== 13) throw new Error('Pinned Mindmap fence inventory changed')
for (const index of [1, 11]) {
  const example = examples[index]!
  if (example.id !== 'mindmap:official-syntax/mindmap.md#' + index
    || example.sourceSha256 !== createHash('sha256').update(sources[index]!).digest('hex')) {
    throw new Error('Pinned Mindmap hierarchy fence ' + index + ' differs from the manifest')
  }
}

const expectedNodes = [
  { id: 'Root', label: 'Root', shape: 'default', parentId: null, depth: 0, children: ['A'] },
  { id: 'A', label: 'A', shape: 'default', parentId: 'Root', depth: 1, children: ['B', 'C'] },
  { id: 'B', label: 'B', shape: 'default', parentId: 'A', depth: 2, children: [] },
  { id: 'C', label: 'C', shape: 'default', parentId: 'A', depth: 2, children: [] },
] as const
const expectedEdges = [
  { from: 'Root', to: 'A', d: 'M 88 86.9 C 96.4 86.9 99.6 86.9 108 86.9' },
  { from: 'A', to: 'B', d: 'M 164 86.9 C 172.4 86.9 175.6 49.45 184 49.45' },
  { from: 'A', to: 'C', d: 'M 164 86.9 C 172.4 86.9 175.6 124.35 184 124.35' },
] as const

function record(value: FidelityJson | undefined): Readonly<Record<string, FidelityJson>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Mindmap hierarchy evidence must be an object')
  return value as Readonly<Record<string, FidelityJson>>
}
function semantics(evidence: ObservedFidelitySurfaceEvidence): Readonly<Record<string, FidelityJson>> {
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
function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g)]
    .map(match => [match[1]!, match[2]!.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')]))
}
function modelFacts(source: string): FidelityJson {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind !== 'mindmap') return { kind: parsed.ok ? parsed.value.body.kind : 'parse-failure' }
  const nodes: Array<{ id: string; label: string; shape: string; parentId: string | null; depth: number; children: string[] }> = []
  const visit = (node: typeof parsed.value.body.root, parentId: string | null, depth: number): void => {
    nodes.push({ id: node.id, label: node.label, shape: node.shape, parentId, depth,
      children: node.children.map(child => child.id) })
    for (const child of node.children) visit(child, node.id, depth + 1)
  }
  visit(parsed.value.body.root, null, 0)
  return { nodes }
}
function renderFacts(svg: string): FidelityJson {
  const groups = [...svg.matchAll(/<g\b([^>]*\bclass="mindmap-node depth-[0-9]+"[^>]*)>([\s\S]*?)<\/g>/g)]
  const nodes = groups.map(match => {
    const group = attrs(match[1]!)
    const label = match[2]!.match(/<text\b[^>]*>([\s\S]*?)<\/text>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null
    return { id: group['data-id'] ?? null, label: group['data-label'] ?? null,
      parentId: group['data-parent-id'] ?? null, depth: Number(group.class?.match(/depth-(\d+)/)?.[1]),
      role: group['data-role'] ?? null, text: label }
  })
  const paths = [...svg.matchAll(/<path\b([^>]*\bclass="mindmap-edge"[^>]*)\/>/g)]
  const edges = paths.map(match => {
    const path = attrs(match[1]!)
    return { from: path['data-from'] ?? null, to: path['data-to'] ?? null,
      d: path.d ?? null, role: path['data-role'] ?? null,
      relationship: path['data-relationship'] ?? null }
  })
  return { svgSha256: createHash('sha256').update(svg).digest('hex'),
    viewBox: svg.match(/<svg\b[^>]*viewBox="([^"]+)"/)?.[1] ?? null,
    nodeGroupCount: [...svg.matchAll(/<g\b/g)].length,
    pathCount: [...svg.matchAll(/<path\b/g)].length,
    textCount: [...svg.matchAll(/<text\b/g)].length,
    externalRefs: verifyNoExternalRefs(svg).refs,
    nodes, edges }
}
const expectedModel = { nodes: expectedNodes }
const expectedRender = {
  svgSha256: 'e2731d22e163d87a973b1df09f3d4fb98486412ff62fcda5fc873e13f3c1152c',
  viewBox: '0 0 272 173.8',
  nodeGroupCount: 4, pathCount: 3, textCount: 4, externalRefs: [],
  nodes: expectedNodes.map(node => ({ id: node.id, label: node.label,
    parentId: node.parentId, depth: node.depth, role: 'node', text: node.label })),
  edges: expectedEdges.map(edge => ({ ...edge, role: 'edge', relationship: 'mindmap-branch' })),
}
const specs = [
  { index: 1, featureId: 'official-doc:mindmap:section:syntax' },
  { index: 11, featureId: 'official-doc:mindmap:section:unclear-indentation' },
] as const
export const fidelityCases: readonly FidelityCaseDefinition[] = specs.map(spec => ({
  id: 'mindmap.official.fence-' + spec.index, family: 'mindmap', featureId: spec.featureId,
  source: sources[spec.index]!, upstreamReference: examples[spec.index]!.officialDocs
    ?? 'https://mermaid.ai/open-source/syntax/mindmap.html',
  upstreamRevision: UPSTREAM_MERMAID_MANIFEST.provenance.commit,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => same(semantics(evidence), expectedModel) ? 'native' : 'absent' },
    // The construct is indentation topology, not Mermaid's default theme.
    // Assert visible branch paths, endpoints, node labels and depth as a unit.
    render: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => same(semantics(evidence), expectedRender) ? 'native' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'native', evaluate: evidence => {
      const facts = semantics(evidence)
      return facts.stable === true && same(facts.model, expectedModel) ? 'native' : 'absent'
    } },
    mutate: { applicability: 'not-applicable', rationale: 'Official hierarchy fences classify authored indentation; Mindmap mutation has separate contracts.' },
  },
  observe: () => {
    const source = sources[spec.index]!
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'mindmap') throw new Error('Pinned Mindmap hierarchy fence must parse')
    const verified = verifyMermaid(source)
    if (!verified.ok || verified.warnings.length) throw new Error('Pinned Mindmap hierarchy fence must verify without warnings')
    const serialized = serializeMermaid(parsed.value)
    const reparsed = parseRegisteredMermaid(serialized)
    if (!reparsed.ok) throw new Error('Pinned Mindmap hierarchy fence must reparse')
    return {
      agent: { status: 'observed' as const, diagnosticCodes: [], semantics: modelFacts(source) },
      render: { status: 'observed' as const, diagnosticCodes: [], semantics: renderFacts(renderMermaidSVG(source)) },
      serialize: { status: 'observed' as const, diagnosticCodes: [], semantics: {
        model: modelFacts(serialized), stable: serializeMermaid(reparsed.value) === serialized } },
    }
  },
}))
