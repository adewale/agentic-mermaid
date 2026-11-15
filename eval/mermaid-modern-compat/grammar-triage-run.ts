import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { getFamily } from '../../src/agent/core.ts'
import { startGrammarReference } from './grammar-reference.ts'
import { triageGrammarWitness, type GrammarReviewCorpus, type GrammarTriageResult, type GrammarWitness } from './grammar-triage.ts'
import { admitCurrentReference } from './reference.ts'

const { values } = parseArgs({ options: {
  summary: { type: 'string', multiple: true },
  corpus: { type: 'string', default: join(import.meta.dir, 'corpus/grammar-finder-494.json') },
  output: { type: 'string', default: join(import.meta.dir, 'output/grammar-triage') },
  check: { type: 'boolean', default: false },
} })
const corpus = JSON.parse(readFileSync(values.corpus!, 'utf8')) as GrammarReviewCorpus
if (corpus.version !== 1 || !Array.isArray(corpus.cases)) throw new Error('Unsupported grammar review corpus')
const root = resolve(import.meta.dir, '../..')
const upstream = process.env.MERMAID_UPSTREAM_DIR ?? resolve(root, '../mermaid')
const referenceDir = process.env.MERMAID_REFERENCE_DIR ?? resolve(root, '../mermaid-reference')
const admitted = admitCurrentReference(upstream, referenceDir)
const key = (row: GrammarWitness): string => JSON.stringify([row.family, row.source])
const referenceMatches = corpus.reference === admitted.version && corpus.referenceCommit === admitted.commit
const reviewed = new Map(referenceMatches ? corpus.cases.map(row => [key(row), row]) : [])
const cases = new Map(corpus.cases.map(row => [key(row), { family: row.family, source: row.source }]))
let seed = 0, mutationsPerFamily = 0
for (const file of values.summary ?? []) {
  const summary = JSON.parse(readFileSync(file, 'utf8'))
  if (summary.status !== undefined && summary.status !== 'completed') throw new Error(`Incomplete finder summary: ${file}; inspect its partial artifacts before replay`)
  if (!Array.isArray(summary.silentReads?.examples) || (summary.status === 'completed' || summary.contractCandidates !== undefined) && !Array.isArray(summary.contractCandidates?.examples)) throw new Error(`Missing finder candidate arrays: ${file}`)
  seed = summary.seed
  mutationsPerFamily = summary.mutationsPerFamily
  for (const row of [...(summary.silentReads?.examples ?? []), ...(summary.contractCandidates?.examples ?? [])]) for (const source of [row.source, row.original]) {
    if (typeof row.family !== 'string' || typeof source !== 'string') throw new Error('Malformed finder witness')
    const witness = { family: row.family, source }
    cases.set(key(witness), witness)
  }
}
const output = resolve(values.output!)
mkdirSync(output, { recursive: true })
const oracle = startGrammarReference(referenceDir, upstream)
const results: GrammarTriageResult[] = []
const cache = new Map<string, ReturnType<typeof oracle.parse>>()
const parseReference = (family: string, source: string): ReturnType<typeof oracle.parse> => {
  const identity = key({ family, source })
  let pending = cache.get(identity)
  if (!pending) {
    pending = (async () => {
      const reply = await oracle.parse(family, source), control = await oracle.control(family, source)
      if (reply.instrumentationErrors?.length || control.instrumentationErrors?.length || reply.accepted !== control.accepted) throw new Error(`Reference observation/transport failed: ${family}`)
      return reply
    })()
    cache.set(identity, pending)
  }
  return pending
}
try {
  for (const family of new Set([...cases.values()].map(row => row.family))) {
    const descriptor = getFamily(family)
    if (!descriptor) throw new Error(`Unknown witness family: ${family}`)
    await oracle.prepare(family, descriptor.example)
  }
  for (const row of cases.values()) {
    results.push(await triageGrammarWitness(row, parseReference, reviewed.get(key(row))))
    if (results.length % 100 === 0) console.log(`Grammar triage: ${results.length}/${cases.size}`)
  }
} finally { oracle.close() }

const untracked = results.filter(row => row.defects.some(item => !item.trackedBy))
const counts = Object.fromEntries(['reader-extension', 'diagnosed-limitation', 'rejected', 'defect'].map(disposition => [disposition, results.filter(row => row.disposition === disposition).length]))
const report = {
  reference: admitted, corpusVersion: corpus.version, corpusReferenceMatches: referenceMatches,
  agenticCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  agenticDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
  seed, mutationsPerFamily, counts, untrackedDefectInputs: untracked.length,
  unreviewedDisagreements: results.filter(row => !row.reviewed && !row.referenceAccepted && row.disposition === 'reader-extension').length,
  limits: 'Retained witnesses, not all mutations. Native meaning comparison covers the declared selected fields, not full visual or semantic fidelity. Default verbatim wrapper preservation is not a portable-write guarantee.',
  results,
}
writeFileSync(join(output, 'triage.json'), JSON.stringify(report, null, 2) + '\n')
const summary = `Grammar triage: ${results.length} inputs; ${JSON.stringify(counts)}; ${untracked.length} untracked defect inputs; ${report.unreviewedDisagreements} unreviewed disagreements. Review pin matches: ${referenceMatches}. Evidence: ${join(output, 'triage.json')}\n`
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' })
if (values.check && (untracked.length || !referenceMatches)) process.exitCode = 1
