import type { AgentflowBody } from '../agentflow/types.ts'
import type { NormalizedMermaidSource } from '../mermaid-source.ts'
import { stripMermaidInitDirectives } from '../mermaid-source.ts'
import type { MermaidGraph } from '../types.ts'
import type { FamilyDescriptor } from './family-registry.ts'
import type { ParsedDiagram } from './types.ts'

interface NativeModel {
  readonly parserSource: string
  readonly graph: MermaidGraph
}

interface ParsedModel {
  readonly native: NativeModel
  readonly publicBody: object
  readonly canonicalSource: string
  readonly sourceText: string
  readonly authoredBody: string
  readonly directiveSpellings: readonly string[]
  readonly owner: FamilyDescriptor
}

/** Opaque custody, never a caller's assertion that a model has been validated. */
export interface ParsedRenderModelHandoff { readonly parsedRenderModel?: never }

const unpublished = new WeakMap<object, NativeModel>()
const publications = new WeakMap<ParsedDiagram, ParsedModel>()
const handoffs = new WeakMap<ParsedRenderModelHandoff, { readonly parsed: ParsedModel; readonly source: string }>()
const requestModels = new WeakMap<Readonly<NormalizedMermaidSource>, NativeModel>()

/** Called only by the native parser with the shared projector's fresh graph
 * before the mutable public body escapes. Retain the rendering model, not a
 * second copy of arbitrary YAML, source mappings or layout/render output. */
export function retainParsedAgentflowModel(body: AgentflowBody, parserSource: string, graph: MermaidGraph): void {
  unpublished.set(body, { parserSource, graph })
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
    directiveSpellings: diagram.meta.initDirectives.map(directive => directive.raw),
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
  const parsed = currentModel(diagram)
  if (!parsed) return undefined
  const current = diagram.meta.initDirectives
  // Authored body layers may stay in place only while the envelope still
  // owns those layers. Changed/removed layers are restored by wrapperPrefix
  // from current metadata, with the same single authority as serialization.
  return current.length === parsed.directiveSpellings.length && current.every((directive, index) => directive.raw === parsed.directiveSpellings[index])
    ? parsed.authoredBody : stripMermaidInitDirectives(parsed.authoredBody)
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

/** Each layout owns its draft: wrapping and layout cannot mutate the retained
 * source-bound model. It never crosses a public result or family context. */
export function ownedAgentflowRenderGraph(source: Readonly<NormalizedMermaidSource>): MermaidGraph | undefined {
  const model = requestModels.get(source)
  return model ? structuredClone(model.graph) : undefined
}
