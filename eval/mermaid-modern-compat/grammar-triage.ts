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
  exportRefusal?: string
  renderability?: 'passed' | 'failed' | 'not-checked'
  defects: Array<{ kind: GrammarDefectKind; detail: string; trackedBy?: number }>
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value

/** Compare declared native meaning, retaining public identities. Only actual
 * private spacers and equivalent pixel-width spellings lose representation
 * details; authored IDs and text remain exact. */
function meaning(family: string, observation: NativeParserObservation): unknown {
  if (!observation.semantic) return undefined
  const value = structuredClone(observation.semantic.value)
  if (family === 'quadrant') {
    const data = record(value)
    const styles = [...(data.points as Array<Record<string, unknown>>).map(point => record(point.style)), ...Object.values(record(data.classDefs)).map(record)]
    for (const style of styles) if (typeof style.strokeWidth === 'string' && /^\d+(?:\.\d+)?(?:px)?$/.test(style.strokeWidth)) style.strokeWidth = Number.parseFloat(style.strokeWidth)
    return stable(value)
  }
  if (family !== 'block') return stable(value)
  const data = record(value), nodes = data.nodes as Array<Record<string, unknown>>
  const actual: Array<{ id: unknown; parent: unknown; space: boolean }> = []
  const visit = (parent: Record<string, unknown>, parentId: unknown): void => {
    for (const item of parent.children as unknown[] ?? []) {
      const node = record(item)
      const space = node.type === 'space'
      actual.push({ id: space ? { spacer: actual.length, parent: parentId } : node.id, parent: parentId, space })
      visit(node, node.id)
    }
  }
  visit(record(record(observation.model).root), '')
  if (actual.length !== nodes.length) throw new Error('Block semantic projection/model scope differs')
  const ids = new Map(nodes.map((node, i) => [node.id, actual[i]!.id]))
  nodes.forEach((node, i) => {
    node.id = actual[i]!.id
    node.parent = actual[i]!.parent
    if (actual[i]!.space) node.label = ''
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
  try {
    const verification = verifyMermaid(witness.source)
    result.warningCodes = [...new Set(verification.warnings.map(w => w.code))]
    result.renderability = verification.checks?.renderability
  }
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
    if ((!result.defects.some(item => item.kind === 'verification-error') && !announces(result.warningCodes)) || edit.ok) defect('source-only-admission', 'Source-only input must carry a source diagnostic and refuse typed mutation')
    result.disposition = result.defects.length ? 'defect' : 'diagnosed-limitation'
    return result
  }
  const before = inspectAgenticGrammar(witness.family, witness.source)
  assertInstrumentation(before.native.observation)
  if (before.native.status !== 'accepted' && !announces(result.warningCodes)) defect('native-admission', before.native.error ?? 'Typed admission and native renderer admission disagree without a source diagnostic')
  let written: GrammarReferenceReply
  try {
    result.canonical = serializeMermaid(parsed.value, { wrapper: 'canonical' })
    written = await parseReference(witness.family, result.canonical)
  } catch (error) {
    // Failed reference transport/instrumentation must not become a product issue.
    if (result.canonical !== undefined) throw error
    // Canonical wrapper mode explicitly declines invalid/over-budget config;
    // that documented refusal is not an invalid source string being emitted.
    if (error instanceof Error && error.message.startsWith('Cannot export canonical Mermaid:')) {
      result.exportRefusal = error.message
      result.disposition = result.defects.length ? 'defect' : 'diagnosed-limitation'
      return result
    }
    defect('portable-export', `Structured serialization threw: ${String(error)}`)
    result.disposition = 'defect'
    return result
  }
  if (written.instrumentationErrors?.length) throw new Error(written.instrumentationErrors.join('; '))
  if (!written.accepted || canonical(written.detectedType ?? written.type) !== witness.family) defect('portable-export', written.error ?? 'Canonical export changed diagram family')
  const after = inspectAgenticGrammar(witness.family, result.canonical)
  assertInstrumentation(after.native.observation)
  if (before.native.status === 'accepted' && result.renderability === 'passed' && after.native.status !== 'accepted') defect('native-reload', after.native.error ?? 'Native reader rejects its canonical output')
  result.semanticFields = before.native.observation.semantic?.fields ?? []
  if (nativeMeaningChanged(witness.family, before.native.observation, after.native.observation)) defect('meaning-change', `Selected native fields changed on reload: ${result.semanticFields.join(', ')}`)
  result.disposition = result.defects.length ? 'defect' : (before.native.status !== 'accepted' || result.renderability === 'failed') && announces(result.warningCodes) ? 'diagnosed-limitation' : 'reader-extension'
  return result
}
