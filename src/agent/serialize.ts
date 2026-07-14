// ============================================================================
// serializeMermaid: ValidDiagram → canonical Mermaid source.
// synthesizeFromGraph: build a ValidDiagram from a JSON payload (no re-parse).
// ============================================================================

import type {
  ValidDiagram, ParsedDiagram, ValidDiagramMeta, DiagramBody, FamilyParsedBody,
  ValidDiagramPayload, ParseError, Result,
} from './types.ts'
import { ok, err } from './types.ts'
import YAML from 'yaml'
import { getFamily, knownFamilies } from './families.ts'
import { ensureAccessibilityLines } from './accessibility-envelope.ts'
import type { ExtensionIdentity } from '../shared/extension-identity.ts'
import { sameExtensionIdentity } from '../shared/extension-identity.ts'
import { radarBodyProblem } from './radar-body.ts'

// Re-export for callers that used the previous in-tree serializer home.
export { renderTimeline } from './timeline-body.ts'

export interface SerializeOptions {
  /**
   * Wrapper emission policy. 'verbatim' (default) re-emits the leading source
   * wrapper (frontmatter, init directives, comments) byte-identically from
   * `meta.wrapperSource`. 'canonical' synthesizes Mermaid's documented shape
   * instead: one frontmatter block with `title`/`displayMode` at the top
   * level and everything else nested under `config:`, init directives folded
   * in (re-emitted raw only when their payload could not be folded), and
   * wrapper comments dropped. Diagrams without a captured wrapper (e.g.
   * synthesized from JSON payloads) always use canonical synthesis.
   */
  wrapper?: 'verbatim' | 'canonical'
}

export function serializeMermaid(d: ParsedDiagram, opts: SerializeOptions = {}): string {
  if (d.body.kind === 'preserved') return d.body.source
  return wrapperPrefix(d.meta, opts.wrapper ?? 'verbatim') + renderBody(
    d.body,
    d.kind,
    d.meta,
    d.body.kind === 'extension' && 'descriptorIdentity' in d ? d.descriptorIdentity : undefined,
  )
}

/** The wrapper text to emit before the diagram body for the given policy. */
export function wrapperPrefix(meta: ValidDiagramMeta, mode: 'verbatim' | 'canonical' = 'verbatim'): string {
  if (mode === 'verbatim' && meta.wrapperSource !== undefined) return meta.wrapperSource
  return renderMeta(meta)
}

/**
 * Canonical wrapper synthesis (Mermaid's documented frontmatter shape):
 * `title`/`displayMode` stay top-level, all other keys nest under `config:`.
 * Init directives whose parsed payload is already represented in the
 * frontmatter map are folded (not re-emitted); unparseable directives are
 * preserved raw so canonicalization never silently loses them.
 */
export function renderMeta(meta: ValidDiagramMeta): string {
  const parts: string[] = []
  if (meta.frontmatter && Object.keys(meta.frontmatter).length > 0) {
    const top: Record<string, unknown> = {}
    const config: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(meta.frontmatter)) {
      if (key === 'title' || key === 'displayMode') top[key] = value
      else config[key] = value
    }
    const doc: Record<string, unknown> = { ...top }
    if (Object.keys(config).length > 0) doc.config = config
    parts.push(`---\n${YAML.stringify(doc).trimEnd()}\n---\n`)
  }
  for (const d of meta.initDirectives) {
    if (frontmatterRepresents(meta.frontmatter, d.parsed)) continue
    parts.push(d.raw.trimEnd() + '\n')
  }
  return parts.join('')
}

/** True when every leaf of `sub` is present with an equal value in `map`. */
function frontmatterRepresents(map: Record<string, unknown> | undefined, sub: Record<string, unknown>): boolean {
  const keys = Object.keys(sub)
  if (keys.length === 0) return false  // unparseable payload — never foldable
  if (!map) return false
  for (const key of keys) {
    const a = map[key], b = sub[key]
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return false
      if (!frontmatterRepresents(a as Record<string, unknown>, b as Record<string, unknown>)) return false
      continue
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) return false
  }
  return true
}

function renderBody(
  body: FamilyParsedBody,
  kind: ParsedDiagram['kind'],
  meta: ValidDiagramMeta,
  parsedDescriptorIdentity?: ExtensionIdentity<'family'>,
): string {
  // Opaque bodies re-emit preserved source verbatim. Every structured body
  // serializes through its FamilyDescriptor hook — looked up by DIAGRAM kind,
  // not body kind. State diagrams (BUILD-19) own a dedicated StateBody and the
  // state descriptor emits the stateDiagram-v2 header.
  if (body.kind === 'opaque') return body.source.endsWith('\n') ? body.source : body.source + '\n'
  if (body.kind === 'preserved') return body.source
  const plugin = getFamily(kind)
  // Descriptor-owned `data` is meaningful only to the exact registration
  // contract that parsed it. After an extension upgrade, preserve/reparse the
  // core-owned source instead of passing stale data into a new serializer.
  const descriptorMatches = body.kind !== 'extension'
    || sameExtensionIdentity(parsedDescriptorIdentity, plugin?.identity)
  if (plugin?.serialize && descriptorMatches) {
    const rendered = plugin.serialize(body)
    return body.kind === 'extension' ? rendered : ensureAccessibilityLines(rendered, meta.accessibility)
  }
  if (body.kind === 'extension') return body.source.endsWith('\n') ? body.source : body.source + '\n'
  throw new Error(`No serializer registered for diagram kind "${kind}"`)
}


// ---- synthesizeFromGraph --------------------------------------------------

export function synthesizeFromGraph(payload: ValidDiagramPayload): Result<ValidDiagram, ParseError[]> {
  const meta: ValidDiagramMeta = {
    initDirectives: payload.meta?.initDirectives ?? [],
    comments: payload.meta?.comments ?? [],
    accessibility: payload.meta?.accessibility ?? {},
    frontmatter: payload.meta?.frontmatter,
    wrapperSource: payload.meta?.wrapperSource,
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
  } else if (payload.body.kind === 'radar') {
    const problem = radarBodyProblem(payload.body)
    if (problem) return err([{ code: 'INVALID_PAYLOAD', message: problem }])
    body = payload.body
  } else if (payload.body.kind === 'opaque' || knownFamilies().includes(payload.body.kind)) {
    // Structured bodies pass through verbatim (flowchart is rebuilt above).
    // Membership is derived from the family registry rather than a hand-kept
    // kind list — the old list silently dropped pie and quadrant payloads to
    // INVALID_PAYLOAD, and would have done the same to any new family.
    body = payload.body
  } else {
    return err([{ code: 'INVALID_PAYLOAD', message: 'unknown body kind' }])
  }

  const draft: ValidDiagram = {
    kind: payload.kind, meta, body,
    source: { nodes: new Map(), edges: new Map(), groups: new Map(), labels: new Map() },
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
