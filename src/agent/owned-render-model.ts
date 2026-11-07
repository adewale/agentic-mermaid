import type { AgentflowBody } from '../agentflow/types.ts'
import type { NormalizedMermaidSource } from '../mermaid-source.ts'
import type { FamilyDescriptor } from './family-registry.ts'
import type { ParsedDiagram } from './types.ts'

interface NativeModel {
  readonly parserSource: string
  readonly body: AgentflowBody
}

interface ParsedModel {
  readonly native: NativeModel
  readonly publicBody: object
  readonly canonicalSource: string
  readonly sourceText: string
  readonly authoredBody: string
  readonly owner: FamilyDescriptor
}

/** Opaque custody, never a caller's assertion that a model has been validated. */
export interface ParsedRenderModelHandoff { readonly parsedRenderModel?: never }

const unpublished = new WeakMap<object, NativeModel>()
const publications = new WeakMap<ParsedDiagram, ParsedModel>()
const handoffs = new WeakMap<ParsedRenderModelHandoff, { readonly parsed: ParsedModel; readonly source: string }>()
const requestModels = new WeakMap<Readonly<NormalizedMermaidSource>, NativeModel>()

/** Called only by the native parser before its mutable public body escapes.
 * The private copy is a model handoff, not rendered/layout output. Its graph
 * is copied by the presentation projection; metadata is only read there. */
export function retainParsedAgentflowModel(body: AgentflowBody, parserSource: string): void {
  unpublished.set(body, { parserSource, body: structuredClone(body) })
}

export function publishParsedRenderModel(
  diagram: ParsedDiagram,
  family: FamilyDescriptor,
  parserSource: string,
  authoredBody: string,
  sourceText: string,
): void {
  const native = unpublished.get(diagram.body)
  unpublished.delete(diagram.body)
  if (!native || native.parserSource !== parserSource || diagram.kind !== 'agentflow' || diagram.body.kind !== 'agentflow') return
  publications.set(diagram, {
    native,
    publicBody: diagram.body,
    canonicalSource: diagram.canonicalSource,
    sourceText,
    authoredBody,
    owner: family,
  })
}

/** A typed mutation already closes through the same parser. Transfer its
 * source-bound custody instead of serializing and parsing that model again. */
export function transferParsedRenderModel(from: ParsedDiagram, to: ParsedDiagram): void {
  const parsed = publications.get(from)
  if (!parsed || to.kind !== 'agentflow' || to.body.kind !== 'agentflow' || to.canonicalSource !== parsed.sourceText) return
  publications.set(to, { ...parsed, publicBody: to.body, canonicalSource: to.canonicalSource })
}

function currentModel(diagram: ParsedDiagram): ParsedModel | undefined {
  const parsed = publications.get(diagram)
  // Canonical source is AgentFlow's existing rendering authority. Direct body
  // mutation is deliberately not a new authority; source edits, replacement
  // envelopes and changed family producers must use the ordinary parser.
  return parsed && diagram.kind === 'agentflow' && diagram.body === parsed.publicBody
    && diagram.body.kind === 'agentflow' && diagram.canonicalSource === parsed.canonicalSource
    ? parsed : undefined
}

/** Preserve indentation significant to YAML instead of reconstructing its
 * body from canonicalSource's line-trimmed source-map coordinates. */
export function ownedParsedRenderBody(diagram: ParsedDiagram): string | undefined {
  return currentModel(diagram)?.authoredBody
}

export function prepareParsedModelHandoff(
  diagram: ParsedDiagram,
  family: FamilyDescriptor | undefined,
  source: string,
): ParsedRenderModelHandoff | undefined {
  const parsed = currentModel(diagram)
  if (!parsed || family !== parsed.owner) return undefined
  const handoff: ParsedRenderModelHandoff = Object.freeze({})
  handoffs.set(handoff, { parsed, source })
  return handoff
}

/** Full source/config/appearance admission still runs. Bind only the exact
 * native producer input to the resulting immutable source, never a family
 * name or a public object's identity alone. */
export function admitParsedModelHandoff(
  handoff: ParsedRenderModelHandoff | undefined,
  source: Readonly<NormalizedMermaidSource>,
  family: FamilyDescriptor,
): void {
  const captured = handoff && handoffs.get(handoff)
  if (!captured || family !== captured.parsed.owner
    || source.originalText !== captured.source
    || (source.authoredFamilyBody ?? source.familyBody) !== captured.parsed.native.parserSource) return
  requestModels.set(source, captured.parsed.native)
}

/** Only the native AgentFlow layout calls this. The model never crosses a
 * public rendering result or generic family context. */
export function ownedAgentflowRenderModel(source: Readonly<NormalizedMermaidSource>): AgentflowBody | undefined {
  return requestModels.get(source)?.body
}
