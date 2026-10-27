import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../src/agent/core.ts'
import { canonical } from './corpus.ts'
import { inspectAgenticGrammar } from './grammar-agentic.ts'
import { announces } from './grammar-silent-reads.ts'
import type { GrammarReferenceReply, NativeParserObservation } from './grammar-types.ts'

export type GrammarDefectKind = 'portable-export' | 'native-admission' | 'native-reload' | 'reader-regression' | 'meaning-change' | 'source-only-admission' | 'verification-error'
export interface GrammarWitness { family: string; source: string }
export interface ReviewedGrammarWitness extends GrammarWitness {
  disposition: 'reader-extension' | 'diagnosed-limitation' | 'tracked-defect'
  reason: string
  origins: Array<{ seed: number; id: string; role: string }>
  followup?: { issue: number; kinds: GrammarDefectKind[] }
}
export interface GrammarReviewCorpus {
  version: number
  reference: string
  referenceCommit: string
  cases: ReviewedGrammarWitness[]
}
export interface GrammarTriageResult extends GrammarWitness {
  disposition: 'reader-extension' | 'diagnosed-limitation' | 'rejected' | 'defect'
  reviewed?: ReviewedGrammarWitness['disposition']
  canonical?: string
  referenceAccepted: boolean
  warningCodes: string[]
  semanticFields: string[]
  defects: Array<{ kind: GrammarDefectKind; detail: string; trackedBy?: number }>
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value

/** Compare declared native meaning, retaining public identities. Block's `na`
 * and `square` both render rectangles (block/layout.ts); native observation
 * aliases for generated groups are replaced with their actual model IDs on
 * both sides, never inferred from an authored ID's spelling. */
function meaning(family: string, observation: NativeParserObservation): unknown {
  if (!observation.semantic) return undefined
  const value = structuredClone(observation.semantic.value)
  if (family !== 'block') return stable(value)
  const data = record(value), nodes = data.nodes as Array<Record<string, unknown>>
  const actual: Array<{ id: unknown; parent: unknown }> = []
  const visit = (parent: Record<string, unknown>, parentId: unknown): void => {
    for (const item of parent.children as unknown[] ?? []) {
      const node = record(item)
      actual.push({ id: node.id, parent: parentId })
      visit(node, node.id)
    }
  }
  visit(record(record(observation.model).root), '')
  if (actual.length !== nodes.length) throw new Error('Block semantic projection/model scope differs')
  const ids = new Map(nodes.map((node, i) => [node.id, actual[i]!.id]))
  nodes.forEach((node, i) => {
    node.id = actual[i]!.id
    node.parent = actual[i]!.parent
    if (node.type === 'na') node.type = 'square'
  })
  for (const edge of data.edges as Array<Record<string, unknown>>) {
    edge.from = ids.get(edge.from) ?? edge.from
    edge.to = ids.get(edge.to) ?? edge.to
  }
  return stable(value)
}

function assertInstrumentation(observation: NativeParserObservation): void {
  if (observation.instrumentationErrors?.length || observation.control?.same === false) throw new Error(`Native observation failed its control: ${JSON.stringify(observation.instrumentationErrors ?? observation.control)}`)
}

export function nativeMeaningChanged(family: string, before: NativeParserObservation, after: NativeParserObservation): boolean {
  const left = meaning(family, before), right = meaning(family, after)
  return left !== undefined && right !== undefined && JSON.stringify(left) !== JSON.stringify(right)
}

export async function triageGrammarWitness(
  witness: GrammarWitness,
  parseReference: (family: string, source: string) => Promise<GrammarReferenceReply>,
  reviewed?: ReviewedGrammarWitness,
): Promise<GrammarTriageResult> {
  if (reviewed && (reviewed.family !== witness.family || reviewed.source !== witness.source)) throw new Error('Review belongs to a different source')
  const reference = await parseReference(witness.family, witness.source)
  if (reference.instrumentationErrors?.length) throw new Error(reference.instrumentationErrors.join('; '))
  const result: GrammarTriageResult = { ...witness, disposition: 'rejected', ...(reviewed ? { reviewed: reviewed.disposition } : {}), referenceAccepted: reference.accepted, warningCodes: [], semanticFields: [], defects: [] }
  const defect = (kind: GrammarDefectKind, detail: string): void => {
    const trackedBy = reviewed?.followup?.kinds.includes(kind) ? reviewed.followup.issue : undefined
    result.defects.push({ kind, detail, ...(trackedBy ? { trackedBy } : {}) })
  }
  try { result.warningCodes = [...new Set(verifyMermaid(witness.source).warnings.map(w => w.code))] }
  catch (error) { defect('verification-error', String(error)) }
  const parsed = parseRegisteredMermaid(witness.source)
  if (!parsed.ok) {
    if (reviewed?.disposition === 'reader-extension') defect('reader-regression', 'A reviewed structured reader extension is now rejected')
    result.disposition = result.defects.length ? 'defect' : 'rejected'
    return result
  }
  if (parsed.value.body.kind === 'opaque' || parsed.value.body.kind === 'preserved') {
    if (reviewed?.disposition === 'reader-extension') defect('reader-regression', 'A reviewed structured reader extension became source-only')
    const edit = mutate(parsed.value, { kind: 'set_title', title: 'Grammar triage control' })
    if (!announces(result.warningCodes) || edit.ok) defect('source-only-admission', 'Source-only input must carry a source diagnostic and refuse typed mutation')
    result.disposition = result.defects.length ? 'defect' : 'diagnosed-limitation'
    return result
  }
  const before = inspectAgenticGrammar(witness.family, witness.source)
  assertInstrumentation(before.native.observation)
  if (before.native.status !== 'accepted') defect('native-admission', before.native.error ?? 'Typed admission and native renderer admission disagree')
  let written: GrammarReferenceReply
  try {
    result.canonical = serializeMermaid(parsed.value, { wrapper: 'canonical' })
    written = await parseReference(witness.family, result.canonical)
  } catch (error) {
    // Failed reference transport/instrumentation must not become a product issue.
    if (result.canonical !== undefined) throw error
    defect('portable-export', `Structured serialization threw: ${String(error)}`)
    result.disposition = 'defect'
    return result
  }
  if (written.instrumentationErrors?.length) throw new Error(written.instrumentationErrors.join('; '))
  if (!written.accepted || canonical(written.detectedType ?? written.type) !== witness.family) defect('portable-export', written.error ?? 'Canonical export changed diagram family')
  const after = inspectAgenticGrammar(witness.family, result.canonical)
  assertInstrumentation(after.native.observation)
  if (before.native.status === 'accepted' && after.native.status !== 'accepted') defect('native-reload', after.native.error ?? 'Native reader rejects its canonical output')
  result.semanticFields = before.native.observation.semantic?.fields ?? []
  if (nativeMeaningChanged(witness.family, before.native.observation, after.native.observation)) defect('meaning-change', `Selected native fields changed on reload: ${result.semanticFields.join(', ')}`)
  result.disposition = result.defects.length ? 'defect' : 'reader-extension'
  return result
}
