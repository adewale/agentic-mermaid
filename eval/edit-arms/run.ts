// Edit-arms evaluation runner: prepare request files, record responses,
// finalize (score) a run, and report paired comparisons across runs.
// See README.md and PREREGISTRATION.md.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { validateCapturedResponse } from '../agent-usage/capture-subagent-prompt-eval.ts'
import { ARMS, ARM_NAMES, buildRequest, type Arm } from './arms.ts'
import { CORPUS_DIR, loadCorpus, type Corpus } from './corpus.ts'
import { startOracle, type Oracle } from './oracle.ts'
import { extractMermaid, referenceChangesModel, referenceSources, scoreEdit, type EditScore, type EditTask } from './score.ts'
import { mean, pairedBootstrap, shuffled, type PairedEstimate } from './stats.ts'

const REPO = resolve(import.meta.dir, '../..')
// Outside eval/: eval/**/*.mmd is auto-enrolled in quality corpora, and agents write scratch files here.
const RUNS_DIR = join(REPO, 'reports', 'edit-arms')
const MANIFEST = 'edit-arms-run.json'

const abs = (p: string) => (isAbsolute(p) ? p : resolve(process.cwd(), p))
const rel = (p: string) => {
  const r = relative(REPO, p).replace(/\\/g, '/')
  return r.startsWith('../') ? p : r
}
const digest = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'

export function corpusDigest(dir = CORPUS_DIR): string {
  const manifest = readFileSync(join(dir, 'manifest.json'), 'utf8')
  const parts = [manifest, readFileSync(join(dir, 'tasks.json'), 'utf8')]
  for (const d of (JSON.parse(manifest) as { diagrams: Array<{ file: string }> }).diagrams) parts.push(readFileSync(join(dir, d.file), 'utf8'))
  return digest(parts.join('\u0000'))
}

// ---------------------------------------------------------------------------
// Task selection

/**
 * A family-stratified sample: each family gets a share proportional to its task
 * count (largest remainder), and within a family distinct diagrams come first.
 */
export function sampleTasks(tasks: EditTask[], n: number, seed: number): EditTask[] {
  if (n >= tasks.length) return tasks
  const families = [...new Set(tasks.map(t => t.family))]
  const shares = families.map(f => {
    const exact = (n * tasks.filter(t => t.family === f).length) / tasks.length
    return { f, quota: Math.floor(exact), rest: exact - Math.floor(exact) }
  })
  let left = n - shares.reduce((s, x) => s + x.quota, 0)
  for (const s of [...shares].sort((a, b) => b.rest - a.rest || a.f.localeCompare(b.f))) if (left-- > 0) s.quota++
  const picked: EditTask[] = []
  for (const { f, quota } of shares) {
    const pool = shuffled(tasks.filter(t => t.family === f), seed)
    const firstOfDiagram = pool.filter((t, i) => pool.findIndex(u => u.diagram === t.diagram) === i)
    picked.push(...[...firstOfDiagram, ...pool.filter(t => !firstOfDiagram.includes(t))].slice(0, quota))
  }
  const order = new Map(tasks.map((t, i) => [t.id, i]))
  return picked.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
}

function selectTasks(corpus: Corpus, opts: { cases?: string[]; sample?: number; seed: number }): EditTask[] {
  if (opts.cases?.length) {
    const byId = new Map(corpus.tasks.map(t => [t.id, t]))
    return opts.cases.map(id => byId.get(id) ?? (() => { throw new Error(`Unknown task id ${id}`) })())
  }
  return opts.sample ? sampleTasks(corpus.tasks, opts.sample, opts.seed) : corpus.tasks
}

// ---------------------------------------------------------------------------
// Prepare

export interface RunRequest {
  requestId: string
  taskId: string
  diagram: string
  family: string
  arm: Arm
  run: number
  requestPath: string
  responsePath: string
  tracePath: string
  observationPath: string
  scratchDir: string
  requestDigest: string
}

export interface RunManifest {
  schemaVersion: 1
  kind: 'edit-arms'
  preparedAt: string
  provider: string
  model: string
  arms: Arm[]
  runs: number
  seed: number
  corpusDigest: string
  tasks: string[]
  requests: RunRequest[]
  /** Seeded interleaving of all requests; dispatch in this order. */
  dispatchOrder: string[]
}

export interface PrepareOptions {
  arms?: Arm[]
  runs?: number
  cases?: string[]
  sample?: number
  seed?: number
  provider?: string
  model?: string
  outDir?: string
  preparedAt?: string
}

export function plannedRequests(corpus: Corpus, tasks: EditTask[], arms: Arm[], runs: number, outDir: string): Array<RunRequest & { text: string }> {
  const out: Array<RunRequest & { text: string }> = []
  for (const task of tasks) {
    const before = corpus.diagrams.get(task.diagram)!.text
    for (const arm of arms) for (let run = 1; run <= runs; run++) {
      const requestId = `${task.id}--${arm}--r${run}`
      const paths = {
        requestPath: join(outDir, 'requests', `${requestId}.md`),
        responsePath: join(outDir, 'responses', `${requestId}.txt`),
        tracePath: join(outDir, 'traces', `${requestId}.jsonl`),
        observationPath: join(outDir, 'observations', `${requestId}.json`),
        scratchDir: join(outDir, 'scratch', requestId),
      }
      const text = buildRequest(requestId, task, before, arm, { repo: REPO, scratch: paths.scratchDir, trace: paths.tracePath })
      out.push({ requestId, taskId: task.id, diagram: task.diagram, family: task.family, arm, run, ...paths, requestDigest: digest(text), text })
    }
  }
  return out
}

export function prepareRun(opts: PrepareOptions = {}): RunManifest & { outDir: string } {
  const corpus = loadCorpus()
  const arms = opts.arms ?? ['A', 'B']
  const runs = opts.runs ?? 1
  const seed = opts.seed ?? 1
  const provider = opts.provider ?? 'subagent'
  const model = opts.model ?? 'unspecified'
  const preparedAt = opts.preparedAt ?? new Date().toISOString()
  const outDir = opts.outDir ? abs(opts.outDir) : join(RUNS_DIR, `${slug(provider)}-${slug(model)}-${preparedAt.replace(/[:.]/g, '-')}`)
  const tasks = selectTasks(corpus, { cases: opts.cases, sample: opts.sample, seed })
  const planned = plannedRequests(corpus, tasks, arms, runs, outDir)
  for (const sub of ['requests', 'responses', 'traces', 'observations', 'scores', 'scratch']) mkdirSync(join(outDir, sub), { recursive: true })
  for (const r of planned) {
    writeFileSync(r.requestPath, r.text)
    mkdirSync(r.scratchDir, { recursive: true })
    if (r.arm !== 'C') writeFileSync(join(r.scratchDir, 'diagram.mmd'), corpus.diagrams.get(r.diagram)!.text)
  }
  const requests = planned.map(({ text: _text, ...r }) => r)
  const manifest: RunManifest = {
    schemaVersion: 1, kind: 'edit-arms', preparedAt, provider, model, arms, runs, seed,
    corpusDigest: corpusDigest(), tasks: tasks.map(t => t.id), requests,
    dispatchOrder: shuffled(requests.map(r => r.requestId), seed),
  }
  const relPaths = (r: RunRequest) => ({ ...r, requestPath: rel(r.requestPath), responsePath: rel(r.responsePath), tracePath: rel(r.tracePath), observationPath: rel(r.observationPath), scratchDir: rel(r.scratchDir) })
  writeFileSync(join(outDir, MANIFEST), JSON.stringify({ ...manifest, requests: requests.map(relPaths) }, null, 2) + '\n')
  writeFileSync(join(outDir, 'README.md'), runReadme(outDir, manifest))
  return { ...manifest, outDir }
}

function runReadme(outDir: string, m: RunManifest): string {
  return [
    '# Edit-arms run',
    '',
    `Prepared ${m.preparedAt} for provider \`${m.provider}\`, model \`${m.model}\`: ${m.tasks.length} tasks × arms ${m.arms.join(', ')} × ${m.runs} run(s) = ${m.requests.length} requests.`,
    '',
    '1. Dispatch each `requests/<id>.md` to a fresh agent, one request per agent, in the order of `dispatchOrder` in the manifest.',
    '2. Record the complete final message: `bun run eval:edit-arms -- record --run-dir ' + rel(outDir) + ' --request <id> --response-file <file>`.',
    '3. Optionally write runner-observed cost to `observations/<id>.json`: `{ "inputTokens": n, "outputTokens": n, "turns": n, "wallMs": n }`.',
    '4. Score: `bun run eval:edit-arms -- finalize --run-dir ' + rel(outDir) + '`.',
    '',
    'Arms: ' + m.arms.map(a => `${a} = ${ARM_NAMES[a]}`).join('; ') + '.',
    '',
  ].join('\n')
}

export function loadRun(runDir: string): RunManifest & { outDir: string } {
  const dir = abs(runDir)
  const path = join(dir, MANIFEST)
  if (!existsSync(path)) throw new Error(`No ${MANIFEST} in ${dir}; run prepare first`)
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RunManifest
  const fix = (p: string) => resolve(REPO, p)
  return { ...raw, outDir: dir, requests: raw.requests.map(r => ({ ...r, requestPath: fix(r.requestPath), responsePath: fix(r.responsePath), tracePath: fix(r.tracePath), observationPath: fix(r.observationPath), scratchDir: fix(r.scratchDir) })) }
}

export function recordResponse(runDir: string, requestId: string, response: string): string {
  const run = loadRun(runDir)
  const req = run.requests.find(r => r.requestId === requestId)
  if (!req) throw new Error(`Request ${requestId} is not in this run`)
  const capture = validateCapturedResponse(response)
  if (!capture.ok) throw new Error(`${capture.error.code}: ${capture.error.message}`)
  writeFileSync(req.responsePath, response)
  return req.responsePath
}

// ---------------------------------------------------------------------------
// Finalize

export interface Observation { inputTokens?: number; outputTokens?: number; turns?: number; wallMs?: number }

/** Typed-editing verbs recorded by AM_TRACE_LOG (CLI command names and library leaves). */
const TYPED_VERBS = new Set(['mutate', 'build', 'serialize', 'batch', 'parse'])

export type Compliance = 'compliant' | 'violated' | 'fallback' | 'unobserved'

export function armCompliance(arm: Arm, verbs: string[] | null, response: string): Compliance {
  if (verbs === null) return 'unobserved'
  if (arm === 'C') return verbs.length ? 'violated' : 'compliant'
  if (arm === 'A') return verbs.some(v => TYPED_VERBS.has(v)) ? 'violated' : 'compliant'
  if (verbs.includes('mutate')) return 'compliant'
  return /source-level fallback/i.test(response) ? 'fallback' : 'violated'
}

export interface ScoreRecord {
  requestId: string
  taskId: string
  diagram: string
  family: string
  arm: Arm
  run: number
  provider: string
  model: string
  captured: boolean
  captureError?: { code: string; message: string }
  output?: string
  score?: EditScore
  verbs: string[] | null
  compliance: Compliance
  observation?: Observation
}

function readVerbs(path: string): string[] | null {
  if (!existsSync(path)) return null
  const verbs: string[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { const v = (JSON.parse(line) as { verb?: unknown }).verb; if (typeof v === 'string') verbs.push(v) } catch { /* ignore a malformed line */ }
  }
  return verbs
}

function readObservation(path: string): Observation | undefined {
  if (!existsSync(path)) return undefined
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const out: Observation = {}
  for (const key of ['inputTokens', 'outputTokens', 'turns', 'wallMs'] as const) {
    if (raw[key] === undefined) continue
    const v = raw[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`Invalid observation ${path}: ${key}`)
    out[key] = v
  }
  return out
}

export async function finalizeRun(runDir: string, oracle: Oracle): Promise<{ records: ScoreRecord[]; summary: RunSummary }> {
  const run = loadRun(runDir)
  const corpus = loadCorpus()
  if (corpusDigest() !== run.corpusDigest) throw new Error('The corpus changed after this run was prepared; score it against the corpus revision it was prepared from')
  const tasks = new Map(corpus.tasks.map(t => [t.id, t]))
  const records: ScoreRecord[] = []
  for (const req of run.requests) {
    const task = tasks.get(req.taskId)!
    const base = { requestId: req.requestId, taskId: req.taskId, diagram: req.diagram, family: req.family, arm: req.arm, run: req.run, provider: run.provider, model: run.model }
    const response = existsSync(req.responsePath) ? readFileSync(req.responsePath, 'utf8') : undefined
    let capture = validateCapturedResponse(response)
    if (capture.ok && (!existsSync(req.requestPath) || digest(readFileSync(req.requestPath, 'utf8')) !== req.requestDigest)) {
      capture = { ok: false, error: { code: 'REQUEST_DIGEST_MISMATCH', message: 'The request file changed after preparation; re-dispatch this request.' } }
    }
    const verbs = readVerbs(req.tracePath)
    const observation = readObservation(req.observationPath)
    let record: ScoreRecord
    if (!capture.ok) {
      record = { ...base, captured: false, captureError: capture.error, verbs, compliance: armCompliance(req.arm, verbs, ''), observation }
    } else {
      const output = extractMermaid(response!)
      const score = await scoreEdit(oracle, corpus.diagrams.get(req.diagram)!.text, task, output)
      record = { ...base, captured: true, output, score, verbs, compliance: armCompliance(req.arm, verbs, response!), observation }
    }
    writeFileSync(join(run.outDir, 'scores', `${req.requestId}.json`), JSON.stringify(record, null, 2) + '\n')
    records.push(record)
  }
  const summary = summarize(records, run.arms)
  writeFileSync(join(run.outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  return { records, summary }
}

// ---------------------------------------------------------------------------
// Summaries

export interface ArmSummary {
  requests: number
  captured: number
  /** a ∧ ¬b ∧ d */
  successRate: number | null
  /** collateral change or unparseable/missing output */
  damageRate: number | null
  /** collateral change among outputs Mermaid parses */
  collateralRateParsed: number | null
  intendedRate: number | null
  parseRate: number | null
  preservation: { untouched: number | null; comments: number | null; styles: number | null; directives: number | null }
  cost: { observed: number; inputTokens: number | null; outputTokens: number | null; turns: number | null; wallMs: number | null }
  compliance: Record<Compliance, number>
}

export interface Comparison {
  treatment: Arm
  control: Arm
  success: PairedEstimate
  damage: PairedEstimate
  preservation: PairedEstimate
}

export interface RunSummary {
  arms: Arm[]
  perArm: Partial<Record<Arm, ArmSummary>>
  perFamily: Record<string, Partial<Record<Arm, { captured: number; successRate: number | null; damageRate: number | null }>>>
  comparisons: Comparison[]
  captureFailures: Array<{ requestId: string; code: string }>
  checkStrength: { full: number; weaker: number }
}

const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null)

function armSummary(records: ScoreRecord[]): ArmSummary {
  const scored = records.filter(r => r.captured && r.score)
  const s = scored.map(r => r.score!)
  const pres = (k: 'untouched' | 'comments' | 'styles' | 'directives') => mean(s.map(x => x.preservation?.[k].rate).filter((v): v is number => typeof v === 'number'))
  const obs = records.map(r => r.observation).filter((o): o is Observation => o !== undefined)
  const om = (k: keyof Observation) => mean(obs.map(o => o[k]).filter((v): v is number => typeof v === 'number'))
  const compliance: Record<Compliance, number> = { compliant: 0, violated: 0, fallback: 0, unobserved: 0 }
  for (const r of records) compliance[r.compliance]++
  return {
    requests: records.length,
    captured: scored.length,
    successRate: rate(s.map(x => x.success)),
    damageRate: rate(s.map(x => x.damage)),
    collateralRateParsed: rate(s.filter(x => x.parses).map(x => x.collateral === true)),
    intendedRate: rate(s.map(x => x.intended)),
    parseRate: rate(s.map(x => x.parses)),
    preservation: { untouched: pres('untouched'), comments: pres('comments'), styles: pres('styles'), directives: pres('directives') },
    cost: { observed: obs.length, inputTokens: om('inputTokens'), outputTokens: om('outputTokens'), turns: om('turns'), wallMs: om('wallMs') },
    compliance,
  }
}

function compare(records: ScoreRecord[], treatment: Arm, control: Arm): Comparison {
  const byCase = new Map<string, ScoreRecord[]>()
  for (const r of records) if (r.captured && r.score) byCase.set(r.taskId, [...(byCase.get(r.taskId) ?? []), r])
  const paired = (metric: (s: EditScore) => number | null) => {
    const rows: Array<{ control: number; treatment: number }> = []
    for (const rs of byCase.values()) {
      const m = (arm: Arm) => mean(rs.filter(r => r.arm === arm).map(r => metric(r.score!)).filter((v): v is number => v !== null))
      const c = m(control)
      const t = m(treatment)
      if (c !== null && t !== null) rows.push({ control: c, treatment: t })
    }
    return pairedBootstrap(rows)
  }
  return {
    treatment, control,
    success: paired(s => (s.success ? 1 : 0)),
    damage: paired(s => (s.damage ? 1 : 0)),
    preservation: paired(s => s.preservation?.untouched.rate ?? null),
  }
}

export function summarize(records: ScoreRecord[], arms: Arm[]): RunSummary {
  const perArm: RunSummary['perArm'] = {}
  for (const arm of arms) perArm[arm] = armSummary(records.filter(r => r.arm === arm))
  const perFamily: RunSummary['perFamily'] = {}
  for (const family of [...new Set(records.map(r => r.family))].sort()) {
    perFamily[family] = {}
    for (const arm of arms) {
      const s = records.filter(r => r.family === family && r.arm === arm && r.captured && r.score).map(r => r.score!)
      perFamily[family]![arm] = { captured: s.length, successRate: rate(s.map(x => x.success)), damageRate: rate(s.map(x => x.damage)) }
    }
  }
  const pairs: Array<[Arm, Arm]> = [['B', 'A'], ['C', 'A'], ['B', 'C']]
  const comparisons = pairs.filter(([t, c]) => arms.includes(t) && arms.includes(c)).map(([t, c]) => compare(records, t, c))
  const scored = records.filter(r => r.score)
  return {
    arms, perArm, perFamily, comparisons,
    captureFailures: records.filter(r => !r.captured).map(r => ({ requestId: r.requestId, code: r.captureError?.code ?? 'UNKNOWN' })),
    checkStrength: { full: scored.filter(r => r.score!.strength === 'full').length, weaker: scored.filter(r => r.score!.strength === 'weaker').length },
  }
}

/** Preregistered decision rule (PREREGISTRATION.md §5). */
export function decide(summary: RunSummary): string {
  const ba = summary.comparisons.find(c => c.treatment === 'B' && c.control === 'A')
  if (!ba || ba.damage.diff === null || ba.damage.lo === null || ba.damage.hi === null || ba.success.lo === null) return 'UNDECIDED: no paired A/B data'
  const reduction = -ba.damage.diff
  const reductionLo = -ba.damage.hi
  const harmLo = ba.damage.lo
  if (harmLo > 0) return `TYPED PATH HARMFUL: B increases damage by ${(ba.damage.diff * 100).toFixed(1)} pts (95% CI ${(ba.damage.lo * 100).toFixed(1)}..${(ba.damage.hi * 100).toFixed(1)})`
  if (reduction >= 0.1 && reductionLo > 0 && ba.success.lo > -0.05) return `SUPPORTED: B reduces damage by ${(reduction * 100).toFixed(1)} pts (95% CI lower bound ${(reductionLo * 100).toFixed(1)}) and success is non-inferior (CI lower bound ${(ba.success.lo * 100).toFixed(1)} pts)`
  const successNote = ba.success.hi !== null && ba.success.hi < 0 ? '; B is also less successful' : ''
  return `NOT SUPPORTED: damage reduction ${(reduction * 100).toFixed(1)} pts (95% CI ${(reductionLo * 100).toFixed(1)}..${(-ba.damage.lo * 100).toFixed(1)}), success CI lower bound ${(ba.success.lo * 100).toFixed(1)} pts${successNote} — position the product around render-and-verify`
}

export function loadScores(runDir: string): ScoreRecord[] {
  const dir = join(abs(runDir), 'scores')
  if (!existsSync(dir)) throw new Error(`${runDir} has no scores; run finalize first`)
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ScoreRecord)
}

// ---------------------------------------------------------------------------
// Corpus validation and cost estimate

export async function validateCorpus(oracle: Oracle, corpus = loadCorpus()): Promise<string[]> {
  const problems: string[] = []
  for (const t of corpus.tasks) {
    const before = corpus.diagrams.get(t.diagram)!.text
    const b = await oracle.parse(before)
    if (!b.ok) { problems.push(`${t.id}: held-out source does not parse: ${b.error.slice(0, 120)}`); continue }
    let refs: string[]
    try { refs = referenceSources(before, t) } catch (e) { problems.push(`${t.id}: ${String(e)}`); continue }
    for (const [i, r] of refs.entries()) {
      const p = await oracle.parse(r)
      if (!p.ok) problems.push(`${t.id}: reference ${i} does not parse: ${p.error.slice(0, 120)}`)
      else if (!referenceChangesModel(t, b.model, p.model)) problems.push(`${t.id}: reference ${i} makes no change the oracle can see`)
    }
  }
  return problems
}

export interface CostAssumption { baseTokens: Record<Arm, number>; requestRereads: Record<Arm, number> }

/**
 * Stated assumption, calibrated to the agent-usage four-surface matrix
 * (eval/agent-usage/README.md: ~21k–36k mean tokens per single-diagram case for
 * in-checkout Claude subagents). Tokens per run = base(arm) + rereads(arm) ×
 * request tokens. Replace with pilot observations before committing to the full run.
 */
export const DEFAULT_COST: CostAssumption = {
  baseTokens: { A: 25_000, B: 32_000, C: 4_000 },
  requestRereads: { A: 4, B: 5, C: 1 },
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

export function costEstimate(corpus: Corpus, tasks: EditTask[], arms: Arm[], runs: number, models: number, assumption = DEFAULT_COST) {
  const planned = plannedRequests(corpus, tasks, arms, 1, join(RUNS_DIR, 'cost-estimate'))
  const perArm = arms.map(arm => {
    const reqTokens = planned.filter(p => p.arm === arm).map(p => estimateTokens(p.text))
    const meanRequest = mean(reqTokens) ?? 0
    const perRun = assumption.baseTokens[arm] + assumption.requestRereads[arm] * meanRequest
    return { arm, requests: reqTokens.length * runs * models, meanRequestTokens: Math.round(meanRequest), tokensPerRun: Math.round(perRun), total: Math.round(perRun * reqTokens.length * runs * models) }
  })
  return { tasks: tasks.length, runs, models, perArm, total: perArm.reduce((s, a) => s + a.total, 0) }
}

// ---------------------------------------------------------------------------
// CLI

function arg(args: string[], name: string): string | undefined {
  const eq = args.find(a => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function parseArms(value: string | undefined): Arm[] | undefined {
  if (!value) return undefined
  const arms = value.split(',').map(s => s.trim().toUpperCase())
  for (const a of arms) if (!(ARMS as readonly string[]).includes(a)) throw new Error(`Unknown arm ${a}; use A, B, C`)
  return arms as Arm[]
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`)

function printSummary(summary: RunSummary): void {
  for (const arm of summary.arms) {
    const s = summary.perArm[arm]!
    console.log(`Arm ${arm} (${ARM_NAMES[arm]}): captured ${s.captured}/${s.requests}  success ${pct(s.successRate)}  damage ${pct(s.damageRate)}  collateral|parsed ${pct(s.collateralRateParsed)}  intended ${pct(s.intendedRate)}  parses ${pct(s.parseRate)}  preservation ${pct(s.preservation.untouched)} (comments ${pct(s.preservation.comments)}, styles ${pct(s.preservation.styles)}, directives ${pct(s.preservation.directives)})  compliance ${JSON.stringify(s.compliance)}`)
  }
  for (const c of summary.comparisons) {
    const f = (e: PairedEstimate) => `${pct(e.diff)} [${pct(e.lo)}, ${pct(e.hi)}] n=${e.cases}`
    console.log(`${c.treatment} − ${c.control}: success ${f(c.success)}; damage ${f(c.damage)}; preservation ${f(c.preservation)}`)
  }
}

const USAGE = `Usage: bun run eval:edit-arms -- <command>
  list                                     corpus and task summary
  validate                                 check every reference edit against Mermaid 12.2.0
  prepare [--arms A,B[,C]] [--runs N] [--sample N --seed S | --cases id,id] [--provider p] [--model m] [--out-dir dir]
  record --run-dir dir --request id [--response-file file]   (stdin when no file)
  finalize --run-dir dir                   score every response; writes scores/ and summary.json
  report --run-dirs dir1,dir2,... [--per-protocol] [--out file]   pooled paired comparison + decision rule
  cost [--arms A,B] [--runs N] [--models M] [--sample N --seed S]
Set MERMAID_REFERENCE_DIR when the Mermaid 12.2.0 reference is not at ../mermaid-reference.`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv[0] === '--' ? argv.slice(1) : argv
  if (!command || command === 'help' || command === '--help') { console.log(USAGE); return 0 }
  if (command === 'list') {
    const corpus = loadCorpus()
    const fam = new Map<string, { diagrams: number; tasks: number }>()
    for (const d of corpus.diagrams.values()) fam.set(d.family, { diagrams: (fam.get(d.family)?.diagrams ?? 0) + 1, tasks: 0 })
    for (const t of corpus.tasks) fam.get(t.family)!.tasks++
    console.log(JSON.stringify({ diagrams: corpus.diagrams.size, tasks: corpus.tasks.length, families: Object.fromEntries(fam), licenses: [...corpus.diagrams.values()].reduce<Record<string, number>>((m, d) => ({ ...m, [d.license.spdx]: (m[d.license.spdx] ?? 0) + 1 }), {}) }, null, 2))
    return 0
  }
  if (command === 'cost') {
    const corpus = loadCorpus()
    const sample = arg(rest, '--sample')
    const tasks = selectTasks(corpus, { sample: sample ? Number(sample) : undefined, seed: Number(arg(rest, '--seed') ?? 1) })
    console.log(JSON.stringify({ assumption: DEFAULT_COST, estimate: costEstimate(corpus, tasks, parseArms(arg(rest, '--arms')) ?? ['A', 'B'], Number(arg(rest, '--runs') ?? 1), Number(arg(rest, '--models') ?? 1)) }, null, 2))
    return 0
  }
  if (command === 'prepare') {
    const sample = arg(rest, '--sample')
    const m = prepareRun({
      arms: parseArms(arg(rest, '--arms')), runs: Number(arg(rest, '--runs') ?? 1),
      cases: arg(rest, '--cases')?.split(',').map(s => s.trim()).filter(Boolean),
      sample: sample ? Number(sample) : undefined, seed: Number(arg(rest, '--seed') ?? 1),
      provider: arg(rest, '--provider'), model: arg(rest, '--model'), outDir: arg(rest, '--out-dir'),
    })
    console.log(JSON.stringify({ ok: true, runDir: rel(m.outDir), requests: m.requests.length, tasks: m.tasks, dispatchOrder: m.dispatchOrder.slice(0, 5).concat(m.dispatchOrder.length > 5 ? ['…'] : []) }, null, 2))
    return 0
  }
  if (command === 'record') {
    const runDir = arg(rest, '--run-dir')
    const id = arg(rest, '--request')
    if (!runDir || !id) throw new Error('record needs --run-dir and --request')
    const file = arg(rest, '--response-file')
    const text = file ? readFileSync(abs(file), 'utf8') : await new Response(Bun.stdin.stream()).text()
    console.log(JSON.stringify({ ok: true, response: rel(recordResponse(runDir, id, text)) }))
    return 0
  }
  const oracle = command === 'validate' || command === 'finalize' ? startOracle() : undefined
  try {
    if (command === 'validate') {
      const problems = await validateCorpus(oracle!)
      console.log(problems.length ? problems.join('\n') : `ok: every reference edit applies, parses in Mermaid ${oracle!.mermaidVersion} and changes the model`)
      return problems.length ? 1 : 0
    }
    if (command === 'finalize') {
      const runDir = arg(rest, '--run-dir')
      if (!runDir) throw new Error('finalize needs --run-dir')
      const { summary } = await finalizeRun(runDir, oracle!)
      printSummary(summary)
      return summary.captureFailures.length ? 1 : 0
    }
    if (command === 'report') {
      const dirs = arg(rest, '--run-dirs')?.split(',').map(s => s.trim()).filter(Boolean) ?? []
      if (!dirs.length) throw new Error('report needs --run-dirs')
      // --per-protocol: the preregistered sensitivity analysis without arm-violating responses.
      const records = dirs.flatMap(d => loadScores(d)).filter(r => !rest.includes('--per-protocol') || r.compliance !== 'violated')
      const arms = [...new Set(records.map(r => r.arm))].sort() as Arm[]
      const pooled = summarize(records, arms)
      const perModel = Object.fromEntries([...new Set(records.map(r => `${r.provider}/${r.model}`))].map(k => [k, summarize(records.filter(r => `${r.provider}/${r.model}` === k), arms)]))
      const decision = decide(pooled)
      const out = arg(rest, '--out')
      if (out) writeFileSync(abs(out), JSON.stringify({ runDirs: dirs, pooled, perModel, decision }, null, 2) + '\n')
      printSummary(pooled)
      console.log(decision)
      return 0
    }
  } finally {
    oracle?.close()
  }
  throw new Error(`Unknown command ${command}\n${USAGE}`)
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) })
}
