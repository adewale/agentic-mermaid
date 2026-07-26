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
import { parseRegisteredMermaid } from './parse.ts'
import { ensureAccessibilityLines } from './accessibility-envelope.ts'
import type { ExtensionIdentity } from '../shared/extension-identity.ts'
import { sameExtensionIdentity } from '../shared/extension-identity.ts'
import { radarBodyProblem } from './radar-body.ts'
import {
  mergeFrontmatterMaps,
  mermaidInitDirectiveIdentity,
  mermaidInitDirectives,
  stripMermaidInitDirectives,
} from '../mermaid-source.ts'

// Re-export for callers that used the previous in-tree serializer home.
export { renderTimeline } from './timeline-body.ts'

export interface SerializeOptions {
  /**
   * Wrapper emission policy. 'verbatim' (default) re-emits the leading source
   * wrapper (frontmatter, init directives, comments) byte-identically from
   * `meta.wrapperSource`, then re-emits any init directive authored *after*
   * the family header that the serialized body does not already own — a
   * structured serializer receives directive-free grammar, so without this the
   * config would be lost. Such a directive therefore moves ahead of the
   * header; source-preserving bodies keep theirs in place and are unaffected.
   * 'canonical' synthesizes Mermaid's documented shape
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
  const mode = opts.wrapper ?? 'verbatim'
  const renderedBody = renderBody(
    d.body,
    d.kind,
    d.meta,
    d.body.kind === 'extension' && 'descriptorIdentity' in d ? d.descriptorIdentity : undefined,
  )
  // Canonical mode folds universal config into renderMeta. Opaque bodies and
  // source-preserving extension serializers may still contain the authored
  // directives, so remove them through the same grammar authority before
  // joining the canonical wrapper and family source.
  const bodySource = mode === 'canonical'
    ? stripMermaidInitDirectives(renderedBody)
    : renderedBody
  return wrapperPrefix(d.meta, mode, bodySource) + bodySource
}

/** The wrapper text to emit before the diagram body for the given policy. */
export function wrapperPrefix(
  meta: ValidDiagramMeta,
  mode: 'verbatim' | 'canonical' = 'verbatim',
  bodySource = '',
): string {
  if (mode === 'verbatim' && meta.wrapperSource !== undefined) {
    return meta.wrapperSource + postWrapperInitDirectives(meta, bodySource)
  }
  return renderMeta(meta)
}

/**
 * Structured serializers receive directive-free grammar, so universal config
 * authored after the family header must be re-emitted alongside the exact
 * leading wrapper. A source-preserving body or extension serializer may retain
 * those authored bytes itself, so actual rendered output—not descriptor
 * identity—decides whether each directive still needs the shared envelope.
 */
function postWrapperInitDirectives(meta: ValidDiagramMeta, bodySource: string): string {
  // Count what the emitted text already owns through the shared grammar, not
  // by searching for the authored bytes: a serializer that re-indents or
  // re-spaces preserved source still owns that directive, and a byte search
  // would duplicate it. Counts (not a set) keep a directive authored twice
  // emitted twice.
  const owned = new Map<string, number>()
  for (const text of [meta.wrapperSource ?? '', bodySource]) {
    for (const directive of mermaidInitDirectives(text)) {
      const key = mermaidInitDirectiveIdentity(directive)
      owned.set(key, (owned.get(key) ?? 0) + 1)
    }
  }
  const parts: string[] = []
  for (const directive of meta.initDirectives) {
    const key = mermaidInitDirectiveIdentity(directive)
    const remaining = owned.get(key) ?? 0
    if (remaining > 0) {
      owned.set(key, remaining - 1)
      continue
    }
    parts.push(directive.raw.trimEnd() + '\n')
  }
  return parts.join('')
}

/**
 * Canonical wrapper synthesis (Mermaid's documented frontmatter shape):
 * `title`/`displayMode` stay top-level, all other keys nest under `config:`.
 * Every parseable init directive is folded into the effective frontmatter in
 * authored order. Re-emitting an earlier raw directive is never safe: even if
 * one of its fields remains live, another may have been overridden later, and
 * Mermaid would apply that stale raw value after the synthesized frontmatter.
 * Unparseable directives are preserved raw so canonicalization does not
 * silently lose syntax it cannot project.
 */
export function renderMeta(meta: ValidDiagramMeta): string {
  const parts: string[] = []
  let effectiveFrontmatter = mergeFrontmatterMaps({}, meta.frontmatter ?? {})
  for (const directive of meta.initDirectives) {
    if (Object.keys(directive.parsed).length > 0) {
      effectiveFrontmatter = mergeFrontmatterMaps(effectiveFrontmatter, directive.parsed)
    }
  }
  if (Object.keys(effectiveFrontmatter).length > 0) {
    const top: Record<string, unknown> = {}
    const config: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(effectiveFrontmatter)) {
      if (key === 'title' || key === 'displayMode') top[key] = value
      else config[key] = value
    }
    const doc: Record<string, unknown> = { ...top }
    if (Object.keys(config).length > 0) doc.config = config
    parts.push(`---\n${YAML.stringify(doc).trimEnd()}\n---\n`)
  }
  for (const d of meta.initDirectives) {
    if (Object.keys(d.parsed).length > 0) continue
    parts.push(d.raw.trimEnd() + '\n')
  }
  return parts.join('')
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
    return ensureAccessibilityLines(rendered, meta.accessibility)
  }
  if (body.kind === 'extension') return body.source.endsWith('\n') ? body.source : body.source + '\n'
  throw new Error(`No serializer registered for diagram kind "${kind}"`)
}


// ---- synthesizeFromGraph --------------------------------------------------

export function synthesizeFromGraph(
  payload: ValidDiagramPayload & {
    kind: ValidDiagram['kind']
    body: Exclude<ValidDiagramPayload['body'], import('./types.ts').ExtensionDiagramBody>
  },
): Result<ValidDiagram, ParseError[]>
export function synthesizeFromGraph(payload: ValidDiagramPayload): Result<ParsedDiagram, ParseError[]>
export function synthesizeFromGraph(payload: ValidDiagramPayload): Result<ParsedDiagram, ParseError[]> {
  // This is an untrusted-JSON boundary (`am serialize`, batch `serialize`, Code Mode): the
  // declared Result type promises err-not-throw for ANY payload. Guard the top-level shape for
  // a clean message, then net any deeper malformed-graph throw (e.g. `new Map` on a non-tuple
  // array) into INVALID_PAYLOAD instead of letting it escape as an unhandled crash — which used
  // to surface as `am serialize` exit 4 (and exit 0 on `null`), bypassing the `!ok` error path.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return err([{ code: 'INVALID_PAYLOAD', message: 'payload must be a diagram object' }])
  }
  const bodyPayload = (payload as { body?: unknown }).body
  if (!bodyPayload || typeof bodyPayload !== 'object' || typeof (bodyPayload as { kind?: unknown }).kind !== 'string') {
    return err([{ code: 'INVALID_PAYLOAD', message: 'payload.body.kind must be a string' }])
  }
  const kind = (payload as { kind?: unknown }).kind
  if (typeof kind !== 'string' || !knownFamilies().includes(kind as never)) {
    return err([{ code: 'INVALID_PAYLOAD', message: `payload.kind must be a known diagram family, received ${String(kind)}` }])
  }
  const bodyKind = (bodyPayload as { kind: string }).kind
  const bodyFamily = bodyKind === 'opaque' || bodyKind === 'extension'
    ? (bodyPayload as { family?: unknown }).family
    : bodyKind
  if (bodyFamily !== kind) {
    return err([{ code: 'INVALID_PAYLOAD', message: `payload kind "${kind}" does not match body family "${String(bodyFamily)}"` }])
  }
  if (bodyKind === 'pie') {
    const pie = bodyPayload as { showData?: unknown; title?: unknown; slices?: unknown }
    if (typeof pie.showData !== 'boolean'
      || (pie.title !== undefined && typeof pie.title !== 'string')
      || !Array.isArray(pie.slices)
      || pie.slices.some(slice => !slice || typeof slice !== 'object'
        || typeof (slice as { id?: unknown }).id !== 'string'
        || typeof (slice as { label?: unknown }).label !== 'string'
        || typeof (slice as { value?: unknown }).value !== 'number'
        || !Number.isFinite((slice as { value: number }).value)
        || (slice as { value: number }).value <= 0)) {
      return err([{ code: 'INVALID_PAYLOAD', message: 'payload pie body must contain typed positive finite slices' }])
    }
  }
  try {
    if (bodyKind === 'extension') {
      const bodySource = (bodyPayload as { source?: unknown }).source
      const canonicalSource = (payload as { canonicalSource?: unknown }).canonicalSource
      const wrapperSource = (payload as { meta?: { wrapperSource?: unknown } }).meta?.wrapperSource
      const source = typeof bodySource === 'string' && bodySource.trim()
        ? (typeof wrapperSource === 'string' ? wrapperSource : '') + bodySource
        : canonicalSource
      if (typeof source !== 'string' || !source.trim()) {
        return err([{ code: 'INVALID_PAYLOAD', message: 'extension payload must retain canonicalSource or body.source' }])
      }
      const reparsed = parseRegisteredMermaid(source)
      if (!reparsed.ok || reparsed.value.kind !== kind || reparsed.value.body.kind !== 'extension') {
        const detail = reparsed.ok
          ? `serialized source reparsed as ${reparsed.value.kind}/${reparsed.value.body.kind}`
          : reparsed.error.map(error => error.message).join('; ')
        return err([{ code: 'INVALID_PAYLOAD', message: `serialized extension payload is not a valid ${kind} diagram: ${detail}` }])
      }
      return ok(reparsed.value)
    }
    const rebuilt = rebuildFromPayload(payload)
    if (!rebuilt.ok) return rebuilt
    // A successful untrusted rehydration must be a real diagram, not merely a
    // body that happened not to throw in a serializer. Reparse the canonical
    // source and require the same family before publishing ValidDiagram.
    const reparsed = parseRegisteredMermaid(rebuilt.value.canonicalSource)
    if (!reparsed.ok || reparsed.value.kind !== rebuilt.value.kind) {
      const detail = reparsed.ok
        ? `serialized source reparsed as ${reparsed.value.kind}/${reparsed.value.body.kind}`
        : reparsed.error.map(error => error.message).join('; ')
      return err([{ code: 'INVALID_PAYLOAD', message: `serialized payload is not a valid ${kind} diagram: ${detail}` }])
    }
    // Publish the parser-admitted snapshot, not the caller's retained graph.
    // Reparse normalization prevents malformed optional metadata and nested
    // records from surviving a nominally successful synthesis.
    return ok({ ...reparsed.value, canonicalSource: serializeMermaid(reparsed.value) })
  } catch (e) {
    return err([{ code: 'INVALID_PAYLOAD', message: `could not rebuild diagram from payload: ${(e as Error).message}` }])
  }
}

function rebuildFromPayload(payload: ValidDiagramPayload): Result<ValidDiagram, ParseError[]> {
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
    // A flowchart payload with a missing/empty node map is malformed but not fatal: default to
    // an empty map. Exotic shapes (a non-tuple array) fall through to the boundary's error net.
    const nodesMap = Array.isArray(sg?.nodes)
      ? new Map(sg.nodes)
      : (sg?.nodes ? new Map(Object.entries(sg.nodes)) : new Map())
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
  } else if (payload.body.kind === 'extension') {
    return err([{ code: 'INVALID_PAYLOAD', message: 'extension payload must be reparsed through its registered descriptor' }])
  } else if (payload.body.kind === 'opaque' || knownFamilies().includes(payload.body.kind as never)) {
    // Structured bodies pass through verbatim (flowchart is rebuilt above).
    // Membership is derived from the family registry rather than a hand-kept
    // kind list — the old list silently dropped pie and quadrant payloads to
    // INVALID_PAYLOAD, and would have done the same to any new family.
    body = payload.body
  } else {
    return err([{ code: 'INVALID_PAYLOAD', message: 'unknown body kind' }])
  }

  const draft: ValidDiagram = {
    kind: payload.kind as ValidDiagram['kind'], meta, body,
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
