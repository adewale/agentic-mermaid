import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { cpus, platform, release, totalmem } from 'node:os'
import { cases, timingIds } from './catalog.ts'

const args = process.argv.slice(2)
const value = (flag: string, fallback: string) => args.includes(flag) ? args[args.indexOf(flag) + 1]! : fallback
const root = resolve(value('--root', join(import.meta.dir, '../..')))
const out = resolve(value('--out', join(root, 'bench-report/font-layout')))
const features = value('--features', '').split(',').filter(Boolean)
const round = Number(value('--round', '0'))
const modes = value('--modes', 'quality,latency,memory').split(',')
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const catalogPath = join(out, 'corpus.json')
mkdirSync(out, { recursive: true })
const corpus = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) as ReturnType<typeof cases> : cases()
if (!existsSync(catalogPath)) writeFileSync(catalogPath, JSON.stringify(corpus, null, 2) + '\n')
const protocol = {
  version: 1, source, features, round, date: new Date().toISOString(), runtime: process.version, bun: Bun.version,
  os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, totalMemory: totalmem(),
  cohort: 'existing tracker plus declared campaign/scaling cases; exposed development set, not a holdout',
  startup: 'fresh child import and first fully consumed SVG+receipt; parent-observed process elapsed separately; warm filesystem',
  warm: 'three warmups, nine measured fully consumed SVG+receipt calls per child',
  memory: 'separate fresh children; process lifetime RSS high-water mark (platform units), JS heap/RSS phase snapshots; GC requested',
  resourceLimits: '60-second timeout per child; failures retained',
  recomputation: 'AGENTIC_MERMAID_ELK_CACHE=0 and position-cache experiment disabled; text preparation optimization retained',
  viewport: { width: 800, height: 600 },
  rawResults: 'append-only JSONL per independent round; no overwritten prior attempts',
}
const protocolPath = join(out, `protocol-${round}.json`)
if (existsSync(protocolPath)) throw Error('Round already exists: ' + protocolPath)
writeFileSync(protocolPath, JSON.stringify(protocol, null, 2) + '\n')
const file = join(out, `raw-${round}.jsonl`)
for (const mode of modes) {
  const chosen = mode === 'quality' ? corpus : corpus.filter(item => timingIds.includes(item.id))
  for (const item of chosen) for (const backend of ['elk', 'agentic'] as const) {
    if (backend === 'agentic' && !['flowchart', 'state', 'class', 'er', 'requirement', 'architecture'].includes(item.family)) continue
    const start = performance.now()
    const result = spawnSync(process.execPath, [join(import.meta.dir, 'worker.ts')], {
      cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
      input: JSON.stringify({ root, mode, out: join(out, backend, 'artifacts'), features, backend, repetitions: 9, item }),
      env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: '0', AGENTIC_MERMAID_EXPERIMENTS: 'text-spans,indexed-layout', AGENTIC_MERMAID_LAYOUT_FEATURES: features.filter(name => name !== 'fonts').join(',') },
    })
    const elapsedMs = performance.now() - start
    let observation: unknown
    try { observation = JSON.parse(result.stdout.trim().split('\n').at(-1)!) } catch { observation = { id: item.id, backend, failure: result.error ? String(result.error) : result.stderr || result.stdout } }
    appendFileSync(file, JSON.stringify({ mode, round, source, elapsedMs, status: result.status, observation, stderr: result.stderr || undefined }) + '\n')
    if (result.status !== 0) console.warn(`${mode} ${backend} ${item.id}: failed (${result.status})`)
  }
  console.log(`${mode}: ${chosen.length} inputs; round ${round}; ${source.slice(0, 8)}; ${features.join(',') || 'baseline'}`)
}
