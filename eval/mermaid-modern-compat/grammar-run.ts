import { execFileSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonical, harvestModernCorpus, type Sample } from './corpus.ts'
import { type AgenticGrammarResult, inspectAgenticGrammar } from './grammar-agentic.ts'
import { projectNativeOperations, projectReferenceOperations } from './grammar-native-operations.ts'
import { projectReferenceSemantic } from './grammar-native-semantics.ts'
import { startGrammarReference } from './grammar-reference.ts'
import type { GrammarObservation, GrammarReferenceReply } from './grammar-types.ts'
import { admitModernReference } from './reference.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const agenticRoot = resolve(HERE, '../..')
const agenticCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: agenticRoot, encoding: 'utf8' }).trim()
const agenticDirty = execFileSync('git', ['status', '--porcelain'], { cwd: agenticRoot, encoding: 'utf8' }).trim().length > 0
const args = process.argv.slice(2)
function option(name: string, fallback: string): string {
  const at = args.indexOf(name)
  if (at < 0) return fallback
  const value = args[at + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`)
  return value
}
if (args.includes('--help')) {
  console.log('bun run eval/mermaid-modern-compat/grammar-run.ts [--mermaid-dir PATH] [--reference-dir PATH] [--fuzz 5000] [--seed 7] [--workers 4] [--families flowchart,sequence] [--docs-only] [--output PATH]')
  process.exit(0)
}
const upstream = resolve(option('--mermaid-dir', process.env.MERMAID_UPSTREAM_DIR ?? join(HERE, '../../../mermaid')))
const referenceDir = resolve(option('--reference-dir', process.env.MERMAID_REFERENCE_DIR ?? join(HERE, '../../../mermaid-reference')))
const output = resolve(option('--output', join(HERE, 'output/grammar')))
const fuzz = Number(option('--fuzz', '5000')),
  seed = Number(option('--seed', '7')),
  workers = Number(option('--workers', '4'))
if (!Number.isSafeInteger(fuzz) || fuzz < 0 || fuzz > 100_000) throw new Error('--fuzz must be 0..100000 per family')
if (!Number.isSafeInteger(seed)) throw new Error('--seed must be an integer')
if (!Number.isSafeInteger(workers) || workers < 1 || workers > 8) throw new Error('--workers must be 1..8')
const reference = admitModernReference(upstream, referenceDir)
const harvested = harvestModernCorpus(upstream, !args.includes('--docs-only'))
const allFamilies = [...harvested.expectedFamilies].sort()
const families = option('--families', allFamilies.join(',')).split(',').filter(Boolean)
for (const family of families) if (!harvested.expectedFamilies.has(family)) throw new Error(`Unknown core family: ${family}`)
mkdirSync(output, { recursive: true })

interface Counters {
  inputs: number
  referenceAccepted: number
  referenceRejected: number
  nativeAccepted: number
  nativeRejected: number
  nativeUnsupported: number
  acceptanceSame: number
  referenceOnly: number
  agenticOnly: number
  structured: number
  opaque: number
  preserved: number
  envelopeRejected: number
  writerCompared: number
  writerRejected: number
  writerRejectedFromAccepted: number
  writerRejectedFromRejected: number
  writerFamilyChanged: number
  unchangedSource: number
  tokenStreamsCompared: number
  tokenStreamsChanged: number
  actionStreamsCompared: number
  actionStreamsChanged: number
  astCompared: number
  astChanged: number
  modelCompared: number
  modelDriftCandidates: number
  unstableObservations: number
  nativeStatementStreamsObserved: number
  nativeStatementEvents: number
  nativeTokenStreamsObserved: number
  nativeTokenEvents: number
  nativeMutationStreamsObserved: number
  nativeMutationEvents: number
  nativeControlsCompared: number
  nativeControlsChanged: number
  nativeSemanticsCompared: number
  nativeSemanticsChanged: number
  nativeSemanticsUnavailable: number
  nativeOperationsCompared: number
  nativeOperationsChanged: number
  nativeOperationsUnavailable: number
  nativeOperationItemsCompared: number
  referenceOperationItemsCompared: number
}
const counters = (): Counters => ({
  inputs: 0,
  referenceAccepted: 0,
  referenceRejected: 0,
  nativeAccepted: 0,
  nativeRejected: 0,
  nativeUnsupported: 0,
  acceptanceSame: 0,
  referenceOnly: 0,
  agenticOnly: 0,
  structured: 0,
  opaque: 0,
  preserved: 0,
  envelopeRejected: 0,
  writerCompared: 0,
  writerRejected: 0,
  writerRejectedFromAccepted: 0,
  writerRejectedFromRejected: 0,
  writerFamilyChanged: 0,
  unchangedSource: 0,
  tokenStreamsCompared: 0,
  tokenStreamsChanged: 0,
  actionStreamsCompared: 0,
  actionStreamsChanged: 0,
  astCompared: 0,
  astChanged: 0,
  modelCompared: 0,
  modelDriftCandidates: 0,
  unstableObservations: 0,
  nativeStatementStreamsObserved: 0,
  nativeStatementEvents: 0,
  nativeTokenStreamsObserved: 0,
  nativeTokenEvents: 0,
  nativeMutationStreamsObserved: 0,
  nativeMutationEvents: 0,
  nativeControlsCompared: 0,
  nativeControlsChanged: 0,
  nativeSemanticsCompared: 0,
  nativeSemanticsChanged: 0,
  nativeSemanticsUnavailable: 0,
  nativeOperationsCompared: 0,
  nativeOperationsChanged: 0,
  nativeOperationsUnavailable: 0,
  nativeOperationItemsCompared: 0,
  referenceOperationItemsCompared: 0,
})
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
function assertReferenceInstrumentation(reply: GrammarReferenceReply, context: string): void {
  if (reply.instrumentationErrors?.length) throw new Error(`Reference instrumentation error in ${context}: ${reply.instrumentationErrors.join('; ')}`)
}
function assertNativeInstrumentation(result: AgenticGrammarResult, context: string): void {
  const observation = result.native.observation
  if (observation.instrumentationErrors?.length) throw new Error(`Native instrumentation error in ${context}: ${observation.instrumentationErrors.join('; ')}`)
  if (observation.control && !observation.control.same) throw new Error(`Observation changed the native parser result in ${context}: ${JSON.stringify(observation.control)}`)
}
/** Sort object keys only. Ordered events, edges, declarations and parent links
 * remain in the independently selected family semantics. */
function orderedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedValue)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, orderedValue(item)]),
    )
  return value
}
function compareNativeSemantic(before: GrammarReferenceReply, agentic: AgenticGrammarResult) {
  if (!before.accepted) return { status: 'unavailable' as const, reason: 'Reference grammar rejected this input' }
  if (agentic.native.status !== 'accepted') return { status: 'unavailable' as const, reason: `Native parser ${agentic.native.status}` }
  const native = agentic.native.observation.semantic
  const reference = projectReferenceSemantic(before.requestedFamily, before)
  if (!native || !reference) return { status: 'unavailable' as const, reason: 'No independent selected-field adapter for this family/model' }
  if (!equal([...native.fields].sort(), [...reference.fields].sort())) throw new Error(`Native/reference semantic field scopes differ for ${before.requestedFamily}`)
  const left = orderedValue(reference.value),
    right = orderedValue(native.value)
  const same = equal(left, right)
  return { status: 'compared' as const, same, fields: native.fields, reference: reference.value, ...(same ? {} : { firstDifference: firstDifference(left, right) }) }
}
function firstDifference(a: unknown, b: unknown, path = '$'): unknown {
  if (equal(a, b)) return undefined
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`)
      if (difference !== undefined) return difference
    }
  }
  return { path, before: a ?? null, after: b ?? null }
}
function compareObservation<T>(before: GrammarObservation<T>, after: GrammarObservation<T>, control?: GrammarObservation<T>) {
  if (before.status !== 'available' || after.status !== 'available') return { status: 'unavailable' as const }
  if (control && (control.status !== 'available' || !equal(before.value, control.value))) return { status: 'unstable' as const }
  return { status: 'compared' as const, same: equal(before.value, after.value), ...(equal(before.value, after.value) ? {} : { firstDifference: firstDifference(before.value, after.value) }) }
}
function compareModels(before: GrammarReferenceReply, after: GrammarReferenceReply, control?: GrammarReferenceReply) {
  if (!before.snapshot || !after.snapshot) return { status: 'unavailable' as const }
  const original = before.snapshot.data,
    serialized = after.snapshot.data
  const keys = [...new Set([...Object.keys(original), ...Object.keys(serialized)])].sort()
  const excluded = control?.snapshot ? keys.filter(key => !equal(original[key], control.snapshot!.data[key])) : []
  const stable = keys.filter(key => !excluded.includes(key))
  if (!stable.length) return { status: 'unavailable' as const, excluded }
  const changed = stable.filter(key => !equal(original[key], serialized[key]))
  return { status: 'compared' as const, same: changed.length === 0, changed, excluded, ...(changed.length ? { firstDifference: firstDifference(original[changed[0]!], serialized[changed[0]!], `$.${changed[0]}`) } : {}) }
}

function compareNativeOperations(before: GrammarReferenceReply, agentic: AgenticGrammarResult) {
  const mutations = agentic.native.observation.mutations
  if (mutations.status !== 'available') return { status: 'unavailable' as const, reason: mutations.reason }
  const native = projectNativeOperations(before.requestedFamily, mutations.value),
    reference = projectReferenceOperations(before.requestedFamily, before)
  if (!native || !reference) return { status: 'unavailable' as const, reason: 'Recorded native mutation/reference action operands are not available for this family' }
  if (!before.accepted || agentic.native.status !== 'accepted') return { status: 'unavailable' as const, reason: 'Both engines must accept before ordered operations are compared', native, reference }
  if (!native.operations.length && !reference.operations.length) return { status: 'unavailable' as const, reason: 'Neither trace contains an operation in the declared scope', native, reference }
  const left = orderedValue(reference.operations),
    right = orderedValue(native.operations),
    same = equal(left, right)
  return { status: 'compared' as const, same, native, reference, ...(same ? {} : { firstDifference: firstDifference(left, right) }) }
}

interface Comparison {
  acceptance: 'unavailable' | 'same' | 'reference-only' | 'agentic-only'
  writerAccepted?: boolean
  writerError?: string
  writerFamilySame?: boolean
  tokens?: ReturnType<typeof compareObservation>
  actions?: ReturnType<typeof compareObservation>
  ast?: ReturnType<typeof compareObservation>
  model?: ReturnType<typeof compareModels>
  nativeSemantic: ReturnType<typeof compareNativeSemantic>
  nativeOperations: ReturnType<typeof compareNativeOperations>
}
function compareCase(before: GrammarReferenceReply, agentic: AgenticGrammarResult, after?: GrammarReferenceReply, control?: GrammarReferenceReply): Comparison {
  const acceptance = agentic.native.status === 'unsupported' ? 'unavailable' : before.accepted === (agentic.native.status === 'accepted') ? 'same' : before.accepted ? 'reference-only' : 'agentic-only'
  const nativeSemantic = compareNativeSemantic(before, agentic)
  const nativeOperations = compareNativeOperations(before, agentic)
  if (!after) return { acceptance, nativeSemantic, nativeOperations }
  const familySame = canonical(before.type) === canonical(after.detectedType ?? after.type)
  return {
    acceptance,
    nativeSemantic,
    nativeOperations,
    writerAccepted: after.accepted,
    writerFamilySame: familySame,
    ...(after.error ? { writerError: after.error } : {}),
    ...(before.accepted && after.accepted
      ? {
          tokens: compareObservation(before.tokens, after.tokens, control?.tokens),
          actions: compareObservation(before.actions, after.actions, control?.actions),
          ast: compareObservation(before.ast, after.ast, control?.ast),
          model: compareModels(before, after, control),
        }
      : {}),
  }
}
function count(c: Counters, before: GrammarReferenceReply, agentic: AgenticGrammarResult, result: Comparison, unchanged: boolean): void {
  c.inputs++
  if (before.accepted) c.referenceAccepted++
  else c.referenceRejected++
  if (agentic.native.status === 'accepted') c.nativeAccepted++
  else if (agentic.native.status === 'rejected') c.nativeRejected++
  else c.nativeUnsupported++
  const native = agentic.native.observation
  for (const [field, streams, events] of [
    ['statements', 'nativeStatementStreamsObserved', 'nativeStatementEvents'],
    ['tokens', 'nativeTokenStreamsObserved', 'nativeTokenEvents'],
    ['mutations', 'nativeMutationStreamsObserved', 'nativeMutationEvents'],
  ] as const)
    if (native[field].status === 'available') {
      c[streams]++
      c[events] += native[field].value.length
    }
  if (native.control) {
    c.nativeControlsCompared++
    if (!native.control.same) c.nativeControlsChanged++
  }
  if (result.nativeSemantic.status === 'compared') {
    c.nativeSemanticsCompared++
    if (!result.nativeSemantic.same) c.nativeSemanticsChanged++
  } else c.nativeSemanticsUnavailable++
  if (result.nativeOperations.status === 'compared') {
    c.nativeOperationsCompared++
    if (!result.nativeOperations.same) c.nativeOperationsChanged++
    c.nativeOperationItemsCompared += result.nativeOperations.native.operations.length
    c.referenceOperationItemsCompared += result.nativeOperations.reference.operations.length
  } else c.nativeOperationsUnavailable++
  if (result.acceptance === 'same') c.acceptanceSame++
  else if (result.acceptance === 'reference-only') c.referenceOnly++
  else if (result.acceptance === 'agentic-only') c.agenticOnly++
  if (agentic.envelope.status === 'rejected') c.envelopeRejected++
  else if (agentic.envelope.representation === 'structured') c.structured++
  else if (agentic.envelope.representation === 'opaque') c.opaque++
  else if (agentic.envelope.representation === 'preserved') c.preserved++
  if (result.writerAccepted !== undefined) {
    c.writerCompared++
    if (!result.writerAccepted) {
      c.writerRejected++
      if (before.accepted) c.writerRejectedFromAccepted++
      else c.writerRejectedFromRejected++
    }
    if (!result.writerFamilySame) c.writerFamilyChanged++
    if (unchanged) c.unchangedSource++
  }
  for (const [field, compared, changed] of [
    ['tokens', 'tokenStreamsCompared', 'tokenStreamsChanged'],
    ['actions', 'actionStreamsCompared', 'actionStreamsChanged'],
    ['ast', 'astCompared', 'astChanged'],
    ['model', 'modelCompared', 'modelDriftCandidates'],
  ] as const) {
    const observation = result[field]
    if (observation?.status === 'compared') {
      c[compared]++
      if (!observation.same) c[changed]++
    }
    if (observation?.status === 'unstable') c.unstableObservations++
  }
}

function random(initial: number): () => number {
  let state = initial >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}
function mutate(seeds: readonly Sample[], fragments: readonly string[], rnd: () => number): { source: string; parent: string } {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
  const parent = pick(seeds)
  let source = parent.source
  const edits = 1 + Math.floor(rnd() * 3)
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(rnd() * (source.length + 1)),
      choice = rnd()
    if (choice < 0.35) source = source.slice(0, at) + pick(fragments) + source.slice(at)
    else if (choice < 0.6) source = source.slice(0, at) + source.slice(at + 1 + Math.floor(rnd() * 3))
    else if (choice < 0.75) {
      const other = pick(seeds).source,
        from = Math.floor(rnd() * other.length)
      source = source.slice(0, at) + other.slice(from, from + Math.floor(rnd() * 20)) + source.slice(at)
    } else if (choice < 0.9) source = source.slice(0, at) + source.slice(at, at + Math.floor(rnd() * 6)) + source.slice(at)
    else source = source.slice(0, at) + pick(fragments) + source.slice(at + 1)
  }
  return { source, parent: parent.id }
}

const pending = [...families]
const results: unknown[] = []
async function worker(): Promise<void> {
  const oracle = startGrammarReference(referenceDir, upstream)
  try {
    for (let family = pending.shift(); family; family = pending.shift()) {
      const samples = [...harvested.corpus.values()].filter(sample => sample.provenance.some(origin => origin.familyHint === family))
      const validSeed = samples.find(sample => sample.provenance.some(origin => origin.kind === 'docs' && origin.familyHint === family))
      if (!validSeed) throw new Error(`No official documentation seed for ${family}`)
      const preparation = await oracle.prepare(family, validSeed.source)
      // Observation hooks must preserve the release parser's behavior. Only
      // getters stable under an observed repeat can establish that control.
      const observedSeed = await oracle.parse(family, validSeed.source)
      assertReferenceInstrumentation(observedSeed, `${family}/seed/observed`)
      const unobservedSeed = await oracle.control(family, validSeed.source)
      assertReferenceInstrumentation(unobservedSeed, `${family}/seed/unobserved`)
      const repeatedSeed = await oracle.parse(family, validSeed.source)
      assertReferenceInstrumentation(repeatedSeed, `${family}/seed/repeated`)
      const observationControl = compareModels(observedSeed, unobservedSeed, repeatedSeed)
      if (observedSeed.accepted !== unobservedSeed.accepted || (observationControl.status === 'compared' && !observationControl.same)) {
        throw new Error(`Observation changed the real reference semantics for ${family}: ${JSON.stringify(observationControl)}`)
      }
      const corpusCounts = counters(),
        mutationCounts = counters()
      const vocabulary = new Set([' ', '\n', '\r\n', '\t', ';', ':', ',', '"', "'", '{', '}', '[', ']', '(', ')', '%%', 'é', '-->', 'end'])
      const examples: unknown[] = []
      const stream = openSync(join(output, `${family}.jsonl`), 'w')
      let details = 0
      const detailCounts = new Map<string, number>()
      const detailStream = openSync(join(output, `${family}-examples.jsonl`), 'w')
      try {
        async function assess(batch: readonly Sample[], c: Counters): Promise<void> {
          const originals = await oracle.parseMany(batch.map(sample => ({ family: family!, source: sample.source })))
          originals.forEach((reply, i) => assertReferenceInstrumentation(reply, `${family}/${batch[i]!.id}/original`))
          const local = batch.map(sample => inspectAgenticGrammar(family!, sample.source))
          local.forEach((result, i) => assertNativeInstrumentation(result, `${family}/${batch[i]!.id}`))
          const extraRequests: Array<{ family: string; source: string }> = []
          const indices = batch.map((sample, i) => {
            const serialized = local[i]!.serialized
            if (serialized === undefined) return undefined
            if (serialized === sample.source) return { unchanged: true as const }
            const afterIndex = extraRequests.length
            extraRequests.push({ family: family!, source: serialized })
            const controlIndex = originals[i]!.accepted ? extraRequests.length : undefined
            if (controlIndex !== undefined) extraRequests.push({ family: family!, source: sample.source })
            return { unchanged: false as const, afterIndex, controlIndex }
          })
          const extra = extraRequests.length ? await oracle.parseMany(extraRequests) : []
          for (let i = 0; i < batch.length; i++) {
            const sample = batch[i]!,
              before = originals[i]!,
              agentic = local[i]!,
              index = indices[i]
            const after = index ? (index.unchanged ? before : extra[index.afterIndex]) : undefined
            const control = index && !index.unchanged && index.controlIndex !== undefined ? extra[index.controlIndex] : undefined
            if (after) assertReferenceInstrumentation(after, `${family}/${sample.id}/serialized`)
            if (control) assertReferenceInstrumentation(control, `${family}/${sample.id}/original-repeat`)
            const result = compareCase(before, agentic, after, control)
            count(c, before, agentic, result, index?.unchanged === true)
            if (before.tokens.status === 'available' && vocabulary.size < 240) for (const [, image] of before.tokens.value) if (image && image.length <= 40) vocabulary.add(image)
            const compact = {
              id: sample.id,
              source: sample.source,
              origins: sample.provenance,
              reference: { accepted: before.accepted, type: before.type, error: before.error, engine: before.engine, tokens: before.tokens.status, actions: before.actions.status, ast: before.ast.status, instrumentationErrors: before.instrumentationErrors },
              agentic,
              comparison: result,
            }
            writeSync(stream, JSON.stringify(compact) + '\n')
            const reason =
              result.acceptance === 'reference-only' || result.acceptance === 'agentic-only'
                ? 'native-admission'
                : result.writerAccepted === false
                  ? 'writer-rejection'
                  : result.nativeSemantic.status === 'compared' && !result.nativeSemantic.same
                    ? 'native-semantic-drift'
                    : result.nativeOperations.status === 'compared' && !result.nativeOperations.same
                      ? 'native-operation-drift'
                      : result.model?.status === 'compared' && !result.model.same
                        ? 'model-drift'
                        : result.ast?.status === 'compared' && !result.ast.same
                          ? 'ast-drift'
                          : result.actions?.status === 'compared' && !result.actions.same
                            ? 'action-stream'
                            : result.tokens?.status === 'compared' && !result.tokens.same
                              ? 'token-stream'
                              : undefined
            if (reason && details < 48 && (detailCounts.get(reason) ?? 0) < 8) {
              writeSync(detailStream, JSON.stringify({ ...compact, originalGrammar: before, serializedGrammar: after, originalRepeat: control }) + '\n')
              examples.push({ id: sample.id, reason, comparison: result })
              details++
              detailCounts.set(reason, (detailCounts.get(reason) ?? 0) + 1)
            }
          }
        }
        for (let at = 0; at < samples.length; at += 32) await assess(samples.slice(at, at + 32), corpusCounts)
        const seeds = samples.filter(sample => sample.source.length <= 4000)
        if (!seeds.length) throw new Error(`No bounded mutation seeds for ${family}`)
        const rnd = random(seed)
        const fragments = [...vocabulary]
        let attempts = 0,
          tooLong = 0
        for (let at = 0; at < fuzz; ) {
          const batch: Sample[] = []
          while (batch.length < Math.min(32, fuzz - at)) {
            if (++attempts > Math.max(1000, fuzz * 10)) throw new Error(`Cannot generate ${fuzz} bounded mutations for ${family}`)
            const mutation = mutate(seeds, fragments, rnd)
            if (mutation.source.length > 4000) {
              tooLong++
              continue
            }
            batch.push({ id: `${family}-mutation-${seed}-${at + batch.length}`, source: mutation.source, provenance: [{ kind: 'mutation', file: '<seeded grammar mutation>', line: at + batch.length + 1, familyHint: family, parent: mutation.parent }] })
          }
          await assess(batch, mutationCounts)
          at += batch.length
          if (at % 1024 === 0) console.log(`${family}: corpus ${samples.length}, mutations ${at}/${fuzz}`)
        }
        const row = {
          family,
          nativeAdmissionProfile: 'canonical-renderer-request',
          preparation,
          observationControl,
          corpus: corpusCounts,
          mutations: mutationCounts,
          mutationGeneration: { requested: fuzz, executed: mutationCounts.inputs, attempts, skippedOver4000: tooLong, seed, fragmentCount: fragments.length },
          examples,
        }
        results.push(row)
        writeFileSync(join(output, `${family}-summary.json`), JSON.stringify(row, null, 2) + '\n')
        console.log(`${family}: complete; reference-only ${corpusCounts.referenceOnly + mutationCounts.referenceOnly}, agentic-only ${corpusCounts.agenticOnly + mutationCounts.agenticOnly}, model drift candidates ${corpusCounts.modelDriftCandidates + mutationCounts.modelDriftCandidates}`)
      } finally {
        closeSync(stream)
        closeSync(detailStream)
      }
    }
  } finally {
    oracle.close()
  }
}

console.log(`Mermaid ${reference.version}: ${families.length} core families, ${fuzz} mutations EACH, seed ${seed}, ${workers} workers`)
await Promise.all(Array.from({ length: Math.min(workers, families.length) }, worker))
results.sort((a, b) => (a as { family: string }).family.localeCompare((b as { family: string }).family))
const summary = {
  generatedAt: new Date().toISOString(),
  reference,
  agenticCommit,
  agenticDirty,
  agenticCommitAtCompletion: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: agenticRoot, encoding: 'utf8' }).trim(),
  agenticDirtyAtCompletion: execFileSync('git', ['status', '--porcelain'], { cwd: agenticRoot, encoding: 'utf8' }).trim().length > 0,
  invocation: process.argv.slice(2),
  method: {
    reference: 'Actual selected Mermaid grammar, tokens and semantic actions or AST; forced family also on malformed headers.',
    acceptance: 'Actual native Agentic renderer parser; opaque/preserved envelopes are separate, unsupported families unavailable.',
    tokensAndActions: 'Original reference stream versus reference parsing of Agentic structured serialization. This is round-trip observation, NOT direct Agentic lexer/yy parity.',
    nativeObservations: 'Actual native consumed classified statements, Flowchart compound fragments and builder operations in actual execution order, including deferred and two-phase writes; values copied at call time. Every observed native attempt has an unobserved acceptance/error/model control.',
    nativeTokenParity: 'unavailable: native statement/fragment kinds are not homologous Mermaid terminal kinds; both actual streams are retained separately',
    nativeActionParity: 'unavailable: native builder operations are not the Mermaid yy protocol; both actual operation streams are retained separately',
    nativeSemantics:
      'Independent family adapters compare declared selected semantic fields from native parser models against actual reference getters/actions/AST. Parents, endpoints, marker sides, logical IDs and ordered authored values are retained where applicable. Differences remain diagnostics pending review, not proof of a bug.',
    nativeOperations:
      'Independent scoped adapters compare ordered operands from ACTUAL native mutation events and ACTUAL reference calls, expanding only recorded batch arguments (State/Sequence/Radar). Returned IR, getter snapshots and serialized text are not used to construct operation streams. Operations are never sorted. Every case records scope and selected/unmapped source-event and batch-operand counts; omitted operations and empty traces are not full parity evidence.',
    interpretation:
      'Raw stream differences are diagnostics. Whitespace, declaration ordering, normalization and intentional generous input policies may differ. Round-trip model snapshots compare normalized values from stable getters and retain parent fields, with explicit normalization of non-JSON values/cycles; they cannot alone prove full fidelity. Selected-field native semantics have explicit per-family scope. Drift candidates require semantic review.',
    corpus: 'Official documentation plus static upstream spec literals; extracted literals do not port upstream assertions.',
    unsupported: 'Source-preserved or opaque success is never counted as native grammar or semantic fidelity.',
  },
  coreFamiliesAvailable: allFamilies.length,
  familiesAssessed: families.length,
  mutationsPerFamily: fuzz,
  seed,
  skippedInterpolatedTemplates: harvested.skippedInterpolatedTemplates,
  families: results,
}
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`Saved ${join(output, 'summary.json')}`)
