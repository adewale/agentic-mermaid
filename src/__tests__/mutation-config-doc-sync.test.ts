// Moves 10 + 3: keep the mutation configs' prose honest.
//
// Move 10: a stryker config's `_thresholds_note` states a break number in prose
// (e.g. "break=90"); that prose must match the config's actual thresholds.break,
// so the note can't lie. Applied to every stryker*.config.json that carries a
// note + thresholds, so future configs are covered.
//
// Move 3: the incremental lane's documented baseline score in
// docs/mutation-testing.md must match the config note's measured score (both
// committed), and — when a local mutation run has produced the JSON report —
// the report's actual score too. Prevents the documented number from drifting
// from reality.

import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const strykerConfigs = readdirSync(ROOT).filter(f => /^stryker.*\.config\.json$/.test(f))

describe('stryker config _thresholds_note ↔ thresholds.break (Move 10)', () => {
  test('there are stryker configs to check', () => {
    expect(strykerConfigs.length).toBeGreaterThan(0)
  })

  for (const file of strykerConfigs) {
    const cfg = JSON.parse(read(file)) as { _thresholds_note?: string; thresholds?: { break?: number } }
    if (!cfg._thresholds_note || cfg.thresholds?.break === undefined) continue
    test(`${file}: the note's break number matches thresholds.break`, () => {
      const m = cfg._thresholds_note!.match(/break[^\d]*(\d+)/i)
      expect(m, `_thresholds_note must state a break number: ${cfg._thresholds_note}`).not.toBeNull()
      expect(Number(m![1])).toBe(cfg.thresholds!.break!)
    })
  }
})

describe('incremental mutation baseline ↔ docs (Move 3)', () => {
  const cfg = JSON.parse(read('stryker.incremental.config.json')) as { _thresholds_note?: string }
  const note = cfg._thresholds_note ?? ''
  const noteScore = note.match(/(\d+\.\d+)%/)?.[1]
  const doc = read('docs/mutation-testing.md')

  test('the config note records a measured score', () => {
    expect(noteScore).toBeDefined()
  })

  test('docs/mutation-testing.md documents the same baseline score', () => {
    expect(doc).toContain(`${noteScore}%`)
  })

  // Move 7: the documented survivor COUNT (prose: "the four survivors") must
  // equal total−killed, and the report's Survived count when present — so the
  // count can't go stale the way a hard-coded number would.
  test('the documented survivor count matches killed/total (and the report)', () => {
    const m = note.match(/(\d+)\/(\d+) killed/)
    expect(m).not.toBeNull()
    const killed = Number(m![1]), total = Number(m![2])
    const survivors = total - killed
    expect(doc).toContain(`${killed}/${total}`)
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
    const docFlat = doc.toLowerCase().replace(/\s+/g, ' ')  // the count can wrap across a line
    expect(docFlat).toContain(`${words[survivors]} survivor`)

    const reportPath = join(ROOT, 'reports/mutation/incremental-mutation.json')
    if (!existsSync(reportPath)) return
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { files: Record<string, { mutants: Array<{ status: string }> }> }
    let survived = 0
    for (const f of Object.values(report.files)) for (const mu of f.mutants) if (mu.status === 'Survived') survived++
    expect(survived).toBe(survivors)
  })

  test('if the JSON report is present, its score matches the documented number', () => {
    const reportPath = join(ROOT, 'reports/mutation/incremental-mutation.json')
    if (!existsSync(reportPath)) return  // report is gitignored / not generated in this run
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { files: Record<string, { mutants: Array<{ status: string }> }> }
    let killed = 0, total = 0
    for (const f of Object.values(report.files)) for (const m of f.mutants) {
      if (m.status === 'NoCoverage' || m.status === 'Ignored' || m.status === 'CompileError') continue
      total++
      if (m.status === 'Killed' || m.status === 'Timeout') killed++
    }
    const score = (killed / total) * 100
    expect(score.toFixed(2)).toBe(noteScore!)
  })
})
