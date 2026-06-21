#!/usr/bin/env bun
/**
 * Summarize SURVIVED mutants from Stryker JSON reports into a triage list.
 *
 * A survivor is a test gap until shown otherwise (docs/mutation-testing.md), so
 * the nightly route lanes are only useful if their survivors are legible. This
 * reads the Stryker JSON reports and prints, per lane: the mutation score,
 * status counts, survivors grouped by mutator, the worst line hotspots, and the
 * full survivor list (line:col — mutator — replacement).
 *
 *   bun run scripts/mutation-survivors.ts                    # all reports/mutation/*-mutation.json
 *   bun run scripts/mutation-survivors.ts --out triage.md    # also write to a file
 *   bun run scripts/mutation-survivors.ts reports/mutation/routes-mutation.json
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

interface Mutant {
  mutatorName: string
  status: string
  replacement?: string
  location: { start: { line: number; column: number }; end: { line: number; column: number } }
}
interface Report { files: Record<string, { mutants: Mutant[] }> }

const REPORT_DIR = 'reports/mutation'
const HOTSPOT_LIMIT = 30

const args = process.argv.slice(2)
let outFile: string | undefined
const paths: string[] = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') { outFile = args[++i]; continue }
  paths.push(args[i]!)
}
if (paths.length === 0) {
  if (!existsSync(REPORT_DIR)) {
    console.error(`No reports given and ${REPORT_DIR}/ does not exist. Run a mutation lane first.`)
    process.exit(1)
  }
  for (const f of readdirSync(REPORT_DIR).sort()) {
    if (f.endsWith('-mutation.json')) paths.push(join(REPORT_DIR, f))
  }
}

// Stryker's "total" mutation score: detected / valid, where detected counts
// kills and timeouts and valid excludes ignored / compile / runtime errors.
const DETECTED = new Set(['Killed', 'Timeout'])
const VALID = new Set(['Killed', 'Timeout', 'Survived', 'NoCoverage'])

function sanitize(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function laneName(path: string): string {
  return basename(path).replace(/-mutation\.json$/, '').replace(/\.json$/, '')
}

const out: string[] = []
const emit = (line = '') => out.push(line)

emit(`# Mutation survivor triage`)
emit('')
emit(`Generated ${new Date().toISOString()} from ${paths.length} report(s).`)
emit('')

for (const path of paths) {
  if (!existsSync(path)) { console.error(`skip (missing): ${path}`); continue }
  const report = JSON.parse(readFileSync(path, 'utf8')) as Report
  const counts: Record<string, number> = {}
  const survivors: { file: string; line: number; col: number; mutator: string; replacement: string }[] = []
  for (const [file, { mutants }] of Object.entries(report.files)) {
    for (const m of mutants) {
      counts[m.status] = (counts[m.status] ?? 0) + 1
      if (m.status === 'Survived') {
        survivors.push({
          file,
          line: m.location.start.line,
          col: m.location.start.column,
          mutator: m.mutatorName,
          replacement: sanitize(m.replacement),
        })
      }
    }
  }
  const detected = Object.entries(counts).filter(([s]) => DETECTED.has(s)).reduce((a, [, n]) => a + n, 0)
  const valid = Object.entries(counts).filter(([s]) => VALID.has(s)).reduce((a, [, n]) => a + n, 0)
  const score = valid ? (detected / valid * 100) : 0

  emit(`## ${laneName(path)} — ${score.toFixed(2)}%`)
  emit('')
  emit(`\`${path}\``)
  emit('')
  const order = ['Killed', 'Timeout', 'Survived', 'NoCoverage', 'CompileError', 'RuntimeError', 'Ignored']
  const shown = order.filter(s => counts[s]).map(s => `${s} ${counts[s]}`)
  for (const s of Object.keys(counts)) if (!order.includes(s)) shown.push(`${s} ${counts[s]}`)
  emit(`Status: ${shown.join(' · ')}`)
  emit('')

  if (survivors.length === 0) { emit('No survivors. 🎉'); emit(''); continue }

  // Survivors by mutator.
  const byMutator: Record<string, number> = {}
  for (const s of survivors) byMutator[s.mutator] = (byMutator[s.mutator] ?? 0) + 1
  emit(`### Survivors by mutator (${survivors.length} total)`)
  emit('')
  emit('| Mutator | Count |')
  emit('| --- | ---: |')
  for (const [mut, n] of Object.entries(byMutator).sort((a, b) => b[1] - a[1])) emit(`| ${mut} | ${n} |`)
  emit('')

  // Line hotspots.
  const byLine = new Map<string, { count: number; mutators: Set<string> }>()
  for (const s of survivors) {
    const key = `${s.file}:${s.line}`
    const e = byLine.get(key) ?? { count: 0, mutators: new Set<string>() }
    e.count++; e.mutators.add(s.mutator); byLine.set(key, e)
  }
  const hotspots = [...byLine.entries()].sort((a, b) => b[1].count - a[1].count)
  emit(`### Line hotspots (top ${Math.min(HOTSPOT_LIMIT, hotspots.length)} of ${hotspots.length})`)
  emit('')
  emit('| Location | Survivors | Mutators |')
  emit('| --- | ---: | --- |')
  for (const [loc, e] of hotspots.slice(0, HOTSPOT_LIMIT)) {
    emit(`| ${loc} | ${e.count} | ${[...e.mutators].join(', ')} |`)
  }
  emit('')

  // Full survivor list.
  survivors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col)
  emit(`<details><summary>Full survivor list (${survivors.length})</summary>`)
  emit('')
  emit('```')
  for (const s of survivors) emit(`${s.file}:${s.line}:${s.col}  ${s.mutator}  →  ${s.replacement}`)
  emit('```')
  emit('')
  emit('</details>')
  emit('')
}

const text = out.join('\n')
if (outFile) { writeFileSync(outFile, text); console.error(`wrote ${outFile}`) }
console.log(text)
