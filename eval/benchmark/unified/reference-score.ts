import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { censusDisplayText } from '../../mermaid-modern-compat/label-census.ts'
import { admitCurrentReference, type ReferenceReply, wireLine } from '../../mermaid-modern-compat/reference.ts'
import { type ReviewedUpstreamCase, reviewedUpstreamCases } from '../../mermaid-upstream-suite-bench/cases.ts'
import { REFERENCE_ELIGIBILITY_PROTOCOL, REVIEWED_DIAGNOSTIC_FIXTURES, REVIEWED_REFERENCE, type ReferenceEligibility, referenceEligibilityFor } from './reference-eligibility.ts'
import { semanticLabelValues } from './reference-portable.mjs'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult } from './types.ts'
import { mermaidOracleDirectory, mermaidUpstreamDirectory } from '../portable/mermaid-oracle.ts'

type Reply = ReferenceReply & {
  parseOk?: boolean
  timing?: { firstMs: number; samplesMs: number[] }
  representation?: string
  labels?: string[]
  facts?: string[]
}
interface Criterion {
  id: string
  kind: 'acceptance' | 'native' | 'text'
  expected?: string
}
interface UnscoredCriterion {
  id: string
  reason: string
}

function worker(command: string[], cwd: string) {
  const child = spawn(command[0]!, command.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'] }),
    prefix = '\u0001modern-mermaid\u0001'
  const pending: { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = []
  let stderr = '',
    stopped: Error | undefined
  const stop = (error: Error): void => {
    stopped ??= error
    for (const request of pending.splice(0)) {
      clearTimeout(request.timer)
      request.reject(error)
    }
  }
  child.stderr.on('data', buffer => {
    stderr = (stderr + String(buffer)).slice(-4000)
  })
  child.once('error', stop)
  child.stdin.on('error', stop)
  child.once('exit', code => stop(new Error(`Parser worker exit ${code}: ${stderr}`)))
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
    if (!line.startsWith(prefix)) return
    const request = pending.shift()
    if (!request) return
    clearTimeout(request.timer)
    try {
      request.resolve(JSON.parse(line.slice(prefix.length)) as Reply)
    } catch (error) {
      request.reject(error as Error)
    }
  })
  return {
    parse(source: string): Promise<Reply> {
      if (stopped) return Promise.reject(stopped)
      return new Promise((resolveReply, reject) => {
        const timer = setTimeout(() => {
          stop(new Error('Reference score case timeout after 30s'))
          child.kill()
        }, 30_000)
        pending.push({ resolve: resolveReply, reject, timer })
        child.stdin.write(wireLine({ source, apiBenchmark: { samples: 3 } }))
      })
    },
    close(): void {
      stop(new Error('Parser worker closed'))
      child.stdin.end()
      child.kill()
    },
  }
}

/** Freeze the eligible criterion universe from the reviewed fixture before
 * either implementation runs. A parse failure cannot shrink its denominator.
 * Historical node/edge/group fields assert Agentic's pixel-layout envelope;
 * they cannot be substituted with parser IR/DB counts in a portable score. */
function criteriaFor(input: ReviewedUpstreamCase): { criteria: Criterion[]; unscored: UnscoredCriterion[] } {
  const criteria: Criterion[] = [{ id: 'parse-acceptance', kind: 'acceptance' }],
    unscored: UnscoredCriterion[] = []
  if (input.assertions.expectStructured === true) criteria.push({ id: 'native-structured-model', kind: 'native' })
  else if (input.assertions.expectStructured === false) unscored.push({ id: 'expectStructured:false', reason: 'Agentic opaque-body expectation is not a pinned Mermaid public-parser representation contract.' })
  for (const field of ['nodeCount', 'edgeCount', 'groupCount', 'minNodes', 'minEdges', 'minGroups'] as const)
    if (input.assertions[field] !== undefined) unscored.push({ id: field, reason: 'Historical assertion uses public pixel-layout envelope counts. Candidate owner suite executes it; parser semantic/DB counts use different units.' })
  if (input.assertions.renderError) unscored.push({ id: 'renderError', reason: 'Expected output/render failure is outside public-parser timing/acceptance scope.' })
  for (const [index, label] of (input.assertions.labelsContain ?? []).entries()) {
    if (!label.trim()) unscored.push({ id: `labelsContain:${index}`, reason: 'An empty rendered label cannot be matched to an owned parser field by existential text presence.' })
    else if (input.family === 'class' && /~[^~]+~/.test(input.source) && /<[^<>]+>/.test(label)) unscored.push({ id: `labelsContain:${index}`, reason: 'Generic class display combines separate identity/type operands; their native operation/semantic gate owns that correspondence.' })
    else if (input.family === 'sequence' && /^(?:wrap|nowrap):/i.test(label.trim())) unscored.push({ id: `labelsContain:${index}`, reason: 'Sequence wrap directive and message text are distinct parser operands, not one literal label field.' })
    else if (input.family === 'sequence' && /\bautonumber\b/.test(input.source) && /^\d+(?:\.\d+)*\.\s/.test(label.trim())) unscored.push({ id: `labelsContain:${index}`, reason: 'Autonumber prefix is generated display formatting; native message text/numbering operands are checked separately.' })
    else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(label.trim())) unscored.push({ id: `labelsContain:${index}`, reason: 'Pure numeric label can be a generated axis/tick/mark value. Its rendered ownership is not established by parser text fields.' })
    else if (input.family === 'pie' && /\(\s*[+-]?[\d.]+%\s*\)$/.test(label.trim())) unscored.push({ id: `labelsContain:${index}`, reason: 'Pie percentage label is generated layout formatting, not an authored parser text field.' })
    else criteria.push({ id: `labelsContain:${index}`, kind: 'text', expected: censusDisplayText(label) })
  }
  return { criteria, unscored }
}

function score(reply: Reply, engine: 'agentic' | 'mermaid', criteria: Criterion[]): { passed: number; findings: string[]; values: string[] } {
  const parseAccepted = reply.parseOk ?? reply.ok
  const values = reply.ok ? (engine === 'agentic' ? (reply.labels ?? []) : semanticLabelValues(reply.snapshot.data)).map(censusDisplayText) : []
  const findings: string[] = [],
    outcomes = criteria.map(criterion => {
      let passed = false
      if (criterion.kind === 'acceptance') passed = parseAccepted
      else if (criterion.kind === 'native') passed = reply.ok && (engine === 'mermaid' || !['opaque', 'preserved', 'extension'].includes(reply.representation ?? 'preserved'))
      else passed = reply.ok && values.includes(criterion.expected!)
      if (!passed) findings.push(`${criterion.id}: ${criterion.kind === 'text' ? `declared semantic text not observed: ${JSON.stringify(criterion.expected)}` : parseAccepted ? 'native model/projection unavailable' : reply.ok ? 'parse not accepted' : reply.error}`)
      return passed
    })
  return { passed: outcomes.filter(Boolean).length, findings, values }
}

export async function runReferenceScoreSuite(options: UnifiedRunOptions): Promise<UnifiedSuiteResult> {
  const startedAt = new Date().toISOString(),
    driver = options.harnessRoot ?? options.root,
    referenceDir = mermaidOracleDirectory(),
    upstream = mermaidUpstreamDirectory(),
    observations: BenchmarkObservation[] = [],
    diagnosticObservations: BenchmarkObservation[] = [],
    gaps: string[] = []
  mkdirSync(options.out, { recursive: true })
  let provenance
  try {
    provenance = admitCurrentReference(upstream, referenceDir)
  } catch (error) {
    // Without the pinned Mermaid source and oracle this lane cannot score; it refuses to run.
    throw Error(`The pinned Mermaid source checkout (${upstream}) and oracle (${referenceDir}) are required; run \`bun run reference:mermaid\` in the Agentic checkout. ${String(error)}`)
  }
  const target = options.packageRoot ?? options.root
  if (!existsSync(join(target, 'dist/agent-core.js'))) return { id: 'pinned-reference-score', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, gaps: ['Missing actual target dist/agent-core.js'] }
  const fixturePath = 'eval/mermaid-upstream-suite-bench/cases.json'
  let frozenFixture: { path: string; gitBlob: string; driverRevision: string }, targetRevision: string
  try {
    if (provenance.commit !== REVIEWED_REFERENCE.commit || provenance.version !== REVIEWED_REFERENCE.version) throw new Error('Reviewed reference eligibility pin changed; re-review the exact upstream scope before scoring')
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', fixturePath], { cwd: driver, stdio: 'ignore' })
    const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    frozenFixture = { path: fixturePath, gitBlob: git(driver, ['rev-parse', `HEAD:${fixturePath}`]), driverRevision: git(driver, ['rev-parse', 'HEAD']) }
    targetRevision = git(options.root, ['rev-parse', 'HEAD'])
  } catch (error) {
    return { id: 'pinned-reference-score', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, gaps: [`Reference eligibility identity unavailable: ${String(error)}`] }
  }
  const historical = JSON.parse(readFileSync(join(driver, 'eval/mermaid-upstream-suite-bench/manifest.json'), 'utf8')) as unknown
  const historicalExclusions = JSON.parse(readFileSync(join(driver, 'eval/mermaid-upstream-suite-bench/exclusions.json'), 'utf8')) as Array<{ reason: string; blockCount?: number; upstream?: { blocks?: string[] } }>
  const corpus = reviewedUpstreamCases(driver),
    firstByFamily = new Map<string, ReviewedUpstreamCase>()
  for (const input of corpus) if (!firstByFamily.has(input.family)) firstByFamily.set(input.family, input)
  const selected = options.profile === 'smoke' ? [...firstByFamily.values()] : corpus
  let assignments: Map<string, ReferenceEligibility>
  try {
    assignments = new Map(selected.map(input => [input.id, referenceEligibilityFor(input)]))
  } catch (error) {
    return { id: 'pinned-reference-score', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, gaps: [`Reference fixture scope requires review: ${String(error)}`] }
  }
  const eligible = selected.filter(input => assignments.get(input.id)!.eligible),
    universes = new Map(eligible.map(input => [input.id, criteriaFor(input)])),
    raw: unknown[] = [],
    evidence = {
      rawInputCount: selected.length,
      eligibleInputCount: eligible.length,
      diagnosticInputCount: selected.length - eligible.length,
      eligibleCaseIds: eligible.map(input => input.id),
      diagnosticCaseIds: selected.filter(input => !assignments.get(input.id)!.eligible).map(input => input.id),
      rounds: options.rounds,
      currentReference: provenance,
      historicalFixtureProvenance: historical,
      historicalSourceSelection: {
        fullUpstreamAssertionSuite: false,
        importedSourceCases: corpus.length,
        importedSourceBlocks: corpus.reduce((sum, input) => sum + input.upstream.blocks.length, 0),
        excludedMainHarvestBlocks: Object.fromEntries([...new Set(historicalExclusions.map(input => input.reason))].map(reason => [reason, historicalExclusions.filter(input => input.reason === reason).reduce((sum, input) => sum + (input.blockCount ?? input.upstream?.blocks?.length ?? 1), 0)])),
        selection: 'Historical harvester admitted source after Agentic parse, family routing, verification, layout and stable roundtrip succeeded. The denominator is this selected source portfolio, not all upstream tests.',
        assertionOrigin: 'Historical node/edge/group counts and label expectations were recorded from Agentic layout, with retained reviewed corrections. Portable parser criteria do not execute original upstream assertion callbacks.',
        independentAssertionLane: 'upstream-test-assertions executes the declared original Mindmap/GitGraph callback subset separately; wider test declarations and source replay remain explicitly unprojected.',
      },
      frozenFixture,
      target: {
        root: options.root,
        packageRoot: target,
        revision: targetRevision,
        compiledArtifacts: [
          {
            path: join(target, 'dist/agent-core.js'),
            sha256: createHash('sha256')
              .update(readFileSync(join(target, 'dist/agent-core.js')))
              .digest('hex'),
          },
        ],
      },
      reviewedEligibility: { reviewedReference: REVIEWED_REFERENCE, diagnostics: REVIEWED_DIAGNOSTIC_FIXTURES },
      assignments: selected.map(input => ({ caseId: input.id, family: input.family, ...assignments.get(input.id)! })),
    }
  writeFileSync(join(options.out, 'reference-score-eligibility.json'), JSON.stringify({ protocol: REFERENCE_ELIGIBILITY_PROTOCOL, evidence }, null, 2))
  for (let round = 1; round <= options.rounds; round++) {
    const engines = round % 2 ? (['agentic', 'mermaid'] as const) : (['mermaid', 'agentic'] as const),
      replies = new Map<'agentic' | 'mermaid', Map<string, Reply>>()
    for (const engine of engines) {
      const parser = worker(engine === 'mermaid' ? ['node', join(driver, 'eval/mermaid-modern-compat/reference-worker.mjs'), referenceDir] : ['node', join(dirname(fileURLToPath(import.meta.url)), 'reference-agent-worker.mjs'), target, driver], driver),
        values = new Map<string, Reply>()
      replies.set(engine, values)
      try {
        for (const input of selected) {
          try {
            values.set(input.id, await parser.parse(input.source))
          } catch (error) {
            values.set(input.id, { ok: false, error: String(error) })
            gaps.push(`${engine}/${input.id}/round${round}: worker unavailable; no API clock manufactured`)
          }
        }
      } finally {
        parser.close()
      }
    }
    for (const input of selected) {
      const reference = replies.get('mermaid')!.get(input.id)!,
        local = replies.get('agentic')!.get(input.id)!,
        eligibility = assignments.get(input.id)!
      if (!eligibility.eligible) {
        for (const engine of ['agentic', 'mermaid'] as const) {
          const reply = engine === 'agentic' ? local : reference
          diagnosticObservations.push({
            suite: 'pinned-reference-diagnostics',
            surface: `${engine}:public-parser`,
            runtime: 'Node',
            family: input.family,
            caseId: input.id,
            operation: 'diagnostic-parse-attempt',
            format: 'structured',
            mode: eligibility.scope,
            status: 'not-applicable',
            ...(reply.timing ? { samplesMs: reply.timing.samplesMs } : {}),
            metrics: { implementation: engine, round, positiveScoringEligible: false, observedParserAccepted: reply.parseOk ?? reply.ok, firstMs: reply.timing?.firstMs ?? null, scope: eligibility.scope },
            detail: `${eligibility.reason} Actual public parser ${(reply.parseOk ?? reply.ok) ? 'accepted' : 'rejected'} this retained source; no positive score or positive portfolio cost is assigned.`,
          })
        }
        raw.push({ round, caseId: input.id, family: input.family, source: input.source, eligibility, reference, local })
        continue
      }
      const universe = universes.get(input.id)!
      for (const engine of ['agentic', 'mermaid'] as const) {
        const reply = engine === 'agentic' ? local : reference,
          evaluated = score(reply, engine, universe.criteria)
        observations.push({
          suite: 'pinned-reference-score',
          surface: `${engine}:public-parser`,
          runtime: 'Node',
          family: input.family,
          caseId: input.id,
          operation: 'parse-and-score',
          format: 'structured',
          mode: 'same-fixture-portable-assertions',
          status: evaluated.passed === universe.criteria.length ? 'passed' : 'failed',
          ...(reply.timing ? { samplesMs: reply.timing.samplesMs } : {}),
          findings: evaluated.findings,
          metrics: {
            implementation: engine,
            round,
            criteria: universe.criteria.length,
            passed: evaluated.passed,
            declaredCriteria: universe.criteria.length + universe.unscored.length,
            unscoredCriteria: universe.unscored.length,
            parseAccepted: reply.parseOk ?? reply.ok,
            nativeStructured: reply.ok && engine === 'agentic' ? !['opaque', 'preserved', 'extension'].includes(reply.representation ?? '') : null,
            firstMs: reply.timing?.firstMs ?? null,
            referenceVersion: provenance.version,
            boundary: 'public parser API attempts including rejections; semantic projections, assertions and IPC outside clock',
            scope: 'same fixed accepted/native-model/text-field criteria on both implementations; exact text equality, no narrated-fact or canonical-source matches',
          },
        })
      }
      raw.push({ round, caseId: input.id, family: input.family, source: input.source, eligibility, criteria: universe.criteria, unscoredCriteria: universe.unscored, reference, local })
    }
  }
  gaps.push(
    'Reviewed diagnostic-only fixtures still execute and retain raw replies/API timings in separate artifacts. Positive scores and positive all-attempt portfolios exclude them by upstream scope fixed before either engine ran; this is a protocol correction, not a product improvement.',
    'Historical layout-count/render-error criteria remain explicitly unscored in this paired parser score. The actual target owning tests execute their layout contracts separately; no Mermaid geometry equivalence is asserted.',
    'This portable score is not the full upstream repository test suite. Current pinned independent grammar/native-operation suites and retained historical imported suites execute separately.',
    'This denominator is a historically Agentic-admitted source portfolio. Its recorded layout/label assertions are not the original upstream test expectations; use the separately scoped original-assertion lane and full upstream census to assess independent coverage.',
    'Semantic text matches are existential field/identifier retention, not identity, multiplicity, rendered visibility or complete parser equivalence. An unmatched text cue can require projection review; raw source/replies remain available.',
    'Rejected parses retain their attempted API timings. Failure-short-circuit time is not a successful-render speedup; compare score and shared-success timing cohorts alongside total attempt cost.',
  )
  writeFileSync(
    join(options.out, 'reference-score-raw.json'),
    JSON.stringify({ protocol: REFERENCE_ELIGIBILITY_PROTOCOL, evidence, currentReference: provenance, historicalFixtureProvenance: historical, selectedInputs: selected.map(input => input.id), reviewedAssertionView: 'eval/mermaid-upstream-suite-bench/cases.ts; historical source JSON remains unchanged', raw }, null, 2),
  )
  writeFileSync(join(options.out, 'reference-score-diagnostics.json'), JSON.stringify({ protocol: REFERENCE_ELIGIBILITY_PROTOCOL, evidence, diagnosticObservations }, null, 2))
  const result: UnifiedSuiteResult & { protocol: typeof REFERENCE_ELIGIBILITY_PROTOCOL; evidence: typeof evidence } = {
    id: 'pinned-reference-score',
    protocol: REFERENCE_ELIGIBILITY_PROTOCOL,
    evidence,
    status: observations.some(row => row.status === 'failed') ? 'failed' : 'passed',
    startedAt,
    finishedAt: new Date().toISOString(),
    observations,
    gaps,
    artifacts: ['reference-score-raw.json', 'reference-score-eligibility.json', 'reference-score-diagnostics.json'],
    toolVersions: [
      { tool: 'adewale/agentic-mermaid', version: JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version, source: join(target, 'package.json') },
      { tool: 'mermaid-js/mermaid', version: provenance.version, source: 'admitted current reference' },
    ],
  }
  writeFileSync(join(options.out, 'reference-score-result.json'), JSON.stringify(result, null, 2))
  return result
}
