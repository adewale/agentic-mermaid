// ============================================================================
// serializeMermaid: ValidDiagram → canonical Mermaid source.
// synthesizeFromGraph: build a ValidDiagram from a JSON payload (no re-parse).
// ============================================================================

import type {
  ValidDiagram, ValidDiagramMeta, DiagramBody,
  ValidDiagramPayload, ParseError, Result,
} from './types.ts'
import { ok, err } from './types.ts'
import YAML from 'yaml'
import { getFamily } from './families.ts'
import './families-builtin.ts'  // registers built-in family serialize hooks

// Re-export for callers that used the previous in-tree serializer home.
export { renderTimeline } from './timeline-body.ts'

export function serializeMermaid(d: ValidDiagram): string {
  return renderMeta(d.meta) + renderBody(d.body, d.kind)
}

export function renderMeta(meta: ValidDiagramMeta): string {
  const parts: string[] = []
  if (meta.frontmatter && Object.keys(meta.frontmatter).length > 0) {
    parts.push(`---\n${YAML.stringify(meta.frontmatter).trimEnd()}\n---\n`)
  }
  for (const d of meta.initDirectives) parts.push(d.raw.trimEnd() + '\n')
  return parts.join('')
}

function renderBody(body: DiagramBody, kind: ValidDiagram['kind']): string {
  // Opaque bodies re-emit preserved source verbatim. Every structured body
  // serializes through its FamilyPlugin hook — looked up by DIAGRAM kind,
  // not body kind, so state diagrams (which share the flowchart body) hit
  // the state plugin and get the stateDiagram-v2 header.
  if (body.kind === 'opaque') return body.source.endsWith('\n') ? body.source : body.source + '\n'
  const plugin = getFamily(kind)
  if (plugin?.serialize) return plugin.serialize(body)
  throw new Error(`No serializer registered for diagram kind "${kind}"`)
}

// ---- synthesizeFromGraph --------------------------------------------------

export function synthesizeFromGraph(payload: ValidDiagramPayload): Result<ValidDiagram, ParseError[]> {
  const meta: ValidDiagramMeta = {
    initDirectives: payload.meta?.initDirectives ?? [],
    comments: payload.meta?.comments ?? [],
    accessibility: payload.meta?.accessibility ?? {},
    frontmatter: payload.meta?.frontmatter,
  }

  let body: DiagramBody
  if (payload.body.kind === 'flowchart') {
    const sg = payload.body.graph
    const nodesMap = Array.isArray(sg.nodes) ? new Map(sg.nodes) : new Map(Object.entries(sg.nodes))
    body = {
      kind: 'flowchart',
      graph: {
        direction: sg.direction,
        nodes: nodesMap,
        edges: sg.edges ?? [],
        // Defensive: the SDK-declared subgraph shape omits `children`/`direction`.
        // Normalize recursively so cloneSubgraph / findSubgraphById never hit
        // `undefined.map`. (A crash reachable straight from the documented SDK.)
        subgraphs: normalizeSubgraphs(sg.subgraphs),
        // Round-trip styling too, so `am parse | am serialize` is lossless.
        classDefs: toMap(sg.classDefs),
        classAssignments: toMap(sg.classAssignments),
        nodeStyles: toMap(sg.nodeStyles),
        linkStyles: toLinkStyleMap(sg.linkStyles),
      },
    }
  } else if (payload.body.kind === 'sequence' || payload.body.kind === 'timeline' || payload.body.kind === 'class' || payload.body.kind === 'er' || payload.body.kind === 'journey' || payload.body.kind === 'opaque') {
    body = payload.body
  } else {
    return err([{ code: 'INVALID_PAYLOAD', message: 'unknown body kind' }])
  }

  const draft: ValidDiagram = {
    kind: payload.kind, meta, body,
    source: { nodes: new Map(), edges: new Map(), groups: new Map() },
    canonicalSource: '',
  }
  return ok({ ...draft, canonicalSource: serializeMermaid(draft) })
}

interface LooseSubgraph {
  id: string
  label?: string
  nodeIds?: string[]
  children?: LooseSubgraph[]
  direction?: import('../types.ts').Direction
}

function normalizeSubgraphs(input: unknown, seen: Set<unknown> = new Set()): import('../types.ts').MermaidSubgraph[] {
  if (!Array.isArray(input)) return []
  const out: import('../types.ts').MermaidSubgraph[] = []
  for (const sg of input as Array<LooseSubgraph | null | undefined>) {
    // Skip null/undefined elements rather than crashing.
    if (!sg || typeof sg !== 'object') continue
    // Cycle guard: a subgraph that points at itself (transitively) would
    // recurse forever. Drop the cyclic edge by returning [] for children
    // we've already visited on this branch.
    if (seen.has(sg)) continue
    seen.add(sg)
    out.push({
      id: String(sg.id ?? ''),
      label: sg.label ?? String(sg.id ?? ''),
      nodeIds: Array.isArray(sg.nodeIds) ? sg.nodeIds.map(String) : [],
      children: normalizeSubgraphs(sg.children, seen),
      direction: sg.direction,
    })
    seen.delete(sg)
  }
  return out
}

function toMap<V>(input: unknown): Map<string, V> {
  if (input instanceof Map) {
    // Coerce keys to string so callers can look up by string consistently.
    const out = new Map<string, V>()
    for (const [k, v] of input as Map<unknown, V>) out.set(String(k), v)
    return out
  }
  if (Array.isArray(input)) {
    // Only accept well-formed [k, v] tuples; ignore the rest rather than
    // throwing 'Iterator value X is not an entry object'.
    const out = new Map<string, V>()
    for (const entry of input as unknown[]) {
      if (Array.isArray(entry) && entry.length >= 2) {
        out.set(String((entry as unknown[])[0]), (entry as unknown[])[1] as V)
      }
    }
    return out
  }
  if (input && typeof input === 'object') {
    return new Map(Object.entries(input as Record<string, V>))
  }
  return new Map()
}

function toLinkStyleMap(input: unknown): Map<number | 'default', Record<string, string>> {
  const raw = toMap<Record<string, string>>(input)
  const out = new Map<number | 'default', Record<string, string>>()
  for (const [k, v] of raw) {
    if (k === 'default') { out.set('default', v); continue }
    // Only accept non-negative integer keys; silently drop anything else
    // rather than producing NaN- or float-keyed entries that downstream
    // index lookups can never find.
    const n = Number(k)
    if (Number.isInteger(n) && n >= 0) out.set(n, v)
  }
  return out
}
