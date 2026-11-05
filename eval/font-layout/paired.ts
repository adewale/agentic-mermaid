import { spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { cpus, platform, release } from 'node:os'
import { timingIds } from './catalog.ts'
import { variants } from './configs.ts'
import { assertLocalMeasurement } from '../trident/prepare.ts'

assertLocalMeasurement()

const args = process.argv.slice(2)
const value = (flag: string, fallback: string) => args.includes(flag) ? args[args.indexOf(flag) + 1]! : fallback
const baseline = resolve(value('--baseline', '../baseline')), head = resolve(value('--head', '.'))
const out = resolve(value('--out', '../measurements/paired'))
const corpusPath = resolve(value('--corpus', '../measurements/baseline-fixed/corpus.json'))
const rounds = Number(value('--rounds', '3'))
const modes = value('--modes', 'recompute,cached,memory,png-latency,png-memory,startup').split(',')
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as Array<{ id: string; source: string; family: string }>
const selected = [...timingIds, 'contact-sheet/L', 'regression/mfa-login']
mkdirSync(out, { recursive: true })
const protocolPath = join(out, 'protocol.json')
if (existsSync(protocolPath)) throw Error('Refuse to overwrite paired measurements')
const revision = (root: string) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
writeFileSync(protocolPath, JSON.stringify({ version: 2, baseline: revision(baseline), head: revision(head), harnessRevision: revision(resolve(import.meta.dir, '../..')), date: new Date().toISOString(), bun: Bun.version,
  environment: { os: platform() + ' ' + release(), cpu: cpus()[0]?.model }, variants, rounds, modes, selected,
  startup: '21 independent fresh processes for contact-sheet/A per configuration and backend; parent wall time includes startup through consumed output and child exit; OS/filesystem warm',
  sampling: 'Per input/backend/round: control-before, rotated feature configurations, control-after. Timings and memory in separate children. Controls retain both observations.',
  cacheLanes: { recompute: 'engine and positioned caches disabled; text-spans retained', cached: 'default engine and positioned caches enabled; three warmups before nine samples' },
  artifact: 'Built public dist/index.js for SVG and dist/agent.js for PNG; build both immutable checkouts first. Initial exploratory source runs remain separate.',
  pngCohort: ['campaign/digits', 'regression/mfa-login', 'contact-sheet/L'],
  memoryCohort: ['campaign/digits', 'regression/mfa-login', 'contact-sheet/L', 'scaling/64'],
  uncertainty: 'Observed A/A controls plus predeclared 3% practical floor; no repeat-until-win, missing or failed rows retained. Exposed development corpus, not a holdout.',
}, null, 2) + '\n')
const invoke = (root: string, variant: { id: string; features: string[] }, item: typeof corpus[number], backend: 'elk' | 'agentic', mode: string, round: number, phase: string) => {
  const before = performance.now()
  const cached = mode === 'memory' || mode === 'cached' || mode.startsWith('png') || mode === 'startup'
  const result = spawnSync(process.execPath, [join(import.meta.dir, mode.startsWith('png') ? 'png-worker.ts' : 'worker.ts')], {
    cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
    input: JSON.stringify({ root, mode: mode === 'recompute' || mode === 'cached' ? 'latency' : mode, out, features: variant.features, backend, repetitions: 9, item }),
    env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: cached ? '1' : '0', AGENTIC_MERMAID_EXPERIMENTS: cached ? 'text-spans,indexed-layout,position-cache' : 'text-spans,indexed-layout', AGENTIC_MERMAID_LAYOUT_FEATURES: variant.features.filter(name => name !== 'fonts').join(',') },
  })
  let observation: unknown
  try { observation = JSON.parse(result.stdout.trim().split('\n').at(-1)!) } catch { observation = { failure: result.error ? String(result.error) : result.stderr || result.stdout } }
  appendFileSync(join(out, 'raw.jsonl'), JSON.stringify({ mode, round, phase, variant: variant.id, id: item.id, backend, elapsedMs: performance.now() - before, status: result.status, observation, stderr: result.stderr || undefined }) + '\n')
}
for (const mode of modes) {
  const cohort = mode === 'startup' ? corpus.filter(item => item.id === 'contact-sheet/A')
    : mode === 'memory' ? corpus.filter(item => ['campaign/digits', 'regression/mfa-login', 'contact-sheet/L', 'scaling/64'].includes(item.id))
    : mode.startsWith('png') ? corpus.filter(item => ['campaign/digits', 'regression/mfa-login', 'contact-sheet/L'].includes(item.id))
      : corpus.filter(item => selected.includes(item.id))
  const count = mode === 'startup' ? 21 : rounds
  for (let round = 0; round < count; round++) {
    for (const item of cohort) for (const backend of ['elk', 'agentic'] as const) {
      if (backend === 'agentic' && !['flowchart', 'state', 'class', 'er', 'requirement', 'architecture'].includes(item.family)) continue
      invoke(baseline, { id: 'baseline', features: [] }, item, backend, mode, round, 'control-before')
      const offset = round % variants.length
      for (const variant of [...variants.slice(offset), ...variants.slice(0, offset)]) invoke(head, variant, item, backend, mode, round, 'feature')
      invoke(baseline, { id: 'baseline', features: [] }, item, backend, mode, round, 'control-after')
    }
    console.log(`${mode}: round ${round + 1}/${count}`)
  }
}
