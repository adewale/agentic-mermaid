// ============================================================================
// quality:impact — which real diagrams does a change touch, and how?
//
// Lays out every real diagram under this checkout and under a comparison
// revision (a base such as origin/main, or this checkout with one commit
// reverted), scores both layouts with this checkout's scorer, and lists every
// real diagram whose geometry changed, with its finding and crossing deltas.
//
// Use it before building or keeping a layout rule: a rule that changes no real
// diagram serves only synthetic inputs and is a candidate to drop.
//
//   bun run quality:impact --base origin/main
//   bun run quality:impact --revert <commit>
// ============================================================================

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { RenderedLayout } from '../../src/agent/types.ts'
import { realDiagrams, type RealDiagram } from './real-diagrams.ts'
import { FINDINGS, findingCount, score, type Score } from './score.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined }
const base = arg('--base'), revert = arg('--revert')
if (!base === !revert) { console.error('usage: quality:impact --base <revision> | --revert <commit>'); process.exit(2) }

const git = (args: string[], cwd = ROOT) => {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`)
  return r.stdout.toString().trim()
}

// Lays out the given diagrams in another checkout's own process and module graph.
const CAPTURE = `
const api = await import(process.env.Q_ROOT + '/src/agent/index.ts')
const out = {}
for (const d of JSON.parse(await Bun.file(process.env.Q_IN).text())) {
  try { out[d.id] = { layout: api.layoutMermaidWithReceipt(d.source).layout } } catch (e) { out[d.id] = { error: String(e && e.message || e).split('\\n')[0] } }
}
await Bun.write(process.env.Q_OUT, JSON.stringify(out))
`
type Captured = Record<string, { layout?: RenderedLayout; error?: string }>
function capture(root: string, diagrams: RealDiagram[], work: string, name: string): Captured {
  const input = join(work, `${name}-in.json`), output = join(work, `${name}-out.json`)
  writeFileSync(input, JSON.stringify(diagrams))
  const r = Bun.spawnSync(['bun', '-e', CAPTURE], { cwd: root, stdout: 'inherit', stderr: 'inherit',
    env: { ...process.env, Q_ROOT: root, Q_IN: input, Q_OUT: output, AGENTIC_MERMAID_ELK_CACHE: '0' } })
  if (r.exitCode !== 0) throw new Error(`capture failed in ${root}`)
  return JSON.parse(readFileSync(output, 'utf8'))
}

const work = mkdtempSync(join(tmpdir(), 'quality-impact-'))
const other = join(work, 'checkout')
try {
  git(['worktree', 'add', '--detach', other, revert ? 'HEAD' : base!])
  if (revert) {
    try { git(['revert', '--no-commit', revert], other) } catch {
      console.error(`${revert} does not revert cleanly on this checkout; compare against its parent instead: --base ${revert}~1 (that also includes the commits after it)`)
      process.exitCode = 1
      throw new Error('revert conflict')
    }
  }
  symlinkSync(join(ROOT, 'node_modules'), join(other, 'node_modules'))
  // The same real diagrams on both sides: this checkout's list.
  const diagrams = await realDiagrams()
  const head = capture(ROOT, diagrams, work, 'head'), then = capture(other, diagrams, work, 'other')
  const digest = (layout?: RenderedLayout) => layout ? createHash('sha256').update(JSON.stringify(layout)).digest('hex') : undefined
  const label = revert ? `with ${revert} reverted` : base!
  const rows: string[] = []
  let better = 0, worse = 0
  for (const d of diagrams) {
    const h = head[d.id]!, o = then[d.id]!
    if (h.error || o.error) { if (h.error !== o.error) { if (h.error) worse++; else better++; rows.push(`| ${d.id} | ${h.error ? 'worse' : 'better'} | ${o.error ? 'error' : 'lays out'} → ${h.error ? `error: ${h.error.slice(0, 80)}` : 'lays out'} | |`) }; continue }
    if (digest(h.layout) === digest(o.layout)) continue
    const [sh, so] = [score(h.layout!), score(o.layout!)]
    const moved = ([...FINDINGS, 'crossings', 'bends'] as (keyof Score)[]).filter(key => sh[key] !== so[key])
    const delta = moved.map(key => `${key} ${so[key]} → ${sh[key]}`).join(', ') || 'geometry only'
    // Misleading findings first, then crossings, then bends: a reader is misled
    // by a touch or shared run before a crossing slows them down.
    const order = (s: Score) => [findingCount(s), s.crossings, s.bends]
    const verdict = order(sh).map((n, i) => Math.sign(n - order(so)[i]!)).find(sign => sign !== 0) ?? 0
    if (verdict < 0) better++; else if (verdict > 0) worse++
    rows.push(`| ${d.id} | ${verdict < 0 ? 'better' : verdict > 0 ? 'worse' : 'even'} | ${delta} | ${d.url ?? ''} |`)
  }
  console.log(`Real diagrams: ${diagrams.length}. Changed between ${label} and this checkout: ${rows.length} (${better} better, ${worse} worse by findings, then crossings, then bends).\n`)
  if (rows.length) console.log(['| diagram | verdict | change (other → this checkout) | issue |', '|---|---|---|---|', ...rows].join('\n'))
  else console.log('No real diagram changes: this difference serves only synthetic inputs.')
} catch (error) {
  if ((error as Error).message !== 'revert conflict') throw error
} finally {
  try { git(['worktree', 'remove', '--force', other]) } catch { /* already gone */ }
  rmSync(work, { recursive: true, force: true })
}
