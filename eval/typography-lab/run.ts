// Typography option lab: renders representative diagrams under each
// typography option through the real pipeline (one worker process per
// option and base, so module-level sizes and caches never mix) and writes
// bench-report/typography-lab/{report.json,index.html}.
//   bun eval/typography-lab/run.ts [--bases 13,16,20]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { knownBuiltinFamilies, getFamily } from '../../src/agent/index.ts'
import { INPUT_CASES, STRESS_CASES, type LabCase } from './cases.ts'
import { OPTION_LABELS, PROBE_FACTOR, TIER_RATIOS, TIER_TOKENS, TODAY_BODY, type LabOption, type LabPolicy } from './policies.ts'
import type { DrawnText, WorkerResult } from './worker.ts'

const ROOT = resolve(import.meta.dir, '../..')
const OUT = join(ROOT, 'bench-report/typography-lab')
const basesArg = process.argv.indexOf('--bases')
const BASES = basesArg > 0 ? process.argv[basesArg + 1]!.split(',').map(Number) : [13, 16, 20]
const OPTIONS: LabOption[] = ['option1', 'option2', 'option3']

type Group = 'family' | 'stress' | 'input'
interface Case extends LabCase { readonly group: Group }
interface Run { readonly key: string; readonly caseId: string; readonly option: LabOption; readonly base: number; readonly variant?: 'absolute' | 'relative' }

const cases: Case[] = [
  ...knownBuiltinFamilies().flatMap(family => {
    const source = getFamily(family)?.example
    return source ? [{ id: `example-${family}`, family, source, group: 'family' as const }] : []
  }),
  ...STRESS_CASES.map(c => ({ ...c, group: 'stress' as const })),
  ...INPUT_CASES.map(c => ({ ...c, group: 'input' as const })),
]

const runs: Run[] = []
const add = (run: Omit<Run, 'key'>) => runs.push({ ...run, key: `${run.caseId}|${run.option}|${run.base}|${run.variant ?? ''}` })
for (const c of cases) {
  add({ caseId: c.id, option: 'current', base: TODAY_BODY })
  add({ caseId: c.id, option: 'probe', base: TODAY_BODY })
  if (c.group === 'input') {
    for (const option of OPTIONS) {
      // How a global Mermaid size sets the base: as pixels, or relative to
      // Mermaid's own default of 16px. Cases without one render at today's base.
      add({ caseId: c.id, option, base: c.mermaidSize ?? TODAY_BODY, variant: 'absolute' })
      add({ caseId: c.id, option, base: c.mermaidSize === undefined ? TODAY_BODY : Math.round(TODAY_BODY * c.mermaidSize / 16 * 2) / 2, variant: 'relative' })
    }
  } else {
    for (const option of OPTIONS) for (const base of BASES) add({ caseId: c.id, option, base })
  }
}

async function runWorker(policy: LabPolicy, batch: Case[], index: number): Promise<WorkerResult[]> {
  const input = join(OUT, `tmp-in-${index}.json`), output = join(OUT, `tmp-out-${index}.json`)
  writeFileSync(input, JSON.stringify(batch.map(({ id, source }) => ({ id, source }))))
  await new Promise<void>((done, fail) => {
    const child = spawn('bun', ['--preload', join(import.meta.dir, 'policy-preload.ts'), join(import.meta.dir, 'worker.ts'), input, output], {
      cwd: ROOT, env: { ...process.env, AM_TYPOGRAPHY_POLICY: JSON.stringify(policy) }, stdio: ['ignore', 'ignore', 'inherit'],
    })
    child.on('exit', code => code === 0 ? done() : fail(new Error(`worker ${JSON.stringify(policy)} exited ${code}`)))
  })
  return JSON.parse(readFileSync(output, 'utf8')) as WorkerResult[]
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const groups = new Map<string, { policy: LabPolicy; cases: Case[]; runs: Run[] }>()
  for (const run of runs) {
    const id = `${run.option}@${run.base}`
    const group = groups.get(id) ?? { policy: { option: run.option, base: run.base }, cases: [], runs: [] }
    if (!group.cases.some(c => c.id === run.caseId)) group.cases.push(cases.find(c => c.id === run.caseId)!)
    group.runs.push(run)
    groups.set(id, group)
  }
  const results = new Map<string, WorkerResult>()
  const queue = [...groups.values()]
  let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < queue.length) {
      const index = next++, group = queue[index]!
      const out = await runWorker(group.policy, group.cases, index)
      for (const run of group.runs) results.set(run.key, out.find(r => r.id === run.caseId)!)
    }
  }))

  const result = (caseId: string, option: LabOption, base: number, variant?: string) => results.get(`${caseId}|${option}|${base}|${variant ?? ''}`)
  const today = (caseId: string) => result(caseId, 'current', TODAY_BODY)!

  // Pair each text with today's by position when the same texts are drawn,
  // else by content, and count the ones whose size moved.
  const changes = (base: readonly DrawnText[], next: readonly DrawnText[]) => {
    const pairs: [DrawnText, DrawnText][] = []
    if (base.length === next.length && base.every((t, i) => t.text === next[i]!.text)) base.forEach((t, i) => pairs.push([t, next[i]!]))
    else { const pool = [...next]; for (const t of base) { const i = pool.findIndex(n => n.text === t.text); if (i >= 0) pairs.push([t, pool.splice(i, 1)[0]!]) } }
    const moved = pairs.filter(([a, b]) => a.size !== b.size)
    const map = new Map<string, number>()
    for (const [a, b] of moved) map.set(`${a.size}→${b.size}`, (map.get(`${a.size}→${b.size}`) ?? 0) + 1)
    return { total: pairs.length, moved: moved.length, steps: [...map].sort((x, y) => y[1] - x[1]).map(([step, count]) => ({ step, count })) }
  }
  const integrity = (r: WorkerResult | undefined) => Object.values(r?.integrity ?? {}).reduce((s, n) => s + n, 0)
  const sizesOf = (r: WorkerResult | undefined) => [...new Set((r?.texts ?? []).map(t => t.size))].sort((a, b) => b - a)

  // Coverage: under the probe every routed default grows by PROBE_FACTOR, so a
  // text that does not is sized outside the seam. Input cases are excluded:
  // their authored sizes are meant to stay put.
  const unrouted: { caseId: string; family: string; text: string; size: number }[] = []
  for (const c of cases.filter(c => c.group !== 'input')) {
    const base = today(c.id), probe = result(c.id, 'probe', TODAY_BODY)
    if (!base?.ok || !probe?.ok) continue
    const pool = [...probe.texts!]
    for (const t of base.texts!) {
      const i = pool.findIndex(n => n.text === t.text)
      if (i < 0) continue
      const p = pool.splice(i, 1)[0]!
      if (Math.abs(p.size - t.size * PROBE_FACTOR) > 0.6 && unrouted.filter(u => u.family === c.family && u.size === t.size).length < 3) unrouted.push({ caseId: c.id, family: c.family, text: t.text.slice(0, 40), size: t.size })
    }
  }

  const familyCases = cases.filter(c => c.group === 'family')
  const summary = [{ option: 'current' as LabOption, base: TODAY_BODY }, ...OPTIONS.flatMap(option => BASES.map(base => ({ option, base })))].map(({ option, base }) => {
    const nonInput = cases.filter(c => c.group !== 'input')
    const distinct = new Set(familyCases.flatMap(c => sizesOf(result(c.id, option, base))))
    const changedFamilies = new Set(nonInput.filter(c => changes(today(c.id).texts ?? [], result(c.id, option, base)?.texts ?? []).moved > 0).map(c => c.family))
    const areaRatios = nonInput.map(c => { const a = today(c.id), b = result(c.id, option, base); return a?.ok && b?.ok ? (b.width! * b.height!) / (a.width! * a.height!) : NaN }).filter(Number.isFinite).sort((x, y) => x - y)
    return {
      option, base, label: OPTION_LABELS[option],
      distinctSizes: [...distinct].sort((a, b) => b - a),
      familiesChanged: [...changedFamilies].sort(),
      integrityWarnings: nonInput.reduce((s, c) => s + integrity(result(c.id, option, base)), 0),
      integrityToday: nonInput.reduce((s, c) => s + integrity(today(c.id)), 0),
      medianArea: areaRatios[Math.floor(areaRatios.length / 2)] ?? NaN,
      failures: nonInput.filter(c => result(c.id, option, base)?.ok === false).map(c => c.id),
    }
  })

  const cells = runs.filter(r => r.option !== 'probe').map(r => {
    const out = results.get(r.key)!, base = today(r.caseId)
    return { ...r, ok: out.ok, error: out.error, svg: out.svg, width: out.width, height: out.height, sizes: sizesOf(out), integrity: out.integrity ?? {}, change: r.option === 'current' ? undefined : changes(base.texts ?? [], out.texts ?? []) }
  })

  const revision = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  const report = {
    generatedAt: new Date().toISOString().slice(0, 10), revision, bases: BASES,
    tiers: { ratios: TIER_RATIOS, tokens: TIER_TOKENS, todayBody: TODAY_BODY },
    cases: cases.map(({ id, family, group, note, mermaidSize, source }) => ({ id, family, group, note, mermaidSize, source })),
    summary, unrouted, cells,
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ ...report, cells: cells.map(({ svg: _svg, ...rest }) => rest) }, null, 2))
  const template = readFileSync(join(import.meta.dir, 'report-template.html'), 'utf8')
  writeFileSync(join(OUT, 'index.html'), template.replace('/*__REPORT__*/null', () => JSON.stringify(report).replace(/</g, '\\u003c')))
  for (const s of summary) console.log(`${s.label.padEnd(36)} base ${String(s.base).padStart(2)}  sizes ${s.distinctSizes.length}  families changed ${String(s.familiesChanged.length).padStart(2)}  integrity ${s.integrityWarnings} (today ${s.integrityToday})  median area ×${s.medianArea.toFixed(2)}${s.failures.length ? `  FAILURES ${s.failures.join(',')}` : ''}`)
  console.log(`unrouted texts: ${unrouted.length}`)
  for (const u of unrouted) console.log(`  ${u.family}: ${u.size}px "${u.text}"`)
  console.log(`wrote ${join(OUT, 'index.html')}`)
}

await main()
