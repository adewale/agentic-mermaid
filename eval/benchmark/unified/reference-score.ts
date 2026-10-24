import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { censusDisplayText } from '../../mermaid-modern-compat/label-census.ts'
import { admitCurrentReference, type ReferenceReply, wireLine } from '../../mermaid-modern-compat/reference.ts'
import { type ReviewedUpstreamCase, reviewedUpstreamCases } from '../../mermaid-upstream-suite-bench/cases.ts'
import { semanticLabelValues } from './reference-portable.mjs'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult } from './types.ts'

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
    referenceDir = process.env.MERMAID_REFERENCE_DIR ?? resolve(driver, '../mermaid-reference'),
    upstream = process.env.MERMAID_UPSTREAM_DIR ?? resolve(driver, '../mermaid'),
    observations: BenchmarkObservation[] = [],
    gaps: string[] = []
  mkdirSync(options.out, { recursive: true })
  let provenance
  try {
    provenance = admitCurrentReference(upstream, referenceDir)
  } catch (error) {
    return { id: 'pinned-reference-score', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, gaps: [String(error)] }
  }
  const target = options.packageRoot ?? options.root
  if (!existsSync(join(target, 'dist/agent-core.js'))) return { id: 'pinned-reference-score', status: 'blocked', startedAt, finishedAt: new Date().toISOString(), observations, gaps: ['Missing actual target dist/agent-core.js'] }
  const historical = JSON.parse(readFileSync(join(driver, 'eval/mermaid-upstream-suite-bench/manifest.json'), 'utf8')) as unknown
  const corpus = reviewedUpstreamCases(driver),
    firstByFamily = new Map<string, ReviewedUpstreamCase>()
  for (const input of corpus) if (!firstByFamily.has(input.family)) firstByFamily.set(input.family, input)
  const selected = options.profile === 'smoke' ? [...firstByFamily.values()] : corpus
  const universes = new Map(selected.map(input => [input.id, criteriaFor(input)])),
    raw: unknown[] = []
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
        universe = universes.get(input.id)!
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
      raw.push({ round, caseId: input.id, criteria: universe.criteria, unscoredCriteria: universe.unscored, reference, local })
    }
  }
  gaps.push(
    'Historical layout-count/render-error criteria remain explicitly unscored in this paired parser score. The actual target owning tests execute their layout contracts separately; no Mermaid geometry equivalence is asserted.',
    'This portable score is not the full upstream repository test suite. Current pinned independent grammar/native-operation suites and retained historical imported suites execute separately.',
    'Semantic text matches are existential field/identifier retention, not identity, multiplicity, rendered visibility or complete parser equivalence. An unmatched text cue can require projection review; raw source/replies remain available.',
    'Rejected parses retain their attempted API timings. Failure-short-circuit time is not a successful-render speedup; compare score and shared-success timing cohorts alongside total attempt cost.',
  )
  writeFileSync(
    join(options.out, 'reference-score-raw.json'),
    JSON.stringify({ currentReference: provenance, historicalFixtureProvenance: historical, selectedInputs: selected.map(input => input.id), reviewedAssertionView: 'eval/mermaid-upstream-suite-bench/cases.ts; historical source JSON remains unchanged', raw }, null, 2),
  )
  const result: UnifiedSuiteResult = { id: 'pinned-reference-score', status: observations.some(row => row.status === 'failed') ? 'failed' : 'passed', startedAt, finishedAt: new Date().toISOString(), observations, gaps, artifacts: ['reference-score-raw.json'] }
  writeFileSync(join(options.out, 'reference-score-result.json'), JSON.stringify(result, null, 2))
  return result
}
