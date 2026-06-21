#!/usr/bin/env bun
/**
 * Turn surviving Stryker mutants into ready-to-use "kill prompts" for an LLM.
 *
 * For each SURVIVED mutant this emits a self-contained block — the mutation
 * diff, a window of surrounding source, the tests that already cover the line
 * (from perTest reports), and an instruction to write ONE minimal killing test
 * and sabotage-verify it (revert the prod line, confirm the test goes red).
 * This is the semi-automation of the manual harvest loop (cf. Meta's ACH:
 * mutation-guided LLM test generation): generate prompts -> LLM drafts a test ->
 * run a scoped lane / sabotage-verify -> keep what bites.
 *
 *   bun run scripts/mutation-kill-prompts.ts reports/mutation/routes-mutation.json
 *   bun run scripts/mutation-kill-prompts.ts --range 1915-2062 --limit 20 --out prompts.md
 *   bun run scripts/mutation-kill-prompts.ts --skip-suspected-equivalent
 *
 * Flags:
 *   --out <file>                 also write the prompt pack to a file
 *   --range <lo-hi>              only mutants whose start line is in [lo,hi]
 *   --mutator <Name>             only this mutator (repeatable, comma-separated)
 *   --limit <n>                  cap the number of prompts
 *   --context <n>                source lines of context each side (default 8)
 *   --skip-suspected-equivalent  drop broadening mutants (see EQUIVALENCE_PRONE)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Mutant {
  id: string
  mutatorName: string
  status: string
  replacement?: string
  coveredBy?: string[]
  location: { start: { line: number; column: number }; end: { line: number; column: number } }
}
interface Report {
  files: Record<string, { source?: string; mutants: Mutant[] }>
  testFiles?: Record<string, { tests: Array<{ id: string; name: string }> }>
}

// Mutators whose mutations frequently only *broaden* an already-true-in-domain
// condition, which is often equivalent (re-enrolling/over-matching is a no-op).
// Worth a 30-second equivalence check before writing a test.
const EQUIVALENCE_PRONE = new Set(['BooleanLiteral', 'LogicalOperator', 'ConditionalExpression'])

const args = process.argv.slice(2)
const opt = { out: '', range: '', mutators: new Set<string>(), limit: Infinity, context: 8, skipEquiv: false }
const paths: string[] = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]!
  if (a === '--out') opt.out = args[++i]!
  else if (a === '--range') opt.range = args[++i]!
  else if (a === '--mutator') args[++i]!.split(',').forEach(m => opt.mutators.add(m))
  else if (a === '--limit') opt.limit = Number(args[++i])
  else if (a === '--context') opt.context = Number(args[++i])
  else if (a === '--skip-suspected-equivalent') opt.skipEquiv = true
  else paths.push(a)
}
if (paths.length === 0) {
  const dir = 'reports/mutation'
  if (existsSync(dir)) for (const f of readdirSync(dir).sort()) if (f.endsWith('-mutation.json')) paths.push(join(dir, f))
}
if (paths.length === 0) { console.error('No report given and reports/mutation/*-mutation.json not found.'); process.exit(1) }

let [lo, hi] = [0, Infinity]
if (opt.range) { const m = opt.range.split('-'); lo = Number(m[0]); hi = Number(m[1] ?? m[0]) }

const out: string[] = []
const emit = (s = '') => out.push(s)
emit('# Mutation kill-prompts')
emit('')
emit(`Generated ${new Date().toISOString()}. One block per surviving mutant. Paste a block into an`)
emit('LLM session, let it draft the test, then **sabotage-verify**: revert the production line and')
emit('confirm the new test fails, then restore. Re-run a scoped lane to confirm the kill.')
emit('')

let count = 0
for (const path of paths) {
  if (!existsSync(path)) continue
  const report = JSON.parse(readFileSync(path, 'utf8')) as Report
  const testNames = new Map<string, string>()
  for (const tf of Object.values(report.testFiles ?? {})) for (const t of tf.tests) testNames.set(t.id, t.name)

  for (const [file, info] of Object.entries(report.files)) {
    const srcLines = (info.source ?? (existsSync(file) ? readFileSync(file, 'utf8') : '')).split('\n')
    const survivors = info.mutants
      .filter(m => m.status === 'Survived')
      .filter(m => m.location.start.line >= lo && m.location.start.line <= hi)
      .filter(m => opt.mutators.size === 0 || opt.mutators.has(m.mutatorName))
      .filter(m => !(opt.skipEquiv && EQUIVALENCE_PRONE.has(m.mutatorName)))
      .sort((a, b) => a.location.start.line - b.location.start.line || a.location.start.column - b.location.start.column)

    for (const m of survivors) {
      if (count >= opt.limit) break
      count++
      const ln = m.location.start.line
      const from = Math.max(1, ln - opt.context)
      const to = Math.min(srcLines.length, ln + opt.context)
      const window = srcLines.slice(from - 1, to)
        .map((line, i) => `${String(from + i).padStart(4)}${from + i === ln ? ' >' : '  '} ${line}`)
        .join('\n')
      const covering = (m.coveredBy ?? []).map(id => testNames.get(id) ?? id)
      const suspect = EQUIVALENCE_PRONE.has(m.mutatorName)

      emit(`## ${file}:${ln}:${m.location.start.column} — ${m.mutatorName}${suspect ? '  ⚠ check equivalence first' : ''}`)
      emit('')
      emit(`- Mutation: replace the code at this location with: \`${(m.replacement ?? '').replace(/\s+/g, ' ').slice(0, 120)}\``)
      emit(`- Covering tests (${covering.length}): ${covering.length ? covering.slice(0, 8).map(t => `\`${t}\``).join(', ') : '(none reported — report lacks perTest data)'}`)
      if (suspect) emit(`- ⚠ This mutator often only *broadens* a condition that is already true in its reachable domain. First decide if it is **equivalent** (then suppress with \`// Stryker disable next-line ${m.mutatorName}: <reason>\`); only write a test if a real input distinguishes it.`)
      emit('')
      emit('```ts')
      emit(window)
      emit('```')
      emit('')
      emit('> Task: write ONE minimal test (hand-built geometry via `applyRouteContracts`/`layoutGraphSync`,')
      emit('> matching the existing style) whose assertion changes value under the mutation above. Then')
      emit('> sabotage-verify: apply the mutation to the prod line, confirm the test fails, revert.')
      emit('')
    }
  }
}

emit(`---`)
emit(`${count} prompt(s) emitted.${opt.skipEquiv ? ' (broadening/equivalence-prone mutators skipped)' : ''}`)

const text = out.join('\n')
if (opt.out) { writeFileSync(opt.out, text); console.error(`wrote ${opt.out} (${count} prompts)`) }
console.log(text)
